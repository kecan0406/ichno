import { issueIdsOf, lintSeatPlan, type LintCode, type LintSeverity, type SeatPlan } from 'ichno'
import { createSeatPlanSchema, seatPlanIssueOf } from 'ichno/schema'
import { z } from 'zod'
import { emptyPlan, hallPlan } from '../../_demo/plans'
import { lintIssueText, planIssueText } from '../../_demo/messages'

// What the playground edits: a document with a name to show for it, and the places marked booked.
export type Workbench = {
  name: string
  plan: SeatPlan<string>
  booked: string[]
}

export const PRESETS: { id: string; name: string; workbench: Workbench }[] = [
  {
    id: 'hall',
    name: 'Hall',
    workbench: { name: 'Hall', plan: hallPlan, booked: ['A5', 'A6'] },
  },
  {
    id: 'empty',
    name: 'Empty',
    workbench: { name: 'Empty', plan: emptyPlan, booked: [] },
  },
]

export const DEFAULT_LINT: Record<LintCode, LintSeverity> = {
  // Row numbers repeat from row to row in most venues — off until asked for.
  duplicate_label: 'off',
  outside_section: 'warning',
  missing_category: 'warning',
  // The playground's section is the whole plan, there before anything is placed.
  empty_section: 'off',
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

// Just enough of a document to name its sections — the ids under `sections`, or `zones` before ichno 0.2. An entry
// without a string id is left out here; the schema reports it.
const Named = z.object({ id: z.string() }).nullable().catch(null)

const SectionNames = z
  .union([
    z.object({ sections: z.array(Named) }).transform((document) => document.sections),
    z.object({ zones: z.array(Named) }).transform((document) => document.zones),
  ])
  .catch([])

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

  const ids = [...new Set(SectionNames.parse(input).flatMap((section) => (section === null ? [] : [section.id])))]
  const [first, ...rest] = ids

  if (first === undefined) return { errors: ['The document lists no sections.'] }
  const { SeatPlan } = createSeatPlanSchema({ sectionIds: [first, ...rest] })
  // The schema without its plan rules: the upgrade from 0.1 and 0.2, then the document's fields.
  const structure = z.pipe(SeatPlan.in, z.object(SeatPlan.out.shape)).safeParse(input)

  if (structure.success) return { plan: structure.data }

  return { errors: structure.error.issues.map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`) }
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
