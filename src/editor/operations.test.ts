import { describe, expect, it } from 'vitest'
import { seatPlan } from '../core/geometry'
import { labeling } from '../core/labeling'
import type { Desk, PlanObject, Row, SeatPlan } from '../core/types'
import { planEdits } from './operations'

type S = 'A' | 'B'

function planOf(objects: PlanObject<S>[] = []): SeatPlan<S> {
  return {
    version: 2,
    width: 1012,
    height: 828,
    sections: [
      { id: 'A', points: rect(0, 0, 506, 828) },
      { id: 'B', points: rect(506, 0, 506, 828) },
    ],
    categories: [],
    objects,
  }
}

function rect(x: number, y: number, w: number, h: number) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

function desk(id: string, x: number, y: number): Desk<S> {
  return { kind: 'desk', id, section: 'A', x, y, w: 88, h: 88, chairSide: 'down' }
}

describe('labeling', () => {
  it('numbers from a start, with a step and in reverse', () => {
    const labels = (seq: (i: number, n: number) => string, n: number) => Array.from({ length: n }, (_, i) => seq(i, n))
    expect(labels(labeling.numbers(), 3)).toEqual(['1', '2', '3'])
    expect(labels(labeling.numbers({ start: 1, step: 2 }), 3)).toEqual(['1', '3', '5'])
    expect(labels(labeling.numbers({ reverse: true }), 3)).toEqual(['3', '2', '1'])
  })

  it('letters skip the ones asked for and continue past Z like spreadsheet columns', () => {
    const letter = labeling.letters({ skip: ['I'] })
    expect([letter(7, 30), letter(8, 30)]).toEqual(['H', 'J'])
    expect(labeling.letters()(25, 30)).toBe('Z')
    expect(labeling.letters()(26, 30)).toBe('AA')
    expect(labeling.letters({ prefix: 'Row ', lower: true })(0, 1)).toBe('Row a')
  })
})

describe('planEdits — creating', () => {
  it('continues the section numbering for row seats, never reusing a number', () => {
    const { plan, id } = planEdits.addRow(planOf([desk('A1', 2, 2), desk('A4', 94, 2)]), 'A', {
      start: { x: 40, y: 400 },
      end: { x: 300, y: 400 },
      seats: 3,
    })
    const row = seatPlan.objectById(plan, id) as Row<S>
    expect(id).toBe('row-1')
    expect(row.seats.map((s) => s.id)).toEqual(['A5', 'A6', 'A7'])
  })

  it('gives a table its own place id before its seats', () => {
    const { plan, id } = planEdits.addTable(planOf(), 'B', { center: { x: 700, y: 400 }, seats: 2 })
    const table = seatPlan.objectById(plan, id)
    expect(id).toBe('B1')
    expect(table?.kind === 'table' && table.seats.map((s) => s.id)).toEqual(['B2', 'B3'])
  })
})

describe('planEdits — seat counts and locked ids', () => {
  const base = planEdits.addRow(planOf(), 'A', { start: { x: 46, y: 400 }, end: { x: 460, y: 400 }, seats: 4 })
  const rowOf = (plan: SeatPlan<S>) => seatPlan.objectById(plan, base.id) as Row<S>

  it('keeps the row length when the seat count changes', () => {
    const more = planEdits.setSeatCount(base.plan, base.id, 6)!
    expect(rowOf(more).seats.map((s) => s.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'])
    expect([rowOf(more).start, rowOf(more).end]).toEqual([rowOf(base.plan).start, rowOf(base.plan).end])
    expect(rowOf(planEdits.setSeatCount(base.plan, base.id, 2)!).seats.map((s) => s.id)).toEqual(['A1', 'A2'])
  })

  it('refuses to drop a locked seat', () => {
    expect(planEdits.setSeatCount(base.plan, base.id, 2, new Set(['A4']))).toBeNull()
    expect(planEdits.setSeatCount(base.plan, base.id, 3, new Set(['A1']))).not.toBeNull()
  })

  it('refuses to remove an object holding a locked id, and removes the rest', () => {
    const plan = planOf([desk('A1', 2, 2), desk('A2', 94, 2)])
    const withRow = { ...plan, objects: [...plan.objects, rowOf(base.plan)] }
    const { plan: next, refused } = planEdits.remove(withRow, ['A1', 'row-1', 'A2'], new Set(['A2', 'A3']))
    expect(refused).toEqual(['A2', 'row-1'])
    expect(next.objects.map((o) => o.id)).toEqual(['A2', 'row-1'])
  })

  it('refuses to rename a locked id or onto a taken one', () => {
    const plan = planOf([desk('A1', 2, 2), desk('A2', 94, 2)])
    expect(planEdits.rename(plan, 'A1', 'A9', new Set(['A1']))).toBeNull()
    expect(planEdits.rename(plan, 'A1', 'A2')).toBeNull()
    expect(planEdits.rename(plan, 'A1', 'A9')?.objects[0]?.id).toBe('A9')
  })
})

describe('planEdits — arranging', () => {
  const plan = planOf([desk('A1', 2, 2), desk('A2', 186, 94), desk('A3', 370, 186)])
  const xs = (p: SeatPlan<S>) => p.objects.map((o) => (o as Desk<S>).x)
  const ys = (p: SeatPlan<S>) => p.objects.map((o) => (o as Desk<S>).y)

  it('aligns footprints on an edge, keeping desks on the grid', () => {
    expect(ys(planEdits.align(plan, ['A1', 'A2', 'A3'], 'top'))).toEqual([2, 2, 2])
    expect(xs(planEdits.align(plan, ['A1', 'A2', 'A3'], 'right'))).toEqual([370, 370, 370])
  })

  it('spaces centres evenly between the outermost objects', () => {
    const uneven = planOf([desk('A1', 2, 2), desk('A2', 94, 2), desk('A3', 370, 2)])
    expect(xs(planEdits.distribute(uneven, ['A1', 'A2', 'A3'], 'x'))).toEqual([2, 186, 370])
  })

  it('duplicates with fresh ids next to the original', () => {
    const { plan: next, ids } = planEdits.duplicate(plan, ['A1'])
    expect(ids).toEqual(['A4'])
    expect(seatPlan.objectById(next, 'A4')).toMatchObject({ x: 94, y: 94 })
  })

  it('moves the whole selection when a selected object is dragged, and only the object otherwise', () => {
    const drag = { target: { kind: 'object' as const, id: 'A1' }, phase: 'end' as const, total: { x: 92, y: 0 } }
    expect(xs(planEdits.applyDrag(plan, drag, ['A1', 'A2']))).toEqual([94, 278, 370])
    expect(xs(planEdits.applyDrag(plan, drag, ['A3']))).toEqual([94, 186, 370])
  })

  it('labels row seats in order and objects in the order given', () => {
    const { plan: withRow, id } = planEdits.addRow(plan, 'A', {
      start: { x: 46, y: 400 },
      end: { x: 322, y: 400 },
      seats: 3,
    })
    const labeled = planEdits.labelSeats(withRow, id, labeling.numbers({ reverse: true }))
    expect((seatPlan.objectById(labeled, id) as Row<S>).seats.map((s) => s.label)).toEqual(['3', '2', '1'])
    const named = planEdits.labelObjects(plan, ['A3', 'A1'], labeling.letters())
    expect(named.objects.map((o) => (o as Desk<S>).label)).toEqual(['B', undefined, 'A'])
  })
})
