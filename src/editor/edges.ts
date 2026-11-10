import { seatPlan } from '../core/geometry'
import { outlineOf } from '../core/math'
import type { PlanObject, PlanPoint, SeatPlan } from '../core/types'

// Pushing an edge across itself — the one piece a section's outline (./handles.ts) and a wall's centre line
// (./walls.ts) share: how far the edge may go, where a level one lands, and what stands against it to be carried.

// An edge from `a`, `length` along the unit direction `along`.
export type Edge = { a: PlanPoint; along: PlanPoint; length: number }

const EPSILON = 1e-9

// How far an edge can be pushed across itself (negative: the other way) — a step short of every other corner it would
// pass over, and no further than the plan's edge. The edge runs from point `index` to point `next`; staying put is
// always in range.
export function pushRange(
  plan: Pick<SeatPlan, 'width' | 'height'>,
  points: readonly PlanPoint[],
  index: number,
  next: number,
  { a, along, length }: Edge,
  across: PlanPoint,
  step: number,
): [number, number] {
  let low = -Infinity
  let high = Infinity
  points.forEach((p, i) => {
    if (i === index || i === next) return
    const u = (p.x - a.x) * along.x + (p.y - a.y) * along.y
    const v = (p.x - a.x) * across.x + (p.y - a.y) * across.y

    if (u < -EPSILON || u > length + EPSILON) return

    if (v > EPSILON) high = Math.min(high, v - step)
    else if (v < -EPSILON) low = Math.max(low, v + step)
  })

  for (const p of [a, { x: a.x + along.x * length, y: a.y + along.y * length }]) {
    for (const [n, start, extent] of [
      [across.x, p.x, plan.width],
      [across.y, p.y, plan.height],
    ] as const) {
      if (Math.abs(n) < EPSILON) continue
      const [t1, t2] = [-start / n, (extent - start) / n]
      low = Math.max(low, Math.min(t1, t2))
      high = Math.min(high, Math.max(t1, t2))
    }
  }

  return [Math.min(low, 0), Math.max(high, 0)]
}

// The push `wanted` from `a` across a level or upright edge, landing the edge on the nearest step line.
export function onLine(a: PlanPoint, across: PlanPoint, wanted: number, step: number): number {
  const axis = across.x === 0 ? 'y' : 'x'
  const sign = across[axis]

  return (Math.round((a[axis] + wanted * sign) / step) * step - a[axis]) * sign
}

// Whether a fixture stands against an edge or across it — its outline within `reach` of the edge's line, its centre
// beside the edge rather than past one end.
export function against(object: PlanObject, { a, along, length }: Edge, across: PlanPoint, reach: number): boolean {
  const center = seatPlan.centerOf(object)
  const u = (center.x - a.x) * along.x + (center.y - a.y) * along.y

  if (u < 0 || u > length) return false
  const offsets = outlineOf(object, 'rect').map((p) => (p.x - a.x) * across.x + (p.y - a.y) * across.y)

  return Math.min(...offsets) <= reach && Math.max(...offsets) >= -reach
}
