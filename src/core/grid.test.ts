import { describe, expect, it } from 'vitest'
import { createSeatPlanSchema } from '../schema/index'
import { DEFAULT_SEAT_CELLS, GRID_CELL, HALF_CELL, seatGrid } from './grid'

const { SeatPlan } = createSeatPlanSchema({ sectionIds: ['A', 'B'] })

describe('seatGrid conversions', () => {
  it('a standard seat (88) is 2×2 cells — cells ↔ units round-trips', () => {
    expect(seatGrid.seatSpanCellsOf(88)).toBe(DEFAULT_SEAT_CELLS)
    expect(seatGrid.seatSpanPxOf(DEFAULT_SEAT_CELLS)).toBe(88)
    expect(seatGrid.seatSpanPxOf(seatGrid.seatSpanCellsOf(176))).toBe(180) // a wide seat absorbs into 4 cells
    expect(seatGrid.seatPxOf(seatGrid.seatCellOf(48))).toBe(48) // 48 = cell origin (1×46) + 2 — aligned stays
    expect(seatGrid.seatPxOf(seatGrid.seatCellOf(940))).toBe(922) // traced coordinates move to the nearest cell
  })

  it('placeSeat snaps to the nearest cell and clamps inside the plan by whole cells', () => {
    const plan = { width: 1000, height: 800 }
    expect(seatGrid.placeSeat(plan, { w: 88, h: 88 }, { x: 60, y: 40 })).toEqual({ x: 48, y: 48 })
    const clamped = seatGrid.placeSeat(plan, { w: 88, h: 88 }, { x: 5000, y: 5000 })
    expect(clamped.x + 88).toBeLessThanOrEqual(1000)
    expect(clamped.y + 88).toBeLessThanOrEqual(800)
    expect((clamped.x - 2) % GRID_CELL).toBe(0)
  })

  it('placeFixture snaps to half cells (23) and clamps inside the plan', () => {
    const plan = { width: 1000, height: 800 }
    // No inset, so a fixture can sit on a cell edge (46) or mid-cell (69).
    expect(seatGrid.placeFixture(plan, { w: 23, h: 184 }, { x: 50, y: 70 })).toEqual({ x: 46, y: 69 })
    const clamped = seatGrid.placeFixture(plan, { w: 23, h: 184 }, { x: 5000, y: 5000 })
    expect(clamped.x + 23).toBeLessThanOrEqual(1000)
    expect(clamped.y + 184).toBeLessThanOrEqual(800)
    expect(clamped.x % HALF_CELL).toBe(0)
    expect(clamped.y % HALF_CELL).toBe(0)
  })

  it('cellOriginAt gives the seat origin of the cell containing the point (floor)', () => {
    expect(seatGrid.cellOriginAt({ x: 45, y: 45 })).toEqual({ x: 2, y: 2 })
    expect(seatGrid.cellOriginAt({ x: 46, y: 92 })).toEqual({ x: 48, y: 94 })
  })
})

describe('seatGrid.normalize', () => {
  it('a traced pre-grid plan stays valid after alignment — no overlap, bounds or duplicate issues', () => {
    const normalized = seatGrid.normalize(tracedPlan())
    expect(() => SeatPlan.parse(normalized)).not.toThrow()
    for (const desk of normalized.objects) {
      if (desk.kind !== 'desk') continue
      expect((desk.x - 2) % GRID_CELL, desk.id).toBe(0)
      expect((desk.w + 4) % GRID_CELL, desk.id).toBe(0)
    }
    for (const section of normalized.sections) {
      for (const point of section.points) expect(point.x % GRID_CELL, section.id).toBe(0)
    }
  })

  it('is idempotent', () => {
    const once = seatGrid.normalize(tracedPlan())
    expect(seatGrid.normalize(once)).toEqual(once)
  })
})

// A real traced plan from before the grid existed (92-unit rhythm, a few odd sizes), stored in the 0.1 format —
// parsing upgrades it.
type V1Seat = { id: string; zone: 'A' | 'B'; x: number; y: number; w: number; h: number; chairSide: 'down' }

function tracedPlan() {
  const S = 88
  const STEP = 92
  const vstack = (zone: 'A' | 'B', from: number, count: number, x: number, y: number): V1Seat[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `${zone}${from + i}`,
      zone,
      x,
      y: y + i * STEP,
      w: S,
      h: S,
      chairSide: 'down',
    }))
  const hrow = (zone: 'A' | 'B', from: number, count: number, x: number, y: number): V1Seat[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `${zone}${from + i}`,
      zone,
      x: x + i * STEP,
      y,
      w: S,
      h: S,
      chairSide: 'down',
    }))
  const quad = (zone: 'A' | 'B', from: number, x: number, y: number) => [
    ...hrow(zone, from, 2, x, y),
    ...hrow(zone, from + 2, 2, x, y + STEP),
  ]
  return SeatPlan.parse({
    width: 2000,
    height: 1414,
    zones: [
      { id: 'A', x: 915, y: 18, w: 1075, h: 777 },
      { id: 'B', x: 20, y: 630, w: 890, h: 742 },
    ],
    seats: [
      ...vstack('A', 1, 4, 940, 60),
      { id: 'A5', zone: 'A', x: 940, y: 444, w: S, h: S },
      ...vstack('A', 6, 4, 1140, 60),
      ...vstack('A', 10, 4, 1232, 60),
      { id: 'A14', zone: 'A', x: 1520, y: 140, w: 176, h: S },
      { id: 'A16', zone: 'A', x: 1700, y: 140, w: 176, h: S },
      { id: 'A15', zone: 'A', x: 1520, y: 232, w: 176, h: S },
      { id: 'A17', zone: 'A', x: 1700, y: 232, w: 176, h: S },
      { id: 'A18', zone: 'A', x: 1878, y: 58, w: 82, h: 176 },
      { id: 'A19', zone: 'A', x: 1878, y: 238, w: 82, h: 176 },
      ...hrow('B', 1, 4, 75, 752),
      ...hrow('B', 13, 4, 515, 752),
      ...quad('B', 5, 160, 894),
      ...quad('B', 17, 605, 894),
      ...quad('B', 9, 160, 1134),
      ...quad('B', 21, 605, 1134),
    ],
  })
}
