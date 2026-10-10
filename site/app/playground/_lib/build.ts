import {
  labeling,
  layout,
  seatPlan,
  type Fixture,
  type LabelSequence,
  type Place,
  type PlanBox,
  type PlanObject,
  type PlanPoint,
  type PlanRect,
  type PlanSize,
  type PlanStroke,
  type SeatPlan,
  type Shape,
} from 'ichno'
import { planEdits, type EditorHandles } from 'ichno/editor'
import { WALL_STEP } from './units'

// What the playground's tools build, and the rows and tables it reads back from groups. ichno stores places,
// fixtures, groups and walls; a seat, a desk or a table is this site's role for one of them, a door its role for an
// opening in a wall. Every tool makes one thing — grouping them into a row or a table is up to whoever draws them.
// Each builder takes the stroke the editor hands a tool: a drag sizes the thing, a tap (a stroke with no length) drops
// it at its default size.

type Plan = SeatPlan<string>

const TABLE_SEAT = 45
// Row labels sit this far beyond the end seats.
const LABEL_SIZE = 40
const LABEL_OFFSET = 50
// A box stroke narrower than this either way is a tap.
const TAP = 25
// Plan units² per person in a standing area — half a square metre, a comfortable crowd: the default one (300 × 150)
// holds nine.
const AREA_PER_PERSON = 5000

// ---------- Tools ----------

// A place of the site's `role` (none for the toolbar's bare place), drawn at any size or dropped at `size`, in the
// section under its centre — null outside every section. A standing area holds people in proportion to its floor.
export function placeTool(
  role: string | undefined,
  size: PlanSize,
  options: { shape?: Shape; capacity?: number } = {},
) {
  return (plan: Plan, stroke: PlanStroke): Plan | null => {
    const drawn = rectOf(stroke)
    const box = drawn.w < TAP || drawn.h < TAP ? around(stroke.end, size) : drawn
    const section = seatPlan.sectionAt(plan, seatPlan.centerOf(box))
    if (section === null) return null
    const capacity =
      role === 'area' ? Math.max(1, Math.round((box.w * box.h) / AREA_PER_PERSON)) : (options.capacity ?? 1)
    return planEdits.addPlaces(plan, section, [box], { shape: options.shape ?? 'rect', role, capacity })?.plan ?? null
  }
}

// A fixture of the site's `role` (none for the toolbar's bare fixture) — drawn as a box; a tap drops it at `size`.
export function fixtureTool(role: string | undefined, size: PlanSize, options: { shape?: Shape } = {}) {
  return (plan: Plan, stroke: PlanStroke): Plan => {
    const drawn = rectOf(stroke)
    const box = drawn.w < TAP || drawn.h < TAP ? around(stroke.end, size) : drawn
    return planEdits.addFixtures(plan, [box], { shape: options.shape, role }).plan
  }
}

// A metre of wall `thickness` across, turned `degrees` clockwise from the right — the way a housing game puts up a wall
// piece by piece, under the pointer (`pieceAt`). An end that comes to a wall's end meets it there, which carries that
// wall on, links two or closes a room (`planEdits.buildWall`). null where a wall runs already or off the plan.
export function wallPieceTool(thickness: number, degrees: number) {
  return (plan: Plan, stroke: PlanStroke): Plan | null =>
    planEdits.buildWall(plan, { points: pieceAt(plan, stroke.end, degrees), thickness })?.plan ?? null
}

// Why a wall piece cannot go where the pointer is.
export function wallPieceRefusal(plan: Plan, at: PlanPoint, degrees: number): 'outside' | 'taken' {
  const ends = pieceAt(plan, at, degrees)
  return ends.some((p) => p.x < 0 || p.y < 0 || p.x > plan.width || p.y > plan.height) ? 'outside' : 'taken'
}

// A room — a closed wall `thickness` across through the corners drawn on the metre grid, or round the rectangle
// dragged out. Three corners at least.
export function roomTool(thickness: number) {
  return (plan: Plan, stroke: PlanStroke): Plan | null => {
    const points = stroke.points ?? []
    if (points.length < 3) return null
    return planEdits.addWall(plan, { points, thickness, closed: true })?.plan ?? null
  }
}

// Where a wall piece for the pointer at `at` runs, so it lies under the pointer: hinged on the end of a wall when the
// pointer is over where a piece from that end (or into it) would run — within half a metre of it — and otherwise, level
// or upright, on the metre of grid line under the pointer, or at another turn centred on it. Its far end lands on a
// wall's end within a hair, so a chain of turned pieces still closes.
function pieceAt(plan: Plan, at: PlanPoint, degrees: number): [PlanPoint, PlanPoint] {
  const a = (degrees * Math.PI) / 180
  const d = { x: tidy(Math.cos(a)), y: tidy(Math.sin(a)) }
  const [start, end] = hingedAt(plan, at, d) ?? freeAt(at, d)
  return [start, wallEndNear(plan, end, PIECE_MEET) ?? end]
}

// A piece run from — or into — the end of an open wall, for a pointer over where it would lie; the nearest such. Run
// straight on, it lengthens the wall's last edge to the next whole metre from that edge's start, so the edge reads in
// whole metres however many pieces it took.
function hingedAt(plan: Plan, at: PlanPoint, d: PlanPoint): [PlanPoint, PlanPoint] | null {
  let best: { piece: [PlanPoint, PlanPoint]; distance: number } | null = null
  for (const wall of plan.walls) {
    if (wall.closed || wall.points.length < 2) continue
    const ends: [PlanPoint, PlanPoint][] = [
      [wall.points[0]!, wall.points[1]!],
      [wall.points.at(-1)!, wall.points.at(-2)!],
    ]
    for (const [end, neighbour] of ends) {
      const along = (at.x - end.x) * d.x + (at.y - end.y) * d.y
      const across = Math.abs((at.x - end.x) * -d.y + (at.y - end.y) * d.x)
      if (across > WALL_STEP / 2 || Math.abs(along) > WALL_STEP) continue
      // The way from the end to the piece's other end, and the way the wall comes into the end.
      const away = along >= 0 ? d : { x: -d.x, y: -d.y }
      const edge = Math.hypot(end.x - neighbour.x, end.y - neighbour.y)
      const into = { x: (end.x - neighbour.x) / edge, y: (end.y - neighbour.y) / edge }
      const straight = away.x * into.x + away.y * into.y > STRAIGHT_ON
      const reach = straight ? Math.round(edge / WALL_STEP) * WALL_STEP + WALL_STEP : WALL_STEP
      const from = straight ? neighbour : end
      const way = straight ? into : away
      const other = metreNear({ x: from.x + way.x * reach, y: from.y + way.y * reach }, from, reach)
      const piece: [PlanPoint, PlanPoint] = along >= 0 ? [end, other] : [other, end]
      // Not back along the wall it ends.
      if (alongAWall(plan, piece[0], piece[1])) continue
      const middle = { x: (piece[0].x + piece[1].x) / 2, y: (piece[0].y + piece[1].y) / 2 }
      const distance = Math.hypot(at.x - middle.x, at.y - middle.y)
      if (best === null || distance < best.distance) best = { piece, distance }
    }
  }
  return best?.piece ?? null
}

// A piece away from every wall's end: level or upright, the metre of grid line under the pointer; at another turn,
// centred on the pointer.
function freeAt(at: PlanPoint, d: PlanPoint): [PlanPoint, PlanPoint] {
  if (d.x === 0 || d.y === 0) {
    const level = d.y === 0
    const line = Math.round((level ? at.y : at.x) / WALL_STEP) * WALL_STEP
    const from = Math.floor((level ? at.x : at.y) / WALL_STEP) * WALL_STEP
    const a = level ? { x: from, y: line } : { x: line, y: from }
    const b = level ? { x: from + WALL_STEP, y: line } : { x: line, y: from + WALL_STEP }
    return (level ? d.x : d.y) > 0 ? [a, b] : [b, a]
  }
  const half = WALL_STEP / 2
  const start = { x: Math.round(at.x - d.x * half), y: Math.round(at.y - d.y * half) }
  return [start, metreNear({ x: start.x + d.x * WALL_STEP, y: start.y + d.y * WALL_STEP }, start, WALL_STEP)]
}

// The whole-unit point near `ideal` that lies `length` from `from` most nearly — within half a unit when any does, so
// a turned piece still measures a whole metre (the nearest whole units to a metre at 10° are 99.46 away). Of those, the
// one nearest `ideal`.
function metreNear(ideal: PlanPoint, from: PlanPoint, length: number): PlanPoint {
  let best: { point: PlanPoint; miss: number; off: number } | null = null
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const point = { x: Math.round(ideal.x) + dx, y: Math.round(ideal.y) + dy }
      const off = Math.hypot(point.x - ideal.x, point.y - ideal.y)
      if (off > 2) continue
      const miss = Math.abs(Math.hypot(point.x - from.x, point.y - from.y) - length)
      const better =
        best === null ||
        (miss < 0.5 && best.miss >= 0.5) ||
        (miss < 0.5 === best.miss < 0.5 && (miss < 0.5 ? off < best.off : miss < best.miss))
      if (better) best = { point, miss, off }
    }
  }
  return best!.point
}

// Whether a stretch lies along an edge a wall has already.
function alongAWall(plan: Plan, a: PlanPoint, b: PlanPoint): boolean {
  return plan.walls.some((wall) =>
    seatPlan.wallEdgesOf(wall).some((edge) => offEdge(edge, a) < 0.5 && offEdge(edge, b) < 0.5),
  )
}

// How far a point lies from an edge of a wall.
function offEdge(edge: { a: PlanPoint; along: PlanPoint; length: number }, p: PlanPoint): number {
  const t = Math.min(edge.length, Math.max(0, (p.x - edge.a.x) * edge.along.x + (p.y - edge.a.y) * edge.along.y))
  return Math.hypot(p.x - (edge.a.x + edge.along.x * t), p.y - (edge.a.y + edge.along.y * t))
}

// A sine or cosine without the float crumbs a quarter turn leaves.
function tidy(value: number): number {
  return Math.abs(value) < 1e-9 ? 0 : value
}

// The end of an open wall nearest `at`, within `reach`.
function wallEndNear(plan: Plan, at: PlanPoint, reach: number): PlanPoint | null {
  let best: { point: PlanPoint; distance: number } | null = null
  for (const wall of plan.walls) {
    if (wall.closed || wall.points.length < 2) continue
    for (const point of [wall.points[0]!, wall.points.at(-1)!]) {
      const distance = Math.hypot(point.x - at.x, point.y - at.y)
      if (distance <= reach && (best === null || distance < best.distance)) best = { point, distance }
    }
  }
  return best?.point ?? null
}

// An opening `width` across, of this site's `role` (a door), in the wall nearest the tap — centred on it, kept within
// the edge (`seatPlan.openingAt`). null with no wall near enough, or no room on it.
export function openingTool(width: number, role: string) {
  return (plan: Plan, stroke: PlanStroke): Plan | null => {
    const spot = seatPlan.openingAt(plan, stroke.end, width, OPENING_REACH)
    if (typeof spot === 'string') return null
    return planEdits.addOpening(plan, spot.wall, { ...spot.opening, role })
  }
}

// Why an opening cannot go where the pointer is — `seatPlan.openingAt`'s answer.
export function openingRefusal(plan: Plan, at: PlanPoint, width: number): 'far' | 'short' | 'taken' | null {
  const spot = seatPlan.openingAt(plan, at, width, OPENING_REACH)
  return typeof spot === 'string' ? spot : null
}

// ---------- Rows ----------

// `size` is the first seat's — every seat of a relaid row takes it.
export type Row = { seats: Place[]; start: PlanPoint; end: PlanPoint; curve: number; size: PlanSize }

// A row read back from its seats — the arc through their centres, first to last.
export function rowOf(plan: Plan, groupId: string): Row | null {
  const seats = seatPlan.membersOf(plan, groupId).filter((o): o is Place => o.kind === 'place')
  if (seats.length === 0) return null
  const centers = seats.map(seatPlan.centerOf)
  return {
    seats,
    start: centers[0]!,
    end: centers.at(-1)!,
    curve: layout.curveOf(centers),
    size: { w: seats[0]!.w, h: seats[0]!.h },
  }
}

// The row laid out again — with another seat count, curve or last seat, from the same first seat. Its labels follow
// its ends, and seats numbered the way the inspector numbers them stay numbered that way, new ones included.
export function relayRow(
  plan: Plan,
  groupId: string,
  change: { count?: number; curve?: number; end?: PlanPoint },
  locked: ReadonlySet<string>,
): Plan | null {
  const row = rowOf(plan, groupId)
  if (!row) return null
  const count = change.count ?? row.seats.length
  const boxes = layout.arc({
    start: row.start,
    end: change.end ?? endOf(row, count),
    curve: change.curve ?? row.curve,
    count,
    size: row.size,
  })
  const next = planEdits.layoutGroup(plan, groupId, boxes, { kind: 'place' }, locked)
  if (!next) return null
  const labels = seatPlan.membersOf(next, groupId).filter((o) => o.kind === 'label')
  const arranged = planEdits.arrange(
    next,
    labels.map((o) => o.id),
    labelBoxesOf(boxes),
  )
  return renumbered(arranged, groupId, numberingOf(row.seats))
}

// The playground's handles on a selected row, drawn and dragged by ichno (`EditorHandles`): one on its last seat —
// drag it to make the row longer or shorter, a seat every pitch, or to swing it round its first seat (Shift keeps its
// direction) — and one on the middle of its arc, to bend it (Shift: steps of 0.05).
export function rowHandles(locked: ReadonlySet<string>): EditorHandles<string> {
  return {
    id: 'row',
    of(plan, item) {
      const row =
        item.kind === 'group' && seatPlan.groupById(plan, item.id)?.role === 'row' ? rowOf(plan, item.id) : null
      if (!row || row.seats.length < 2) return []
      return [
        { name: 'end', point: row.end },
        { name: 'curve', point: apexOf(row) },
      ]
    },
    drag(plan, { owner, name }, { total, constrain }) {
      const row = owner.kind === 'group' ? rowOf(plan, owner.id) : null
      if (!row || row.seats.length < 2) return null
      const chord = distance(row.start, row.end)
      if (name === 'curve') {
        const apex = apexOf(row)
        const left = leftOf(row)
        const bow =
          ((apex.x + total.x - (row.start.x + row.end.x) / 2) * left.x +
            (apex.y + total.y - (row.start.y + row.end.y) / 2) * left.y) /
          (chord / 2)
        const step = constrain ? 0.05 : 0.01
        return relayRow(plan, owner.id, { curve: clamp(Math.round(bow / step) * step, -1, 1) }, locked)
      }
      if (name !== 'end') return null
      const pitch = chord / (row.seats.length - 1)
      const along = { x: (row.end.x - row.start.x) / chord, y: (row.end.y - row.start.y) / chord }
      const pulled = { x: row.end.x + total.x - row.start.x, y: row.end.y + total.y - row.start.y }
      // Shift keeps the row's direction — only how far it reaches changes.
      const reach = constrain ? Math.max(0, pulled.x * along.x + pulled.y * along.y) : Math.hypot(pulled.x, pulled.y)
      const heading = constrain || reach === 0 ? along : { x: pulled.x / reach, y: pulled.y / reach }
      const count = clamp(Math.round(reach / pitch) + 1, 2, ROW_MAX)
      const end = {
        x: row.start.x + heading.x * pitch * (count - 1),
        y: row.start.y + heading.y * pitch * (count - 1),
      }
      return relayRow(plan, owner.id, { count, end }, locked)
    },
  }
}

// The middle of a row's arc — where its curve handle sits.
function apexOf(row: Row): PlanPoint {
  const left = leftOf(row)
  const half = distance(row.start, row.end) / 2
  return {
    x: (row.start.x + row.end.x) / 2 + left.x * row.curve * half,
    y: (row.start.y + row.end.y) / 2 + left.y * row.curve * half,
  }
}

// The way a row bows for a positive curve — left of first seat to last (`layout.arc`).
function leftOf(row: Row): PlanPoint {
  const length = distance(row.start, row.end) || 1
  return { x: (row.end.y - row.start.y) / length, y: -(row.end.x - row.start.x) / length }
}

// The most seats the row handle makes — the inspector's limit too.
const ROW_MAX = 60

// Where a relaid row ends. A single seat has no ends to span — the row grows the way the seat faces, a seat and a
// half apart.
function endOf(row: Row, count: number): PlanPoint {
  if (row.seats.length > 1) return row.end
  const heading = ((row.seats[0]!.rotation ?? 0) * Math.PI) / 180
  const reach = row.size.w * 1.5 * (count - 1)
  return { x: row.start.x + Math.cos(heading) * reach, y: row.start.y + Math.sin(heading) * reach }
}

// A label box LABEL_OFFSET beyond each end seat, along the row.
function labelBoxesOf(seats: readonly PlanBox[]): PlanBox[] {
  const first = seats[0]
  const last = seats.at(-1)
  if (!first || !last) return []
  const beyond = (box: PlanBox, sign: number) => {
    const a = ((box.rotation ?? 0) * Math.PI) / 180
    const c = seatPlan.centerOf(box)
    return {
      x: Math.round(c.x + sign * Math.cos(a) * LABEL_OFFSET - LABEL_SIZE / 2),
      y: Math.round(c.y + sign * Math.sin(a) * LABEL_OFFSET - LABEL_SIZE / 2),
      w: LABEL_SIZE,
      h: LABEL_SIZE,
    }
  }
  return [beyond(first, -1), beyond(last, 1)]
}

// ---------- Tables ----------

// `size` is the first seat's — every seat of a relaid table takes it.
export type Table = { top: Place | Fixture; seats: (Place | Fixture)[]; whole: boolean; size: PlanSize }

// A table read back from its group: the member with the `table` role is the top; booked whole, the top is the
// place and the seats are chairs.
export function tableOf(plan: Plan, groupId: string): Table | null {
  const members = seatPlan.membersOf(plan, groupId).filter((o): o is Place | Fixture => o.kind !== 'label')
  const top = members.find((o) => o.role === 'table')
  if (!top) return null
  const whole = top.kind === 'place'
  const seats = members.filter((o) => o !== top && (whole ? o.kind === 'fixture' : o.kind === 'place'))
  const size = seats[0] ? { w: seats[0].w, h: seats[0].h } : { w: TABLE_SEAT, h: TABLE_SEAT }
  return { top, seats, whole, size }
}

// The table's seats set round it again — another count or shape. Seats numbered or lettered the way the inspector
// does it stay that way, new ones included.
export function relayTable(
  plan: Plan,
  groupId: string,
  change: { count?: number; shape?: Shape },
  locked: ReadonlySet<string>,
): Plan | null {
  const table = tableOf(plan, groupId)
  if (!table || table.seats.length === 0) return null
  const shape = change.shape ?? table.top.shape
  const count = change.count ?? table.seats.length
  const reshaped = replace(plan, { ...table.top, shape, ...(table.whole ? { capacity: count } : {}) })
  const boxes = layout.around({ table: table.top, shape, count, size: table.size })
  const members = table.whole ? { kind: 'fixture' as const, role: 'chair' } : { kind: 'place' as const }
  const next = planEdits.layoutGroup(reshaped, groupId, boxes, members, locked)
  // Booked whole, the seats are chairs — nothing to number.
  return next && renumbered(next, groupId, table.whole ? null : numberingOf(table.seats))
}

// Booked whole: the top becomes the place (holding every seat) and the seats become chairs — or back.
export function setWholeTable(plan: Plan, groupId: string, whole: boolean, locked: ReadonlySet<string>): Plan | null {
  const table = tableOf(plan, groupId)
  if (!table || table.whole === whole) return null
  const seatIds = table.seats.map((o) => o.id)
  if (whole) {
    const section = table.seats.find((o): o is Place => o.kind === 'place')?.section
    const chairs = planEdits.convert(plan, seatIds, 'fixture', { role: 'chair' }, locked)
    return chairs && planEdits.convert(chairs, [table.top.id], 'place', { section, capacity: seatIds.length }, locked)
  }
  const section = table.top.kind === 'place' ? table.top.section : undefined
  const top = planEdits.convert(plan, [table.top.id], 'fixture', {}, locked)
  const seats = top && planEdits.convert(top, seatIds, 'place', { section, role: 'seat' }, locked)
  return seats && planEdits.label(seats, seatIds, labeling.numbers())
}

// ---------- Helpers ----------

// How far (plan units) past a wall's band a tap still puts an opening in it — a cell.
const OPENING_REACH = 50
// How near a wall piece's end comes to a wall's end to meet it there — what a turned piece misses a grid point by.
const PIECE_MEET = 10
// How nearly a piece runs the way the wall comes into its end to carry it on in one edge — within about 1°.
const STRAIGHT_ON = Math.cos((1 * Math.PI) / 180)

// The rectangle a stroke spans, corner to corner.
function rectOf(stroke: PlanStroke): PlanRect {
  return {
    x: Math.min(stroke.start.x, stroke.end.x),
    y: Math.min(stroke.start.y, stroke.end.y),
    w: Math.abs(stroke.end.x - stroke.start.x),
    h: Math.abs(stroke.end.y - stroke.start.y),
  }
}

function around(center: PlanPoint, size: { w: number; h: number }): PlanRect {
  return { x: Math.round(center.x - size.w / 2), y: Math.round(center.y - size.h / 2), ...size }
}

function distance(a: PlanPoint, b: PlanPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// The ways the inspector numbers seats — kept when a row or table grows or shrinks, so new seats are numbered like
// the rest.
const SEAT_NUMBERINGS: LabelSequence[] = [
  labeling.numbers(),
  labeling.numbers({ reverse: true }),
  labeling.numbers({ step: 2 }),
  labeling.letters(),
]

// Which of those the seats follow, in order — null when they are labelled some other way (they keep their labels).
function numberingOf(seats: readonly (Place | Fixture)[]): LabelSequence | null {
  const labels = seats.map((seat) => (seat.kind === 'place' ? seat.label : undefined))
  return SEAT_NUMBERINGS.find((sequence) => labels.every((label, i) => label === sequence(i, labels.length))) ?? null
}

// A group's places labelled again by `numbering`, in their new order and number. The plan as it is without one.
function renumbered(plan: Plan, groupId: string, numbering: LabelSequence | null): Plan {
  if (numbering === null) return plan
  const seats = seatPlan.membersOf(plan, groupId).filter((o) => o.kind === 'place')
  return planEdits.label(
    plan,
    seats.map((o) => o.id),
    numbering,
  )
}

function replace(plan: Plan, object: PlanObject<string>): Plan {
  return { ...plan, objects: plan.objects.map((o) => (o.id === object.id ? object : o)) }
}
