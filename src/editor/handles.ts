import { seatPlan } from '../core/geometry'
import { HALF_CELL, seatGrid } from '../core/grid'
import type { HandleOwner, PlanHandle, PlanObject, PlanPoint, PlanRect, SeatPlan } from '../core/types'
import type { EditorSelection } from './selection'

// Editing handles — which ones a selection shows and what dragging one does. Pure, like the other operations:
// the editor hook shows `handlesOf` and commits `dragHandle` with the snapping its preview used.
//
// Rectangles (desks, booths, areas, tables, fixtures) resize from their corners, the opposite corner staying put.
// Rows move either end (length and direction) and bend from the middle of their arc. Sections move one vertex at
// a time. Handles show for a single selected item only — a group has no single shape to reshape.

export const planHandles = {
  of: handlesOf,
  drag: dragHandle,
}

const CORNERS = ['nw', 'ne', 'se', 'sw'] as const
type Corner = (typeof CORNERS)[number]

function handlesOf<S extends string>(plan: SeatPlan<S>, selection: readonly EditorSelection<S>[]): PlanHandle<S>[] {
  if (selection.length !== 1) return []
  const [item] = selection as [EditorSelection<S>]
  if (item.kind === 'section') {
    const section = seatPlan.sectionOf(plan, item.id)
    if (!section) return []
    return section.points.map((point, i) => ({ owner: item, name: `vertex-${i}`, point }))
  }
  const object = seatPlan.objectById(plan, item.id)
  if (!object) return []
  const owner = { kind: 'object' as const, id: object.id }
  if (object.kind === 'row') {
    // The end handles sit beside the end seats (where the row label goes), so they never cover a seat.
    const ends = seatPlan.rowLabelAnchorsOf(object)
    return [
      { owner, name: 'start', point: ends.start },
      { owner, name: 'end', point: ends.end },
      { owner, name: 'curve', point: seatPlan.rowApexOf(object) },
    ]
  }
  return CORNERS.map((name) => ({ owner, name, point: cornerOf(object, name) }))
}

// The plan with a handle dragged by `total` plan units. Unknown handles leave the plan as it is.
function dragHandle<S extends string>(
  plan: SeatPlan<S>,
  owner: HandleOwner<S>,
  name: string,
  total: PlanPoint,
): SeatPlan<S> {
  if (owner.kind === 'section') {
    const index = Number(name.replace('vertex-', ''))
    return {
      ...plan,
      sections: plan.sections.map((section) => {
        if (section.id !== owner.id || !section.points[index]) return section
        const points = section.points.map((p, i) =>
          i === index ? seatGrid.snapPoint(plan, { x: p.x + total.x, y: p.y + total.y }) : p,
        )
        return { ...section, points }
      }),
    }
  }
  return {
    ...plan,
    objects: plan.objects.map((object) => (object.id === owner.id ? reshaped(plan, object, name, total) : object)),
  }
}

function reshaped<S extends string>(
  plan: SeatPlan<S>,
  object: PlanObject<S>,
  name: string,
  total: PlanPoint,
): PlanObject<S> {
  if (object.kind === 'row') {
    if (name === 'start') return { ...object, start: snapHalf(add(object.start, total)) }
    if (name === 'end') return { ...object, end: snapHalf(add(object.end, total)) }
    if (name === 'curve') return { ...object, curve: curveThrough(object, add(seatPlan.rowApexOf(object), total)) }
    return object
  }
  if (!isCorner(name)) return object
  const moved = add(cornerOf(object, name), total)
  const anchor = cornerOf(object, OPPOSITE[name])
  if (object.kind === 'desk') {
    const size = {
      w: seatGrid.seatSpanPxOf(seatGrid.seatSpanCellsOf(Math.abs(moved.x - anchor.x))),
      h: seatGrid.seatSpanPxOf(seatGrid.seatSpanCellsOf(Math.abs(moved.y - anchor.y))),
    }
    return { ...object, ...size, ...seatGrid.placeSeat(plan, size, originFrom(anchor, moved, size)) }
  }
  const size = {
    w: Math.max(HALF_CELL, roundTo(Math.abs(moved.x - anchor.x), HALF_CELL)),
    h: Math.max(HALF_CELL, roundTo(Math.abs(moved.y - anchor.y), HALF_CELL)),
  }
  const origin = seatGrid.placeFixture(plan, size, originFrom(anchor, moved, size))
  // A rectangle never grows past the plan edge.
  return {
    ...object,
    ...origin,
    w: Math.min(size.w, Math.max(HALF_CELL, Math.floor((plan.width - origin.x) / HALF_CELL) * HALF_CELL)),
    h: Math.min(size.h, Math.max(HALF_CELL, Math.floor((plan.height - origin.y) / HALF_CELL) * HALF_CELL)),
  }
}

// The curve that puts the middle of the arc as close to `apex` as it can go: its offset along the row's left
// normal, relative to half the chord, rounded to hundredths and kept within a half circle.
function curveThrough(row: { start: PlanPoint; end: PlanPoint }, apex: PlanPoint): number {
  const dx = row.end.x - row.start.x
  const dy = row.end.y - row.start.y
  const chord = Math.hypot(dx, dy)
  if (chord === 0) return 0
  const mid = { x: (row.start.x + row.end.x) / 2, y: (row.start.y + row.end.y) / 2 }
  const sagitta = ((apex.x - mid.x) * dy + (apex.y - mid.y) * -dx) / chord
  return Math.round(Math.min(1, Math.max(-1, (2 * sagitta) / chord)) * 100) / 100
}

// The top-left of a rectangle of `size` whose corner opposite `anchor` points toward `moved`.
function originFrom(anchor: PlanPoint, moved: PlanPoint, size: { w: number; h: number }): PlanPoint {
  return {
    x: moved.x < anchor.x ? anchor.x - size.w : anchor.x,
    y: moved.y < anchor.y ? anchor.y - size.h : anchor.y,
  }
}

function cornerOf(rect: PlanRect | PlanObject, corner: Corner): PlanPoint {
  const r = rect as PlanRect
  return {
    x: corner === 'nw' || corner === 'sw' ? r.x : r.x + r.w,
    y: corner === 'nw' || corner === 'ne' ? r.y : r.y + r.h,
  }
}

const OPPOSITE: Record<Corner, Corner> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }

function isCorner(name: string): name is Corner {
  return (CORNERS as readonly string[]).includes(name)
}

function add(a: PlanPoint, b: PlanPoint): PlanPoint {
  return { x: a.x + b.x, y: a.y + b.y }
}

function snapHalf(point: PlanPoint): PlanPoint {
  return { x: roundTo(point.x, HALF_CELL), y: roundTo(point.y, HALF_CELL) }
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}
