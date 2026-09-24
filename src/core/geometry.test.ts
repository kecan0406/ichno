import { describe, expect, it } from 'vitest'
import { GRID_CELL } from './grid'
import { seatPlan, WALL_THICKNESS } from './geometry'
import { arcPoints, offsetPolygon, polygonContains } from './math'
import type { Desk, Fixture, PlanObject, Row, SeatPlan, Table } from './types'

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

function desk(id: string, section: S, x: number, y: number, size = 80): Desk<S> {
  return { kind: 'desk', id, section, x, y, w: size, h: size, chairSide: 'down' }
}

function fixture(id: string, role: string, x: number, y: number, w: number, h: number): Fixture {
  return { kind: 'fixture', id, role, x, y, w, h }
}

function planOf(objects: PlanObject<S>[]): SeatPlan<S> {
  return { version: 2, width: 1000, height: 800, sections, categories: [], objects }
}

const close = (value: number) => expect.closeTo(value, 6)

describe('seatPlan ids', () => {
  const plan = planOf([
    desk('A1', 'A', 20, 20),
    desk('A2', 'A', 120, 20),
    desk('B1', 'B', 520, 20),
    desk('VIP', 'B', 620, 20),
  ])

  it('objectById returns only existing ids', () => {
    expect(seatPlan.objectById(plan, 'A1')?.kind).toBe('desk')
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

  it('nextPlaceId counts seats inside rows and tables — they share the id namespace', () => {
    const row: Row<S> = {
      kind: 'row',
      id: 'row-1',
      section: 'A',
      start: { x: 40, y: 400 },
      end: { x: 400, y: 400 },
      curve: 0,
      seatSize: 40,
      seats: [{ id: 'A7' }, { id: 'A8' }],
    }
    expect(seatPlan.nextPlaceId(planOf([...plan.objects, row]), 'A')).toBe('A9')
    expect(seatPlan.nextObjectId(planOf([row]), 'row')).toBe('row-2')
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
})

describe('table layout', () => {
  const base = { x: 100, y: 100, w: 100, h: 100, seatSize: 40 }
  const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}` }))

  it('spreads round-table seats clockwise from the top', () => {
    const [top, right, bottom, left] = seatPlan
      .tableSeatsOf({ ...base, shape: 'round', seats: seats(4) })
      .map((s) => s.center)
    // radius 50 + half a seat 20 + gap 6 = 76 from the centre (150, 150)
    expect(top).toEqual({ x: close(150), y: close(74) })
    expect(right).toEqual({ x: close(226), y: close(150) })
    expect(bottom).toEqual({ x: close(150), y: close(226) })
    expect(left).toEqual({ x: close(74), y: close(150) })
  })

  it('splits rectangular-table seats over the long sides, the first side taking the odd one', () => {
    const centers = seatPlan.tableSeatsOf({ ...base, w: 200, shape: 'rect', seats: seats(3) }).map((s) => s.center)
    expect(centers.slice(0, 2).every((c) => c.y === 74)).toBe(true)
    expect(centers[2]).toEqual({ x: 200, y: 226 })
  })
})

describe('seatPlan.placesOf', () => {
  const table: Table<S> = {
    kind: 'table',
    id: 'T',
    section: 'B',
    shape: 'round',
    x: 700,
    y: 300,
    w: 80,
    h: 80,
    seatSize: 30,
    seats: [{ id: 'B10' }, { id: 'B11', label: 'Window' }],
  }

  it('flattens every bookable unit and skips fixtures', () => {
    const places = seatPlan.placesOf(planOf([fixture('wall-1', 'wall', 0, 0, 23, 184), desk('A1', 'A', 20, 20), table]))
    expect(places.map((p) => [p.id, p.kind, p.parent?.index])).toEqual([
      ['A1', 'desk', undefined],
      ['B10', 'table-seat', 0],
      ['B11', 'table-seat', 1],
    ])
    expect(places[2]!.label).toBe('Window')
    expect(places[0]!.label).toBe('A1')
  })

  it('books a whole table as one place holding all its seats', () => {
    const [place] = seatPlan.placesOf(planOf([{ ...table, wholeBooking: true }]))
    expect(place).toMatchObject({ id: 'T', kind: 'table', capacity: 2, shape: 'ellipse' })
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
  const plan = planOf([desk('A1', 'A', 20, 20), desk('B1', 'B', 520, 20), desk('B2', 'B', 620, 100)])

  it('holds only that section and its objects', () => {
    const cropped = seatPlan.sectionPlanOf(plan, 'B')!
    expect(cropped.sections.map((s) => s.id)).toEqual(['B'])
    expect(cropped.objects.map((o) => o.id)).toEqual(['B1', 'B2'])
  })

  it('translates coordinates while keeping geometry relative to the section', () => {
    const cropped = seatPlan.sectionPlanOf(plan, 'B')!
    const corner = cropped.sections[0]!.points[0]!
    const b1 = cropped.objects.find((o) => o.id === 'B1') as Desk<S>
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
    const cropped = seatPlan.sectionPlanOf(planOf([desk('A1', 'A', 20, 20)]), 'B')!
    expect(cropped.objects).toHaveLength(0)
    const box = seatPlan.sectionBoundsOf(cropped.sections[0]!)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.w).toBeLessThanOrEqual(cropped.width)
    expect(box.y + box.h).toBeLessThanOrEqual(cropped.height)
  })

  it('assigns fixtures to the section holding their centre and keeps them whole', () => {
    const withTv = planOf([desk('B1', 'B', 520, 20), fixture('tv-1', 'tv', 954, 100, 23, 300)])
    expect(seatPlan.sectionPlanOf(withTv, 'A')!.objects).toHaveLength(0)
    const cropped = seatPlan.sectionPlanOf(withTv, 'B')!
    const [b1, tv] = cropped.objects as [Desk<S>, Fixture]
    expect(tv.x + tv.w).toBeLessThanOrEqual(cropped.width)
    expect({ dx: tv.x - b1.x, dy: tv.y - b1.y }).toEqual({ dx: 954 - 520, dy: 100 - 20 })
  })

  it('returns null for a missing section', () => {
    expect(seatPlan.sectionPlanOf({ ...plan, sections: [sections[0]!] }, 'B')).toBeNull()
  })

  it('pads every crop to the widest one in GRID_CELL steps', () => {
    const crops = seatPlan.sectionPlansOf(
      planOf([desk('A1', 'A', 20, 20), desk('B1', 'B', 520, 20), desk('B2', 'B', 900, 20)]),
    )
    expect(crops.map((c) => c.id)).toEqual(['A', 'B'])
    expect(new Set(crops.map((c) => c.plan.width)).size).toBe(1)
  })
})

describe('free spots', () => {
  it('finds the first free desk cell inside the section, skipping taken ones', () => {
    const plan = planOf([desk('A1', 'A', 2, 2, 88)])
    expect(seatPlan.findFreeDeskPos(plan, 'A')).toEqual({ x: 94, y: 2 })
  })

  it('returns null for a section that does not exist', () => {
    expect(seatPlan.findFreeDeskPos({ ...planOf([]), sections: [] }, 'A')).toBeNull()
  })
})
