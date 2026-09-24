import { describe, expect, it } from 'vitest'
import { createSeatPlanSchema } from '../schema/index'
import { seatPlan } from './geometry'
import { upgradeSeatPlan } from './v1'
import type { PlanObject, Row, SeatPlan } from './types'

// Regressions found in the branch review before 0.2.

function planOf(objects: PlanObject<'A'>[]): SeatPlan<'A'> {
  const points = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 800 },
    { x: 0, y: 800 },
  ]
  return { version: 2, width: 1000, height: 800, sections: [{ id: 'A', points }], categories: [], objects }
}

function row(id: string, y: number, seatIds: string[], curve: number): Row<'A'> {
  return {
    kind: 'row',
    id,
    section: 'A',
    start: { x: 100, y },
    end: { x: 700, y },
    curve,
    seatSize: 40,
    seats: seatIds.map((s) => ({ id: s })),
  }
}

describe('rows claim their seats, not their bounding box', () => {
  // Two concentric theatre rows 50 apart — their boxes overlap, their seats do not.
  const front = row('row-a', 150, ['A1', 'A2', 'A3', 'A4', 'A5'], -0.2)
  const back = row('row-b', 200, ['A6', 'A7', 'A8', 'A9', 'A10'], -0.2)

  it('reports no conflict between curved rows whose seats keep apart', () => {
    expect(seatPlan.conflictsOf(planOf([front, back])).overlaps).toEqual([])
  })

  it('still reports rows whose seats collide', () => {
    const onTop = row('row-c', 160, ['A11', 'A12', 'A13', 'A14', 'A15'], -0.2)
    expect(seatPlan.conflictsOf(planOf([front, onTop])).overlaps).toEqual([['row-a', 'row-c']])
  })

  it('picks a curved row with a marquee only when the marquee touches a seat', () => {
    // The row's box reaches y=150+ but at its middle the seats sit around y=210 (curve bows down).
    const plan = planOf([front])
    expect(seatPlan.objectsInRect(plan, { x: 380, y: 150, w: 40, h: 10 })).toEqual([])
    expect(seatPlan.objectsInRect(plan, { x: 90, y: 140, w: 20, h: 20 })).toEqual(['row-a'])
  })
})

describe('0.1 documents keep parsing', () => {
  it('renames a fixture whose id a seat also uses — v1 kept them in separate lists', () => {
    const { SeatPlan: Schema } = createSeatPlanSchema({ sectionIds: ['A'] })
    const v1 = {
      width: 1000,
      height: 800,
      zones: [{ id: 'A', x: 0, y: 0, w: 1000, h: 800 }],
      seats: [{ id: 'T1', zone: 'A', x: 20, y: 20, w: 80, h: 80, chairSide: 'down' as const }],
      fixtures: [{ id: 'T1', kind: 'tv' as const, x: 300, y: 0, w: 138, h: 23 }],
    }
    const upgraded = upgradeSeatPlan(v1)
    expect(upgraded.objects.map((o) => o.id)).toEqual(['tv-1', 'T1'])
    expect(Schema.safeParse(v1).success).toBe(true)
  })
})
