import { z } from 'zod'
import { MIN_SEAT_SIZE, seatPlan } from '../core/geometry'
import { HALF_CELL, seatGrid } from '../core/grid'
import { AREA_SHAPES, SEAT_CHAIR_SIDES, TABLE_SHAPES, type PlanRect } from '../core/types'
import { upgradeSeatPlan } from '../core/v1'

// Document validation — a separate entry so zod stays out of bundles that only draw.
// It refuses what would corrupt a stored document (broken references, ids that collide, geometry that cannot be
// drawn). Softer problems — duplicate labels, places outside their section — are `lintSeatPlan` warnings.

export type SeatPlanIssue =
  | { code: 'duplicate_section'; sectionId: string }
  | { code: 'duplicate_category'; key: string }
  | { code: 'duplicate_id'; id: string }
  | { code: 'unknown_category'; id: string; category: string }
  | { code: 'out_of_bounds'; id: string }
  | { code: 'overlap'; ids: [string, string] }
  | { code: 'fixture_overlap'; fixtureId: string; role: string; id: string }

// Plan-level rule violations carry this prefix as their message and the structured issue in `params`.
// The library ships no copy — turn issues into text with `seatPlanIssueOf`. Field-level failures (types,
// minimum sizes) are ordinary zod issues and follow your zod error map.
const ISSUE_PREFIX = 'ichno/'

// Booking keys other records reference — the v1 seat id limit, kept for every place.
const PLACE_ID_MAX = 8
const OBJECT_ID_MAX = 16
const LABEL_MAX = 32

// Build the schemas for your section composition. Section ids are fixed per app: the plan holds each of these
// at most once, and every place belongs to one of them.
// Documents saved by ichno 0.1 (no `version`, rooms under `zones`) are upgraded while parsing: a broken v1
// structure is reported on v1 paths, anything else on the upgraded document's paths.
export function createSeatPlanSchema<const S extends readonly [string, ...string[]]>(options: { sectionIds: S }) {
  const SectionId = z.enum(options.sectionIds)

  const Point = z.object({ x: z.int(), y: z.int() })
  // Integer rectangle in plan units — renderers fit-scale it to their container.
  const Box = z.object({ x: z.int(), y: z.int(), w: z.int().positive(), h: z.int().positive() })

  const PlaceId = z.string().trim().min(1).max(PLACE_ID_MAX)
  const ObjectId = z.string().trim().min(1).max(OBJECT_ID_MAX)
  const Bookable = {
    id: PlaceId,
    label: z.string().trim().min(1).max(LABEL_MAX).optional(),
    category: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
  }
  const Seat = z.object(Bookable)

  const Section = z.object({ id: SectionId, points: z.array(Point).min(3) })
  const Category = z.object({ key: z.string().trim().min(1).max(OBJECT_ID_MAX), accessible: z.boolean().optional() })

  const Desk = z.object({
    kind: z.literal('desk'),
    ...Bookable,
    section: SectionId,
    x: z.int(),
    y: z.int(),
    w: z.int().min(MIN_SEAT_SIZE),
    h: z.int().min(MIN_SEAT_SIZE),
    chairSide: z.enum(SEAT_CHAIR_SIDES),
  })
  const Row = z.object({
    kind: z.literal('row'),
    id: ObjectId,
    section: SectionId,
    label: Bookable.label,
    start: Point,
    end: Point,
    curve: z.number().min(-1).max(1),
    seatSize: z.int().positive(),
    seats: z.array(Seat).min(1),
  })
  const Table = Box.extend({
    kind: z.literal('table'),
    ...Bookable,
    section: SectionId,
    shape: z.enum(TABLE_SHAPES),
    seatSize: z.int().positive(),
    seats: z.array(Seat).min(1),
    wholeBooking: z.boolean().optional(),
  })
  const Booth = Box.extend({ kind: z.literal('booth'), ...Bookable, section: SectionId })
  const Area = Box.extend({
    kind: z.literal('area'),
    ...Bookable,
    section: SectionId,
    shape: z.enum(AREA_SHAPES),
    capacity: z.int().positive(),
    wholeBooking: z.boolean().optional(),
  })
  const Fixture = z.object({
    kind: z.literal('fixture'),
    id: ObjectId,
    role: z.string().trim().min(1).max(OBJECT_ID_MAX),
    x: z.int(),
    y: z.int(),
    w: z.int().min(HALF_CELL),
    h: z.int().min(HALF_CELL),
  })
  const PlanObject = z.discriminatedUnion('kind', [Desk, Row, Table, Booth, Area, Fixture])

  const Document = z
    .object({
      version: z.literal(2),
      width: z.int().positive(),
      height: z.int().positive(),
      sections: z.array(Section),
      categories: z.array(Category).default([]),
      objects: z.array(PlanObject),
    })
    .superRefine((plan, ctx) => {
      const report = (path: (string | number)[], issue: SeatPlanIssue) =>
        ctx.addIssue({ code: 'custom', path, message: `${ISSUE_PREFIX}${issue.code}`, params: issue })

      const sectionIds = new Set<string>()
      for (const [i, section] of plan.sections.entries()) {
        if (sectionIds.has(section.id))
          report(['sections', i, 'id'], { code: 'duplicate_section', sectionId: section.id })
        sectionIds.add(section.id)
      }

      const categoryKeys = new Set<string>()
      for (const [i, category] of plan.categories.entries()) {
        if (categoryKeys.has(category.key))
          report(['categories', i, 'key'], { code: 'duplicate_category', key: category.key })
        categoryKeys.add(category.key)
      }

      const ids = new Set<string>()
      const claim = (path: (string | number)[], id: string) => {
        if (ids.has(id)) report(path, { code: 'duplicate_id', id })
        ids.add(id)
      }
      const checkCategory = (path: (string | number)[], id: string, category: string | undefined) => {
        if (category !== undefined && !categoryKeys.has(category))
          report(path, { code: 'unknown_category', id, category })
      }

      for (const [i, object] of plan.objects.entries()) {
        const path = ['objects', i]
        claim([...path, 'id'], object.id)
        if (object.kind !== 'row' && object.kind !== 'fixture') checkCategory(path, object.id, object.category)
        if (object.kind === 'row' || object.kind === 'table') {
          for (const [j, seat] of object.seats.entries()) {
            claim([...path, 'seats', j, 'id'], seat.id)
            checkCategory([...path, 'seats', j], seat.id, seat.category)
          }
        }
        if (!inside(seatPlan.boundsOf(object), plan)) report(path, { code: 'out_of_bounds', id: object.id })
      }

      // Footprints may touch but not overlap — the same definition editor placement uses (seatGrid.rectsOverlap).
      const claimed = plan.objects.flatMap((object, i) => (object.kind === 'fixture' ? [] : [{ object, i }]))
      for (const [j, b] of claimed.entries()) {
        for (const a of claimed.slice(0, j)) {
          if (seatGrid.rectsOverlap(seatPlan.footprintOf(a.object), seatPlan.footprintOf(b.object)))
            report(['objects', b.i], { code: 'overlap', ids: [a.object.id, b.object.id] })
        }
      }
      // A fixture on a place is a placement mistake; fixtures may overlap each other (a TV hung on a wall).
      for (const [i, fixture] of plan.objects.entries()) {
        if (fixture.kind !== 'fixture') continue
        const hit = claimed.find(({ object }) => seatGrid.rectsOverlap(seatPlan.footprintOf(object), fixture))
        if (hit)
          report(['objects', i], {
            code: 'fixture_overlap',
            fixtureId: fixture.id,
            role: fixture.role,
            id: hit.object.id,
          })
      }
    })

  // The 0.1 document — rooms and desk seats. Missing chair sides and fixtures are the defaults 0.1 applied.
  const DocumentV1 = z.object({
    width: z.unknown(),
    height: z.unknown(),
    zones: z.array(Box.extend({ id: SectionId })),
    seats: z.array(
      z.object({
        id: z.unknown(),
        zone: SectionId,
        x: z.unknown(),
        y: z.unknown(),
        w: z.unknown(),
        h: z.unknown(),
        chairSide: z.enum(SEAT_CHAIR_SIDES).default('down'),
      }),
    ),
    fixtures: z
      .array(
        z.object({
          id: z.unknown(),
          kind: z.enum(['wall', 'tv', 'counter']),
          x: z.unknown(),
          y: z.unknown(),
          w: z.unknown(),
          h: z.unknown(),
        }),
      )
      .default([]),
  })

  const SeatPlan = z.preprocess((input, ctx) => {
    if (typeof input !== 'object' || input === null || 'version' in input) return input
    const v1 = DocumentV1.safeParse(input)
    if (!v1.success) {
      for (const issue of v1.error.issues) ctx.addIssue({ ...issue, input: undefined })
      return z.NEVER
    }
    // Field types are checked by the v2 schema after the upgrade; the upgrade only reshapes.
    return upgradeSeatPlan(v1.data as Parameters<typeof upgradeSeatPlan>[0])
  }, Document)

  return { SeatPlan, Section, Category, PlanObject, Desk, Row, Table, Booth, Area, Fixture }
}

// The structured issue behind a plan-level violation, or null for any other zod issue.
export function seatPlanIssueOf(issue: z.core.$ZodIssue): SeatPlanIssue | null {
  if (issue.code !== 'custom' || !issue.message.startsWith(ISSUE_PREFIX)) return null
  return (issue.params as SeatPlanIssue | undefined) ?? null
}

function inside(rect: PlanRect, plan: { width: number; height: number }) {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= plan.width && rect.y + rect.h <= plan.height
}
