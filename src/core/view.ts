import { seatPlan } from './geometry'
import type { PlanPoint, PlanRect, SeatPlan } from './types'

// View math — a view is the SVG viewBox: the rectangle of the plan (in plan units) that fills the viewport.
// Working in plan units means rendering never measures the container; only gestures convert screen pixels, at
// the moment they happen.

export type PlanView = PlanRect

// One wheel tick, and the zoom range relative to the home view (the whole drawing).
export const ZOOM_STEP = 1.1
const ZOOM_MIN_FACTOR = 0.9
const ZOOM_MAX_FACTOR = 6

export const planView = {
  home,
  zoom,
  pan,
  fitTo,
}

// The view that shows the whole drawing — the default and the reset target. It covers the drawn extent, not
// the document size (walls and the name band reach outside).
function home(plan: Pick<SeatPlan, 'width' | 'height' | 'sections'>): PlanView {
  return seatPlan.drawingBoundsOf(plan)
}

// Zoom by `factor` (> 1 zooms in) keeping `center` (a plan point, e.g. under the cursor) fixed, within
// 0.9×–6× of `homeView`.
function zoom(view: PlanView, factor: number, center: PlanPoint, homeView: PlanView): PlanView {
  const w = clamp(view.w / factor, homeView.w / ZOOM_MAX_FACTOR, homeView.w / ZOOM_MIN_FACTOR)
  const applied = view.w / w
  return {
    x: center.x - (center.x - view.x) / applied,
    y: center.y - (center.y - view.y) / applied,
    w,
    h: view.h / applied,
  }
}

// Move the view by `delta` plan units (a pan drags the plan, so callers pass the negated pointer movement).
function pan(view: PlanView, delta: PlanPoint): PlanView {
  return { ...view, x: view.x + delta.x, y: view.y + delta.y }
}

// The view that frames the given rectangles (e.g. the places to zoom to) with `padding` plan units around them,
// never closer than the maximum zoom of `homeView`. null when there is nothing to frame.
function fitTo(rects: readonly PlanRect[], padding: number, homeView: PlanView): PlanView | null {
  if (rects.length === 0) return null
  const x0 = Math.min(...rects.map((r) => r.x)) - padding
  const y0 = Math.min(...rects.map((r) => r.y)) - padding
  const x1 = Math.max(...rects.map((r) => r.x + r.w)) + padding
  const y1 = Math.max(...rects.map((r) => r.y + r.h)) + padding
  const w = Math.max(x1 - x0, homeView.w / ZOOM_MAX_FACTOR)
  const h = Math.max(y1 - y0, homeView.h / ZOOM_MAX_FACTOR)
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
