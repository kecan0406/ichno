import type { PlanPoint, PlanRect } from './types'

// Spatial index — a uniform bucket grid over item bounds. Hit-testing, marquee selection and viewport culling
// query it instead of scanning every item, and none of them depend on how the plan is drawn.
// Built once per document change; queries never mutate it.

export type SpatialItem = { id: string; bounds: PlanRect }

export type SpatialIndex = {
  cellSize: number
  buckets: Map<string, SpatialItem[]>
  // Insertion order — query results come back in it, so later (upper) items can win hit-tests.
  order: Map<string, number>
}

// Bucket edge in plan units — about two standard desks, so a typical item touches one to four buckets.
const DEFAULT_CELL_SIZE = 184

export const spatialIndex = {
  create,
  query,
  at,
}

function create(items: readonly SpatialItem[], cellSize: number = DEFAULT_CELL_SIZE): SpatialIndex {
  const buckets = new Map<string, SpatialItem[]>()
  const order = new Map<string, number>()
  for (const [i, item] of items.entries()) {
    order.set(item.id, i)
    forEachCell(item.bounds, cellSize, (key) => {
      const bucket = buckets.get(key)
      if (bucket) bucket.push(item)
      else buckets.set(key, [item])
    })
  }
  return { cellSize, buckets, order }
}

// Items whose bounds intersect the rectangle (touching edges count), in insertion order.
function query(index: SpatialIndex, rect: PlanRect): SpatialItem[] {
  const found = new Map<string, SpatialItem>()
  forEachCell(rect, index.cellSize, (key) => {
    for (const item of index.buckets.get(key) ?? []) {
      if (!found.has(item.id) && intersects(item.bounds, rect)) found.set(item.id, item)
    }
  })
  return sortByOrder(index, [...found.values()])
}

// The topmost item at a point — the last inserted one whose bounds contain it and that passes `contains`
// (the precise shape test, e.g. a circle inside its bounding box). null when nothing is there.
function at(
  index: SpatialIndex,
  point: PlanPoint,
  contains: (item: SpatialItem, point: PlanPoint) => boolean = containsBounds,
): SpatialItem | null {
  const candidates = query(index, { x: point.x, y: point.y, w: 0, h: 0 })
  for (let i = candidates.length - 1; i >= 0; i--) {
    const item = candidates[i]!
    if (contains(item, point)) return item
  }
  return null
}

function containsBounds(item: SpatialItem, point: PlanPoint): boolean {
  const b = item.bounds
  return point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h
}

function intersects(a: PlanRect, b: PlanRect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

function forEachCell(rect: PlanRect, cellSize: number, visit: (key: string) => void) {
  const x0 = Math.floor(rect.x / cellSize)
  const y0 = Math.floor(rect.y / cellSize)
  const x1 = Math.floor((rect.x + rect.w) / cellSize)
  const y1 = Math.floor((rect.y + rect.h) / cellSize)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) visit(`${x},${y}`)
  }
}

function sortByOrder(index: SpatialIndex, items: SpatialItem[]): SpatialItem[] {
  return items.sort((a, b) => index.order.get(a.id)! - index.order.get(b.id)!)
}
