'use client'

import { useState } from 'react'
import { GRID_CELL } from '../../core/grid'
import type { PlanPoint, PlanRect, SeatPlan } from '../../core/types'
import { planView, type PlanView, type Sides } from '../../core/view'

export type SeatMapView = ReturnType<typeof useSeatMapView>

type Options = {
  // Where the view starts. The whole drawing by default.
  initialView?: PlanView
  // How far one zoomIn or zoomOut goes.
  step?: number
  // Room left around what zoomTo frames, in plan units.
  padding?: number
  // Room left round the whole plan, in plan units: the view opens on the drawing with this much about it, and zooms
  // out no further. None by default — the drawing fills the view.
  margin?: number
  // More room at single sides, in plan units, on top of `margin` — for a toolbar or a panel floating over the plan
  // there (`planView.roomFor` turns its pixels into this).
  room?: Sides
}

// The view of a <SeatMap.Viewport>, with the controls people expect around it — zoom in and out about the middle, back
// to the whole plan, or to some places — for the buttons and keys you draw yourself. Spread `viewProps` into the
// viewport; the wheel and pinching then change the same view. `level` is how far in the view is (1: the whole plan);
// write it the way your app writes zoom.
export function useSeatMapView(
  plan: Pick<SeatPlan, 'width' | 'height' | 'sections'>,
  { initialView, step = ZOOM_BUTTON_STEP, padding = ZOOM_TO_PADDING, margin = 0, room }: Options = {},
) {
  const home = planView.home(plan, margin, room)
  const [view, setView] = useState<PlanView>(() => initialView ?? home)
  const middle = middleOf(view)

  function zoomBy(factor: number) {
    setView((current) => planView.zoom(current, factor, middleOf(current), home))
  }

  // Frames the given rectangles (seatPlan.boundsOf a place, a section's bounds). false when there is nothing to frame.
  function zoomTo(rects: readonly PlanRect[], around: number = padding): boolean {
    const next = planView.fitTo(rects, around, home)

    if (next) setView(next)

    return next !== null
  }

  return {
    view,
    setView,
    level: home.w / view.w,
    // Whether a zoom would change anything — at the limits it would not, so disable the button.
    canZoomIn: planView.zoom(view, step, middle, home).w < view.w,
    canZoomOut: planView.zoom(view, 1 / step, middle, home).w > view.w,
    zoomIn: () => zoomBy(step),
    zoomOut: () => zoomBy(1 / step),
    // Back to the whole plan.
    fit: () => setView(home),
    zoomTo,
    // Spread into <SeatMap.Viewport>.
    viewProps: { view, onViewChange: setView, home },
  }
}

function middleOf(view: PlanView): PlanPoint {
  return { x: view.x + view.w / 2, y: view.y + view.h / 2 }
}

// A zoom button's step, and the room around what zoomTo frames — two editor cells.
const ZOOM_BUTTON_STEP = 1.5

const ZOOM_TO_PADDING = GRID_CELL * 2
