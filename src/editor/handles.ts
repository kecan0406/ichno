import { seatPlan } from '../core/geometry'
import { normalizeRotation, outlineOf, rotatePoint } from '../core/math'
import type { HandleOwner, PlanBox, PlanHandle, PlanObject, PlanPoint, SeatPlan } from '../core/types'
import type { EditorSelection } from './selection'
import type { Snap } from './operations'
import { boxOf, turnObjects, withGroupRotation } from './turn'

// Editing handles — which ones a selection shows and what dragging one does. Pure, like the other operations:
// the editor hook shows `handlesOf` and commits `dragHandle` with the snapping its preview used.
//
// An object resizes from its corners (the opposite corner staying put, in the object's own turned frame) and
// turns from the knob above its top edge. A group turns as one from the knob above its frame — the box around its
// members in the direction it faces — so the knob, the frame and the centre turn with it. Sections move one
// vertex at a time. Handles show for a single selected item only.

export const planHandles = {
  of: handlesOf,
  drag: dragHandle,
  frame: frameOf,
}

const CORNERS = ['nw', 'ne', 'se', 'sw'] as const
type Corner = (typeof CORNERS)[number]

// How far the rotation knob sits above the top edge (plan units).
const KNOB_OFFSET = 28
// The turn a snapping editor steps by (degrees).
const ROTATION_STEP = 15

function handlesOf<S extends string>(plan: SeatPlan<S>, selection: readonly EditorSelection<S>[]): PlanHandle<S>[] {
  if (selection.length !== 1) return []
  const [item] = selection as [EditorSelection<S>]
  if (item.kind === 'section') {
    const section = seatPlan.sectionOf(plan, item.id)
    if (!section) return []
    return section.points.map((point, i) => ({ owner: item, name: `vertex-${i}`, point }))
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

// The outline of the single selected object or group — its turned box, or the group's frame (nw, ne, se, sw).
// Draw it with the handles so a turned group shows the box it turns about. null for anything else.
function frameOf<S extends string>(plan: SeatPlan<S>, selection: readonly EditorSelection<S>[]): PlanPoint[] | null {
  if (selection.length !== 1 || selection[0]!.kind === 'section') return null
  const box = boxOf(plan, selection[0]!.id)
  return box ? outlineOf(box, 'rect') : null
}

// The plan with a handle dragged by `total` plan units. Unknown handles leave the plan as it is.
function dragHandle<S extends string>(
  plan: SeatPlan<S>,
  owner: HandleOwner<S>,
  name: string,
  total: PlanPoint,
  snap: Snap | null = null,
): SeatPlan<S> {
  if (owner.kind === 'section') {
    const index = Number(name.replace('vertex-', ''))
    const step = snap ? snap.cell : 1
    return {
      ...plan,
      sections: plan.sections.map((section) => {
        if (section.id !== owner.id || !section.points[index]) return section
        const points = section.points.map((p, i) =>
          i === index
            ? {
                x: clamp(roundTo(p.x + total.x, step), 0, Math.floor(plan.width / step) * step),
                y: clamp(roundTo(p.y + total.y, step), 0, Math.floor(plan.height / step) * step),
              }
            : p,
        )
        return { ...section, points }
      }),
    }
  }
  if (name !== 'rotate' && !isCorner(name)) return plan
  if (owner.kind === 'group') {
    const group = seatPlan.groupById(plan, owner.id)
    const frame = boxOf(plan, owner.id)
    if (name !== 'rotate' || !group || !frame) return plan
    // The knob sets the direction the group faces; the members turn by the difference, about the frame's centre.
    const center = seatPlan.centerOf(frame)
    const facing = stepped(angleOf(center, add(knobOf(frame), total)) + 90, snap)
    const turn = shortest(facing - (group.rotation ?? 0))
    const turned = turnObjects(plan, seatPlan.membersOf(plan, owner.id), center, turn)
    return withGroupRotation(turned, owner.id, facing)
  }
  return {
    ...plan,
    objects: plan.objects.map((object) =>
      object.id === owner.id ? reshaped(plan, object, name, total, snap) : object,
    ),
  }
}

function reshaped<S extends string>(
  plan: SeatPlan<S>,
  object: PlanObject<S>,
  name: string,
  total: PlanPoint,
  snap: Snap | null,
): PlanObject<S> {
  const rotation = object.rotation ?? 0
  const center = seatPlan.centerOf(object)
  if (name === 'rotate') {
    const turned = normalizeRotation(stepped(angleOf(center, add(knobOf(object), total)) + 90, snap))
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
  const du = d.x * u.x + d.y * u.y
  const dv = d.x * v.x + d.y * v.y
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
function stepped(degrees: number, snap: Snap | null): number {
  return roundTo(degrees, snap ? ROTATION_STEP : 1)
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
