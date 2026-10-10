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
  type Wall,
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
// piece by piece, under the pointer (`pieceAt`). Carried on from a wall's end it joins that wall; an end that comes to
// a wall's end meets it, which links the two or closes a room (`planEdits.buildWall`). null where a wall runs already
// or off the plan.
export function wallPieceTool(thickness: number, degrees: number) {
  return (plan: Plan, stroke: PlanStroke): Plan | null => {
    const placed = pieceAt(plan, stroke.end, degrees)

    return planEdits.buildWall(placed.plan, { points: placed.points, thickness })?.plan ?? null
  }
}

// Why a wall piece cannot go where the pointer is.
export function wallPieceRefusal(plan: Plan, at: PlanPoint, degrees: number): 'outside' | 'taken' {
  const { points } = pieceAt(plan, at, degrees)

  return points.some((p) => p.x < 0 || p.y < 0 || p.x > plan.width || p.y > plan.height) ? 'outside' : 'taken'
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

// A wall's end a piece is run from, the corner before it, and whether the piece runs straight on.
type Hinge = { wall: Wall; index: number; neighbour: PlanPoint }

// A wall piece where it goes, and the plan it goes into.
type PlacedPiece = { plan: Plan; points: [PlanPoint, PlanPoint] }

// Where a wall piece for the pointer at `at` runs, so it lies under the pointer: hinged on the end of a wall when the
// pointer is over where a piece from that end (or into it) would run — within half a metre of it — and otherwise, level
// or upright, on the metre of grid line under the pointer, or at another turn centred on it. A piece is a metre to a
// hundredth of a unit, however it is turned. When its far end comes to a wall's end it meets it there and stays a
// metre: the corner it is run from moves to where both it and the edge into that corner keep their lengths (a free
// piece moves whole). That is how a room of turned pieces closes with every edge a whole metre. The plan comes back
// with that corner moved.
function pieceAt(plan: Plan, at: PlanPoint, degrees: number): PlacedPiece {
  const a = (degrees * Math.PI) / 180
  const d = { x: tidy(Math.cos(a)), y: tidy(Math.sin(a)) }
  const hinged = hingedAt(plan, at, d)
  const [from, to] = hinged?.piece ?? freeAt(at, d)
  const meet = wallEndNear(plan, to, PIECE_MEET)

  if (meet === null || samePoint(meet, from) || (hinged && samePoint(meet, hinged.hinge.neighbour)))
    return { plan, points: [from, to] }

  if (!hinged) {
    const back = unit(meet, from)

    return { plan, points: [{ x: meet.x + back.x * WALL_STEP, y: meet.y + back.y * WALL_STEP }, meet] }
  }

  const { wall, index, neighbour } = hinged.hinge
  const corner = crossing(neighbour, distance(neighbour, from), meet, WALL_STEP, from)

  if (corner === null || distance(corner, from) > FIT_REACH) return { plan, points: [from, to] }

  const moved = planEdits.reshapeWall(
    plan,
    wall.id,
    wall.points.map((p, i) => (i === index ? corner : p)),
  )

  return { plan: moved, points: [corner, meet] }
}

// A piece run from — or into — the end of an open wall, for a pointer over where it would lie; the nearest such. Run
// straight on, it lengthens the wall's last edge to the next whole metre from that edge's start. `piece` runs from the
// hinge to the far end.
function hingedAt(plan: Plan, at: PlanPoint, d: PlanPoint): { piece: [PlanPoint, PlanPoint]; hinge: Hinge } | null {
  let best: { piece: [PlanPoint, PlanPoint]; hinge: Hinge; distance: number } | null = null

  for (const wall of plan.walls) {
    if (wall.closed || wall.points.length < 2) continue
    const last = wall.points.length - 1

    for (const [index, before] of [
      [0, 1],
      [last, last - 1],
    ] as const) {
      const end = wall.points[index]!
      const neighbour = wall.points[before]!
      const along = (at.x - end.x) * d.x + (at.y - end.y) * d.y
      const across = Math.abs((at.x - end.x) * -d.y + (at.y - end.y) * d.x)

      if (across > WALL_STEP / 2 || Math.abs(along) > WALL_STEP) continue
      // The way from the end to the piece's far end, and the way the wall comes into the end.
      const away = along >= 0 ? d : { x: -d.x, y: -d.y }
      const edge = distance(neighbour, end)
      const into = unit(neighbour, end)
      const straight = away.x * into.x + away.y * into.y > STRAIGHT_ON

      const far = straight
        ? {
            x: neighbour.x + into.x * (Math.round(edge / WALL_STEP) * WALL_STEP + WALL_STEP),
            y: neighbour.y + into.y * (Math.round(edge / WALL_STEP) * WALL_STEP + WALL_STEP),
          }
        : { x: end.x + away.x * WALL_STEP, y: end.y + away.y * WALL_STEP }

      const piece: [PlanPoint, PlanPoint] = [end, far]

      // Not back along the wall it ends.
      if (alongAWall(plan, end, far)) continue
      const middle = { x: (end.x + far.x) / 2, y: (end.y + far.y) / 2 }
      const off = Math.hypot(at.x - middle.x, at.y - middle.y)

      if (best === null || off < best.distance) best = { piece, hinge: { wall, index, neighbour }, distance: off }
    }
  }

  return best && { piece: best.piece, hinge: best.hinge }
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

  return [start, { x: start.x + d.x * WALL_STEP, y: start.y + d.y * WALL_STEP }]
}

// Where a circle `r1` round `c1` and one `r2` round `c2` cross, the crossing nearer `near` — null where they do not.
function crossing(c1: PlanPoint, r1: number, c2: PlanPoint, r2: number, near: PlanPoint): PlanPoint | null {
  const apart = distance(c1, c2)

  if (apart === 0 || apart > r1 + r2 || apart < Math.abs(r1 - r2)) return null
  const a = (r1 * r1 - r2 * r2 + apart * apart) / (2 * apart)
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a))
  const u = unit(c1, c2)
  const base = { x: c1.x + u.x * a, y: c1.y + u.y * a }
  const one = { x: base.x - u.y * h, y: base.y + u.x * h }
  const other = { x: base.x + u.y * h, y: base.y - u.x * h }

  return distance(one, near) <= distance(other, near) ? one : other
}

function unit(from: PlanPoint, to: PlanPoint): PlanPoint {
  const length = distance(from, to) || 1

  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

function samePoint(a: PlanPoint, b: PlanPoint): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01
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

    if (isRefusal(spot)) return null

    return planEdits.addOpening(plan, spot.wall, { ...spot.opening, role })
  }
}

// Why an opening cannot go where the pointer is — `seatPlan.openingAt`'s answer.
export function openingRefusal(plan: Plan, at: PlanPoint, width: number): OpeningRefusal | null {
  const spot = seatPlan.openingAt(plan, at, width, OPENING_REACH)

  return isRefusal(spot) ? spot : null
}

// What `seatPlan.openingAt` answers instead of a spot: no wall near enough, an edge too short, an opening there.
type OpeningRefusal = 'far' | 'short' | 'taken'

function isRefusal(spot: ReturnType<typeof seatPlan.openingAt>): spot is OpeningRefusal {
  return spot === 'far' || spot === 'short' || spot === 'taken'
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
  const top = { ...table.top, shape }

  // Booked whole, the top is the place, and holds every seat.
  if (top.kind === 'place') top.capacity = count
  const reshaped = replace(plan, top)
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

// How far the corner a piece is run from may move so the piece meets a wall's end and stays a metre.
const FIT_REACH = 20

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
