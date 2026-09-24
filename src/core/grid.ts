import type { PlanPoint, PlanSize, SeatPlan } from './types'

// Grid policy — the editor treats the plan as a 46-unit cell occupancy model (storage stays in plan units).
// Desks sit 2 units inside their cell origin (size = cells × 46 − 4) so neighbouring desks keep a 4-unit gap:
// a standard desk (88 + 4 gap = 92) is exactly 2×2 cells.
// Section outlines run on cell edges with no inset (points = cells × 46).
// Fixtures (wall/TV/counter) use a half-cell grid so thin elements can stand half a desk cell thick and sit on
// cell edges. Like sections they have no inset (position/size = half cells × 23).
// Rows, tables, booths and areas are free-standing; the editor snaps them to half cells.

export const GRID_CELL = 46
export const HALF_CELL = GRID_CELL / 2
export const DEFAULT_SEAT_CELLS = 2 // a new seat is 2×2 cells = 88 units

const SEAT_INSET = 2
const SEAT_GAP = SEAT_INSET * 2

type PlanExtent = Pick<SeatPlan, 'width' | 'height'>

export const seatGrid = {
  seatCellOf,
  seatPxOf,
  seatSpanCellsOf,
  seatSpanPxOf,
  sectionCellOf,
  sectionPxOf,
  sectionSpanCellsOf,
  sectionSpanPxOf,
  maxSeatCell,
  maxSeatSpanCells,
  maxSectionCell,
  maxSectionSpanCells,
  fixtureHalfCellOf,
  fixtureSpanHalfCellsOf,
  fixturePxOf,
  maxFixtureHalfCell,
  maxFixtureSpanHalfCells,
  cellOriginAt,
  snapPoint,
  placeSeat,
  placeSection,
  placeFixture,
  normalize,
  rectsOverlap,
}

// Seat position units ↔ cell index
function seatCellOf(px: number): number {
  return Math.round((px - SEAT_INSET) / GRID_CELL)
}

function seatPxOf(cell: number): number {
  return cell * GRID_CELL + SEAT_INSET
}

// Seat size units ↔ cell count
function seatSpanCellsOf(px: number): number {
  return Math.max(1, Math.round((px + SEAT_GAP) / GRID_CELL))
}

function seatSpanPxOf(cells: number): number {
  return cells * GRID_CELL - SEAT_GAP
}

// Section position/size units ↔ cells
function sectionCellOf(px: number): number {
  return Math.round(px / GRID_CELL)
}

function sectionPxOf(cell: number): number {
  return cell * GRID_CELL
}

function sectionSpanCellsOf(px: number): number {
  return Math.max(DEFAULT_SEAT_CELLS, Math.round(px / GRID_CELL))
}

function sectionSpanPxOf(cells: number): number {
  return cells * GRID_CELL
}

// Fixture position/size units ↔ half cells — no inset, so position and size share one conversion
// (size is at least one half cell).
function fixtureHalfCellOf(px: number): number {
  return Math.round(px / HALF_CELL)
}

function fixtureSpanHalfCellsOf(px: number): number {
  return Math.max(1, fixtureHalfCellOf(px))
}

function fixturePxOf(halfCells: number): number {
  return halfCells * HALF_CELL
}

// The last cell where a given size still fits inside the plan (extent) / the largest span from a given position.
function maxSeatCell(extent: number, spanPx: number): number {
  return Math.max(0, Math.floor((extent - spanPx - SEAT_INSET) / GRID_CELL))
}

function maxSeatSpanCells(extent: number, posPx: number): number {
  return Math.max(1, Math.floor((extent - posPx + SEAT_GAP) / GRID_CELL))
}

function maxSectionCell(extent: number, spanPx: number): number {
  return Math.max(0, Math.floor((extent - spanPx) / GRID_CELL))
}

function maxSectionSpanCells(extent: number, posPx: number): number {
  return Math.max(DEFAULT_SEAT_CELLS, Math.floor((extent - posPx) / GRID_CELL))
}

function maxFixtureHalfCell(extent: number, spanPx: number): number {
  return Math.max(0, Math.floor((extent - spanPx) / HALF_CELL))
}

function maxFixtureSpanHalfCells(extent: number, posPx: number): number {
  return Math.max(1, Math.floor((extent - posPx) / HALF_CELL))
}

// Seat origin of the cell containing a point — a click places "in that cell", so floor rather than round.
function cellOriginAt(point: PlanPoint): PlanPoint {
  return { x: seatPxOf(Math.floor(point.x / GRID_CELL)), y: seatPxOf(Math.floor(point.y / GRID_CELL)) }
}

// Commit a seat position — snap to the nearest cell and clamp inside the plan by whole cells.
function placeSeat(plan: PlanExtent, size: PlanSize, pos: PlanPoint): PlanPoint {
  return {
    x: seatPxOf(clamp(seatCellOf(pos.x), 0, maxSeatCell(plan.width, size.w))),
    y: seatPxOf(clamp(seatCellOf(pos.y), 0, maxSeatCell(plan.height, size.h))),
  }
}

function placeSection(plan: PlanExtent, size: PlanSize, pos: PlanPoint): PlanPoint {
  return {
    x: sectionPxOf(clamp(sectionCellOf(pos.x), 0, maxSectionCell(plan.width, size.w))),
    y: sectionPxOf(clamp(sectionCellOf(pos.y), 0, maxSectionCell(plan.height, size.h))),
  }
}

function placeFixture(plan: PlanExtent, size: PlanSize, pos: PlanPoint): PlanPoint {
  return {
    x: fixturePxOf(clamp(fixtureHalfCellOf(pos.x), 0, maxFixtureHalfCell(plan.width, size.w))),
    y: fixturePxOf(clamp(fixtureHalfCellOf(pos.y), 0, maxFixtureHalfCell(plan.height, size.h))),
  }
}

// A section outline point on the nearest cell corner, inside the plan.
function snapPoint(plan: PlanExtent, point: PlanPoint): PlanPoint {
  return {
    x: sectionPxOf(clamp(sectionCellOf(point.x), 0, Math.floor(plan.width / GRID_CELL))),
    y: sectionPxOf(clamp(sectionCellOf(point.y), 0, Math.floor(plan.height / GRID_CELL))),
  }
}

// Align a whole plan to the grid — rounds a pre-grid (traced) plan to cells: section outlines to cell corners,
// desks to cells, fixtures to half cells. Other objects are left where they are. Idempotent.
function normalize<P extends SeatPlan<string>>(plan: P): P {
  return {
    ...plan,
    sections: plan.sections.map((section) => ({
      ...section,
      points: section.points.map((point) => snapPoint(plan, point)),
    })),
    objects: plan.objects.map((object) => {
      if (object.kind === 'desk') {
        const w = seatSpanPxOf(seatSpanCellsOf(object.w))
        const h = seatSpanPxOf(seatSpanCellsOf(object.h))
        return { ...object, w, h, ...placeSeat(plan, { w, h }, object) }
      }
      if (object.kind === 'fixture') {
        const w = fixturePxOf(fixtureSpanHalfCellsOf(object.w))
        const h = fixturePxOf(fixtureSpanHalfCellsOf(object.h))
        return { ...object, w, h, ...placeFixture(plan, { w, h }, object) }
      }
      return object
    }),
  }
}

// Axis-aligned overlap — edges that merely touch do not overlap. Placement and validation share this definition.
function rectsOverlap(a: PlanPoint & PlanSize, b: PlanPoint & PlanSize): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
