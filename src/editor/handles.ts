import { seatPlan } from '../core/geometry'
import { normalizeRotation, outlineOf, rotatePoint, unionBounds } from '../core/math'
import type { HandleOwner, PlanBox, PlanHandle, PlanObject, PlanPoint, PlanRect, SeatPlan } from '../core/types'
import type { EditorSelection } from './selection'
import type { Snap } from './operations'
import { boxOf, turnObjects, withGroupRotation } from './turn'

// Editing handles — which ones a selection shows and what dragging one does. Pure, like the other operations:
// the editor hook shows `handlesOf` and commits `dragHandle` with the snapping its preview used.
//
// An object resizes from its corners (the opposite corner staying put, in the object's own turned frame) and
// turns from the knob above its top edge. A group turns as one from the knob above its frame — the box around its
// members in the direction it faces — so the knob, the frame and the centre turn with it. Sections move one
// vertex at a time; dragging the middle of an edge adds a vertex there, and a vertex dropped on its neighbour merges
// with it. Several selected items show one knob above the box around them, turning them together about the middle of
// their centres (as `planEdits.rotate` does); otherwise handles show for a single selected item. `frames` outlines
// any number of them.

// Handles of your own on a selected item — a row's end to drag it longer, the middle of its arc to bend it, a table's
// edge to seat more. Like a creation tool, the set says what they are, and ichno draws them with its own
// (`SeatMap.Handles`), follows the drag and commits it as one undo step. ichno never reads what the item is: `of`
// decides whether it has any.
export type EditorHandles<S extends string = string> = {
  // Your name for the set, without a colon. Its handles are named `<id>:<name>` on the plan (`data-ichno-handle`), so
  // sets never collide with each other or with ichno's own.
  id: string
  // The handles for the one selected item — none for the rest. Called on the plan as drawn, so they follow a drag.
  // `angle` (degrees clockwise from +x) picks a resize cursor pointing that way; without it the cursor is `move`.
  of(plan: SeatPlan<S>, item: EditorSelection<S>): { name: string; point: PlanPoint; angle?: number }[]
  // The plan with one of them dragged by `total` since the press — called for every move to preview it, and once more
  // when it is let go to commit it. null leaves the plan as it is. `constrain` is Shift, `snap` the editor's grid,
  // `pixel` the plan units a screen pixel spans. Keep it pure.
  drag(
    plan: SeatPlan<S>,
    handle: { owner: EditorSelection<S>; name: string },
    drag: { total: PlanPoint; constrain: boolean; snap: Snap | null; pixel?: number },
  ): SeatPlan<S> | null
}

export const planHandles = {
  of: handlesOf,
  drag: dragHandle,
  frame: frameOf,
  frames: framesOf,
  selectionTurn: selectionTurnOf,
}

const CORNERS = ['nw', 'ne', 'se', 'sw'] as const
type Corner = (typeof CORNERS)[number]

// How far the rotation knob sits above the top edge (plan units).
const KNOB_OFFSET = 28
// The turn a snapping editor steps by (degrees).
const ROTATION_STEP = 15
// How close (screen pixels) a dragged vertex comes to its neighbour to merge with it.
const MERGE_PX = 8

// The handles a selection shows. `turn` turns a selection's knob (and `frame` its box) while the knob is dragged —
// pass `selectionTurn` with the plan as it was, so both follow the pointer.
function handlesOf<S extends string>(
  plan: SeatPlan<S>,
  selection: readonly EditorSelection<S>[],
  turn = 0,
): PlanHandle<S>[] {
  if (selection.length > 1) {
    const together = selectionKnobOf(plan, selection, turn)
    return together ? [{ owner: { kind: 'selection' }, name: 'rotate', point: together.knob }] : []
  }
  if (selection.length !== 1) return []
  const [item] = selection as [EditorSelection<S>]
  if (item.kind === 'section') {
    const section = seatPlan.sectionOf(plan, item.id)
    if (!section) return []
    const { points } = section
    return [
      ...points.map((point, i) => ({ owner: item, name: `vertex-${i}`, point })),
      ...points.map((point, i) => ({
        owner: item,
        name: `edge-${i}`,
        point: middle(point, points[(i + 1) % points.length]!),
      })),
    ]
  }
  const box = boxOf(plan, item.id)
  if (!box) return []
  const knob = { owner: item, name: 'rotate', point: knobOf(box) }
  if (item.kind === 'group') return [knob]
  const object = seatPlan.objectById(plan, item.id)!
  const center = seatPlan.centerOf(box)
  const corners = cornersOf(box)
  return [
    ...CORNERS.map((name) => ({ owner: item, name, point: corners[name], angle: angleOf(center, corners[name]) })),
    ...(object.kind === 'label' ? [] : [knob]),
  ]
}

// The outline of the single selected object or group — its turned box, or the group's frame (nw, ne, se, sw) — or
// the box around several. Draw it with the handles so a turned group shows the box it turns about. null for a
// section or nothing.
function frameOf<S extends string>(
  plan: SeatPlan<S>,
  selection: readonly EditorSelection<S>[],
  turn = 0,
): PlanPoint[] | null {
  if (selection.length > 1) return selectionKnobOf(plan, selection, turn)?.frame ?? null
  if (selection.length !== 1 || selection[0]!.kind === 'section') return null
  const box = boxOf(plan, selection[0]!.id)
  return box ? outlineOf(box, 'rect') : null
}

// The outline of every selected object and group, the way `frame` outlines one — in one pass over the plan, so a
// selection of thousands stays cheap. Sections have none.
function framesOf<S extends string>(plan: SeatPlan<S>, selection: readonly EditorSelection<S>[]): PlanPoint[][] {
  const groups = new Map(plan.groups.map((group) => [group.id, group]))
  const objects = new Map(plan.objects.map((object) => [object.id, object]))
  const members = new Map<string, PlanObject<S>[]>()
  for (const object of plan.objects) {
    if (object.group === undefined) continue
    const list = members.get(object.group)
    if (list) list.push(object)
    else members.set(object.group, [object])
  }
  return selection.flatMap((item) => {
    if (item.kind === 'section') return []
    const group = item.kind === 'group' ? groups.get(item.id) : undefined
    const box = group
      ? seatPlan.frameOf(members.get(group.id) ?? [], group.rotation ?? 0)
      : (objects.get(item.id) ?? null)
    return box ? [outlineOf(box, 'rect')] : []
  })
}

// The box around several selected objects and groups, the knob above it and what they turn about — the middle of
// their centres, a group's being its frame's. `turn` turns the box and the knob about it. Sections take no part.
// null for fewer than two objects and groups. One pass over the plan, so a selection of thousands stays cheap.
function selectionKnobOf<S extends string>(
  plan: SeatPlan<S>,
  selection: readonly EditorSelection<S>[],
  turn = 0,
): { frame: PlanPoint[]; knob: PlanPoint; pivot: PlanPoint } | null {
  const ids = new Set(selection.flatMap((item) => (item.kind === 'section' ? [] : [item.id])))
  if (ids.size < 2) return null
  const bounds: PlanRect[] = []
  const centers: PlanPoint[] = []
  const members = new Map<string, PlanObject<S>[]>()
  for (const object of plan.objects) {
    if (ids.has(object.id)) {
      bounds.push(seatPlan.boundsOf(object))
      centers.push(seatPlan.centerOf(object))
    } else if (object.group !== undefined && ids.has(object.group)) {
      bounds.push(seatPlan.boundsOf(object))
      members.set(object.group, [...(members.get(object.group) ?? []), object])
    }
  }
  for (const [id, list] of members) {
    const box = seatPlan.frameOf(list, seatPlan.groupById(plan, id)?.rotation ?? 0)
    if (box) centers.push(seatPlan.centerOf(box))
  }
  const extent = unionBounds(bounds)
  if (!extent || centers.length === 0) return null
  const pivot = {
    x: centers.reduce((sum, c) => sum + c.x, 0) / centers.length,
    y: centers.reduce((sum, c) => sum + c.y, 0) / centers.length,
  }
  const top = { x: extent.x + extent.w / 2, y: extent.y - KNOB_OFFSET }
  return {
    frame: outlineOf(extent, 'rect').map((p) => rotatePoint(p, pivot, turn)),
    knob: rotatePoint(top, pivot, turn),
    pivot,
  }
}

// How far the selection's knob dragged by `total` turns it — in whole degrees, or 15° steps when snapping.
function selectionTurnOf<S extends string>(
  plan: SeatPlan<S>,
  selection: readonly EditorSelection<S>[],
  total: PlanPoint,
  snapping = false,
): number {
  const together = selectionKnobOf(plan, selection)
  if (!together) return 0
  const { pivot, knob } = together
  return stepped(shortest(angleOf(pivot, add(knob, total)) - angleOf(pivot, knob)), snapping)
}

// The plan with a handle dragged by `total` plan units. Unknown handles leave the plan as it is. `constrain`
// (Shift) turns in 15° steps, keeps a resized object's proportions and moves a vertex straight along one axis.
// `pixel` (plan units per screen pixel) sizes how close a vertex comes to its neighbour to merge with it — without
// it, only one dropped right on it merges.
function dragHandle<S extends string>(
  plan: SeatPlan<S>,
  owner: HandleOwner<S>,
  name: string,
  total: PlanPoint,
  snap: Snap | null = null,
  constrain = false,
  pixel = 0,
): SeatPlan<S> {
  // The selection's knob turns what is selected — `planEdits.applyDrag` knows what that is.
  if (owner.kind === 'selection') return plan
  if (owner.kind === 'section') {
    return {
      ...plan,
      sections: plan.sections.map((section) =>
        section.id === owner.id
          ? { ...section, points: reshapedOutline(plan, section.points, name, total, snap, constrain, pixel) }
          : section,
      ),
    }
  }
  if (name !== 'rotate' && !isCorner(name)) return plan
  if (owner.kind === 'group') {
    const group = seatPlan.groupById(plan, owner.id)
    const frame = boxOf(plan, owner.id)
    if (name !== 'rotate' || !group || !frame) return plan
    // The knob sets the direction the group faces; the members turn by the difference, about the frame's centre.
    const center = seatPlan.centerOf(frame)
    const facing = stepped(angleOf(center, add(knobOf(frame), total)) + 90, snap !== null || constrain)
    const turn = shortest(facing - (group.rotation ?? 0))
    const turned = turnObjects(plan, seatPlan.membersOf(plan, owner.id), center, turn)
    return withGroupRotation(turned, owner.id, facing)
  }
  return {
    ...plan,
    objects: plan.objects.map((object) =>
      object.id === owner.id ? reshaped(plan, object, name, total, snap, constrain) : object,
    ),
  }
}

// A section outline with a vertex moved — merged into its neighbour when dropped on it, as long as three remain — or
// with a vertex added in the middle of an edge and moved.
function reshapedOutline(
  plan: Pick<SeatPlan, 'width' | 'height'>,
  points: readonly PlanPoint[],
  name: string,
  total: PlanPoint,
  snap: Snap | null,
  constrain: boolean,
  pixel: number,
): PlanPoint[] {
  const [kind, at] = name.split('-')
  const index = Number(at)
  const from = points[index]
  if (!from || (kind !== 'vertex' && kind !== 'edge')) return [...points]
  const step = snap ? snap.cell : 1
  const by = constrain ? alongAxis(total) : total
  const start = kind === 'edge' ? middle(from, points[(index + 1) % points.length]!) : from
  const point = {
    x: clamp(roundTo(start.x + by.x, step), 0, Math.floor(plan.width / step) * step),
    y: clamp(roundTo(start.y + by.y, step), 0, Math.floor(plan.height / step) * step),
  }
  if (kind === 'edge') return [...points.slice(0, index + 1), point, ...points.slice(index + 1)]
  const near = (other: PlanPoint | undefined) =>
    other !== undefined && Math.hypot(other.x - point.x, other.y - point.y) <= MERGE_PX * pixel
  const previous = points[(index - 1 + points.length) % points.length]
  const next = points[(index + 1) % points.length]
  if (points.length > 3 && (near(previous) || near(next))) {
    return points.filter((_, i) => i !== index)
  }
  return points.map((p, i) => (i === index ? point : p))
}

function middle(a: PlanPoint, b: PlanPoint): PlanPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function reshaped<S extends string>(
  plan: SeatPlan<S>,
  object: PlanObject<S>,
  name: string,
  total: PlanPoint,
  snap: Snap | null,
  constrain: boolean,
): PlanObject<S> {
  const rotation = object.rotation ?? 0
  const center = seatPlan.centerOf(object)
  if (name === 'rotate') {
    const turned = normalizeRotation(
      stepped(angleOf(center, add(knobOf(object), total)) + 90, snap !== null || constrain),
    )
    const { rotation: _, ...rest } = object
    return (turned === 0 ? rest : { ...rest, rotation: turned }) as PlanObject<S>
  }
  const corners = cornersOf(object)
  const corner = name as Corner
  const anchor = corners[OPPOSITE[corner]]
  const moved = add(corners[corner], total)
  // The drag in the object's own frame — its x and y axes turned with it.
  const a = (rotation * Math.PI) / 180
  const u = { x: Math.cos(a), y: Math.sin(a) }
  const v = { x: -Math.sin(a), y: Math.cos(a) }
  const d = { x: moved.x - anchor.x, y: moved.y - anchor.y }
  let du = d.x * u.x + d.y * u.y
  let dv = d.x * v.x + d.y * v.y
  if (constrain) {
    // Proportions kept — the box grows by whichever side was pulled further, the other follows.
    const k = Math.max(Math.abs(du) / object.w, Math.abs(dv) / object.h)
    du = Math.sign(du || 1) * object.w * k
    dv = Math.sign(dv || 1) * object.h * k
  }
  const step = snap ? snap.cell / 2 : 1
  let w = Math.max(step, roundTo(Math.abs(du), step))
  let h = Math.max(step, roundTo(Math.abs(dv), step))
  const mid = {
    x: anchor.x + (u.x * (Math.sign(du || 1) * w)) / 2 + (v.x * (Math.sign(dv || 1) * h)) / 2,
    y: anchor.y + (u.y * (Math.sign(du || 1) * w)) / 2 + (v.y * (Math.sign(dv || 1) * h)) / 2,
  }
  let x = Math.round(mid.x - w / 2)
  let y = Math.round(mid.y - h / 2)
  if (!rotation) {
    // A level box never grows past the plan edge.
    x = Math.max(0, x)
    y = Math.max(0, y)
    w = Math.min(w, Math.max(1, plan.width - x))
    h = Math.min(h, Math.max(1, plan.height - y))
  }
  const resized = { ...object, x, y, w, h }
  if (resized.kind !== 'place') return resized
  const section = seatPlan.sectionAt(plan, seatPlan.centerOf(resized)) ?? resized.section
  return { ...resized, section }
}

// The corners of a turned box, by the name they have on the unturned one.
function cornersOf(box: PlanBox): Record<Corner, PlanPoint> {
  const [nw, ne, se, sw] = outlineOf(box, 'rect') as [PlanPoint, PlanPoint, PlanPoint, PlanPoint]
  return { nw, ne, se, sw }
}

// The rotation knob — above the middle of the top edge, turned with the box.
function knobOf(box: PlanBox): PlanPoint {
  const center = seatPlan.centerOf(box)
  return rotatePoint({ x: center.x, y: box.y - KNOB_OFFSET }, center, box.rotation ?? 0)
}

// A turn the short way round (−180 < turn ≤ 180), so a group facing 350° turned to 10° moves by 20°, not −340°.
function shortest(degrees: number): number {
  const d = normalizeRotation(degrees)
  return d > 180 ? d - 360 : d
}

// The direction from `from` to `to`, in degrees clockwise from +x.
function angleOf(from: PlanPoint, to: PlanPoint): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
}

// A turn in whole degrees — in ROTATION_STEP steps when snapping.
function stepped(degrees: number, snapping: boolean): number {
  return roundTo(degrees, snapping ? ROTATION_STEP : 1)
}

// A movement kept to the axis it went furthest along.
export function alongAxis(delta: PlanPoint): PlanPoint {
  return Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y }
}

const OPPOSITE: Record<Corner, Corner> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }

function isCorner(name: string): name is Corner {
  return (CORNERS as readonly string[]).includes(name)
}

function add(a: PlanPoint, b: PlanPoint): PlanPoint {
  return { x: a.x + b.x, y: a.y + b.y }
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
