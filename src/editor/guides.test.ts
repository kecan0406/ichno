import { describe, expect, it } from 'vitest'
import type { PlanObject, SeatPlan } from '../core/types'
import { planGuides } from './guides'

const box = (x: number, y: number, w = 100, h = 100) => ({ x, y, w, h })

describe('planGuides', () => {
  it('lines an edge or the centre up with the nearest target line within the tolerance, else leaves the move', () => {
    const targets = [box(0, 0)]
    // Moved to x 104: its left edge is 4 from the target's right edge (100).
    const near = planGuides.snapMove(box(300, 300), { x: -196, y: 0 }, targets, 6)
    expect([near.delta.x, near.exact]).toEqual([-200, { x: true, y: false }])
    expect(near.guides).toContainEqual({ kind: 'line', axis: 'x', at: 100, from: 0, to: 400 })
    // 7 away is past a tolerance of 6.
    expect(planGuides.snapMove(box(300, 300), { x: -193, y: 0 }, targets, 6).delta.x).toBe(-193)
    // Centre to centre: 48 + 50 = 98 against 50 snaps to 2.
    expect(planGuides.snapMove(box(300, 300, 100, 20), { x: -298, y: 0 }, targets, 6).delta.x).toBe(-300)
  })

  it('evens the gaps between two neighbours, or repeats the gap beside one, on the band they share', () => {
    const pair = [box(0, 0), box(300, 0)]
    // Between them: 100 of room each side lands it at 150 — from 147.
    const between = planGuides.snapMove(box(147, 400), { x: 0, y: -400 }, pair, 6)
    expect(between.delta).toEqual({ x: 3, y: -400 })
    expect(between.guides).toContainEqual({
      kind: 'gap',
      axis: 'x',
      at: 50,
      size: 50,
      gaps: [
        { from: 100, to: 150 },
        { from: 250, to: 300 },
      ],
    })
    // Past the second: the 200 between the two, repeated, puts it at 600.
    const after = planGuides.snapMove(box(604, 0), { x: 0, y: 0 }, pair, 6)
    expect(after.delta.x).toBe(-4)
    // Out of their band, nothing to space against.
    expect(planGuides.snapMove(box(604, 300), { x: 0, y: 0 }, pair, 6).delta.x).toBe(0)
  })

  it('snaps only the axes it may take — a Shift move keeps to one', () => {
    const snapped = planGuides.snapMove(box(300, 300), { x: -196, y: 0 }, [box(0, 302)], 6, { x: false, y: true })
    expect(snapped.delta).toEqual({ x: -196, y: 2 })
  })

  it('snaps a point to the nearest line on each axis', () => {
    const snapped = planGuides.snapPoint({ x: 203, y: 52 }, [box(0, 0, 200, 100)], 6)
    expect(snapped.point).toEqual({ x: 200, y: 50 })
    expect(snapped.exact).toEqual({ x: true, y: true })
  })

  it('lines up with units and sections, never with what moves', () => {
    const seat = (id: string, x: number, group?: string): PlanObject => ({
      kind: 'place',
      id,
      section: 'A',
      x,
      y: 0,
      w: 40,
      h: 40,
      shape: 'rect',
      capacity: 1,
      ...(group ? { group } : {}),
    })
    const plan: SeatPlan = {
      version: 3,
      width: 1000,
      height: 1000,
      sections: [
        {
          id: 'A',
          points: [
            { x: 0, y: 0 },
            { x: 500, y: 0 },
            { x: 500, y: 500 },
          ],
        },
      ],
      walls: [],
      categories: [],
      groups: [{ id: 'r' }],
      objects: [seat('A1', 0, 'r'), seat('A2', 60, 'r'), seat('A3', 200)],
    }
    expect(planGuides.targetsOf(plan, new Set(['A3']))).toEqual([box(0, 0, 100, 40), box(0, 0, 500, 500)])
    expect(planGuides.targetsOf(plan, new Set(['r']))).toEqual([box(200, 0, 40, 40), box(0, 0, 500, 500)])
  })

  const walled: SeatPlan = {
    version: 3,
    width: 1000,
    height: 1000,
    sections: [],
    walls: [
      {
        id: 'w1',
        points: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 400 },
          { x: 0, y: 400 },
        ],
        thickness: 20,
        closed: true,
      },
    ],
    categories: [],
    groups: [],
    objects: [{ kind: 'fixture', id: 'desk', shape: 'rect', x: 530, y: 100, w: 120, h: 60 }],
  }

  it('lines things up with both faces of a wall, edge by edge — a bar flush against the inside of a room', () => {
    const targets = planGuides.targetsOf(walled, new Set())
    expect(planGuides.snapPoint({ x: 200, y: 14 }, targets, 6).point).toEqual({ x: 200, y: 10 })
    expect(planGuides.snapPoint({ x: 386, y: 200 }, targets, 6).point).toEqual({ x: 390, y: 200 })
  })

  it('lines a wall being drawn up with the corners of the other walls only — not furniture, not the faces of walls', () => {
    const targets = planGuides.wallTargetsOf(walled, new Set())
    // The desk's left edge (530) and the wall's outer face (410) are no guides for a wall.
    expect(planGuides.snapPoint({ x: 525, y: 300 }, targets, 6).point).toEqual({ x: 525, y: 300 })
    expect(planGuides.snapPoint({ x: 415, y: 600 }, targets, 6).point).toEqual({ x: 415, y: 600 })
    // Another wall's corner is.
    expect(planGuides.snapPoint({ x: 404, y: 700 }, targets, 6).point).toEqual({ x: 400, y: 700 })
    expect(planGuides.wallTargetsOf(walled, new Set(['w1']))).toEqual([])
  })
})
