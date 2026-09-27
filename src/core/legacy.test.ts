import { describe, expect, it } from 'vitest'
import { createSeatPlanSchema } from '../schema/index'
import { seatPlan } from './geometry'
import { upgradeSeatPlan, type PlanObjectV2, type SeatPlanV2 } from './legacy'
import { arcPoints } from './math'
import type { Fixture, Place } from './types'

const { SeatPlan: Schema } = createSeatPlanSchema({ sectionIds: ['A'] })

function v2(objects: PlanObjectV2<'A'>[]): SeatPlanV2<'A'> {
  const points = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 800 },
    { x: 0, y: 800 },
  ]
  return { version: 2, width: 1000, height: 800, sections: [{ id: 'A', points }], categories: [], objects }
}

const centerOf = (o: { x: number; y: number; w: number; h: number }) => ({ x: o.x + o.w / 2, y: o.y + o.h / 2 })

describe('0.1 documents keep parsing', () => {
  it('renames a fixture whose id a seat also uses — v1 kept them in separate lists', () => {
    const v1 = {
      width: 1000,
      height: 800,
      zones: [{ id: 'A', x: 0, y: 0, w: 1000, h: 800 }],
      seats: [{ id: 'T1', zone: 'A', x: 20, y: 20, w: 80, h: 80, chairSide: 'down' as const }],
      fixtures: [{ id: 'T1', kind: 'tv' as const, x: 300, y: 0, w: 138, h: 23 }],
    }
    const upgraded = upgradeSeatPlan(v1)
    expect(upgraded.objects.map((o) => o.id)).toEqual(['tv-1', 'T1', 'T1-c'])
    expect(Schema.safeParse(v1).success).toBe(true)
  })
})

describe('0.2 documents keep parsing — every place keeps its id and its spot', () => {
  it('splits a desk into its top (the place) and its chair, grouped', () => {
    const plan = upgradeSeatPlan(
      v2([{ kind: 'desk', id: 'A1', section: 'A', x: 2, y: 2, w: 88, h: 88, chairSide: 'up', label: '1' }]),
    )
    const [top, chair] = plan.objects as [Place, Fixture]
    expect(top).toMatchObject({ kind: 'place', id: 'A1', label: '1', role: 'desk', x: 2, y: 30, w: 88, h: 60 })
    expect(chair).toMatchObject({ kind: 'fixture', role: 'chair', group: top.group })
    // The chair sits in the band above the top, inside the old desk.
    expect(chair.y + chair.h).toBeLessThanOrEqual(top.y)
    expect(chair.y).toBeGreaterThanOrEqual(2)
    expect(plan.groups).toEqual([{ id: top.group, role: 'desk' }])
  })

  it('turns a row into its seats, grouped under the row id, with a label at each end', () => {
    const row: PlanObjectV2<'A'> = {
      kind: 'row',
      id: 'row-1',
      section: 'A',
      label: 'A',
      start: { x: 100, y: 300 },
      end: { x: 500, y: 300 },
      curve: 0.3,
      seatSize: 40,
      seats: [{ id: 'A1', label: '1' }, { id: 'A2' }, { id: 'A3', category: 'vip' }],
    }
    const plan = upgradeSeatPlan(v2([row]))
    expect(plan.groups).toEqual([{ id: 'row-1', role: 'row', label: 'A' }])
    const seats = seatPlan.placesOf(plan)
    expect(seats.map((s) => [s.id, s.group, s.shape])).toEqual([
      ['A1', 'row-1', 'ellipse'],
      ['A2', 'row-1', 'ellipse'],
      ['A3', 'row-1', 'ellipse'],
    ])
    expect(seats[0]!.label).toBe('1')
    expect(seats[2]!.category).toBe('vip')
    const expected = arcPoints(row.start, row.end, row.curve, 3)
    seats.forEach((s, i) => {
      expect(Math.abs(centerOf(s).x - expected[i]!.x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(centerOf(s).y - expected[i]!.y)).toBeLessThanOrEqual(0.5)
    })
    expect(plan.objects.filter((o) => o.kind === 'label').map((o) => o.group)).toEqual(['row-1', 'row-1'])
  })

  it('keeps a table booked seat by seat as a top fixture (the table id) and seat places', () => {
    const table: PlanObjectV2<'A'> = {
      kind: 'table',
      id: 'A9',
      section: 'A',
      label: 'T1',
      shape: 'round',
      x: 300,
      y: 300,
      w: 92,
      h: 92,
      seatSize: 36,
      seats: [{ id: 'A10' }, { id: 'A11' }, { id: 'A12' }],
    }
    const plan = upgradeSeatPlan(v2([table]))
    expect(plan.objects.map((o) => [o.kind, o.id, o.kind === 'label' ? undefined : o.role])).toEqual([
      ['fixture', 'A9', 'table'],
      ['place', 'A10', 'seat'],
      ['place', 'A11', 'seat'],
      ['place', 'A12', 'seat'],
    ])
    expect(plan.groups).toEqual([{ id: 'A9-g', role: 'table', label: 'T1' }])
  })

  it('books a whole table as its top holding every seat, the seats kept as chairs', () => {
    const plan = upgradeSeatPlan(
      v2([
        {
          kind: 'table',
          id: 'A9',
          section: 'A',
          shape: 'rect',
          x: 300,
          y: 300,
          w: 184,
          h: 92,
          seatSize: 36,
          seats: [{ id: 'A10' }, { id: 'A11' }],
          wholeBooking: true,
        },
      ]),
    )
    expect(plan.objects.map((o) => [o.kind, o.id])).toEqual([
      ['fixture', 'A10'],
      ['fixture', 'A11'],
      ['place', 'A9'],
    ])
    expect(seatPlan.placesOf(plan)[0]).toMatchObject({ capacity: 2, shape: 'rect', x: 300, y: 300, w: 184, h: 92 })
  })

  it('makes booths and areas places, and fixtures rectangular fixtures', () => {
    const plan = upgradeSeatPlan(
      v2([
        { kind: 'fixture', id: 'stage', role: 'stage', x: 0, y: 0, w: 400, h: 92 },
        { kind: 'booth', id: 'A1', section: 'A', x: 0, y: 200, w: 92, h: 92, tags: ['power'] },
        { kind: 'area', id: 'A2', section: 'A', shape: 'ellipse', x: 200, y: 200, w: 300, h: 200, capacity: 80 },
      ]),
    )
    expect(plan.objects).toEqual([
      { kind: 'fixture', id: 'stage', shape: 'rect', role: 'stage', x: 0, y: 0, w: 400, h: 92 },
      {
        kind: 'place',
        id: 'A1',
        section: 'A',
        role: 'booth',
        tags: ['power'],
        x: 0,
        y: 200,
        w: 92,
        h: 92,
        shape: 'rect',
        capacity: 1,
      },
      {
        kind: 'place',
        id: 'A2',
        section: 'A',
        role: 'area',
        x: 200,
        y: 200,
        w: 300,
        h: 200,
        shape: 'ellipse',
        capacity: 80,
      },
    ])
  })

  it('shrinks seats a v2 row crowded together, so the upgrade passes the overlap rule', () => {
    const crowded: PlanObjectV2<'A'> = {
      kind: 'row',
      id: 'row-1',
      section: 'A',
      start: { x: 100, y: 300 },
      end: { x: 160, y: 300 },
      curve: 0,
      seatSize: 40,
      seats: [{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }],
    }
    const plan = upgradeSeatPlan(v2([crowded]))
    expect(seatPlan.conflictsOf(plan)).toEqual([])
    // Centres 30 apart: the seats shrink to 31 (crossing by less than OVERLAP_TOLERANCE) and stay where they were.
    const seats = seatPlan.placesOf(plan)
    expect(seats.map((s) => s.w)).toEqual([31, 31, 31])
    seats.forEach((s, i) => expect(Math.abs(centerOf(s).x - (100 + 30 * i))).toBeLessThanOrEqual(0.5))
    expect(Schema.safeParse(v2([crowded])).success).toBe(true)
  })

  it('gives generated ids a free name when the old document already uses it', () => {
    const plan = upgradeSeatPlan(
      v2([
        { kind: 'fixture', id: 'A1-g', role: 'wall', x: 500, y: 0, w: 23, h: 92 },
        { kind: 'desk', id: 'A1', section: 'A', x: 2, y: 2, w: 88, h: 88, chairSide: 'down' },
      ]),
    )
    expect(plan.groups.map((g) => g.id)).toEqual(['A1-g-2'])
    expect(new Set(seatPlan.idsOf(plan)).size).toBe(seatPlan.idsOf(plan).length)
  })
})
