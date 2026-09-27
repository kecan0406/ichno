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
import { planEdits } from 'ichno/editor'

// What the playground's tools build. ichno stores places, fixtures and groups; rows, tables and desks are this
// site's roles, assembled here from `layout` and `planEdits` — the same way an app would write its own tools. Each
// builder takes the stroke the editor hands a tool: a drag sizes the thing, a tap (a stroke with no length) drops
// it at its default size.

type Plan = SeatPlan<string>

const SEAT = 40
// Seat centre to seat centre along a row, and row to row in a block.
const PITCH = 46
const ROW_PITCH = 69
const ROW_SEATS = 7
const BLOCK = { columns: 8, rows: 4 }
const TABLE = 92
const TABLE_SEAT = 36
// Row labels sit one pitch beyond the end seats.
const LABEL_SIZE = 40
const DESK = { w: 88, h: 60 }
const CHAIR = { w: 38, h: 18 }
// The spot one desk with its chair takes in a block of desks.
const DESK_SPOT = { w: 92, h: 92 }
const WALL = 23
// Plan units² per person in a standing area — the default one (276 × 138) holds forty.
const AREA_PER_PERSON = 950

// ---------- Tools ----------

// A row between the stroke's ends, one seat every PITCH from the start — or a default row centred on a tap. The row
// takes the section under its middle; null outside every section (or when its ids would not save).
export function rowTool(plan: Plan, stroke: PlanStroke): Plan | null {
  const length = distance(stroke.start, stroke.end)
  if (length === 0) {
    const half = ((ROW_SEATS - 1) * PITCH) / 2
    const { x, y } = stroke.start
    return rowOn(plan, { x: x - half, y }, { x: x + half, y }, ROW_SEATS)
  }
  const count = Math.floor(length / PITCH) + 1
  const reach = ((count - 1) * PITCH) / length
  const end = {
    x: stroke.start.x + (stroke.end.x - stroke.start.x) * reach,
    y: stroke.start.y + (stroke.end.y - stroke.start.y) * reach,
  }
  return rowOn(plan, stroke.start, end, count)
}

// Rows of seats filling the stroke's rectangle — a seating block, each row its own lettered group. A tap drops four
// rows of eight centred on it.
export function blockTool(plan: Plan, stroke: PlanStroke): Plan | null {
  const box = rectOf(stroke)
  const tap = box.w === 0 && box.h === 0
  const columns = tap ? BLOCK.columns : Math.max(1, Math.floor((box.w - SEAT) / PITCH) + 1)
  const rows = tap ? BLOCK.rows : Math.max(1, Math.floor((box.h - SEAT) / ROW_PITCH) + 1)
  const first = tap
    ? { x: box.x - ((columns - 1) * PITCH) / 2, y: box.y - ((rows - 1) * ROW_PITCH) / 2 }
    : { x: box.x + SEAT / 2, y: box.y + SEAT / 2 }
  let next = plan
  for (let r = 0; r < rows; r++) {
    const y = first.y + r * ROW_PITCH
    const row = rowOn(next, { x: first.x, y }, { x: first.x + (columns - 1) * PITCH, y }, columns)
    if (!row) return null
    next = row
  }
  return next
}

// A round table filling the stroke's rectangle, seats around it — as many as its edge has room for. A tap drops a
// table for six.
export function tableTool(plan: Plan, stroke: PlanStroke): Plan | null {
  const box = rectOf(stroke)
  const tap = box.w < PITCH || box.h < PITCH
  const top = tap ? around(stroke.end, { w: TABLE, h: TABLE }) : box
  const count = tap ? 6 : clamp(Math.round((Math.PI * (top.w + top.h)) / 2 / PITCH), 2, 20)
  const section = seatPlan.sectionAt(plan, seatPlan.centerOf(top))
  if (section === null) return null
  const label = nextLabel(plan, 'table', TABLE_LABELS)
  const { plan: grouped, id } = planEdits.addGroup(plan, { role: 'table', label })
  const withTop = planEdits.addFixtures(grouped, [top], { shape: 'ellipse', role: 'table', group: id }).plan
  const boxes = layout.around({ table: top, shape: 'ellipse', count, size: TABLE_SEAT })
  const seats = planEdits.addPlaces(withTop, section, boxes, { role: 'seat', group: id })
  return seats && planEdits.label(seats.plan, seats.ids, labeling.numbers())
}

// Desks filling the stroke's rectangle, each with its chair below and in a group of its own. A tap drops one desk.
export function deskTool(plan: Plan, stroke: PlanStroke): Plan | null {
  const box = rectOf(stroke)
  const columns = Math.max(1, Math.floor(box.w / DESK_SPOT.w))
  const rows = Math.max(1, Math.floor(box.h / DESK_SPOT.h))
  const tap = box.w < DESK_SPOT.w && box.h < DESK_SPOT.h
  const origin = tap ? { x: stroke.end.x - DESK_SPOT.w / 2, y: stroke.end.y - DESK_SPOT.h / 2 } : box
  const section = seatPlan.sectionAt(plan, {
    x: origin.x + (columns * DESK_SPOT.w) / 2,
    y: origin.y + (rows * DESK_SPOT.h) / 2,
  })
  if (section === null) return null
  let next = plan
  for (let i = 0; i < columns * rows; i++) {
    const spot = { x: origin.x + (i % columns) * DESK_SPOT.w, y: origin.y + Math.floor(i / columns) * DESK_SPOT.h }
    const group = planEdits.addGroup(next, { role: 'desk' })
    const top = { x: spot.x + 2, y: spot.y + 2, ...DESK }
    const desk = planEdits.addPlaces(group.plan, section, [top], { shape: 'rect', role: 'desk', group: group.id })
    if (!desk) return null
    const chair = { x: spot.x + (DESK_SPOT.w - CHAIR.w) / 2, y: top.y + DESK.h + 6, ...CHAIR }
    next = planEdits.addFixtures(desk.plan, [chair], { role: 'chair', group: group.id }).plan
  }
  return next
}

// A booth or a standing area — a rectangular place drawn at any size, or dropped at its default one. An area holds
// people in proportion to its floor.
export function boxPlaceTool(role: 'booth' | 'area') {
  const size = role === 'booth' ? { w: 184, h: 138 } : { w: 276, h: 138 }
  return (plan: Plan, stroke: PlanStroke): Plan | null => {
    const drawn = rectOf(stroke)
    const box = drawn.w < PITCH / 2 || drawn.h < PITCH / 2 ? around(stroke.end, size) : drawn
    const section = seatPlan.sectionAt(plan, seatPlan.centerOf(box))
    if (section === null) return null
    const capacity = role === 'area' ? Math.max(1, Math.round((box.w * box.h) / AREA_PER_PERSON)) : 1
    return planEdits.addPlaces(plan, section, [box], { shape: 'rect', role, capacity })?.plan ?? null
  }
}

// A bare place — ichno's bookable primitive, with no role — drawn at any size, or a seat-sized one dropped with a tap.
// What it is for (a role, a capacity, a category) is set in Design afterwards.
export function placeTool(plan: Plan, stroke: PlanStroke): Plan | null {
  const drawn = rectOf(stroke)
  const box = drawn.w < PITCH / 2 || drawn.h < PITCH / 2 ? around(stroke.end, { w: SEAT, h: SEAT }) : drawn
  const section = seatPlan.sectionAt(plan, seatPlan.centerOf(box))
  if (section === null) return null
  return planEdits.addPlaces(plan, section, [box], { shape: 'rect', capacity: 1 })?.plan ?? null
}

// A fixture of the site's `role` — drawn as a box, or (walls) along a line; a tap drops it at its default size.
export function fixtureTool(role: string | undefined, size: { w: number; h: number }, along: boolean) {
  return (plan: Plan, stroke: PlanStroke): Plan => {
    const length = distance(stroke.start, stroke.end)
    const drawn = rectOf(stroke)
    const box = along
      ? length === 0
        ? around(stroke.end, size)
        : wallOf(stroke, length)
      : drawn.w < PITCH / 2 || drawn.h < PITCH / 2
        ? around(stroke.end, size)
        : drawn
    return planEdits.addFixtures(plan, [box], { role }).plan
  }
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

// The row laid out again between the same ends — with another seat count or curve. Its labels follow its ends, and
// seats numbered the way the inspector numbers them stay numbered that way, new ones included.
export function relayRow(
  plan: Plan,
  groupId: string,
  change: { count?: number; curve?: number },
  locked: ReadonlySet<string>,
): Plan | null {
  const row = rowOf(plan, groupId)
  if (!row) return null
  const count = change.count ?? row.seats.length
  const boxes = layout.arc({
    start: row.start,
    end: endOf(row, count),
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

// Where a relaid row ends. A single seat has no ends to span — the row grows the way the seat faces, a seat and a
// fifth apart.
function endOf(row: Row, count: number): PlanPoint {
  if (row.seats.length > 1) return row.end
  const heading = ((row.seats[0]!.rotation ?? 0) * Math.PI) / 180
  const reach = row.size.w * 1.2 * (count - 1)
  return { x: row.start.x + Math.cos(heading) * reach, y: row.start.y + Math.sin(heading) * reach }
}

// A lettered row of `count` seats from `start` to `end` (seat centres), numbered from the start, its letter at both
// ends. The section under its middle holds it.
function rowOn(plan: Plan, start: PlanPoint, end: PlanPoint, count: number): Plan | null {
  const section = seatPlan.sectionAt(plan, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 })
  if (section === null) return null
  const label = nextLabel(plan, 'row', ROW_LABELS)
  const { plan: grouped, id } = planEdits.addGroup(plan, { role: 'row', label })
  const boxes = layout.line({ start, end, count, size: SEAT })
  const seats = planEdits.addPlaces(grouped, section, boxes, { role: 'seat', group: id })
  if (!seats) return null
  const numbered = planEdits.label(seats.plan, seats.ids, labeling.numbers())
  return planEdits.addLabels(numbered, id, labelBoxesOf(boxes)).plan
}

// A label box one pitch beyond each end seat, along the row.
function labelBoxesOf(seats: readonly PlanBox[]): PlanBox[] {
  const first = seats[0]
  const last = seats.at(-1)
  if (!first || !last) return []
  const beyond = (box: PlanBox, sign: number) => {
    const a = ((box.rotation ?? 0) * Math.PI) / 180
    const c = seatPlan.centerOf(box)
    return {
      x: Math.round(c.x + sign * Math.cos(a) * PITCH - LABEL_SIZE / 2),
      y: Math.round(c.y + sign * Math.sin(a) * PITCH - LABEL_SIZE / 2),
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

// The rectangle a stroke spans, corner to corner.
function rectOf(stroke: PlanStroke): PlanRect {
  return {
    x: Math.min(stroke.start.x, stroke.end.x),
    y: Math.min(stroke.start.y, stroke.end.y),
    w: Math.abs(stroke.end.x - stroke.start.x),
    h: Math.abs(stroke.end.y - stroke.start.y),
  }
}

// A wall from the stroke's start to its end — a thin box along the line, turned to it.
function wallOf(stroke: PlanStroke, length: number): PlanBox {
  const middle = { x: (stroke.start.x + stroke.end.x) / 2, y: (stroke.start.y + stroke.end.y) / 2 }
  const angle = (Math.atan2(stroke.end.y - stroke.start.y, stroke.end.x - stroke.start.x) * 180) / Math.PI
  return { ...around(middle, { w: Math.round(length), h: WALL }), rotation: ((angle % 360) + 360) % 360 }
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

// What new rows and tables are called — rows A, B, C… (no I or O, which read as 1 and 0), tables T1, T2…
const ROW_LABELS = labeling.letters({ skip: ['I', 'O'] })
const TABLE_LABELS = labeling.numbers({ prefix: 'T' })

// The label after the furthest one groups of `role` already use — counting them would hand out a label twice once
// one was deleted (rows A, B, C, then B deleted: the next is D, not a second C). Labels outside the sequence are
// someone's own names and are passed over.
function nextLabel(plan: Plan, role: string, sequence: LabelSequence): string {
  const used = new Set(plan.groups.flatMap((g) => (g.role === role && g.label !== undefined ? [g.label] : [])))
  let next = 0
  for (let i = 0, found = 0; found < used.size && i < LABEL_SEARCH; i++) {
    if (!used.has(sequence(i, i + 1))) continue
    next = i + 1
    found++
  }
  return sequence(next, next + 1)
}

// How far into a sequence `nextLabel` looks for labels in use.
const LABEL_SEARCH = 1000

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
