import { seatPlan } from './geometry'
import type { PlanPoint, PlanRect, SeatPlan } from './types'

// View math — a view is the SVG viewBox: the rectangle of the plan (in plan units) that fills the viewport.
// Working in plan units means rendering never measures the container; only gestures convert screen pixels, at
// the moment they happen.

export type PlanView = PlanRect
// The viewport's size in CSS pixels.
export type ViewportSize = { width: number; height: number }

// One wheel tick, and the zoom range relative to the home view (the whole drawing).
export const ZOOM_STEP = 1.1
const ZOOM_MIN_FACTOR = 0.9
const ZOOM_MAX_FACTOR = 6

export const planView = {
  home,
  zoom,
  pan,
  fitTo,
  scaleOf,
  toPlan,
  region,
  contains,
  scaleStep,
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

// Screen pixels per plan unit — the viewBox scales uniformly to fit the viewport (preserveAspectRatio meet).
function scaleOf(view: PlanView, size: ViewportSize): number {
  if (view.w <= 0 || view.h <= 0) return 1
  return Math.min(size.width / view.w, size.height / view.h)
}

// The plan point under a viewport point (CSS pixels from the viewport's top-left). The drawing is centred in
// the leftover space (xMidYMid), like the browser does. Pure arithmetic — reading the SVG's screen matrix would
// force a layout of every node, which costs tens of milliseconds on large plans.
function toPlan(view: PlanView, size: ViewportSize, point: { x: number; y: number }): PlanPoint {
  const scale = scaleOf(view, size)
  const offsetX = (size.width - view.w * scale) / 2
  const offsetY = (size.height - view.h * scale) / 2
  return { x: view.x + (point.x - offsetX) / scale, y: view.y + (point.y - offsetY) / scale }
}

// The view grown by `margin` of its size on every side — the area worth drawing, so small pans stay inside it.
function region(view: PlanView, margin: number): PlanRect {
  return {
    x: view.x - view.w * margin,
    y: view.y - view.h * margin,
    w: view.w * (1 + 2 * margin),
    h: view.h * (1 + 2 * margin),
  }
}

function contains(outer: PlanRect, inner: PlanRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

// A scale rounded to quarter octaves (~19% apart) — level-of-detail decisions change in steps, not on every
// wheel tick, so zooming does not redraw the plan each time.
function scaleStep(scale: number): number {
  return 2 ** (Math.round(Math.log2(scale) * 4) / 4)
}
