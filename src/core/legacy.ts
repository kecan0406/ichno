import { OBJECT_ID_MAX } from './geometry'
import { layout } from './layout'
import { arcPoints, centerOfBox, outlineOf, polygonsOverlap } from './math'
import type { Fixture, Group, GroupLabel, Place, PlanObject, PlanPoint, PlanRect, SeatPlan } from './types'

// Earlier versions of the document. Consumers stored them, so they must keep opening: `ichno/schema` upgrades
// them on parse, and `upgradeSeatPlan` does the same for callers that already trust their data.

type ChairSide = 'up' | 'right' | 'down' | 'left'

// Version 1 (ichno 0.1) — rooms ("zones") holding desk seats, plus wall/TV/counter fixtures.
export type SeatPlanV1<Z extends string = string> = {
  width: number
  height: number
  zones: (PlanRect & { id: Z })[]
  seats: (PlanRect & { id: string; zone: Z; chairSide: ChairSide })[]
  fixtures: (PlanRect & { id: string; kind: 'wall' | 'tv' | 'counter' })[]
}

type BookableV2 = { id: string; label?: string; category?: string; tags?: string[] }

// Version 2 (ichno 0.2) — built-in object kinds; rows and tables stored their layout, not their seats' places.
export type SeatPlanV2<S extends string = string> = {
  version: 2
  width: number
  height: number
  sections: { id: S; points: PlanPoint[] }[]
  categories: { key: string; accessible?: boolean }[]
  objects: PlanObjectV2<S>[]
}

export type PlanObjectV2<S extends string = string> =
  | (PlanRect & BookableV2 & { kind: 'desk'; section: S; chairSide: ChairSide })
  | {
      kind: 'row'
      id: string
      section: S
      label?: string
      start: PlanPoint
      end: PlanPoint
      curve: number
      seatSize: number
      seats: BookableV2[]
    }
  | (PlanRect &
      BookableV2 & {
        kind: 'table'
        section: S
        shape: 'round' | 'rect'
        seatSize: number
        seats: BookableV2[]
        wholeBooking?: boolean
      })
  | (PlanRect & BookableV2 & { kind: 'booth'; section: S })
  | (PlanRect &
      BookableV2 & { kind: 'area'; section: S; shape: 'rect' | 'ellipse'; capacity: number; wholeBooking?: boolean })
  | (PlanRect & { kind: 'fixture'; id: string; role: string })

// Any stored document → the current version. Every place keeps its id; coordinates keep their place.
export function upgradeSeatPlan<S extends string>(plan: SeatPlanV1<S> | SeatPlanV2<S>): SeatPlan<S> {
  return upgradeV2('version' in plan ? plan : upgradeV1(plan))
}

// v1 → v2. Zones become rectangular sections, seats become desks and fixtures keep their kind as the role.
// Fixtures go first: v1 drew them under the seats, and object order is drawing order.
// v1 kept seat and fixture ids in separate lists; v2 has one namespace. Fixture ids were editor handles that no
// other record references, so a fixture whose id a seat also uses is renamed `<kind>-<n>`.
export function upgradeV1<Z extends string>(plan: SeatPlanV1<Z>): SeatPlanV2<Z> {
  const seatIds = new Set(plan.seats.map((seat) => seat.id))
  const taken = new Set([...seatIds, ...plan.fixtures.map((fixture) => fixture.id)])

  const fixtureIdOf = (fixture: SeatPlanV1['fixtures'][number]) => {
    if (!seatIds.has(fixture.id)) return fixture.id
    let n = 1

    while (taken.has(`${fixture.kind}-${n}`)) n++
    const id = `${fixture.kind}-${n}`
    taken.add(id)

    return id
  }

  return {
    version: 2,
    width: plan.width,
    height: plan.height,
    sections: plan.zones.map((zone) => ({
      id: zone.id,
      points: [
        { x: zone.x, y: zone.y },
        { x: zone.x + zone.w, y: zone.y },
        { x: zone.x + zone.w, y: zone.y + zone.h },
        { x: zone.x, y: zone.y + zone.h },
      ],
    })),
    categories: [],
    objects: [
      ...plan.fixtures.map((f) => ({
        kind: 'fixture' as const,
        id: fixtureIdOf(f),
        role: f.kind,
        x: f.x,
        y: f.y,
        w: f.w,
        h: f.h,
      })),
      ...plan.seats.map((s) => ({
        kind: 'desk' as const,
        id: s.id,
        section: s.zone,
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        chairSide: s.chairSide,
      })),
    ],
  }
}

// v2 → v3. Built-in kinds become primitives with the consumer-style roles below; every place keeps its id.
// - desk → a group (`desk`) holding the desk top as a place and the chair as a fixture.
// - row → a group (the row's id, `row`) holding one place per seat (`seat`), plus a label at each end when the
//   row had a label.
// - table → a group (`table`) holding the top and the seats. Booked seat by seat, the top is a fixture (the
//   table's id) and the seats are places; booked whole, the top is the place and the seats are chair fixtures.
// - booth, area → a place (`booth`, `area`). Whether one booking takes a whole area is the consumer's rule now.
// - fixture → a rectangular fixture with its role.
// v2 let a row's or a table's own seats crowd each other; such seats shrink until they only touch, so the
// upgraded document passes the overlap rule. Seat centres never move.
export function upgradeV2<S extends string>(plan: SeatPlanV2<S>): SeatPlan<S> {
  const taken = new Set(plan.objects.flatMap((o) => [o.id, ...('seats' in o ? o.seats.map((s) => s.id) : [])]))

  const fresh = (base: string) => {
    let id = base.slice(0, OBJECT_ID_MAX)

    for (let n = 2; taken.has(id); n++) id = `${base.slice(0, OBJECT_ID_MAX - String(n).length - 1)}-${n}`
    taken.add(id)

    return id
  }

  const groups: Group[] = []
  const objects: PlanObject<S>[] = []

  for (const object of plan.objects) {
    switch (object.kind) {
      case 'desk': {
        const group = fresh(`${object.id}-g`)
        const { desk, chair } = furnitureOf(object)
        groups.push({ id: group, role: 'desk' })
        objects.push(
          { ...placeOf(object, 'desk', group), ...offset(desk, object), shape: 'rect', capacity: 1 },
          {
            kind: 'fixture',
            id: fresh(`${object.id}-c`),
            shape: 'rect',
            role: 'chair',
            group,
            ...offset(chair, object),
          },
        )
        break
      }

      case 'row': {
        const boxes = uncrowded(
          layout.arc({ ...object, count: object.seats.length, size: object.seatSize }).map(unturned),
          object.seatSize,
          false,
        )

        const row: Group = { id: object.id, role: 'row' }

        if (object.label !== undefined) row.label = object.label
        groups.push(row)
        objects.push(
          ...object.seats.map((seat, i) => ({
            ...placeOf({ ...seat, section: object.section }, 'seat', object.id),
            ...boxes[i]!,
            shape: 'ellipse' as const,
            capacity: 1,
          })),
        )

        if (object.label !== undefined) {
          const ends = rowLabelAnchorsOf(object)

          for (const [i, point] of [ends.start, ends.end].entries()) {
            const s = object.seatSize
            objects.push({
              kind: 'label',
              id: fresh(`${object.id}-l${i + 1}`),
              group: object.id,
              x: Math.round(point.x - s / 2),
              y: Math.round(point.y - s / 2),
              w: s,
              h: s,
            } satisfies GroupLabel)
          }
        }

        break
      }

      case 'table': {
        const group = fresh(`${object.id}-g`)
        const shape = object.shape === 'round' ? 'ellipse' : 'rect'
        const top = { x: object.x, y: object.y, w: object.w, h: object.h }
        const seats = layout.around({ table: top, shape, count: object.seats.length, size: object.seatSize })
        const boxes = uncrowded(seats.map(unturned), object.seatSize, shape === 'ellipse')

        if (object.wholeBooking) {
          groups.push({ id: group, role: 'table' })
          objects.push(
            ...object.seats.map((seat, i): Fixture => ({
              kind: 'fixture',
              id: seat.id,
              shape: 'ellipse',
              role: 'chair',
              group,
              ...boxes[i]!,
            })),
            { ...placeOf(object, 'table', group), ...top, shape, capacity: object.seats.length },
          )
        } else {
          const table: Group = { id: group, role: 'table' }

          if (object.label !== undefined) table.label = object.label
          groups.push(table)
          objects.push(
            { kind: 'fixture', id: object.id, shape, role: 'table', group, ...top },
            ...object.seats.map((seat, i) => ({
              ...placeOf({ ...seat, section: object.section }, 'seat', group),
              ...boxes[i]!,
              shape: 'ellipse' as const,
              capacity: 1,
            })),
          )
        }

        break
      }

      case 'booth':
        objects.push({ ...placeOf(object, 'booth'), ...rectOf(object), shape: 'rect', capacity: 1 })
        break
      case 'area':
        objects.push({ ...placeOf(object, 'area'), ...rectOf(object), shape: object.shape, capacity: object.capacity })
        break
      case 'fixture':
        objects.push({ kind: 'fixture', id: object.id, shape: 'rect', role: object.role, ...rectOf(object) })
        break
    }
  }

  return {
    version: 3,
    width: plan.width,
    height: plan.height,
    sections: plan.sections,
    walls: [],
    categories: plan.categories,
    groups,
    objects,
  }
}

type PlaceFields<S extends string> = Omit<Place<S>, 'x' | 'y' | 'w' | 'h' | 'shape' | 'capacity'>

// The document fields of a place, without its box — set one by one in the order upgrades have always written them,
// so an upgraded document serializes the same.
function placeOf<S extends string>(item: BookableV2 & { section: S }, role: string, group?: string): PlaceFields<S> {
  const place: PlaceFields<S> = { kind: 'place', id: item.id, section: item.section }

  if (item.label !== undefined) place.label = item.label

  if (group !== undefined) place.group = group
  place.role = role

  if (item.category !== undefined) place.category = item.category

  if (item.tags !== undefined) place.tags = item.tags

  return place
}

// Round seats need no turn.
function unturned({ x, y, w, h }: PlanRect): PlanRect {
  return { x, y, w, h }
}

// Seats of one row or table, shrunk about their centres until neighbours (in order; around a table the last
// meets the first) no longer overlap.
function uncrowded(boxes: PlanRect[], size: number, closed: boolean): PlanRect[] {
  const centers = boxes.map(centerOfBox)
  const at = (s: number) => centers.map((c) => ({ x: Math.round(c.x - s / 2), y: Math.round(c.y - s / 2), w: s, h: s }))

  for (let s = size; s > 1; s--) {
    const next = at(s)

    const crowded = next.some((box, i) => {
      const other = next[i + 1] ?? (closed && next.length > 2 ? next[0] : undefined)

      return other !== undefined && polygonsOverlap(outlineOf(box, 'ellipse', 0.5), outlineOf(other, 'ellipse', 0.5))
    })

    if (!crowded) return next
  }

  return at(1)
}

type RowEnds = { start: PlanPoint; end: PlanPoint }

// Where v2 drew a row's label — one seat's width beyond the first and the last seat, along the row.
function rowLabelAnchorsOf(
  row: Pick<Extract<PlanObjectV2, { kind: 'row' }>, 'start' | 'end' | 'curve' | 'seats' | 'seatSize'>,
): RowEnds {
  const centers = arcPoints(row.start, row.end, row.curve, row.seats.length)
  const first = centers[0] ?? row.start
  const last = centers.at(-1) ?? row.end

  const outward = (from: PlanPoint, toward: PlanPoint | undefined, fallback: PlanPoint): PlanPoint => {
    const dx = toward ? from.x - toward.x : fallback.x
    const dy = toward ? from.y - toward.y : fallback.y
    const length = Math.hypot(dx, dy)

    if (length === 0) return { x: from.x, y: from.y }

    return { x: from.x + (dx / length) * row.seatSize, y: from.y + (dy / length) * row.seatSize }
  }

  const along = { x: row.end.x - row.start.x || 1, y: row.end.y - row.start.y }

  return {
    start: outward(first, centers[1], { x: -along.x, y: -along.y }),
    end: outward(last, centers.at(-2), along),
  }
}

type DeskFurniture = { desk: PlanRect; chair: PlanRect }

// How v2 drew a desk — the chair in a band on its chair side, the desk top in the rest (local coordinates, whole
// units). The chair lies with its long edge along the desk.
function furnitureOf(desk: { w: number; h: number; chairSide: ChairSide }): DeskFurniture {
  const sideways = desk.chairSide === 'left' || desk.chairSide === 'right'
  const depth = sideways ? desk.w : desk.h
  const span = sideways ? desk.h : desk.w
  const band = Math.round(Math.min(CHAIR_BAND, depth * 0.32))
  const gap = Math.round(band * 0.2)
  const inset = Math.round(band * 0.15)
  const thickness = Math.max(1, band - gap - inset)
  const length = Math.max(1, Math.min(CHAIR_LENGTH, span - 8))
  const along = Math.round((span - length) / 2)

  switch (desk.chairSide) {
    case 'up':
      return {
        desk: { x: 0, y: band, w: desk.w, h: desk.h - band },
        chair: { x: along, y: inset, w: length, h: thickness },
      }
    case 'down':
      return {
        desk: { x: 0, y: 0, w: desk.w, h: desk.h - band },
        chair: { x: along, y: desk.h - band + gap, w: length, h: thickness },
      }
    case 'left':
      return {
        desk: { x: band, y: 0, w: desk.w - band, h: desk.h },
        chair: { x: inset, y: along, w: thickness, h: length },
      }
    case 'right':
      return {
        desk: { x: 0, y: 0, w: desk.w - band, h: desk.h },
        chair: { x: desk.w - band + gap, y: along, w: thickness, h: length },
      }
  }
}

// A desk's chair band and chair length, as v2 drew them.
const CHAIR_BAND = 28

const CHAIR_LENGTH = 38

function offset(rect: PlanRect, origin: PlanPoint): PlanRect {
  return { x: origin.x + rect.x, y: origin.y + rect.y, w: rect.w, h: rect.h }
}

function rectOf(rect: PlanRect): PlanRect {
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
}
