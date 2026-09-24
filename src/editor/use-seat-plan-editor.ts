'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { seatPlan } from '../core/geometry'
import { seatGrid } from '../core/grid'
import type { LabelSequence } from '../core/labeling'
import type {
  AreaShape,
  PlanDrag,
  PlanObject,
  PlanPoint,
  PlanRect,
  PlanHandle,
  PlanSize,
  PlanTarget,
  SeatPlan,
  TableShape,
} from '../core/types'
import { planHandles } from './handles'
import { planEdits, type AlignEdge } from './operations'
import type { EditorSelection } from './selection'

export type SeatPlanEditor<S extends string> = ReturnType<typeof useSeatPlanEditor<S>>

type Options<S extends string> = {
  initialPlan: SeatPlan<S>
  // Ids your other records reference (booked seats, active sessions). Objects holding one cannot be removed,
  // renamed or shrunk past it; labels stay free to change.
  lockedIds?: Iterable<string>
}

type History<S extends string> = { past: SeatPlan<S>[]; present: SeatPlan<S>; future: SeatPlan<S>[]; dirty: boolean }

// Undo depth — plenty for an editing session, bounded so a long one does not hold every version.
const HISTORY_LIMIT = 100

// Headless seat plan editor — document state, selection, undo history and every edit operation; no UI. Spread
// `viewportProps` into <SeatMap.Viewport> (ichno/react) for tap-to-select, drag-to-move and marquee selection,
// draw `displayPlan` (the plan with the drag in progress) with `handles` and `marquee` on top, and build panels,
// buttons and saving yourself. Edits stay local until you
// save `plan`. The plan is grid-normalized on open, so a pre-grid plan starts dirty. To adopt a new baseline after
// saving, remount (e.g. key the component by the saved version).
export function useSeatPlanEditor<S extends string>({ initialPlan, lockedIds }: Options<S>) {
  const [start] = useState(() => {
    const present = seatGrid.normalize(initialPlan)
    const saved = JSON.stringify(initialPlan)
    return { saved, history: { past: [], present, future: [], dirty: JSON.stringify(present) !== saved } as History<S> }
  })
  const [history, setHistory] = useState<History<S>>(start.history)
  // The latest history, ahead of the render — so several calls in one handler build on each other (add a table,
  // then set its seat count) instead of each starting from the rendered plan.
  const historyRef = useRef(start.history)
  const [selection, setSelection] = useState<EditorSelection<S>[]>([])
  const [drag, setDrag] = useState<PlanDrag<S> | null>(null)
  const locked = new Set(lockedIds)

  const plan = history.present
  const dirty = history.dirty
  const selectedObjectIds = selection.flatMap((item) => (item.kind === 'object' ? [item.id] : []))
  const selectedObjects = plan.objects.filter((object) => selectedObjectIds.includes(object.id))
  const selectedSectionId = selection.find((item) => item.kind === 'section')?.id as S | undefined
  // The places of the selected objects — pass them to the renderer as selected.
  const selectedPlaceIds = seatPlan.placesOf({ objects: selectedObjects }).map((place) => place.id)
  // The plan as drawn — the drag in progress applied with the snapping it will commit with.
  const displayPlan = drag === null ? plan : planEdits.applyDrag(plan, drag, selectedObjectIds)
  // Objects in conflict on the plan as drawn — overlapping footprints and fixtures on places. The schema refuses
  // to save them; pass them to <SeatMap.Content invalid> to mark them while arranging.
  const conflicts = seatPlan.conflictsOf(displayPlan)
  const conflictIds = [
    ...new Set([...conflicts.overlaps.flat(), ...conflicts.fixtures.flatMap((c) => [c.fixtureId, c.id])]),
  ]
  // Handles for a single selected item, placed on the plan as drawn so they follow a drag.
  const handles: PlanHandle<S>[] = planHandles.of(displayPlan, selection)
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

  // Runs an operation that creates an object on the latest plan, commits it and selects the result.
  function create(run: (current: SeatPlan<S>) => { plan: SeatPlan<S>; id: string } | null): string | null {
    const result = run(historyRef.current.present)
    if (!result) return null
    apply(() => result.plan)
    setSelection([{ kind: 'object', id: result.id }])
    return result.id
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

  // Selects what a target points at — a seat selects its row or table. `additive` toggles it in the selection
  // (shift/⌘-click); otherwise it replaces the selection. null clears it.
  function select(target: PlanTarget<S> | EditorSelection<S> | null, additive?: boolean) {
    const item = target === null ? null : selectionOf(target)
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

  // Marquee selection — everything whose footprint the rubber band touches. `additive` adds to the selection.
  function handleMarquee(rect: PlanRect, info: { phase: 'start' | 'move' | 'end'; additive: boolean }) {
    if (info.phase !== 'end') {
      setMarquee(rect)
      return
    }
    setMarquee(null)
    const picked = seatPlan
      .objectsInRect(historyRef.current.present, rect)
      .map((id) => ({ kind: 'object' as const, id }))
    setSelection((current) =>
      info.additive ? [...current, ...picked.filter((item) => !current.some((c) => sameSelection(c, item)))] : picked,
    )
  }

  function handleDrag(next: PlanDrag<S>) {
    if (next.phase === 'start' && next.target.kind !== 'handle') {
      const item = selectionOf(next.target)
      // Dragging something outside the selection selects it alone; dragging a selected object moves the group.
      if (!selection.some((other) => sameSelection(other, item))) setSelection([item])
    }
    if (next.phase !== 'end') {
      setDrag(next)
      return
    }
    setDrag(null)
    apply((current) => planEdits.applyDrag(current, next, selectedObjectIds))
  }

  // Removes objects; returns the ids refused because they hold a locked id.
  function removeObjects(ids: readonly string[]): string[] {
    const { plan: next, refused } = planEdits.remove(historyRef.current.present, ids, locked)
    apply(() => next)
    setSelection((current) => current.filter((item) => item.kind !== 'object' || refused.includes(item.id)))
    return refused
  }

  // Changes an id — an object's or a seat's. false when it is locked, taken, missing or would not save.
  function renameObject(id: string, nextId: string): boolean {
    const next = planEdits.rename(historyRef.current.present, id, nextId, locked)
    if (!next) return false
    apply(() => next)
    setSelection((current) =>
      current.map((item) => (item.kind === 'object' && item.id === id ? { ...item, id: nextId } : item)),
    )
    return true
  }

  // Grows or shrinks a row or table. false when a seat to remove is locked.
  function setSeatCount(id: string, count: number): boolean {
    const next = planEdits.setSeatCount(historyRef.current.present, id, count, locked)
    if (!next) return false
    apply(() => next)
    return true
  }

  // Copies the selected objects next to themselves and selects the copies.
  function duplicateSelected(): string[] {
    const result = planEdits.duplicate(historyRef.current.present, selectedObjectIds)
    if (result.ids.length === 0) return []
    apply(() => result.plan)
    setSelection(result.ids.map((id) => ({ kind: 'object' as const, id })))
    return result.ids
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
    selectedObjects,
    selectedSection: selectedSectionId === undefined ? undefined : seatPlan.sectionOf(plan, selectedSectionId),
    selectedPlaceIds,
    handles,
    marquee,
    conflictIds,
    select,
    isLocked: (object: PlanObject<S>) => planEdits.isLocked(object, locked),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    reset,

    // Creating — each returns the new object's id and selects it (null when there is no room).
    addDesk: (section: S) => create((current) => planEdits.addDesk(current, section)),
    addFixture: (role: string, size: PlanSize) => create((current) => planEdits.addFixture(current, role, size)),
    addRow: (section: S, row: { start: PlanPoint; end: PlanPoint; seats: number; curve?: number; seatSize?: number }) =>
      create((current) => planEdits.addRow(current, section, row)),
    addTable: (
      section: S,
      table: { center: PlanPoint; seats: number; shape?: TableShape; size?: PlanSize; seatSize?: number },
    ) => create((current) => planEdits.addTable(current, section, table)),
    addBooth: (section: S, rect: PlanRect) => create((current) => planEdits.addBooth(current, section, rect)),
    addArea: (section: S, area: { rect: PlanRect; capacity: number; shape?: AreaShape }) =>
      create((current) => planEdits.addArea(current, section, area)),
    duplicateSelected,

    // Changing.
    updateObject: (id: string, update: (object: PlanObject<S>) => PlanObject<S>) =>
      apply((current) => ({ ...current, objects: current.objects.map((o) => (o.id === id ? update(o) : o)) })),
    moveObject: (id: string, to: PlanPoint) => apply((current) => planEdits.move(current, id, to)),
    moveSection: (id: S, delta: PlanPoint) => apply((current) => planEdits.moveSection(current, id, delta)),
    reshapeSection: (id: S, points: PlanPoint[]) => apply((current) => planEdits.reshapeSection(current, id, points)),
    rotateDesk: (id: string) => apply((current) => planEdits.rotateDesk(current, id)),
    setSeatCount,
    labelSeats: (id: string, sequence: LabelSequence) =>
      apply((current) => planEdits.labelSeats(current, id, sequence)),
    labelObjects: (ids: readonly string[], sequence: LabelSequence) =>
      apply((current) => planEdits.labelObjects(current, ids, sequence)),
    alignSelected: (edge: AlignEdge) => apply((current) => planEdits.align(current, selectedObjectIds, edge)),
    distributeSelected: (axis: 'x' | 'y') => apply((current) => planEdits.distribute(current, selectedObjectIds, axis)),
    renameObject,
    rotateSelected: () =>
      apply((current) => selectedObjectIds.reduce((next, id) => planEdits.rotateDesk(next, id), current)),

    // Removing — returns the ids refused because they are locked.
    removeObjects,
    removeSelected: () => removeObjects(selectedObjectIds),

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

// Keyboard shortcuts — Delete/Backspace removes the selection, R turns selected desks' chairs, ⌘/Ctrl+Z undoes,
// ⇧⌘Z / Ctrl+Y redoes, ⌘/Ctrl+D duplicates. Ignored while typing in an input, textarea, select or contenteditable.
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
    if (command || e.altKey) return
    if (e.code === 'KeyR') {
      editor.rotateSelected()
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

function selectionOf<S extends string>(target: PlanTarget<S> | EditorSelection<S>): EditorSelection<S> {
  if (target.kind === 'handle') return target.owner
  if (target.kind === 'section') return { kind: 'section', id: target.id }
  if (target.kind === 'place') return { kind: 'object', id: target.objectId }
  return { kind: 'object', id: target.id }
}

function sameSelection<S extends string>(a: EditorSelection<S>, b: EditorSelection<S>): boolean {
  return a.kind === b.kind && a.id === b.id
}
