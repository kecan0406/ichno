import {
  issueIdsOf,
  lintSeatPlan,
  upgradeSeatPlan,
  type LintCode,
  type LintSeverity,
  type SeatPlan,
  type SeatPlanV1,
  type SeatPlanV2,
} from 'ichno'
import { createSeatPlanSchema, seatPlanIssueOf } from 'ichno/schema'
import { blankPlan, roomPlan, venuePlan, venueSectionNames } from '../../_demo/plans'
import { lintIssueText, planIssueText } from '../../_demo/messages'

// What the playground edits: a document with a name to show for it, the names it shows for its sections, and the
// places marked booked.
export type Workbench = {
  name: string
  plan: SeatPlan<string>
  sectionNames: Record<string, string>
  booked: string[]
}

export const PRESETS: { id: string; name: string; workbench: Workbench }[] = [
  {
    id: 'venue',
    name: 'Venue',
    workbench: {
      name: 'Venue',
      plan: venuePlan,
      sectionNames: venueSectionNames,
      booked: ['A5', 'A6', 'D9', 'D10', 'S3', 'T2-1'],
    },
  },
  {
    id: 'room',
    name: 'Room',
    workbench: { name: 'Room', plan: roomPlan, sectionNames: { R: 'Room' }, booked: ['R5'] },
  },
  {
    id: 'blank',
    name: 'Blank floor',
    workbench: { name: 'Blank floor', plan: blankPlan, sectionNames: { A: 'Floor' }, booked: [] },
  },
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
          ? { key: `schema-${i}`, severity: 'error', text: planIssueText(plan, planIssue), ids: issueIdsOf(planIssue) }
          : { key: `schema-${i}`, severity: 'error', text: `${issue.path.join('.')}: ${issue.message}`, ids: [] },
      )
    })
  }
  lintSeatPlan(plan, lint).forEach((issue, i) => {
    checks.push({
      key: `lint-${i}`,
      severity: issue.severity,
      text: lintIssueText(plan, issue),
      ids: issueIdsOf(issue),
    })
  })
  return checks
}

// Parses pasted or stored JSON with a schema built from the document's own section ids (the playground has no
// fixed composition). Documents from ichno 0.1 (rooms under `zones`) and 0.2 are upgraded by the schema.
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
    return {
      plan: record.version === 3 ? (input as SeatPlan<string>) : upgradeSeatPlan(input as SeatPlanV1 | SeatPlanV2),
    }
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
      name: typeof stored.name === 'string' && stored.name !== '' ? stored.name : 'Seat plan',
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

// The document as your app would store it.
export function jsonOf(plan: SeatPlan<string>): string {
  return JSON.stringify(plan, null, 2)
}

// Copies the document; false when the browser blocks the clipboard.
export async function copyDocument(plan: SeatPlan<string>): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(jsonOf(plan))
    return true
  } catch {
    return false
  }
}

export function downloadDocument(plan: SeatPlan<string>, name: string) {
  const url = URL.createObjectURL(new Blob([jsonOf(plan)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') || 'seat-plan'
  }.json`
  link.click()
  URL.revokeObjectURL(url)
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
