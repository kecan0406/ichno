'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { seatPlan } from '../core/geometry'
import { GRID_CELL } from '../core/grid'
import type { LabelSequence } from '../core/labeling'
import type {
  Group,
  PlanBox,
  PlanDrag,
  PlanHandle,
  PlanObject,
  PlanPoint,
  PlanRect,
  PlanStroke,
  PlanTarget,
  PlanTemplate,
  SeatPlan,
  Shape,
} from '../core/types'
import { planHandles } from './handles'
import { planEdits, type AlignEdge, type GroupMembers, type ObjectProps, type Reorder, type Snap } from './operations'
import type { EditorSelection } from './selection'
import { strokeOf, type EditorTool } from './tools'

export type SeatPlanEditor<S extends string> = ReturnType<typeof useSeatPlanEditor<S>>

type Options<S extends string> = {
  initialPlan: SeatPlan<S>
  // Ids your other records reference (booked seats, active sessions). Objects holding one cannot be removed,
  // renamed or turned into fixtures; labels stay free to change.
  lockedIds?: Iterable<string>
  // Snap to a grid while editing — sections to cell corners, objects and strokes to half cells, turns to 15°. Off
  // by default: edits land on whole plan units.
  snap?: Snap
}

type History<S extends string> = { past: SeatPlan<S>[]; present: SeatPlan<S>; future: SeatPlan<S>[]; dirty: boolean }

// A new group made while adding — its props, or the id of one that exists.
type GroupChoice = string | Omit<Group, 'id'>

// What the viewport reports about a stroke besides where it runs.
type DrawInfo = { phase: 'start' | 'move' | 'end' | 'cancel'; constrain: boolean; fromCenter: boolean }

// What was copied, where it came from, and how many times it was pasted next to it.
type Clip = { template: PlanTemplate; at: PlanPoint; pastes: number }

// The press under way — a stroke, a drag or a marquee — and whether Escape dropped it before it was let go.
type Press = { kind: 'stroke' | 'drag' | 'marquee'; cancelled: boolean }

// Undo depth — plenty for an editing session, bounded so a long one does not hold every version.
const HISTORY_LIMIT = 100
// How far each paste lands from what was copied when the pointer is not over the plan — two cells, like duplicate.
const PASTE_STEP = GRID_CELL * 2
const NO_KEYS = {}
const NO_FRAMES: PlanPoint[][] = []

// Headless seat plan editor — document state, selection, creation tools, clipboard, undo history and every edit
// operation; no UI. Spread `viewportProps` into <SeatMap.Viewport> (ichno/react) for tap-to-select, drag-to-move,
// marquee selection and drawing with a tool; draw `displayPlan` (the plan with the drag in progress), `draft` (what
// the tool would make), `handles`, `frames` and `marquee` on top, and build panels, buttons and saving yourself.
// Edits stay local until you save `plan`; `markSaved` then makes what you saved the baseline `dirty` compares
// against. To open another document, remount (e.g. key the component by its id).
//
// Tapping an object in a group selects the group; tapping it again (with the group selected) selects the object
// alone. Operations that take ids accept object and group ids alike — a group acts as one.
export function useSeatPlanEditor<S extends string>({ initialPlan, lockedIds, snap }: Options<S>) {
  const [start] = useState(() => ({
    saved: { plan: initialPlan, json: JSON.stringify(initialPlan) },
    history: { past: [], present: initialPlan, future: [], dirty: false } as History<S>,
  }))
  const [history, setHistory] = useState<History<S>>(start.history)
  // What `dirty` compares against and `reset` goes back to — the plan as opened, or as last saved (`markSaved`).
  const savedRef = useRef(start.saved)
  // The latest history, ahead of the render — so several calls in one handler build on each other (add a group,
  // then lay it out) instead of each starting from the rendered plan.
  const historyRef = useRef(start.history)
  const [chosen, setChosen] = useState<EditorSelection<S>[]>([])
  const [drag, setDrag] = useState<PlanDrag<S> | null>(null)
  // The creation tool in use — null while selecting.
  const [tool, setToolState] = useState<EditorTool<S> | null>(null)
  // The stroke being drawn with it, snapped and constrained.
  const [stroke, setStroke] = useState<PlanStroke | null>(null)
  const pressRef = useRef<Press | null>(null)
  // Where a tap would draw while a tool is active (snapped) — the tool previews there.
  const [pointer, setPointer] = useState<PlanPoint | null>(null)
  // The plan point under the pointer, whatever the tool — pasting lands there. Null when it is off the plan.
  const pointerRef = useRef<PlanPoint | null>(null)
  // What a tap would select under the pointer.
  const [hovered, setHovered] = useState<EditorSelection<S> | null>(null)
  const [clipboard, setClipboard] = useState<Clip | null>(null)
  const locked = new Set(lockedIds)
  const grid = snap ?? null

  const plan = history.present
  const dirty = history.dirty
  // What is selected and still in the plan — an undo, a redo or an edit may have taken some of it away.
  const inPlan = new Set(seatPlan.idsOf(plan))
  const selection = chosen.filter((item) =>
    item.kind === 'section' ? seatPlan.sectionOf(plan, item.id) !== undefined : inPlan.has(item.id),
  )
  // Selected objects and groups by id — what the operations take.
  const selectedIds = selection.flatMap((item) => (item.kind === 'section' ? [] : [item.id]))
  const selectedSectionIds = selection.flatMap((item) => (item.kind === 'section' ? [item.id] : []))
  // What the selected ids stand for — groups by their members — in one pass, however much is selected.
  const selectedIdSet = new Set(selectedIds)
  const selectedObjects = plan.objects.filter(
    (object) => selectedIdSet.has(object.id) || (object.group !== undefined && selectedIdSet.has(object.group)),
  )
  const selectedGroups = selection.flatMap((item) =>
    item.kind === 'group' ? (seatPlan.groupById(plan, item.id) ?? []) : [],
  )
  // The places of the selection — pass them to the renderer as selected.
  const selectedPlaceIds = selectedObjects.flatMap((object) => (object.kind === 'place' ? [object.id] : []))
  // What the selection covers — objects by their turned bounds, sections by their outline's box. Frame it with a
  // view's zoomTo (useSeatMapView, ichno/react).
  const selectionBounds: PlanRect[] = [
    ...selectedObjects.map(seatPlan.boundsOf),
    ...selectedSectionIds.flatMap((id) => {
      const section = seatPlan.sectionOf(plan, id)
      return section ? [seatPlan.sectionBoundsOf(section)] : []
    }),
  ]
  // The plan as drawn — the drag in progress applied with the snapping it will commit with.
  const displayPlan = drag === null ? plan : planEdits.applyDrag(plan, drag, selectedIds, grid)
  // What the tool would make — while a stroke is drawn, or for a tap under the pointer — and the plan with it.
  const toolStroke = tool === null ? null : (stroke ?? (pointer === null ? null : { start: pointer, end: pointer }))
  const created = tool === null || toolStroke === null ? null : tool.create(plan, toolStroke)
  // Only the new objects (and the groups they belong to), as a plan without sections — draw it over the plan,
  // e.g. half transparent. null when the tool would make nothing there.
  const draft = created === null ? null : addedPart(plan, created)
  // Places that overlap on the plan as drawn, the draft included. The schema refuses to save them; pass them to
  // <SeatMap.Content invalid> to mark them while arranging.
  const conflictIds = [...new Set(seatPlan.conflictsOf(created ?? displayPlan).flat())]
  // Handles for a single selected item, placed on the plan as drawn so they follow a drag. None while a tool is
  // active — every press draws then.
  const handles: PlanHandle<S>[] = tool === null ? planHandles.of(displayPlan, selection) : []
  // The outline those handles belong to — pass it to <SeatMap.Handles frame>.
  const frame = tool === null ? planHandles.frame(displayPlan, selection) : null
  // The outline of every selected object and group — draw them (<SeatMap.Outline>) when more than one item is
  // selected, so fixtures and groups show they are in the selection too.
  const frames = planHandles.frames(displayPlan, selection)
  // The outline of what a tap would select under the pointer — none while dragging, drawing, or over the selection.
  const hoverFrame =
    tool === null && drag === null && hovered !== null && !selection.some((item) => sameSelection(item, hovered))
      ? planHandles.frame(displayPlan, [hovered])
      : null
  // The rubber band being dragged, in plan units — draw it with <SeatMap.Marquee>.
  const [marquee, setMarquee] = useState<PlanRect | null>(null)

  function commit(next: Omit<History<S>, 'dirty'>) {
    const full = { ...next, dirty: JSON.stringify(next.present) !== savedRef.current.json }
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
      setChosen(item ? [item] : [])
      return
    }
    if (!item) return
    setChosen((current) =>
      current.some((other) => sameSelection(other, item))
        ? current.filter((other) => !sameSelection(other, item))
        : [...current, item],
    )
  }

  // Selects every object — grouped ones as their group.
  function selectAll() {
    setChosen(unitsOf(historyRef.current.present.objects))
  }

  // Selects exactly these items — what a layers panel or a list of problems points at, where a tap would pick a
  // grouped object's group first. An object whose group is among them is left to the group.
  function setSelection(items: readonly EditorSelection<S>[]) {
    const current = historyRef.current.present
    const groups = new Set(items.flatMap((item) => (item.kind === 'group' ? [item.id] : [])))
    const seen = new Set<string>()
    setChosen(
      items.filter((item) => {
        if (seen.has(keyOf(item))) return false
        seen.add(keyOf(item))
        const group = item.kind === 'object' ? seatPlan.objectById(current, item.id)?.group : undefined
        return group === undefined || !groups.has(group)
      }),
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

  // Follows a press through its phases — true while its events should be acted on, false once Escape dropped it
  // (until it is let go).
  function pressing(kind: Press['kind'], phase: 'start' | 'move' | 'end'): boolean {
    if (phase === 'start') pressRef.current = { kind, cancelled: false }
    const press = pressRef.current
    if (phase === 'end') pressRef.current = null
    return press === null || !press.cancelled
  }

  // Marquee selection — everything whose shape the rubber band touches, grouped objects as their group.
  // `additive` adds to the selection.
  function handleMarquee(rect: PlanRect, info: { phase: 'start' | 'move' | 'end'; additive: boolean }) {
    if (!pressing('marquee', info.phase)) return
    if (info.phase !== 'end') {
      setMarquee(rect)
      return
    }
    setMarquee(null)
    const current = historyRef.current.present
    const inside = new Set(seatPlan.objectsInRect(current, rect))
    const picked = unitsOf(current.objects.filter((object) => inside.has(object.id)))
    setChosen((existing) => {
      if (!info.additive) return picked
      const held = new Set(existing.map(keyOf))
      return [...existing, ...picked.filter((item) => !held.has(keyOf(item)))]
    })
  }

  function handleDrag(next: PlanDrag<S>) {
    if (!pressing('drag', next.phase)) return
    if (next.phase === 'start' && next.target.kind !== 'handle') {
      const item = selectionOf(next.target, selection)
      // Dragging something outside the selection selects it alone; dragging a selected object moves the group.
      if (!covers(historyRef.current.present, selection, item)) setChosen([item])
    }
    if (next.phase !== 'end') {
      setDrag(next)
      return
    }
    setDrag(null)
    apply((current) => planEdits.applyDrag(current, next, selectedIds, grid))
  }

  // The pointer over the plan — the tool previews a tap there; otherwise it outlines what a tap would select.
  function handleHover(point: PlanPoint | null, target: PlanTarget<S> | null) {
    pointerRef.current = point
    if (tool !== null) {
      const at = point === null ? null : strokeOf('point', point, point, NO_KEYS, grid).end
      setPointer((current) => (samePoint(current, at) ? current : at))
      return
    }
    const item =
      target === null || target.kind === 'handle' || target.kind === 'section' ? null : selectionOf(target, selection)
    setHovered((current) => (current === item || (current && item && sameSelection(current, item)) ? current : item))
  }

  // A stroke drawn with the tool — previewed while it moves, made when it is let go (a tap makes one too).
  function handleDraw(raw: PlanStroke, info: DrawInfo) {
    if (tool === null) return
    if (info.phase === 'cancel') {
      pressRef.current = null
      setStroke(null)
      return
    }
    // A tap is a stroke with no `start` — only its end is reported.
    if (!pressing('stroke', info.phase)) return
    const shaped = strokeOf(tool.draw, raw.start, raw.end, info, grid)
    if (info.phase !== 'end') {
      setStroke(shaped)
      return
    }
    setStroke(null)
    // The pointer is still where the tap was — no preview of the next one on top of what was just made.
    setPointer(null)
    const before = historyRef.current.present
    const next = tool.create(before, shaped)
    if (next === null || !apply(() => next)) return
    setChosen(addedSelection(before, next))
    if (!tool.keep) setToolState(null)
  }

  // Picks a creation tool, or goes back to selecting with null. A stroke being drawn is dropped — with another tool
  // its end is ignored when it comes; with none, it never comes (the viewport stops drawing).
  function setTool(next: EditorTool<S> | null) {
    const press = pressRef.current
    if (press?.kind === 'stroke') pressRef.current = next === null ? null : { ...press, cancelled: true }
    setStroke(null)
    setToolState(next)
    setHovered(null)
    const point = pointerRef.current
    setPointer(next === null || point === null ? null : strokeOf('point', point, point, NO_KEYS, grid).end)
  }

  // Drops the press under way (Escape) — a stroke makes nothing, a drag puts back what it moved, a marquee selects
  // nothing; letting go then changes nothing. false when nothing was under way.
  function cancel(): boolean {
    const press = pressRef.current
    if (press === null || press.cancelled) return false
    pressRef.current = { ...press, cancelled: true }
    setStroke(null)
    setDrag(null)
    setMarquee(null)
    return true
  }

  // Runs an operation that adds objects, commits it and selects what it made.
  function added(result: { plan: SeatPlan<S>; ids: string[] } | null, pick: EditorSelection<S>[]): string[] {
    if (!result || result.ids.length === 0) return []
    apply(() => result.plan)
    setChosen(pick)
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

  // Adds a template centred on `at` (see `planEdits.insertTemplate`) and selects what it made. Returns the new ids.
  function insert(template: PlanTemplate, at: PlanPoint, options: { section?: S } = {}): string[] {
    const before = historyRef.current.present
    const result = planEdits.insertTemplate(before, template, at, options)
    if (!result || !apply(() => result.plan)) return []
    setChosen(addedSelection(before, result.plan))
    return result.ids
  }

  // Removes objects and groups; returns the ids refused because they hold a locked id.
  function removeObjects(ids: readonly string[]): string[] {
    const { plan: next, refused } = planEdits.remove(historyRef.current.present, ids, locked)
    apply(() => next)
    setChosen((current) => current.filter((item) => item.kind === 'section' || refused.includes(item.id)))
    return refused
  }

  // Changes an id — an object's or a group's. false when it is locked, taken, missing or would not save.
  function renameObject(id: string, nextId: string): boolean {
    const next = planEdits.rename(historyRef.current.present, id, nextId, locked)
    if (!next) return false
    apply(() => next)
    setChosen((current) =>
      current.map((item) => (item.kind !== 'section' && item.id === id ? { ...item, id: nextId } : item)),
    )
    return true
  }

  // Copies the selection to the editor's clipboard, as a template. null when nothing is selected.
  function copySelected(): PlanTemplate | null {
    const made = planEdits.templateOf(historyRef.current.present, selectedIds)
    if (!made) return null
    setClipboard({ template: made.template, at: made.at, pastes: 0 })
    return made.template
  }

  // Copies the selection, then removes it. Returns the ids refused because they are locked — those stay.
  function cutSelected(): string[] {
    if (copySelected() === null) return []
    return removeObjects(selectedIds)
  }

  // Pastes the clipboard centred on `at` — by default under the pointer when it is over the plan, otherwise beside
  // what was copied (a step further each time). Returns the new ids and selects them.
  function paste(at?: PlanPoint): string[] {
    if (clipboard === null) return []
    const step = PASTE_STEP * (clipboard.pastes + 1)
    const pointed = pointerRef.current
    const target =
      at ??
      (pointed === null
        ? { x: clipboard.at.x + step, y: clipboard.at.y + step }
        : strokeOf('point', pointed, pointed, NO_KEYS, grid).end)
    const ids = insert(clipboard.template, target)
    if (ids.length > 0 && at === undefined && pointed === null)
      setClipboard({ ...clipboard, pastes: clipboard.pastes + 1 })
    return ids
  }

  // Copies the selection next to itself and selects the copies.
  function duplicateSelected(): string[] {
    const current = historyRef.current.present
    const result = planEdits.duplicate(current, selectedIds)
    if (result.ids.length === 0) return []
    apply(() => result.plan)
    setChosen(
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
    setChosen([{ kind: 'group', id: result.id }])
    return result.id
  }

  function ungroup(id: string) {
    const members = seatPlan.membersOf(historyRef.current.present, id).filter((o) => o.kind !== 'label')
    apply((current) => planEdits.ungroup(current, id))
    setChosen(members.map((o) => ({ kind: 'object' as const, id: o.id })))
  }

  // Dissolves every selected group in one step; their members take their place in the selection.
  function ungroupSelected() {
    const groups = selection.flatMap((item) => (item.kind === 'group' ? [item.id] : []))
    if (groups.length === 0) return
    const current = historyRef.current.present
    const members = groups.flatMap((id) => seatPlan.membersOf(current, id).filter((o) => o.kind !== 'label'))
    apply((plan) => groups.reduce((next, id) => planEdits.ungroup(next, id), plan))
    setChosen([
      ...selection.filter((item) => item.kind !== 'group'),
      ...members.map((o) => ({ kind: 'object' as const, id: o.id })),
    ])
  }

  // Back to the plan as opened, or as last saved — without history.
  function reset() {
    commit({ past: [], present: savedRef.current.plan, future: [] })
    setChosen([])
  }

  // Makes `saved` — the plan you stored, by default the one being edited — the baseline `dirty` compares against and
  // `reset` goes back to. History and selection stay; edits made while a save was under way stay dirty.
  function markSaved(saved?: SeatPlan<S>) {
    const h = historyRef.current
    const plan = saved ?? h.present
    savedRef.current = { plan, json: JSON.stringify(plan) }
    commit({ past: h.past, present: h.present, future: h.future })
  }

  return {
    plan,
    displayPlan,
    dirty,
    selection,
    selectedIds,
    selectedObjects,
    selectedGroups,
    selectedSection: selectedSectionIds[0] === undefined ? undefined : seatPlan.sectionOf(plan, selectedSectionIds[0]),
    selectedPlaceIds,
    selectionBounds,
    handles,
    frame,
    frames,
    hoverFrame,
    marquee,
    conflictIds,
    snap: grid,
    select,
    selectAll,
    setSelection,
    isLocked: (id: string) => planEdits.isLocked(plan, id, locked),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    reset,
    markSaved,

    // Creation tools — pick one with `setTool`; presses on the plan then draw with it (see `EditorTool`).
    tool,
    setTool,
    // The stroke being drawn, snapped and constrained — draw it as a guide if you like. null between strokes.
    stroke,
    draft,
    // Where a tap would draw while a tool is active, or null when the pointer is off the plan. With `draft` null
    // it says the tool can make nothing there — tell people why.
    pointer,
    // Drops the stroke, drag or marquee under way (Escape); false when there is none.
    cancel,

    // Creating — each returns the new ids and selects what it made (an empty list when nothing could be added).
    addPlaces,
    addFixtures,
    addLabels: (groupId: string, boxes: readonly PlanBox[]) =>
      added(planEdits.addLabels(historyRef.current.present, groupId, boxes), [{ kind: 'group', id: groupId }]),
    insert,
    duplicateSelected,
    groupSelected,

    // The clipboard — a template of what was copied (save it to a library of objects if you like), or null.
    clipboard: clipboard === null ? null : clipboard.template,
    copySelected,
    cutSelected,
    paste,

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
    ungroupSelected,
    label: (ids: readonly string[], sequence: LabelSequence) =>
      apply((current) => planEdits.label(current, ids, sequence)),
    // Sets shape, capacity, role, category or tags on objects and groups' members in one step (undefined clears an
    // optional one). false when it changed nothing or a value would not save (see `planEdits.assign`).
    assign: (ids: readonly string[], props: ObjectProps) => apply((current) => planEdits.assign(current, ids, props)),
    assignSelected: (props: ObjectProps) => apply((current) => planEdits.assign(current, selectedIds, props)),
    alignSelected: (edge: AlignEdge) => apply((current) => planEdits.align(current, selectedIds, edge)),
    distributeSelected: (axis: 'x' | 'y') => apply((current) => planEdits.distribute(current, selectedIds, axis)),
    rotateSelected: (degrees: number) => apply((current) => planEdits.rotate(current, selectedIds, degrees)),
    // Moves the selection in the drawing order — to the front or back, or a step forward or backward.
    reorderSelected: (to: Reorder) => apply((current) => planEdits.reorder(current, selectedIds, to)),
    // Moves the selection — objects, groups and sections — by `delta`, snapped like a drag.
    moveSelected: (delta: PlanPoint) =>
      apply((current) =>
        selectedSectionIds.reduce(
          (next, id) => planEdits.moveSection(next, id, delta, grid),
          planEdits.move(current, selectedIds, delta, grid),
        ),
      ),
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
      onHover: handleHover,
      onDraw: tool === null ? undefined : handleDraw,
      // With something selected the arrow keys move it (useSeatPlanEditorShortcuts); otherwise they move the focus.
      navigable: selection.length === 0 && tool === null,
    },

    // Spread into <SeatMap.EditorOverlay> (ichno/react), drawn over the plan: the outlines of a selection of several
    // items (a single one shows its frame with the handles), what a tap would select, the handles, the marquee, and
    // the stroke a tool is drawing.
    overlayProps: {
      frames: selection.length > 1 ? frames : NO_FRAMES,
      hoverFrame,
      handles,
      frame,
      marquee,
      stroke,
      draw: tool?.draw,
    },
  }
}

// The view controls the zoom keys drive — what useSeatMapView (ichno/react) returns, or your own.
export type ViewControls = {
  zoomIn(): void
  zoomOut(): void
  fit(): void
  zoomTo(rects: readonly PlanRect[]): boolean
}

// Keyboard shortcuts — Delete/Backspace removes the selection; the arrow keys move it (Shift: ten units, or a
// whole cell when snapping); R turns it a quarter clockwise (⇧R back); Escape drops the stroke, drag or marquee
// under way, then the tool, then the selection; ⌘/Ctrl+A selects everything; ⌘C, ⌘X and ⌘V copy, cut and paste
// (under the pointer when it is over the plan); ⌘D duplicates; ⌘G groups and ⇧⌘G ungroups; ⌘] and ⌘[ move the
// selection a step forward or backward in the drawing order, ⌥⌘] and ⌥⌘[ to the front or back; Enter selects the
// members of the selected groups and ⇧Enter the groups of the selected objects; ⌘Z undoes and ⇧⌘Z / Ctrl+Y redo.
// Given the `view`, + and − zoom, ⇧1 shows the whole plan and ⇧2 the selection. Ignored while typing in an input,
// textarea, select or contenteditable, for Enter on a control that answers it (a button, a link, a menu item), and
// for keys a handler already took (`preventDefault`).
export function useSeatPlanEditorShortcuts<S extends string>(
  editor: SeatPlanEditor<S>,
  options: { view?: ViewControls } = {},
) {
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented) return
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
    // With nothing selected ⌘[ and ⌘] stay the browser's (back and forward).
    if (command && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
      if (editor.selectedIds.length === 0) return
      e.preventDefault()
      const up = e.code === 'BracketRight'
      editor.reorderSelected(e.altKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward')
      return
    }
    if (command && e.code === 'KeyG') {
      e.preventDefault()
      if (e.shiftKey) editor.ungroupSelected()
      else editor.groupSelected()
      return
    }
    if (command && e.code === 'KeyA') {
      e.preventDefault()
      editor.selectAll()
      return
    }
    // Text the page has selected is the browser's to copy.
    if (command && (e.code === 'KeyC' || e.code === 'KeyX')) {
      if (editor.selectedIds.length === 0 || hasTextSelection()) return
      e.preventDefault()
      if (e.code === 'KeyC') editor.copySelected()
      else editor.cutSelected()
      return
    }
    if (command && e.code === 'KeyV') {
      if (editor.clipboard === null) return
      e.preventDefault()
      editor.paste()
      return
    }
    if (command || e.altKey) return
    const view = options.view
    const zoom = view ? zoomOf(e) : null
    if (view && zoom) {
      e.preventDefault()
      if (zoom === 'fit') view.fit()
      else if (zoom === 'selection') view.zoomTo(editor.selectionBounds)
      else if (zoom === 'in') view.zoomIn()
      else view.zoomOut()
      return
    }
    if (e.key === 'Escape') {
      if (editor.cancel()) return
      if (editor.tool !== null) editor.setTool(null)
      else if (editor.selection.length > 0) editor.select(null)
      return
    }
    if (e.key === 'Enter' && !answersEnter(e.target)) {
      const next = e.shiftKey ? groupsOf(editor) : membersOf(editor)
      if (next === null) return
      e.preventDefault()
      editor.setSelection(next)
      return
    }
    const arrow = ARROWS[e.key]
    if (arrow) {
      if (editor.selection.length === 0) return
      e.preventDefault()
      const step = editor.snap ? (e.shiftKey ? editor.snap.cell : editor.snap.cell / 2) : e.shiftKey ? 10 : 1
      editor.moveSelected({ x: arrow.x * step, y: arrow.y * step })
      return
    }
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

const ARROWS: Partial<Record<string, PlanPoint>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

// The zoom a key asks for — ⇧1 and ⇧2 by the physical key, since what Shift makes of a digit depends on the keyboard.
function zoomOf(e: KeyboardEvent): 'fit' | 'selection' | 'in' | 'out' | null {
  if (e.shiftKey && e.code === 'Digit1') return 'fit'
  if (e.shiftKey && e.code === 'Digit2') return 'selection'
  if (e.key === '+' || e.key === '=') return 'in'
  if (e.key === '-' || e.key === '_') return 'out'
  return null
}

// Whether a range of page text is selected — ⌘C then copies it, not the plan's selection.
function hasTextSelection(): boolean {
  const selected = window.getSelection()
  return selected !== null && !selected.isCollapsed && selected.toString().length > 0
}

// Controls that answer Enter themselves — a button presses, a link follows, a menu item picks.
const ENTER_CONTROLS =
  'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="treeitem"], [role="checkbox"], [role="radio"], [role="switch"]'

function answersEnter(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ENTER_CONTROLS) !== null
}

// The selection with each selected group swapped for its members — null when no group is selected.
function membersOf<S extends string>(editor: SeatPlanEditor<S>): EditorSelection<S>[] | null {
  if (!editor.selection.some((item) => item.kind === 'group')) return null
  return editor.selection.flatMap((item) =>
    item.kind === 'group'
      ? seatPlan.membersOf(editor.plan, item.id).map((o) => ({ kind: 'object' as const, id: o.id }))
      : [item],
  )
}

// The selection with each grouped object swapped for its group — null when no selected object is in one.
function groupsOf<S extends string>(editor: SeatPlanEditor<S>): EditorSelection<S>[] | null {
  const groupOf = (item: EditorSelection<S>) =>
    item.kind === 'object' ? seatPlan.objectById(editor.plan, item.id)?.group : undefined
  if (!editor.selection.some((item) => groupOf(item) !== undefined)) return null
  return editor.selection.map((item) => {
    const group = groupOf(item)
    return group === undefined ? item : { kind: 'group' as const, id: group }
  })
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

// The selection that holds these objects — each on its own, or its group once.
function unitsOf<S extends string>(objects: readonly PlanObject<S>[]): EditorSelection<S>[] {
  const seen = new Set<string>()
  const units: EditorSelection<S>[] = []
  for (const object of objects) {
    const item: EditorSelection<S> =
      object.group === undefined ? { kind: 'object', id: object.id } : { kind: 'group', id: object.group }
    if (seen.has(keyOf(item))) continue
    seen.add(keyOf(item))
    units.push(item)
  }
  return units
}

function keyOf(item: EditorSelection<string>): string {
  return `${item.kind}:${item.id}`
}

function sameSelection<S extends string>(a: EditorSelection<S>, b: EditorSelection<S>): boolean {
  return a.kind === b.kind && a.id === b.id
}

function samePoint(a: PlanPoint | null, b: PlanPoint | null): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y)
}

// What `after` adds to `before` — its new objects and the groups they belong to, as a plan with no sections.
function addedPart<S extends string>(before: SeatPlan<S>, after: SeatPlan<S>): SeatPlan<S> {
  const known = new Set(seatPlan.idsOf(before))
  const objects = after.objects.filter((o) => !known.has(o.id))
  const groups = new Set(objects.flatMap((o) => (o.group === undefined ? [] : [o.group])))
  return { ...after, sections: [], groups: after.groups.filter((g) => groups.has(g.id)), objects }
}

// The selection of what `after` adds to `before` — new groups as groups, new objects outside them one by one.
function addedSelection<S extends string>(before: SeatPlan<S>, after: SeatPlan<S>): EditorSelection<S>[] {
  const known = new Set(seatPlan.idsOf(before))
  const groups = after.groups.filter((g) => !known.has(g.id)).map((g) => g.id)
  const fresh = new Set(groups)
  return [
    ...groups.map((id) => ({ kind: 'group' as const, id })),
    ...after.objects.flatMap((o) =>
      known.has(o.id) || o.kind === 'label' || (o.group !== undefined && fresh.has(o.group))
        ? []
        : [{ kind: 'object' as const, id: o.id }],
    ),
  ]
}
