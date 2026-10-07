import { describe, expect, it } from 'vitest'
import { seatPlan } from '../core/geometry'
import { layout } from '../core/layout'
import { rotatePoint } from '../core/math'
import type { Fixture, Place, PlanObject, SeatPlan } from '../core/types'
import { planHandles } from './handles'

type S = 'A'

function planOf(objects: PlanObject<S>[], groups: SeatPlan<S>['groups'] = []): SeatPlan<S> {
  const points = [
    { x: 0, y: 0 },
    { x: 920, y: 0 },
    { x: 920, y: 690 },
    { x: 0, y: 690 },
  ]
  return { version: 3, width: 1012, height: 828, sections: [{ id: 'A', points }], categories: [], groups, objects }
}

const desk: Place<S> = { kind: 'place', id: 'A1', section: 'A', x: 94, y: 94, w: 88, h: 88, shape: 'rect', capacity: 1 }
const tv: Fixture = { kind: 'fixture', id: 'tv-1', shape: 'rect', role: 'tv', x: 230, y: 0, w: 138, h: 23 }
const seat = (id: string, x: number): Place<S> => ({
  kind: 'place',
  id,
  section: 'A',
  x,
  y: 440,
  w: 40,
  h: 40,
  shape: 'ellipse',
  capacity: 1,
  group: 'row-1',
})
const row = [seat('A2', 92), seat('A3', 184), seat('A4', 276)]
const owner = (id: string) => ({ kind: 'object' as const, id })
const snap = { cell: 46 }

describe('planHandles.of', () => {
  it('points corner handles the way the turned object points them, for resize cursors', () => {
    const [nw] = planHandles.of(planOf([{ ...desk, rotation: 90 }]), [owner('A1')])
    // A square's top-left points up-left (−135°); turned a quarter clockwise it points up-right (−45°).
    expect(nw!.angle).toBeCloseTo(-45, 6)
  })

  it('shows corners and a knob for an object, a knob for a group, vertices and edges for a section — for one only', () => {
    const plan = planOf([desk, ...row], [{ id: 'row-1' }])
    expect(planHandles.of(plan, [owner('A1')]).map((h) => h.name)).toEqual(['nw', 'ne', 'se', 'sw', 'rotate'])
    expect(planHandles.of(plan, [{ kind: 'group', id: 'row-1' }]).map((h) => h.name)).toEqual(['rotate'])
    expect(planHandles.of(plan, [{ kind: 'section', id: 'A' }]).map((h) => h.name)).toEqual([
      ...['vertex-0', 'vertex-1', 'vertex-2', 'vertex-3'],
      ...['edge-0', 'edge-1', 'edge-2', 'edge-3'],
    ])
    expect(planHandles.of(plan, [owner('A1'), { kind: 'group', id: 'row-1' }])).toEqual([])
  })

  it('puts the corners of a turned object on its turned outline', () => {
    const turned = { ...desk, rotation: 90 }
    const [nw] = planHandles.of(planOf([turned]), [owner('A1')])
    // A quarter turn clockwise brings the top-left corner to the top-right.
    expect(nw!.point).toEqual({ x: expect.closeTo(182, 6), y: expect.closeTo(94, 6) })
  })
})

describe('planHandles.drag', () => {
  const objectOf = (plan: SeatPlan<S>, id: string) => seatPlan.objectById(plan, id)

  it('resizes from the dragged corner, the opposite corner staying put, in half cells when snapping', () => {
    const wider = planHandles.drag(planOf([desk]), owner('A1'), 'se', { x: 50, y: 0 }, snap)
    expect(objectOf(wider, 'A1')).toMatchObject({ x: 94, y: 94, w: 138, h: 92 })
    const fromLeft = planHandles.drag(planOf([desk]), owner('A1'), 'nw', { x: -46, y: 0 })
    expect(objectOf(fromLeft, 'A1')).toMatchObject({ x: 48, w: 134, h: 88 })
  })

  it('resizes a turned object along its own axes', () => {
    const turned = { ...desk, rotation: 90 }
    const plan = planOf([turned])
    // Turned a quarter, the object's own width runs down the plan: dragging its se corner 40 down widens it.
    const grown = objectOf(planHandles.drag(plan, owner('A1'), 'se', { x: 0, y: 40 }), 'A1')!
    expect(grown).toMatchObject({ w: 128, h: 88, rotation: 90 })
    // The opposite (nw) corner stays where it was.
    const nw = rotatePoint({ x: grown.x, y: grown.y }, seatPlan.centerOf(grown), 90)
    const before = rotatePoint({ x: desk.x, y: desk.y }, seatPlan.centerOf(desk), 90)
    expect(nw.x).toBeCloseTo(before.x, 0)
    expect(nw.y).toBeCloseTo(before.y, 0)
  })

  it('never grows a level box past the plan edge', () => {
    const grown = planHandles.drag(planOf([tv]), owner('tv-1'), 'se', { x: 2000, y: 0 })
    const b = seatPlan.boundsOf(objectOf(grown, 'tv-1')!)
    expect(b.x + b.w).toBeLessThanOrEqual(1012)
  })

  it('turns an object from its knob, in 15° steps when snapping', () => {
    // The knob sits above the centre (138, 138); pulling it to the right of the centre is a quarter turn.
    const knob = { x: 138, y: 94 - 28 }
    const toRight = { x: 138 + 100 - knob.x, y: 138 - knob.y }
    expect(objectOf(planHandles.drag(planOf([desk]), owner('A1'), 'rotate', toRight), 'A1')).toMatchObject({
      rotation: 90,
    })
    const slight = { x: 30, y: 0 }
    const free = objectOf(planHandles.drag(planOf([desk]), owner('A1'), 'rotate', slight), 'A1')!.rotation!
    const stepped = objectOf(planHandles.drag(planOf([desk]), owner('A1'), 'rotate', slight, snap), 'A1')!.rotation!
    expect(free % 15).not.toBe(0)
    expect(stepped % 15).toBe(0)
    // Back to level leaves no rotation behind.
    expect(
      objectOf(planHandles.drag(planOf([desk]), owner('A1'), 'rotate', { x: 0, y: -10 }), 'A1')!.rotation,
    ).toBeUndefined()
  })

  it('turns a group as one about the centre of its frame, and the group faces the new way', () => {
    const plan = planOf(row, [{ id: 'row-1' }])
    const [knob] = planHandles.of(plan, [{ kind: 'group', id: 'row-1' }])
    const center = { x: 204, y: 460 }
    const toRight = { x: center.x + 100 - knob!.point.x, y: center.y - knob!.point.y }
    const turned = planHandles.drag(plan, { kind: 'group', id: 'row-1' }, 'rotate', toRight)
    const seats = seatPlan.membersOf(turned, 'row-1')
    expect(seats.map((s) => s.x)).toEqual([184, 184, 184])
    expect(seats.map((s) => s.y)).toEqual([348, 440, 532])
    expect(seats.every((s) => s.rotation === 90)).toBe(true)
    expect(turned.groups[0]!.rotation).toBe(90)
  })

  it('keeps a turned group on its centre, turn after turn, with the knob and frame turning with it', () => {
    // A curved row: its level extent changes as it turns, its frame does not.
    const boxes = layout.arc({ start: { x: 200, y: 300 }, end: { x: 600, y: 300 }, curve: 0.4, count: 9, size: 40 })
    const seats = boxes.map((box, i) => ({ ...seat(`A${i + 1}`, 0), ...box }))
    let plan = planOf(seats, [{ id: 'row-1' }])
    const group = { kind: 'group' as const, id: 'row-1' }
    const centerOf = (p: SeatPlan<S>) => {
      const frame = planHandles.frame(p, [group])!
      return { x: (frame[0]!.x + frame[2]!.x) / 2, y: (frame[0]!.y + frame[2]!.y) / 2 }
    }
    const start = centerOf(plan)
    const reach = (p: SeatPlan<S>) => {
      const [knob] = planHandles.of(p, [group])
      return Math.hypot(knob!.point.x - centerOf(p).x, knob!.point.y - centerOf(p).y)
    }
    const knobReach = reach(plan)
    // Positions are whole units, so each turn rounds every seat by up to half a unit — the centre may wobble by
    // that much, but never walks off the way the level extent's centre did.
    for (let i = 0; i < 24; i++) {
      // Drag the knob a quarter of the way round each time, then check where everything is.
      const [knob] = planHandles.of(plan, [group])
      const c = centerOf(plan)
      const target = rotatePoint(knob!.point, c, 37)
      plan = planHandles.drag(plan, group, 'rotate', {
        x: target.x - knob!.point.x,
        y: target.y - knob!.point.y,
      })
      expect(Math.hypot(centerOf(plan).x - start.x, centerOf(plan).y - start.y)).toBeLessThan(2)
      expect(Math.abs(reach(plan) - knobReach)).toBeLessThan(2)
    }
    expect(plan.groups[0]!.rotation).toBe((37 * 24) % 360)
  })

  it('moves one section vertex to the nearest cell corner when snapping', () => {
    const plan = planHandles.drag(planOf([]), { kind: 'section', id: 'A' }, 'vertex-2', { x: 40, y: 10 }, snap)
    expect(plan.sections[0]!.points[2]).toEqual({ x: 966, y: 690 })
    expect(plan.sections[0]!.points[1]).toEqual({ x: 920, y: 0 })
  })

  it('adds a vertex from the middle of an edge, and merges one dropped near its neighbour while three remain', () => {
    const section = { kind: 'section' as const, id: 'A' as const }
    const square = planOf([]).sections[0]!.points
    // The top edge runs from (0, 0) to (920, 0); its middle pulled down 40 adds a vertex there.
    const peaked = planHandles.drag(planOf([]), section, 'edge-0', { x: 0, y: 40 })
    expect(peaked.sections[0]!.points).toEqual([square[0], { x: 460, y: 40 }, ...square.slice(1)])
    // Dropped 5 units from (920, 0): at 2 units a pixel that is 2.5 px and it merges; at 0.5 a pixel it is 10 px.
    const back = { x: 455, y: -40 }
    expect(planHandles.drag(peaked, section, 'vertex-1', back, null, false, 2).sections[0]!.points).toEqual(square)
    expect(planHandles.drag(peaked, section, 'vertex-1', back, null, false, 0.5).sections[0]!.points).toHaveLength(5)
    // Dropped right on its neighbour it merges at any zoom — but a triangle keeps its three.
    const onto = { x: -920, y: 0 }
    const triangle = planHandles.drag(planOf([]), section, 'vertex-1', onto).sections[0]!.points
    expect(triangle).toHaveLength(3)
    const kept = planHandles.drag({ ...planOf([]), sections: [{ id: 'A', points: triangle }] }, section, 'vertex-1', {
      x: square[0]!.x - triangle[1]!.x,
      y: square[0]!.y - triangle[1]!.y,
    })
    expect(kept.sections[0]!.points).toHaveLength(3)
  })

  it('constrained (Shift), turns in 15° steps, resizes in proportion and moves a vertex along one axis', () => {
    const turned = planHandles.drag(planOf([desk]), owner('A1'), 'rotate', { x: 30, y: 0 }, null, true)
    expect(objectOf(turned, 'A1')!.rotation! % 15).toBe(0)
    // Pulled twice as wide, the 138 × 23 screen grows twice as tall too.
    const wider = planHandles.drag(planOf([tv]), owner('tv-1'), 'se', { x: 138, y: 0 }, null, true)
    expect(objectOf(wider, 'tv-1')).toMatchObject({ x: 230, y: 0, w: 276, h: 46 })
    const vertex = planHandles.drag(planOf([]), { kind: 'section', id: 'A' }, 'vertex-2', { x: 40, y: 10 }, null, true)
    expect(vertex.sections[0]!.points[2]).toEqual({ x: 960, y: 690 })
  })
})

describe('marquee', () => {
  it('picks every object whose shape the rectangle touches — a turned one by its turned shape', () => {
    const plan = planOf([desk, tv, ...row], [{ id: 'row-1' }])
    expect(seatPlan.objectsInRect(plan, { x: 0, y: 0, w: 100, h: 100 })).toEqual(['A1'])
    expect(seatPlan.objectsInRect(plan, { x: 0, y: 0, w: 1000, h: 30 })).toEqual(['tv-1'])
    // The corner of a round seat's box is not the seat.
    expect(seatPlan.objectsInRect(plan, { x: 92, y: 440, w: 3, h: 3 })).toEqual([])
    const bar: Place<S> = { ...desk, id: 'A9', x: 500, y: 300, w: 200, h: 20 }
    expect(seatPlan.objectsInRect(planOf([bar]), { x: 590, y: 220, w: 20, h: 20 })).toEqual([])
    expect(seatPlan.objectsInRect(planOf([{ ...bar, rotation: 90 }]), { x: 590, y: 220, w: 20, h: 20 })).toEqual(['A9'])
  })
})
