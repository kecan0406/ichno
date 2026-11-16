'use client'

import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber'
import {
  GRID_CELL,
  IDLE_EDGE_SCROLL,
  IDLE_PRESS,
  edgeScroll,
  press,
  projection,
  seatPlan,
  type EdgeScrollState,
  type Fixture,
  type FloorMatrix,
  type PlanHandle,
  type PlanPoint,
  type PlanRect,
  type PlanTarget,
  type PressEnv,
  type PressEvent,
  type PressPointer,
  type PressResult,
  type PressState,
  type Projection,
  type ScreenPoint,
  type SeatPlan,
  type ViewportSize,
} from 'ichno'
import type { SeatPlanEditor } from 'ichno/editor'
import { SeatMap, planTargetOf } from 'ichno/react'
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { BufferGeometry, Raycaster, Vector2 } from 'three'
import { OFF_PX, TEXT_PX, dimensionLabelsOf, type Measured } from './dimensions'
import { everyFrame } from './frames'
import {
  HEIGHT,
  SIGN_HEIGHT,
  WALL_CUT,
  heightOf,
  numbersOf,
  piecesOf,
  wallsOf,
  writingOf,
  type Piece,
  type Wall,
} from '../_lib/scene'
import controls from './controls.module.css'
import {
  Daylight,
  Fallback,
  Floor,
  Hairlines,
  Numbers,
  Solids,
  Text,
  floorSegments,
  reducedMotion,
  Shade,
  setSegments,
  usePalette,
  type Look,
  type Palette,
  type Picks,
  type Solid,
} from './drawing-3d'
import { categoryWritingOf } from '../_lib/category-labels'
import { LIFT, raised, useLifted } from './lifting'
import marks from './marks.module.css'
import type { TipAt } from './preview-chrome'
import { useSettledPlan, type Settled } from './settling'
import { Icon } from './icons'
import styles from './plan-canvas.module.css'

// The playground's one canvas — the plan drawn by three.js through ichno's `projection`, to edit and to preview. One
// orthographic camera holds two views of the same room: the plan view, straight down, and the isometric view, from a
// corner with the three axes at one scale, so a metre along a wall is as long in either. Switching between them moves
// the camera, nothing else; the view turns a quarter at a time. A press goes through ichno's `press` core and comes
// out as the editor's taps, drags and strokes, with plan points read off the floor under the pointer. A marquee is a
// box on the screen — on the floor it would show as a diamond — and picks what it touches as it stands. What the
// editor draws over the plan — outlines, handles, smart guides, a tool's stroke — is ichno's own
// <SeatMap.EditorOverlay>, laid on the floor by the projection's own matrix. Drawn as ./drawing-3d.tsx draws.

type Editor = SeatPlanEditor<string>

// What a press means to whoever holds the canvas — <SeatMapViewport>'s handlers, with plan points read off the floor.
type Handlers = Pick<Editor['viewportProps'], 'canDrag' | 'onTargetDrag' | 'onDraw'> & {
  onTap(target: PlanTarget<string> | null, info: { point: PlanPoint | null; additive: boolean }): void
  onHover(point: PlanPoint | null, target: PlanTarget<string> | null, info?: { pixel: number }): void
  // A marquee let go: every object it touched on the screen; `additive` adds them to the selection.
  onMarquee(ids: readonly string[], info: { additive: boolean }): void
}

// Which way the room is seen: straight down, or from a corner.
export type CanvasLook = 'plan' | 'isometric'

// What the site's zoom menu, its keys and the turn buttons ask of the view.
export type CanvasControls = {
  zoomIn(): void
  zoomOut(): void
  fit(): void
  zoomTo(rects: readonly PlanRect[]): boolean
  // How far in, 1 being the whole plan.
  setLevel(level: number): void
  // A quarter turn, 1 to the right.
  turn(by: 1 | -1): void
}

// The plan drawn on the server that the canvas takes over from when it first shows: the plan point in its middle and
// how many screen pixels a plan unit takes there.
export type Handoff = { center: PlanPoint; zoom: number }

export type CanvasView = { level: number; canZoomIn: boolean; canZoomOut: boolean }

export type PlanCanvasProps = {
  // To edit the plan, or to pick places on it the way a customer would.
  mode: 'edit' | 'preview'
  look: CanvasLook
  // The plan as drawn (the drag in progress applied), what the tool would make, and what it would have dropped
  // where it can make nothing (drawn in the colour of what cannot be had).
  plan: SeatPlan<string>
  // The plan as history holds it — it changes when an edit landed, and what the edit changed settles (./settling.ts).
  committed: SeatPlan<string>
  draft: SeatPlan<string> | null
  refused: SeatPlan<string> | null
  // What stands in the selection's colour, a little off the floor: every selected object — grouped ones through
  // their group — or, previewing, the places picked.
  selected: readonly string[]
  conflicts: readonly string[]
  status: Record<string, string>
  // Places that cannot be picked — an empty dashed outline.
  disabled: readonly string[]
  overlay: Editor['overlayProps']
  // What there is to measure — the lengths are written beside it.
  measured: Measured
  // The grid cell while snapping.
  grid: number | null
  // What a press does: select, draw with the editor's tool, or pan (the Hand).
  tool: 'select' | 'draw' | 'hand'
  handlers: Handlers
  onMenu(at: ScreenPoint, target: PlanTarget<string> | null): void
  controlsRef: RefObject<CanvasControls | null>
  // The plan drawn on the server, lying under the canvas until it shows — the camera starts straight above it.
  handoffRef: RefObject<Handoff | null>
  // The first frame with the scene in it is drawn — the plan left underneath can go.
  onShown(): void
  onViewChange(view: CanvasView): void
  fixtureName(fixture: Fixture): string | null
  // Previewing: what is written over the place under the pointer, told where its top shows.
  tip?(id: string, at: TipAt): ReactNode
}

// Where the camera is: over (x, z) on the floor, seen through a projection, `zoom` screen pixels to a drawing unit —
// to a plan unit along an axis, in both views.
type Pose = Projection & { x: number; z: number; zoom: number }

// A camera move under way — a quarter turn, or the way between the two views: from `from` toward `to` over `ms`,
// `elapsed` so far, counted frame by frame (`last` the previous one) — a frame counts for MAX_FRAME_MS at most, so a
// slow one pauses the move instead of skipping part of it. `fade` brings the canvas in over the plan drawn on the
// server; `done` runs when it gets there.
type Motion = {
  from: Pose
  to: Partial<Pose>
  ms: number
  elapsed: number
  last: number | null
  ease(t: number): number
  fade?: 'in'
  done?: () => void
}

type MoveOptions = Partial<Pick<Motion, 'ease' | 'fade' | 'done'>>

export default function PlanCanvas(props: PlanCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const palette = usePalette(hostRef)
  const [failed, setFailed] = useState(false)
  // react-three-fiber's state, for the camera and the canvas size outside the canvas.
  const stageRef = useRef<(() => RootState) | null>(null)
  const [picks] = useState<Picks>(() => new Map())

  // Where the camera is heading: the view it rests in, how many quarters it has turned, and where it is on the way.
  const aimRef = useRef<Pose & { look: CanvasLook; quarter: number }>({
    ...restOf(props.look, 0),
    x: 0,
    z: 0,
    zoom: 1,
    look: props.look,
    quarter: 0,
  })

  const motionRef = useRef<Motion | null>(null)
  // Whether the camera has been put where it starts, and whether it is still coming in over the server's plan.
  const readyRef = useRef(false)
  const enteringRef = useRef(false)
  const reportedRef = useRef<CanvasView | null>(null)
  // Shown in the turn control — the camera itself turns in the frame loop.
  const [quarter, setQuarter] = useState(0)
  // Screen pixels per plan unit once the camera rests — what is written over the plan keeps its distance by it.
  const [zoom, setZoom] = useState(1)
  // The press under way — what it started on and what it does (ichno's `press`).
  const pressRef = useRef<PressState<string>>(IDLE_PRESS)
  const originRef = useRef<{ left: number; top: number } | null>(null)
  const insideRef = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const spaceRef = useRef(false)
  const [panning, setPanning] = useState(false)
  // A drag or a stroke under way — the view scrolls while it is held near the edge.
  const [edging, setEdging] = useState(false)
  const edgeRef = useRef<EdgeScrollState>(IDLE_EDGE_SCROLL)
  // The marquee being drawn, corner to corner in the view's pixels.
  const [sweep, setSweep] = useState<{ from: ScreenPoint; to: ScreenPoint } | null>(null)
  // The place or object under the pointer — a place traces its dashes, anything shows the pointer cursor.
  const [over, setOver] = useState<PlanTarget<string> | null>(null)
  // Previewing: the place under the pointer and where its top shows — what the tip points at.
  const [tipped, setTipped] = useState<{ id: string; at: TipAt } | null>(null)
  // What the editor draws over the plan, in SVG over the canvas.
  const overlayRef = useRef<SVGSVGElement>(null)

  const { plan, handlers } = props
  const previewing = props.mode === 'preview'
  const home = seatPlan.drawingBoundsOf(plan)
  // What an edit added, removed or moved settles (./settling.ts) — the scene is drawn from the plan part-way there,
  // and what goes round the selection waits for it.
  const settled = useSettledPlan(plan, props.committed)

  // ---------- Camera ----------

  function stage(): RootState | null {
    return stageRef.current?.() ?? null
  }

  // The plan point on the floor under a point of the view.
  function floorAt(at: ScreenPoint): PlanPoint | null {
    const size = stage()?.size

    return size ? floorUnder(aimRef.current, size, at) : null
  }

  // What is drawn nearest under a point of the view — a place, a fixture or a wall.
  function targetAt(at: ScreenPoint): PlanTarget<string> | null {
    const state = stage()

    if (!state) return null
    RAY.setFromCamera(NDC.set((at.x / state.size.width) * 2 - 1, -(at.y / state.size.height) * 2 + 1), state.camera)

    for (const hit of RAY.intersectObjects([...picks.keys()], false)) {
      const target = picks.get(hit.object)?.(hit.instanceId)

      if (target) return target
    }

    return null
  }

  // The objects and walls a box on the screen touches as they stand — each footprint raised to its height and seen
  // through the projection, a group's label where its sign stands, a wall cut down.
  function touchedBy(box: PlanRect): string[] {
    const size = stage()?.size

    if (!size) return []
    const aim = aimRef.current
    const heights = new Map(piecesOf(plan).map((piece) => [piece.id, HEIGHT[piece.model]]))

    const objects = plan.objects.flatMap((object) => {
      const levels =
        object.kind === 'label'
          ? [SIGN_HEIGHT]
          : [0, object.kind === 'fixture' && object.role === 'wall' ? WALL_CUT : (heights.get(object.id) ?? 0)]

      const seen = seatPlan.outlineOf(object).flatMap((point) => levels.map((y) => seenAt(aim, size, point, y)))

      return overlapsBox(hullOf(seen), box) ? [object.id] : []
    })

    const walls = plan.walls.flatMap((wall) => {
      const touched = wallsOf({ ...plan, walls: [wall] }).some((stretch) => {
        const seen = cornersOfStretch(stretch).flatMap((point) => [0, WALL_CUT].map((y) => seenAt(aim, size, point, y)))

        return overlapsBox(hullOf(seen), box)
      })

      return touched ? [wall.id] : []
    })

    return [...objects, ...walls]
  }

  // Where a tip for a place goes: over the highest point its top shows at — or under the lowest its foot does, when
  // there is no room above.
  function tipAtOf(id: string): TipAt | null {
    const size = stage()?.size
    const place = seatPlan.objectById(plan, id)

    if (!size || !place || place.kind !== 'place') return null
    const aim = aimRef.current
    const outline = seatPlan.outlineOf(place)
    const middle = seenAt(aim, size, seatPlan.centerOf(place), heightOf(place))
    const top = Math.min(...outline.map((point) => seenAt(aim, size, point, heightOf(place)).y))

    if (top >= TIP_ROOM_PX) return { x: middle.x, y: top }

    return { x: middle.x, y: Math.max(...outline.map((point) => seenAt(aim, size, point, 0).y)), below: true }
  }

  // The zoom that shows the whole drawing in the view the camera is heading for.
  function homeZoom(): number {
    const size = stage()?.size
    const aim = aimRef.current

    return size ? zoomToFit(home, restOf(aim.look, aim.quarter), size) : 1
  }

  function clampZoom(zoom: number): number {
    const least = homeZoom()

    return Math.min(least * MAX_LEVEL, Math.max(least, zoom))
  }

  // Puts the camera where the aim says, at once — the overlay with it, and the tip.
  function place() {
    const state = stage()

    if (!state) return
    const aim = aimRef.current
    const camera = state.camera
    // Kept over the drawing.
    aim.x = Math.min(home.x + home.w, Math.max(home.x, aim.x))
    aim.z = Math.min(home.y + home.h, Math.max(home.y, aim.z))
    // The projection's own directions: the room's y is the camera's z, its height the camera's y. Given its `up`,
    // the camera needs no hint of which way is up — straight down included.
    const { up, toward } = projection.basis(aim)
    camera.position.set(aim.x + toward.x * DISTANCE, toward.z * DISTANCE, aim.z + toward.y * DISTANCE)
    camera.up.set(up.x, up.z, up.y)
    camera.lookAt(aim.x, 0, aim.z)
    camera.zoom = aim.zoom * aim.scale
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    layOverlay(overlayRef.current, aim, state.size)
    state.invalidate()
    setTipped((current) => {
      const at = current === null ? null : tipAtOf(current.id)

      if (current === null || at === null) return null

      return sameSpot(current.at, at) ? current : { id: current.id, at }
    })
  }

  // Frames a rectangle of the plan with `around` plan units of room.
  function show(rect: PlanRect, around: number) {
    const size = stage()?.size

    if (!size) return
    const padded = { x: rect.x - around, y: rect.y - around, w: rect.w + around * 2, h: rect.h + around * 2 }
    const aim = aimRef.current
    aim.x = rect.x + rect.w / 2
    aim.z = rect.y + rect.h / 2
    aim.zoom = clampZoom(zoomToFit(padded, restOf(aim.look, aim.quarter), size))
    place()
  }

  function middle(): ScreenPoint {
    const size = stage()?.size

    return size ? { x: size.width / 2, y: size.height / 2 } : { x: 0, y: 0 }
  }

  // Zooms by `factor` keeping the floor under `about` (view pixels) where it is.
  function zoomAbout(about: ScreenPoint, factor: number) {
    const before = floorAt(about)
    const aim = aimRef.current
    aim.zoom = clampZoom(aim.zoom * factor)
    const after = floorAt(about)

    if (before && after) {
      aim.x += before.x - after.x
      aim.z += before.y - after.y
    }

    place()
  }

  // Moves the view with the pointer — the floor under it stays under it.
  function panBy(delta: ScreenPoint) {
    const at = middle()
    const from = floorAt(at)
    const to = floorAt({ x: at.x + delta.x, y: at.y + delta.y })

    if (!from || !to) return
    const aim = aimRef.current
    aim.x -= to.x - from.x
    aim.z -= to.y - from.y
    place()
  }

  // Moves the camera toward `to` over `ms` — at once when motion is reduced — carrying on with the move under way, so
  // a turn during the way between the views still ends where both lead.
  function move(to: Partial<Pose>, ms: number, { ease = easeOut, fade, done }: MoveOptions = {}) {
    const aim = aimRef.current
    const under = motionRef.current
    const target = { ...under?.to, ...to }

    const finish = () => {
      under?.done?.()
      done?.()
    }

    if (reducedMotion()) {
      motionRef.current = null
      Object.assign(aim, target)
      place()
      finish()

      return
    }

    motionRef.current = { from: poseOf(aim), to: target, ms, elapsed: 0, last: null, ease, fade, done: finish }
    place()
  }

  function turn(by: 1 | -1) {
    const aim = aimRef.current
    aim.quarter += by
    setQuarter(aim.quarter)
    move({ azimuth: restOf(aim.look, aim.quarter).azimuth }, TURN_MS)
  }

  // Goes over to the other view. Both draw a plan unit along an axis `zoom` pixels long, so the zoom holds and what
  // was a metre stays a metre — unless the whole plan was showing, which then still does.
  function lookAs(look: CanvasLook) {
    const aim = aimRef.current
    const whole = aim.zoom <= homeZoom() * 1.001
    aim.look = look
    move({ ...restOf(look, aim.quarter), zoom: whole ? homeZoom() : clampZoom(aim.zoom) }, SWITCH_MS, {
      ease: easeInOut,
    })
  }

  // Takes over from the plan drawn on the server: straight down over the same spot at the same scale, this view
  // draws what that one drew in the same places, so the canvas first comes in over it with the camera still, then,
  // that plan gone, moves into the view it opens in with the whole plan showing.
  function enter(from: Handoff) {
    const aim = aimRef.current
    enteringRef.current = true
    Object.assign(aim, projection.plan(aim.quarter), { x: from.center.x, z: from.center.y, zoom: from.zoom })
    place()
    move({}, FADE_MS, {
      fade: 'in',
      done: () => {
        enteringRef.current = false
        props.onShown()
        const now = aimRef.current
        move({ ...restOf(now.look, now.quarter), zoom: homeZoom() }, SWITCH_MS, { ease: easeInOut })
      },
    })
  }

  // The view asked for changed — the camera goes there, once it is in.
  const onLook = useEffectEvent((look: CanvasLook) => {
    const aim = aimRef.current

    if (aim.look === look) return

    if (readyRef.current && !enteringRef.current) lookAs(look)
    else aim.look = look
  })

  useEffect(() => {
    onLook(props.look)
  }, [props.look])

  // Every frame: where the camera starts once the canvas has a size — over the server's plan, or the whole plan —
  // the move under way, and, once nothing moves, the zoom as the site shows it (reported every frame of a move, it
  // would redraw the whole workspace every frame).
  function onFrame() {
    const state = stage()

    if (!state || state.size.width === 0) return
    const aim = aimRef.current

    if (!readyRef.current) {
      // Not before the scene is there — this frame is the first anyone sees.
      if (state.scene.children.length === 0) return
      readyRef.current = true
      const handoff = props.handoffRef.current

      if (handoff) enter(handoff)
      else {
        props.onShown()
        show(home, 0)
      }
    }

    const motion = motionRef.current

    if (motion) {
      const now = performance.now()
      motion.elapsed += motion.last === null ? 0 : Math.min(now - motion.last, MAX_FRAME_MS)
      motion.last = now
      const t = Math.min(1, motion.elapsed / motion.ms)
      const eased = motion.ease(t)

      for (const key of POSE_KEYS) {
        const to = motion.to[key]

        if (to === undefined) continue
        const from = motion.from[key]
        // Zoom moves by ratios, so zooming in and out feel the same.
        aim[key] = key === 'zoom' ? from * (to / from) ** eased : from + (to - from) * eased
      }

      state.gl.domElement.style.opacity = String(motion.fade === 'in' ? t : 1)

      if (t === 1) {
        motionRef.current = null
        motion.done?.()
      }

      place()
    }

    if (motionRef.current) return
    const least = homeZoom()

    const view = {
      level: aim.zoom / least,
      canZoomIn: aim.zoom < least * MAX_LEVEL * 0.999,
      canZoomOut: aim.zoom > least * 1.001,
    }

    const last = reportedRef.current

    if (
      !last ||
      Math.abs(last.level - view.level) > 0.001 ||
      last.canZoomIn !== view.canZoomIn ||
      last.canZoomOut !== view.canZoomOut
    ) {
      reportedRef.current = view
      setZoom(aim.zoom)
      props.onViewChange(view)
    }
  }

  useEffect(() => {
    const ref = props.controlsRef
    ref.current = {
      zoomIn: () => zoomAbout(middle(), BUTTON_STEP),
      zoomOut: () => zoomAbout(middle(), 1 / BUTTON_STEP),
      fit: () => show(home, 0),
      zoomTo: (rects) => {
        if (rects.length === 0) return false
        show(unionOf(rects), ZOOM_TO_PADDING)

        return true
      },
      setLevel: (level) => zoomAbout(middle(), (homeZoom() * level) / aimRef.current.zoom),
      turn,
    }

    return () => {
      ref.current = null
    }
  })

  // ---------- Pressing ----------

  // The pointer in the view's pixels. The view's place on the page is read once per gesture.
  function pointerOf(e: PointerEvent<HTMLDivElement>, refresh = false): PressPointer {
    if (refresh || !originRef.current) {
      const rect = e.currentTarget.getBoundingClientRect()
      originRef.current = { left: rect.left, top: rect.top }
    }

    const origin = originRef.current

    return {
      id: e.pointerId,
      x: e.clientX - origin.left,
      y: e.clientY - origin.top,
      type: e.pointerType,
      button: e.button,
      buttons: e.buttons,
    }
  }

  // What a press means here (ichno's `press`): plan points are read off the floor, and a screen pixel spans what the
  // camera's zoom makes it. Space and the Hand pan whatever is under the pointer.
  function envOf(): PressEnv<string> {
    return {
      toPlan: floorAt,
      pixel: 1 / aimRef.current.zoom,
      draws: handlers.onDraw !== undefined,
      // Previewing, a drag selects nothing — it moves the view.
      marquees: !previewing,
      pans: true,
      grabs: spaceRef.current || props.tool === 'hand',
      canDrag: handlers.canDrag,
    }
  }

  // Hands a drag or a stroke on to the editor, and draws the marquee — a box on the screen — picking what it touches
  // once it is let go.
  function report(event: PressEvent<string>) {
    if (event.type === 'drag') handlers.onTargetDrag(event.drag)
    else if (event.type === 'draw')
      handlers.onDraw?.(event.stroke, { phase: event.phase, ...event.keys, pixel: event.pixel })
    else if (event.type === 'marquee' && event.phase !== 'end') setSweep({ from: event.from, to: event.to })
    else if (event.type === 'marquee') {
      setSweep(null)
      handlers.onMarquee(touchedBy(boxBetween(event.from, event.to)), { additive: event.additive })
    }
  }

  // The view moved under a drag (the wheel, edge scrolling) — what is dragged keeps up with the pointer.
  function restate() {
    for (const event of press.restate(pressRef.current, envOf())) report(event)
  }

  // Takes a step of the press and acts on what it means.
  function act(result: PressResult<string>) {
    pressRef.current = result.state

    for (const event of result.events) {
      switch (event.type) {
        case 'tap':
          // The Hand only pans.
          if (props.tool !== 'hand') handlers.onTap(event.target, { point: event.point, additive: event.additive })
          break
        case 'pan':
          setPanning(event.phase !== 'end')

          if (event.phase === 'move') panBy(event.delta)
          break
        case 'pinch':
          zoomAbout(event.center, event.factor)
          panBy(event.delta)
          break
        case 'hold':
          // A marquee is a box on the screen — scrolling the floor under it would move what it began on.
          setEdging(event.held && result.state.mode !== 'marquee')
          break
        default:
          report(event)
      }
    }
  }

  // What is under a point of the view: a handle is the overlay's own element, anything else is found in the scene.
  function targetOn(element: EventTarget | null, at: ScreenPoint): PlanTarget<string> | null {
    return planTargetOf<string>(element) ?? targetAt(at)
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    const middleButton = e.pointerType === 'mouse' && e.button === 1

    // The right button opens the menu (onContextMenu).
    if (e.pointerType === 'mouse' && e.button !== 0 && !middleButton) return

    if (middleButton) e.preventDefault()
    const idle = pressRef.current.gesture.kind === 'idle'
    const pointer = pointerOf(e, idle)
    // Only the first pointer lands on something — a second one pinches.
    const target = idle ? targetOn(e.target, pointer) : null
    e.currentTarget.setPointerCapture(e.pointerId)
    act(press.down(pressRef.current, pointer, target, press.keysOf(e), envOf()))
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (pressRef.current.gesture.kind !== 'idle') {
      act(press.move(pressRef.current, pointerOf(e), press.keysOf(e), envOf()))

      return
    }

    insideRef.current = true
    const at = pointerOf(e, true)
    const target = targetOn(e.target, at)
    handlers.onHover(floorAt(at), target, { pixel: 1 / aimRef.current.zoom })
    // Previewing, only a place that can be picked answers the pointer.
    const pickable = target?.kind === 'place' && !props.disabled.includes(target.id) ? target : null
    const next = previewing ? pickable : target?.kind === 'place' || target?.kind === 'object' ? target : null
    setOver((current) => (sameTarget(current, next) ? current : next))
    const tipAt = previewing && pickable ? tipAtOf(pickable.id) : null
    setTipped((current) => {
      if (pickable === null || tipAt === null) return null

      return current?.id === pickable.id && sameSpot(current.at, tipAt) ? current : { id: pickable.id, at: tipAt }
    })
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    act(press.up(pressRef.current, pointerOf(e), press.keysOf(e), envOf()))
  }

  function handlePointerCancel(e: { pointerId: number }) {
    act(press.cancel(pressRef.current, { id: e.pointerId }, envOf()))
  }

  function handlePointerLeave() {
    insideRef.current = false

    if (pressRef.current.gesture.kind !== 'idle') return
    handlers.onHover(null, null)
    setOver(null)
    setTipped(null)
  }

  // Scrolling pans and pinching (or ⌘/Ctrl with the wheel) zooms, as on the 2D canvas. React's wheel handler is
  // passive, so it is added by hand.
  const onWheel = useEffectEvent((e: WheelEvent) => {
    e.preventDefault()
    const dx = wheelPixels(e.deltaX, e.deltaMode)
    const dy = wheelPixels(e.deltaY, e.deltaMode)

    if (e.ctrlKey || e.metaKey) {
      const host = hostRef.current

      if (!host || dy === 0) return
      const rect = host.getBoundingClientRect()
      const factor = Math.exp(-dy * (e.ctrlKey ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE))
      zoomAbout({ x: e.clientX - rect.left, y: e.clientY - rect.top }, Math.min(1.1, Math.max(1 / 1.1, factor)))
    } else {
      // Shift turns a plain wheel sideways where the browser does not already.
      panBy(e.shiftKey && dx === 0 ? { x: -dy, y: 0 } : { x: -dx, y: -dy })
    }

    restate()
  })

  // Safari reports a trackpad pinch as gesture events — the scale since it began.
  const pinchRef = useRef(1)

  const onGesture = useEffectEvent((e: SafariGesture) => {
    e.preventDefault()

    // On a touch screen Safari sends them too, for the fingers whose pointers already pinch.
    if (pressRef.current.touches.length > 0) return

    if (e.type === 'gesturestart') pinchRef.current = 1

    if (e.type !== 'gesturechange') return
    const factor = e.scale / pinchRef.current
    pinchRef.current = e.scale
    const host = hostRef.current

    if (!host || !(factor > 0) || !Number.isFinite(factor)) return
    const rect = host.getBoundingClientRect()
    zoomAbout({ x: e.clientX - rect.left, y: e.clientY - rect.top }, factor)
    restate()
  })

  useEffect(() => {
    const host = hostRef.current

    if (!host) return
    const wheel = (e: WheelEvent) => onWheel(e)
    const pinch = (e: SafariGesture) => onGesture(e)
    host.addEventListener('wheel', wheel, { passive: false })

    for (const type of GESTURE_EVENTS) host.addEventListener(type, pinch)

    return () => {
      host.removeEventListener('wheel', wheel)

      for (const type of GESTURE_EVENTS) host.removeEventListener(type, pinch)
    }
  }, [])

  // Space held over the view pans whatever the tool; Shift, Alt, ⌘ and Ctrl pressed or let go mid-drag reshape the
  // drag at once.
  const onWindowKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Control') {
      act(press.keys(pressRef.current, press.keysOf(e), envOf()))

      return
    }

    if (e.code !== 'Space' || isTyping(e.target)) return
    const down = e.type === 'keydown'

    if (down && !insideRef.current) return

    if (insideRef.current) e.preventDefault()

    if (spaceRef.current === down) return
    spaceRef.current = down
    setSpaceHeld(down)
  })

  useEffect(() => {
    const key = (e: KeyboardEvent) => onWindowKey(e)

    const blur = () => {
      spaceRef.current = false
      setSpaceHeld(false)
    }

    window.addEventListener('keydown', key)
    window.addEventListener('keyup', key)
    window.addEventListener('blur', blur)

    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', key)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // Escape lets go of a marquee — the editor never sees this one, so the key is taken before its shortcuts would
  // clear the selection instead.
  const onEscape = useEffectEvent((e: KeyboardEvent) => {
    const current = pressRef.current

    if (e.key !== 'Escape' || current.mode !== 'marquee' || current.gesture.kind !== 'dragging') return
    e.preventDefault()
    pressRef.current = press.drop(current)
    setSweep(null)
  })

  useEffect(() => {
    const key = (e: KeyboardEvent) => onEscape(e)
    window.addEventListener('keydown', key, true)

    return () => window.removeEventListener('keydown', key, true)
  }, [])

  // Edge scrolling, as on the 2D canvas: while a drag or a stroke is held near the edge the view moves toward it —
  // as far as the camera stays over the drawing.
  const onEdgeFrame = useEffectEvent((now: number) => {
    const stepped = edgeScroll.step(edgeRef.current, pressRef.current.at, stage()?.size ?? null, now)
    edgeRef.current = stepped.state

    if (!stepped.scroll) return
    panBy({ x: -stepped.scroll.x, y: -stepped.scroll.y })
    restate()
  })

  useEffect(() => {
    if (!edging) return
    edgeRef.current = IDLE_EDGE_SCROLL

    return everyFrame((now) => {
      onEdgeFrame(now)

      return true
    })
  }, [edging])

  const hoveredPlace = props.tool === 'select' && over?.kind === 'place' ? over.id : null
  // The view at rest: how a direction on the plan turns on the screen, and the way the bottom of the screen lies on
  // the plan — lengths are written level, a box's size beyond its nearest corner (under it, seen straight down with
  // the plan's top up).
  const rest = restOf(props.look, quarter)
  const floor = projection.floorMatrix(rest)
  const handles = props.overlay.handles.map((handle) => turnedHandle(handle, floor))
  const toward = unit(projection.toFloor(rest, { x: 0, y: 1 }))
  const level = props.look === 'plan' && quarter % 4 === 0

  const lengths = dimensionLabelsOf(
    props.measured,
    OFF_PX / (zoom * stretchOf(floor, toward)),
    level ? undefined : toward,
  )

  return (
    <div
      ref={hostRef}
      className={styles.canvas}
      data-mode={props.mode}
      data-tool={props.tool}
      data-pan={panning ? 'active' : spaceHeld ? 'ready' : undefined}
      data-over={(props.tool === 'select' && over !== null) || undefined}
      role="application"
      aria-label={previewing ? 'Seat plan preview' : 'Seat plan editor'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={(e) => {
        // Capture ends with every release; lost while a press still follows this pointer, the release is not coming.
        if (press.holds(pressRef.current, e.pointerId)) handlePointerCancel(e)
      }}
      onPointerLeave={handlePointerLeave}
      onContextMenu={(e) => {
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        props.onMenu({ x: e.clientX, y: e.clientY }, targetAt({ x: e.clientX - rect.left, y: e.clientY - rect.top }))
      }}
      onKeyDown={(e: ReactKeyboardEvent) => {
        // Space is held to pan — it must not scroll the page.
        if (e.key === ' ') e.preventDefault()
      }}
    >
      {failed ? (
        <p className={styles.message}>This browser could not start WebGL, which draws the plan here.</p>
      ) : (
        <Fallback onError={() => setFailed(true)}>
          <Canvas orthographic frameloop="demand" flat dpr={[1, 2]} camera={{ near: 1, far: DISTANCE * 4 }}>
            <Stage stageRef={stageRef} onFrame={onFrame} />
            {palette && (
              <Scene {...props} settled={settled} palette={palette} picks={picks} hoveredPlace={hoveredPlace} />
            )}
          </Canvas>
        </Fallback>
      )}

      {/* What the editor draws over the plan — ichno's own overlay, laid on the floor by the projection's matrix
          (`layOverlay`), with the lengths written level beside what they measure. It waits for what it goes round to
          get where an edit put it. The marquee is a box on the screen. */}
      <svg ref={overlayRef} className={styles.overlay} aria-hidden>
        {!settled.gliding && (
          <g className={styles.floor}>
            <SeatMap.EditorOverlay {...props.overlay} handles={handles} marquee={null} />
            <g className={marks.dimensions} fontSize={TEXT_PX} strokeWidth={3}>
              {lengths.map((length, i) => (
                <g key={i} transform={`translate(${length.at.x} ${length.at.y})`}>
                  <text className={styles.level} data-live={length.live || undefined}>
                    {length.text}
                  </text>
                </g>
              ))}
            </g>
          </g>
        )}
        {sweep && <rect className={styles.sweep} {...rectAttributes(boxBetween(sweep.from, sweep.to))} />}
      </svg>

      {tipped && props.tip?.(tipped.id, tipped.at)}

      <div className={styles.turn} role="group" aria-label="Turn the view">
        <button
          type="button"
          className={controls.iconButton}
          aria-label="Turn the view left (,)"
          title="Turn the view left (,)"
          onClick={() => turn(-1)}
        >
          <Icon name="turnLeft" />
        </button>
        <span className={styles.compass} title="Which way north is">
          <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden>
            <circle cx={12} cy={12} r={9.5} />
            <g style={{ transform: `rotate(${northOf(floor, quarter)}deg)`, transformOrigin: '12px 12px' }}>
              <path d="M12 12V4.5" />
              <path d="M12 12v7.5" data-south="" />
              <circle cx={12} cy={4.5} r={1.6} data-tip="" />
            </g>
          </svg>
        </span>
        <button
          type="button"
          className={controls.iconButton}
          aria-label="Turn the view right (.)"
          title="Turn the view right (.)"
          onClick={() => turn(1)}
        >
          <Icon name="rotate" />
        </button>
      </div>
    </div>
  )
}

// Hands react-three-fiber's state out of the canvas and runs the view's frame work before each frame is drawn.
function Stage({ stageRef, onFrame }: { stageRef: RefObject<(() => RootState) | null>; onFrame(): void }) {
  const get = useThree((state) => state.get)
  useLayoutEffect(() => {
    stageRef.current = get

    return () => {
      stageRef.current = null
    }
  }, [get, stageRef])
  useFrame(() => onFrame(), -1)

  return null
}

// ---------- Scene ----------

type SceneProps = PlanCanvasProps & {
  // The plan part-way to where an edit put it (./settling.ts).
  settled: Settled<string>
  palette: Palette
  picks: Picks
  hoveredPlace: string | null
}

function Scene({ plan, draft, refused, settled, palette, picks, hoveredPlace, ...props }: SceneProps) {
  // The objects and what is written by them are drawn from the settling plan. Walls are drawn as they are — their
  // stretches are numbered along the plan, so one more renumbers the rest.
  const pieces = piecesOf(settled.plan)
  // A door the tool would put in a wall opens it already — the draft holds that wall with the opening.
  const opened = new Map((draft?.walls ?? []).map((wall) => [wall.id, wall]))
  const walls = wallsOf(opened.size === 0 ? plan : { ...plan, walls: plan.walls.map((w) => opened.get(w.id) ?? w) })
  const selected = new Set(props.selected)
  // What is selected — or picked — stands a little off the floor (./lifting.ts).
  const lifted = useLifted(selected)
  const conflicts = new Set(props.conflicts)
  const disabled = new Set(props.disabled)
  const reach = Math.hypot(plan.width, plan.height)

  const lookOf = (id: string, place: Piece['place']): Look => {
    // An overlap shows on a selected place too — it is what a drag is about to settle.
    if (selected.has(id)) return { fill: palette.accent, line: conflicts.has(id) ? 'warning' : 'edge' }

    if (conflicts.has(id)) return { fill: palette.warningFill, line: 'warning' }

    // What cannot be picked is an empty dashed outline; what is booked, while editing, keeps its face.
    if (place && disabled.has(id)) return { fill: null, line: 'label', dash: true }

    if (place && props.status[id] !== undefined) return { fill: palette.solid, line: 'edge', dash: true }

    if (id === hoveredPlace) return { fill: palette.solid, line: 'edge', dash: true, march: true }

    return { fill: palette.solid, line: 'edge' }
  }

  // What stands on the floor — it casts the shade; the walls, which run the floor's length, do not.
  const standing = pieces.map((piece): Solid => {
    const solid = solidOf(
      piece,
      lookOf(piece.id, piece.place),
      // What is on its way out is no longer there to pick.
      settled.leaving.has(piece.id) ? undefined : { kind: piece.place ? 'place' : 'object', id: piece.id },
    )

    const grow = settled.grow.get(piece.id)
    const lift = lifted.get(piece.id)

    return grow === undefined && lift === undefined ? solid : { ...solid, grow, lift: (lift ?? 0) * LIFT }
  })

  const solids = [
    ...standing,
    // Cut down so the rooms show.
    ...walls.map((wall, i) => wallOf(wall, i, lookOf(wall.id, null), { kind: 'wall', id: wall.id })),
  ]

  const ghostLook = (id: string): Look =>
    conflicts.has(id)
      ? { fill: palette.warningFill, line: 'warning', dash: true }
      : { fill: palette.solid, line: 'edge', dash: true }

  const refusedLook: Look = { fill: palette.warningFill, line: 'warning', dash: true }

  const ghosts = [
    ...(draft === null
      ? []
      : [
          ...piecesOf(draft).map((piece) => solidOf(piece, ghostLook(piece.id))),
          // A new wall — not one the draft only opens.
          ...wallsOf({ ...draft, walls: draft.walls.filter((w) => !seatPlan.wallOf(plan, w.id)) }).map((wall, i) =>
            wallOf(wall, i, ghostLook(wall.id)),
          ),
        ]),
    ...(refused === null
      ? []
      : [
          ...piecesOf(refused).map((piece) => solidOf(piece, refusedLook)),
          ...wallsOf(refused).map((wall, i) => wallOf(wall, i, refusedLook)),
        ]),
  ]

  // Each place's number on its seat, in the ink of what it is written on.
  const numbers = numbersOf(pieces).map((number) => {
    const lift = (lifted.get(number.id) ?? 0) * LIFT

    return {
      ...number,
      y: number.y + lift,
      grow: settled.grow.get(number.id) ?? 1,
      color: selected.has(number.id) ? palette.onAccent : disabled.has(number.id) ? palette.text : palette.onSolid,
    }
  })

  return (
    <>
      <color attach="background" args={[palette.ground]} />
      <Daylight />
      {/* The ground is the page's own colour, unlit so it meets the background. */}
      <mesh position={[plan.width / 2, -1, plan.height / 2]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[reach * 12, reach * 12]} />
        <meshBasicMaterial color={palette.ground} />
      </mesh>
      {seatPlan.roomsOf(plan).map((room, i) => (
        <Floor key={i} points={room.points} color={palette.floor} />
      ))}
      {props.grid !== null && <Grid plan={plan} cell={props.grid} palette={palette} />}
      <Shade solids={standing} />
      <Solids solids={solids} palette={palette} picks={picks} />
      <Solids solids={ghosts} palette={palette} ghost />
      <Numbers numbers={numbers} font={palette.numberFont} />
      {[...writingOf(settled.plan, pieces, props.fixtureName), ...categoryWritingOf(props.committed)].map(
        (writing, i) => (
          <Text
            key={i}
            writing={raised(writing, lifted)}
            // What is written on something that stands there, or on the floor itself.
            color={writing.on === undefined ? palette.text : palette.onSolid}
            font={palette.font}
          />
        ),
      )}
    </>
  )
}

function solidOf(piece: Piece, look: Look, target?: PlanTarget<string>): Solid {
  return {
    id: piece.id,
    model: piece.model,
    round: piece.shape === 'ellipse',
    x: piece.x,
    z: piece.z,
    w: piece.w,
    d: piece.d,
    yaw: piece.yaw,
    look,
    target,
  }
}

// One stretch of a wall — the `index`th of the walls drawn.
function wallOf(wall: Wall, index: number, look: Look, target?: PlanTarget<string>): Solid {
  return {
    id: `${wall.id}:${index}`,
    model: 'wall',
    round: false,
    x: wall.x,
    z: wall.z,
    w: wall.w,
    d: wall.d,
    yaw: wall.yaw,
    h: WALL_CUT,
    look,
    target,
  }
}

// The editor's grid on the floor, dashed.
function Grid({ plan, cell, palette }: { plan: SeatPlan<string>; cell: number; palette: Palette }) {
  const [geometry] = useState(() => new BufferGeometry())
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => () => geometry.dispose(), [geometry])
  useLayoutEffect(() => {
    const lines: PlanPoint[][] = []

    for (let x = cell; x < plan.width; x += cell)
      lines.push([
        { x, y: 0 },
        { x, y: plan.height },
      ])

    for (let y = cell; y < plan.height; y += cell)
      lines.push([
        { x: 0, y },
        { x: plan.width, y },
      ])
    setSegments(geometry, floorSegments(lines, false, FLOOR_GRID))
    invalidate()
  }, [plan.width, plan.height, cell, geometry, invalidate])

  return <Hairlines geometry={geometry} color={palette.grid} look={{ fill: null, line: 'grid', dash: true }} />
}

// ---------- Helpers ----------

// A quarter turn answers a key at once and settles; the way between the two views starts and ends at rest.
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2
}

function poseOf(aim: Pose): Pose {
  return {
    x: aim.x,
    z: aim.z,
    zoom: aim.zoom,
    azimuth: aim.azimuth,
    elevation: aim.elevation,
    scale: aim.scale,
  }
}

// A view at rest after `quarter` quarter turns — ichno's definition of each (`projection`).
function restOf(look: CanvasLook, quarter: number): Projection {
  return look === 'plan' ? projection.plan(quarter) : projection.isometric(quarter)
}

// Where a point of the room shows in the view, in its pixels: the camera looks at (x, z) in the middle of the view.
function seenAt(aim: Pose, size: ViewportSize, point: PlanPoint, height: number): ScreenPoint {
  const seen = projection.toScreen(aim, { x: point.x - aim.x, y: point.y - aim.z, z: height })

  return { x: size.width / 2 + seen.x * aim.zoom, y: size.height / 2 + seen.y * aim.zoom }
}

// The floor point under a point of the view — `seenAt` the other way.
function floorUnder(aim: Pose, size: ViewportSize, at: ScreenPoint): PlanPoint {
  const on = projection.toFloor(aim, {
    x: (at.x - size.width / 2) / aim.zoom,
    y: (at.y - size.height / 2) / aim.zoom,
  })

  return { x: aim.x + on.x, y: aim.z + on.y }
}

// Where north points on screen, in degrees clockwise from up — counted on round with the quarters turned, so a turn
// swings the compass the short way.
function northOf([, , c, d]: FloorMatrix, quarter: number): number {
  const degrees = (Math.atan2(-c, -d) * 180) / Math.PI

  return (((degrees % 360) + 360) % 360) + 360 * Math.floor(quarter / 4)
}

// The zoom (screen pixels per drawing unit) at which `rect`, walls and all, fills the view.
function zoomToFit(rect: PlanRect, view: Projection, size: ViewportSize): number {
  const seen = projection.extent(view, rect, WALL_CUT)

  return Math.min(size.width / Math.max(seen.w, 1), size.height / Math.max(seen.h, 1)) * FIT_MARGIN
}

function unionOf(rects: readonly PlanRect[]): PlanRect {
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w))
  const y1 = Math.max(...rects.map((r) => r.y + r.h))

  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// The box between two points of the view, in its pixels.
function boxBetween(a: ScreenPoint, b: ScreenPoint): PlanRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

function rectAttributes(box: PlanRect) {
  return { x: box.x, y: box.y, width: box.w, height: box.h }
}

// Lays the overlay on the floor. A parallel projection maps the floor to the screen with one matrix — ichno's
// `projection.floorMatrix`, at the camera's zoom, about the point the camera looks at — so `--floor` puts plan units
// on the screen exactly where the canvas draws them, and `--level` undoes its turn and its scale for text written
// level at a point of the plan (plan-canvas.module.css reads both).
function layOverlay(overlay: SVGSVGElement | null, aim: Pose, size: ViewportSize) {
  if (!overlay) return
  const [a, b, c, d] = projection.floorMatrix(aim).map((value) => value * aim.zoom)
  const e = size.width / 2 - (a! * aim.x + c! * aim.z)
  const f = size.height / 2 - (b! * aim.x + d! * aim.z)
  const area = a! * d! - b! * c!
  overlay.style.setProperty('--floor', `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`)

  if (Math.abs(area) > 1e-12) {
    overlay.style.setProperty('--level', `matrix(${d! / area}, ${-b! / area}, ${-c! / area}, ${a! / area}, 0, 0)`)
  }
}

// A handle whose cursor points the way it does on the screen: a direction on the plan, through the floor's matrix.
function turnedHandle(handle: PlanHandle<string>, [a, b, c, d]: FloorMatrix): PlanHandle<string> {
  if (handle.angle === undefined) return handle
  const turn = (handle.angle * Math.PI) / 180
  const x = Math.cos(turn)
  const y = Math.sin(turn)

  return { ...handle, angle: (Math.atan2(b * x + d * y, a * x + c * y) * 180) / Math.PI }
}

// How long a unit step along `direction` on the plan is on the drawing.
function stretchOf([a, b, c, d]: FloorMatrix, direction: PlanPoint): number {
  return Math.hypot(a * direction.x + c * direction.y, b * direction.x + d * direction.y)
}

function unit(point: PlanPoint): PlanPoint {
  const length = Math.hypot(point.x, point.y) || 1

  return { x: point.x / length, y: point.y / length }
}

// The convex outline round points of the view (Andrew's monotone chain).
function hullOf(points: readonly ScreenPoint[]): ScreenPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)

  const half = (list: readonly ScreenPoint[]) => {
    const chain: ScreenPoint[] = []

    for (const p of list) {
      while (chain.length >= 2 && turnOf(chain.at(-2)!, chain.at(-1)!, p) <= 0) chain.pop()
      chain.push(p)
    }

    chain.pop()

    return chain
  }

  return [...half(sorted), ...half([...sorted].reverse())]
}

function turnOf(o: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

// Whether a convex outline and a box of the view touch — no axis of either parts them.
function overlapsBox(hull: readonly ScreenPoint[], box: PlanRect): boolean {
  if (hull.length === 0) return false

  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ]

  const axes = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    ...hull.map((p, i) => {
      const q = hull[(i + 1) % hull.length]!

      return { x: q.y - p.y, y: p.x - q.x }
    }),
  ]

  return axes.every((axis) => {
    const a = spanOf(hull, axis)
    const b = spanOf(corners, axis)

    return a.min <= b.max && b.min <= a.max
  })
}

type Span = { min: number; max: number }

function spanOf(points: readonly ScreenPoint[], axis: ScreenPoint): Span {
  let min = Infinity
  let max = -Infinity

  for (const p of points) {
    const d = p.x * axis.x + p.y * axis.y
    min = Math.min(min, d)
    max = Math.max(max, d)
  }

  return { min, max }
}

// The corners of a stretch of wall on the floor — `w` along its yaw, `d` across.
function cornersOfStretch(stretch: Wall): PlanPoint[] {
  const along = { x: Math.cos(stretch.yaw), y: -Math.sin(stretch.yaw) }
  const across = { x: -along.y, y: along.x }

  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => ({
    x: stretch.x + (along.x * stretch.w * u! + across.x * stretch.d * v!) / 2,
    y: stretch.z + (along.y * stretch.w * u! + across.y * stretch.d * v!) / 2,
  }))
}

function sameTarget(a: PlanTarget<string> | null, b: PlanTarget<string> | null): boolean {
  if (a === null || b === null) return a === b

  return a.kind === b.kind && 'id' in a && 'id' in b && a.id === b.id
}

// Whether a tip stays where it was, to within half a pixel.
function sameSpot(a: TipAt, b: TipAt): boolean {
  return a.below === b.below && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, select, [contenteditable], dialog') !== null
}

function wheelPixels(delta: number, mode: number): number {
  return mode === 1 ? delta * 40 : mode === 2 ? delta * 800 : delta
}

// How far back the camera stands — an orthographic camera draws the same at any distance; it only has to clear the
// drawing.
const DISTANCE = 100_000

const TURN_MS = 200

// The way between the plan view and the isometric one, and the canvas coming in over the plan drawn on the server.
const SWITCH_MS = 300

const FADE_MS = 160

// The most a frame counts for in a move — 30 frames a second.
const MAX_FRAME_MS = 1000 / 30

const POSE_KEYS = ['x', 'z', 'zoom', 'azimuth', 'elevation', 'scale'] as const

// How far in the zoom goes, the zoom buttons' step, and the room left round what zoomTo frames.
const MAX_LEVEL = 6

const BUTTON_STEP = 1.5

const ZOOM_TO_PADDING = GRID_CELL * 2

const FIT_MARGIN = 0.92

const WHEEL_ZOOM_RATE = Math.log(1.1) / 100

const PINCH_ZOOM_RATE = 0.01

const FLOOR_GRID = 0.25

// The room a tip needs above a place, in screen pixels.
const TIP_ROOM_PX = 64

const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const

// Safari's trackpad pinch: the scale since it began, about a point. The DOM types leave these events out.
type SafariGesture = UIEvent & { readonly scale: number; readonly clientX: number; readonly clientY: number }

declare global {
  interface HTMLElementEventMap {
    gesturestart: SafariGesture
    gesturechange: SafariGesture
    gestureend: SafariGesture
  }
}

const RAY = new Raycaster()

const NDC = new Vector2()
