import { z } from 'zod'
import { OBJECT_ID_MAX, PLACE_ID_MAX, seatPlan } from '../core/geometry'
import { upgradeV1, upgradeV2, type SeatPlanV2 } from '../core/legacy'
import { SHAPES, type PlanRect } from '../core/types'

// Document validation — a separate entry so zod stays out of bundles that only draw.
// It refuses what would corrupt a stored document (broken references, ids that collide, geometry that cannot be
// drawn). Softer problems — duplicate labels, places outside their section — are `lintSeatPlan` warnings.

export type SeatPlanIssue =
  | { code: 'duplicate_section'; sectionId: string }
  | { code: 'duplicate_category'; key: string }
  | { code: 'duplicate_id'; id: string }
  | { code: 'unknown_category'; id: string; category: string }
  | { code: 'unknown_group'; id: string; group: string }
  | { code: 'out_of_bounds'; id: string }
  | { code: 'overlap'; ids: [string, string] }

// Plan-level rule violations carry this prefix as their message and the structured issue in `params`.
// The library ships no copy — turn issues into text with `seatPlanIssueOf`. Field-level failures (types,
// minimum sizes) are ordinary zod issues and follow your zod error map.
const ISSUE_PREFIX = 'ichno/'

const LABEL_MAX = 32

// Build the schemas for your section composition. Section ids are fixed per app: the plan holds each of these
// at most once, and every place belongs to one of them.
// Documents saved by earlier versions are upgraded while parsing — ichno 0.1 (no `version`, rooms under `zones`)
// and 0.2 (`version: 2`, built-in object kinds). A broken old structure is reported on its own paths, anything
// else on the upgraded document's paths.
export function createSeatPlanSchema<const S extends readonly [string, ...string[]]>(options: { sectionIds: S }) {
  const SectionId = z.enum(options.sectionIds)

  const Point = z.object({ x: z.int(), y: z.int() })
  const Rotation = z.number().min(0).lt(360).optional()
  // Integer rectangle in plan units — renderers fit-scale it to their container. `rotation` turns it clockwise
  // about its centre, in degrees.
  const Box = z.object({
    x: z.int(),
    y: z.int(),
    w: z.int().positive(),
    h: z.int().positive(),
    rotation: Rotation,
  })

  const ObjectId = z.string().trim().min(1).max(OBJECT_ID_MAX)
  const Role = z.string().trim().min(1).max(OBJECT_ID_MAX)
  const Label = z.string().trim().min(1).max(LABEL_MAX)

  const Section = z.object({ id: SectionId, points: z.array(Point).min(3) })
  const Category = z.object({ key: z.string().trim().min(1).max(OBJECT_ID_MAX), accessible: z.boolean().optional() })
  const Group = z.object({ id: ObjectId, label: Label.optional(), role: Role.optional(), rotation: Rotation })

  const Place = Box.extend({
    kind: z.literal('place'),
    id: z.string().trim().min(1).max(PLACE_ID_MAX),
    section: SectionId,
    shape: z.enum(SHAPES),
    capacity: z.int().positive().default(1),
    label: Label.optional(),
    group: ObjectId.optional(),
    role: Role.optional(),
    category: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  const Fixture = Box.extend({
    kind: z.literal('fixture'),
    id: ObjectId,
    shape: z.enum(SHAPES),
    group: ObjectId.optional(),
    role: Role.optional(),
  })
  const GroupLabel = Box.extend({ kind: z.literal('label'), id: ObjectId, group: ObjectId })
  const PlanObject = z.discriminatedUnion('kind', [Place, Fixture, GroupLabel])

  const Document = z
    .object({
      version: z.literal(3),
      width: z.int().positive(),
      height: z.int().positive(),
      sections: z.array(Section),
      categories: z.array(Category).default([]),
      groups: z.array(Group).default([]),
      objects: z.array(PlanObject),
    })
    .superRefine((plan, ctx) => {
      const report = reporter(ctx)

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

      referenceRules(plan, report)
      for (const [i, object] of plan.objects.entries()) {
        const path = ['objects', i]
        if (object.kind === 'place' && object.category !== undefined && !categoryKeys.has(object.category))
          report([...path, 'category'], { code: 'unknown_category', id: object.id, category: object.category })
        // A group label may sit in the margin beside its row; everything else stays on the plan.
        if (object.kind !== 'label' && !inside(seatPlan.boundsOf(object), plan))
          report(path, { code: 'out_of_bounds', id: object.id })
      }

      // Places may touch but not overlap; fixtures and labels may overlap anything. The editor marks the same
      // conflicts (seatPlan.conflictsOf).
      const indexOf = new Map(plan.objects.map((object, i) => [object.id, i]))
      for (const [a, b] of seatPlan.conflictsOf(plan))
        report(['objects', indexOf.get(b)!], { code: 'overlap', ids: [a, b] })
    })

  // A saved piece of a plan (`PlanTemplate`) — places without a section, since they take the one they land in.
  // Only its references are checked; where it lands decides the rest when the editor inserts it.
  const Template = z
    .object({
      version: z.literal(3),
      groups: z.array(Group).default([]),
      objects: z.array(z.discriminatedUnion('kind', [Place.omit({ section: true }), Fixture, GroupLabel])),
    })
    .superRefine((template, ctx) => referenceRules(template, reporter(ctx)))

  // The 0.2 document — only the structure the upgrade reads; the rules run on the upgraded document.
  const Bookable = {
    id: z.string(),
    label: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }
  const Rect = { x: z.number(), y: z.number(), w: z.number(), h: z.number() }
  const PointV2 = z.object({ x: z.number(), y: z.number() })
  const ChairSide = z.enum(['up', 'right', 'down', 'left'])
  const DocumentV2 = z.object({
    version: z.literal(2),
    width: z.unknown(),
    height: z.unknown(),
    sections: z.array(z.object({ id: SectionId, points: z.array(PointV2) })),
    categories: z.array(Category).default([]),
    objects: z.array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('desk'), ...Bookable, ...Rect, section: SectionId, chairSide: ChairSide }),
        z.object({
          kind: z.literal('row'),
          id: z.string(),
          section: SectionId,
          label: z.string().optional(),
          start: PointV2,
          end: PointV2,
          curve: z.number(),
          seatSize: z.number().positive(),
          seats: z.array(z.object(Bookable)),
        }),
        z.object({
          kind: z.literal('table'),
          ...Bookable,
          ...Rect,
          section: SectionId,
          shape: z.enum(['round', 'rect']),
          seatSize: z.number().positive(),
          seats: z.array(z.object(Bookable)),
          wholeBooking: z.boolean().optional(),
        }),
        z.object({ kind: z.literal('booth'), ...Bookable, ...Rect, section: SectionId }),
        z.object({
          kind: z.literal('area'),
          ...Bookable,
          ...Rect,
          section: SectionId,
          shape: z.enum(['rect', 'ellipse']),
          capacity: z.number(),
          wholeBooking: z.boolean().optional(),
        }),
        z.object({ kind: z.literal('fixture'), id: z.string(), role: z.string(), ...Rect }),
      ]),
    ),
  })

  // The 0.1 document — rooms and desk seats. Missing chair sides and fixtures are the defaults 0.1 applied.
  const DocumentV1 = z.object({
    width: z.unknown(),
    height: z.unknown(),
    zones: z.array(z.object({ ...Rect, id: SectionId })),
    seats: z.array(
      z.object({
        id: z.unknown(),
        zone: SectionId,
        x: z.unknown(),
        y: z.unknown(),
        w: z.unknown(),
        h: z.unknown(),
        chairSide: ChairSide.default('down'),
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
    if (typeof input !== 'object' || input === null) return input
    const version = 'version' in input ? input.version : undefined
    if (version !== undefined && version !== 2) return input
    let v2: unknown = input
    if (version === undefined) {
      const v1 = DocumentV1.safeParse(input)
      if (!v1.success) {
        for (const issue of v1.error.issues) ctx.addIssue({ ...issue, input: undefined })
        return z.NEVER
      }
      v2 = upgradeV1(v1.data as Parameters<typeof upgradeV1>[0])
    }
    const parsed = DocumentV2.safeParse(v2)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, input: undefined })
      return z.NEVER
    }
    // Field types (whole numbers, id lengths) are checked by the current schema after the upgrade.
    return upgradeV2(parsed.data as SeatPlanV2)
  }, Document)

  return { SeatPlan, Template, Section, Category, Group, PlanObject, Place, Fixture, GroupLabel }
}

// The structured issue behind a plan-level violation, or null for any other zod issue.
export function seatPlanIssueOf(issue: z.core.$ZodIssue): SeatPlanIssue | null {
  if (issue.code !== 'custom' || !issue.message.startsWith(ISSUE_PREFIX)) return null
  return (issue.params as SeatPlanIssue | undefined) ?? null
}

type Report = (path: (string | number)[], issue: SeatPlanIssue) => void

function reporter(ctx: z.core.$RefinementCtx): Report {
  return (path, issue) => ctx.addIssue({ code: 'custom', path, message: `${ISSUE_PREFIX}${issue.code}`, params: issue })
}

// Ids are unique — objects and groups share one namespace — and objects point at groups that exist.
function referenceRules(
  plan: { groups: readonly { id: string }[]; objects: readonly { id: string; group?: string }[] },
  report: Report,
) {
  const ids = new Set<string>()
  const claim = (path: (string | number)[], id: string) => {
    if (ids.has(id)) report(path, { code: 'duplicate_id', id })
    ids.add(id)
  }
  for (const [i, group] of plan.groups.entries()) claim(['groups', i, 'id'], group.id)
  const groupIds = new Set(plan.groups.map((group) => group.id))
  for (const [i, object] of plan.objects.entries()) {
    claim(['objects', i, 'id'], object.id)
    if (object.group !== undefined && !groupIds.has(object.group))
      report(['objects', i, 'group'], { code: 'unknown_group', id: object.id, group: object.group })
  }
}

// Turned shapes have fractional bounds; a hair of float error at the edge is still inside.
function inside(rect: PlanRect, plan: { width: number; height: number }) {
  const eps = 1e-6
  return rect.x >= -eps && rect.y >= -eps && rect.x + rect.w <= plan.width + eps && rect.y + rect.h <= plan.height + eps
}
