'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { seatPlan } from '../core/geometry'
import type { LabelSequence } from '../core/labeling'
import type {
  Group,
  PlanBox,
  PlanDrag,
  PlanHandle,
  PlanObject,
  PlanPoint,
  PlanRect,
  PlanTarget,
  SeatPlan,
  Shape,
} from '../core/types'
import { planHandles } from './handles'
import { planEdits, type AlignEdge, type GroupMembers, type Snap } from './operations'
import type { EditorSelection } from './selection'

export type SeatPlanEditor<S extends string> = ReturnType<typeof useSeatPlanEditor<S>>

type Options<S extends string> = {
  initialPlan: SeatPlan<S>
  // Ids your other records reference (booked seats, active sessions). Objects holding one cannot be removed,
  // renamed or turned into fixtures; labels stay free to change.
  lockedIds?: Iterable<string>
  // Snap to a grid while editing — sections to cell corners, objects to half cells, turns to 15°. Off by default:
  // edits land on whole plan units.
  snap?: Snap
}

type History<S extends string> = { past: SeatPlan<S>[]; present: SeatPlan<S>; future: SeatPlan<S>[]; dirty: boolean }

// A new group made while adding — its props, or the id of one that exists.
type GroupChoice = string | Omit<Group, 'id'>

// Undo depth — plenty for an editing session, bounded so a long one does not hold every version.
const HISTORY_LIMIT = 100

// Headless seat plan editor — document state, selection, undo history and every edit operation; no UI. Spread
// `viewportProps` into <SeatMap.Viewport> (ichno/react) for tap-to-select, drag-to-move and marquee selection,
// draw `displayPlan` (the plan with the drag in progress) with `handles` and `marquee` on top, and build panels,
// buttons and saving yourself. Edits stay local until you save `plan`. To adopt a new baseline after saving,
// remount (e.g. key the component by the saved version).
//
// Tapping an object in a group selects the group; tapping it again (with the group selected) selects the object
// alone. Operations that take ids accept object and group ids alike — a group acts as one.
export function useSeatPlanEditor<S extends string>({ initialPlan, lockedIds, snap }: Options<S>) {
  const [start] = useState(() => ({
    saved: JSON.stringify(initialPlan),
    history: { past: [], present: initialPlan, future: [], dirty: false } as History<S>,
  }))
  const [history, setHistory] = useState<History<S>>(start.history)
  // The latest history, ahead of the render — so several calls in one handler build on each other (add a group,
  // then lay it out) instead of each starting from the rendered plan.
  const historyRef = useRef(start.history)
  const [selection, setSelection] = useState<EditorSelection<S>[]>([])
  const [drag, setDrag] = useState<PlanDrag<S> | null>(null)
  const locked = new Set(lockedIds)
  const grid = snap ?? null

  const plan = history.present
  const dirty = history.dirty
  // Selected objects and groups by id — what the operations take.
  const selectedIds = selection.flatMap((item) => (item.kind === 'section' ? [] : [item.id]))
  const selectedObjectIds = new Set(selectedIds.flatMap((id) => planEdits.unitOf(plan, id).map((o) => o.id)))
  const selectedObjects = plan.objects.filter((object) => selectedObjectIds.has(object.id))
  const selectedGroups = selection.flatMap((item) =>
    item.kind === 'group' ? (seatPlan.groupById(plan, item.id) ?? []) : [],
  )
  const selectedSectionId = selection.find((item) => item.kind === 'section')?.id as S | undefined
  // The places of the selection — pass them to the renderer as selected.
  const selectedPlaceIds = selectedObjects.flatMap((object) => (object.kind === 'place' ? [object.id] : []))
  // The plan as drawn — the drag in progress applied with the snapping it will commit with.
  const displayPlan = drag === null ? plan : planEdits.applyDrag(plan, drag, selectedIds, grid)
  // Places that overlap on the plan as drawn. The schema refuses to save them; pass them to
  // <SeatMap.Content invalid> to mark them while arranging.
  const conflictIds = [...new Set(seatPlan.conflictsOf(displayPlan).flat())]
  // Handles for a single selected item, placed on the plan as drawn so they follow a drag.
  const handles: PlanHandle<S>[] = planHandles.of(displayPlan, selection)
  // The outline those handles belong to — pass it to <SeatMap.Handles frame>.
  const frame = planHandles.frame(displayPlan, selection)
  // The rubber band being dragged, in plan units — draw it with <SeatMap.Marquee>.
  const [marquee, setMarquee] = useState<PlanRect | null>(null)

  function commit(next: Omit<History<S>, 'dirty'>) {
    const full = { ...next, dirty: JSON.stringify(next.present) !== start.saved }
    historyRef.current = full
    setHistory(full)
  }

  // Every change goes through here: one undo step each, and the redo branch is dropped. An edit that changes
  // nothing (removing an empty selection, a drag that snaps back) leaves history — and the redo branch — alone.
  // Returns whether anything changed.
  function apply(update: (current: SeatPlan<S>) => SeatPlan<S> | null): boolean {
    const h = historyRef.current
    const next = update(h.present)
    if (next === null || next === h.present || JSON.stringify(next) === JSON.stringify(h.present)) return false
    commit({ past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] })
    return true
  }

  function undo() {
    const h = historyRef.current
    const previous = h.past.at(-1)
    if (previous) commit({ past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] })
  }

  function redo() {
    const h = historyRef.current
    const [next, ...future] = h.future
    if (next) commit({ past: [...h.past, h.present], present: next, future })
  }

  // What a tap or a drag on a target selects — a grouped object selects its group until the group is selected,
  // then the object itself; a group label always selects its group.
  function selectionOf(target: PlanTarget<S> | EditorSelection<S>, current: readonly EditorSelection<S>[]) {
    if (target.kind === 'handle') return target.owner
    if (target.kind === 'section' || target.kind === 'group') return target
    const object = seatPlan.objectById(historyRef.current.present, target.id)
    const group = object?.group
    if (group === undefined) return { kind: 'object' as const, id: target.id }
    const opened = current.some((item) => item.kind === 'group' && item.id === group)
    return object?.kind !== 'label' && opened
      ? { kind: 'object' as const, id: target.id }
      : { kind: 'group' as const, id: group }
  }

  // Selects what a target points at. `additive` toggles it in the selection (shift/⌘-click); otherwise it
  // replaces the selection. null clears it.
  function select(target: PlanTarget<S> | EditorSelection<S> | null, additive?: boolean) {
    const item = target === null ? null : selectionOf(target, selection)
    if (!additive) {
      setSelection(item ? [item] : [])
      return
    }
    if (!item) return
    setSelection((current) =>
      current.some((other) => sameSelection(other, item))
        ? current.filter((other) => !sameSelection(other, item))
        : [...current, item],
    )
  }

  function handleTap(target: PlanTarget<S> | null, info: { additive: boolean }) {
    select(target, info.additive)
  }

  // A section moves only once it is selected; before that a drag on its floor draws a marquee.
  function canDrag(target: PlanTarget<S>): boolean {
    if (target.kind !== 'section') return true
    return selection.some((item) => item.kind === 'section' && item.id === target.id)
  }

  // Marquee selection — everything whose shape the rubber band touches, grouped objects as their group.
  // `additive` adds to the selection.
  function handleMarquee(rect: PlanRect, info: { phase: 'start' | 'move' | 'end'; additive: boolean }) {
    if (info.phase !== 'end') {
      setMarquee(rect)
      return
    }
    setMarquee(null)
    const current = historyRef.current.present
    const picked: EditorSelection<S>[] = []
    for (const id of seatPlan.objectsInRect(current, rect)) {
      const group = seatPlan.objectById(current, id)?.group
      const item = group === undefined ? { kind: 'object' as const, id } : { kind: 'group' as const, id: group }
      if (!picked.some((other) => sameSelection(other, item))) picked.push(item)
    }
    setSelection((existing) =>
      info.additive ? [...existing, ...picked.filter((item) => !existing.some((c) => sameSelection(c, item)))] : picked,
    )
  }

  function handleDrag(next: PlanDrag<S>) {
    if (next.phase === 'start' && next.target.kind !== 'handle') {
      const item = selectionOf(next.target, selection)
      // Dragging something outside the selection selects it alone; dragging a selected object moves the group.
      if (!covers(historyRef.current.present, selection, item)) setSelection([item])
    }
    if (next.phase !== 'end') {
      setDrag(next)
      return
    }
    setDrag(null)
    apply((current) => planEdits.applyDrag(current, next, selectedIds, grid))
  }

  // Runs an operation that adds objects, commits it and selects what it made.
  function added(result: { plan: SeatPlan<S>; ids: string[] } | null, pick: EditorSelection<S>[]): string[] {
    if (!result || result.ids.length === 0) return []
    apply(() => result.plan)
    setSelection(pick)
    return result.ids
  }

  // The group to add into — an existing id, or a new group made in the same step.
  function withGroup(current: SeatPlan<S>, choice: GroupChoice | undefined) {
    if (choice === undefined || typeof choice === 'string') return { plan: current, group: choice }
    const made = planEdits.addGroup(current, choice)
    return { plan: made.plan, group: made.id as string | undefined, made: made.id }
  }

  // Places on the given boxes (see `layout`) — selected afterwards, as their new group when one was made.
  function addPlaces(
    section: S,
    boxes: readonly PlanBox[],
    options: { shape?: Shape; capacity?: number; role?: string; category?: string; group?: GroupChoice } = {},
  ): string[] {
    const { plan: base, group, made } = withGroup(historyRef.current.present, options.group)
    const result = planEdits.addPlaces(base, section, boxes, { ...options, group })
    const pick: EditorSelection<S>[] = made
      ? [{ kind: 'group', id: made }]
      : (result?.ids ?? []).map((id) => ({ kind: 'object' as const, id }))
    return added(result, pick)
  }

  // Fixtures on the given boxes, under everything else — selected afterwards like `addPlaces`.
  function addFixtures(
    boxes: readonly PlanBox[],
    options: { shape?: Shape; role?: string; group?: GroupChoice } = {},
  ): string[] {
    const { plan: base, group, made } = withGroup(historyRef.current.present, options.group)
    const result = planEdits.addFixtures(base, boxes, { ...options, group })
    const pick: EditorSelection<S>[] = made
      ? [{ kind: 'group', id: made }]
      : result.ids.map((id) => ({ kind: 'object' as const, id }))
    return added(result, pick)
  }

  // Removes objects and groups; returns the ids refused because they hold a locked id.
  function removeObjects(ids: readonly string[]): string[] {
    const { plan: next, refused } = planEdits.remove(historyRef.current.present, ids, locked)
    apply(() => next)
    setSelection((current) => current.filter((item) => item.kind === 'section' || refused.includes(item.id)))
    return refused
  }

  // Changes an id — an object's or a group's. false when it is locked, taken, missing or would not save.
  function renameObject(id: string, nextId: string): boolean {
    const next = planEdits.rename(historyRef.current.present, id, nextId, locked)
    if (!next) return false
    apply(() => next)
    setSelection((current) =>
      current.map((item) => (item.kind !== 'section' && item.id === id ? { ...item, id: nextId } : item)),
    )
    return true
  }

  // Copies the selection next to itself and selects the copies.
  function duplicateSelected(): string[] {
    const current = historyRef.current.present
    const result = planEdits.duplicate(current, selectedIds)
    if (result.ids.length === 0) return []
    apply(() => result.plan)
    setSelection(
      result.ids.map((id) =>
        seatPlan.groupById(result.plan, id) ? { kind: 'group' as const, id } : { kind: 'object' as const, id },
      ),
    )
    return result.ids
  }

  // Puts the selection in a new group and selects it.
  function groupSelected(props: Omit<Group, 'id'> = {}): string | null {
    const result = planEdits.group(historyRef.current.present, selectedIds, props)
    if (!result) return null
    apply(() => result.plan)
    setSelection([{ kind: 'group', id: result.id }])
    return result.id
  }

  function ungroup(id: string) {
    const members = seatPlan.membersOf(historyRef.current.present, id).filter((o) => o.kind !== 'label')
    apply((current) => planEdits.ungroup(current, id))
    setSelection(members.map((o) => ({ kind: 'object' as const, id: o.id })))
  }

  function reset() {
    commit({ past: [], present: start.history.present, future: [] })
    setSelection([])
  }

  return {
    plan,
    displayPlan,
    dirty,
    selection,
    selectedIds,
    selectedObjects,
    selectedGroups,
    selectedSection: selectedSectionId === undefined ? undefined : seatPlan.sectionOf(plan, selectedSectionId),
    selectedPlaceIds,
    handles,
    frame,
    marquee,
    conflictIds,
    snap: grid,
    select,
    isLocked: (id: string) => planEdits.isLocked(plan, id, locked),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    reset,

    // Creating — each returns the new ids and selects what it made (an empty list when nothing could be added).
    addPlaces,
    addFixtures,
    addLabels: (groupId: string, boxes: readonly PlanBox[]) =>
      added(planEdits.addLabels(historyRef.current.present, groupId, boxes), [{ kind: 'group', id: groupId }]),
    duplicateSelected,
    groupSelected,

    // Changing.
    // Any plan → plan change as one undo step — compose `planEdits` and `layout` into a single edit (a row with
    // its labels, a table with its chairs). false when it changed nothing or returned null.
    edit: (update: (current: SeatPlan<S>) => SeatPlan<S> | null) => apply(update),
    updateObject: (id: string, update: (object: PlanObject<S>) => PlanObject<S>) =>
      apply((current) => ({ ...current, objects: current.objects.map((o) => (o.id === id ? update(o) : o)) })),
    updateGroup: (id: string, update: (group: Group) => Group) =>
      apply((current) => ({ ...current, groups: current.groups.map((g) => (g.id === id ? update(g) : g)) })),
    // Lays a group's places (or fixtures of a role) out on new boxes — how a row grows, shrinks or bends. false
    // when a member to remove is locked.
    layoutGroup: (groupId: string, boxes: readonly PlanBox[], members?: GroupMembers) =>
      apply((current) => planEdits.layoutGroup(current, groupId, boxes, members, locked)),
    arrange: (ids: readonly string[], boxes: readonly PlanBox[]) =>
      apply((current) => planEdits.arrange(current, ids, boxes)),
    convert: (
      ids: readonly string[],
      to: 'place' | 'fixture',
      options?: { section?: S; capacity?: number; role?: string },
    ) => apply((current) => planEdits.convert(current, ids, to, options, locked)),
    ungroup,
    label: (ids: readonly string[], sequence: LabelSequence) =>
      apply((current) => planEdits.label(current, ids, sequence)),
    alignSelected: (edge: AlignEdge) => apply((current) => planEdits.align(current, selectedIds, edge)),
    distributeSelected: (axis: 'x' | 'y') => apply((current) => planEdits.distribute(current, selectedIds, axis)),
    rotateSelected: (degrees: number) => apply((current) => planEdits.rotate(current, selectedIds, degrees)),
    moveSelected: (delta: PlanPoint) => apply((current) => planEdits.move(current, selectedIds, delta, grid)),
    moveSection: (id: S, delta: PlanPoint) => apply((current) => planEdits.moveSection(current, id, delta, grid)),
    reshapeSection: (id: S, points: PlanPoint[]) =>
      apply((current) => planEdits.reshapeSection(current, id, points, grid)),
    renameObject,

    // Removing — returns the ids refused because they are locked.
    removeObjects,
    removeSelected: () => removeObjects(selectedIds),

    // Spread into <SeatMap.Viewport> (ichno/react).
    viewportProps: {
      plan: displayPlan,
      onTap: handleTap,
      canDrag,
      onTargetDrag: handleDrag,
      onMarquee: handleMarquee,
    },
  }
}

// Keyboard shortcuts — Delete/Backspace removes the selection, R turns it a quarter clockwise (⇧R back),
// ⌘/Ctrl+Z undoes, ⇧⌘Z / Ctrl+Y redoes, ⌘/Ctrl+D duplicates, ⌘/Ctrl+G groups. Ignored while typing in an input,
// textarea, select or contenteditable.
export function useSeatPlanEditorShortcuts<S extends string>(editor: SeatPlanEditor<S>) {
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return
    const command = e.metaKey || e.ctrlKey
    // Physical keys — with a non-Latin input method active `e.key` is not a Latin letter.
    if (command && e.code === 'KeyZ') {
      e.preventDefault()
      if (e.shiftKey) editor.redo()
      else editor.undo()
      return
    }
    if (command && e.code === 'KeyY') {
      e.preventDefault()
      editor.redo()
      return
    }
    if (command && e.code === 'KeyD') {
      e.preventDefault()
      editor.duplicateSelected()
      return
    }
    if (command && e.code === 'KeyG') {
      e.preventDefault()
      editor.groupSelected()
      return
    }
    if (command || e.altKey) return
    if (e.code === 'KeyR') {
      editor.rotateSelected(e.shiftKey ? -90 : 90)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') editor.removeSelected()
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}

// Whether a selection already holds an item — itself, or the group of a grouped object.
function covers<S extends string>(
  plan: SeatPlan<S>,
  selection: readonly EditorSelection<S>[],
  item: EditorSelection<S>,
): boolean {
  if (selection.some((other) => sameSelection(other, item))) return true
  if (item.kind !== 'object') return false
  const group = seatPlan.objectById(plan, item.id)?.group
  return group !== undefined && selection.some((other) => other.kind === 'group' && other.id === group)
}

function sameSelection<S extends string>(a: EditorSelection<S>, b: EditorSelection<S>): boolean {
  return a.kind === b.kind && a.id === b.id
}
