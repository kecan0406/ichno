import { DEFAULT_SEAT_CELLS, GRID_CELL, HALF_CELL, seatGrid } from './grid'
import type {
  Fixture,
  FixtureKind,
  PlanPoint,
  PlanRect,
  PlanSize,
  Seat,
  SeatChairSide,
  SeatPlan,
  ZonePlan,
  ZoneSeatPlan,
} from './types'

// Floor plan geometry — zod-free so client bundles (seat pickers, canvases) never pull the schema in.

// Editor lower bound — the smallest seat whose number still reads.
export const MIN_SEAT_SIZE = 40

// Drawing dimensions (plan units) — the canvas, the editor and the SVG draw with the same values.
// The outer wall wraps outside the zone rectangle: seats sit up to 2 units from the room corner, so an
// inside wall would cover them.
export const WALL_THICKNESS = 5
// Wall fixtures sit on the half-cell (23) grid, but painting their full thickness blocks the aisle — only a
// centre band is painted.
export const INNER_WALL_THICKNESS = 8
// Zone name — written above each room's outer wall when a plan holds more than one zone. The band is one
// line of text plus breathing room above the wall.
export const ZONE_LABEL_FONT = 28
export const ZONE_LABEL_BAND = 64
// Margin around the drawing — holds the outer wall plus a little air.
const DRAWING_MARGIN = 8
// One person's chair — independent of seat size. The chair band (depth) never exceeds 32% of the seat.
const CHAIR_BAND = 28
const CHAIR_LENGTH = 38
// Crop padding — breathing room between the crop edge and the outermost seat (before grid snapping).
const ZONE_PLAN_PADDING = 20

const FIXTURE_LABEL_MAX_FONT = 20
const FIXTURE_LABEL_MIN_FONT = 10

// Default size of a newly added fixture — walls/TVs are half-cell-thick horizontal bars, a counter is two cells deep.
export const FIXTURE_DEFAULT_SIZE: Record<FixtureKind, PlanSize> = {
  wall: { w: 8 * HALF_CELL, h: HALF_CELL },
  tv: { w: 6 * HALF_CELL, h: HALF_CELL },
  counter: { w: 8 * HALF_CELL, h: 4 * HALF_CELL },
}

export const seatPlan = {
  byId,
  zoneAt,
  nextSeatId,
  nextFixtureId,
  nextChairSide,
  findFreeSeatPos,
  findFreeFixturePos,
  fixtureLabelOf,
  zonePlanOf,
  zonePlansOf,
  furnitureOf,
  innerWallOf,
  showsZoneLabels,
  drawingBoundsOf,
}

function byId<Z extends string>(plan: Pick<SeatPlan<Z>, 'seats'>, id: string): Seat<Z> | undefined {
  return plan.seats.find((seat) => seat.id === id)
}

// The zone containing a point — the editor re-homes a dragged seat to the zone its centre lands in.
function zoneAt<Z extends string>(plan: Pick<SeatPlan<Z>, 'zones'>, point: PlanPoint): Z | null {
  const zone = plan.zones.find((z) => containsPoint(z, point))
  return zone?.id ?? null
}

// Next seat id — `<zone><n>` with n = the zone's highest number + 1. Deleted numbers are never reused, so
// "delete then add" in one editing session cannot silently reconnect to records that referenced the old id.
function nextSeatId<Z extends string>(plan: Pick<SeatPlan<Z>, 'seats'>, zone: Z): string {
  const pattern = new RegExp(`^${escapeRegExp(zone)}(\\d+)$`)
  const max = plan.seats.reduce((acc, seat) => {
    const match = pattern.exec(seat.id)
    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
  return `${zone}${max + 1}`
}

// Next fixture id — `<kind>-<n>` with n = the kind's highest number + 1.
function nextFixtureId(plan: Pick<SeatPlan, 'fixtures'>, kind: FixtureKind): string {
  const max = plan.fixtures.reduce((acc, fixture) => {
    const match = new RegExp(`^${kind}-(\\d+)$`).exec(fixture.id)
    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
  return `${kind}-${max + 1}`
}

// Editor rotation — one edge clockwise.
const NEXT_CHAIR_SIDE: Record<SeatChairSide, SeatChairSide> = { up: 'right', right: 'down', down: 'left', left: 'up' }

function nextChairSide(side: SeatChairSide): SeatChairSide {
  return NEXT_CHAIR_SIDE[side]
}

// Where a new standard seat (2×2 cells) goes — scans the zone's cell origins row-major and returns the first
// one that overlaps no seat. null when the zone is full (or missing).
function findFreeSeatPos<Z extends string>(plan: Pick<SeatPlan<Z>, 'zones' | 'seats'>, zoneId: Z): PlanPoint | null {
  const zone = plan.zones.find((z) => z.id === zoneId)
  if (!zone) return null
  const span = seatGrid.seatSpanPxOf(DEFAULT_SEAT_CELLS)
  // Start from the first cell whose origin is at or past the zone origin — the cell just inside the corner
  // when the zone is grid-aligned.
  const startX = seatGrid.seatPxOf(Math.ceil((zone.x - 2) / GRID_CELL))
  const startY = seatGrid.seatPxOf(Math.ceil((zone.y - 2) / GRID_CELL))
  for (let y = startY; y + span <= zone.y + zone.h; y += GRID_CELL) {
    for (let x = startX; x + span <= zone.x + zone.w; x += GRID_CELL) {
      const rect = { x, y, w: span, h: span }
      if (!plan.seats.some((seat) => seatGrid.rectsOverlap(seat, rect))) return { x, y }
    }
  }
  return null
}

// Where a new fixture goes — scans the whole plan by half cells row-major for a spot overlapping no seat or
// fixture. Fixtures may overlap each other, but a freshly added one should not hide under an existing one.
function findFreeFixturePos(
  plan: Pick<SeatPlan, 'width' | 'height' | 'seats' | 'fixtures'>,
  size: PlanSize,
): PlanPoint | null {
  const taken = [...plan.seats, ...plan.fixtures]
  for (let y = 0; y + size.h <= plan.height; y += HALF_CELL) {
    for (let x = 0; x + size.w <= plan.width; x += HALF_CELL) {
      const rect = { x, y, ...size }
      if (!taken.some((item) => seatGrid.rectsOverlap(item, rect))) return { x, y }
    }
  }
  return null
}

// Fixture label layout — the canvas and the SVG share the decision. Text runs along the long edge (tall
// fixtures read bottom-to-top), the font follows the short edge. Glyph width is estimated from the font size;
// when the text would not fit or the font would fall below the minimum, no label is drawn — the shape still
// reads. `text` is the consumer's name for the fixture (the library ships no copy).
function fixtureLabelOf(
  fixture: Pick<Fixture, 'w' | 'h'>,
  text: string | null | undefined,
): { text: string; fontSize: number; vertical: boolean } | null {
  if (!text) return null
  const vertical = fixture.h > fixture.w
  const long = Math.max(fixture.w, fixture.h)
  const short = Math.min(fixture.w, fixture.h)
  const fontSize = Math.min(FIXTURE_LABEL_MAX_FONT, Math.floor(short * 0.6))
  if (fontSize < FIXTURE_LABEL_MIN_FONT || text.length * fontSize + 8 > long) return null
  return { text, fontSize, vertical }
}

// Zone crop — bounded by the zone's seats and fixtures rather than the room rectangle, because rooms keep wide
// seatless floor that would become empty crop height when crops are stacked on a narrow screen. The outer wall
// may be clipped by the frame; a heading above the crop names the room.
// Fixtures have no zone, so those whose centre lies in the room belong to it (and extend the bounds so a TV on
// the wall is not cut off). Bounds snap to GRID_CELL so seats stay on grid lines after translation.
// null when the zone does not exist (defensive — callers draw an empty state).
function zonePlanOf<Z extends string>(plan: ZoneSeatPlan<Z>, zoneId: Z): ZoneSeatPlan<Z> | null {
  const zone = plan.zones.find((z) => z.id === zoneId)
  if (!zone) return null
  const seats = plan.seats.filter((s) => s.zone === zoneId)
  const fixtures = plan.fixtures.filter((f) => containsPoint(zone, { x: f.x + f.w / 2, y: f.y + f.h / 2 }))
  const items = [...seats, ...fixtures]

  // A zone with nothing in it has nothing to crop to — the room rectangle is the bound.
  let minX = items.length > 0 ? Infinity : zone.x
  let minY = items.length > 0 ? Infinity : zone.y
  let maxX = items.length > 0 ? -Infinity : zone.x + zone.w
  let maxY = items.length > 0 ? -Infinity : zone.y + zone.h
  for (const item of items) {
    minX = Math.min(minX, item.x)
    minY = Math.min(minY, item.y)
    maxX = Math.max(maxX, item.x + item.w)
    maxY = Math.max(maxY, item.y + item.h)
  }

  const x0 = Math.floor((minX - ZONE_PLAN_PADDING) / GRID_CELL) * GRID_CELL
  const y0 = Math.floor((minY - ZONE_PLAN_PADDING) / GRID_CELL) * GRID_CELL
  return {
    width: Math.ceil((maxX + ZONE_PLAN_PADDING - x0) / GRID_CELL) * GRID_CELL,
    height: Math.ceil((maxY + ZONE_PLAN_PADDING - y0) / GRID_CELL) * GRID_CELL,
    zones: [{ ...zone, x: zone.x - x0, y: zone.y - y0 }],
    seats: seats.map((s) => ({ ...s, x: s.x - x0, y: s.y - y0 })),
    fixtures: fixtures.map((f) => ({ ...f, x: f.x - x0, y: f.y - y0 })),
  }
}

// One crop per zone in left-to-right plan order, all padded to the widest crop. Renderers fill their width, so
// equal widths mean equal scale — otherwise a narrow room would be stretched to a wide room's width and seat
// sizes would differ between crops. Padding is added on both sides in GRID_CELL steps only.
function zonePlansOf<Z extends string>(plan: ZoneSeatPlan<Z>): ZonePlan<Z>[] {
  const cropped: ZonePlan<Z>[] = []
  for (const zone of [...plan.zones].sort((a, b) => a.x - b.x)) {
    const zonePlan = zonePlanOf(plan, zone.id)
    if (zonePlan) cropped.push({ id: zone.id, plan: zonePlan })
  }
  if (cropped.length === 0) return []

  const width = Math.max(...cropped.map((entry) => entry.plan.width))
  return cropped.map(({ id, plan: zonePlan }) => {
    const left = Math.floor((width - zonePlan.width) / 2 / GRID_CELL) * GRID_CELL
    return {
      id,
      plan: {
        width,
        height: zonePlan.height,
        zones: zonePlan.zones.map((zone) => ({ ...zone, x: zone.x + left })),
        seats: zonePlan.seats.map((seat) => ({ ...seat, x: seat.x + left })),
        fixtures: zonePlan.fixtures.map((fixture) => ({ ...fixture, x: fixture.x + left })),
      },
    }
  })
}

// The furniture of one seat — the chair in the band on its chair side, the desk in the rest (local coordinates,
// seat origin). The chair lies with its long edge along the desk.
function furnitureOf(seat: Pick<Seat, 'w' | 'h' | 'chairSide'>): { desk: PlanRect; chair: PlanRect } {
  const sideways = seat.chairSide === 'left' || seat.chairSide === 'right'
  const depth = sideways ? seat.w : seat.h
  const span = sideways ? seat.h : seat.w
  const band = Math.min(CHAIR_BAND, depth * 0.32)
  const gap = band * 0.2 // between desk and chair
  const inset = band * 0.15 // between chair and the seat's outer edge
  const thickness = band - gap - inset
  const length = Math.min(CHAIR_LENGTH, span - 8)
  const along = (span - length) / 2
  switch (seat.chairSide) {
    case 'up':
      return {
        desk: { x: 0, y: band, w: seat.w, h: seat.h - band },
        chair: { x: along, y: inset, w: length, h: thickness },
      }
    case 'down':
      return {
        desk: { x: 0, y: 0, w: seat.w, h: seat.h - band },
        chair: { x: along, y: seat.h - band + gap, w: length, h: thickness },
      }
    case 'left':
      return {
        desk: { x: band, y: 0, w: seat.w - band, h: seat.h },
        chair: { x: inset, y: along, w: thickness, h: length },
      }
    case 'right':
      return {
        desk: { x: 0, y: 0, w: seat.w - band, h: seat.h },
        chair: { x: seat.w - band + gap, y: along, w: thickness, h: length },
      }
  }
}

// The painted band of a wall fixture — INNER_WALL_THICKNESS centred along the long edge (local coordinates).
function innerWallOf(fixture: Pick<Fixture, 'w' | 'h'>): PlanRect {
  const thickness = Math.min(INNER_WALL_THICKNESS, fixture.w, fixture.h)
  return fixture.w >= fixture.h
    ? { x: 0, y: (fixture.h - thickness) / 2, w: fixture.w, h: thickness }
    : { x: (fixture.w - thickness) / 2, y: 0, w: thickness, h: fixture.h }
}

// Whether zone names are drawn on the plan — not on a single-zone crop, where there is nothing to tell apart
// and a heading outside the drawing says it louder.
function showsZoneLabels(plan: Pick<SeatPlan, 'zones'>): boolean {
  return plan.zones.length > 1
}

// The drawn extent — the outer wall reaches past the document size, and labelled plans gain the name band on
// top. Fit views and the SVG viewBox use this; seat coordinates are unchanged.
function drawingBoundsOf(plan: Pick<SeatPlan, 'width' | 'height' | 'zones'>): PlanRect {
  const top = showsZoneLabels(plan) ? ZONE_LABEL_BAND : DRAWING_MARGIN
  return { x: -DRAWING_MARGIN, y: -top, w: plan.width + DRAWING_MARGIN * 2, h: plan.height + top + DRAWING_MARGIN }
}

function containsPoint(box: PlanRect, point: PlanPoint): boolean {
  return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
