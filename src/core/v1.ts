import type { PlanRect, SeatChairSide, SeatPlan } from './types'

// Version 1 of the document (ichno 0.1) — rooms ("zones") holding desk seats, plus wall/TV/counter fixtures.
// Consumers stored these, so they must keep opening: `ichno/schema` upgrades them on parse, and
// `upgradeSeatPlan` does the same for callers that already trust their data.

export type SeatPlanV1<Z extends string = string> = {
  width: number
  height: number
  zones: (PlanRect & { id: Z })[]
  seats: (PlanRect & { id: string; zone: Z; chairSide: SeatChairSide })[]
  fixtures: (PlanRect & { id: string; kind: 'wall' | 'tv' | 'counter' })[]
}

// v1 → v2. Zones become rectangular sections, seats become desks and fixtures keep their kind as the role.
// Fixtures go first: v1 drew them under the seats, and object order is drawing order.
// v1 kept seat and fixture ids in separate lists; v2 has one namespace. Fixture ids were editor handles that no
// other record references, so a fixture whose id a seat also uses is renamed `<kind>-<n>`.
export function upgradeSeatPlan<Z extends string>(plan: SeatPlanV1<Z>): SeatPlan<Z> {
  const seatIds = new Set(plan.seats.map((seat) => seat.id))
  const taken = new Set([...seatIds, ...plan.fixtures.map((fixture) => fixture.id)])
  const fixtureIdOf = (fixture: SeatPlanV1['fixtures'][number]) => {
    if (!seatIds.has(fixture.id)) return fixture.id
    let n = 1
    while (taken.has(`${fixture.kind}-${n}`)) n++
    const id = `${fixture.kind}-${n}`
    taken.add(id)
    return id
  }
  return {
    version: 2,
    width: plan.width,
    height: plan.height,
    sections: plan.zones.map((zone) => ({
      id: zone.id,
      points: [
        { x: zone.x, y: zone.y },
        { x: zone.x + zone.w, y: zone.y },
        { x: zone.x + zone.w, y: zone.y + zone.h },
        { x: zone.x, y: zone.y + zone.h },
      ],
    })),
    categories: [],
    objects: [
      ...plan.fixtures.map((f) => ({
        kind: 'fixture' as const,
        id: fixtureIdOf(f),
        role: f.kind,
        x: f.x,
        y: f.y,
        w: f.w,
        h: f.h,
      })),
      ...plan.seats.map((s) => ({
        kind: 'desk' as const,
        id: s.id,
        section: s.zone,
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        chairSide: s.chairSide,
      })),
    ],
  }
}
