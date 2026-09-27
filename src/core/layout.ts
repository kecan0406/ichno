import { arcSteps, normalizeRotation, rotatePoint } from './math'
import type { PlanBox, PlanPoint, PlanSize, Shape } from './types'

// Layouts — where the seats of a row, a table or a block of desks go. The document stores only the resulting
// boxes; a layout is how the editor creates them (`addPlaces`) and moves existing ones into a new arrangement
// (`arrange`). Every box has integer `x y w h`, like the document.

// Gap between a table top and the seats around it.
export const TABLE_SEAT_GAP = 6

// A seat's size — one number for a round or square seat.
type SeatSize = number | PlanSize

export const layout = {
  line,
  arc,
  around,
  grid,
  curveOf,
}

// Seats spread evenly from `start` to `end` (seat centres, both ends included), turned along the line.
function line(options: { start: PlanPoint; end: PlanPoint; count: number; size: SeatSize }): PlanBox[] {
  return arc({ ...options, curve: 0 })
}

// Seats spread evenly along an arc from `start` to `end` whose middle bows `curve` × half the distance to the
// left of start→end (up for a row drawn left to right): 0 is straight, ±1 a half circle. Each seat is turned
// along the arc, so rectangular seats follow the curve.
function arc({
  start,
  end,
  curve = 0,
  count,
  size,
}: {
  start: PlanPoint
  end: PlanPoint
  curve?: number
  count: number
  size: SeatSize
}): PlanBox[] {
  const { w, h } = sizeOf(size)
  return arcSteps(start, end, Math.min(1, Math.max(-1, curve)), count).map(({ point, heading }) =>
    boxAt(point, w, h, heading),
  )
}

// Seats around a table top, facing it. Round tops spread them evenly clockwise from the top; rectangular tops
// split them over the two long sides (the first side takes the odd one), left to right / top to bottom. A turned
// top turns its seats with it.
function around({
  table,
  shape,
  count,
  size,
  gap = TABLE_SEAT_GAP,
}: {
  table: PlanBox
  shape: Shape
  count: number
  size: SeatSize
  gap?: number
}): PlanBox[] {
  if (count <= 0) return []
  const seat = sizeOf(size)
  const center = { x: table.x + table.w / 2, y: table.y + table.h / 2 }
  const rotation = table.rotation ?? 0
  const reach = seat.h / 2 + gap
  const place = (point: PlanPoint, facing: number) =>
    boxAt(rotatePoint(point, center, rotation), seat.w, seat.h, facing + rotation)
  if (shape === 'ellipse') {
    const rx = table.w / 2 + reach
    const ry = table.h / 2 + reach
    return Array.from({ length: count }, (_, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / count
      const point = { x: center.x + rx * Math.cos(angle), y: center.y + ry * Math.sin(angle) }
      return place(point, (angle * 180) / Math.PI + 90)
    })
  }
  const wide = table.w >= table.h
  const firstCount = Math.ceil(count / 2)
  return Array.from({ length: count }, (_, i) => {
    const first = i < firstCount
    const k = first ? i : i - firstCount
    const along = (k + 0.5) / (first ? firstCount : count - firstCount)
    if (wide) {
      const x = table.x + table.w * along
      return first ? place({ x, y: table.y - reach }, 0) : place({ x, y: table.y + table.h + reach }, 180)
    }
    const y = table.y + table.h * along
    return first ? place({ x: table.x + table.w + reach, y }, 90) : place({ x: table.x - reach, y }, 270)
  })
}

// A block of `columns` × `rows` boxes from `origin` (the top-left of the first), row by row.
function grid({
  origin,
  columns,
  rows,
  size,
  gap = 0,
}: {
  origin: PlanPoint
  columns: number
  rows: number
  size: SeatSize
  gap?: number
}): PlanBox[] {
  const { w, h } = sizeOf(size)
  return Array.from({ length: Math.max(0, rows) * Math.max(0, columns) }, (_, i) => ({
    x: Math.round(origin.x + (i % columns) * (w + gap)),
    y: Math.round(origin.y + Math.floor(i / columns) * (h + gap)),
    w,
    h,
  }))
}

// The curve of the arc through a run of seat centres — the inverse of `arc`, so an existing row can be bent
// further. The circle through the first, the middle and the last centre gives it; 0 when they are in line.
function curveOf(centers: readonly PlanPoint[]): number {
  if (centers.length < 3) return 0
  const a = centers[0]!
  const b = centers.at(-1)!
  const m = centers[Math.floor((centers.length - 1) / 2)]!
  const chord = Math.hypot(b.x - a.x, b.y - a.y)
  if (chord === 0) return 0
  // Twice the signed area over the chord — the middle's distance from the chord, left of start→end positive.
  const offset = ((b.x - a.x) * (a.y - m.y) - (b.y - a.y) * (a.x - m.x)) / chord
  if (Math.abs(offset) < 1e-9) return 0
  const radius = circumradius(a, m, b)
  const half = chord / 2
  const sagitta = radius - Math.sqrt(Math.max(0, radius * radius - half * half))
  return Math.round(Math.min(1, sagitta / half) * Math.sign(offset) * 100) / 100
}

function circumradius(a: PlanPoint, b: PlanPoint, c: PlanPoint): number {
  const ab = Math.hypot(b.x - a.x, b.y - a.y)
  const bc = Math.hypot(c.x - b.x, c.y - b.y)
  const ca = Math.hypot(a.x - c.x, a.y - c.y)
  const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y))
  return (ab * bc * ca) / (2 * area2)
}

function sizeOf(size: SeatSize): PlanSize {
  return typeof size === 'number'
    ? { w: Math.round(size), h: Math.round(size) }
    : { w: Math.round(size.w), h: Math.round(size.h) }
}

// The integer box of `w × h` centred on `center`, turned by `rotation` (left out when it rounds to none).
function boxAt(center: PlanPoint, w: number, h: number, rotation: number): PlanBox {
  const r = normalizeRotation(rotation)
  const box = { x: Math.round(center.x - w / 2), y: Math.round(center.y - h / 2), w, h }
  return r === 0 ? box : { ...box, rotation: r }
}
