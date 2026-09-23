// Floor plan document — plain JSON, integer coordinates in plan units.
// `Z` is the consumer's zone id union (fixed per app, see `createSeatPlanSchema`).

export const FIXTURE_KINDS = ['wall', 'tv', 'counter'] as const
export type FixtureKind = (typeof FIXTURE_KINDS)[number]

// The edge of the seat rectangle the chair sits on. Plan coordinates as-is (`up` = smaller y).
export const SEAT_CHAIR_SIDES = ['up', 'right', 'down', 'left'] as const
export type SeatChairSide = (typeof SEAT_CHAIR_SIDES)[number]

export type PlanRect = { x: number; y: number; w: number; h: number }
export type PlanPoint = { x: number; y: number }
export type PlanSize = { w: number; h: number }

// A room. Its composition is fixed by the consumer; only position and size are edited.
export type Zone<Z extends string = string> = PlanRect & { id: Z }

export type Seat<Z extends string = string> = PlanRect & {
  // The key other records (sessions, reservations) reference — and the label drawn on the desk.
  id: string
  zone: Z
  chairSide: SeatChairSide
}

// A non-seat element (wall/TV/counter) — a reading aid only; never counted as capacity.
export type Fixture = PlanRect & {
  // Editor-only handle; nothing outside the document references it.
  id: string
  kind: FixtureKind
}

export type SeatPlan<Z extends string = string> = {
  width: number
  height: number
  zones: Zone<Z>[]
  seats: Seat<Z>[]
  fixtures: Fixture[]
}

// A plan cropped to one zone — the same shape, translated so the crop's bounding box starts at the origin.
export type ZoneSeatPlan<Z extends string = string> = SeatPlan<Z>

export type ZonePlan<Z extends string = string> = { id: Z; plan: ZoneSeatPlan<Z> }
