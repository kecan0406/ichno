import { describe, expect, it } from 'vitest'
import { lintSeatPlan } from './lint'
import { layout } from './layout'
import { validateSelection } from './selection'
import type { PlanObject, SeatPlan } from './types'

const square = [
  { x: 0, y: 0 },
  { x: 500, y: 0 },
  { x: 500, y: 500 },
  { x: 0, y: 500 },
]

function planOf(objects: PlanObject[], extra: Partial<SeatPlan> = {}): SeatPlan {
  return {
    version: 3,
    width: 1000,
    height: 600,
    sections: [
      { id: 'A', points: square },
      { id: 'B', points: square.map((p) => ({ x: p.x + 500, y: p.y })) },
    ],
    categories: [],
    groups: [{ id: 'row-a' }, { id: 'row-b' }, { id: 'desk-1' }],
    objects,
    ...extra,
  }
}

function desk(id: string, x: number, extra: object = {}): PlanObject {
  return { kind: 'place', id, section: 'A', x, y: 20, w: 80, h: 80, shape: 'rect', capacity: 1, ...extra }
}

function row(group: string, y: number, ids: string[]): PlanObject[] {
  const boxes = layout.line({ start: { x: 40, y }, end: { x: 440, y }, count: ids.length, size: 40 })
  return boxes.map((box, i) => ({
    kind: 'place',
    id: ids[i]!,
    section: 'A',
    shape: 'ellipse',
    capacity: 1,
    group,
    ...box,
  }))
}

// Row A: seats A1…A6 left to right, in a group; row B: two seats; a desk alone in its own group.
const rowA = row('row-a', 300, ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'])
const rowB = row('row-b', 400, ['B1', 'B2'])
const lone = desk('D1', 20, { group: 'desk-1' })

describe('lintSeatPlan', () => {
  it('reports places that read the same', () => {
    const plan = planOf([desk('A1', 20, { label: '1' }), desk('A2', 120, { label: '1' })])
    expect(lintSeatPlan(plan)).toContainEqual({
      code: 'duplicate_label',
      label: '1',
      ids: ['A1', 'A2'],
      severity: 'warning',
    })
  })

  it('reports a place whose centre lies outside its section', () => {
    expect(lintSeatPlan(planOf([desk('A1', 600)]))).toContainEqual({
      code: 'outside_section',
      id: 'A1',
      section: 'A',
      severity: 'warning',
    })
  })

  it('asks for categories only in plans that use them', () => {
    expect(lintSeatPlan(planOf([desk('A1', 20)]))).toEqual([])
    const categorized = planOf([desk('A1', 20), desk('A2', 120, { category: 'std' })], { categories: [{ key: 'std' }] })
    expect(lintSeatPlan(categorized)).toEqual([{ code: 'missing_category', id: 'A1', severity: 'warning' }])
  })

  it('follows the consumer severities — empty sections are off by default', () => {
    const plan = planOf([desk('A1', 20)])
    expect(lintSeatPlan(plan)).toEqual([])
    expect(lintSeatPlan(plan, { empty_section: 'error' })).toEqual([
      { code: 'empty_section', section: 'B', severity: 'error' },
    ])
    expect(lintSeatPlan(planOf([desk('A1', 600)]), { outside_section: 'off' })).toEqual([])
  })
})

describe('validateSelection', () => {
  const plan = planOf([...rowA, ...rowB, lone])

  it('checks the count limits', () => {
    expect(validateSelection(plan, { selected: ['A1'] }, { min: 2, max: 4 })).toEqual([{ code: 'too_few', min: 2 }])
    expect(validateSelection(plan, { selected: ['A1', 'A2', 'A3'] }, { max: 2 })).toEqual([
      { code: 'too_many', max: 2 },
    ])
  })

  it('requires consecutive seats to be side by side in one group', () => {
    expect(validateSelection(plan, { selected: ['A2', 'A3', 'A4'] }, { consecutive: true })).toEqual([])
    expect(validateSelection(plan, { selected: ['A2', 'A4'] }, { consecutive: true })).toEqual([
      { code: 'not_consecutive' },
    ])
    expect(validateSelection(plan, { selected: ['A1', 'B1'] }, { consecutive: true })).toEqual([
      { code: 'not_consecutive' },
    ])
  })

  it('reads a group with a single place (a desk) as no line at all', () => {
    expect(validateSelection(plan, { selected: ['A2', 'A3', 'D1'] }, { consecutive: true, noOrphans: true })).toEqual([
      { code: 'orphan_seat', id: 'A1' },
    ])
  })

  it('flags a free seat stranded between the selection and a taken seat or a row end', () => {
    // A1 picked and A3 booked leave A2 alone between them.
    expect(validateSelection(plan, { selected: ['A1'], unavailable: ['A3'] }, { noOrphans: true })).toEqual([
      { code: 'orphan_seat', id: 'A2' },
    ])
    // Picking A2 leaves A1 alone at the row end.
    expect(validateSelection(plan, { selected: ['A2'] }, { noOrphans: true })).toEqual([
      { code: 'orphan_seat', id: 'A1' },
    ])
  })

  it('does not blame the picker for a seat that was stranded before', () => {
    // A2 is already alone between booked A1 and A3; picking A4–A6 has nothing to do with it.
    expect(
      validateSelection(plan, { selected: ['A4', 'A5', 'A6'], unavailable: ['A1', 'A3'] }, { noOrphans: true }),
    ).toEqual([])
  })
})
