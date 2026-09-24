import { describe, expect, it } from 'vitest'
import { MIN_SEAT_SIZE, type SeatPlan } from '../index'
import { createSeatPlanSchema, seatPlanIssueOf } from './index'

const { SeatPlan: Schema } = createSeatPlanSchema({ sectionIds: ['A', 'B'] })

// Minimal plan — two sections side by side; objects vary per case.
const base = {
  version: 2,
  width: 1000,
  height: 800,
  sections: [
    { id: 'A', points: rect(0, 0, 500, 800) },
    { id: 'B', points: rect(500, 0, 500, 800) },
  ],
  categories: [] as { key: string }[],
}

function rect(x: number, y: number, w: number, h: number) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

function desk(id: string, section: string, x: number, y: number, size = 80) {
  return { kind: 'desk', id, section, x, y, w: size, h: size, chairSide: 'down' }
}

function fixture(id: string, role: string, x: number, y: number, w: number, h: number) {
  return { kind: 'fixture', id, role, x, y, w, h }
}

function row(id: string, seatIds: string[], y = 400) {
  return {
    kind: 'row',
    id,
    section: 'A',
    start: { x: 40, y },
    end: { x: 400, y },
    curve: 0,
    seatSize: 40,
    seats: seatIds.map((seatId) => ({ id: seatId })),
  }
}

function planWith(objects: unknown[], extra: object = {}) {
  return { ...base, ...extra, objects }
}

function issuesOf(input: unknown) {
  const result = Schema.safeParse(input)
  return result.success ? [] : result.error.issues.map(seatPlanIssueOf)
}

describe('SeatPlan schema (editor save guard)', () => {
  it('parses a valid plan', () => {
    const plan = Schema.parse(planWith([desk('A1', 'A', 20, 20), desk('B1', 'B', 520, 20), row('row-1', ['A2', 'A3'])]))
    expect(plan.objects).toHaveLength(3)
  })

  it('rejects duplicate ids across objects and the seats inside rows (records point at them)', () => {
    expect(issuesOf(planWith([desk('A1', 'A', 20, 20), desk('A1', 'A', 200, 20)]))).toContainEqual({
      code: 'duplicate_id',
      id: 'A1',
    })
    expect(issuesOf(planWith([desk('A1', 'A', 20, 20), row('row-1', ['A2', 'A1'])]))).toContainEqual({
      code: 'duplicate_id',
      id: 'A1',
    })
  })

  it('rejects sections outside the configured ids', () => {
    expect(Schema.safeParse(planWith([desk('C1', 'C', 20, 20)])).success).toBe(false)
  })

  it('rejects overlapping footprints but allows touching edges', () => {
    expect(issuesOf(planWith([desk('A1', 'A', 20, 20), desk('A2', 'A', 60, 60)]))).toContainEqual({
      code: 'overlap',
      ids: ['A1', 'A2'],
    })
    // A2 starts exactly at A1's right edge (x=100) — a zero gap is not an overlap.
    expect(Schema.safeParse(planWith([desk('A1', 'A', 20, 20), desk('A2', 'A', 100, 20)])).success).toBe(true)
  })

  it('rejects objects outside the plan, row seats included', () => {
    expect(issuesOf(planWith([desk('A1', 'A', 960, 20)]))).toContainEqual({ code: 'out_of_bounds', id: 'A1' })
    expect(issuesOf(planWith([row('row-1', ['A1'], 790)]))).toContainEqual({ code: 'out_of_bounds', id: 'row-1' })
  })

  it('rejects desks below the minimum size', () => {
    expect(Schema.safeParse(planWith([desk('A1', 'A', 20, 20, MIN_SEAT_SIZE - 2)])).success).toBe(false)
  })

  it('rejects fixtures on places, but fixtures may overlap each other', () => {
    const seats = [desk('A1', 'A', 20, 20)]
    const parse = (fixtures: unknown[]) => Schema.safeParse(planWith([...fixtures, ...seats])).success
    // A wall against A1's right edge (x 20~100) passes; one cutting into the desk is a placement mistake.
    expect(parse([fixture('wall-1', 'wall', 100, 20, 23, 184)])).toBe(true)
    expect(issuesOf(planWith([fixture('wall-1', 'wall', 77, 20, 23, 184), ...seats]))).toContainEqual({
      code: 'fixture_overlap',
      fixtureId: 'wall-1',
      role: 'wall',
      id: 'A1',
    })
    // A TV hung on a wall — fixtures may overlap.
    expect(parse([fixture('wall-1', 'wall', 200, 20, 23, 184), fixture('tv-1', 'tv', 200, 40, 23, 138)])).toBe(true)
  })

  it('rejects categories the plan does not define', () => {
    const tagged = { ...desk('A1', 'A', 20, 20), category: 'vip' }
    expect(issuesOf(planWith([tagged]))).toContainEqual({ code: 'unknown_category', id: 'A1', category: 'vip' })
    expect(Schema.safeParse(planWith([tagged], { categories: [{ key: 'vip' }] })).success).toBe(true)
  })

  it('reads a plan without categories as one that uses none', () => {
    const { categories: _, ...noCategories } = planWith([])
    expect(Schema.parse(noCategories).categories).toEqual([])
  })

  it('leaves field-level zod issues to the zod error map', () => {
    const result = Schema.safeParse(planWith([desk('', 'A', 20, 20)]))
    expect(result.success).toBe(false)
    expect(result.error?.issues.map(seatPlanIssueOf)).toEqual([null])
  })
})

describe('SeatPlan schema — documents stored by ichno 0.1', () => {
  const v1 = {
    width: 1000,
    height: 800,
    zones: [
      { id: 'A', x: 0, y: 0, w: 500, h: 800 },
      { id: 'B', x: 500, y: 0, w: 500, h: 800 },
    ],
    seats: [{ id: 'A1', zone: 'A', x: 20, y: 20, w: 80, h: 80, chairSide: 'up' }],
    fixtures: [{ id: 'tv-1', kind: 'tv', x: 200, y: 20, w: 23, h: 138 }],
  }

  it('upgrades them to version 2 while parsing', () => {
    const plan: SeatPlan<'A' | 'B'> = Schema.parse(v1)
    expect(plan.version).toBe(2)
    expect(plan.sections[0]).toEqual({ id: 'A', points: rect(0, 0, 500, 800) })
    // Fixtures first — v1 drew them under the seats.
    expect(plan.objects).toEqual([
      { kind: 'fixture', id: 'tv-1', role: 'tv', x: 200, y: 20, w: 23, h: 138 },
      { kind: 'desk', id: 'A1', section: 'A', x: 20, y: 20, w: 80, h: 80, chairSide: 'up' },
    ])
  })

  it('reads documents without fixtures (saved before the field existed)', () => {
    const { fixtures: _, ...legacy } = v1
    expect(Schema.parse(legacy).objects).toHaveLength(1)
  })

  it('reads seats without a chair side as chairs below the desk (saved before the field existed)', () => {
    const { chairSide: _, ...seat } = v1.seats[0]!
    const plan = Schema.parse({ ...v1, seats: [seat] })
    expect(plan.objects.find((o) => o.kind === 'desk')).toMatchObject({ chairSide: 'down' })
  })

  it('applies the v2 rules to the upgraded document', () => {
    const clash = { ...v1, seats: [v1.seats[0], { ...v1.seats[0], x: 300 }] }
    expect(issuesOf(clash)).toContainEqual({ code: 'duplicate_id', id: 'A1' })
  })

  it('reports a broken v1 structure on v1 paths', () => {
    const result = Schema.safeParse({ ...v1, seats: [{ ...v1.seats[0], zone: 'C' }] })
    expect(result.error?.issues[0]?.path).toEqual(['seats', 0, 'zone'])
  })
})
