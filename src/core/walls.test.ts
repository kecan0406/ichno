import { describe, expect, it } from 'vitest'
import { seatPlan } from './geometry'
import { signedArea } from './math'
import type { PlanPoint, Wall } from './types'

function rect(x: number, y: number, w: number, h: number): PlanPoint[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

function room(id: string, points: PlanPoint[], extra: Partial<Wall> = {}): Wall {
  return { id, points, thickness: 12, closed: true, ...extra }
}

function line(id: string, points: PlanPoint[], extra: Partial<Wall> = {}): Wall {
  return { id, points, thickness: 12, ...extra }
}

const roomsOf = (walls: Wall[]) => seatPlan.roomsOf({ walls })

describe('roomsOf', () => {
  it('finds the room a closed wall goes round, clockwise', () => {
    const rooms = roomsOf([room('w1', rect(0, 0, 920, 600))])
    expect(rooms).toHaveLength(1)
    expect(rooms[0]!.walls).toEqual(['w1'])
    expect(seatPlan.areaOf(rooms[0]!.points)).toBe(920 * 600)
    expect(signedArea(rooms[0]!.points)).toBeGreaterThan(0)
  })

  it('splits a room in two with a partition across it', () => {
    const rooms = roomsOf([
      room('w1', rect(0, 0, 920, 600)),
      line('w2', [
        { x: 460, y: 0 },
        { x: 460, y: 600 },
      ]),
    ])
    expect(rooms.map((r) => seatPlan.areaOf(r.points)).sort()).toEqual([460 * 600, 460 * 600])
    expect(rooms.every((r) => r.walls.includes('w2'))).toBe(true)
  })

  it('meets a partition that stops within half a thickness of the wall', () => {
    const rooms = roomsOf([
      room('w1', rect(0, 0, 920, 600)),
      line('w2', [
        { x: 460, y: 4 },
        { x: 460, y: 595 },
      ]),
    ])
    expect(rooms).toHaveLength(2)
  })

  it('counts rooms built side by side once each, sharing their wall', () => {
    const rooms = roomsOf([room('a', rect(0, 0, 460, 600)), room('b', rect(460, 0, 460, 600))])
    expect(rooms).toHaveLength(2)
    expect(rooms.map((r) => seatPlan.areaOf(r.points))).toEqual([460 * 600, 460 * 600])
  })

  it('closes a room from open walls whose ends meet', () => {
    const [a, b, c, d] = rect(0, 0, 400, 300) as [PlanPoint, PlanPoint, PlanPoint, PlanPoint]
    const rooms = roomsOf([line('n', [a, b]), line('e', [b, c]), line('s', [c, d]), line('w', [d, a])])
    expect(rooms).toHaveLength(1)
    expect(rooms[0]!.walls).toEqual(['e', 'n', 's', 'w'])
  })

  it('leaves a wall sticking out of a room out of its outline', () => {
    const rooms = roomsOf([
      room('w1', rect(0, 0, 400, 300)),
      line('w2', [
        { x: 400, y: 150 },
        { x: 600, y: 150 },
      ]),
    ])
    expect(rooms).toHaveLength(1)
    expect(rooms[0]!.points).toHaveLength(4)
    expect(rooms[0]!.walls).toEqual(['w1'])
  })

  it('finds no room in walls that do not close', () => {
    expect(
      roomsOf([
        line('w1', [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 300 },
        ]),
      ]),
    ).toEqual([])
  })

  it('keeps a room whole where a door opens its wall', () => {
    const rooms = roomsOf([room('w1', rect(0, 0, 400, 300), { openings: [{ edge: 0, at: 100, width: 92 }] })])
    expect(rooms).toHaveLength(1)
  })

  it('finds the innermost room around a point', () => {
    const plan = { walls: [room('big', rect(0, 0, 900, 600)), room('closet', rect(100, 100, 200, 200))] }
    expect(seatPlan.roomAt(plan, { x: 150, y: 150 })?.walls).toEqual(['closet'])
    expect(seatPlan.roomAt(plan, { x: 600, y: 300 })?.walls).toEqual(['big'])
    expect(seatPlan.roomAt(plan, { x: 950, y: 300 })).toBeNull()
  })
})

describe('wallOutlineOf', () => {
  it('draws a closed wall as an outer and an inner ring turning opposite ways', () => {
    const rings = seatPlan.wallOutlineOf(room('w1', rect(0, 0, 400, 300)))
    expect(rings).toHaveLength(2)
    const [a, b] = rings.map(signedArea) as [number, number]
    expect(Math.sign(a)).toBe(-Math.sign(b))
    expect(seatPlan.wallBoundsOf(room('w1', rect(0, 0, 400, 300)))).toEqual({ x: -6, y: -6, w: 412, h: 312 })
  })

  it('runs a free end half the thickness past its point', () => {
    expect(
      seatPlan.wallBoundsOf(
        line('w1', [
          { x: 100, y: 100 },
          { x: 300, y: 100 },
        ]),
      ),
    ).toEqual({
      x: 94,
      y: 94,
      w: 212,
      h: 12,
    })
  })

  it('breaks the band where an opening is, square on it', () => {
    const wall = line(
      'w1',
      [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
      ],
      { openings: [{ edge: 0, at: 100, width: 92 }] },
    )
    const rings = seatPlan.wallOutlineOf(wall)
    expect(rings).toHaveLength(2)
    const xs = rings.map((ring) => ring.map((p) => p.x))
    expect(Math.max(...xs[0]!)).toBe(100)
    expect(Math.min(...xs[1]!)).toBe(192)
  })

  it('opens a closed wall into one piece round its corners', () => {
    const wall = room('w1', rect(0, 0, 400, 300), { openings: [{ edge: 1, at: 100, width: 92 }] })
    expect(seatPlan.wallOutlineOf(wall)).toHaveLength(1)
  })
})

describe('openingAt', () => {
  const plan = { walls: [room('w1', rect(0, 0, 400, 300), { openings: [{ edge: 2, at: 100, width: 92 }] })] }

  it('centres the opening where the point meets the nearest edge', () => {
    expect(seatPlan.openingAt(plan, { x: 200, y: 10 }, 92, 46)).toEqual({
      wall: 'w1',
      opening: { edge: 0, at: 154, width: 92 },
    })
  })

  it('keeps it within the edge', () => {
    expect(seatPlan.openingAt(plan, { x: 390, y: 2 }, 92, 46)).toMatchObject({ opening: { edge: 0, at: 308 } })
    expect(seatPlan.openingAt(plan, { x: 10, y: -2 }, 92, 46)).toMatchObject({ opening: { edge: 0, at: 0 } })
  })

  it('says why it cannot go there', () => {
    expect(seatPlan.openingAt(plan, { x: 200, y: 150 }, 92, 46)).toBe('far')
    expect(seatPlan.openingAt(plan, { x: 200, y: 10 }, 500, 46)).toBe('short')
    expect(seatPlan.openingAt(plan, { x: 240, y: 300 }, 92, 46)).toBe('taken')
  })
})
