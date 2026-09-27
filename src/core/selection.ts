import type { SeatPlan } from './types'

// Selection rules for pickers — the checks Seats.io runs as "selection validators", as a pure function. The
// consumer decides when to run them (on every change, or on submit) and writes the message for each code.
// Seat order comes from groups: the places of a group, in document order, form a line (a row, the seats around a
// table). A group with a single place (a desk) forms none.

export type SelectionRules = {
  min?: number
  max?: number
  // Selected places in groups must sit side by side in one group.
  consecutive?: boolean
  // A selection must not leave a single free place stranded between taken places or a group's end.
  noOrphans?: boolean
}

export type SelectionIssue =
  | { code: 'too_few'; min: number }
  | { code: 'too_many'; max: number }
  | { code: 'not_consecutive' }
  | { code: 'orphan_seat'; id: string }

// `selected` are the places being picked; `unavailable` those nobody can pick (booked, held, blocked).
export function validateSelection(
  plan: Pick<SeatPlan<string>, 'objects'>,
  selection: { selected: readonly string[]; unavailable?: readonly string[] },
  rules: SelectionRules,
): SelectionIssue[] {
  const issues: SelectionIssue[] = []
  const selected = new Set(selection.selected)
  const unavailable = new Set(selection.unavailable ?? [])

  if (rules.min !== undefined && selected.size < rules.min) issues.push({ code: 'too_few', min: rules.min })
  if (rules.max !== undefined && selected.size > rules.max) issues.push({ code: 'too_many', max: rules.max })

  const lines = new Map<string, string[]>()
  for (const object of plan.objects) {
    if (object.kind !== 'place' || object.group === undefined) continue
    lines.set(object.group, [...(lines.get(object.group) ?? []), object.id])
  }
  const rows = [...lines.values()].filter((ids) => ids.length > 1)

  if (rules.consecutive) {
    const picked = rows
      .map((row) => row.flatMap((id, i) => (selected.has(id) ? [i] : [])))
      .filter((indices) => indices.length > 0)
    // One group only, and no gap between the first and last picked place.
    const [only, ...others] = picked
    if (others.length > 0 || (only && only.at(-1)! - only[0]! + 1 !== only.length)) {
      issues.push({ code: 'not_consecutive' })
    }
  }

  if (rules.noOrphans) {
    for (const row of rows) {
      const blocked = (i: number) => i < 0 || i >= row.length || isTaken(row[i]!)
      for (const [i, id] of row.entries()) {
        if (isTaken(id) || !blocked(i - 1) || !blocked(i + 1)) continue
        // Only strandings this selection causes — a place already stranded before is not the picker's fault.
        const neighbours = [row[i - 1], row[i + 1]]
        if (neighbours.some((n) => n !== undefined && selected.has(n))) issues.push({ code: 'orphan_seat', id })
      }
    }
  }

  return issues

  function isTaken(id: string) {
    return selected.has(id) || unavailable.has(id)
  }
}
