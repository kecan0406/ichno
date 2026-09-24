import { DEFAULT_SEAT_CELLS, GRID_CELL, HALF_CELL, seatGrid } from './grid'
import { arcPoints, boundsOfPoints, offsetPolygon, polygonContains, unionBounds } from './math'
import type {
  Desk,
  Fixture,
  Place,
  PlanObject,
  PlanPoint,
  PlanRect,
  PlanSize,
  Row,
  RowSeat,
  SeatChairSide,
  SeatPlan,
  Section,
  SectionPlan,
  Table,
  TableSeat,
} from './types'

// Seat plan geometry — zod-free so client bundles (seat pickers, viewers) never pull the schema in.

// Editor lower bound for desks — the smallest desk whose number still reads.
export const MIN_SEAT_SIZE = 40

// Drawing dimensions (plan units) — every renderer draws with the same values.
// The outer wall wraps outside the section outline: places sit up to 2 units from the room corner, so an inside
// wall would cover them.
export const WALL_THICKNESS = 5
// Wall fixtures sit on the half-cell (23) grid, but painting their full thickness blocks the aisle — only a
// centre band is painted.
export const INNER_WALL_THICKNESS = 8
// Section name — written above each section's outer wall when a plan holds more than one section. The band is
// one line of text plus breathing room above the wall.
export const SECTION_LABEL_FONT = 28
export const SECTION_LABEL_BAND = 64
// Gap between a table top and the seats around it.
export const TABLE_SEAT_GAP = 6
// Margin around the drawing — holds the outer wall plus a little air.
const DRAWING_MARGIN = 8
// One person's chair at a desk — independent of desk size. The chair band (depth) never exceeds 32% of the desk.
const CHAIR_BAND = 28
const CHAIR_LENGTH = 38
// Crop padding — breathing room between the crop edge and the outermost object (before grid snapping).
const SECTION_PLAN_PADDING = 20

const FIXTURE_LABEL_MAX_FONT = 20
const FIXTURE_LABEL_MIN_FONT = 10

export const seatPlan = {
  objectById,
  placesOf,
  idsOf,
  sectionAt,
  sectionOf,
  sectionBoundsOf,
  sectionWallOf,
  nextPlaceId,
  nextObjectId,
  nextChairSide,
  findFreeDeskPos,
  findFreeFixturePos,
  fixtureLabelOf,
  sectionPlanOf,
  sectionPlansOf,
  rowSeatsOf,
  rowApexOf,
  rowLabelAnchorsOf,
  tableSeatsOf,
  objectsInRect,
  furnitureOf,
  innerWallOf,
  footprintOf,
  boundsOf,
  translate,
  showsSectionLabels,
  drawingBoundsOf,
}

function objectById<S extends string>(plan: Pick<SeatPlan<S>, 'objects'>, id: string): PlanObject<S> | undefined {
  return plan.objects.find((object) => object.id === id)
}

// Every bookable unit with its geometry, in drawing order: desks, row seats (row order), table seats (clockwise
// from the top) or whole tables, booths and areas. Fixtures are not places.
function placesOf<S extends string>(plan: Pick<SeatPlan<S>, 'objects'>): Place<S>[] {
  const places: Place<S>[] = []
  for (const object of plan.objects) {
    switch (object.kind) {
      case 'desk':
        places.push({
          ...bookableOf(object),
          kind: 'desk',
          section: object.section,
          center: centerOf(object),
          bounds: rectOf(object),
          shape: 'rect',
          capacity: 1,
          chairSide: object.chairSide,
        })
        break
      case 'row':
        for (const [index, { seat, center }] of rowSeatsOf(object).entries()) {
          places.push({
            ...bookableOf(seat),
            kind: 'row-seat',
            section: object.section,
            parent: { id: object.id, kind: 'row', index },
            center,
            bounds: circleBounds(center, object.seatSize),
            shape: 'circle',
            capacity: 1,
          })
        }
        break
      case 'table':
        if (object.wholeBooking) {
          places.push({
            ...bookableOf(object),
            kind: 'table',
            section: object.section,
            center: centerOf(object),
            bounds: rectOf(object),
            shape: object.shape === 'round' ? 'ellipse' : 'rect',
            capacity: object.seats.length,
          })
          break
        }
        for (const [index, { seat, center }] of tableSeatsOf(object).entries()) {
          places.push({
            ...bookableOf(seat),
            kind: 'table-seat',
            section: object.section,
            parent: { id: object.id, kind: 'table', index },
            center,
            bounds: circleBounds(center, object.seatSize),
            shape: 'circle',
            capacity: 1,
          })
        }
        break
      case 'booth':
        places.push({
          ...bookableOf(object),
          kind: 'booth',
          section: object.section,
          center: centerOf(object),
          bounds: rectOf(object),
          shape: 'rect',
          capacity: 1,
        })
        break
      case 'area':
        places.push({
          ...bookableOf(object),
          kind: 'area',
          section: object.section,
          center: centerOf(object),
          bounds: rectOf(object),
          shape: object.shape === 'ellipse' ? 'ellipse' : 'rect',
          capacity: object.capacity,
        })
        break
      case 'fixture':
        break
    }
  }
  return places
}

// Every id in the document — objects and the seats inside rows and tables. They share one namespace.
function idsOf(plan: Pick<SeatPlan, 'objects'>): string[] {
  const ids: string[] = []
  for (const object of plan.objects) {
    ids.push(object.id)
    if (object.kind === 'row' || object.kind === 'table') for (const seat of object.seats) ids.push(seat.id)
  }
  return ids
}

// The section containing a point — the editor re-homes a dragged desk to the section its centre lands in.
function sectionAt<S extends string>(plan: Pick<SeatPlan<S>, 'sections'>, point: PlanPoint): S | null {
  return plan.sections.find((section) => polygonContains(section.points, point))?.id ?? null
}

function sectionOf<S extends string>(plan: Pick<SeatPlan<S>, 'sections'>, id: S): Section<S> | undefined {
  return plan.sections.find((section) => section.id === id)
}

function sectionBoundsOf(section: Pick<Section, 'points'>): PlanRect {
  return boundsOfPoints(section.points)
}

// The outline the outer wall is stroked on — the section pushed out by half the wall, so the wall's inner edge
// runs exactly on the section edge.
function sectionWallOf(section: Pick<Section, 'points'>): PlanPoint[] {
  return offsetPolygon(section.points, WALL_THICKNESS / 2)
}

// Next place id — `<section><n>` with n = the highest number any id with that prefix carries + 1. Deleted numbers
// are never reused, so "delete then add" in one editing session cannot silently reconnect to records that
// referenced the old id.
function nextPlaceId(plan: Pick<SeatPlan, 'objects'>, section: string): string {
  return `${section}${maxSuffix(plan, new RegExp(`^${escapeRegExp(section)}(\\d+)$`)) + 1}`
}

// Next non-place id — `<prefix>-<n>` (rows, fixtures).
function nextObjectId(plan: Pick<SeatPlan, 'objects'>, prefix: string): string {
  return `${prefix}-${maxSuffix(plan, new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`)) + 1}`
}

// Editor rotation — one edge clockwise.
const NEXT_CHAIR_SIDE: Record<SeatChairSide, SeatChairSide> = { up: 'right', right: 'down', down: 'left', left: 'up' }

function nextChairSide(side: SeatChairSide): SeatChairSide {
  return NEXT_CHAIR_SIDE[side]
}

// Where a new standard desk (2×2 cells) goes — scans the section's cell origins row-major and returns the first
// one inside the section that overlaps no place footprint. null when the section is full (or missing).
function findFreeDeskPos<S extends string>(plan: Pick<SeatPlan<S>, 'sections' | 'objects'>, id: S): PlanPoint | null {
  const section = sectionOf(plan, id)
  if (!section) return null
  const box = sectionBoundsOf(section)
  const span = seatGrid.seatSpanPxOf(DEFAULT_SEAT_CELLS)
  const taken = plan.objects.filter((o) => o.kind !== 'fixture').map(footprintOf)
  // Start from the first cell whose origin is at or past the section origin — the cell just inside the corner
  // when the section is grid-aligned.
  const startX = seatGrid.seatPxOf(Math.ceil((box.x - 2) / GRID_CELL))
  const startY = seatGrid.seatPxOf(Math.ceil((box.y - 2) / GRID_CELL))
  for (let y = startY; y + span <= box.y + box.h; y += GRID_CELL) {
    for (let x = startX; x + span <= box.x + box.w; x += GRID_CELL) {
      const rect = { x, y, w: span, h: span }
      if (!cornersOf(rect).every((corner) => polygonContains(section.points, corner))) continue
      if (!taken.some((other) => seatGrid.rectsOverlap(other, rect))) return { x, y }
    }
  }
  return null
}

// Where a new fixture goes — scans the whole plan by half cells row-major for a spot overlapping no object.
// Fixtures may overlap each other, but a freshly added one should not hide under an existing one.
function findFreeFixturePos(plan: Pick<SeatPlan, 'width' | 'height' | 'objects'>, size: PlanSize): PlanPoint | null {
  const taken = plan.objects.map(footprintOf)
  for (let y = 0; y + size.h <= plan.height; y += HALF_CELL) {
    for (let x = 0; x + size.w <= plan.width; x += HALF_CELL) {
      const rect = { x, y, ...size }
      if (!taken.some((item) => seatGrid.rectsOverlap(item, rect))) return { x, y }
    }
  }
  return null
}

// Fixture label layout — text runs along the long edge (tall fixtures read bottom-to-top), the font follows the
// short edge. Glyph width is estimated from the font size; when the text would not fit or the font would fall
// below the minimum, no label is drawn — the shape still reads. `text` is the consumer's name for the fixture.
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

// Section crop — bounded by the section's objects rather than its outline, because rooms keep wide empty floor
// that would become empty crop height when crops are stacked on a narrow screen. The outer wall may be clipped
// by the frame; a heading above the crop names the section.
// Fixtures have no section, so those whose centre lies in the section belong to it (and extend the bounds so a
// TV on the wall is not cut off). Bounds snap to GRID_CELL so desks stay on grid lines after translation.
// null when the section does not exist (defensive — callers draw an empty state).
function sectionPlanOf<S extends string>(plan: SeatPlan<S>, id: S): SeatPlan<S> | null {
  const section = sectionOf(plan, id)
  if (!section) return null
  const objects = plan.objects.filter((object) =>
    object.kind === 'fixture' ? polygonContains(section.points, centerOf(object)) : object.section === id,
  )
  // A section with nothing in it has nothing to crop to — its outline is the bound.
  const bounds = unionBounds(objects.map(boundsOf)) ?? sectionBoundsOf(section)
  const x0 = Math.floor((bounds.x - SECTION_PLAN_PADDING) / GRID_CELL) * GRID_CELL
  const y0 = Math.floor((bounds.y - SECTION_PLAN_PADDING) / GRID_CELL) * GRID_CELL
  return {
    version: 2,
    width: Math.ceil((bounds.x + bounds.w + SECTION_PLAN_PADDING - x0) / GRID_CELL) * GRID_CELL,
    height: Math.ceil((bounds.y + bounds.h + SECTION_PLAN_PADDING - y0) / GRID_CELL) * GRID_CELL,
    sections: [{ ...section, points: section.points.map((p) => ({ x: p.x - x0, y: p.y - y0 })) }],
    categories: plan.categories,
    objects: objects.map((object) => translate(object, -x0, -y0)),
  }
}

// One crop per section in left-to-right plan order, all padded to the widest crop. Renderers fill their width,
// so equal widths mean equal scale — otherwise a narrow section would be stretched to a wide one's width and
// seat sizes would differ between crops. Padding is added on both sides in GRID_CELL steps only.
function sectionPlansOf<S extends string>(plan: SeatPlan<S>): SectionPlan<S>[] {
  const cropped: SectionPlan<S>[] = []
  const ordered = [...plan.sections].sort((a, b) => sectionBoundsOf(a).x - sectionBoundsOf(b).x)
  for (const section of ordered) {
    const sectionPlan = sectionPlanOf(plan, section.id)
    if (sectionPlan) cropped.push({ id: section.id, plan: sectionPlan })
  }
  if (cropped.length === 0) return []

  const width = Math.max(...cropped.map((entry) => entry.plan.width))
  return cropped.map(({ id, plan: sectionPlan }) => {
    const left = Math.floor((width - sectionPlan.width) / 2 / GRID_CELL) * GRID_CELL
    return {
      id,
      plan: {
        ...sectionPlan,
        width,
        sections: sectionPlan.sections.map((s) => ({ ...s, points: s.points.map((p) => ({ x: p.x + left, y: p.y })) })),
        objects: sectionPlan.objects.map((object) => translate(object, left, 0)),
      },
    }
  })
}

// Seat centres along a row — spread evenly over the arc from start to end.
function rowSeatsOf(row: Pick<Row, 'start' | 'end' | 'curve' | 'seats'>): { seat: RowSeat; center: PlanPoint }[] {
  const centers = arcPoints(row.start, row.end, row.curve, row.seats.length)
  return row.seats.map((seat, i) => ({ seat, center: centers[i]! }))
}

// The middle of a row's arc — where its curve handle sits.
function rowApexOf(row: Pick<Row, 'start' | 'end' | 'curve'>): PlanPoint {
  return arcPoints(row.start, row.end, row.curve, 1)[0]!
}

// Where a row's label goes — one seat's width beyond the first and the last seat, along the row.
function rowLabelAnchorsOf(row: Pick<Row, 'start' | 'end' | 'curve' | 'seats' | 'seatSize'>): {
  start: PlanPoint
  end: PlanPoint
} {
  const centers = rowSeatsOf(row).map(({ center }) => center)
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

// The objects whose footprint touches a rectangle — marquee selection. Fixtures included.
function objectsInRect(plan: Pick<SeatPlan, 'objects'>, rect: PlanRect): string[] {
  return plan.objects
    .filter((object) => {
      const b = footprintOf(object)
      return b.x <= rect.x + rect.w && rect.x <= b.x + b.w && b.y <= rect.y + rect.h && rect.y <= b.y + b.h
    })
    .map((object) => object.id)
}

// Seat centres around a table. Round tables spread seats evenly clockwise from the top; rectangular tables split
// them over the two long sides (the first side takes the odd one), left to right / top to bottom.
function tableSeatsOf(
  table: Pick<Table, 'x' | 'y' | 'w' | 'h' | 'shape' | 'seatSize' | 'seats'>,
): { seat: TableSeat; center: PlanPoint }[] {
  const n = table.seats.length
  const center = centerOf(table)
  const reach = table.seatSize / 2 + TABLE_SEAT_GAP
  if (table.shape === 'round') {
    const rx = table.w / 2 + reach
    const ry = table.h / 2 + reach
    return table.seats.map((seat, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n
      return { seat, center: { x: center.x + rx * Math.cos(angle), y: center.y + ry * Math.sin(angle) } }
    })
  }
  const wide = table.w >= table.h
  const firstCount = Math.ceil(n / 2)
  return table.seats.map((seat, i) => {
    const first = i < firstCount
    const count = first ? firstCount : n - firstCount
    const k = first ? i : i - firstCount
    const along = (k + 0.5) / count
    if (wide) {
      const x = table.x + table.w * along
      return { seat, center: { x, y: first ? table.y - reach : table.y + table.h + reach } }
    }
    const y = table.y + table.h * along
    return { seat, center: { x: first ? table.x + table.w + reach : table.x - reach, y } }
  })
}

// The furniture of one desk — the chair in the band on its chair side, the desk top in the rest (local
// coordinates, desk origin). The chair lies with its long edge along the desk.
function furnitureOf(desk: Pick<Desk, 'w' | 'h' | 'chairSide'>): { desk: PlanRect; chair: PlanRect } {
  const sideways = desk.chairSide === 'left' || desk.chairSide === 'right'
  const depth = sideways ? desk.w : desk.h
  const span = sideways ? desk.h : desk.w
  const band = Math.min(CHAIR_BAND, depth * 0.32)
  const gap = band * 0.2 // between desk and chair
  const inset = band * 0.15 // between chair and the desk's outer edge
  const thickness = band - gap - inset
  const length = Math.min(CHAIR_LENGTH, span - 8)
  const along = (span - length) / 2
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

// The painted band of a wall fixture — INNER_WALL_THICKNESS centred along the long edge (local coordinates).
function innerWallOf(fixture: Pick<Fixture, 'w' | 'h'>): PlanRect {
  const thickness = Math.min(INNER_WALL_THICKNESS, fixture.w, fixture.h)
  return fixture.w >= fixture.h
    ? { x: 0, y: (fixture.h - thickness) / 2, w: fixture.w, h: thickness }
    : { x: (fixture.w - thickness) / 2, y: 0, w: thickness, h: fixture.h }
}

// The floor an object claims — overlap rules and free-spot search use it. A table claims its top (seats around
// it may share the aisle), a row the extent of its seats.
function footprintOf(object: PlanObject): PlanRect {
  if (object.kind === 'row') return rowBounds(object)
  return rectOf(object)
}

// Everything an object draws — a table's seats included.
function boundsOf(object: PlanObject): PlanRect {
  if (object.kind === 'row') return rowBounds(object)
  if (object.kind === 'table') {
    const seats = tableSeatsOf(object).map(({ center }) => circleBounds(center, object.seatSize))
    return unionBounds([rectOf(object), ...seats])!
  }
  return rectOf(object)
}

// The same object moved by (dx, dy).
function translate<O extends PlanObject<string>>(object: O, dx: number, dy: number): O {
  if (object.kind === 'row') {
    return {
      ...object,
      start: { x: object.start.x + dx, y: object.start.y + dy },
      end: { x: object.end.x + dx, y: object.end.y + dy },
    }
  }
  return { ...object, x: (object as PlanRect).x + dx, y: (object as PlanRect).y + dy }
}

// Whether section names are drawn on the plan — not on a single-section crop, where there is nothing to tell
// apart and a heading outside the drawing says it louder.
function showsSectionLabels(plan: Pick<SeatPlan, 'sections'>): boolean {
  return plan.sections.length > 1
}

// The drawn extent — the outer wall reaches past the document size, and labelled plans gain the name band on
// top. Fit views and the SVG viewBox use this; object coordinates are unchanged.
function drawingBoundsOf(plan: Pick<SeatPlan, 'width' | 'height' | 'sections'>): PlanRect {
  const top = showsSectionLabels(plan) ? SECTION_LABEL_BAND : DRAWING_MARGIN
  return { x: -DRAWING_MARGIN, y: -top, w: plan.width + DRAWING_MARGIN * 2, h: plan.height + top + DRAWING_MARGIN }
}

function bookableOf(item: { id: string; label?: string; category?: string; tags?: string[] }) {
  return {
    id: item.id,
    label: item.label ?? item.id,
    ...(item.category === undefined ? {} : { category: item.category }),
    tags: item.tags ?? [],
  }
}

function rowBounds(row: Row): PlanRect {
  const seats = rowSeatsOf(row).map(({ center }) => circleBounds(center, row.seatSize))
  return unionBounds(seats) ?? boundsOfPoints([row.start, row.end])
}

function circleBounds(center: PlanPoint, size: number): PlanRect {
  return { x: center.x - size / 2, y: center.y - size / 2, w: size, h: size }
}

function rectOf(rect: PlanRect): PlanRect {
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
}

function centerOf(rect: PlanRect): PlanPoint {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

function cornersOf(rect: PlanRect): PlanPoint[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ]
}

function maxSuffix(plan: Pick<SeatPlan, 'objects'>, pattern: RegExp): number {
  return idsOf(plan).reduce((acc, id) => {
    const match = pattern.exec(id)
    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
