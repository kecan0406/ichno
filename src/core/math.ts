import type { PlanBox, PlanPoint, PlanRect, Shape } from './types'

// Plane geometry shared by the document functions — turned boxes, polygons and arcs. File-level helpers, not
// public API.

// Sides of the polygon an ellipse is tested as. Inscribed, so shapes that only touch never test as overlapping.
const ELLIPSE_SIDES = 32

export function centerOfBox(box: PlanRect): PlanPoint {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}

// `point` turned clockwise (y down) by `degrees` about `center` — SVG's rotate(degrees, cx, cy).
export function rotatePoint(point: PlanPoint, center: PlanPoint, degrees: number): PlanPoint {
  if (!degrees) return { x: point.x, y: point.y }
  const a = (degrees * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

// The outline of a shape in plan coordinates — a rectangle's four corners (nw, ne, se, sw of the unturned box) or
// a polygon inscribed in the ellipse. `inset` shrinks the shape on every side first.
export function outlineOf(box: PlanBox, shape: Shape, inset = 0): PlanPoint[] {
  const center = centerOfBox(box)
  const hw = Math.max(0, box.w / 2 - inset)
  const hh = Math.max(0, box.h / 2 - inset)
  const local =
    shape === 'rect'
      ? [
          { x: -hw, y: -hh },
          { x: hw, y: -hh },
          { x: hw, y: hh },
          { x: -hw, y: hh },
        ]
      : Array.from({ length: ELLIPSE_SIDES }, (_, i) => {
          const a = (2 * Math.PI * i) / ELLIPSE_SIDES
          return { x: hw * Math.cos(a), y: hh * Math.sin(a) }
        })
  return local.map((p) => rotatePoint({ x: center.x + p.x, y: center.y + p.y }, center, box.rotation ?? 0))
}

// The axis-aligned rectangle around a turned shape — exact for ellipses, not just their box's corners.
export function boundsOfBox(box: PlanBox, shape: Shape = 'rect'): PlanRect {
  const rotation = box.rotation ?? 0
  if (!rotation) return { x: box.x, y: box.y, w: box.w, h: box.h }
  const center = centerOfBox(box)
  if (shape === 'rect') return boundsOfPoints(outlineOf(box, 'rect'))
  const a = (rotation * Math.PI) / 180
  const rx = box.w / 2
  const ry = box.h / 2
  const hw = Math.hypot(rx * Math.cos(a), ry * Math.sin(a))
  const hh = Math.hypot(rx * Math.sin(a), ry * Math.cos(a))
  return { x: center.x - hw, y: center.y - hh, w: hw * 2, h: hh * 2 }
}

// Whether a plan point lies on a turned shape (its edge included).
export function boxContains(box: PlanBox, shape: Shape, point: PlanPoint): boolean {
  const center = centerOfBox(box)
  const local = rotatePoint(point, center, -(box.rotation ?? 0))
  const dx = local.x - center.x
  const dy = local.y - center.y
  const hw = box.w / 2
  const hh = box.h / 2
  if (shape === 'rect') return Math.abs(dx) <= hw + 1e-9 && Math.abs(dy) <= hh + 1e-9
  if (hw === 0 || hh === 0) return false
  return (dx * dx) / (hw * hw) + (dy * dy) / (hh * hh) <= 1 + 1e-9
}

// Separating-axis test for convex polygons. Touching outlines overlap only when `touching` is set.
export function polygonsOverlap(a: readonly PlanPoint[], b: readonly PlanPoint[], touching = false): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i]!
      const q = polygon[(i + 1) % polygon.length]!
      const axis = { x: q.y - p.y, y: p.x - q.x }
      if (axis.x === 0 && axis.y === 0) continue
      const [minA, maxA] = project(a, axis)
      const [minB, maxB] = project(b, axis)
      const eps = 1e-9 * (Math.abs(axis.x) + Math.abs(axis.y))
      if (touching ? maxA < minB - eps || maxB < minA - eps : maxA <= minB + eps || maxB <= minA + eps) return false
    }
  }
  return true
}

function project(points: readonly PlanPoint[], axis: PlanPoint): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    const d = p.x * axis.x + p.y * axis.y
    min = Math.min(min, d)
    max = Math.max(max, d)
  }
  return [min, max]
}

// Rounds to the nearest whole number, halves to the even one — repeated turns land on halves often, and rounding
// them all up would walk a turned group off in one direction.
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value)
  const rest = value - floor
  if (Math.abs(rest - 0.5) > 1e-9) return Math.round(value)
  return floor % 2 === 0 ? floor : floor + 1
}

// A rotation in degrees brought into 0 ≤ r < 360, rounded to hundredths — the form the document stores.
export function normalizeRotation(degrees: number): number {
  const r = Math.round((((degrees % 360) + 360) % 360) * 100) / 100
  return r >= 360 ? 0 : r
}

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
  return arcSteps(start, end, curve, count).map(({ point }) => point)
}

// The same points with the direction of travel at each (degrees, clockwise from +x in y-down coordinates).
export function arcSteps(
  start: PlanPoint,
  end: PlanPoint,
  curve: number,
  count: number,
): { point: PlanPoint; heading: number }[] {
  if (count <= 0) return []
  const t = (i: number) => (count === 1 ? 0.5 : i / (count - 1))
  const dx = end.x - start.x
  const dy = end.y - start.y
  const chord = Math.hypot(dx, dy)
  if (curve === 0 || chord === 0) {
    const heading = (Math.atan2(dy, dx) * 180) / Math.PI
    return Array.from({ length: count }, (_, i) => ({
      point: { x: start.x + dx * t(i), y: start.y + dy * t(i) },
      heading,
    }))
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
    // The tangent turns a quarter from the radius, in the direction the sweep runs.
    const heading = ((angle + (Math.sign(sweep) * Math.PI) / 2) * 180) / Math.PI
    return { point: { x: center.x + r * Math.cos(angle), y: center.y + r * Math.sin(angle) }, heading }
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
