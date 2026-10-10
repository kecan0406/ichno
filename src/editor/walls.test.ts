import { describe, expect, it } from 'vitest'
import { seatPlan } from '../core/geometry'
import type { PlanObject, PlanPoint, SeatPlan, Wall } from '../core/types'
import { planHandles } from './handles'
import { planEdits } from './operations'

const SNAP = { cell: 46 }

function rect(x: number, y: number, w: number, h: number): PlanPoint[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

function planOf(walls: Wall[], objects: PlanObject[] = []): SeatPlan {
  return {
    version: 3,
    width: 1380,
    height: 828,
    sections: [{ id: 'S', points: rect(0, 0, 1380, 828) }],
    walls,
    categories: [],
    groups: [],
    objects,
  }
}

const room = (id: string, points: PlanPoint[], extra: Partial<Wall> = {}): Wall => ({
  id,
  points,
  thickness: 12,
  closed: true,
  ...extra,
})

const seat = (id: string, x: number, y: number): PlanObject => ({
  kind: 'place',
  id,
  section: 'S',
  x,
  y,
  w: 36,
  h: 36,
  shape: 'rect',
  capacity: 1,
})

const wallOf = (plan: SeatPlan, id: string) => seatPlan.wallOf(plan, id)!

const drag = (plan: SeatPlan, id: string, name: string, total: PlanPoint, alt = false) =>
  planHandles.drag(plan, { kind: 'wall', id }, name, total, SNAP, false, 1, alt)

describe('addWall', () => {
  it('keeps a hundredth of a unit on the plan, drops repeated points and numbers its id', () => {
    const made = planEdits.addWall(planOf([]), {
      points: [
        { x: -10, y: 0.404 },
        { x: -10, y: 0.404 },
        { x: 400.567, y: 0 },
      ],
      thickness: 12,
    })!

    expect(made.ids).toEqual(['wall-1'])
    expect(wallOf(made.plan, 'wall-1').points).toEqual([
      { x: 0, y: 0.4 },
      { x: 400.57, y: 0 },
    ])
  })

  it('needs three corners to close', () => {
    const two = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ]

    expect(planEdits.addWall(planOf([]), { points: two, thickness: 12, closed: true })).toBeNull()
    expect(planEdits.addWall(planOf([]), { points: two.slice(0, 1), thickness: 12 })).toBeNull()
  })
})

describe('moving walls', () => {
  it('carries what stands in a closed wall, and the walls inside it', () => {
    const plan = planOf(
      [
        room('w1', rect(46, 46, 460, 460)),
        {
          id: 'w2',
          points: [
            { x: 276, y: 46 },
            { x: 276, y: 506 },
          ],
          thickness: 8,
        },
      ],
      [seat('S1', 92, 92), seat('S2', 690, 92)],
    )

    const moved = planEdits.move(plan, ['w1'], { x: 46, y: 0 }, SNAP)
    expect(wallOf(moved, 'w1').points[0]).toEqual({ x: 92, y: 46 })
    expect(wallOf(moved, 'w2').points[0]).toEqual({ x: 322, y: 46 })
    expect(seatPlan.objectById(moved, 'S1')!.x).toBe(138)
    expect(seatPlan.objectById(moved, 'S2')!.x).toBe(690)
  })

  it('copies a room whole on a copying drag and leaves the original where it was', () => {
    const plan = planOf([room('w1', rect(46, 46, 460, 460))], [seat('S1', 92, 92)])

    const copied = planEdits.applyDrag(
      plan,
      { target: { kind: 'wall', id: 'w1' }, phase: 'end', total: { x: 552, y: 0 }, copy: true },
      [],
      SNAP,
    )

    expect(copied.walls.map((w) => w.points[0])).toEqual([
      { x: 46, y: 46 },
      { x: 598, y: 46 },
    ])
    expect(copied.objects.map((o) => [o.id, o.x])).toEqual([
      ['S1', 92],
      ['S2', 644],
    ])
  })
})

describe('wall handles', () => {
  it('pushes an edge and takes the partition ending on it along', () => {
    const plan = planOf([
      room('w1', rect(46, 46, 460, 460)),
      {
        id: 'w2',
        points: [
          { x: 276, y: 46 },
          { x: 276, y: 506 },
        ],
        thickness: 8,
      },
    ])

    const pushed = drag(plan, 'w1', 'edge-0', { x: 0, y: -40 })
    expect(wallOf(pushed, 'w1').points.slice(0, 2)).toEqual([
      { x: 46, y: 0 },
      { x: 506, y: 0 },
    ])
    expect(wallOf(pushed, 'w2').points).toEqual([
      { x: 276, y: 0 },
      { x: 276, y: 506 },
    ])
  })

  it('leaves a joint where it is when the edge it is on still runs through it', () => {
    const plan = planOf([
      room('w1', rect(46, 46, 460, 460)),
      {
        id: 'w2',
        points: [
          { x: 46, y: 276 },
          { x: 276, y: 276 },
        ],
        thickness: 8,
      },
    ])

    const pushed = drag(plan, 'w1', 'edge-0', { x: 0, y: -46 })
    expect(wallOf(pushed, 'w2').points[0]).toEqual({ x: 46, y: 276 })
  })

  it('keeps a joint at its place along an edge a moved vertex turns', () => {
    const plan = planOf([
      room('w1', rect(0, 0, 460, 460)),
      {
        id: 'w2',
        points: [
          { x: 460, y: 230 },
          { x: 690, y: 230 },
        ],
        thickness: 8,
      },
    ])

    const moved = drag(plan, 'w1', 'vertex-2', { x: 92, y: 0 })
    expect(wallOf(moved, 'w2').points[0]).toEqual({ x: 506, y: 230 })
  })

  it('moves an opening back within an edge that got shorter, and drops one wider than its edge', () => {
    const plan = planOf([
      room('w1', rect(0, 0, 460, 460), {
        openings: [
          { edge: 0, at: 300, width: 92, role: 'door' },
          { edge: 1, at: 0, width: 400 },
        ],
      }),
    ])

    // Both edges at the moved corner come out √(368² + 92²) ≈ 379 long.
    const narrower = drag(plan, 'w1', 'vertex-1', { x: -92, y: 92 })
    expect(wallOf(narrower, 'w1').openings).toEqual([{ edge: 0, at: 287, width: 92, role: 'door' }])
  })

  it('splits an edge with Alt, the openings past its middle going to the second half', () => {
    const plan = planOf([
      room('w1', rect(0, 0, 460, 460), {
        openings: [
          { edge: 0, at: 46, width: 92 },
          { edge: 0, at: 322, width: 92 },
          { edge: 2, at: 46, width: 92 },
        ],
      }),
    ])

    const split = drag(plan, 'w1', 'edge-0', { x: 0, y: 0 }, true)
    expect(wallOf(split, 'w1').points).toHaveLength(5)
    expect(wallOf(split, 'w1').openings).toEqual([
      { edge: 0, at: 46, width: 92 },
      { edge: 1, at: 92, width: 92 },
      { edge: 3, at: 46, width: 92 },
    ])
  })

  it('merges a vertex dropped on its neighbour, joining the openings of the edges either side', () => {
    const plan = planOf([
      room(
        'w1',
        [
          { x: 0, y: 0 },
          { x: 230, y: 0 },
          { x: 460, y: 0 },
          { x: 460, y: 460 },
          { x: 0, y: 460 },
        ],
        {
          openings: [{ edge: 1, at: 46, width: 92 }],
        },
      ),
    ])

    const merged = drag(plan, 'w1', 'vertex-1', { x: -230, y: 0 })
    expect(wallOf(merged, 'w1').points).toHaveLength(4)
    expect(wallOf(merged, 'w1').openings).toEqual([{ edge: 0, at: 276, width: 92 }])
  })
})

describe('openings', () => {
  it('goes in where it fits and nowhere it would cut into another', () => {
    const plan = planOf([room('w1', rect(0, 0, 460, 460))])
    const opened = planEdits.addOpening(plan, 'w1', { edge: 0, at: 100, width: 92, role: 'door' })!
    expect(wallOf(opened, 'w1').openings).toEqual([{ edge: 0, at: 100, width: 92, role: 'door' }])
    expect(planEdits.addOpening(opened, 'w1', { edge: 0, at: 150, width: 92 })).toBeNull()
    expect(planEdits.addOpening(opened, 'w1', { edge: 0, at: 400, width: 92 })).toBeNull()
    expect(wallOf(planEdits.removeOpening(opened, 'w1', 0), 'w1').openings).toBeUndefined()
  })
})

describe('building a wall a piece at a time', () => {
  const piece = (a: PlanPoint, b: PlanPoint) => ({ points: [a, b], thickness: 15 })

  const line = (id: string, points: PlanPoint[], extra: Partial<Wall> = {}): Wall => ({
    id,
    points,
    thickness: 15,
    ...extra,
  })

  const p = (x: number, y: number) => ({ x, y })

  it('starts a new wall where no wall ends', () => {
    const built = planEdits.buildWall(planOf([]), piece(p(100, 100), p(200, 100)))!
    expect(built.ids).toEqual(['wall-1'])
    expect(wallOf(built.plan, 'wall-1').points).toEqual([p(100, 100), p(200, 100)])
  })

  it('carries a wall on — straight on lengthens its last edge, a turn adds a corner', () => {
    const plan = planOf([line('w1', [p(100, 100), p(200, 100)])])
    const straight = planEdits.buildWall(plan, piece(p(200, 100), p(300, 100)))!
    expect(straight.ids).toEqual(['w1'])
    expect(wallOf(straight.plan, 'w1').points).toEqual([p(100, 100), p(300, 100)])
    const turned = planEdits.buildWall(plan, piece(p(200, 100), p(200, 200)))!
    expect(wallOf(turned.plan, 'w1').points).toEqual([p(100, 100), p(200, 100), p(200, 200)])
  })

  it('carries a wall on from its start, its openings staying where they were', () => {
    const plan = planOf([line('w1', [p(100, 100), p(300, 100)], { openings: [{ edge: 0, at: 20, width: 90 }] })])
    const built = planEdits.buildWall(plan, piece(p(100, 100), p(0, 100)))!
    const wall = wallOf(built.plan, 'w1')
    expect(wall.points).toEqual([p(300, 100), p(0, 100)])
    // 120 to 210 along x — now 90 from the new start at 300.
    expect(wall.openings).toEqual([{ edge: 0, at: 90, width: 90 }])
  })

  it('links two walls into one when a piece meets an end of each', () => {
    const plan = planOf([
      line('w1', [p(100, 100), p(200, 100)]),
      line('w2', [p(300, 100), p(300, 300)], { openings: [{ edge: 0, at: 50, width: 90, role: 'door' }] }),
    ])

    const built = planEdits.buildWall(plan, piece(p(200, 100), p(300, 100)))!
    expect(built.plan.walls.map((w) => w.id)).toEqual(['w1'])
    const wall = wallOf(built.plan, 'w1')
    expect(wall.points).toEqual([p(100, 100), p(300, 100), p(300, 300)])
    expect(wall.openings).toEqual([{ edge: 1, at: 50, width: 90, role: 'door' }])
  })

  it('closes a wall round into a room when a piece brings it back to its start', () => {
    const plan = planOf([line('w1', [p(100, 100), p(200, 100), p(200, 200), p(100, 200)])])
    const built = planEdits.buildWall(plan, piece(p(100, 200), p(100, 100)))!
    const wall = wallOf(built.plan, 'w1')
    expect(wall.closed).toBe(true)
    expect(wall.points).toEqual([p(100, 100), p(200, 100), p(200, 200), p(100, 200)])
    expect(seatPlan.roomsOf(built.plan)).toHaveLength(1)
  })

  it('carries a slanted wall on in one edge though its rounded corners are a unit off straight', () => {
    // 15° pieces of a metre end on whole units (97, 26), (193, 52): the corner between them is 0.13 off the line.
    const plan = planOf([line('w1', [p(0, 0), p(97, 26)])])
    const built = planEdits.buildWall(plan, piece(p(97, 26), p(193, 52)))!
    expect(wallOf(built.plan, 'w1').points).toEqual([p(0, 0), p(193, 52)])
  })

  it('keeps a metre turned any way a metre — its corners to a hundredth', () => {
    const a = (10 * Math.PI) / 180
    const built = planEdits.buildWall(planOf([]), piece(p(0, 0), p(100 * Math.cos(a), 100 * Math.sin(a))))!
    // SAFETY: a wall built from one piece is that piece — its two ends.
    const [from, to] = wallOf(built.plan, 'wall-1').points as [PlanPoint, PlanPoint]
    expect(to).toEqual(p(98.48, 17.36))
    expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeCloseTo(100, 1)
  })

  it('refuses a piece along a wall already there, or off the plan', () => {
    const plan = planOf([line('w1', [p(100, 100), p(300, 100)])])
    expect(planEdits.buildWall(plan, piece(p(200, 100), p(300, 100)))).toBeNull()
    expect(planEdits.buildWall(plan, piece(p(1300, 100), p(1400, 100)))).toBeNull()
  })
})

describe('the walls step', () => {
  const metre = { cell: 50, wall: 100 }

  it('puts a dragged corner and a pushed edge on the walls step', () => {
    const plan = planOf([room('w1', rect(100, 100, 300, 300))])
    const moved = planHandles.drag(plan, { kind: 'wall', id: 'w1' }, 'vertex-2', { x: 60, y: 30 }, metre, false, 1)
    expect(wallOf(moved, 'w1').points[2]).toEqual({ x: 500, y: 400 })
    // Pushed less than half the step, it stays; past half, it goes a whole step.
    const nudged = planHandles.drag(plan, { kind: 'wall', id: 'w1' }, 'edge-0', { x: 0, y: -40 }, metre, false, 1)
    expect(wallOf(nudged, 'w1').points[0]).toEqual({ x: 100, y: 100 })
    const pushed = planHandles.drag(plan, { kind: 'wall', id: 'w1' }, 'edge-0', { x: 0, y: -60 }, metre, false, 1)
    expect(wallOf(pushed, 'w1').points[0]).toEqual({ x: 100, y: 0 })
  })

  it('moves walls, and what a room carries, by the walls step', () => {
    const plan = planOf([room('w1', rect(100, 100, 300, 300))], [seat('S1', 150, 150)])
    const moved = planEdits.move(plan, ['w1'], { x: 70, y: 0 }, metre)
    expect(wallOf(moved, 'w1').points[0]).toEqual({ x: 200, y: 100 })
    expect(seatPlan.objectById(moved, 'S1')!.x).toBe(250)
  })
})
