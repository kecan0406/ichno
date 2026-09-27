import {
  GRID_CELL,
  labeling,
  layout,
  seatPlan,
  type Fixture,
  type Place,
  type PlanBox,
  type PlanObject,
  type PlanPoint,
  type SeatPlan,
  type Shape,
} from 'ichno'
import { planEdits } from 'ichno/editor'

// What the playground's tools build. ichno stores places, fixtures and groups; rows, tables and desks are this
// site's roles, assembled here from `layout` and `planEdits` — the same way an app would write its own tools.

type Plan = SeatPlan<string>
export type Placing = 'row' | 'table' | 'desk' | 'booth' | 'area'
export type Made = { plan: Plan; select: { kind: 'group' | 'object'; id: string } }

const ROW_SEATS = 7
const ROW_HALF = 138
const SEAT = 40
const TABLE = 92
const TABLE_SEAT = 36
// Row labels sit one cell beyond the end seats.
const LABEL_REACH = GRID_CELL
const LABEL_SIZE = 40

// A new row, table, desk, booth or area centred on `at`. null when its ids would not save.
export function placeAt(plan: Plan, kind: Placing, section: string, at: PlanPoint): Made | null {
  switch (kind) {
    case 'row': {
      const label = labeling.letters({ skip: ['I', 'O'] })(groupsWithRole(plan, 'row'), 1)
      const { plan: grouped, id } = planEdits.addGroup(plan, { role: 'row', label })
      const boxes = layout.line({
        start: { x: at.x - ROW_HALF, y: at.y },
        end: { x: at.x + ROW_HALF, y: at.y },
        count: ROW_SEATS,
        size: SEAT,
      })
      const seats = planEdits.addPlaces(grouped, section, boxes, { role: 'seat', group: id })
      if (!seats) return null
      const numbered = planEdits.label(seats.plan, seats.ids, labeling.numbers())
      return { plan: planEdits.addLabels(numbered, id, labelBoxesOf(boxes)).plan, select: { kind: 'group', id } }
    }
    case 'table': {
      const label = `T${groupsWithRole(plan, 'table') + 1}`
      const { plan: grouped, id } = planEdits.addGroup(plan, { role: 'table', label })
      const top = { x: at.x - TABLE / 2, y: at.y - TABLE / 2, w: TABLE, h: TABLE }
      const withTop = planEdits.addFixtures(grouped, [top], { shape: 'ellipse', role: 'table', group: id }).plan
      const boxes = layout.around({ table: top, shape: 'ellipse', count: 6, size: TABLE_SEAT })
      const seats = planEdits.addPlaces(withTop, section, boxes, { role: 'seat', group: id })
      if (!seats) return null
      return { plan: planEdits.label(seats.plan, seats.ids, labeling.numbers()), select: { kind: 'group', id } }
    }
    case 'desk': {
      const { plan: grouped, id } = planEdits.addGroup(plan, { role: 'desk' })
      const top = { x: at.x - 44, y: at.y - 30, w: 88, h: 60 }
      const withTop = planEdits.addPlaces(grouped, section, [top], { shape: 'rect', role: 'desk', group: id })
      if (!withTop) return null
      const chair = { x: at.x - 19, y: at.y + 36, w: 38, h: 18 }
      return {
        plan: planEdits.addFixtures(withTop.plan, [chair], { role: 'chair', group: id }).plan,
        select: { kind: 'group', id },
      }
    }
    case 'booth':
    case 'area': {
      const box = kind === 'booth' ? { w: 184, h: 138 } : { w: 276, h: 138 }
      const added = planEdits.addPlaces(plan, section, [{ x: at.x - box.w / 2, y: at.y - box.h / 2, ...box }], {
        shape: 'rect',
        role: kind,
        capacity: kind === 'area' ? 40 : 1,
      })
      return added ? { plan: added.plan, select: { kind: 'object', id: added.ids[0]! } } : null
    }
  }
}

// A fixture of the site's `role` centred on `at`.
export function fixtureAt(plan: Plan, role: string, size: { w: number; h: number }, at: PlanPoint): Made {
  const box = { x: at.x - size.w / 2, y: at.y - size.h / 2, ...size }
  const added = planEdits.addFixtures(plan, [box], { role })
  return { plan: added.plan, select: { kind: 'object', id: added.ids[0]! } }
}

// ---------- Rows ----------

export type Row = { seats: Place[]; start: PlanPoint; end: PlanPoint; curve: number; size: number }

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
    size: Math.min(seats[0]!.w, seats[0]!.h),
  }
}

// The row laid out again between the same ends — with another seat count or curve. Its labels follow its ends.
export function relayRow(
  plan: Plan,
  groupId: string,
  change: { count?: number; curve?: number },
  locked: ReadonlySet<string>,
): Plan | null {
  const row = rowOf(plan, groupId)
  if (!row) return null
  const count = change.count ?? row.seats.length
  // A single seat has no ends to span — grow it along the row's direction, one seat apart.
  const end = row.seats.length === 1 ? { x: row.start.x + row.size * 1.2 * (count - 1), y: row.start.y } : row.end
  const boxes = layout.arc({ start: row.start, end, curve: change.curve ?? row.curve, count, size: row.size })
  const next = planEdits.layoutGroup(plan, groupId, boxes, { kind: 'place' }, locked)
  if (!next) return null
  const labels = seatPlan.membersOf(next, groupId).filter((o) => o.kind === 'label')
  return planEdits.arrange(
    next,
    labels.map((o) => o.id),
    labelBoxesOf(boxes),
  )
}

// A label box one cell beyond each end seat, along the row.
function labelBoxesOf(seats: readonly PlanBox[]): PlanBox[] {
  const first = seats[0]
  const last = seats.at(-1)
  if (!first || !last) return []
  const beyond = (box: PlanBox, sign: number) => {
    const a = ((box.rotation ?? 0) * Math.PI) / 180
    const c = seatPlan.centerOf(box)
    return {
      x: Math.round(c.x + sign * Math.cos(a) * LABEL_REACH - LABEL_SIZE / 2),
      y: Math.round(c.y + sign * Math.sin(a) * LABEL_REACH - LABEL_SIZE / 2),
      w: LABEL_SIZE,
      h: LABEL_SIZE,
    }
  }
  return [beyond(first, -1), beyond(last, 1)]
}

// ---------- Tables ----------

export type Table = { top: Place | Fixture; seats: (Place | Fixture)[]; whole: boolean; size: number }

// A table read back from its group: the member with the `table` role is the top; booked whole, the top is the
// place and the seats are chairs.
export function tableOf(plan: Plan, groupId: string): Table | null {
  const members = seatPlan.membersOf(plan, groupId).filter((o): o is Place | Fixture => o.kind !== 'label')
  const top = members.find((o) => o.role === 'table')
  if (!top) return null
  const whole = top.kind === 'place'
  const seats = members.filter((o) => o !== top && (whole ? o.kind === 'fixture' : o.kind === 'place'))
  return { top, seats, whole, size: seats[0] ? Math.min(seats[0].w, seats[0].h) : TABLE_SEAT }
}

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
  return planEdits.layoutGroup(reshaped, groupId, boxes, members, locked)
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

function groupsWithRole(plan: Plan, role: string): number {
  return plan.groups.filter((group) => group.role === role).length
}

function replace(plan: Plan, object: PlanObject<string>): Plan {
  return { ...plan, objects: plan.objects.map((o) => (o.id === object.id ? object : o)) }
}
