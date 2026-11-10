import { seatPlan } from '../core/geometry'
import { unionBounds } from '../core/math'
import type {
  Group,
  PlanDrag,
  PlanGuide,
  PlanObject,
  PlanPoint,
  PlanRect,
  PlanStroke,
  PlanTarget,
  PlanTemplate,
  SeatPlan,
} from '../core/types'
import { planGuides } from './guides'
import { alongAxis, planHandles, type EditorHandles } from './handles'
import { planEdits, type Snap } from './operations'
import type { EditorSelection } from './selection'
import type { EditorTool } from './tools'

// The editor's state and the pure pieces of what it does with it — no React, no store. `./store.ts` holds one of
// these and changes it; `./view.ts` works out what is drawn from it.

export type SeatPlanEditorOptions<S extends string> = {
  initialPlan: SeatPlan<S>
  // Ids your other records reference (booked seats, active sessions). Objects holding one cannot be removed,
  // renamed or turned into fixtures; labels stay free to change.
  lockedIds?: Iterable<string>
  // Snap to a grid while editing — sections to cell corners, objects and strokes to half cells, turns to 15°. Off
  // by default: edits land on whole plan units.
  snap?: Snap
  // Objects, groups and walls that stay put while the rest is edited (a stage, the walls) — a layers panel's lock.
  // They are drawn but cannot be tapped, dragged, hovered, marqueed or selected with ⌘A; a drag that starts on one
  // draws a marquee. `setSelection` and `selectIds` still pick them, for a panel. Editor state, never in the document.
  frozenIds?: Iterable<string>
  // Objects, groups and walls left out of what the editor draws (`displayPlan`, and the viewport's plan) — a layers
  // panel's eye. Like frozen ones they cannot be picked on the plan; the saved `plan` keeps them, and `conflictIds`
  // still counts them.
  hiddenIds?: Iterable<string>
  // Handles of your own — shown beside ichno's on the one selected item they are for (see `EditorHandles`). A set is
  // known by its `id`: the same ids again are the same sets, and what they show is worked out anew when the plan, the
  // selection or another option changes — have them read those, not state of their own.
  handles?: readonly EditorHandles<S>[]
  // Smart guides: a move snaps to the edges and centre lines of what stands around it and to the spacing between its
  // neighbours, a corner and a tool's stroke to those lines — within 6 screen pixels, ahead of the grid. ⌘ or Ctrl
  // held lets go. `overlayProps.guides` are the guides to draw. Off by default.
  guides?: boolean
}

// The options as the editor works with them — kept by content, so giving the same ids again changes nothing.
export type EditorConfig<S extends string> = {
  locked: ReadonlySet<string>
  grid: Snap | null
  // What cannot be picked on the plan — frozen or hidden, itself or as part of its group.
  unpickable: ReadonlySet<string>
  hidden: ReadonlySet<string>
  // The editor's own list (see `keptSets`).
  handleSets: EditorHandles<S>[]
  guides: boolean
}

export type History<S extends string> = {
  past: SeatPlan<S>[]
  present: SeatPlan<S>
  future: SeatPlan<S>[]
  dirty: boolean
}

// A plan → plan change (null: nothing to change) — what `edit` commits and `preview` shows.
export type Edit<S extends string> = (current: SeatPlan<S>) => SeatPlan<S> | null

// What was copied, where it came from, and how many times it was pasted next to it.
export type Clip = { template: PlanTemplate; at: PlanPoint; pastes: number }

// The press under way — a stroke, a drag or a marquee — and whether Escape dropped it before it was let go.
export type Press = { kind: 'stroke' | 'drag' | 'marquee'; cancelled: boolean }

// A new group made while adding — its props, or the id of one that exists.
export type GroupChoice = string | Omit<Group, 'id'>

// What the viewport reports about a stroke besides where it runs.
export type DrawInfo = {
  phase: 'start' | 'move' | 'end' | 'cancel'
  constrain: boolean
  fromCenter: boolean
  free?: boolean
  pixel?: number
}

// Everything the editor draws from. A change to any of it is one new state; what is worked out from it (`./view.ts`)
// keeps its identity where the change does not reach.
export type EditorState<S extends string> = {
  history: History<S>
  // What is selected, as picked — some of it may be gone from the plan since (an undo); the view filters it.
  chosen: readonly EditorSelection<S>[]
  drag: PlanDrag<S> | null
  // The creation tool in use — null while selecting.
  tool: EditorTool<S> | null
  // The stroke being drawn with it, snapped and constrained.
  stroke: PlanStroke | null
  // Where a tap would draw while a tool is active (snapped) — the tool previews there.
  pointer: PlanPoint | null
  // The corners of a polygon or a path being drawn with a `polygon` or `path` tool — null between them.
  corners: PlanPoint[] | null
  // What a tap would select under the pointer.
  hovered: EditorSelection<S> | null
  clipboard: Clip | null
  // An edit shown but not committed (`preview`) — applied to the plan as it is, so undo and edits made meanwhile
  // show through it.
  previewing: Edit<S> | null
  // The rubber band being dragged, in plan units.
  marquee: PlanRect | null
}

// The plan with a drag applied, and the guides it lined up on.
export type Dragged<S extends string> = { plan: SeatPlan<S>; guides: PlanGuide[] }

// What a drag is worked out against: what there is to line up with (null: nothing), the grid, the consumer's handle
// sets and what is selected.
export type DragContext<S extends string> = {
  targets: readonly PlanRect[] | null
  grid: Snap | null
  handleSets: readonly EditorHandles<S>[]
  selectedIds: readonly string[]
  selectedWallIds: readonly string[]
  // What a drag or the arrow keys move — the selected objects and groups, and the walls.
  movableIds: readonly string[]
}

// How close (screen pixels) a move, a corner or a stroke comes to a guide to snap to it.
export const GUIDE_PX = 6

export const NO_GUIDES: PlanGuide[] = []

export const NONE: ReadonlySet<string> = new Set()

export function initialState<S extends string>(plan: SeatPlan<S>): EditorState<S> {
  return {
    history: { past: [], present: plan, future: [], dirty: false },
    chosen: [],
    drag: null,
    tool: null,
    stroke: null,
    pointer: null,
    corners: null,
    hovered: null,
    clipboard: null,
    previewing: null,
    marquee: null,
  }
}

// The options as a config — each part the one `previous` held when it says the same, so nothing downstream is worked
// out again for an option handed over anew but unchanged.
export function configOf<S extends string>(
  options: Omit<SeatPlanEditorOptions<S>, 'initialPlan'>,
  previous: EditorConfig<S> | null,
): EditorConfig<S> {
  const hidden = keptSet(previous?.hidden, options.hiddenIds ?? [])

  const next: EditorConfig<S> = {
    locked: keptSet(previous?.locked, options.lockedIds ?? []),
    grid: keptSnap(previous?.grid ?? null, options.snap ?? null),
    unpickable: keptSet(previous?.unpickable, [...(options.frozenIds ?? []), ...hidden]),
    hidden,
    handleSets: keptSets(previous?.handleSets, options.handles ?? NO_HANDLE_SETS),
    guides: options.guides ?? false,
  }

  const same =
    previous !== null &&
    previous.locked === next.locked &&
    previous.grid === next.grid &&
    previous.unpickable === next.unpickable &&
    previous.hidden === next.hidden &&
    previous.handleSets === next.handleSets &&
    previous.guides === next.guides

  return same ? previous : next
}

const NO_HANDLE_SETS: readonly EditorHandles<never>[] = []

function keptSet(previous: ReadonlySet<string> | undefined, ids: Iterable<string>): ReadonlySet<string> {
  const next = new Set(ids)

  if (next.size === 0) return previous?.size === 0 ? previous : NONE

  return previous && previous.size === next.size && [...next].every((id) => previous.has(id)) ? previous : next
}

function keptSnap(previous: Snap | null, next: Snap | null): Snap | null {
  return previous !== null && next !== null && previous.cell === next.cell && previous.wall === next.wall
    ? previous
    : next
}

// Handle sets are known by their ids: a list of the same ids in the same order is the same sets, so the list keeps
// its identity — and takes the functions handed over now, since a consumer's sets are often made anew on every render.
function keptSets<S extends string>(
  previous: EditorHandles<S>[] | undefined,
  next: readonly EditorHandles<S>[],
): EditorHandles<S>[] {
  if (!previous || previous.length !== next.length || previous.some((set, i) => set.id !== next[i]!.id)) {
    return [...next]
  }

  previous.splice(0, previous.length, ...next)

  return previous
}

// What a press moves, for guides to leave out — the selection or what it is on (as `applyDrag` picks), a
// handle's owner. Nothing for a section or a tool.
export function movingOf<S extends string>(
  current: SeatPlan<S>,
  target: PlanTarget<S> | null,
  { selectedIds, selectedWallIds, movableIds }: Pick<DragContext<S>, 'selectedIds' | 'selectedWallIds' | 'movableIds'>,
): ReadonlySet<string> {
  if (target === null || target.kind === 'section') return NONE

  if (target.kind === 'handle') {
    return target.owner.kind === 'selection' ? new Set(selectedIds) : new Set([target.owner.id])
  }

  if (target.kind === 'wall') return new Set(selectedWallIds.includes(target.id) ? movableIds : [target.id])
  const object = seatPlan.objectById(current, target.id)

  if (!object) return NONE
  const covered = selectedIds.includes(object.id) || (object.group !== undefined && selectedIds.includes(object.group))

  return new Set(covered ? movableIds : [object.group ?? object.id])
}

// The plan with a drag applied, and the guides it lines up on — one of your handles by its set, anything else by
// `planEdits.applyDrag`, a move or a level object's corner snapped to the guides first.
export function dragged<S extends string>(
  current: SeatPlan<S>,
  next: PlanDrag<S>,
  context: DragContext<S>,
): Dragged<S> {
  const { grid, handleSets, selectedWallIds, movableIds } = context
  const { target } = next
  const tolerance = GUIDE_PX * (next.pixel ?? 1)
  const targets = next.free ? null : context.targets

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

    return { plan: planEdits.applyDrag(current, next, movableIds, grid), guides: NO_GUIDES }
  }

  // A move that takes walls along is left to the grid — lined up with what stands round it, its walls would leave it.
  const moving =
    targets && target.kind !== 'section' && target.kind !== 'wall' ? movingOf(current, target, context) : NONE

  if (targets && moving.size > 0 && !selectedWallIds.some((id) => moving.has(id))) {
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

      return { plan: planEdits.applyDrag(current, guided, movableIds, grid, snapped.exact), guides: snapped.guides }
    }
  }

  return { plan: planEdits.applyDrag(current, next, movableIds, grid), guides: NO_GUIDES }
}

// What is selected and still in the plan — an undo, a redo or an edit may have taken some of it away: the items; the
// object and group ids the operations take; the section and wall ids; the objects the ids stand for (groups by their
// members, in one pass however much is selected); the groups; and the places, to pass to the renderer as selected.
export function selectedOf<S extends string>(plan: SeatPlan<S>, chosen: readonly EditorSelection<S>[]) {
  const inPlan = new Set(seatPlan.idsOf(plan))

  const selection = chosen.filter((item) =>
    item.kind === 'section' ? seatPlan.sectionOf(plan, item.id) !== undefined : inPlan.has(item.id),
  )

  const selectedIds = selection.flatMap((item) => (item.kind === 'object' || item.kind === 'group' ? [item.id] : []))
  const selectedSectionIds = selection.flatMap((item) => (item.kind === 'section' ? [item.id] : []))
  const selectedWallIds = selection.flatMap((item) => (item.kind === 'wall' ? [item.id] : []))
  const selectedIdSet = new Set(selectedIds)

  const selectedObjects = plan.objects.filter(
    (object) => selectedIdSet.has(object.id) || (object.group !== undefined && selectedIdSet.has(object.group)),
  )

  const selectedGroups = selection.flatMap((item) =>
    item.kind === 'group' ? (seatPlan.groupById(plan, item.id) ?? []) : [],
  )

  const selectedPlaceIds = selectedObjects.flatMap((object) => (object.kind === 'place' ? [object.id] : []))

  return {
    selection,
    selectedIds,
    selectedSectionIds,
    selectedWallIds,
    selectedObjects,
    selectedGroups,
    selectedPlaceIds,
    // What a drag or the arrow keys move — the selected objects and groups, and the walls.
    movableIds: selectedWallIds.length === 0 ? selectedIds : [...selectedIds, ...selectedWallIds],
  }
}

// What a tap or a drag on a target selects — a grouped object selects its group until the group is selected,
// then the object itself; a group label always selects its group.
export function selectionOf<S extends string>(
  plan: SeatPlan<S>,
  target: PlanTarget<S> | EditorSelection<S>,
  current: readonly EditorSelection<S>[],
): EditorSelection<S> | null {
  if (target.kind === 'handle') return target.owner.kind === 'selection' ? null : target.owner

  if (target.kind === 'section' || target.kind === 'group' || target.kind === 'wall') return target
  const object = seatPlan.objectById(plan, target.id)
  const group = object?.group

  if (group === undefined) return { kind: 'object', id: target.id }
  const opened = current.some((item) => item.kind === 'group' && item.id === group)

  return object?.kind !== 'label' && opened ? { kind: 'object', id: target.id } : { kind: 'group', id: group }
}

// Whether a group choice is the id of a group that exists, rather than the props of a new one.
export function isGroupId(choice: GroupChoice): choice is string {
  return typeof choice === 'string'
}

// Whether a selection already holds an item — itself, or the group of a grouped object.
export function covers<S extends string>(
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
export function unitsOf<S extends string>(objects: readonly PlanObject<S>[]): EditorSelection<S>[] {
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

export function keyOf(item: EditorSelection<string>): string {
  return `${item.kind}:${item.id}`
}

export function sameSelection<S extends string>(a: EditorSelection<S>, b: EditorSelection<S>): boolean {
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

// Whether a tool draws corner by corner — a polygon or a path.
export function isCornered(tool: EditorTool<string>): boolean {
  return tool.draw === 'polygon' || tool.draw === 'path'
}

// What a polygon or path tool is drawing — its corners and the pointer — as the stroke its `create` gets. null with
// neither.
export function polygonStroke(corners: readonly PlanPoint[] | null, pointer: PlanPoint | null): PlanStroke | null {
  const points = [...(corners ?? []), ...(pointer === null ? [] : [pointer])]
  const [start] = points

  return start === undefined ? null : { start, end: points.at(-1)!, points }
}

// A rectangle's four corners, from the start of the stroke that drew it, as a polygon or path tool's stroke — a
// path's `closed`.
export function rectangleOf({ start, end }: PlanStroke, closed = false): PlanStroke {
  const points = [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }]

  return closed ? { start, end, points, closed } : { start, end, points }
}

export function samePoint(a: PlanPoint | null, b: PlanPoint | null): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y)
}

// What `after` adds to `before` — its new objects with the groups they belong to, and its new walls (a wall that
// gained an opening too), as a plan with no sections.
export function addedPart<S extends string>(before: SeatPlan<S>, after: SeatPlan<S>): SeatPlan<S> {
  const known = new Set(seatPlan.idsOf(before))
  const objects = after.objects.filter((o) => !known.has(o.id))
  const groups = new Set(objects.flatMap((o) => (o.group === undefined ? [] : [o.group])))
  const walls = after.walls.filter((w) => !before.walls.includes(w))

  return { ...after, sections: [], walls, groups: after.groups.filter((g) => groups.has(g.id)), objects }
}

// The middle of what ids cover, or null when they cover nothing.
export function centerOfIds(plan: SeatPlan<string>, ids: readonly string[]): PlanPoint | null {
  const extent = unionBounds(seatPlan.boundsOfIds(plan, ids))

  return extent ? seatPlan.centerOf(extent) : null
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

// The plan without hidden objects and walls — an object hidden itself or through its group (a hidden group's labels
// too).
export function withoutHidden<S extends string>(plan: SeatPlan<S>, hidden: ReadonlySet<string>): SeatPlan<S> {
  return {
    ...plan,
    walls: plan.walls.some((w) => hidden.has(w.id)) ? plan.walls.filter((w) => !hidden.has(w.id)) : plan.walls,
    objects: plan.objects.filter((o) => !hidden.has(o.id) && (o.group === undefined || !hidden.has(o.group))),
  }
}

// The selection of what `after` adds to `before` — new groups as groups, new objects outside them one by one.
export function addedSelection<S extends string>(before: SeatPlan<S>, after: SeatPlan<S>): EditorSelection<S>[] {
  const sections = after.sections.flatMap((section) =>
    seatPlan.sectionOf(before, section.id) ? [] : [{ kind: 'section' as const, id: section.id }],
  )

  const known = new Set(seatPlan.idsOf(before))
  const groups = after.groups.filter((g) => !known.has(g.id)).map((g) => g.id)
  const fresh = new Set(groups)

  return [
    ...sections,
    ...after.walls.flatMap((w) => (known.has(w.id) ? [] : [{ kind: 'wall' as const, id: w.id }])),
    ...groups.map((id) => ({ kind: 'group' as const, id })),
    ...after.objects.flatMap((o) =>
      known.has(o.id) || o.kind === 'label' || (o.group !== undefined && fresh.has(o.group))
        ? []
        : [{ kind: 'object' as const, id: o.id }],
    ),
  ]
}

// Remembers its last answer: asked again with the same arguments (by identity) it hands back the same value. What a
// drag leaves alone keeps its identity frame after frame that way, so a layer drawing it is not drawn again. One per
// editor — never shared between two.
export function cached<A extends readonly unknown[], R>(compute: (...args: A) => R): (...args: A) => R {
  let last: { args: A; value: R } | null = null

  return (...args) => {
    if (last !== null && last.args.length === args.length && last.args.every((arg, i) => Object.is(arg, args[i]))) {
      return last.value
    }

    const value = compute(...args)
    last = { args, value }

    return value
  }
}
