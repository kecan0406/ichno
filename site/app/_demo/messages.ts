import { seatPlan, type LintIssue, type SeatPlan, type SelectionIssue } from 'ichno'
import type { SeatPlanIssue } from 'ichno/schema'

// ichno reports codes; every sentence the visitor reads is written here.

// A place or object as people would name it — "Row A, seat 3", "Table T2, seat 1", a desk's label.
export function describe(plan: SeatPlan<string>, id: string): string {
  const place = seatPlan.placesOf(plan).find((candidate) => candidate.id === id)
  if (!place) {
    const object = seatPlan.objectById(plan, id)
    if (object?.kind === 'row') return `Row ${object.label ?? object.id}`
    return id
  }
  if (place.kind === 'row-seat' && place.parent) {
    const row = seatPlan.objectById(plan, place.parent.id)
    return `Row ${(row?.kind === 'row' && row.label) || place.parent.id}, seat ${place.label}`
  }
  if (place.kind === 'table-seat' && place.parent) return `Table ${place.parent.id}, seat ${place.label}`
  return place.label
}

export function selectionIssueText(plan: SeatPlan<string>, issue: SelectionIssue): string {
  switch (issue.code) {
    case 'too_many':
      return `Pick at most ${issue.max} places at once.`
    case 'too_few':
      return `Pick at least ${issue.min} places.`
    case 'not_consecutive':
      return 'Pick seats side by side in one row.'
    case 'orphan_seat':
      return `${describe(plan, issue.id)} would be left on its own.`
  }
}

export function planIssueText(plan: SeatPlan<string>, issue: SeatPlanIssue): string {
  switch (issue.code) {
    case 'duplicate_section':
      return `Section ${issue.sectionId} is listed twice.`
    case 'duplicate_category':
      return `Category “${issue.key}” is listed twice.`
    case 'duplicate_id':
      return `Id ${issue.id} is used more than once.`
    case 'unknown_category':
      return `${describe(plan, issue.id)} uses category “${issue.category}”, which the plan does not list.`
    case 'out_of_bounds':
      return `${describe(plan, issue.id)} reaches outside the plan.`
    case 'overlap':
      return `${describe(plan, issue.ids[0])} overlaps ${describe(plan, issue.ids[1])}.`
    case 'fixture_overlap':
      return `The ${issue.role} covers ${describe(plan, issue.id)}.`
  }
}

export function lintIssueText(plan: SeatPlan<string>, issue: LintIssue): string {
  switch (issue.code) {
    case 'duplicate_label':
      return `${issue.ids.length} places read “${issue.label}”.`
    case 'outside_section':
      return `${describe(plan, issue.id)} sits outside its section.`
    case 'missing_category':
      return `${describe(plan, issue.id)} has no category.`
    case 'empty_section':
      return `Section ${issue.section} has no places.`
  }
}

export function selectionIssueKey(issue: SelectionIssue): string {
  return issue.code === 'orphan_seat' ? `orphan-${issue.id}` : issue.code
}
