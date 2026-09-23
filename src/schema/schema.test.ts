import { describe, expect, it } from 'vitest'
import { MIN_SEAT_SIZE, type FixtureKind } from '../index'
import { createSeatPlanSchema, seatPlanIssueOf } from './index'

const { SeatPlan } = createSeatPlanSchema({ zoneIds: ['A', 'B'] })

// Minimal plan — two zones side by side; seats vary per case.
const base = {
  width: 1000,
  height: 800,
  zones: [
    { id: 'A', x: 0, y: 0, w: 500, h: 800 },
    { id: 'B', x: 500, y: 0, w: 500, h: 800 },
  ],
}

function seat(id: string, zone: 'A' | 'B', x: number, y: number, size = 80) {
  return { id, zone, x, y, w: size, h: size, chairSide: 'down' as const }
}

function fixture(id: string, kind: FixtureKind, x: number, y: number, w: number, h: number) {
  return { id, kind, x, y, w, h }
}

function issuesOf(input: unknown) {
  const result = SeatPlan.safeParse(input)
  return result.success ? [] : result.error.issues.map(seatPlanIssueOf)
}

describe('SeatPlan schema (editor save guard)', () => {
  it('parses a valid plan', () => {
    const plan = SeatPlan.parse({ ...base, seats: [seat('A1', 'A', 20, 20), seat('B1', 'B', 520, 20)] })
    expect(plan.seats).toHaveLength(2)
  })

  it('rejects duplicate seat ids (referential integrity of records that point at seats)', () => {
    expect(issuesOf({ ...base, seats: [seat('A1', 'A', 20, 20), seat('A1', 'A', 200, 20)] })).toContainEqual({
      code: 'duplicate_seat_id',
      seatId: 'A1',
    })
  })

  it('rejects zones outside the configured ids', () => {
    expect(SeatPlan.safeParse({ ...base, seats: [seat('C1', 'C' as 'A', 20, 20)] }).success).toBe(false)
  })

  it('rejects overlapping seats but allows touching edges', () => {
    expect(issuesOf({ ...base, seats: [seat('A1', 'A', 20, 20), seat('A2', 'A', 60, 60)] })).toContainEqual({
      code: 'seat_overlap',
      seatIds: ['A1', 'A2'],
    })
    // A2 starts exactly at A1's right edge (x=100) — a zero gap is not an overlap.
    expect(SeatPlan.safeParse({ ...base, seats: [seat('A1', 'A', 20, 20), seat('A2', 'A', 100, 20)] }).success).toBe(
      true,
    )
  })

  it('rejects seats outside the plan', () => {
    expect(issuesOf({ ...base, seats: [seat('A1', 'A', 960, 20)] })).toContainEqual({
      code: 'seat_out_of_bounds',
      seatId: 'A1',
    })
    expect(SeatPlan.safeParse({ ...base, seats: [seat('A1', 'A', -10, 20)] }).success).toBe(false)
  })

  it('rejects seats below the minimum size', () => {
    expect(SeatPlan.safeParse({ ...base, seats: [seat('A1', 'A', 20, 20, MIN_SEAT_SIZE - 2)] }).success).toBe(false)
  })

  it('rejects fixtures overlapping seats, but fixtures may overlap each other', () => {
    const seats = [seat('A1', 'A', 20, 20)]
    const parse = (fixtures: ReturnType<typeof fixture>[]) => SeatPlan.safeParse({ ...base, seats, fixtures }).success
    // A wall against A1's right edge (x 20~100) passes; one cutting into the seat is a placement mistake.
    expect(parse([fixture('wall-1', 'wall', 100, 20, 23, 184)])).toBe(true)
    expect(issuesOf({ ...base, seats, fixtures: [fixture('wall-1', 'wall', 77, 20, 23, 184)] })).toContainEqual({
      code: 'fixture_seat_overlap',
      fixtureId: 'wall-1',
      kind: 'wall',
      seatId: 'A1',
    })
    // A TV hung on a wall — fixtures may overlap.
    expect(parse([fixture('wall-1', 'wall', 200, 20, 23, 184), fixture('tv-1', 'tv', 200, 40, 23, 138)])).toBe(true)
  })

  it('rejects fixtures outside the plan', () => {
    expect(issuesOf({ ...base, seats: [], fixtures: [fixture('wall-1', 'wall', 990, 20, 23, 184)] })).toContainEqual({
      code: 'fixture_out_of_bounds',
      fixtureId: 'wall-1',
      kind: 'wall',
    })
  })

  it('reads documents without fixtures as a plan without fixtures (saved before the field existed)', () => {
    expect(SeatPlan.parse({ ...base, seats: [] }).fixtures).toEqual([])
  })

  it('reads seats without a chair side as chairs below the desk (saved before the field existed)', () => {
    const { chairSide: _, ...legacy } = seat('A1', 'A', 20, 20)
    expect(SeatPlan.parse({ ...base, seats: [legacy] }).seats[0]?.chairSide).toBe('down')
  })

  it('leaves field-level zod issues to the zod error map', () => {
    const result = SeatPlan.safeParse({ ...base, seats: [seat('', 'A', 20, 20)] })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map(seatPlanIssueOf)).toEqual([null])
  })
})
