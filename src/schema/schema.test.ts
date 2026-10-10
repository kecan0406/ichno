import { describe, expect, it } from 'vitest'
import type { Fixture, Place, SeatPlan, Wall } from '../index'
import { createSeatPlanSchema, seatPlanIssueOf } from './index'

const { SeatPlan: Schema } = createSeatPlanSchema({ sectionIds: ['A', 'B'] })

// Minimal plan — two sections side by side; objects vary per case.
const base = {
  version: 3,
  width: 1000,
  height: 800,
  sections: [
    { id: 'A', points: rect(0, 0, 500, 800) },
    { id: 'B', points: rect(500, 0, 500, 800) },
  ],
  categories: [],
  groups: [],
}

function rect(x: number, y: number, w: number, h: number) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

function place(id: string, section: string, x: number, y: number, extra: Partial<Place> = {}) {
  return { kind: 'place', id, section, x, y, w: 80, h: 80, shape: 'rect', capacity: 1, ...extra }
}

function fixture(id: string, x: number, y: number, w: number, h: number, extra: Partial<Fixture> = {}) {
  return { kind: 'fixture', id, shape: 'rect', x, y, w, h, ...extra }
}

function planWith(objects: unknown[], extra: Partial<SeatPlan> = {}) {
  return { ...base, ...extra, objects }
}

// The plan-level issues of a parse — none when it succeeded.
function issuesOf(result: ReturnType<typeof Schema.safeParse>) {
  return result.success ? [] : result.error.issues.map(seatPlanIssueOf)
}

describe('SeatPlan schema (editor save guard)', () => {
  it('parses a valid plan', () => {
    const plan = Schema.parse(
      planWith(
        [
          place('A1', 'A', 20, 20, { group: 'row-1', role: 'seat' }),
          place('B1', 'B', 520, 20, { rotation: 30 }),
          fixture('stage', 20, 600, 400, 92, { role: 'stage' }),
          { kind: 'label', id: 'row-1-l', group: 'row-1', x: -30, y: 20, w: 40, h: 40 },
        ],
        { groups: [{ id: 'row-1', label: 'A', role: 'row' }] },
      ),
    )

    expect(plan.objects).toHaveLength(4)
  })

  it('reads a place without capacity as holding one', () => {
    const { capacity: _, ...seat } = place('A1', 'A', 20, 20)
    expect(Schema.parse(planWith([seat])).objects[0]).toMatchObject({ capacity: 1 })
  })

  it('rejects duplicate ids across objects and groups (records point at them)', () => {
    expect(issuesOf(Schema.safeParse(planWith([place('A1', 'A', 20, 20), place('A1', 'A', 200, 20)])))).toContainEqual({
      code: 'duplicate_id',
      id: 'A1',
    })
    expect(issuesOf(Schema.safeParse(planWith([place('A1', 'A', 20, 20)], { groups: [{ id: 'A1' }] })))).toContainEqual(
      {
        code: 'duplicate_id',
        id: 'A1',
      },
    )
  })

  it('rejects objects in a group the plan does not define', () => {
    expect(issuesOf(Schema.safeParse(planWith([place('A1', 'A', 20, 20, { group: 'row-1' })])))).toContainEqual({
      code: 'unknown_group',
      id: 'A1',
      group: 'row-1',
    })
  })

  it('rejects sections outside the configured ids', () => {
    expect(Schema.safeParse(planWith([place('C1', 'C', 20, 20)])).success).toBe(false)
  })

  it('rejects overlapping places but allows touching edges', () => {
    expect(issuesOf(Schema.safeParse(planWith([place('A1', 'A', 20, 20), place('A2', 'A', 60, 60)])))).toContainEqual({
      code: 'overlap',
      ids: ['A1', 'A2'],
    })
    // A2 starts exactly at A1's right edge (x=100) — a zero gap is not an overlap.
    expect(Schema.safeParse(planWith([place('A1', 'A', 20, 20), place('A2', 'A', 100, 20)])).success).toBe(true)
  })

  it('tests overlap on the turned shape', () => {
    const bar = place('A1', 'A', 100, 190, { w: 200, h: 20 })
    const below = place('A2', 'A', 180, 220)
    expect(Schema.safeParse(planWith([bar, below])).success).toBe(true)
    expect(issuesOf(Schema.safeParse(planWith([{ ...bar, rotation: 90 }, below])))).toContainEqual({
      code: 'overlap',
      ids: ['A1', 'A2'],
    })
  })

  it('lets fixtures overlap places and each other — a chair at its desk, a TV on a wall', () => {
    const parse = (objects: unknown[]) => Schema.safeParse(planWith(objects)).success
    expect(parse([place('A1', 'A', 20, 20), fixture('chair', 40, 40, 30, 20)])).toBe(true)
    expect(parse([fixture('wall-1', 200, 20, 23, 184), fixture('tv-1', 200, 40, 23, 138)])).toBe(true)
  })

  it('rejects places and fixtures outside the plan, turned corners included; labels may sit in the margin', () => {
    expect(issuesOf(Schema.safeParse(planWith([place('A1', 'A', 960, 20)])))).toContainEqual({
      code: 'out_of_bounds',
      id: 'A1',
    })
    // Flush with the top edge until it is turned.
    expect(Schema.safeParse(planWith([place('A1', 'A', 20, 0)])).success).toBe(true)
    expect(issuesOf(Schema.safeParse(planWith([place('A1', 'A', 20, 0, { rotation: 45 })])))).toContainEqual({
      code: 'out_of_bounds',
      id: 'A1',
    })
    const label = { kind: 'label', id: 'l', group: 'g', x: -40, y: 20, w: 40, h: 40 }
    expect(Schema.safeParse(planWith([label], { groups: [{ id: 'g' }] })).success).toBe(true)
  })

  it('stores turns as 0 ≤ rotation < 360', () => {
    expect(Schema.safeParse(planWith([place('A1', 'A', 20, 20, { rotation: 360 })])).success).toBe(false)
    expect(Schema.safeParse(planWith([place('A1', 'A', 20, 20, { rotation: -15 })])).success).toBe(false)
    expect(Schema.safeParse(planWith([], { groups: [{ id: 'g', rotation: 30 }] })).success).toBe(true)
    expect(Schema.safeParse(planWith([], { groups: [{ id: 'g', rotation: 360 }] })).success).toBe(false)
  })

  it('rejects categories the plan does not define', () => {
    const tagged = place('A1', 'A', 20, 20, { category: 'vip' })
    expect(issuesOf(Schema.safeParse(planWith([tagged])))).toContainEqual({
      code: 'unknown_category',
      id: 'A1',
      category: 'vip',
    })
    expect(Schema.safeParse(planWith([tagged], { categories: [{ key: 'vip' }] })).success).toBe(true)
  })

  it('reads a plan without categories or groups as one that uses none', () => {
    const { categories: _, groups: __, ...bare } = planWith([])
    const plan = Schema.parse(bare)
    expect(plan.categories).toEqual([])
    expect(plan.groups).toEqual([])
    expect(plan.walls).toEqual([])
  })

  it('checks walls: ids shared with objects, the centre line on the plan, openings that fit their edge', () => {
    const wall = (id: string, extra: Partial<Wall> = {}) => ({
      id,
      points: rect(0, 0, 400, 300),
      thickness: 12,
      closed: true,
      ...extra,
    })

    expect(
      issuesOf(
        Schema.safeParse(planWith([], { walls: [wall('w1', { openings: [{ edge: 3, at: 100, width: 92 }] })] })),
      ),
    ).toEqual([])
    // Corners keep a hundredth of a unit — a turned metre of wall.
    expect(
      issuesOf(
        Schema.safeParse(
          planWith([], {
            walls: [
              wall('w2', {
                points: [
                  { x: 0, y: 0 },
                  { x: 98.48, y: 17.36 },
                ],
                closed: false,
              }),
            ],
          }),
        ),
      ),
    ).toEqual([])
    expect(issuesOf(Schema.safeParse(planWith([fixture('w1', 600, 20, 40, 40)], { walls: [wall('w1')] })))).toEqual([
      { code: 'duplicate_id', id: 'w1' },
    ])
    expect(
      issuesOf(Schema.safeParse(planWith([], { walls: [wall('w1', { points: rect(800, 0, 400, 300) })] }))),
    ).toEqual([{ code: 'out_of_bounds', id: 'w1' }])
    expect(
      issuesOf(
        Schema.safeParse(
          planWith([], {
            walls: [
              wall('w1', {
                openings: [
                  { edge: 0, at: 350, width: 92 },
                  { edge: 4, at: 0, width: 92 },
                ],
              }),
            ],
          }),
        ),
      ),
    ).toEqual([
      { code: 'opening_off_wall', id: 'w1', opening: 0 },
      { code: 'opening_off_wall', id: 'w1', opening: 1 },
    ])
  })

  it('leaves field-level zod issues to the zod error map', () => {
    const result = Schema.safeParse(planWith([place('', 'A', 20, 20)]))
    expect(result.success).toBe(false)
    expect(result.error?.issues.map(seatPlanIssueOf)).toEqual([null])
  })
})

describe('Template schema (saved objects)', () => {
  const { Template } = createSeatPlanSchema({ sectionIds: ['A'] })

  const template = {
    version: 3,
    groups: [{ id: 'row-1', role: 'row' }],
    objects: [
      { kind: 'place', id: 'A1', x: -20, y: -20, w: 40, h: 40, shape: 'ellipse', group: 'row-1' },
      { kind: 'label', id: 'row-1-l', group: 'row-1', x: 30, y: -20, w: 40, h: 40 },
    ],
  }

  it('reads places without a section — they take the one they land in', () => {
    expect(Template.parse(template).objects[0]).toMatchObject({ capacity: 1 })
  })

  it('checks its references like a document does', () => {
    const broken = Template.safeParse({
      ...template,
      objects: [...template.objects, fixture('A1', 0, 0, 10, 10, { group: 'row-9' })],
    })

    expect(broken.success ? [] : broken.error.issues.map(seatPlanIssueOf)).toEqual([
      { code: 'duplicate_id', id: 'A1' },
      { code: 'unknown_group', id: 'A1', group: 'row-9' },
    ])
  })
})

describe('SeatPlan schema — documents stored by ichno 0.2', () => {
  const v2 = {
    version: 2,
    width: 1000,
    height: 800,
    sections: [{ id: 'A', points: rect(0, 0, 500, 800) }],
    categories: [],
    objects: [
      { kind: 'booth', id: 'A1', section: 'A', x: 20, y: 20, w: 92, h: 92 },
      { kind: 'booth', id: 'A1', section: 'A', x: 200, y: 20, w: 92, h: 92 },
    ],
  }

  it('upgrades them while parsing and applies the current rules to the result', () => {
    expect(issuesOf(Schema.safeParse(v2))).toEqual([{ code: 'duplicate_id', id: 'A1' }])
    const plan = Schema.parse({ ...v2, objects: v2.objects.slice(0, 1) })
    expect(plan.version).toBe(3)
    expect(plan.objects).toEqual([
      { kind: 'place', id: 'A1', section: 'A', role: 'booth', x: 20, y: 20, w: 92, h: 92, shape: 'rect', capacity: 1 },
    ])
  })

  it('reports a broken v2 structure on v2 paths', () => {
    const result = Schema.safeParse({ ...v2, objects: [{ ...v2.objects[0], kind: 'sofa' }] })
    expect(result.error?.issues[0]?.path).toEqual(['objects', 0, 'kind'])
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

  it('upgrades them to the current version while parsing', () => {
    const plan: SeatPlan<'A' | 'B'> = Schema.parse(v1)
    expect(plan.version).toBe(3)
    expect(plan.sections[0]).toEqual({ id: 'A', points: rect(0, 0, 500, 800) })
    // Fixtures first — v1 drew them under the seats.
    expect(plan.objects.map((o) => [o.kind, o.id, o.kind === 'label' ? undefined : o.role])).toEqual([
      ['fixture', 'tv-1', 'tv'],
      ['place', 'A1', 'desk'],
      ['fixture', 'A1-c', 'chair'],
    ])
  })

  it('reads documents without fixtures (saved before the field existed)', () => {
    const { fixtures: _, ...legacy } = v1
    expect(Schema.parse(legacy).objects.map((o) => o.id)).toEqual(['A1', 'A1-c'])
  })

  it('reads seats without a chair side as chairs below the desk (saved before the field existed)', () => {
    const { chairSide: _, ...seat } = v1.seats[0]!
    const plan = Schema.parse({ ...v1, seats: [seat] })
    const [top, chair] = plan.objects.filter((o) => o.id.startsWith('A1'))
    expect(chair!.y).toBeGreaterThan(top!.y)
  })

  it('applies the current rules to the upgraded document', () => {
    const clash = { ...v1, seats: [v1.seats[0], { ...v1.seats[0], x: 300 }] }
    expect(issuesOf(Schema.safeParse(clash))).toContainEqual({ code: 'duplicate_id', id: 'A1' })
  })

  it('reports a broken v1 structure on v1 paths', () => {
    const result = Schema.safeParse({ ...v1, seats: [{ ...v1.seats[0], zone: 'C' }] })
    expect(result.error?.issues[0]?.path).toEqual(['seats', 0, 'zone'])
  })
})
