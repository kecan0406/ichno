'use client'

import { planView, type PlanRect, type SeatPlan } from 'ichno'
import type { ViewControls } from 'ichno/editor'
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { METRE } from '../_lib/units'
import type { CanvasControls, CanvasLook, CanvasView, Handoff } from './plan-canvas'

// The canvas's view as the rest of the workspace knows it: which of its two views it shows — the plan view, straight
// down, or the isometric one, which opens first — the zoom its menus show and drive, and the hand-over from the plan
// drawn on the server to the canvas once three.js is there.

// Room left round the plan drawn on the server — a metre, so its walls keep off the canvas's edges.
export const VIEW_MARGIN = METRE

type Options = {
  plan: SeatPlan<string>
  canvasRef: RefObject<HTMLElement | null>
}

export function useCanvasView({ plan, canvasRef }: Options) {
  const [look, setLook] = useState<CanvasLook>('isometric')
  // The canvas has drawn its first frame — the plan drawn on the server can go.
  const [shown, setShown] = useState(false)
  const controls = useRef<CanvasControls | null>(null)
  // The server's plan as it lies on the page — the camera starts straight above it.
  const handoff = useRef<Handoff | null>(null)
  const [zoom, setZoom] = useState<CanvasView>({ level: 1, canZoomIn: true, canZoomOut: false })

  useLayoutEffect(() => {
    const element = canvasRef.current

    if (!element) return
    const first = planView.home(plan, VIEW_MARGIN)

    handoff.current = {
      center: { x: first.x + first.w / 2, y: first.y + first.h / 2 },
      zoom: planView.scaleOf(first, { width: element.clientWidth, height: element.clientHeight }),
    }
  }, [])

  // What the zoom menu and the zoom keys drive.
  const view: ViewControls = {
    zoomIn: () => controls.current?.zoomIn(),
    zoomOut: () => controls.current?.zoomOut(),
    fit: () => controls.current?.fit(),
    zoomTo: (rects: readonly PlanRect[]) => controls.current?.zoomTo(rects) ?? false,
  }

  return {
    look,
    setLook,
    shown,
    view,
    zoom,
    // Zooms to a level of the whole plan (1: all of it), about the middle of the view.
    zoomToLevel(level: number) {
      controls.current?.setLevel(level)
    },
    // Brings some of the plan into view — what a check points at.
    reveal(rects: readonly PlanRect[]) {
      controls.current?.zoomTo(rects)
    },
    // A quarter turn of the view, 1 to the right.
    turn(by: 1 | -1) {
      controls.current?.turn(by)
    },
    // What <PlanCanvas> needs to report its view and take over from the server's plan.
    canvas: {
      controlsRef: controls,
      handoffRef: handoff,
      onShown: () => setShown(true),
      onViewChange: setZoom,
    },
  }
}
