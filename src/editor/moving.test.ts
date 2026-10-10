import { describe, expect, it } from 'vitest'
import { seatPlan } from '../core/geometry'
import type { Place, SeatPlan } from '../core/types'
import { KEY_SEPARATOR, changedKey, idsKey, onlyIds, overlapsOf, overlapsWith, withoutIds } from './moving'
import { planEdits } from './operations'

const seat = (id: string, x: number, y: number, group?: string): Place => {
  const place: Place = { kind: 'place', id, section: 'A', x, y, w: 40, h: 40, shape: 'rect', capacity: 1 }

  if (group) place.group = group

  return place
}

const plan: SeatPlan = {
  version: 3,
  width: 1000,
  height: 1000,
  sections: [
    {
      id: 'A',
      points: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
      ],
    },
  ],
  walls: [],
  categories: [],
  groups: [{ id: 'r' }],
  // Two still seats already overlapping, a row of three, a seat apart.
  objects: [
    seat('S1', 500, 500),
    seat('S2', 520, 500),
    seat('R1', 0, 100, 'r'),
    seat('R2', 46, 100, 'r'),
    seat('R3', 92, 100, 'r'),
    seat('L1', 300, 300),
  ],
}

describe('the moving part of a drag', () => {
  it('names what a move changed, keeps the still part whole and the moving part without sections', () => {
    const moved = planEdits.move(plan, ['r'], { x: 0, y: 46 })
    const key = changedKey(plan, moved)!
    expect(key.split(KEY_SEPARATOR)).toEqual(['R1', 'R2', 'R3'])
    expect(withoutIds(plan, key).objects.map((o) => o.id)).toEqual(['S1', 'S2', 'L1'])
    expect(onlyIds(moved, key)).toMatchObject({
      sections: [],
      objects: [{ id: 'R1', y: 146 }, { id: 'R2' }, { id: 'R3' }],
    })
    expect(changedKey(plan, plan)).toBe('')

    const reshaped = planEdits.reshapeSection(plan, 'A', [
      { x: 0, y: 0 },
      { x: 900, y: 0 },
      { x: 1000, y: 1000 },
    ])

    expect(changedKey(plan, reshaped)).toBeNull()
    // Gone objects count as changed.
    expect(changedKey(plan, planEdits.remove(plan, ['L1']).plan)).toBe('L1')
  })

  it('finds the same overlaps checking only what moves as checking the whole plan', () => {
    // The row dragged onto the lone seat at 300, 300 and onto the overlapping pair.
    for (const delta of [
      { x: 230, y: 200 },
      { x: 470, y: 400 },
      { x: 0, y: 0 },
    ]) {
      const moved = planEdits.move(plan, ['r'], delta)
      const key = changedKey(plan, moved)
      const still = key ? overlapsOf(withoutIds(plan, key)) : null
      const fast = still && key ? idsKey([...still.ids, ...overlapsWith(onlyIds(moved, key), still)]) : null
      expect(fast ?? idsKey(seatPlan.conflictsOf(moved).flat())).toBe(idsKey(seatPlan.conflictsOf(moved).flat()))
    }
  })
})
