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
import { BufferGeometry, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { WALL_CUT, piecesOf, wallsOf, writingOf, type Piece, type Wall } from '../_lib/scene'
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
// the editor's taps, drags, marquees and strokes, with plan points read off the floor under the pointer. Handles
// stay in 2D. Drawn like the 2D plan (./drawing-3d.tsx); loaded only when someone switches to it.

type Editor = SeatPlanEditor<string>
// What a press means to the editor — <SeatMap.Viewport>'s handlers, with plan points read off the floor.
type Handlers = Pick<Editor['viewportProps'], 'canDrag' | 'onTargetDrag' | 'onMarquee' | 'onDraw'> & {
  onTap(target: PlanTarget<string> | null, info: { point: PlanPoint | null; additive: boolean }): void
  onHover(point: PlanPoint | null, target: PlanTarget<string> | null): void
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
}

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
  // Where the camera was when the view last closed — previewing and coming back keeps it, as the 2D view does.
  cameraRef: RefObject<BuildCamera | null>
  onViewChange(view: BuildView): void
  sectionName(id: string): string
  fixtureName(fixture: Fixture): string | null
}

// The camera: over (x, z) on the floor, from the corner `quarter` turns round from the south-east, `zoom` screen
// pixels per plan unit. `angle` is where the turn has got to.
export type BuildCamera = { x: number; z: number; quarter: number; angle: number; zoom: number }

// A turn under way, from `from` toward the aim's quarter.
type Turning = { from: number; at: number } | null

type Press = {
  target: PlanTarget<string> | null
  mode: 'drag' | 'marquee' | 'pan' | 'draw'
  additive: boolean
  // Where a drag, a marquee or a stroke started, in plan units.
  anchor: PlanPoint | null
  // Where the pointer last was, in the view's pixels.
  at: ScreenPoint | null
}

const IDLE_PRESS: Press = { target: null, mode: 'pan', additive: false, anchor: null, at: null }

export default function Build3D(props: Build3DProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const palette = usePalette(hostRef)
  const [failed, setFailed] = useState(false)
  // react-three-fiber's state, for the camera and the canvas size outside the canvas.
  const stageRef = useRef<(() => RootState) | null>(null)
  const [picks] = useState<Picks>(() => new Map())
  const aimRef = useRef<BuildCamera>(
    props.cameraRef.current ?? { x: 0, z: 0, quarter: 0, angle: azimuthOf(0), zoom: 1 },
  )
  const turningRef = useRef<Turning>(null)
  // Whether the camera has been put where it starts — the whole plan, or where it was before the preview.
  const readyRef = useRef(false)
  const reportedRef = useRef<BuildView | null>(null)
  // Shown in the turn control — the camera itself turns in the frame loop.
  const [quarter, setQuarter] = useState(aimRef.current.quarter)
  const gestureRef = useRef<GestureState>(IDLE_GESTURE)
  const pressRef = useRef<Press>(IDLE_PRESS)
  const keysRef = useRef({ constrain: false, fromCenter: false })
  const originRef = useRef<{ left: number; top: number } | null>(null)
  const insideRef = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const spaceRef = useRef(false)
  const [panning, setPanning] = useState(false)
  // The place or object under the pointer — a place traces its dashes, anything shows the pointer cursor.
  const [over, setOver] = useState<PlanTarget<string> | null>(null)

  const { plan, handlers } = props
  const home = seatPlan.drawingBoundsOf(plan)

  // ---------- Camera ----------

  function stage(): RootState | null {
    return stageRef.current?.() ?? null
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
      aim.x + Math.sin(aim.angle) * Math.cos(TILT) * DISTANCE,
      Math.sin(TILT) * DISTANCE,
      aim.z + Math.cos(aim.angle) * Math.cos(TILT) * DISTANCE,
    )
    camera.lookAt(aim.x, 0, aim.z)
    camera.zoom = aim.zoom
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    state.invalidate()
    props.cameraRef.current = { ...aim, angle: azimuthOf(aim.quarter) }
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

  function middle(): ScreenPoint {
    const size = stage()?.size
    return size ? { x: size.width / 2, y: size.height / 2 } : { x: 0, y: 0 }
  }

  function turn(by: 1 | -1) {
    const aim = aimRef.current
    aim.quarter += by
    setQuarter(aim.quarter)
    turningRef.current = reducedMotion() ? null : { from: aim.angle, at: performance.now() }
    if (turningRef.current === null) aim.angle = azimuthOf(aim.quarter)
    place()
  }

  // Every frame: the turn under way, the first fit once the canvas has a size, and the zoom as the site shows it.
  function onFrame() {
    const state = stage()
    if (!state || state.size.width === 0) return
    const aim = aimRef.current
    if (!readyRef.current) {
      readyRef.current = true
      if (props.cameraRef.current === null) show(home, 0)
      else place()
    }
    const turning = turningRef.current
    if (turning) {
      const t = Math.min(1, (performance.now() - turning.at) / TURN_MS)
      const eased = 1 - (1 - t) ** 3
      aim.angle = turning.from + (azimuthOf(aim.quarter) - turning.from) * eased
      if (t === 1) turningRef.current = null
      place()
    }
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
    }
    return () => {
      ref.current = null
    }
  })

  // ---------- Reading the view ----------

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
    const to = press.at && floorAt(press.at)
    if (!press.anchor || !to) return
    const keys = keysRef.current
    if (press.mode === 'drag' && press.target) {
      const total = { x: to.x - press.anchor.x, y: to.y - press.anchor.y }
      handlers.onTargetDrag({ target: press.target, phase, total, constrain: keys.constrain, copy: keys.fromCenter })
    } else if (press.mode === 'marquee') {
      handlers.onMarquee(rectBetween(press.anchor, to), { phase, additive: press.additive })
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
          pressRef.current = { ...press, anchor, at: event.point }
          if (!anchor) break
          if (press.mode === 'drag' && press.target) {
            handlers.onTargetDrag({
              target: press.target,
              phase: 'start',
              total: { x: 0, y: 0 },
              constrain: keysRef.current.constrain,
              copy: keysRef.current.fromCenter,
            })
          } else if (press.mode === 'marquee') {
            handlers.onMarquee({ ...anchor, w: 0, h: 0 }, { phase: 'start', additive: press.additive })
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
      pressRef.current = { target, mode, additive, anchor: null, at: null }
    } else if (pressRef.current.mode === 'draw') {
      // A second finger turns the press into a pinch — the stroke is dropped, not drawn.
      cancelStroke()
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const result = gesture.down(gestureRef.current, pointer, pressRef.current.target ? 'target' : null)
    gestureRef.current = result.state
    handle(result.events)
    if (result.state.kind === 'pinching') pressRef.current = IDLE_PRESS
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (gestureRef.current.kind === 'idle') {
      insideRef.current = true
      const at = pointerOf(e, true)
      const target = targetAt(at)
      handlers.onHover(floorAt(at), target)
      const next = target?.kind === 'place' || target?.kind === 'object' ? target : null
      setOver((current) => (current?.kind === next?.kind && sameId(current, next) ? current : next))
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
        <Fallback onError={() => setFailed(true)}>
          <Canvas orthographic frameloop="demand" flat dpr={[1, 2]} camera={{ near: 1, far: DISTANCE * 4 }}>
            <Stage stageRef={stageRef} onFrame={onFrame} />
            {palette && <Scene {...props} palette={palette} picks={picks} hoveredPlace={hoveredPlace} />}
          </Canvas>
        </Fallback>
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
  const lookOf = (id: string, place: Piece['place']): Look => {
    // An overlap shows on a selected place too — it is what a drag is about to settle.
    if (selected.has(id)) return { fill: palette.ink, line: conflicts.has(id) ? 'warning' : 'paper' }
    if (conflicts.has(id)) return { fill: palette.warningFill, line: 'warning' }
    const fill = (place?.category === undefined ? undefined : palette.categories[place.category]) ?? palette.surface
    if (place && props.status[id] !== undefined) return { fill, line: 'ink', dash: true }
    if (id === hoveredPlace) return { fill, line: 'ink', dash: true, march: true }
    return { fill, line: 'ink' }
  }
  const solids = [
    ...pieces.map((piece) =>
      solidOf(piece, lookOf(piece.id, piece.place), {
        kind: piece.place ? 'place' : 'object',
        id: piece.id,
      }),
    ),
    ...walls.flatMap((wall) =>
      wall.id === undefined ? [] : [wallOf(wall, lookOf(wall.id, null), { kind: 'object', id: wall.id })],
    ),
  ]
  // A section's walls are guides, dashed as in 2D, cut down so the rooms show.
  const sectionWalls = walls.flatMap((wall) =>
    wall.id === undefined ? [wallOf(wall, { fill: palette.surface, line: 'label', dash: true })] : [],
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
        <Floor key={section.id} id={section.id} points={section.points} color={palette.surface} picks={picks} />
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

// What the editor draws over the 2D plan, laid on the floor: the selection's outlines and the marquee tracing
// their dashes, what a tap would select and a tool's stroke in still ones.
function Overlay({ overlay, palette }: { overlay: Editor['overlayProps']; palette: Palette }) {
  const tracing = [...overlay.frames, ...(overlay.frame ? [overlay.frame] : [])]
  const marquee = overlay.marquee
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
      <FloorLines
        segments={floorSegments([...tracing, ...(marquee ? [cornersOf(marquee)] : [])], true)}
        palette={palette}
        march
      />
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

function sameId(a: PlanTarget<string> | null, b: PlanTarget<string> | null): boolean {
  if (a === null || b === null) return a === b
  return 'id' in a && 'id' in b && a.id === b.id
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
const DISTANCE = 100_000
const TURN_MS = 200
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
