import {
  lintSeatPlan,
  seatPlan,
  upgradeSeatPlan,
  type LintCode,
  type LintSeverity,
  type PlanRect,
  type SeatPlan,
  type SeatPlanV1,
} from 'ichno'
import { createSeatPlanSchema, seatPlanIssueOf, type SeatPlanIssue } from 'ichno/schema'
import { blankPlan, roomPlan, venuePlan, venueSectionNames } from '../../_demo/plans'
import { lintIssueText, planIssueText } from '../../_demo/messages'

// What the playground edits: a document, the names it shows for its sections, and the places marked booked.
export type Workbench = { plan: SeatPlan<string>; sectionNames: Record<string, string>; booked: string[] }

export const PRESETS: { id: string; name: string; workbench: Workbench }[] = [
  {
    id: 'venue',
    name: 'Venue',
    workbench: { plan: venuePlan, sectionNames: venueSectionNames, booked: ['A5', 'A6', 'D9', 'D10', 'S3', 'T2-1'] },
  },
  { id: 'room', name: 'Room', workbench: { plan: roomPlan, sectionNames: { R: 'Room' }, booked: ['R5'] } },
  { id: 'blank', name: 'Blank floor', workbench: { plan: blankPlan, sectionNames: { A: 'Floor' }, booked: [] } },
]

export const DEFAULT_LINT: Record<LintCode, LintSeverity> = {
  // Row numbers repeat from row to row in most venues — off until asked for.
  duplicate_label: 'off',
  outside_section: 'warning',
  missing_category: 'warning',
  empty_section: 'warning',
}

export type Check = { key: string; severity: 'error' | 'warning'; text: string; ids: string[] }

// Everything the schema would refuse (errors) and the lint rules flag (at the chosen severities).
export function checksOf(plan: SeatPlan<string>, lint: Record<LintCode, LintSeverity>): Check[] {
  const checks: Check[] = []
  const schema = schemaFor(plan)
  const parsed = schema?.safeParse(plan)
  if (parsed && !parsed.success) {
    parsed.error.issues.forEach((issue, i) => {
      const planIssue = seatPlanIssueOf(issue)
      checks.push(
        planIssue
          ? { key: `schema-${i}`, severity: 'error', text: planIssueText(plan, planIssue), ids: idsOf(planIssue) }
          : { key: `schema-${i}`, severity: 'error', text: `${issue.path.join('.')}: ${issue.message}`, ids: [] },
      )
    })
  }
  lintSeatPlan(plan, lint).forEach((issue, i) => {
    checks.push({
      key: `lint-${i}`,
      severity: issue.severity,
      text: lintIssueText(plan, issue),
      ids: 'ids' in issue ? issue.ids : 'id' in issue ? [issue.id] : [],
    })
  })
  return checks
}

// The objects a set of ids belongs to — a seat id resolves to its row or table.
export function objectIdsOf(plan: SeatPlan<string>, ids: readonly string[]): string[] {
  const places = seatPlan.placesOf(plan)
  return [
    ...new Set(
      ids.flatMap((id) => {
        if (seatPlan.objectById(plan, id)) return [id]
        const place = places.find((candidate) => candidate.id === id)
        return place ? [place.parent?.id ?? place.id] : []
      }),
    ),
  ]
}

export function boundsOfIds(plan: SeatPlan<string>, ids: readonly string[]): PlanRect[] {
  return objectIdsOf(plan, ids).flatMap((id) => {
    const object = seatPlan.objectById(plan, id)
    return object ? [seatPlan.boundsOf(object)] : []
  })
}

// Parses pasted or stored JSON with a schema built from the document's own section ids (the playground has no
// fixed composition). Documents from ichno 0.1 keep their rooms under `zones`; the schema upgrades them.
// A document whose only problems are plan rules (overlaps, unknown categories, …) still opens — the playground is
// where you fix those, and the Checks panel lists them. A broken structure does not.
export function parseDocument(text: string): { plan: SeatPlan<string> } | { errors: string[] } {
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    return { errors: ['This is not valid JSON.'] }
  }
  const ids = sectionIdsIn(input)
  const [first, ...rest] = ids
  if (first === undefined) return { errors: ['The document lists no sections.'] }
  const result = createSeatPlanSchema({ sectionIds: [first, ...rest] }).SeatPlan.safeParse(input)
  if (result.success) return { plan: result.data as SeatPlan<string> }
  if (result.error.issues.every((issue) => seatPlanIssueOf(issue) !== null)) {
    const record = input as { version?: unknown }
    return { plan: record.version === 2 ? (input as SeatPlan<string>) : upgradeSeatPlan(input as SeatPlanV1) }
  }
  const plan = input as SeatPlan<string>
  return {
    errors: result.error.issues.map((issue) => {
      const planIssue = seatPlanIssueOf(issue)
      return planIssue ? planIssueText(plan, planIssue) : `${issue.path.join('.') || 'document'}: ${issue.message}`
    }),
  }
}

const STORAGE_KEY = 'ichno-playground'

// The last workbench, kept in this browser only. Anything unreadable is ignored.
export function loadWorkbench(): Workbench | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as Partial<Workbench>
    const parsed = parseDocument(JSON.stringify(stored.plan))
    if (!('plan' in parsed)) return null
    return {
      plan: parsed.plan,
      sectionNames: stored.sectionNames ?? {},
      booked: Array.isArray(stored.booked) ? stored.booked.filter((id) => typeof id === 'string') : [],
    }
  } catch {
    return null
  }
}

export function saveWorkbench(workbench: Workbench) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workbench))
  } catch {
    // Storage full or blocked — the playground still works, it just forgets on reload.
  }
}

function schemaFor(plan: SeatPlan<string>) {
  const [first, ...rest] = plan.sections.map((section) => section.id)
  return first === undefined ? null : createSeatPlanSchema({ sectionIds: [first, ...rest] }).SeatPlan
}

function sectionIdsIn(input: unknown): string[] {
  if (typeof input !== 'object' || input === null) return []
  const record = input as { sections?: unknown; zones?: unknown }
  const list = Array.isArray(record.sections) ? record.sections : Array.isArray(record.zones) ? record.zones : []
  return [
    ...new Set(
      list.flatMap((item: unknown) =>
        typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string'
          ? [(item as { id: string }).id]
          : [],
      ),
    ),
  ]
}

function idsOf(issue: SeatPlanIssue): string[] {
  switch (issue.code) {
    case 'overlap':
      return [...issue.ids]
    case 'fixture_overlap':
      return [issue.fixtureId, issue.id]
    case 'duplicate_id':
    case 'unknown_category':
    case 'out_of_bounds':
      return [issue.id]
    default:
      return []
  }
}
