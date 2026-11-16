import { seatPlan, type PlanRect, type SeatPlan } from 'ichno'
import { SIGN_HEIGHT, type Writing } from './scene'

// Where the plan's categories are named. Every place is painted alike, so a category is read from a label: its name
// written on the floor above each cluster of places that share it. Nothing is named while the places are all of one
// category — there is nothing to tell apart.

export type CategoryLabel = {
  category: string
  // Where the name starts: the cluster's left edge, its baseline a little above the cluster's top.
  x: number
  y: number
}

// The size of the lettering and how far above a cluster it is written, in plan units.
export const CATEGORY_LABEL_SIZE = 22

const ABOVE = 10

// Places of one category this near each other are one cluster.
const NEAR = 120

// A plan with more places than this is not labelled — the clusters are found pair by pair.
const MOST = 1000

export function categoryLabelsOf(plan: SeatPlan<string>): CategoryLabel[] {
  const places = seatPlan.placesOf(plan)

  if (places.length > MOST || new Set(places.map((place) => place.category)).size < 2) return []
  // The furniture of each group — a desk's chair, a table's top — so a name clears it as well as the places.
  const furniture = new Map<string, PlanRect[]>()

  for (const object of plan.objects) {
    if (object.kind !== 'fixture' || object.group === undefined) continue
    furniture.set(object.group, [...(furniture.get(object.group) ?? []), seatPlan.boundsOf(object)])
  }

  const boxes = places.map((place) => {
    const bounds = seatPlan.boundsOf(place)

    const beside = (place.group === undefined ? [] : (furniture.get(place.group) ?? [])).filter((other) =>
      near(bounds, other),
    )

    return { category: place.category, bounds, reach: beside.reduce(union, bounds) }
  })

  // Each place points at another of its cluster, the last of them at itself.
  const parent = boxes.map((_, i) => i)

  const root = (i: number): number => {
    let at = i

    while (parent[at] !== at) at = parent[at]!

    return at
  }

  boxes.forEach((a, i) => {
    if (a.category === undefined) return

    for (let j = i + 1; j < boxes.length; j += 1) {
      const b = boxes[j]!

      if (b.category === a.category && near(a.bounds, b.bounds)) parent[root(j)] = root(i)
    }
  })

  const clusters = new Map<number, { category: string; bounds: PlanRect }>()

  boxes.forEach((box, i) => {
    if (box.category === undefined) return
    const key = root(i)
    const cluster = clusters.get(key)

    clusters.set(key, { category: box.category, bounds: cluster ? union(cluster.bounds, box.reach) : box.reach })
  })

  return [...clusters.values()]
    .map(({ category, bounds }) => ({ category, x: bounds.x, y: bounds.y - ABOVE }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
}

// The labels as the canvas writes them: signs standing over where each name starts, as a group's labels do — flat
// on the floor they would hide behind whatever stands in front.
export function categoryWritingOf(plan: SeatPlan<string>): Writing[] {
  return categoryLabelsOf(plan).map((label) => {
    const at = {
      x: label.x,
      y: SIGN_HEIGHT,
      z: label.y - CATEGORY_LABEL_SIZE * 0.35,
      size: CATEGORY_LABEL_SIZE,
      yaw: 0,
    }

    return {
      text: categoryNameOf(label.category),
      lie: 'sign',
      tone: 'label',
      ...at,
      anchor: 'start',
      plan: at,
    }
  })
}

// A category's key as this site writes it — the key is the document's, the capital this site's.
export function categoryNameOf(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1)
}

function near(a: PlanRect, b: PlanRect): boolean {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w))
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))

  return dx <= NEAR && dy <= NEAR
}

function union(a: PlanRect, b: PlanRect): PlanRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)

  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
