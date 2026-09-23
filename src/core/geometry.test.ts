import { describe, expect, it } from 'vitest'
import { GRID_CELL } from './grid'
import { seatPlan } from './geometry'
import type { FixtureKind, SeatPlan } from './types'

const base = {
  width: 1000,
  height: 800,
  zones: [
    { id: 'A', x: 0, y: 0, w: 500, h: 800 },
    { id: 'B', x: 500, y: 0, w: 500, h: 800 },
  ],
}

function seat(id: string, zone: 'A' | 'B', x: number, y: number, size = 80) {
  return { id, zone, x, y, w: size, h: size, chairSide: 'down' as const }
}

function fixture(id: string, kind: FixtureKind, x: number, y: number, w: number, h: number) {
  return { id, kind, x, y, w, h }
}

function planOf(seats: ReturnType<typeof seat>[], fixtures: ReturnType<typeof fixture>[] = []): SeatPlan<'A' | 'B'> {
  return { ...(base as SeatPlan<'A' | 'B'>), seats, fixtures }
}

describe('seatPlan document functions', () => {
  const plan = planOf([
    seat('A1', 'A', 20, 20),
    seat('A2', 'A', 120, 20),
    seat('B1', 'B', 520, 20),
    seat('VIP', 'B', 620, 20),
  ])

  it('byId returns only existing keys', () => {
    expect(seatPlan.byId(plan, 'A1')?.zone).toBe('A')
    expect(seatPlan.byId(plan, 'C1')).toBeUndefined()
  })

  it('nextSeatId is the zone max + 1 and ignores ids outside the pattern (VIP)', () => {
    expect(seatPlan.nextSeatId(plan, 'A')).toBe('A3')
    expect(seatPlan.nextSeatId(plan, 'B')).toBe('B2')
  })

  it('nextSeatId never reuses a deleted number (no accidental reconnection to old records)', () => {
    const removed = { ...plan, seats: plan.seats.filter((s) => s.id !== 'A1') }
    expect(seatPlan.nextSeatId(removed, 'A')).toBe('A3')
  })
})

describe('seatPlan.zonePlanOf — per-zone crops for narrow screens', () => {
  const plan = planOf([seat('A1', 'A', 20, 20), seat('B1', 'B', 520, 20), seat('B2', 'B', 620, 100)])

  it('holds only that zone and its seats', () => {
    const cropped = seatPlan.zonePlanOf(plan, 'B')!
    expect(cropped.zones).toHaveLength(1)
    expect(cropped.zones[0]!.id).toBe('B')
    expect(cropped.seats.map((s) => s.id)).toEqual(['B1', 'B2'])
  })

  it('translates coordinates while keeping geometry relative to the zone', () => {
    const cropped = seatPlan.zonePlanOf(plan, 'B')!
    const zone = cropped.zones[0]!
    const b1 = cropped.seats.find((s) => s.id === 'B1')!
    expect(b1.x - zone.x).toBe(20)
    expect(b1.y - zone.y).toBe(20)
    expect(zone.x).toBeGreaterThanOrEqual(0)
    expect(zone.y).toBeGreaterThanOrEqual(0)
  })

  it('bounds are GRID_CELL multiples and contain every seat', () => {
    const cropped = seatPlan.zonePlanOf(plan, 'B')!
    expect(cropped.width % GRID_CELL).toBe(0)
    expect(cropped.height % GRID_CELL).toBe(0)
    for (const s of cropped.seats) {
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.y).toBeGreaterThanOrEqual(0)
      expect(s.x + s.w).toBeLessThanOrEqual(cropped.width)
      expect(s.y + s.h).toBeLessThanOrEqual(cropped.height)
    }
  })

  it('cuts seatless floor out of the bounds (less empty height when stacked)', () => {
    const cropped = seatPlan.zonePlanOf(plan, 'B')!
    expect(cropped.height).toBeLessThan(400)
    const zone = cropped.zones[0]!
    expect(zone.y + zone.h).toBeGreaterThan(cropped.height)
  })

  it('contains a seat placed outside its zone box', () => {
    const stray = planOf([seat('B1', 'B', 430, 20)])
    const cropped = seatPlan.zonePlanOf(stray, 'B')!
    const b1 = cropped.seats.find((s) => s.id === 'B1')!
    expect(b1.x).toBeGreaterThanOrEqual(0)
    expect(b1.x + b1.w).toBeLessThanOrEqual(cropped.width)
    expect(b1.y + b1.h).toBeLessThanOrEqual(cropped.height)
  })

  it('uses the room rectangle as the bound for a seatless zone', () => {
    const cropped = seatPlan.zonePlanOf(planOf([seat('A1', 'A', 20, 20)]), 'B')!
    expect(cropped.seats).toHaveLength(0)
    const zone = cropped.zones[0]!
    expect(zone.x).toBeGreaterThanOrEqual(0)
    expect(zone.x + zone.w).toBeLessThanOrEqual(cropped.width)
    expect(zone.y + zone.h).toBeLessThanOrEqual(cropped.height)
  })

  it('assigns fixtures to the room holding their centre and keeps them whole', () => {
    const withTv = planOf([seat('B1', 'B', 520, 20)], [fixture('tv-1', 'tv', 954, 100, 23, 300)])
    expect(seatPlan.zonePlanOf(withTv, 'A')!.fixtures).toHaveLength(0)
    const cropped = seatPlan.zonePlanOf(withTv, 'B')!
    const tv = cropped.fixtures[0]!
    const b1 = cropped.seats[0]!
    expect(tv.x + tv.w).toBeLessThanOrEqual(cropped.width)
    expect(tv.y + tv.h).toBeLessThanOrEqual(cropped.height)
    expect({ dx: tv.x - b1.x, dy: tv.y - b1.y }).toEqual({ dx: 954 - 520, dy: 100 - 20 })
  })

  it('returns null for a missing zone', () => {
    const noB = { ...plan, zones: plan.zones.filter((z) => z.id === 'A') }
    expect(seatPlan.zonePlanOf(noB, 'B')).toBeNull()
  })
})
