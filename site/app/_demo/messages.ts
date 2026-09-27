import { seatPlan, type LintIssue, type SeatPlan, type SelectionIssue } from 'ichno'
import type { SeatPlanIssue } from 'ichno/schema'

// ichno reports codes; every sentence the visitor reads is written here.

// A place, object or group as people would name it — "Row A, seat 3", "Table T2, seat 1", a desk's label. Rows and
// tables are this site's roles; ichno only knows groups.
export function describe(plan: SeatPlan<string>, id: string): string {
  const group = seatPlan.groupById(plan, id)
  if (group) return groupName(group)
  const object = seatPlan.objectById(plan, id)
  if (!object) return id
  const owner = object.group === undefined ? undefined : seatPlan.groupById(plan, object.group)
  if (object.kind !== 'place') {
    const what = object.kind === 'fixture' ? (object.role ?? 'fixture') : 'label'
    return owner ? `${groupName(owner)}, ${what}` : what === 'fixture' ? id : what
  }
  const label = object.label ?? object.id
  if (owner?.role === 'row' || owner?.role === 'table') return `${groupName(owner)}, seat ${label}`
  return label
}

function groupName(group: { id: string; label?: string; role?: string }): string {
  const name = group.label ?? group.id
  if (group.role === 'row') return `Row ${name}`
  if (group.role === 'table') return `Table ${name}`
  return name
}

export function selectionIssueText(plan: SeatPlan<string>, issue: SelectionIssue): string {
  switch (issue.code) {
    case 'too_many':
      return `Pick at most ${issue.max} places at once.`
    case 'too_few':
      return `Pick at least ${issue.min} places.`
    case 'not_consecutive':
      return 'Pick seats side by side in one row or at one table.'
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
    case 'unknown_group':
      return `${describe(plan, issue.id)} belongs to group “${issue.group}”, which the plan does not list.`
    case 'out_of_bounds':
      return `${describe(plan, issue.id)} reaches outside the plan.`
    case 'overlap':
      return `${describe(plan, issue.ids[0])} overlaps ${describe(plan, issue.ids[1])}.`
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
