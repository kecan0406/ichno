import type { PlanPoint, PlanRect } from './types'

// Plane geometry shared by the document functions — polygons and arcs. File-level helpers, not public API.

export function boundsOfPoints(points: readonly PlanPoint[]): PlanRect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function unionBounds(rects: readonly PlanRect[]): PlanRect | null {
  if (rects.length === 0) return null
  return boundsOfPoints(
    rects.flatMap((r) => [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
    ]),
  )
}

// Point in polygon — even-odd ray casting, with points on an edge counted as inside (a seat on the wall line
// still belongs to the room).
export function polygonContains(points: readonly PlanPoint[], point: PlanPoint): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!
    const b = points[j]!
    if (onSegment(a, b, point)) return true
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

// Signed area — positive for clockwise polygons in y-down plan coordinates.
export function signedArea(points: readonly PlanPoint[]): number {
  let sum = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += points[j]!.x * points[i]!.y - points[i]!.x * points[j]!.y
  }
  return sum / 2
}

// The polygon pushed outward by `distance` — each edge moves along its outward normal and neighbouring edges meet
// at a mitred corner. Walls are drawn on this outline so they never cover places near the room edge.
export function offsetPolygon(points: readonly PlanPoint[], distance: number): PlanPoint[] {
  const n = points.length
  if (n < 3 || distance === 0) return points.map((p) => ({ ...p }))
  // Outward is the left normal (dy, -dx) of each edge for a clockwise polygon (y down), the right one otherwise.
  const sign = signedArea(points) > 0 ? 1 : -1
  const lines = points.map((a, i) => {
    const b = points[(i + 1) % n]!
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = (sign * (b.y - a.y)) / len
    const ny = (sign * -(b.x - a.x)) / len
    return { a: { x: a.x + nx * distance, y: a.y + ny * distance }, d: { x: b.x - a.x, y: b.y - a.y } }
  })
  return lines.map((line, i) => {
    const prev = lines[(i - 1 + n) % n]!
    return intersectLines(prev.a, prev.d, line.a, line.d) ?? line.a
  })
}

// Evenly spaced points along the arc from `start` to `end` whose middle is pushed `curve × half the chord` to the
// left of the start→end direction (y down). `count` 1 gives the midpoint of the arc.
export function arcPoints(start: PlanPoint, end: PlanPoint, curve: number, count: number): PlanPoint[] {
  if (count <= 0) return []
  const t = (i: number) => (count === 1 ? 0.5 : i / (count - 1))
  const dx = end.x - start.x
  const dy = end.y - start.y
  const chord = Math.hypot(dx, dy)
  if (curve === 0 || chord === 0) {
    return Array.from({ length: count }, (_, i) => ({ x: start.x + dx * t(i), y: start.y + dy * t(i) }))
  }
  // Left normal of the direction in y-down coordinates.
  const nx = dy / chord
  const ny = -dx / chord
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const sagitta = (curve * chord) / 2
  // Signed radius: the centre sits on the normal line, opposite the bulge.
  const radius = (chord * chord) / 4 / (2 * sagitta) + sagitta / 2
  const center = { x: mid.x + nx * (sagitta - radius), y: mid.y + ny * (sagitta - radius) }
  const a0 = Math.atan2(start.y - center.y, start.x - center.x)
  const a1 = Math.atan2(end.y - center.y, end.x - center.x)
  const apex = Math.atan2(mid.y + ny * sagitta - center.y, mid.x + nx * sagitta - center.x)
  // Sweep through the apex — the short way round unless the apex says otherwise (half circles).
  let sweep = normalizeAngle(a1 - a0)
  if (!angleBetween(a0, sweep, apex)) sweep -= Math.sign(sweep || 1) * 2 * Math.PI
  const r = Math.abs(radius)
  return Array.from({ length: count }, (_, i) => {
    const angle = a0 + sweep * t(i)
    return { x: center.x + r * Math.cos(angle), y: center.y + r * Math.sin(angle) }
  })
}

function normalizeAngle(angle: number): number {
  let a = angle
  while (a <= -Math.PI) a += 2 * Math.PI
  while (a > Math.PI) a -= 2 * Math.PI
  return a
}

// Whether `angle` lies on the sweep that starts at `from` and turns by `sweep`.
function angleBetween(from: number, sweep: number, angle: number): boolean {
  const rel = normalizeAngle(angle - from)
  const eps = 1e-9
  return sweep >= 0 ? rel >= -eps && rel <= sweep + eps : rel <= eps && rel >= sweep - eps
}

function onSegment(a: PlanPoint, b: PlanPoint, p: PlanPoint): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  if (Math.abs(cross) > 1e-9) return false
  return (
    p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
  )
}

function intersectLines(p: PlanPoint, d: PlanPoint, q: PlanPoint, e: PlanPoint): PlanPoint | null {
  const denom = d.x * e.y - d.y * e.x
  if (Math.abs(denom) < 1e-12) return null
  const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / denom
  return { x: p.x + d.x * t, y: p.y + d.y * t }
}
