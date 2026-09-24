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

// Every enabled rule's findings, in rule order. `severity` overrides the defaults per code.
export function lintSeatPlan(
  plan: SeatPlan<string>,
  severity: Partial<Record<LintCode, LintSeverity>> = {},
): LintResult[] {
  const levels = { ...DEFAULT_LINT_SEVERITY, ...severity }
  const places = seatPlan.placesOf(plan)
  const issues: LintIssue[] = []

  if (levels.duplicate_label !== 'off') {
    const byLabel = new Map<string, string[]>()
    for (const place of places) byLabel.set(place.label, [...(byLabel.get(place.label) ?? []), place.id])
    for (const [label, ids] of byLabel) if (ids.length > 1) issues.push({ code: 'duplicate_label', label, ids })
  }

  if (levels.outside_section !== 'off') {
    for (const place of places) {
      const section = seatPlan.sectionOf(plan, place.section)
      if (section && !polygonContains(section.points, place.center)) {
        issues.push({ code: 'outside_section', id: place.id, section: place.section })
      }
    }
  }

  if (levels.missing_category !== 'off' && plan.categories.length > 0) {
    for (const place of places)
      if (place.category === undefined) issues.push({ code: 'missing_category', id: place.id })
  }

  if (levels.empty_section !== 'off') {
    const used = new Set(places.map((place) => place.section))
    for (const section of plan.sections) {
      if (!used.has(section.id)) issues.push({ code: 'empty_section', section: section.id })
    }
  }

  return issues.map((issue) => ({ ...issue, severity: levels[issue.code] as Exclude<LintSeverity, 'off'> }))
}
