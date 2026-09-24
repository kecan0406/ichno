// Seat plan document (version 2) — plain JSON, integer coordinates in plan units. It is stored by consumers for
// years, so every change here needs a schema default or an upgrade path (see `./v1.ts`).
// `S` is the consumer's section id union (fixed per app, see `createSeatPlanSchema`).

// The edge of a desk the chair sits on. Plan coordinates as-is (`up` = smaller y).
export const SEAT_CHAIR_SIDES = ['up', 'right', 'down', 'left'] as const
export type SeatChairSide = (typeof SEAT_CHAIR_SIDES)[number]

export const OBJECT_KINDS = ['desk', 'row', 'table', 'booth', 'area', 'fixture'] as const
export type ObjectKind = (typeof OBJECT_KINDS)[number]

export const TABLE_SHAPES = ['round', 'rect'] as const
export type TableShape = (typeof TABLE_SHAPES)[number]

export const AREA_SHAPES = ['rect', 'ellipse'] as const
export type AreaShape = (typeof AREA_SHAPES)[number]

export type PlanRect = { x: number; y: number; w: number; h: number }
export type PlanPoint = { x: number; y: number }
export type PlanSize = { w: number; h: number }

// A section of the venue (a room, a block of the hall). Its composition is fixed by the consumer; the outline
// is a polygon (a rectangle for plans upgraded from v1).
export type Section<S extends string = string> = { id: S; points: PlanPoint[] }

// A class of places (price level, accessible seating, …). Only the key lives in the document — names, colours
// and prices are the consumer's.
export type Category = { key: string; accessible?: boolean }

// What every bookable unit carries. `id` is the booking key other records reference (1–8 chars, stable);
// `label` is what people read and may change freely (defaults to the id).
type Bookable = { id: string; label?: string; category?: string; tags?: string[] }

// One person at a desk — ichno's own kind (v1 "seat"). Snaps to the 46-unit cell grid.
export type Desk<S extends string = string> = PlanRect &
  Bookable & { kind: 'desk'; section: S; chairSide: SeatChairSide }

export type RowSeat = Bookable

// A row of seats between two points. Seat positions are computed, never stored: seats are spread evenly along
// the arc from `start` to `end`. `curve` bends the row: 0 is straight, ±1 a half circle, positive bows the
// middle to the left of the start→end direction (up for a row drawn left to right).
export type Row<S extends string = string> = {
  kind: 'row'
  id: string
  section: S
  label?: string
  start: PlanPoint
  end: PlanPoint
  curve: number
  seatSize: number
  seats: RowSeat[]
}

export type TableSeat = Bookable

// A table with seats around it. The rectangle is the table top; seats sit outside it. With `wholeBooking` the
// table itself is the bookable unit (its id is the key) and its seats are drawn but not booked one by one.
export type Table<S extends string = string> = PlanRect &
  Bookable & {
    kind: 'table'
    section: S
    shape: TableShape
    seatSize: number
    seats: TableSeat[]
    wholeBooking?: boolean
  }

// A booth or stand — one bookable rectangle.
export type Booth<S extends string = string> = PlanRect & Bookable & { kind: 'booth'; section: S }

// A general-admission area — `capacity` places without assigned seats. With `wholeBooking` one booking takes
// all of it.
export type Area<S extends string = string> = PlanRect &
  Bookable & { kind: 'area'; section: S; shape: AreaShape; capacity: number; wholeBooking?: boolean }

// A non-bookable element (wall, TV, counter, stage, …) — a reading aid only; never counted as capacity. `role`
// is the consumer's word for it (v1 kinds were `wall`, `tv`, `counter`).
export type Fixture = PlanRect & { kind: 'fixture'; id: string; role: string }

export type PlanObject<S extends string = string> = Desk<S> | Row<S> | Table<S> | Booth<S> | Area<S> | Fixture

export type SeatPlan<S extends string = string> = {
  version: 2
  width: number
  height: number
  sections: Section<S>[]
  categories: Category[]
  // Drawing order — later objects are drawn on top.
  objects: PlanObject<S>[]
}

// A bookable unit with its computed geometry — what renderers draw and pickers select. `seatPlan.placesOf`
// flattens a plan into these.
export type PlaceKind = 'desk' | 'row-seat' | 'table-seat' | 'table' | 'booth' | 'area'

export type Place<S extends string = string> = {
  id: string
  kind: PlaceKind
  section: S
  // The label to draw — the object's label, or its id.
  label: string
  category?: string
  tags: string[]
  // The row or table a seat belongs to, and its position in it (row order, or clockwise around a table).
  parent?: { id: string; kind: 'row' | 'table'; index: number }
  center: PlanPoint
  bounds: PlanRect
  shape: 'rect' | 'circle' | 'ellipse'
  // How many people one booking of this place seats (areas and whole tables hold more than one).
  capacity: number
  // Desk only — which edge the chair is on.
  chairSide?: SeatChairSide
}

// A plan cropped to one section — the same shape, translated so the crop's bounding box starts at the origin.
export type SectionPlan<S extends string = string> = { id: S; plan: SeatPlan<S> }
