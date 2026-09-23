import { z } from 'zod'
import { MIN_SEAT_SIZE } from '../core/geometry'
import { HALF_CELL, seatGrid } from '../core/grid'
import { FIXTURE_KINDS, SEAT_CHAIR_SIDES } from '../core/types'

// Document validation — a separate entry so zod stays out of bundles that only draw.

export type SeatPlanIssue =
  | { code: 'duplicate_zone'; zoneId: string }
  | { code: 'duplicate_seat_id'; seatId: string }
  | { code: 'seat_out_of_bounds'; seatId: string }
  | { code: 'seat_overlap'; seatIds: [string, string] }
  | { code: 'duplicate_fixture_id'; fixtureId: string }
  | { code: 'fixture_out_of_bounds'; fixtureId: string; kind: (typeof FIXTURE_KINDS)[number] }
  | { code: 'fixture_seat_overlap'; fixtureId: string; kind: (typeof FIXTURE_KINDS)[number]; seatId: string }

// Plan-level rule violations carry this prefix as their message and the structured issue in `params`.
// The library ships no copy — turn issues into text with `seatPlanIssueOf`. Field-level failures (types,
// minimum sizes) are ordinary zod issues and follow your zod error map.
const ISSUE_PREFIX = 'ichno/'

// Build the schemas for your zone composition. Zone ids are fixed per app: the plan must hold exactly these
// kinds of zones (each at most once), and every seat belongs to one of them.
export function createSeatPlanSchema<const Z extends readonly [string, ...string[]]>(options: { zoneIds: Z }) {
  const ZoneId = z.enum(options.zoneIds)

  // Integer rectangle in plan units — renderers fit-scale it to their container.
  const Box = z.object({
    x: z.int(),
    y: z.int(),
    w: z.int().positive(),
    h: z.int().positive(),
  })

  const Zone = Box.extend({ id: ZoneId })

  const Seat = z.object({
    // Referenced by other records and drawn as the label — editable, unique within the document.
    id: z.string().trim().min(1).max(8),
    zone: ZoneId,
    x: z.int(),
    y: z.int(),
    w: z.int().min(MIN_SEAT_SIZE),
    h: z.int().min(MIN_SEAT_SIZE),
    // Documents saved before chair sides existed have no key — read them as chairs below the desk.
    chairSide: z.enum(SEAT_CHAIR_SIDES).default('down'),
  })

  const Fixture = z.object({
    id: z.string().trim().min(1).max(16),
    kind: z.enum(FIXTURE_KINDS),
    x: z.int(),
    y: z.int(),
    w: z.int().min(HALF_CELL),
    h: z.int().min(HALF_CELL),
  })

  const SeatPlan = z
    .object({
      width: z.int().positive(),
      height: z.int().positive(),
      zones: z.array(Zone),
      seats: z.array(Seat),
      // Documents saved before fixtures existed have no key — read them as a plan without fixtures.
      fixtures: z.array(Fixture).default([]),
    })
    .superRefine((plan, ctx) => {
      const report = (path: (string | number)[], issue: SeatPlanIssue) =>
        ctx.addIssue({ code: 'custom', path, message: `${ISSUE_PREFIX}${issue.code}`, params: issue })

      const zoneIds = new Set<string>()
      for (const [i, zone] of plan.zones.entries()) {
        if (zoneIds.has(zone.id)) report(['zones', i, 'id'], { code: 'duplicate_zone', zoneId: zone.id })
        zoneIds.add(zone.id)
      }

      const seatIds = new Set<string>()
      for (const [i, seat] of plan.seats.entries()) {
        if (seatIds.has(seat.id)) report(['seats', i, 'id'], { code: 'duplicate_seat_id', seatId: seat.id })
        seatIds.add(seat.id)
        if (!inside(seat, plan)) report(['seats', i], { code: 'seat_out_of_bounds', seatId: seat.id })
      }
      for (const [j, b] of plan.seats.entries()) {
        for (const a of plan.seats.slice(0, j)) {
          // Same overlap definition as editor placement (seatGrid.placeSeat) — placement and rejection agree.
          if (seatGrid.rectsOverlap(a, b)) report(['seats', j], { code: 'seat_overlap', seatIds: [a.id, b.id] })
        }
      }

      const fixtureIds = new Set<string>()
      for (const [i, fixture] of plan.fixtures.entries()) {
        const ref = { fixtureId: fixture.id, kind: fixture.kind }
        if (fixtureIds.has(fixture.id))
          report(['fixtures', i, 'id'], { code: 'duplicate_fixture_id', fixtureId: fixture.id })
        fixtureIds.add(fixture.id)
        if (!inside(fixture, plan)) report(['fixtures', i], { code: 'fixture_out_of_bounds', ...ref })
        // Only seat overlap is rejected — a wall or TV on a seat is a placement mistake, while fixtures may
        // overlap each other (a TV hung on a wall).
        const seat = plan.seats.find((s) => seatGrid.rectsOverlap(s, fixture))
        if (seat) report(['fixtures', i], { code: 'fixture_seat_overlap', ...ref, seatId: seat.id })
      }
    })

  return { SeatPlan, Seat, Zone, Fixture }
}

// The structured issue behind a plan-level violation, or null for any other zod issue.
export function seatPlanIssueOf(issue: z.core.$ZodIssue): SeatPlanIssue | null {
  if (issue.code !== 'custom' || !issue.message.startsWith(ISSUE_PREFIX)) return null
  return (issue.params as SeatPlanIssue | undefined) ?? null
}

function inside(rect: { x: number; y: number; w: number; h: number }, plan: { width: number; height: number }) {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= plan.width && rect.y + rect.h <= plan.height
}
