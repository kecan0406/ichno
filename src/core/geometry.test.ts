import { describe, expect, it } from 'vitest'
import { GRID_CELL } from './grid'
import { seatPlan, WALL_THICKNESS } from './geometry'
import { TABLE_SEAT_GAP, layout } from './layout'
import { arcPoints, offsetPolygon, polygonContains } from './math'
import type { Fixture, Place, PlanObject, SeatPlan } from './types'

type S = 'A' | 'B'

const sections = [
  { id: 'A' as const, points: rect(0, 0, 500, 800) },
  { id: 'B' as const, points: rect(500, 0, 500, 800) },
]

function rect(x: number, y: number, w: number, h: number) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

function place(id: string, section: S, x: number, y: number, extra: Partial<Place<S>> = {}): Place<S> {
  return { kind: 'place', id, section, x, y, w: 80, h: 80, shape: 'rect', capacity: 1, ...extra }
}

function fixture(id: string, x: number, y: number, w: number, h: number, extra: Partial<Fixture> = {}): Fixture {
  return { kind: 'fixture', id, shape: 'rect', x, y, w, h, ...extra }
}

function planOf(objects: PlanObject<S>[], groups: SeatPlan<S>['groups'] = []): SeatPlan<S> {
  return { version: 3, width: 1000, height: 800, sections, categories: [], groups, objects }
}

const close = (value: number) => expect.closeTo(value, 6)

describe('seatPlan ids', () => {
  const plan = planOf([
    place('A1', 'A', 20, 20),
    place('A2', 'A', 120, 20),
    place('B1', 'B', 520, 20),
    place('VIP', 'B', 620, 20),
  ])

  it('objectById returns only existing ids', () => {
    expect(seatPlan.objectById(plan, 'A1')?.kind).toBe('place')
    expect(seatPlan.objectById(plan, 'C1')).toBeUndefined()
  })

  it('nextPlaceId is the section max + 1 and ignores ids outside the pattern (VIP)', () => {
    expect(seatPlan.nextPlaceId(plan, 'A')).toBe('A3')
    expect(seatPlan.nextPlaceId(plan, 'B')).toBe('B2')
  })

  it('nextPlaceId never reuses a deleted number (no accidental reconnection to old records)', () => {
    const removed = { ...plan, objects: plan.objects.filter((o) => o.id !== 'A1') }
    expect(seatPlan.nextPlaceId(removed, 'A')).toBe('A3')
  })

  it('counts group ids too — objects and groups share the id namespace', () => {
    const grouped = planOf(plan.objects, [{ id: 'row-4' }, { id: 'A9' }])
    expect(seatPlan.nextPlaceId(grouped, 'A')).toBe('A10')
    expect(seatPlan.nextObjectId(grouped, 'row')).toBe('row-5')
  })
})

describe('arc layout (row seats)', () => {
  const start = { x: 0, y: 100 }
  const end = { x: 200, y: 100 }

  it('spreads seats evenly on a straight row, both ends included', () => {
    expect(arcPoints(start, end, 0, 3)).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ])
  })

  it('puts a single seat in the middle of the arc', () => {
    expect(arcPoints(start, end, 0, 1)).toEqual([{ x: 100, y: 100 }])
    const [only] = arcPoints(start, end, 0.5, 1)
    expect(only).toEqual({ x: close(100), y: close(50) })
  })

  it('bows a positive curve to the left of start→end (up for a left-to-right row)', () => {
    const [, middle] = arcPoints(start, end, 0.5, 3)
    // sagitta = curve × chord / 2 = 50
    expect(middle).toEqual({ x: close(100), y: close(50) })
    const [, down] = arcPoints(start, end, -0.5, 3)
    expect(down).toEqual({ x: close(100), y: close(150) })
  })

  it('keeps the end points on a curved row', () => {
    const points = arcPoints(start, end, 0.8, 5)
    expect(points[0]).toEqual({ x: close(0), y: close(100) })
    expect(points[4]).toEqual({ x: close(200), y: close(100) })
  })

  it('draws a half circle at curve 1 — seats equally far from the centre', () => {
    const points = arcPoints(start, end, 1, 5)
    for (const p of points) expect(Math.hypot(p.x - 100, p.y - 100)).toBeCloseTo(100, 6)
    expect(points[2]).toEqual({ x: close(100), y: close(0) })
  })

  it('lays whole-unit seat boxes on the arc, turned along it', () => {
    const boxes = layout.arc({ start, end, curve: 0.5, count: 3, size: 40 })
    expect(boxes.map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual([
      { x: -20, y: 80, w: 40, h: 40 },
      { x: 80, y: 30, w: 40, h: 40 },
      { x: 180, y: 80, w: 40, h: 40 },
    ])
    // Rising at the start, level at the apex, falling at the end (clockwise degrees).
    expect(boxes[0]!.rotation).toBeGreaterThan(270)
    expect(boxes[1]!.rotation).toBeUndefined()
    expect(boxes[2]!.rotation).toBeGreaterThan(0)
    expect(boxes[2]!.rotation).toBeLessThan(90)
  })

  it('reads the curve back from seat centres — the inverse of the arc', () => {
    for (const curve of [0, 0.35, -0.6, 1]) {
      for (const count of [3, 6]) expect(layout.curveOf(arcPoints(start, end, curve, count))).toBeCloseTo(curve, 2)
    }
  })
})

describe('table layout', () => {
  const table = { x: 100, y: 100, w: 100, h: 100 }
  const centers = (boxes: { x: number; y: number; w: number; h: number }[]) =>
    boxes.map((b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 }))

  it('spreads round-table seats clockwise from the top, facing the table', () => {
    const boxes = layout.around({ table, shape: 'ellipse', count: 4, size: 40 })
    // radius 50 + half a seat 20 + gap 6 = 76 from the centre (150, 150)
    expect(centers(boxes)).toEqual([
      { x: 150, y: 74 },
      { x: 226, y: 150 },
      { x: 150, y: 226 },
      { x: 74, y: 150 },
    ])
    expect(boxes.map((b) => b.rotation ?? 0)).toEqual([0, 90, 180, 270])
  })

  it('spaces seats evenly along an oval table and turns each to face its edge squarely', () => {
    const oval = { x: 0, y: 0, w: 300, h: 100 }
    const boxes = layout.around({ table: oval, shape: 'ellipse', count: 14, size: 36 })
    const c = centers(boxes)
    const next = (i: number) => c[(i + 1) % c.length]!
    const gaps = c.map((p, i) => Math.hypot(next(i).x - p.x, next(i).y - p.y))
    // Chords shrink a little where the edge bends hardest; the seats never crowd the ends.
    expect(Math.min(...gaps) / Math.max(...gaps)).toBeGreaterThan(0.85)
    const seats = boxes.map((b, i) => place(`A${i + 1}`, 'A', b.x, b.y, { ...b, shape: 'ellipse' }))
    expect(seatPlan.conflictsOf({ objects: seats })).toEqual([])
    // Each seat sits the seat gap off the edge and faces the nearest point of it — not the middle of the table.
    const edge = Array.from({ length: 3600 }, (_, k) => {
      const t = (2 * Math.PI * k) / 3600
      return { x: 150 + 150 * Math.cos(t), y: 50 + 50 * Math.sin(t) }
    })
    boxes.forEach((b, i) => {
      const nearest = edge.reduce((best, q) =>
        Math.hypot(q.x - c[i]!.x, q.y - c[i]!.y) < Math.hypot(best.x - c[i]!.x, best.y - c[i]!.y) ? q : best,
      )
      expect(Math.abs(Math.hypot(nearest.x - c[i]!.x, nearest.y - c[i]!.y) - (18 + TABLE_SEAT_GAP))).toBeLessThan(1)
      // A seat's front is its local +y, turned with it.
      const toward = (Math.atan2(nearest.y - c[i]!.y, nearest.x - c[i]!.x) * 180) / Math.PI
      const off = (((b.rotation ?? 0) + 90 - toward + 540) % 360) - 180
      expect(Math.abs(off)).toBeLessThan(3)
    })
    // A quarter of the way round from the top is the end of the long side.
    const four = layout.around({ table: oval, shape: 'ellipse', count: 4, size: 36 })
    expect(centers(four)).toEqual([
      { x: 150, y: -24 },
      { x: 324, y: 50 },
      { x: 150, y: 124 },
      { x: -24, y: 50 },
    ])
    expect(four.map((b) => b.rotation ?? 0)).toEqual([0, 90, 180, 270])
  })

  it('splits rectangular-table seats over the long sides, the first side taking the odd one', () => {
    const seats = centers(layout.around({ table: { ...table, w: 200 }, shape: 'rect', count: 3, size: 40 }))
    expect(seats.slice(0, 2).every((c) => c.y === 74)).toBe(true)
    expect(seats[2]).toEqual({ x: 200, y: 226 })
  })

  it('turns the seats with a turned table', () => {
    const [top] = layout.around({ table: { ...table, rotation: 90 }, shape: 'ellipse', count: 4, size: 40 })
    // The top seat of a table turned a quarter clockwise sits on its right.
    expect(centers([top!])[0]).toEqual({ x: 226, y: 150 })
    expect(top!.rotation).toBe(90)
  })
})

describe('turned shapes', () => {
  it('bounds a turned rectangle by its corners and a turned ellipse exactly', () => {
    const square = place('A1', 'A', 100, 100, { w: 100, h: 100, rotation: 45 })
    const half = 50 * Math.SQRT2
    expect(seatPlan.boundsOf(square)).toEqual({
      x: close(150 - half),
      y: close(150 - half),
      w: close(2 * half),
      h: close(2 * half),
    })
    const ellipse = place('A2', 'A', 0, 0, { w: 200, h: 100, shape: 'ellipse', rotation: 90 })
    expect(seatPlan.boundsOf(ellipse)).toEqual({ x: close(50), y: close(-50), w: close(100), h: close(200) })
  })

  it('tests points on the turned shape, not its unturned box', () => {
    const bar = place('A1', 'A', 0, 90, { w: 200, h: 20, rotation: 90 })
    expect(seatPlan.contains(bar, { x: 100, y: 10 })).toBe(true)
    expect(seatPlan.contains(bar, { x: 10, y: 100 })).toBe(false)
  })

  it('lets places touch, and up to OVERLAP_TOLERANCE cross, without overlapping', () => {
    const a = place('A1', 'A', 0, 0, { w: 40, h: 40, shape: 'ellipse' })
    expect(seatPlan.overlaps(a, place('A2', 'A', 40, 0, { w: 40, h: 40, shape: 'ellipse' }))).toBe(false)
    expect(seatPlan.overlaps(a, place('A2', 'A', 39, 0, { w: 40, h: 40, shape: 'ellipse' }))).toBe(false)
    expect(seatPlan.overlaps(a, place('A2', 'A', 36, 0, { w: 40, h: 40, shape: 'ellipse' }))).toBe(true)
  })

  it('finds overlaps a turned place makes that its unturned box would not', () => {
    const bar = place('A1', 'A', 100, 190, { w: 200, h: 20 })
    const below = place('A2', 'A', 180, 220)
    expect(seatPlan.overlaps(bar, below)).toBe(false)
    expect(seatPlan.overlaps({ ...bar, rotation: 90 }, below)).toBe(true)
  })

  it('reports only places in conflict — fixtures may overlap anything', () => {
    const plan = planOf([
      place('A1', 'A', 20, 20),
      place('A2', 'A', 60, 20),
      fixture('chair', 30, 30, 20, 20),
      place('A3', 'A', 300, 20),
    ])
    expect(seatPlan.conflictsOf(plan)).toEqual([['A1', 'A2']])
  })

  it('orders ids along a direction — groups by their frame, level ties in the order given', () => {
    const plan = planOf(
      [
        place('A3', 'A', 200, 0, { group: 'r1' }),
        place('A1', 'A', 0, 0, { group: 'r1' }),
        place('A2', 'A', 100, 0),
        place('B1', 'A', 0, 300, { group: 'r2' }),
      ],
      [{ id: 'r1' }, { id: 'r2' }],
    )
    expect(seatPlan.orderAlong(plan, ['A3', 'A1', 'A2'])).toEqual(['A1', 'A2', 'A3'])
    expect(seatPlan.orderAlong(plan, ['A3', 'A1', 'A2'], 180)).toEqual(['A3', 'A2', 'A1'])
    // Top to bottom: the seats share a level, so they keep the order given.
    expect(seatPlan.orderAlong(plan, ['A3', 'A1', 'A2'], 90)).toEqual(['A3', 'A1', 'A2'])
    expect(seatPlan.orderAlong(plan, ['r2', 'missing', 'r1'], 90)).toEqual(['r1', 'r2'])
  })
})

describe('sections', () => {
  it('finds the section holding a point, edges included', () => {
    const plan = planOf([])
    expect(seatPlan.sectionAt(plan, { x: 10, y: 10 })).toBe('A')
    expect(seatPlan.sectionAt(plan, { x: 700, y: 10 })).toBe('B')
    expect(seatPlan.sectionAt(plan, { x: 500, y: 10 })).toBe('A')
    expect(seatPlan.sectionAt(plan, { x: 2000, y: 10 })).toBeNull()
  })

  it('handles a concave (L-shaped) section', () => {
    const l = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ]
    expect(polygonContains(l, { x: 25, y: 75 })).toBe(true)
    expect(polygonContains(l, { x: 75, y: 75 })).toBe(false)
  })

  it('pushes the wall outline outward whichever way the outline winds', () => {
    const half = WALL_THICKNESS / 2
    const clockwise = rect(0, 0, 100, 50)
    expect(seatPlan.sectionWallOf({ points: clockwise })[0]).toEqual({ x: close(-half), y: close(-half) })
    const counter = [...clockwise].reverse()
    expect(offsetPolygon(counter, half)).toContainEqual({ x: close(-half), y: close(-half) })
  })
})

describe('seatPlan.sectionPlanOf — per-section crops for narrow screens', () => {
  const plan = planOf([place('A1', 'A', 20, 20), place('B1', 'B', 520, 20), place('B2', 'B', 620, 100)])

  it('holds only that section and its objects', () => {
    const cropped = seatPlan.sectionPlanOf(plan, 'B')!
    expect(cropped.sections.map((s) => s.id)).toEqual(['B'])
    expect(cropped.objects.map((o) => o.id)).toEqual(['B1', 'B2'])
  })

  it('translates coordinates while keeping geometry relative to the section', () => {
    const cropped = seatPlan.sectionPlanOf(plan, 'B')!
    const corner = cropped.sections[0]!.points[0]!
    const b1 = cropped.objects.find((o) => o.id === 'B1')!
    expect(b1.x - corner.x).toBe(20)
    expect(b1.y - corner.y).toBe(20)
    expect(corner.x).toBeGreaterThanOrEqual(0)
  })

  it('bounds are GRID_CELL multiples and contain every object', () => {
    const cropped = seatPlan.sectionPlanOf(plan, 'B')!
    expect(cropped.width % GRID_CELL).toBe(0)
    expect(cropped.height % GRID_CELL).toBe(0)
    for (const o of cropped.objects) {
      const b = seatPlan.boundsOf(o)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x + b.w).toBeLessThanOrEqual(cropped.width)
      expect(b.y + b.h).toBeLessThanOrEqual(cropped.height)
    }
  })

  it('cuts empty floor out of the bounds (less empty height when stacked)', () => {
    const cropped = seatPlan.sectionPlanOf(plan, 'B')!
    expect(cropped.height).toBeLessThan(400)
  })

  it('uses the outline as the bound for an empty section', () => {
    const cropped = seatPlan.sectionPlanOf(planOf([place('A1', 'A', 20, 20)]), 'B')!
    expect(cropped.objects).toHaveLength(0)
    const box = seatPlan.sectionBoundsOf(cropped.sections[0]!)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.w).toBeLessThanOrEqual(cropped.width)
    expect(box.y + box.h).toBeLessThanOrEqual(cropped.height)
  })

  it('assigns loose fixtures to the section holding their centre and keeps them whole', () => {
    const withTv = planOf([place('B1', 'B', 520, 20), fixture('tv-1', 954, 100, 23, 300)])
    expect(seatPlan.sectionPlanOf(withTv, 'A')!.objects).toHaveLength(0)
    const cropped = seatPlan.sectionPlanOf(withTv, 'B')!
    const [b1, tv] = cropped.objects as [Place<S>, Fixture]
    expect(tv.x + tv.w).toBeLessThanOrEqual(cropped.width)
    expect({ dx: tv.x - b1.x, dy: tv.y - b1.y }).toEqual({ dx: 954 - 520, dy: 100 - 20 })
  })

  it('keeps a group together — its fixtures and labels follow its places, wherever their centre lies', () => {
    const grouped = planOf(
      [
        place('B1', 'B', 520, 20, { group: 'T' }),
        fixture('top', 440, 20, 60, 60, { group: 'T' }),
        { kind: 'label', id: 'T-l', group: 'T', x: 420, y: 100, w: 40, h: 40 },
      ],
      [{ id: 'T' }, { id: 'unused' }],
    )
    expect(seatPlan.sectionPlanOf(grouped, 'A')!.objects).toHaveLength(0)
    const cropped = seatPlan.sectionPlanOf(grouped, 'B')!
    expect(cropped.objects.map((o) => o.id)).toEqual(['B1', 'top', 'T-l'])
    expect(cropped.groups).toEqual([{ id: 'T' }])
  })

  it('returns null for a missing section', () => {
    expect(seatPlan.sectionPlanOf({ ...plan, sections: [sections[0]!] }, 'B')).toBeNull()
  })

  it('pads every crop to the widest one in GRID_CELL steps', () => {
    const crops = seatPlan.sectionPlansOf(
      planOf([place('A1', 'A', 20, 20), place('B1', 'B', 520, 20), place('B2', 'B', 900, 20)]),
    )
    expect(crops.map((c) => c.id)).toEqual(['A', 'B'])
    expect(new Set(crops.map((c) => c.plan.width)).size).toBe(1)
  })
})
