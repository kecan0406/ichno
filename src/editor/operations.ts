import { OBJECT_ID_MAX, PLACE_ID_MAX, seatPlan } from '../core/geometry'
import { DEFAULT_SEAT_CELLS, GRID_CELL, HALF_CELL, seatGrid } from '../core/grid'
import type { LabelSequence } from '../core/labeling'
import { planHandles } from './handles'
import type {
  AreaShape,
  PlanDrag,
  PlanObject,
  PlanPoint,
  PlanRect,
  PlanSize,
  SeatPlan,
  Section,
  TableShape,
} from '../core/types'

// Editor operations as pure functions — plan in, plan out. The hook keeps history and selection around them;
// keeping them pure makes each rule testable and lets consumers run them outside React (imports, scripts).
// Ids other records reference (`locked`) are never deleted or renamed, and no operation creates an id the schema
// would refuse (place ids stay within PLACE_ID_MAX); operations that would do either refuse and return null.

export const DEFAULT_ROW_SEAT_SIZE = 40
export const DEFAULT_TABLE_SEAT_SIZE = 36
export const DEFAULT_TABLE_SIZE = 92

export type AlignEdge = 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y'
export type Added<S extends string> = { plan: SeatPlan<S>; id: string }

export const planEdits = {
  addDesk,
  addFixture,
  addRow,
  addTable,
  addBooth,
  addArea,
  setSeatCount,
  labelSeats,
  labelObjects,
  align,
  distribute,
  duplicate,
  remove,
  rename,
  rotateDesk,
  move,
  moveSection,
  reshapeSection,
  applyDrag,
  isLocked,
}

// A standard desk (2×2 cells) at the section's first free cell. null when the section has no free 2×2 spot.
function addDesk<S extends string>(plan: SeatPlan<S>, section: S): Added<S> | null {
  const pos = seatPlan.findFreeDeskPos(plan, section)
  const [id] = placeIds(plan, section, 1) ?? []
  if (!pos || !id) return null
  const span = seatGrid.seatSpanPxOf(DEFAULT_SEAT_CELLS)
  return append(plan, { kind: 'desk', id, section, ...pos, w: span, h: span, chairSide: 'down' })
}

// A fixture of the consumer's `role` in the first spot clear of every object — under everything else, since
// object order is drawing order. null when the plan has no room.
function addFixture<S extends string>(plan: SeatPlan<S>, role: string, size: PlanSize): Added<S> | null {
  const pos = seatPlan.findFreeFixturePos(plan, size)
  if (!pos) return null
  const id = seatPlan.nextObjectId(plan, role)
  return { plan: { ...plan, objects: [{ kind: 'fixture', id, role, ...pos, ...size }, ...plan.objects] }, id }
}

// A row of `seats` places from `start` to `end` (snapped to half cells). Seat ids continue the section's
// numbering; labels are left to `labelSeats`.
function addRow<S extends string>(
  plan: SeatPlan<S>,
  section: S,
  row: { start: PlanPoint; end: PlanPoint; seats: number; curve?: number; seatSize?: number },
): Added<S> | null {
  const seatIds = placeIds(plan, section, row.seats)
  if (!seatIds) return null
  return append(plan, {
    kind: 'row',
    id: seatPlan.nextObjectId(plan, 'row'),
    section,
    start: snapHalf(row.start),
    end: snapHalf(row.end),
    curve: row.curve ?? 0,
    seatSize: row.seatSize ?? DEFAULT_ROW_SEAT_SIZE,
    seats: seatIds.map((seatId) => ({ id: seatId })),
  })
}

// A table centred on `center` with `seats` places around it.
function addTable<S extends string>(
  plan: SeatPlan<S>,
  section: S,
  table: { center: PlanPoint; seats: number; shape?: TableShape; size?: PlanSize; seatSize?: number },
): Added<S> | null {
  const size = table.size ?? { w: DEFAULT_TABLE_SIZE, h: DEFAULT_TABLE_SIZE }
  const origin = snapHalf({ x: table.center.x - size.w / 2, y: table.center.y - size.h / 2 })
  const [id, ...seatIds] = placeIds(plan, section, table.seats + 1) ?? []
  if (!id) return null
  return append(plan, {
    kind: 'table',
    id,
    section,
    shape: table.shape ?? 'round',
    ...origin,
    ...size,
    seatSize: table.seatSize ?? DEFAULT_TABLE_SEAT_SIZE,
    seats: seatIds.map((seatId) => ({ id: seatId })),
  })
}

function addBooth<S extends string>(plan: SeatPlan<S>, section: S, rect: PlanRect): Added<S> | null {
  const [id] = placeIds(plan, section, 1) ?? []
  return id ? append(plan, { kind: 'booth', id, section, ...snapRect(rect) }) : null
}

function addArea<S extends string>(
  plan: SeatPlan<S>,
  section: S,
  area: { rect: PlanRect; capacity: number; shape?: AreaShape },
): Added<S> | null {
  const [id] = placeIds(plan, section, 1) ?? []
  if (!id) return null
  return append(plan, {
    kind: 'area',
    id,
    section,
    shape: area.shape ?? 'rect',
    ...snapRect(area.rect),
    capacity: area.capacity,
  })
}

// Grows or shrinks a row's or table's seat list. A row keeps its length (seats spread closer or wider, as in
// Seats.io); new seats continue the section numbering; seats are removed from the end. null when a removed seat
// is locked, or when the object has no seats.
function setSeatCount<S extends string>(
  plan: SeatPlan<S>,
  id: string,
  count: number,
  locked: ReadonlySet<string> = NONE,
): SeatPlan<S> | null {
  const object = seatPlan.objectById(plan, id)
  if (!object || (object.kind !== 'row' && object.kind !== 'table') || count < 1) return null
  const seats = object.seats
  if (count < seats.length) {
    if (seats.slice(count).some((seat) => locked.has(seat.id))) return null
    return replace(plan, { ...object, seats: seats.slice(0, count) })
  }
  const added = placeIds(plan, object.section, count - seats.length)
  if (!added) return null
  return replace(plan, { ...object, seats: [...seats, ...added.map((seatId) => ({ id: seatId }))] })
}

// Labels the seats of a row or table in their order.
function labelSeats<S extends string>(plan: SeatPlan<S>, id: string, sequence: LabelSequence): SeatPlan<S> {
  const object = seatPlan.objectById(plan, id)
  if (!object || (object.kind !== 'row' && object.kind !== 'table')) return plan
  const count = object.seats.length
  return replace(plan, { ...object, seats: object.seats.map((seat, i) => ({ ...seat, label: sequence(i, count) })) })
}

// Labels objects in the given order — rows (their row label), desks, booths, areas and tables.
function labelObjects<S extends string>(
  plan: SeatPlan<S>,
  ids: readonly string[],
  sequence: LabelSequence,
): SeatPlan<S> {
  const labels = new Map(ids.map((id, i) => [id, sequence(i, ids.length)]))
  return {
    ...plan,
    objects: plan.objects.map((object) => {
      const label = labels.get(object.id)
      return label === undefined || object.kind === 'fixture' ? object : { ...object, label }
    }),
  }
}

// Lines objects up on one edge or centre line of their combined footprint.
function align<S extends string>(plan: SeatPlan<S>, ids: readonly string[], edge: AlignEdge): SeatPlan<S> {
  const targets = objectsOf(plan, ids)
  if (targets.length < 2) return plan
  const boxes = targets.map((object) => seatPlan.footprintOf(object))
  const left = Math.min(...boxes.map((b) => b.x))
  const right = Math.max(...boxes.map((b) => b.x + b.w))
  const top = Math.min(...boxes.map((b) => b.y))
  const bottom = Math.max(...boxes.map((b) => b.y + b.h))
  return moveEach(plan, targets, (b) => {
    switch (edge) {
      case 'left':
        return { x: left - b.x, y: 0 }
      case 'right':
        return { x: right - (b.x + b.w), y: 0 }
      case 'top':
        return { x: 0, y: top - b.y }
      case 'bottom':
        return { x: 0, y: bottom - (b.y + b.h) }
      case 'center-x':
        return { x: (left + right) / 2 - (b.x + b.w / 2), y: 0 }
      case 'center-y':
        return { x: 0, y: (top + bottom) / 2 - (b.y + b.h / 2) }
    }
  })
}

// Spreads objects so their centres are evenly spaced between the first and the last along the axis.
function distribute<S extends string>(plan: SeatPlan<S>, ids: readonly string[], axis: 'x' | 'y'): SeatPlan<S> {
  const targets = objectsOf(plan, ids)
  if (targets.length < 3) return plan
  const centerOf = (object: PlanObject<S>) => {
    const b = seatPlan.footprintOf(object)
    return axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2
  }
  const ordered = [...targets].sort((a, b) => centerOf(a) - centerOf(b))
  const first = centerOf(ordered[0]!)
  const step = (centerOf(ordered.at(-1)!) - first) / (ordered.length - 1)
  const wanted = new Map(ordered.map((object, i) => [object.id, first + step * i]))
  return moveEach(plan, ordered, (b, object) => {
    const delta = wanted.get(object.id)! - centerOf(object)
    return axis === 'x' ? { x: delta, y: 0 } : { x: 0, y: delta }
  })
}

// Copies objects one desk step to the right and down, with fresh ids (places continue their section numbering,
// labels are copied). Returns the copies' ids in order; an object whose fresh ids would be too long is skipped.
function duplicate<S extends string>(
  plan: SeatPlan<S>,
  ids: readonly string[],
  offset: PlanPoint = DUPLICATE_OFFSET,
): { plan: SeatPlan<S>; ids: string[] } {
  let next = plan
  const created: string[] = []
  for (const object of objectsOf(plan, ids)) {
    const copy = withFreshIds(next, seatPlan.translate(object, offset.x, offset.y))
    if (!copy) continue
    next = { ...next, objects: [...next.objects, copy] }
    created.push(copy.id)
  }
  return { plan: next, ids: created }
}

// Removes objects, skipping any that hold a locked id. Returns the plan and the ids it refused to remove.
function remove<S extends string>(
  plan: SeatPlan<S>,
  ids: readonly string[],
  locked: ReadonlySet<string> = NONE,
): { plan: SeatPlan<S>; refused: string[] } {
  const wanted = new Set(ids)
  const refused = plan.objects.filter((o) => wanted.has(o.id) && isLocked(o, locked)).map((o) => o.id)
  const removed = new Set(ids.filter((id) => !refused.includes(id)))
  return { plan: { ...plan, objects: plan.objects.filter((o) => !removed.has(o.id)) }, refused }
}

// Changes an id — an object's or a seat's inside a row or table (for places, the key other records reference).
// null when the id does not exist, is locked, is taken, or would not save (blank, too long).
function rename<S extends string>(
  plan: SeatPlan<S>,
  id: string,
  nextId: string,
  locked: ReadonlySet<string> = NONE,
): SeatPlan<S> | null {
  const trimmed = nextId.trim()
  if (trimmed !== nextId || trimmed.length === 0 || locked.has(id)) return null
  const ids = seatPlan.idsOf(plan)
  if (!ids.includes(id) || (nextId !== id && ids.includes(nextId))) return null
  const object = seatPlan.objectById(plan, id)
  const isPlace = !object || (object.kind !== 'row' && object.kind !== 'fixture')
  if (nextId.length > (isPlace ? PLACE_ID_MAX : OBJECT_ID_MAX)) return null
  return {
    ...plan,
    objects: plan.objects.map((o) => {
      if (o.id === id) return { ...o, id: nextId }
      if (o.kind !== 'row' && o.kind !== 'table') return o
      if (!o.seats.some((seat) => seat.id === id)) return o
      return { ...o, seats: o.seats.map((seat) => (seat.id === id ? { ...seat, id: nextId } : seat)) }
    }),
  }
}

// Turns a desk's chair one edge clockwise.
function rotateDesk<S extends string>(plan: SeatPlan<S>, id: string): SeatPlan<S> {
  return {
    ...plan,
    objects: plan.objects.map((o) =>
      o.id === id && o.kind === 'desk' ? { ...o, chairSide: seatPlan.nextChairSide(o.chairSide) } : o,
    ),
  }
}

// Moves an object so its top-left (a row: its start point) lands on `to`, snapped to its grid and kept inside
// the plan. A desk also moves to the section its centre lands in.
function move<S extends string>(plan: SeatPlan<S>, id: string, to: PlanPoint): SeatPlan<S> {
  return { ...plan, objects: plan.objects.map((o) => (o.id === id ? movedObject(plan, o, to) : o)) }
}

// Moves a section outline by whole cells (the delta is rounded to cells).
function moveSection<S extends string>(plan: SeatPlan<S>, id: S, delta: PlanPoint): SeatPlan<S> {
  return { ...plan, sections: plan.sections.map((s) => (s.id === id ? movedSection(plan, s, delta) : s)) }
}

// Replaces a section outline (e.g. after resizing), snapped to cell corners.
function reshapeSection<S extends string>(plan: SeatPlan<S>, id: S, points: readonly PlanPoint[]): SeatPlan<S> {
  return {
    ...plan,
    sections: plan.sections.map((s) =>
      s.id === id ? { ...s, points: points.map((p) => seatGrid.snapPoint(plan, p)) } : s,
    ),
  }
}

// The plan with a drag applied — a handle reshapes its owner, a section moves by whole cells, objects by the drag
// total from where they are. When the dragged object is part of `group` (the selection), the whole group moves.
function applyDrag<S extends string>(plan: SeatPlan<S>, drag: PlanDrag<S>, group: readonly string[] = []): SeatPlan<S> {
  const { target, total } = drag
  if (target.kind === 'section') return moveSection(plan, target.id, total)
  if (target.kind === 'handle') return planHandles.drag(plan, target.owner, target.name, total)
  const id = target.kind === 'place' ? target.objectId : target.id
  const moving = new Set(group.includes(id) ? group : [id])
  return {
    ...plan,
    objects: plan.objects.map((o) => {
      if (!moving.has(o.id)) return o
      const from = o.kind === 'row' ? o.start : o
      return movedObject(plan, o, { x: from.x + total.x, y: from.y + total.y })
    }),
  }
}

// Whether an object holds an id other records reference — its own, or one of its seats'.
function isLocked(object: PlanObject<string>, locked: ReadonlySet<string>): boolean {
  if (locked.has(object.id)) return true
  return (object.kind === 'row' || object.kind === 'table') && object.seats.some((seat) => locked.has(seat.id))
}

function movedObject<S extends string>(plan: SeatPlan<S>, object: PlanObject<S>, to: PlanPoint): PlanObject<S> {
  if (object.kind === 'desk') {
    const pos = seatGrid.placeSeat(plan, object, to)
    const section = seatPlan.sectionAt(plan, { x: pos.x + object.w / 2, y: pos.y + object.h / 2 }) ?? object.section
    return { ...object, ...pos, section }
  }
  if (object.kind === 'fixture') return { ...object, ...seatGrid.placeFixture(plan, object, to) }
  // Rows, tables, booths and areas snap to half cells and are pushed back inside the plan by whole half cells —
  // by everything they draw (a table's seats, a row's far end), not just their origin.
  const from = object.kind === 'row' ? object.start : object
  const moved = seatPlan.translate(object, roundTo(to.x, HALF_CELL) - from.x, roundTo(to.y, HALF_CELL) - from.y)
  const b = seatPlan.boundsOf(moved)
  return seatPlan.translate(moved, inward(b.x, b.w, plan.width), inward(b.y, b.h, plan.height))
}

// The half-cell shift that brings [start, start + size] inside [0, extent] (the start wins when it cannot fit).
function inward(start: number, size: number, extent: number): number {
  if (start < 0) return Math.ceil(-start / HALF_CELL) * HALF_CELL
  const over = start + size - extent
  if (over <= 0) return 0
  return -Math.min(Math.ceil(over / HALF_CELL) * HALF_CELL, Math.floor(start / HALF_CELL) * HALF_CELL)
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

function movedSection<S extends string>(plan: SeatPlan<S>, section: Section<S>, delta: PlanPoint): Section<S> {
  const dx = Math.round(delta.x / GRID_CELL) * GRID_CELL
  const dy = Math.round(delta.y / GRID_CELL) * GRID_CELL
  return { ...section, points: section.points.map((p) => seatGrid.snapPoint(plan, { x: p.x + dx, y: p.y + dy })) }
}

// Moves each object by the delta `deltaOf` gives for its footprint, with the object's own snapping.
function moveEach<S extends string>(
  plan: SeatPlan<S>,
  targets: readonly PlanObject<S>[],
  deltaOf: (footprint: PlanRect, object: PlanObject<S>) => PlanPoint,
): SeatPlan<S> {
  const moves = new Map(targets.map((object) => [object.id, deltaOf(seatPlan.footprintOf(object), object)]))
  return {
    ...plan,
    objects: plan.objects.map((o) => {
      const delta = moves.get(o.id)
      if (!delta) return o
      const from = o.kind === 'row' ? o.start : o
      return movedObject(plan, o, { x: from.x + delta.x, y: from.y + delta.y })
    }),
  }
}

// `count` fresh place ids for a section, continuing its numbering. null when the last would pass PLACE_ID_MAX.
function placeIds(plan: SeatPlan<string>, section: string, count: number): string[] | null {
  const first = seatPlan.nextPlaceId(plan, section)
  const start = Number(first.slice(section.length))
  const ids = Array.from({ length: count }, (_, i) => `${section}${start + i}`)
  return ids.every((id) => id.length <= PLACE_ID_MAX) ? ids : null
}

function withFreshIds<S extends string>(plan: SeatPlan<S>, object: PlanObject<S>): PlanObject<S> | null {
  switch (object.kind) {
    case 'fixture':
      return { ...object, id: seatPlan.nextObjectId(plan, object.role) }
    case 'row': {
      const seatIds = placeIds(plan, object.section, object.seats.length)
      if (!seatIds) return null
      return {
        ...object,
        id: seatPlan.nextObjectId(plan, 'row'),
        seats: object.seats.map((seat, i) => ({ ...seat, id: seatIds[i]! })),
      }
    }
    case 'table': {
      const [id, ...seatIds] = placeIds(plan, object.section, object.seats.length + 1) ?? []
      if (!id) return null
      return { ...object, id, seats: object.seats.map((seat, i) => ({ ...seat, id: seatIds[i]! })) }
    }
    default: {
      const [id] = placeIds(plan, object.section, 1) ?? []
      return id ? { ...object, id } : null
    }
  }
}

function objectsOf<S extends string>(plan: SeatPlan<S>, ids: readonly string[]): PlanObject<S>[] {
  const wanted = new Set(ids)
  return plan.objects.filter((object) => wanted.has(object.id))
}

function append<S extends string>(plan: SeatPlan<S>, object: PlanObject<S>): Added<S> {
  return { plan: { ...plan, objects: [...plan.objects, object] }, id: object.id }
}

function replace<S extends string>(plan: SeatPlan<S>, object: PlanObject<S>): SeatPlan<S> {
  return { ...plan, objects: plan.objects.map((o) => (o.id === object.id ? object : o)) }
}

function snapHalf(point: PlanPoint): PlanPoint {
  return { x: Math.round(point.x / HALF_CELL) * HALF_CELL, y: Math.round(point.y / HALF_CELL) * HALF_CELL }
}

function snapRect(rect: PlanRect): PlanRect {
  const origin = snapHalf(rect)
  return {
    ...origin,
    w: Math.max(HALF_CELL, Math.round(rect.w / HALF_CELL) * HALF_CELL),
    h: Math.max(HALF_CELL, Math.round(rect.h / HALF_CELL) * HALF_CELL),
  }
}

const NONE: ReadonlySet<string> = new Set()
// One desk step (2 cells) right and down — a copy lands next to its original, not on it.
const DUPLICATE_OFFSET: PlanPoint = { x: GRID_CELL * 2, y: GRID_CELL * 2 }
