import { seatPlan } from './geometry'
import { polygonContains } from './math'
import type { SeatPlan } from './types'

// Soft document rules — things worth a warning in an editor but not worth refusing a save over (the schema
// refuses what would corrupt a document; see `ichno/schema`). Like Seats.io's chart validators, each rule has a
// severity the consumer can raise, lower or switch off. Issues are codes, never text.

export type LintSeverity = 'error' | 'warning' | 'off'

export type LintIssue =
  // Two places read the same — people cannot tell them apart (ids are unique, labels need not be).
  | { code: 'duplicate_label'; label: string; ids: string[] }
  // A place whose centre lies outside the outline of the section it belongs to.
  | { code: 'outside_section'; id: string; section: string }
  // A place without a category in a plan that uses categories.
  | { code: 'missing_category'; id: string }
  // A section with no places.
  | { code: 'empty_section'; section: string }

export type LintCode = LintIssue['code']

export type LintResult = LintIssue & { severity: Exclude<LintSeverity, 'off'> }

export const DEFAULT_LINT_SEVERITY: Record<LintCode, LintSeverity> = {
  duplicate_label: 'warning',
  outside_section: 'warning',
  missing_category: 'warning',
  empty_section: 'off',
}

// The objects an issue is about — what to select and zoom to. Schema issues (ichno/schema) and lint results name
// them the same way, in `ids` or `id`; issues about a section or a category name none.
export function issueIdsOf(issue: { code: string }): string[] {
  if ('ids' in issue && Array.isArray(issue.ids)) return issue.ids.filter(isId)

  if ('id' in issue && isId(issue.id)) return [issue.id]

  return []
}

// Issues arrive as any `{ code }` (schema issues, lint results, the consumer's own), so ids are checked to be strings.
function isId(value: unknown): value is string {
  return typeof value === 'string'
}

// Every enabled rule's findings, in rule order. `severity` overrides the defaults per code.
export function lintSeatPlan(
  plan: SeatPlan<string>,
  severity: Partial<Record<LintCode, LintSeverity>> = {},
): LintResult[] {
  const levels = { ...DEFAULT_LINT_SEVERITY, ...severity }
  const places = seatPlan.placesOf(plan)
  const results: LintResult[] = []

  if (levels.duplicate_label !== 'off') {
    const byLabel = new Map<string, string[]>()

    for (const place of places) {
      const label = place.label ?? place.id
      byLabel.set(label, [...(byLabel.get(label) ?? []), place.id])
    }

    for (const [label, ids] of byLabel)
      if (ids.length > 1) results.push({ code: 'duplicate_label', label, ids, severity: levels.duplicate_label })
  }

  if (levels.outside_section !== 'off') {
    for (const place of places) {
      const section = seatPlan.sectionOf(plan, place.section)

      if (section && !polygonContains(section.points, seatPlan.centerOf(place))) {
        results.push({
          code: 'outside_section',
          id: place.id,
          section: place.section,
          severity: levels.outside_section,
        })
      }
    }
  }

  if (levels.missing_category !== 'off' && plan.categories.length > 0) {
    for (const place of places)
      if (place.category === undefined)
        results.push({ code: 'missing_category', id: place.id, severity: levels.missing_category })
  }

  if (levels.empty_section !== 'off') {
    const used = new Set(places.map((place) => place.section))

    for (const section of plan.sections) {
      if (!used.has(section.id))
        results.push({ code: 'empty_section', section: section.id, severity: levels.empty_section })
    }
  }

  return results
}
