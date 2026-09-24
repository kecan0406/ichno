import type { PlanPoint } from './types'

// Arrow-key movement between places — the keyboard counterpart of pointing. Pure, so any renderer can offer the
// same focus order. Rows and tables have their own order, but people read a plan spatially, so movement follows
// what is on screen: the nearest place in the pressed direction, preferring ones straight ahead over ones off to
// the side.

export type NavigationDirection = 'up' | 'down' | 'left' | 'right'
export type NavigationItem = { id: string; center: PlanPoint }

export const placeNavigation = {
  first,
  next,
}

// Where focus lands when nothing is focused yet — the top-left place (top first, then left).
function first(items: readonly NavigationItem[]): string | null {
  let best: NavigationItem | null = null
  for (const item of items) {
    if (!best || item.center.y < best.center.y || (item.center.y === best.center.y && item.center.x < best.center.x))
      best = item
  }
  return best?.id ?? null
}

// The place to move to from `fromId`, or null when nothing lies in that direction (focus stays put).
// Candidates must lie within 45° of the direction; among them the score is the distance along the direction plus
// twice the sideways offset, so a place in the same row beats a closer one diagonally.
function next(items: readonly NavigationItem[], fromId: string, direction: NavigationDirection): string | null {
  const from = items.find((item) => item.id === fromId)
  if (!from) return first(items)
  const axis = AXES[direction]
  let best: { id: string; score: number } | null = null
  for (const item of items) {
    if (item.id === fromId) continue
    const dx = item.center.x - from.center.x
    const dy = item.center.y - from.center.y
    const along = dx * axis.x + dy * axis.y
    const across = Math.abs(dx * axis.y - dy * axis.x)
    if (along <= 0 || across > along) continue
    const score = along + across * 2
    if (!best || score < best.score) best = { id: item.id, score }
  }
  return best?.id ?? null
}

const AXES: Record<NavigationDirection, PlanPoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}
