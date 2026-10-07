'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { seatPlan } from '../core/geometry'
import { GRID_CELL } from '../core/grid'
import { unionBounds } from '../core/math'
import type { LabelSequence } from '../core/labeling'
import type {
  Group,
  PlanBox,
  PlanDrag,
  PlanGuide,
  PlanHandle,
  PlanObject,
  PlanPoint,
  PlanRect,
  PlanStroke,
  PlanTarget,
  PlanTemplate,
  SeatPlan,
  Section,
  Shape,
} from '../core/types'
import { planGuides } from './guides'
import { alongAxis, planHandles, type EditorHandles } from './handles'
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
  // Objects and groups that stay put while the rest is edited (a stage, the walls) — a layers panel's lock. They
  // are drawn but cannot be tapped, dragged, hovered, marqueed or selected with ⌘A; a drag that starts on one draws
  // a marquee. `setSelection` and `selectIds` still pick them, for a panel. Editor state, never in the document.
  frozenIds?: Iterable<string>
  // Objects and groups left out of what the editor draws (`displayPlan`, and the viewport's plan) — a layers
  // panel's eye. Like frozen ones they cannot be picked on the plan; the saved `plan` keeps them, and `conflictIds`
  // still counts them.
  hiddenIds?: Iterable<string>
  // Handles of your own — shown beside ichno's on the one selected item they are for (see `EditorHandles`).
  handles?: readonly EditorHandles<S>[]
  // Smart guides: a move snaps to the edges and centre lines of what stands around it and to the spacing between its
  // neighbours, a corner and a tool's stroke to those lines — within 6 screen pixels, ahead of the grid. ⌘ or Ctrl
  // held lets go. `overlayProps.guides` are the guides to draw. Off by default.
  guides?: boolean
}

type History<S extends string> = { past: SeatPlan<S>[]; present: SeatPlan<S>; future: SeatPlan<S>[]; dirty: boolean }

// A new group made while adding — its props, or the id of one that exists.
type GroupChoice = string | Omit<Group, 'id'>

// A plan → plan change (null: nothing to change) — what `edit` commits and `preview` shows.
type Edit<S extends string> = (current: SeatPlan<S>) => SeatPlan<S> | null

// What the viewport reports about a stroke besides where it runs.
type DrawInfo = {
  phase: 'start' | 'move' | 'end' | 'cancel'
  constrain: boolean
  fromCenter: boolean
  free?: boolean
  pixel?: number
}

// What was copied, where it came from, and how many times it was pasted next to it.
type Clip = { template: PlanTemplate; at: PlanPoint; pastes: number }

// The press under way — a stroke, a drag or a marquee — and whether Escape dropped it before it was let go.
type Press = { kind: 'stroke' | 'drag' | 'marquee'; cancelled: boolean }

// How close (screen pixels) a tap comes to a polygon's first or last corner to close it — a little past the marker
// on the first one.
const CLOSE_PX = 10
// Undo depth — plenty for an editing session, bounded so a long one does not hold every version.
const HISTORY_LIMIT = 100
// How far each paste lands from what was copied when the pointer is not over the plan — two cells, like duplicate.
const PASTE_STEP = GRID_CELL * 2
const NO_KEYS = {}
const NO_FRAMES: PlanPoint[][] = []
const NO_HANDLE_SETS: readonly EditorHandles<never>[] = []
const NO_GUIDES: PlanGuide[] = []
const NONE: ReadonlySet<string> = new Set()
// How close (screen pixels) a move, a corner or a stroke comes to a guide to snap to it.
const GUIDE_PX = 6

// Headless seat plan editor — document state, selection, creation tools, clipboard, undo history and every edit
// operation; no UI. Spread `viewportProps` into <SeatMap.Viewport> (ichno/react) for tap-to-select, drag-to-move,
// marquee selection and drawing with a tool; draw `displayPlan` (the plan with the drag in progress), `draft` (what
// the tool would make), `handles`, `frames` and `marquee` on top, and build panels, buttons and saving yourself.
// Edits stay local until you save `plan`; `markSaved` then makes what you saved the baseline `dirty` compares
// against. To open another document, remount (e.g. key the component by its id).
//
// Tapping an object in a group selects the group; tapping it again (with the group selected) selects the object
// alone. Operations that take ids accept object and group ids alike — a group acts as one.
export function useSeatPlanEditor<S extends string>({
  initialPlan,
  lockedIds,
  snap,
  frozenIds,
  hiddenIds,
  handles: handleSets = NO_HANDLE_SETS,
  guides = false,
}: Options<S>) {
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
  // The corners of a polygon being drawn with a `polygon` tool — null between polygons. Kept ahead of the render
  // too, so taps in quick succession build on each other.
  const [corners, setCornersState] = useState<PlanPoint[] | null>(null)
  const cornersRef = useRef<PlanPoint[] | null>(null)
  // The plan point under the pointer, whatever the tool — pasting lands there. Null when it is off the plan.
  const pointerRef = useRef<PlanPoint | null>(null)
  // What a tap would select under the pointer.
  const [hovered, setHovered] = useState<EditorSelection<S> | null>(null)
  const [clipboard, setClipboard] = useState<Clip | null>(null)
  // The last duplicate — where what it copied stood and the copies' ids — so duplicating the copies repeats the step.
  const duplicateRef = useRef<{ from: PlanPoint; ids: string[] } | null>(null)
  // An edit shown but not committed (`preview`) — applied to the plan as it is, so undo and edits made meanwhile
  // show through it.
  const [previewing, setPreviewing] = useState<Edit<S> | null>(null)
  const locked = new Set(lockedIds)
  const hidden = new Set(hiddenIds)
  // What cannot be picked on the plan — frozen or hidden, itself or as part of its group.
  const unpickable = new Set([...(frozenIds ?? []), ...hidden])
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
  // The plan as drawn — the edit being previewed, the drag in progress with the snapping it will commit with, and
  // without what is hidden.
  const shown = previewing === null ? plan : (previewing(plan) ?? plan)
  // What a drag, a corner or a tool's stroke lines up with (`guides`) — every unit and section in sight but what the
  // press moves. Gathered once a drag starts or a tool is picked, not on every move.
  const guideTargets =
    guides && (drag !== null || tool !== null)
      ? planGuides.targetsOf(
          hidden.size === 0 ? shown : withoutHidden(shown, hidden),
          movingOf(shown, drag?.target ?? null),
        )
      : null
  const dragResult = drag === null ? null : dragged(shown, drag)
  const moved = dragResult?.plan ?? shown
  const displayPlan = hidden.size === 0 ? moved : withoutHidden(moved, hidden)
  // What the tool would make — while a stroke is drawn, or for a tap under the pointer — and the plan with it.
  const toolStroke =
    tool === null
      ? null
      : tool.draw === 'polygon'
        ? polygonStroke(corners, pointer)
        : (stroke ?? (pointer === null ? null : { start: pointer, end: pointer }))
  const created = tool === null || toolStroke === null ? null : tool.create(plan, toolStroke)
  // Only the new objects (and the groups they belong to), as a plan without sections — draw it over the plan,
  // e.g. half transparent. null when the tool would make nothing there.
  const draft = created === null ? null : addedPart(plan, created)
  // The guides through where a tool would draw — what the pointer or the stroke's end lines up with.
  const strokeEnd = tool === null ? null : (toolStroke?.end ?? null)
  const strokeGuides =
    guideTargets !== null && strokeEnd !== null ? planGuides.snapPoint(strokeEnd, guideTargets, 0).guides : NO_GUIDES
  // Places that overlap on the plan as drawn, the draft included. The schema refuses to save them; pass them to
  // <SeatMap.Content invalid> to mark them while arranging.
  const conflictIds = [...new Set(seatPlan.conflictsOf(created ?? moved).flat())]
  // Handles for a single selected item, placed on the plan as drawn so they follow a drag. None while a tool is
  // active — every press draws then.
  // While the selection's knob turns several items, the box and the knob turn with the pointer rather than being
  // drawn round what they turned.
  const turning =
    drag !== null && drag.target.kind === 'handle' && drag.target.owner.kind === 'selection'
      ? planHandles.selectionTurn(shown, selection, drag.total, grid !== null || drag.constrain === true)
      : null
  const handles: PlanHandle<S>[] =
    tool === null
      ? [
          ...planHandles.of(turning === null ? displayPlan : shown, selection, turning ?? 0),
          ...ownHandlesOf(displayPlan, selection),
        ]
      : []
  // The outline those handles belong to (the box around several items) — pass it to <SeatMap.Handles frame>.
  const frame =
    tool === null ? planHandles.frame(turning === null ? displayPlan : shown, selection, turning ?? 0) : null
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

  // Your handles for the one selected item, named `<set>:<name>`.
  function ownHandlesOf(current: SeatPlan<S>, items: readonly EditorSelection<S>[]): PlanHandle<S>[] {
    const [item] = items
    if (items.length !== 1 || item === undefined) return []
    return handleSets.flatMap((set) =>
      set.of(current, item).map((handle) => ({ ...handle, owner: item, name: `${set.id}:${handle.name}` })),
    )
  }

  // What a press moves, for guides to leave out — the selection or what it is on (as `applyDrag` picks), a
  // handle's owner. Nothing for a section or a tool.
  function movingOf(current: SeatPlan<S>, target: PlanTarget<S> | null): ReadonlySet<string> {
    if (target === null || target.kind === 'section') return NONE
    if (target.kind === 'handle') {
      return target.owner.kind === 'selection' ? new Set(selectedIds) : new Set([target.owner.id])
    }
    const object = seatPlan.objectById(current, target.id)
    if (!object) return NONE
    const covered =
      selectedIds.includes(object.id) || (object.group !== undefined && selectedIds.includes(object.group))
    return new Set(covered ? selectedIds : [object.group ?? object.id])
  }

  // The plan with a drag applied, and the guides it lines up on — one of your handles by its set, anything else by
  // `planEdits.applyDrag`, a move or a level object's corner snapped to the guides first.
  function dragged(current: SeatPlan<S>, next: PlanDrag<S>): { plan: SeatPlan<S>; guides: PlanGuide[] } {
    const { target } = next
    const tolerance = GUIDE_PX * (next.pixel ?? 1)
    const targets = next.free ? null : guideTargets
    if (target.kind === 'handle') {
      const colon = target.name.indexOf(':')
      if (colon >= 0) {
        const set = handleSets.find((candidate) => candidate.id === target.name.slice(0, colon))
        if (!set || target.owner.kind === 'selection') return { plan: current, guides: NO_GUIDES }
        const handle = { owner: target.owner, name: target.name.slice(colon + 1) }
        const info = { total: next.total, constrain: next.constrain ?? false, snap: grid, pixel: next.pixel }
        return { plan: set.drag(current, handle, info) ?? current, guides: NO_GUIDES }
      }
      const object = target.owner.kind === 'object' ? seatPlan.objectById(current, target.owner.id) : undefined
      const corner = object && !object.rotation && !next.constrain ? cornerOf(object, target.name) : null
      if (targets && corner) {
        const snapped = planGuides.snapPoint(add(corner, next.total), targets, tolerance)
        if (snapped.exact.x || snapped.exact.y) {
          const total = { x: snapped.point.x - corner.x, y: snapped.point.y - corner.y }
          const plan = planHandles.drag(current, target.owner, target.name, total, null, false, next.pixel)
          return { plan, guides: snapped.guides }
        }
      }
      return { plan: planEdits.applyDrag(current, next, selectedIds, grid), guides: NO_GUIDES }
    }
    if (targets && target.kind !== 'section') {
      const moving = movingOf(current, target)
      const extent = unionBounds(
        current.objects.flatMap((o) =>
          o.kind !== 'label' && (moving.has(o.id) || (o.group !== undefined && moving.has(o.group)))
            ? [seatPlan.boundsOf(o)]
            : [],
        ),
      )
      if (extent) {
        const total = next.constrain ? alongAxis(next.total) : next.total
        const axes = next.constrain ? { x: total.x !== 0, y: total.y !== 0 } : { x: true, y: true }
        const snapped = planGuides.snapMove(extent, total, targets, tolerance, axes)
        const guided = { ...next, total: snapped.delta, constrain: false }
        return { plan: planEdits.applyDrag(current, guided, selectedIds, grid, snapped.exact), guides: snapped.guides }
      }
    }
    return { plan: planEdits.applyDrag(current, next, selectedIds, grid), guides: NO_GUIDES }
  }

  // A point a tool draws to, lined up by the guides within GUIDE_PX — unless ⌘ or Ctrl is held.
  function guided(point: PlanPoint, pixel: number | undefined, free = false): PlanPoint {
    if (guideTargets === null || free) return point
    return planGuides.snapPoint(point, guideTargets, GUIDE_PX * (pixel ?? 1)).point
  }

  function commit(next: Omit<History<S>, 'dirty'>) {
    const full = { ...next, dirty: JSON.stringify(next.present) !== savedRef.current.json }
    historyRef.current = full
    setHistory(full)
  }

  // Every change goes through here: one undo step each, and the redo branch is dropped. An edit that changes
  // nothing (removing an empty selection, a drag that snaps back) leaves history — and the redo branch — alone.
  // Returns whether anything changed.
  function apply(update: Edit<S>): boolean {
    setPreviewing(null)
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
    if (target.kind === 'handle') return target.owner.kind === 'selection' ? null : target.owner
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

  // Selects every object — grouped ones as their group — but what is frozen or hidden.
  function selectAll() {
    setChosen(unitsOf(historyRef.current.present.objects.filter(pickable)))
  }

  // Whether an object can be picked on the plan — neither it nor its group frozen or hidden.
  function pickable(object: PlanObject<S>): boolean {
    return !unpickable.has(object.id) && (object.group === undefined || !unpickable.has(object.group))
  }

  // A target on the plan, or null when it points at something that cannot be picked there.
  function pickableTarget<T extends PlanTarget<S>>(target: T | null): T | null {
    if (target === null || (target.kind !== 'place' && target.kind !== 'object')) return target
    const object = seatPlan.objectById(historyRef.current.present, target.id)
    return object && !pickable(object) ? null : target
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

  // Selects exactly these object and group ids — what a list of problems or a search points at.
  function selectIds(ids: readonly string[]) {
    const current = historyRef.current.present
    setSelection(
      ids.flatMap((id): EditorSelection<S>[] =>
        seatPlan.groupById(current, id)
          ? [{ kind: 'group', id }]
          : seatPlan.objectById(current, id)
            ? [{ kind: 'object', id }]
            : [],
      ),
    )
  }

  // Selects the members of the selected groups, the rest staying selected (Enter). false when no group is selected.
  function selectMembers(): boolean {
    if (!selection.some((item) => item.kind === 'group')) return false
    const current = historyRef.current.present
    setSelection(
      selection.flatMap((item) =>
        item.kind === 'group'
          ? seatPlan.membersOf(current, item.id).map((o) => ({ kind: 'object' as const, id: o.id }))
          : [item],
      ),
    )
    return true
  }

  // Selects the groups of the selected objects, the rest staying selected (⇧Enter). false when no selected object
  // is in a group.
  function selectGroups(): boolean {
    const current = historyRef.current.present
    const groupOf = (item: EditorSelection<S>) =>
      item.kind === 'object' ? seatPlan.objectById(current, item.id)?.group : undefined
    if (!selection.some((item) => groupOf(item) !== undefined)) return false
    setSelection(
      selection.map((item) => {
        const group = groupOf(item)
        return group === undefined ? item : { kind: 'group' as const, id: group }
      }),
    )
    return true
  }

  // A tap on something frozen or hidden taps the floor; one on a handle leaves the selection as it is.
  function handleTap(target: PlanTarget<S> | null, info: { additive: boolean }) {
    if (target?.kind === 'handle') return
    select(pickableTarget(target), info.additive)
  }

  // A section moves only once it is selected; before that a drag on its floor draws a marquee — as a drag on
  // something frozen does.
  function canDrag(target: PlanTarget<S>): boolean {
    if (target.kind !== 'section') return pickableTarget(target) !== null
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
    const picked = unitsOf(current.objects.filter((object) => inside.has(object.id) && pickable(object)))
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
      if (item && !covers(historyRef.current.present, selection, item)) setChosen([item])
    }
    if (next.phase !== 'end') {
      setDrag(next)
      return
    }
    setDrag(null)
    const before = historyRef.current.present
    if (!apply((current) => dragged(current, next).plan)) return
    // A copying drag selects the copies, as a duplicate does.
    if (next.copy && next.target.kind !== 'handle' && next.target.kind !== 'section') {
      setChosen(addedSelection(before, historyRef.current.present))
    }
  }

  // The pointer over the plan — the tool previews a tap there; otherwise it outlines what a tap would select.
  function handleHover(point: PlanPoint | null, target: PlanTarget<S> | null, info?: { pixel: number }) {
    pointerRef.current = point
    if (tool !== null) {
      const at = point === null ? null : guided(strokeOf('point', point, point, NO_KEYS, grid).end, info?.pixel)
      setPointer((current) => (samePoint(current, at) ? current : at))
      return
    }
    const at = pickableTarget(target)
    const item = at === null || at.kind === 'handle' || at.kind === 'section' ? null : selectionOf(at, selection)
    setHovered((current) => (current === item || (current && item && sameSelection(current, item)) ? current : item))
  }

  // A stroke drawn with the tool — previewed while it moves, made when it is let go (a tap makes one too). With a
  // polygon tool every stroke places a corner where it is let go.
  function handleDraw(raw: PlanStroke, info: DrawInfo) {
    if (tool === null) return
    if (info.phase === 'cancel') {
      pressRef.current = null
      setStroke(null)
      return
    }
    // A tap is a stroke with no `start` — only its end is reported.
    if (!pressing('stroke', info.phase)) return
    if (tool.draw === 'polygon') {
      const corner = cornerAt(raw.end, info.constrain)
      const at = info.constrain ? corner : guided(corner, info.pixel, info.free)
      if (info.phase === 'end') addCorner(at, raw.end, info.pixel ?? 0)
      else setPointer(at)
      return
    }
    // Unconstrained ends line up with the guides; a box or line drawn from its centre keeps its start where it is.
    const drawn = strokeOf(tool.draw, raw.start, raw.end, info, grid)
    const shaped =
      info.constrain || guideTargets === null || info.free
        ? drawn
        : {
            start: info.fromCenter ? drawn.start : guided(drawn.start, info.pixel),
            end: guided(drawn.end, info.pixel),
          }
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

  // Where a polygon's next corner goes for the pointer at `point` — snapped, and with Shift held on a 15° step from
  // the last corner.
  function cornerAt(point: PlanPoint, constrain: boolean): PlanPoint {
    const last = cornersRef.current?.at(-1)
    return last && constrain
      ? strokeOf('line', last, point, { constrain }, grid).end
      : strokeOf('polygon', point, point, NO_KEYS, grid).end
  }

  function setCorners(next: PlanPoint[] | null) {
    cornersRef.current = next
    setCornersState(next)
  }

  // A tap of a polygon tool — a corner at `at`, or the polygon closed when it lands on the first corner or the last
  // one again: the tap itself (`tapped`, before snapping moves it a cell away) within CLOSE_PX on screen, or snapped
  // right onto it.
  function addCorner(at: PlanPoint, tapped: PlanPoint, pixel: number) {
    const placed = cornersRef.current ?? []
    const near = (corner: PlanPoint | undefined) =>
      corner !== undefined &&
      (samePoint(corner, at) || Math.hypot(corner.x - tapped.x, corner.y - tapped.y) <= CLOSE_PX * pixel)
    if (placed.length >= 3 && (near(placed[0]) || near(placed.at(-1)))) {
      closePolygon()
      return
    }
    if (samePoint(placed.at(-1) ?? null, at)) return
    setCorners([...placed, at])
  }

  // Makes the polygon being drawn (Enter) — the tool's `create` gets its corners. false when there is none of three
  // corners yet.
  function closePolygon(): boolean {
    const placed = cornersRef.current
    if (tool === null || tool.draw !== 'polygon' || placed === null || placed.length < 3) return false
    setCorners(null)
    setPointer(null)
    const before = historyRef.current.present
    const next = tool.create(before, { start: placed[0]!, end: placed.at(-1)!, points: placed })
    if (next !== null && apply(() => next)) {
      setChosen(addedSelection(before, next))
      if (!tool.keep) setToolState(null)
    }
    return true
  }

  // Takes back the last corner of the polygon being drawn (Backspace). false when there is none.
  function removePoint(): boolean {
    const placed = cornersRef.current
    if (placed === null || placed.length === 0) return false
    setCorners(placed.length > 1 ? placed.slice(0, -1) : null)
    return true
  }

  // Picks a creation tool, or goes back to selecting with null. A stroke or a polygon being drawn is dropped — with
  // another tool its end is ignored when it comes; with none, it never comes (the viewport stops drawing).
  function setTool(next: EditorTool<S> | null) {
    const press = pressRef.current
    if (press?.kind === 'stroke') pressRef.current = next === null ? null : { ...press, cancelled: true }
    setCorners(null)
    setStroke(null)
    setToolState(next)
    setHovered(null)
    const point = pointerRef.current
    setPointer(next === null || point === null ? null : strokeOf('point', point, point, NO_KEYS, grid).end)
  }

  // Drops the press under way (Escape) — a stroke makes nothing, a drag puts back what it moved, a marquee selects
  // nothing; letting go then changes nothing — and the polygon being drawn. false when nothing was under way.
  function cancel(): boolean {
    const press = pressRef.current
    const pressed = press !== null && !press.cancelled
    const drawing = cornersRef.current !== null
    if (!pressed && !drawing) return false
    if (pressed) pressRef.current = { ...press, cancelled: true }
    setCorners(null)
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

  // Removes the selection in one step — objects, groups, and sections with what stands in them (see
  // `planEdits.removeSection`). Returns the ids refused because they are locked; a section holding one stays whole.
  function removeSelected(): string[] {
    const objects = planEdits.remove(historyRef.current.present, selectedIds, locked)
    const refused = [...objects.refused]
    const next = selectedSectionIds.reduce((current, id) => {
      const section = planEdits.removeSection(current, id, locked)
      refused.push(...section.refused)
      return section.plan
    }, objects.plan)
    apply(() => next)
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

  // Copies the selection next to itself and selects the copies. Duplicating the copies again repeats where they went:
  // duplicate, move the copy, duplicate again — and the next copy lands as far on.
  function duplicateSelected(): string[] {
    const current = historyRef.current.present
    const here = centerOfIds(current, selectedIds)
    const last = duplicateRef.current
    const again = last !== null && here !== null && sameIds(last.ids, selectedIds)
    const offset = again ? { x: here.x - last.from.x, y: here.y - last.from.y } : undefined
    const result = planEdits.duplicate(current, selectedIds, offset)
    if (result.ids.length === 0) return []
    apply(() => result.plan)
    setChosen(
      result.ids.map((id) =>
        seatPlan.groupById(result.plan, id) ? { kind: 'group' as const, id } : { kind: 'object' as const, id },
      ),
    )
    duplicateRef.current = here === null ? null : { from: here, ids: result.ids }
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
    selectIds,
    selectMembers,
    selectGroups,
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
    // The stroke being drawn, snapped and constrained — draw it as a guide if you like; a polygon's corners with the
    // pointer. null between strokes.
    stroke: tool?.draw === 'polygon' ? toolStroke : stroke,
    draft,
    // Where a tap would draw while a tool is active, or null when the pointer is off the plan. With `draft` null
    // it says the tool can make nothing there — tell people why.
    pointer,
    // Drops the stroke, drag or marquee under way, and the polygon being drawn (Escape); false when there is none.
    cancel,
    // A polygon tool's corners so far — Enter closes it (`closePolygon`), Backspace takes one back (`removePoint`).
    corners,
    closePolygon,
    removePoint,

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
    edit: (update: Edit<S>) => apply(update),
    // Shows an edit without committing it — while a slider is dragged or a value typed. It is applied to the plan as
    // it is (undo and edits made meanwhile show through) and ends with the next edit, or `preview(null)`; `edit` the
    // final value when the slider is let go. `displayPlan`, `conflictIds` and the outlines show it.
    preview: (update: Edit<S> | null) => setPreviewing(() => update),
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
    // Adds a section and selects it. false when its id is taken or it has fewer than three corners.
    addSection: (section: Section<S>) => {
      if (!apply((current) => planEdits.addSection(current, section))) return false
      setChosen([{ kind: 'section', id: section.id }])
      return true
    },
    reshapeSection: (id: S, points: PlanPoint[]) =>
      apply((current) => planEdits.reshapeSection(current, id, points, grid)),
    renameObject,

    // Removing — returns the ids refused because they are locked.
    removeObjects,
    removeSelected,
    removeSection: (id: S) => {
      const { plan: next, refused } = planEdits.removeSection(historyRef.current.present, id, locked)
      apply(() => next)
      return refused
    },

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
      stroke: tool?.draw === 'polygon' ? toolStroke : stroke,
      draw: tool?.draw,
      guides: dragResult?.guides ?? strokeGuides,
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
      if (editor.closePolygon() || (e.shiftKey ? editor.selectGroups() : editor.selectMembers())) e.preventDefault()
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
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!editor.removePoint()) editor.removeSelected()
    }
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

// Where a level box's corner (`nw`, `ne`, `se`, `sw`) is — null for any other handle.
function cornerOf(box: PlanRect, name: string): PlanPoint | null {
  if (name === 'nw') return { x: box.x, y: box.y }
  if (name === 'ne') return { x: box.x + box.w, y: box.y }
  if (name === 'se') return { x: box.x + box.w, y: box.y + box.h }
  if (name === 'sw') return { x: box.x, y: box.y + box.h }
  return null
}

function add(a: PlanPoint, b: PlanPoint): PlanPoint {
  return { x: a.x + b.x, y: a.y + b.y }
}

// What a polygon tool is drawing — its corners and the pointer — as the stroke its `create` gets. null with neither.
function polygonStroke(corners: readonly PlanPoint[] | null, pointer: PlanPoint | null): PlanStroke | null {
  const points = [...(corners ?? []), ...(pointer === null ? [] : [pointer])]
  const [start] = points
  return start === undefined ? null : { start, end: points.at(-1)!, points }
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
// The middle of what ids cover, or null when they cover nothing.
function centerOfIds(plan: SeatPlan<string>, ids: readonly string[]): PlanPoint | null {
  const extent = unionBounds(seatPlan.boundsOfIds(plan, ids))
  return extent ? seatPlan.centerOf(extent) : null
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

// The plan without hidden objects — an object hidden itself or through its group (a hidden group's labels too).
function withoutHidden<S extends string>(plan: SeatPlan<S>, hidden: ReadonlySet<string>): SeatPlan<S> {
  return {
    ...plan,
    objects: plan.objects.filter((o) => !hidden.has(o.id) && (o.group === undefined || !hidden.has(o.group))),
  }
}

function addedSelection<S extends string>(before: SeatPlan<S>, after: SeatPlan<S>): EditorSelection<S>[] {
  const sections = after.sections.flatMap((section) =>
    seatPlan.sectionOf(before, section.id) ? [] : [{ kind: 'section' as const, id: section.id }],
  )
  const known = new Set(seatPlan.idsOf(before))
  const groups = after.groups.filter((g) => !known.has(g.id)).map((g) => g.id)
  const fresh = new Set(groups)
  return [
    ...sections,
    ...groups.map((id) => ({ kind: 'group' as const, id })),
    ...after.objects.flatMap((o) =>
      known.has(o.id) || o.kind === 'label' || (o.group !== undefined && fresh.has(o.group))
        ? []
        : [{ kind: 'object' as const, id: o.id }],
    ),
  ]
}
