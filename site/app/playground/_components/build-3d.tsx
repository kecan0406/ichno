'use client'

import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber'
import {
  GRID_CELL,
  IDLE_GESTURE,
  TOUCH_DRAG_THRESHOLD_PX,
  gesture,
  seatPlan,
  type Fixture,
  type GestureEvent,
  type GestureState,
  type PlanPoint,
  type PlanRect,
  type PlanTarget,
  type ScreenPoint,
  type SeatPlan,
} from 'ichno'
import type { SeatPlanEditor } from 'ichno/editor'
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import { BufferGeometry, Plane, Raycaster, Vector2, Vector3, type Color } from 'three'
import { HEIGHT, SIGN_HEIGHT, WALL_CUT, piecesOf, wallsOf, writingOf, type Piece, type Wall } from '../_lib/scene'
import controls from './controls.module.css'
import {
  Daylight,
  Fallback,
  Floor,
  Hairlines,
  Solids,
  Text,
  floorSegments,
  reducedMotion,
  setSegments,
  usePalette,
  type Look,
  type Palette,
  type Picks,
  type Solid,
} from './drawing-3d'
import { Icon } from './icons'
import styles from './build-3d.module.css'

// The playground's editor in 3D — the same ichno editor the 2D canvas drives, seen from a corner the way a tycoon
// game shows its park. The view turns a quarter at a time; a press goes through ichno's gesture core and comes out as
// the editor's taps, drags and strokes, with plan points read off the floor under the pointer. A marquee is a box on
// the screen — on the floor it would show as a diamond — and picks what it touches as it stands. Handles stay in 2D. Drawn like the 2D plan (./drawing-3d.tsx); loaded only when someone switches to it.

type Editor = SeatPlanEditor<string>
// What a press means to the editor — <SeatMap.Viewport>'s handlers, with plan points read off the floor.
type Handlers = Pick<Editor['viewportProps'], 'canDrag' | 'onTargetDrag' | 'onDraw'> & {
  onTap(target: PlanTarget<string> | null, info: { point: PlanPoint | null; additive: boolean }): void
  onHover(point: PlanPoint | null, target: PlanTarget<string> | null): void
  // A marquee let go: every object it touched on the screen; `additive` adds them to the selection.
  onMarquee(ids: readonly string[], info: { additive: boolean }): void
}

// What the site's zoom menu, its keys and the turn buttons ask of the view.
export type BuildControls = {
  zoomIn(): void
  zoomOut(): void
  fit(): void
  zoomTo(rects: readonly PlanRect[]): boolean
  // How far in, 1 being the whole plan.
  setLevel(level: number): void
  // A quarter turn, 1 to the right.
  turn(by: 1 | -1): void
  // Back toward the 2D view: straight down over `to.center` at `to.zoom`, north up — then `done`, where the 2D view
  // takes over.
  leave(to: { center: PlanPoint; zoom: number }, done: () => void): void
  // Back into the corner view from part way up (a switch to 2D taken back).
  rest(): void
}

// The 2D view this one takes over from: the plan point in the middle, how many screen pixels a plan unit takes (the
// 2D view's scale, this camera's zoom), and how far in that is, 1 being the whole plan. The camera starts at the
// scale and ends at the level — the whole plan in 2D is the whole plan here, though a corner view needs more room.
export type Handoff = { center: PlanPoint; zoom: number; level: number }

export type BuildView = { level: number; canZoomIn: boolean; canZoomOut: boolean }

export type Build3DProps = {
  // The plan as drawn (the drag in progress applied), and what the tool would make.
  plan: SeatPlan<string>
  draft: SeatPlan<string> | null
  // Every selected object — grouped ones through their group.
  selected: readonly string[]
  conflicts: readonly string[]
  status: Record<string, string>
  overlay: Editor['overlayProps']
  // The grid cell while snapping.
  grid: number | null
  // What a press does: select, draw with the editor's tool, or pan (the Hand).
  tool: 'select' | 'draw' | 'hand'
  handlers: Handlers
  onMenu(at: ScreenPoint, target: PlanTarget<string> | null): void
  controlsRef: RefObject<BuildControls | null>
  // Where the camera was when the view last closed — previewing and coming back keeps it, as the 2D view does —
  // and where it is now, for that.
  cameraRef: RefObject<BuildCamera | null>
  onCamera(camera: BuildCamera): void
  // The 2D view being switched from — the camera starts straight above it and tilts into the corner.
  handoffRef: RefObject<Handoff | null>
  // The first frame with the scene in it is drawn (or WebGL failed) — a 2D view left underneath can go.
  onShown(): void
  onViewChange(view: BuildView): void
  sectionName(id: string): string
  fixtureName(fixture: Fixture): string | null
}

// The camera: over (x, z) on the floor, from the corner `quarter` turns round from the south-east, `zoom` screen
// pixels per plan unit. `angle` is where the turn has got to.
export type BuildCamera = { x: number; z: number; quarter: number; angle: number; zoom: number }

// Where the camera is: over (x, z), turned to `angle`, looking down at `tilt`, `zoom` pixels per plan unit.
type Pose = { x: number; z: number; angle: number; tilt: number; zoom: number }

// A camera move under way — a quarter turn, or the tilt between this view and the 2D one: from `from` toward `to`
// over `ms`, `elapsed` so far, counted frame by frame (`last` the previous one) — a frame counts for MAX_FRAME_MS at
// most, so a slow one pauses the move instead of skipping part of it. `fade` brings the canvas in over the 2D view,
// or takes it away; `done` runs when it gets there.
type Motion = {
  from: Pose
  to: Partial<Pose>
  ms: number
  elapsed: number
  last: number | null
  ease(t: number): number
  fade?: 'in' | 'out'
  done?: () => void
}

type MoveOptions = Partial<Pick<Motion, 'ease' | 'fade' | 'done'>>

type Press = {
  target: PlanTarget<string> | null
  // `dropped`: Escape let go of a marquee — the rest of the press does nothing.
  mode: 'drag' | 'marquee' | 'pan' | 'draw' | 'dropped'
  additive: boolean
  // Where a drag or a stroke started, in plan units.
  anchor: PlanPoint | null
  // Where the press started and where the pointer last was, in the view's pixels.
  start: ScreenPoint | null
  at: ScreenPoint | null
}

const IDLE_PRESS: Press = { target: null, mode: 'pan', additive: false, anchor: null, start: null, at: null }

export default function Build3D(props: Build3DProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const palette = usePalette(hostRef)
  const [failed, setFailed] = useState(false)
  // react-three-fiber's state, for the camera and the canvas size outside the canvas.
  const stageRef = useRef<(() => RootState) | null>(null)
  const [picks] = useState<Picks>(() => new Map())
  const aimRef = useRef<BuildCamera & { tilt: number }>({
    ...(props.cameraRef.current ?? { x: 0, z: 0, quarter: 0, angle: azimuthOf(0), zoom: 1 }),
    tilt: TILT,
  })
  const motionRef = useRef<Motion | null>(null)
  // On its way back to the 2D view — it no longer turns.
  const leavingRef = useRef(false)
  // Whether the camera has been put where it starts — the whole plan, or where it was before the preview.
  const readyRef = useRef(false)
  const reportedRef = useRef<BuildView | null>(null)
  // Shown in the turn control — the camera itself turns in the frame loop.
  const [quarter, setQuarter] = useState(() => props.cameraRef.current?.quarter ?? 0)
  const gestureRef = useRef<GestureState>(IDLE_GESTURE)
  const pressRef = useRef<Press>(IDLE_PRESS)
  const keysRef = useRef({ constrain: false, fromCenter: false })
  const originRef = useRef<{ left: number; top: number } | null>(null)
  const insideRef = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const spaceRef = useRef(false)
  const [panning, setPanning] = useState(false)
  // The marquee being drawn, corner to corner in the view's pixels.
  const [sweep, setSweep] = useState<{ from: ScreenPoint; to: ScreenPoint } | null>(null)
  // The place or object under the pointer — a place traces its dashes, anything shows the pointer cursor.
  const [over, setOver] = useState<PlanTarget<string> | null>(null)

  const { plan, handlers } = props
  const home = seatPlan.drawingBoundsOf(plan)

  // ---------- Camera ----------

  function stage(): RootState | null {
    return stageRef.current?.() ?? null
  }

  // Aims the ray through a point of the view; false before the canvas is there.
  function aimRay(at: ScreenPoint): boolean {
    const state = stage()
    if (!state) return false
    RAY.setFromCamera(NDC.set((at.x / state.size.width) * 2 - 1, -(at.y / state.size.height) * 2 + 1), state.camera)
    return true
  }

  // The plan point on the floor under a point of the view.
  function floorAt(at: ScreenPoint): PlanPoint | null {
    const hit = aimRay(at) ? RAY.ray.intersectPlane(FLOOR, HIT) : null
    return hit ? { x: hit.x, y: hit.z } : null
  }

  // What is drawn nearest under a point of the view — a place, a fixture, or a section's floor.
  function targetAt(at: ScreenPoint): PlanTarget<string> | null {
    if (!aimRay(at)) return null
    for (const hit of RAY.intersectObjects([...picks.keys()], false)) {
      const target = picks.get(hit.object)?.(hit.instanceId)
      if (target) return target
    }
    return null
  }

  // The objects a box on the screen touches as they stand — each footprint raised to its height and seen from the
  // camera, a group's label where its sign stands — the way the 2D marquee takes what its rubber band touches.
  function touchedBy(box: PlanRect): string[] {
    const state = stage()
    if (!state) return []
    const heights = new Map(piecesOf(plan).map((piece) => [piece.id, HEIGHT[piece.model]]))
    return plan.objects.flatMap((object) => {
      const levels =
        object.kind === 'label'
          ? [SIGN_HEIGHT]
          : [0, object.kind === 'fixture' && object.role === 'wall' ? WALL_CUT : (heights.get(object.id) ?? 0)]
      const seen = seatPlan.outlineOf(object).flatMap((point) => levels.map((y) => screenOf(point, y, state)))
      return overlapsBox(hullOf(seen), box) ? [object.id] : []
    })
  }

  // The zoom that shows the whole drawing from the corner the view is turning to.
  function homeZoom(): number {
    const size = stage()?.size
    return size ? zoomToFit(home, aimRef.current.quarter, size) : 1
  }

  function clampZoom(zoom: number): number {
    const least = homeZoom()
    return Math.min(least * MAX_LEVEL, Math.max(least, zoom))
  }

  // Puts the camera where the aim says, at once — so a gesture's next reading of the floor sees the view it made.
  function place() {
    const state = stage()
    if (!state) return
    const aim = aimRef.current
    const camera = state.camera
    // Kept over the drawing.
    aim.x = Math.min(home.x + home.w, Math.max(home.x, aim.x))
    aim.z = Math.min(home.y + home.h, Math.max(home.y, aim.z))
    camera.position.set(
      aim.x + Math.sin(aim.angle) * Math.cos(aim.tilt) * DISTANCE,
      Math.sin(aim.tilt) * DISTANCE,
      aim.z + Math.cos(aim.angle) * Math.cos(aim.tilt) * DISTANCE,
    )
    camera.lookAt(aim.x, 0, aim.z)
    camera.zoom = aim.zoom
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    state.invalidate()
    props.onCamera({ x: aim.x, z: aim.z, quarter: aim.quarter, angle: azimuthOf(aim.quarter), zoom: aim.zoom })
  }

  // Frames a rectangle of the plan with `around` plan units of room.
  function show(rect: PlanRect, around: number) {
    const size = stage()?.size
    if (!size) return
    const padded = { x: rect.x - around, y: rect.y - around, w: rect.w + around * 2, h: rect.h + around * 2 }
    const aim = aimRef.current
    aim.x = rect.x + rect.w / 2
    aim.z = rect.y + rect.h / 2
    aim.zoom = clampZoom(zoomToFit(padded, aim.quarter, size))
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
    place()
    const after = floorAt(about)
    if (before && after) {
      aim.x += before.x - after.x
      aim.z += before.y - after.y
      place()
    }
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
  // a turn during the tilt from 2D still ends in the corner view.
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
    if (leavingRef.current) return
    const aim = aimRef.current
    aim.quarter += by
    setQuarter(aim.quarter)
    move({ angle: azimuthOf(aim.quarter) }, TURN_MS)
  }

  // Takes over from the 2D view. Straight down over the same spot at the same scale, north up, this view draws what
  // the 2D view draws in the same places — text included (drawing-3d.tsx `Text`) — so the canvas first comes in over
  // the 2D view with the camera still, then, the 2D view gone, tilts and turns into the corner view at the same level.
  function enter(from: Handoff) {
    const aim = aimRef.current
    const north = northUpNear(azimuthOf(aim.quarter))
    Object.assign(aim, { x: from.center.x, z: from.center.y, zoom: from.zoom, tilt: TOP, angle: north })
    place()
    move({}, FADE_MS, {
      fade: 'in',
      done: () => {
        props.onShown()
        const corner = {
          angle: azimuthOf(aimRef.current.quarter),
          tilt: TILT,
          zoom: clampZoom(homeZoom() * from.level),
        }
        move(corner, SWITCH_MS, { ease: easeInOut })
      },
    })
  }

  // The way in, backwards: down to straight above the 2D view's spot at its scale, then still while the canvas fades
  // away over the 2D view laid underneath.
  function leave(to: { center: PlanPoint; zoom: number }, done: () => void) {
    leavingRef.current = true
    const angle = northUpNear(aimRef.current.angle)
    const pose = { x: to.center.x, z: to.center.y, zoom: to.zoom, tilt: TOP, angle }
    move(pose, SWITCH_MS, { ease: easeInOut, done: () => move({}, FADE_MS, { fade: 'out', done }) })
  }

  function rest() {
    leavingRef.current = false
    // The way back to 2D is dropped, not finished.
    motionRef.current = null
    move({ angle: azimuthOf(aimRef.current.quarter), tilt: TILT }, SWITCH_MS, { ease: easeInOut })
  }

  // Every frame: where the camera starts once the canvas has a size — over the 2D view it takes over from, the whole
  // plan, or where it was before the preview — the move under way, and, once nothing moves, the zoom as the site
  // shows it (reported every frame of a move, it would redraw the whole workspace every frame).
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
        if (props.cameraRef.current === null) show(home, 0)
        else place()
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
      state.gl.domElement.style.opacity = String(opacityOf(motion.fade, t))
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
      leave,
      rest,
    }
    return () => {
      ref.current = null
    }
  })

  // Closed part way through a switch (to the preview): every step left runs at once, so the 2D view still takes over
  // (or is let go).
  useEffect(
    () => () => {
      for (let motion = motionRef.current; motion; motion = motionRef.current) {
        motionRef.current = null
        motion.done?.()
      }
    },
    [],
  )

  // ---------- Pressing ----------

  // The pointer in the view's pixels. The view's place on the page is read once per gesture.
  function pointerOf(e: PointerEvent<HTMLDivElement>, refresh = false) {
    if (refresh || !originRef.current) {
      const rect = e.currentTarget.getBoundingClientRect()
      originRef.current = { left: rect.left, top: rect.top }
    }
    const origin = originRef.current
    return { id: e.pointerId, x: e.clientX - origin.left, y: e.clientY - origin.top }
  }

  // Reports the drag, marquee or stroke under way where the pointer last was.
  function report(phase: 'move' | 'end') {
    const press = pressRef.current
    if (press.mode === 'marquee') {
      if (!press.start || !press.at) return
      if (phase === 'move') {
        setSweep({ from: press.start, to: press.at })
        return
      }
      setSweep(null)
      handlers.onMarquee(touchedBy(boxBetween(press.start, press.at)), { additive: press.additive })
      return
    }
    const to = press.at && floorAt(press.at)
    if (!press.anchor || !to) return
    const keys = keysRef.current
    if (press.mode === 'drag' && press.target) {
      const total = { x: to.x - press.anchor.x, y: to.y - press.anchor.y }
      handlers.onTargetDrag({ target: press.target, phase, total, constrain: keys.constrain, copy: keys.fromCenter })
    } else if (press.mode === 'draw') {
      handlers.onDraw?.({ start: press.anchor, end: to }, { phase, ...keys })
    }
  }

  function handle(events: GestureEvent[]) {
    for (const event of events) {
      const press = pressRef.current
      switch (event.type) {
        case 'tap': {
          const point = floorAt(event.point)
          if (press.mode === 'draw') {
            if (point) handlers.onDraw?.({ start: point, end: point }, { phase: 'end', ...keysRef.current })
            break
          }
          // The Hand only pans.
          if (props.tool !== 'hand') handlers.onTap(press.target, { point, additive: press.additive })
          break
        }
        case 'dragstart': {
          if (press.mode === 'pan') {
            setPanning(true)
            break
          }
          const anchor = floorAt(event.point)
          pressRef.current = { ...press, anchor, start: event.point, at: event.point }
          if (press.mode === 'marquee') {
            setSweep({ from: event.point, to: event.point })
            break
          }
          if (!anchor) break
          if (press.mode === 'drag' && press.target) {
            handlers.onTargetDrag({
              target: press.target,
              phase: 'start',
              total: { x: 0, y: 0 },
              constrain: keysRef.current.constrain,
              copy: keysRef.current.fromCenter,
            })
          } else if (press.mode === 'draw') {
            handlers.onDraw?.({ start: anchor, end: anchor }, { phase: 'start', ...keysRef.current })
          }
          break
        }
        case 'drag':
          if (press.mode === 'pan') {
            panBy(event.delta)
            break
          }
          pressRef.current = { ...press, at: event.point }
          report('move')
          break
        case 'dragend':
          if (press.mode !== 'pan') {
            pressRef.current = { ...press, at: event.point }
            report('end')
          }
          setPanning(false)
          // After a pinch the remaining finger pans — it never drags the target the gesture began on.
          pressRef.current = IDLE_PRESS
          break
        case 'pinch':
          zoomAbout(event.center, event.factor)
          panBy(event.delta)
          break
      }
    }
  }

  // Drops a stroke in progress — it must not create anything.
  function cancelStroke() {
    const press = pressRef.current
    const end = press.at && floorAt(press.at)
    if (press.mode === 'draw' && press.anchor && end) {
      handlers.onDraw?.({ start: press.anchor, end }, { phase: 'cancel', ...keysRef.current })
    }
    pressRef.current = IDLE_PRESS
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    const middleButton = e.pointerType === 'mouse' && e.button === 1
    // The right button opens the menu (onContextMenu).
    if (e.pointerType === 'mouse' && e.button !== 0 && !middleButton) return
    if (middleButton) e.preventDefault()
    keysRef.current = keysOf(e)
    const idle = gestureRef.current.kind === 'idle'
    const pointer = pointerOf(e, idle)
    if (idle) {
      const additive = e.shiftKey || e.metaKey || e.ctrlKey
      const pan = middleButton || spaceRef.current || props.tool === 'hand'
      const target = pan ? null : targetAt(pointer)
      const mode: Press['mode'] = pan
        ? 'pan'
        : handlers.onDraw
          ? 'draw'
          : target !== null && handlers.canDrag(target)
            ? 'drag'
            : additive || target !== null || e.pointerType !== 'touch'
              ? 'marquee'
              : 'pan'
      pressRef.current = { target, mode, additive, anchor: null, start: null, at: null }
    } else if (pressRef.current.mode === 'draw') {
      // A second finger turns the press into a pinch — the stroke is dropped, not drawn.
      cancelStroke()
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const result = gesture.down(gestureRef.current, pointer, pressRef.current.target ? 'target' : null)
    gestureRef.current = result.state
    handle(result.events)
    if (result.state.kind === 'pinching') {
      pressRef.current = IDLE_PRESS
      setSweep(null)
    }
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (gestureRef.current.kind === 'idle') {
      insideRef.current = true
      const at = pointerOf(e, true)
      const target = targetAt(at)
      handlers.onHover(floorAt(at), target)
      const next = target?.kind === 'place' || target?.kind === 'object' ? target : null
      setOver((current) => (sameTarget(current, next) ? current : next))
      return
    }
    keysRef.current = keysOf(e)
    const threshold = e.pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : undefined
    const result = gesture.move(gestureRef.current, pointerOf(e), threshold)
    gestureRef.current = result.state
    handle(result.events)
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    keysRef.current = keysOf(e)
    const result = gesture.up(gestureRef.current, pointerOf(e))
    gestureRef.current = result.state
    handle(result.events)
  }

  function handlePointerCancel() {
    if (pressRef.current.mode === 'draw') cancelStroke()
    const result = gesture.cancel(gestureRef.current)
    gestureRef.current = result.state
    handle(result.events)
  }

  function handlePointerLeave() {
    insideRef.current = false
    if (gestureRef.current.kind !== 'idle') return
    handlers.onHover(null, null)
    setOver(null)
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
      return
    }
    // Shift turns a plain wheel sideways where the browser does not already.
    panBy(e.shiftKey && dx === 0 ? { x: -dy, y: 0 } : { x: -dx, y: -dy })
  })
  // Safari reports a trackpad pinch as gesture events — the scale since it began.
  const pinchRef = useRef(1)
  const onGesture = useEffectEvent((e: Event) => {
    e.preventDefault()
    const pinch = e as Event & { scale: number; clientX: number; clientY: number }
    if (e.type === 'gesturestart') pinchRef.current = 1
    if (e.type !== 'gesturechange') return
    const factor = pinch.scale / pinchRef.current
    pinchRef.current = pinch.scale
    const host = hostRef.current
    if (!host || !(factor > 0) || !Number.isFinite(factor)) return
    const rect = host.getBoundingClientRect()
    zoomAbout({ x: pinch.clientX - rect.left, y: pinch.clientY - rect.top }, factor)
  })
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const wheel = (e: WheelEvent) => onWheel(e)
    const pinch = (e: Event) => onGesture(e)
    host.addEventListener('wheel', wheel, { passive: false })
    for (const type of GESTURE_EVENTS) host.addEventListener(type, pinch)
    return () => {
      host.removeEventListener('wheel', wheel)
      for (const type of GESTURE_EVENTS) host.removeEventListener(type, pinch)
    }
  }, [])

  // Space held over the view pans whatever the tool; Shift and Alt pressed mid-drag reshape the drag at once.
  const onWindowKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Shift' || e.key === 'Alt') {
      keysRef.current = keysOf(e)
      if (gestureRef.current.kind === 'dragging' && pressRef.current.mode !== 'pan') report('move')
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
    if (e.key !== 'Escape' || pressRef.current.mode !== 'marquee' || gestureRef.current.kind !== 'dragging') return
    e.preventDefault()
    pressRef.current = { ...pressRef.current, mode: 'dropped' }
    setSweep(null)
  })
  useEffect(() => {
    const key = (e: KeyboardEvent) => onEscape(e)
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])

  const hoveredPlace = props.tool === 'select' && over?.kind === 'place' ? over.id : null

  return (
    <div
      ref={hostRef}
      className={styles.build}
      data-tool={props.tool}
      data-pan={panning ? 'active' : spaceHeld ? 'ready' : undefined}
      data-over={(props.tool === 'select' && over !== null) || undefined}
      role="application"
      aria-label="Seat plan editor in 3D — the 2D view has the same plan for keyboard and screen readers"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={(e) => {
        // Capture ends with every release; lost while a press still follows this pointer, the release is not coming.
        if (holds(gestureRef.current, e.pointerId)) handlePointerCancel()
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
        <p className={styles.message}>This browser could not start WebGL. The 2D view shows the same plan.</p>
      ) : (
        <Fallback
          onError={() => {
            setFailed(true)
            props.onShown()
          }}
        >
          <Canvas orthographic frameloop="demand" flat dpr={[1, 2]} camera={{ near: 1, far: DISTANCE * 4 }}>
            <Stage stageRef={stageRef} onFrame={onFrame} />
            {palette && <Scene {...props} palette={palette} picks={picks} hoveredPlace={hoveredPlace} />}
          </Canvas>
        </Fallback>
      )}

      {sweep && (
        <svg className={styles.sweep} aria-hidden>
          <rect {...rectAttributes(boxBetween(sweep.from, sweep.to))} />
        </svg>
      )}

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
            <g style={{ transform: `rotate(${northOf(quarter)}deg)`, transformOrigin: '12px 12px' }}>
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

type SceneProps = Build3DProps & { palette: Palette; picks: Picks; hoveredPlace: string | null }

function Scene({ plan, draft, palette, picks, hoveredPlace, ...props }: SceneProps) {
  const pieces = piecesOf(plan)
  const walls = wallsOf(plan)
  const selected = new Set(props.selected)
  const conflicts = new Set(props.conflicts)
  const reach = Math.hypot(plan.width, plan.height)
  // `flat`: how the 2D view paints it, where that differs — what it turns to as the camera looks straight down.
  const lookOf = (id: string, place: Piece['place'], flat?: Color): Look => {
    // An overlap shows on a selected place too — it is what a drag is about to settle.
    if (selected.has(id)) return { fill: palette.ink, line: conflicts.has(id) ? 'warning' : 'paper' }
    if (conflicts.has(id)) return { fill: palette.warningFill, line: 'warning' }
    const fill = (place?.category === undefined ? undefined : palette.categories[place.category]) ?? palette.surface
    if (place && props.status[id] !== undefined) return { fill, line: 'ink', dash: true }
    if (id === hoveredPlace) return { fill, line: 'ink', dash: true, march: true }
    return flat ? { fill, line: 'ink', flat } : { fill, line: 'ink' }
  }
  // The 2D editor paints places, chairs and table tops (globals.css) and leaves other fixtures unpainted, the page
  // showing through — as it does through the floor.
  const flatOf = (piece: Piece) =>
    piece.place || piece.model === 'chair' || piece.model === 'table' ? undefined : palette.ground
  const solids = [
    ...pieces.map((piece) =>
      solidOf(piece, lookOf(piece.id, piece.place, flatOf(piece)), {
        kind: piece.place ? 'place' : 'object',
        id: piece.id,
      }),
    ),
    // A wall fixture's band is the ink in 2D.
    ...walls.flatMap((wall) =>
      wall.id === undefined ? [] : [wallOf(wall, lookOf(wall.id, null, palette.ink), { kind: 'object', id: wall.id })],
    ),
  ]
  // A section's walls are guides, dashed as in 2D, cut down so the rooms show.
  const sectionWalls = walls.flatMap((wall) =>
    wall.id === undefined
      ? [wallOf(wall, { fill: palette.surface, line: 'label', dash: true, flat: palette.ground })]
      : [],
  )
  const ghostLook = (id: string): Look =>
    conflicts.has(id)
      ? { fill: palette.warningFill, line: 'warning', dash: true }
      : { fill: palette.surface, line: 'ink', dash: true }
  const ghosts =
    draft === null
      ? []
      : [
          ...piecesOf(draft).map((piece) => solidOf(piece, ghostLook(piece.id))),
          ...wallsOf(draft).map((wall) => wallOf(wall, ghostLook(wall.id ?? ''))),
        ]

  return (
    <>
      <color attach="background" args={[palette.ground]} />
      <Daylight />
      {/* The ground is the page's own colour, unlit so it meets the background. */}
      <mesh position={[plan.width / 2, -1, plan.height / 2]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[reach * 12, reach * 12]} />
        <meshBasicMaterial color={palette.ground} />
      </mesh>
      {plan.sections.map((section) => (
        <Floor
          key={section.id}
          id={section.id}
          points={section.points}
          color={palette.surface}
          flat={palette.ground}
          picks={picks}
        />
      ))}
      {props.grid !== null && <Grid plan={plan} cell={props.grid} palette={palette} />}
      <Solids solids={sectionWalls} palette={palette} />
      <Solids solids={solids} palette={palette} picks={picks} />
      <Solids solids={ghosts} palette={palette} ghost />
      <Overlay overlay={props.overlay} palette={palette} />
      {writingOf(plan, pieces, props.sectionName, props.fixtureName).map((writing, i) => (
        <Text
          key={i}
          writing={writing}
          color={writing.tone === 'ink' ? palette.ink : palette.label}
          font={palette.font}
        />
      ))}
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

function wallOf(wall: Wall, look: Look, target?: PlanTarget<string>): Solid {
  return {
    id: wall.id ?? `wall:${wall.x}:${wall.z}`,
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

// What the editor draws over the 2D plan, laid on the floor: the selection's outlines tracing their dashes, what a
// tap would select and a tool's stroke in still ones. The marquee is the view's own, on the screen.
function Overlay({ overlay, palette }: { overlay: Editor['overlayProps']; palette: Palette }) {
  const tracing = [...overlay.frames, ...(overlay.frame ? [overlay.frame] : [])]
  const still = [
    ...(overlay.hoverFrame ? [overlay.hoverFrame] : []),
    ...(overlay.stroke && overlay.draw === 'box'
      ? [cornersOf(rectBetween(overlay.stroke.start, overlay.stroke.end))]
      : []),
  ]
  const line =
    overlay.stroke && overlay.draw === 'line'
      ? [[overlay.stroke.start, overlay.stroke.end]]
      : overlay.stroke && overlay.draw === 'polygon'
        ? [overlay.stroke.points ?? []]
        : []
  return (
    <>
      <FloorLines segments={floorSegments(tracing, true)} palette={palette} march />
      <FloorLines
        segments={new Float32Array([...floorSegments(still, true), ...floorSegments(line, false)])}
        palette={palette}
      />
    </>
  )
}

function FloorLines({
  segments,
  palette,
  march = false,
}: {
  segments: Float32Array
  palette: Palette
  march?: boolean
}) {
  const [geometry] = useState(() => new BufferGeometry())
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => () => geometry.dispose(), [geometry])
  useLayoutEffect(() => {
    setSegments(geometry, segments)
    invalidate()
  })
  if (segments.length === 0) return null
  return <Hairlines geometry={geometry} color={palette.ink} look={{ fill: null, line: 'ink', dash: true, march }} />
}

// The editor's grid on the floor, dashed like the 2D one.
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

// A quarter turn answers a key at once and settles; the tilt between 2D and 3D starts and ends at rest.
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2
}

// How much of the canvas shows, `t` through a move that fades it.
function opacityOf(fade: Motion['fade'], t: number): number {
  if (fade === 'in') return t
  if (fade === 'out') return 1 - t
  return 1
}

function poseOf(aim: Pose): Pose {
  return { x: aim.x, z: aim.z, angle: aim.angle, tilt: aim.tilt, zoom: aim.zoom }
}

// The direction nearest `angle` from which north is up on the screen, as in the 2D view.
function northUpNear(angle: number): number {
  return Math.round(angle / (2 * Math.PI)) * 2 * Math.PI
}

// The camera's direction for a quarter: 45° round from the south (+z) for the first, the south-east corner.
function azimuthOf(quarter: number): number {
  return Math.PI / 4 + (quarter * Math.PI) / 2
}

// Where north points on screen for a quarter, in degrees clockwise from up — counted on round, so a turn swings the
// compass the short way.
function northOf(quarter: number): number {
  const angle = azimuthOf(quarter)
  const degrees = (Math.atan2(Math.sin(angle), Math.cos(angle) * Math.sin(TILT)) * 180) / Math.PI
  return (((degrees % 360) + 360) % 360) + 360 * Math.floor(quarter / 4)
}

// The zoom (screen pixels per plan unit) at which `rect`, walls and all, fills the view seen from a quarter.
function zoomToFit(rect: PlanRect, quarter: number, size: { width: number; height: number }): number {
  const angle = azimuthOf(quarter)
  // The view's right and up directions on the floor and upward.
  const right = { x: Math.cos(angle), z: -Math.sin(angle) }
  const up = { x: -Math.sin(angle) * Math.sin(TILT), y: Math.cos(TILT), z: -Math.cos(angle) * Math.sin(TILT) }
  const xs: number[] = []
  const ys: number[] = []
  for (const x of [rect.x, rect.x + rect.w])
    for (const z of [rect.y, rect.y + rect.h])
      for (const y of [0, WALL_CUT]) {
        xs.push(x * right.x + z * right.z)
        ys.push(x * up.x + y * up.y + z * up.z)
      }
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  return Math.min(size.width / Math.max(w, 1), size.height / Math.max(h, 1)) * FIT_MARGIN
}

function unionOf(rects: readonly PlanRect[]): PlanRect {
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w))
  const y1 = Math.max(...rects.map((r) => r.y + r.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function rectBetween(a: PlanPoint, b: PlanPoint): PlanRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

// The box between two points of the view, in its pixels.
function boxBetween(a: ScreenPoint, b: ScreenPoint): PlanRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

function rectAttributes(box: PlanRect) {
  return { x: box.x, y: box.y, width: box.w, height: box.h }
}

// Where a point of the room shows in the view, in its pixels.
function screenOf(point: PlanPoint, y: number, state: RootState): ScreenPoint {
  const seen = SEEN.set(point.x, y, point.y).project(state.camera)
  return { x: ((seen.x + 1) / 2) * state.size.width, y: ((1 - seen.y) / 2) * state.size.height }
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

function spanOf(points: readonly ScreenPoint[], axis: ScreenPoint): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    const d = p.x * axis.x + p.y * axis.y
    min = Math.min(min, d)
    max = Math.max(max, d)
  }
  return { min, max }
}

function cornersOf(rect: PlanRect): PlanPoint[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ]
}

// Whether a gesture still follows this pointer.
function holds(state: GestureState, id: number): boolean {
  if (state.kind === 'pressed' || state.kind === 'dragging') return state.pointer.id === id
  if (state.kind === 'pinching') return state.pointers.some((pointer) => pointer.id === id)
  return false
}

function sameTarget(a: PlanTarget<string> | null, b: PlanTarget<string> | null): boolean {
  if (a === null || b === null) return a === b
  return a.kind === b.kind && 'id' in a && 'id' in b && a.id === b.id
}

function keysOf(e: { shiftKey: boolean; altKey: boolean }) {
  return { constrain: e.shiftKey, fromCenter: e.altKey }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, select, [contenteditable], dialog') !== null
}

function wheelPixels(delta: number, mode: number): number {
  return mode === 1 ? delta * 40 : mode === 2 ? delta * 800 : delta
}

// How steep the view looks down — a tycoon game's tilt — and how far back the camera stands (an orthographic
// camera draws the same at any distance; it only has to clear the drawing).
const TILT = (35 * Math.PI) / 180
// Straight down, as the 2D view looks — a hair off it, so the camera still knows which way is up.
const TOP = (89.9 * Math.PI) / 180
const DISTANCE = 100_000
const TURN_MS = 200
// The tilt between the 2D view and this one, and the crossfade between them, the camera still straight above.
const SWITCH_MS = 300
const FADE_MS = 160
// The most a frame counts for in a move — 30 frames a second.
const MAX_FRAME_MS = 1000 / 30
const POSE_KEYS = ['x', 'z', 'angle', 'tilt', 'zoom'] as const
// As far in as the 2D canvas goes, the zoom buttons' step, and the room left round what zoomTo frames.
const MAX_LEVEL = 6
const BUTTON_STEP = 1.5
const ZOOM_TO_PADDING = GRID_CELL * 2
const FIT_MARGIN = 0.92
const WHEEL_ZOOM_RATE = Math.log(1.1) / 100
const PINCH_ZOOM_RATE = 0.01
const FLOOR_GRID = 0.25
const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const
const FLOOR = new Plane(new Vector3(0, 1, 0), 0)
const RAY = new Raycaster()
const NDC = new Vector2()
const HIT = new Vector3()
const SEEN = new Vector3()
