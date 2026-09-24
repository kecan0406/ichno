import type { SeatPlan } from './types'

// Selection rules for pickers — the checks Seats.io runs as "selection validators", as a pure function. The
// consumer decides when to run them (on every change, or on submit) and writes the message for each code.

export type SelectionRules = {
  min?: number
  max?: number
  // Selected row seats must sit side by side in one row.
  consecutive?: boolean
  // A selection must not leave a single free seat stranded between taken seats or a row end.
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

  const rows = plan.objects.filter((object) => object.kind === 'row')

  if (rules.consecutive) {
    const picked = rows
      .map((row) => row.seats.flatMap((seat, i) => (selected.has(seat.id) ? [i] : [])))
      .filter((indices) => indices.length > 0)
    // One row only, and no gap between the first and last picked seat.
    const [only, ...others] = picked
    if (others.length > 0 || (only && only.at(-1)! - only[0]! + 1 !== only.length)) {
      issues.push({ code: 'not_consecutive' })
    }
  }

  if (rules.noOrphans) {
    for (const row of rows) {
      const blocked = (i: number) => i < 0 || i >= row.seats.length || isTaken(row.seats[i]!.id)
      for (const [i, seat] of row.seats.entries()) {
        if (isTaken(seat.id) || !blocked(i - 1) || !blocked(i + 1)) continue
        // Only strandings this selection causes — a seat already stranded before is not the picker's fault.
        const neighbours = [row.seats[i - 1], row.seats[i + 1]]
        if (neighbours.some((n) => n && selected.has(n.id))) issues.push({ code: 'orphan_seat', id: seat.id })
      }
    }
  }

  return issues

  function isTaken(id: string) {
    return selected.has(id) || unavailable.has(id)
  }
}
