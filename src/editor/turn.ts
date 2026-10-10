import { seatPlan } from '../core/geometry'
import { normalizeRotation, roundHalfEven, rotatePoint } from '../core/math'
import type { PlanBox, PlanObject, PlanPoint, SeatPlan } from '../core/types'

// Turning — shared by the rotation knob (`planHandles`) and `planEdits.rotate`.
//
// A group turns about the centre of its frame (the box around its members, level in the direction the group
// faces) and the direction turns with it, so the centre stays put however often the group is turned. Its extent
// (the level box) would not: the box around a turned row is a different box, and every turn would wander.

// The box an object or group occupies — an object's turned box, a group's frame. null when the id is neither.
export function boxOf(plan: SeatPlan<string>, id: string): PlanBox | null {
  const group = seatPlan.groupById(plan, id)

  if (group) return seatPlan.frameOf(seatPlan.membersOf(plan, id), group.rotation ?? 0)

  return seatPlan.objectById(plan, id) ?? null
}

// What an object or group turns about — the centre of its box.
export function pivotOf(plan: SeatPlan<string>, id: string): PlanPoint | null {
  const box = boxOf(plan, id)

  return box ? seatPlan.centerOf(box) : null
}

// Objects turned clockwise by `degrees` — about `pivot` as one (their centres move round it), or each about its
// own centre when there is none. Labels move round but stay level; places re-home to their new section. Centres
// are rounded half to even, so repeated turns do not all push the same way.
export function turnObjects<S extends string>(
  plan: SeatPlan<S>,
  objects: readonly PlanObject<S>[],
  pivot: PlanPoint | null,
  degrees: number,
): SeatPlan<S> {
  if (!degrees) return plan

  const turned = new Map<string, PlanObject<S>>(
    objects.map((o): [string, PlanObject<S>] => {
      const c = pivot ? rotatePoint(seatPlan.centerOf(o), pivot, degrees) : seatPlan.centerOf(o)
      const rotation = o.kind === 'label' ? (o.rotation ?? 0) : normalizeRotation((o.rotation ?? 0) + degrees)
      const { rotation: _, ...rest } = o
      const box = { ...rest, x: roundHalfEven(c.x - o.w / 2), y: roundHalfEven(c.y - o.h / 2) }
      const next = rotation === 0 ? box : { ...box, rotation }

      if (next.kind !== 'place') return [o.id, next]

      return [o.id, { ...next, section: seatPlan.sectionAt(plan, c) ?? next.section }]
    }),
  )

  return { ...plan, objects: plan.objects.map((o) => turned.get(o.id) ?? o) }
}

// A group facing `rotation` (left out when level).
export function withGroupRotation<S extends string>(plan: SeatPlan<S>, id: string, rotation: number): SeatPlan<S> {
  const r = normalizeRotation(rotation)

  return {
    ...plan,
    groups: plan.groups.map((g) => {
      if (g.id !== id) return g
      const { rotation: _, ...rest } = g

      return r === 0 ? rest : { ...rest, rotation: r }
    }),
  }
}

// A group turned as one about its frame's centre, its direction with it.
export function turnGroup<S extends string>(plan: SeatPlan<S>, id: string, degrees: number): SeatPlan<S> {
  const group = seatPlan.groupById(plan, id)
  const pivot = pivotOf(plan, id)

  if (!group || !pivot || !degrees) return plan
  const turned = turnObjects(plan, seatPlan.membersOf(plan, id), pivot, degrees)

  return withGroupRotation(turned, id, (group.rotation ?? 0) + degrees)
}
