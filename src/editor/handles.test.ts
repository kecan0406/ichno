import { describe, expect, it } from 'vitest'
import { seatPlan } from '../core/geometry'
import type { Desk, Fixture, PlanObject, Row, SeatPlan } from '../core/types'
import { planHandles } from './handles'

type S = 'A'

function planOf(objects: PlanObject<S>[]): SeatPlan<S> {
  const points = [
    { x: 0, y: 0 },
    { x: 920, y: 0 },
    { x: 920, y: 690 },
    { x: 0, y: 690 },
  ]
  return { version: 2, width: 1012, height: 828, sections: [{ id: 'A', points }], categories: [], objects }
}

const desk: Desk<S> = { kind: 'desk', id: 'A1', section: 'A', x: 94, y: 94, w: 88, h: 88, chairSide: 'down' }
const tv: Fixture = { kind: 'fixture', id: 'tv-1', role: 'tv', x: 230, y: 0, w: 138, h: 23 }
const row: Row<S> = {
  kind: 'row',
  id: 'row-1',
  section: 'A',
  start: { x: 92, y: 460 },
  end: { x: 460, y: 460 },
  curve: 0,
  seatSize: 40,
  seats: [{ id: 'A2' }, { id: 'A3' }, { id: 'A4' }],
}
const owner = (id: string) => ({ kind: 'object' as const, id })

describe('planHandles.of', () => {
  it('shows corners for a rectangle, ends and curve for a row, vertices for a section — for one item only', () => {
    const plan = planOf([desk, row])
    expect(planHandles.of(plan, [{ kind: 'object', id: 'A1' }]).map((h) => h.name)).toEqual(['nw', 'ne', 'se', 'sw'])
    expect(planHandles.of(plan, [{ kind: 'object', id: 'row-1' }]).map((h) => h.name)).toEqual([
      'start',
      'end',
      'curve',
    ])
    expect(planHandles.of(plan, [{ kind: 'section', id: 'A' }])).toHaveLength(4)
    expect(
      planHandles.of(plan, [
        { kind: 'object', id: 'A1' },
        { kind: 'object', id: 'row-1' },
      ]),
    ).toEqual([])
  })
})

describe('planHandles.drag', () => {
  const objectOf = (plan: SeatPlan<S>, id: string) => seatPlan.objectById(plan, id)

  it('resizes a desk by whole cells from the dragged corner, the opposite corner staying put', () => {
    const wider = planHandles.drag(planOf([desk]), owner('A1'), 'se', { x: 50, y: 0 })
    expect(objectOf(wider, 'A1')).toMatchObject({ x: 94, y: 94, w: 134, h: 88 })
    const fromLeft = planHandles.drag(planOf([desk]), owner('A1'), 'nw', { x: -46, y: 0 })
    expect(objectOf(fromLeft, 'A1')).toMatchObject({ x: 48, w: 134 })
  })

  it('keeps a fixture at least half a cell and on the half-cell grid', () => {
    const squashed = planHandles.drag(planOf([tv]), owner('tv-1'), 'se', { x: 0, y: -40 })
    expect(objectOf(squashed, 'tv-1')).toMatchObject({ h: 23, y: 0 })
    const grown = planHandles.drag(planOf([tv]), owner('tv-1'), 'se', { x: 30, y: 0 })
    expect((objectOf(grown, 'tv-1') as Fixture).w % 23).toBe(0)
  })

  it('moves a row end on the half-cell grid', () => {
    const longer = planHandles.drag(planOf([row]), owner('row-1'), 'end', { x: 50, y: 10 })
    expect((objectOf(longer, 'row-1') as Row<S>).end).toEqual({ x: 506, y: 460 })
  })

  it('bends a row so the middle of its arc follows the curve handle', () => {
    // Chord 368 long; pulling the apex 92 up (left of a left-to-right row) is a sagitta of 92 → curve 0.5.
    const bent = planHandles.drag(planOf([row]), owner('row-1'), 'curve', { x: 0, y: -92 })
    expect((objectOf(bent, 'row-1') as Row<S>).curve).toBe(0.5)
    const flipped = planHandles.drag(planOf([row]), owner('row-1'), 'curve', { x: 0, y: 1000 })
    expect((objectOf(flipped, 'row-1') as Row<S>).curve).toBe(-1)
  })

  it('moves one section vertex to the nearest cell corner', () => {
    const plan = planHandles.drag(planOf([]), { kind: 'section', id: 'A' }, 'vertex-2', { x: 40, y: 10 })
    expect(plan.sections[0]!.points[2]).toEqual({ x: 966, y: 690 })
    expect(plan.sections[0]!.points[1]).toEqual({ x: 920, y: 0 })
  })
})

describe('marquee and row labels', () => {
  it('picks every object whose footprint the rectangle touches', () => {
    const plan = planOf([desk, tv, row])
    expect(seatPlan.objectsInRect(plan, { x: 0, y: 0, w: 100, h: 100 })).toEqual(['A1'])
    expect(seatPlan.objectsInRect(plan, { x: 0, y: 0, w: 1000, h: 30 })).toEqual(['tv-1'])
    expect(seatPlan.objectsInRect(plan, { x: 300, y: 450, w: 5, h: 5 })).toEqual(['row-1'])
  })

  it('puts row labels one seat beyond each end, along the row', () => {
    expect(seatPlan.rowLabelAnchorsOf(row)).toEqual({ start: { x: 52, y: 460 }, end: { x: 500, y: 460 } })
  })
})
