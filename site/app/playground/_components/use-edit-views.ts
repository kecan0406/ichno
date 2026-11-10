'use client'

import { planView, type PlanRect, type PlanView, type SeatPlan } from 'ichno'
import type { ViewControls } from 'ichno/editor'
import type { SeatMapView } from 'ichno/react/client'
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { METRE } from '../_lib/units'
import type { BuildCamera, BuildControls, BuildView, Handoff } from './build-3d'

// Which way the plan is seen — stood up in 3D from a corner, what opens first, or as ichno draws it (2D), a switch
// away for exact work — and how one view hands over to the other while editing: the same spot in the middle, zoomed
// in as far, the 3D camera tilting between straight down, where the 2D view is, and its corner.

// Room left round the plan in the 2D views — a metre, so its walls keep off the canvas's edges.
export const VIEW_MARGIN = METRE

// Room left round what a check points at when the 2D view frames it, in plan units.
const REVEAL_PADDING = 160

type Options = {
  mode: 'edit' | 'preview'
  plan: SeatPlan<string>
  // The 2D view, shared by the editor and the preview.
  map: SeatMapView
  canvasRef: RefObject<HTMLElement | null>
}

export function useEditViews({ mode, plan, map, canvasRef }: Options) {
  const [dimension, setDimension] = useState<'2d' | '3d'>('3d')
  // The 3D preview was switched to from the 2D one — its camera comes down from above the plan.
  const [fromAbove, setFromAbove] = useState(false)
  // The 2D view lies under the 3D editor while one gives way to the other: until the 3D canvas has faded in — from
  // the first paint, while three.js loads — and while it tilts back and fades away.
  const [entering, setEntering] = useState(true)
  const [leaving, setLeaving] = useState(false)
  const building = mode === 'edit' && (dimension === '3d' || leaving)
  // The 3D editor's view, for the zoom menu and keys and the turn keys.
  const build = useRef<BuildControls | null>(null)
  const camera = useRef<BuildCamera | null>(null)
  // The 2D view the 3D editor takes over from.
  const handoff = useRef<Handoff | null>(null)
  const [buildView, setBuildView] = useState<BuildView>({ level: 1, canZoomIn: true, canZoomOut: false })

  // The first view hands over the way a switch from 2D does: the 3D editor starts straight above what the 2D view
  // shows, then tilts into its corner.
  useLayoutEffect(() => {
    const element = canvasRef.current

    if (element) handoff.current = handoffOf(map.view, map.level, element)
  }, [])

  // What the zoom menu and the zoom keys drive — the 2D canvas's view or the 3D editor's.
  const view: ViewControls = building
    ? {
        zoomIn: () => build.current?.zoomIn(),
        zoomOut: () => build.current?.zoomOut(),
        fit: () => build.current?.fit(),
        zoomTo: (rects: readonly PlanRect[]) => build.current?.zoomTo(rects) ?? false,
      }
    : map

  // What the zoom menu shows — read apart from the controls, which call into the 3D view's ref.
  const zoom: BuildView = building
    ? buildView
    : { level: map.level, canZoomIn: map.canZoomIn, canZoomOut: map.canZoomOut }

  function switchDimension(next: '2d' | '3d') {
    if (next === dimension) return
    setDimension(next)
    setFromAbove(mode === 'preview' && next === '3d')
    const element = canvasRef.current

    if (mode !== 'edit' || !element) return

    if (next === '3d') {
      if (leaving) {
        build.current?.rest()
        setLeaving(false)

        return
      }

      handoff.current = handoffOf(map.view, map.level, element)
      setEntering(true)

      return
    }

    const at = camera.current

    if (!at || !build.current) return
    // The 2D view over the 3D camera's spot, zoomed in as far.
    const home = planView.home(plan, VIEW_MARGIN)
    const center = { x: at.x, y: at.z }
    const around = { x: center.x - home.w / 2, y: center.y - home.h / 2, w: home.w, h: home.h }
    const target = planView.zoom(around, buildView.level, center, home)
    const size = { width: element.clientWidth, height: element.clientHeight }
    // The 2D view is laid under the 3D one at once — drawing it is the heavy part, done before anything moves — and
    // shows as the canvas fades away at the end of the tilt.
    map.setView(target)
    setLeaving(true)
    build.current.leave({ center, zoom: planView.scaleOf(target, size) }, () => setLeaving(false))
  }

  // Zooms to a level of the whole plan (1: all of it), about the middle of the view.
  function zoomToLevel(level: number) {
    if (building) {
      build.current?.setLevel(level)

      return
    }

    const home = planView.home(plan, VIEW_MARGIN)
    const current = map.view
    const middle = { x: current.x + current.w / 2, y: current.y + current.h / 2 }
    map.setView(planView.zoom(current, (level * current.w) / home.w, middle, home))
  }

  return {
    dimension,
    fromAbove,
    // Editing in 3D — and whether the 2D view lies under it meanwhile.
    building,
    underlaid: entering || leaving,
    view,
    zoom,
    switchDimension,
    zoomToLevel,
    // Brings some of the plan into view — what a check points at.
    reveal(rects: readonly PlanRect[]) {
      if (building) build.current?.zoomTo(rects)
      else map.zoomTo(rects, REVEAL_PADDING)
    },
    // A quarter turn of the 3D editor's view, 1 to the right.
    turn(by: 1 | -1) {
      if (building) build.current?.turn(by)
    },
    // A view that is switched to anew starts where it rests — not from above.
    settle: () => setFromAbove(false),
    // What <Build3D> needs to keep its camera and hand the view over.
    build3D: {
      controlsRef: build,
      cameraRef: camera,
      handoffRef: handoff,
      onCamera(next: BuildCamera) {
        camera.current = next
      },
      onViewChange: setBuildView,
      onShown() {
        // The hand-over is taken — a later opening (after the preview) starts where the camera was.
        handoff.current = null
        setEntering(false)
      },
    },
  }
}

// What the 3D editor takes over from the 2D view: the spot in its middle, its scale on the screen and how far in
// it is.
function handoffOf(view: PlanView, level: number, element: HTMLElement): Handoff {
  const size = { width: element.clientWidth, height: element.clientHeight }

  return {
    center: { x: view.x + view.w / 2, y: view.y + view.h / 2 },
    zoom: planView.scaleOf(view, size),
    level,
  }
}
