import { seatPlan } from './geometry'
import type { SeatPlan } from './types'

// Canvas view (scale + translation) math — konva-free so code that lazy-loads a canvas can share it without
// the canvas chunk riding along in the first bundle.

export type SeatMapView = { scale: number; x: number; y: number }
export type ViewportSize = { width: number; height: number }
type PlanExtent = Pick<SeatPlan, 'width' | 'height' | 'sections'>

// One wheel tick, and the zoom range relative to fit — shared by the viewer canvas and the editor.
export const ZOOM_STEP = 1.1
const ZOOM_MIN_FACTOR = 0.9
const ZOOM_MAX_FACTOR = 6

// The view that fits the whole drawing into the container — the default of a stage without pan/zoom and the
// reset target. It fits the drawn extent, not the document size (walls and the name band reach outside).
export function fitView(plan: PlanExtent, size: ViewportSize, padding: number): SeatMapView {
  const bounds = seatPlan.drawingBoundsOf(plan)
  const scale = Math.min((size.width - padding * 2) / bounds.w, (size.height - padding * 2) / bounds.h)
  return {
    scale,
    x: (size.width - bounds.w * scale) / 2 - bounds.x * scale,
    y: (size.height - bounds.h * scale) / 2 - bounds.y * scale,
  }
}

// Fit scale for a container — the reference for zoom clamping.
export function fitScaleOf(plan: PlanExtent, size: ViewportSize): number {
  const bounds = seatPlan.drawingBoundsOf(plan)
  return Math.min(size.width / bounds.w, size.height / bounds.h)
}

// Change scale while keeping `center` fixed on screen — wheel, pinch and zoom buttons share this.
export function zoomView(
  view: SeatMapView,
  args: { factor: number; center: { x: number; y: number }; fitScale: number },
): SeatMapView {
  const scale = clamp(view.scale * args.factor, args.fitScale * ZOOM_MIN_FACTOR, args.fitScale * ZOOM_MAX_FACTOR)
  const planX = (args.center.x - view.x) / view.scale
  const planY = (args.center.y - view.y) / view.scale
  return { scale, x: args.center.x - planX * scale, y: args.center.y - planY * scale }
}

// Zoom around the viewport centre — for zoom buttons.
export function centerZoom(view: SeatMapView, factor: number, size: ViewportSize, plan: PlanExtent): SeatMapView {
  return zoomView(view, { factor, center: { x: size.width / 2, y: size.height / 2 }, fitScale: fitScaleOf(plan, size) })
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
