'use client'

import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber'
import CameraControls from 'camera-controls'
import { seatPlan, type Place, type SeatPlan } from 'ichno'
import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react'
import {
  Box3,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  RingGeometry,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  Vector4,
} from 'three'
import { describe } from '../../_demo/messages'
import { categoryNameOf, categoryWritingOf } from '../_lib/category-labels'
import { fixtureLabel } from '../_lib/fixtures'
import {
  HEIGHT,
  WALL_CUT,
  WALL_HEIGHT,
  overviewOf,
  piecesOf,
  sightFrom,
  wallsOf,
  writingOf,
  type Overview,
  type Piece,
  type Sight,
} from '../_lib/scene'
import { METRE } from '../_lib/units'
import {
  Daylight,
  Fallback,
  Floor,
  Shade,
  Solids,
  Text,
  usePalette,
  type Look,
  type Palette,
  type Solid,
} from './drawing-3d'
import { LIFT, useLifted } from './lifting'
import { PlaceTip, ZoomButtons, type TipAt } from './preview-chrome'
import ui from './controls.module.css'
import styles from './preview-3d.module.css'

// The playground's 3D preview — the same document the 2D preview draws, stood up with three.js by this site
// (ichno draws 2D only). What stands where, how tall and facing which way is the site's reading of its roles
// (../_lib/scene.ts); the look is the 2D drawing's (./drawing-3d.tsx). Loaded only when someone switches to 3D.

CameraControls.install({
  THREE: { Box3, Matrix4, Quaternion, Raycaster, Sphere, Spherical, Vector2, Vector3, Vector4 },
})

export type Preview3DProps = {
  plan: SeatPlan<string>
  status: Record<string, string>
  picked: readonly string[]
  // Places that cannot be picked.
  disabled: readonly string[]
  onPlaceTap(place: Place<string>): void
  // Opened from the 2D plan: the camera starts straight above it and comes down to its corner.
  fromAbove: boolean
}

export default function Preview3D(props: Preview3DProps) {
  const { plan } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<CameraControls | null>(null)
  const palette = usePalette(hostRef)
  // The place tapped last — the card offers the view from it — and the place being looked from.
  const [focus, setFocus] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  // The place under the pointer, and where its top shows in the view — what the tip points at.
  const [pointed, setPointed] = useState<Pointed | null>(null)
  const [failed, setFailed] = useState(false)
  const hovered = pointed?.id ?? null

  const pieces = piecesOf(plan)
  const overview = overviewOf(plan, pieces)
  const sight = viewing === null ? null : sightFrom(plan, pieces, viewing)
  const focused = pieces.find((piece) => piece.id === (viewing ?? focus))?.place ?? null
  const tipped = pointed === null ? null : (pieces.find((piece) => piece.id === pointed.id)?.place ?? null)

  // A place that went away (an undo) takes its card and its view with it.
  useEffect(() => {
    if (viewing !== null && sight === null) setViewing(null)

    if (focus !== null && focused === null && viewing === null) setFocus(null)
  }, [viewing, sight, focus, focused])

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return

    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable], dialog')) return

    if (viewing !== null) setViewing(null)
    else setFocus(null)
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e)
    window.addEventListener('keydown', listener)

    return () => window.removeEventListener('keydown', listener)
  }, [])

  function tap(place: Place<string>) {
    setFocus(place.id)
    props.onPlaceTap(place)
  }

  function zoom(direction: 1 | -1) {
    const controls = controlsRef.current

    if (!controls) return

    if (viewing !== null) {
      controls.zoom(direction * LENS_STEP, true)

      return
    }

    // From where the camera is heading, so quick presses add up instead of repeating one step.
    const radius = controls.getSpherical(new Spherical(), true).radius
    controls.dollyTo(direction > 0 ? radius * DOLLY_STEP : radius / DOLLY_STEP, true)
  }

  function home() {
    if (viewing !== null) setViewing(null)
    else if (controlsRef.current) flyOver(controlsRef.current, overview, true)
  }

  const hint = viewing !== null ? 'Drag to look around · Esc goes back' : 'Drag to orbit · scroll or pinch to zoom'

  return (
    <div
      ref={hostRef}
      className={styles.scene3d}
      data-hover={hovered !== null || undefined}
      role="region"
      aria-label="3D preview of the seat plan — the 2D view has the same places for keyboard and screen readers"
    >
      {failed ? (
        <p className={styles.scene3dMessage}>This browser could not start WebGL. The 2D view shows the same plan.</p>
      ) : (
        <Fallback onError={() => setFailed(true)}>
          <Canvas
            frameloop="demand"
            flat
            dpr={[1, 2]}
            camera={{ fov: FOV, near: 4, far: overview.radius * 40 }}
            onPointerMissed={() => {
              if (viewing === null) setFocus(null)
            }}
          >
            {palette && (
              <Scene
                plan={plan}
                pieces={pieces}
                overview={overview}
                palette={palette}
                picked={props.picked}
                hovered={hovered}
                marked={viewing === null ? focus : null}
                disabled={props.disabled}
                onHover={(next) => setPointed((current) => (samePointed(current, next) ? current : next))}
                onTap={tap}
              />
            )}
            <CameraRig
              overview={overview}
              sight={sight}
              viewing={viewing}
              fromAbove={props.fromAbove}
              controlsRef={controlsRef}
            />
          </Canvas>
        </Fallback>
      )}

      {tipped && pointed && viewing === null && (
        <PlaceTip
          plan={plan}
          place={tipped}
          state={props.picked.includes(tipped.id) ? 'picked' : 'available'}
          at={pointed.at}
        />
      )}

      {/* The place tapped last — the view from it is a button away — or, with none, how the view is moved. */}
      {focused ? (
        <div className={styles.seatCard} aria-live="polite">
          <div>
            <strong>{describe(plan, focused.id)}</strong>
            <span>
              {[focused.category === undefined ? null : categoryNameOf(focused.category), props.status[focused.id]]
                .filter(Boolean)
                .join(' · ') || 'Place'}
            </span>
          </div>
          {viewing === null ? (
            <button type="button" className={ui.button} onClick={() => setViewing(focused.id)}>
              View from here
            </button>
          ) : (
            <button type="button" className={ui.button} onClick={() => setViewing(null)} title="Esc">
              Back to overview
            </button>
          )}
        </div>
      ) : (
        <p className={styles.status}>{hint}</p>
      )}
      <ZoomButtons
        onIn={() => zoom(1)}
        onOut={() => zoom(-1)}
        onFit={home}
        fit={viewing === null ? 'Fit' : 'Overview'}
        fitTitle={viewing === null ? 'Back to the whole plan' : 'Back to the overview (Esc)'}
      />
    </div>
  )
}

// ---------- Scene ----------

// The place under the pointer and where the top of it shows, in the view's pixels.
type Pointed = { id: string; at: TipAt }

type SceneProps = Pick<Preview3DProps, 'plan' | 'picked' | 'disabled'> & {
  pieces: Piece[]
  overview: Overview
  palette: Palette
  hovered: string | null
  // The place the card is about, ringed on the floor.
  marked: string | null
  onHover(pointed: Pointed | null): void
  onTap(place: Place<string>): void
}

function Scene({ plan, pieces, overview, palette, marked, ...props }: SceneProps) {
  const get = useThree((state) => state.get)
  const reach = overview.radius
  const mark = marked === null ? undefined : pieces.find((piece) => piece.id === marked)
  const overhead = useOverhead()
  const places = new Map(pieces.flatMap((piece) => (piece.place ? [[piece.id, piece.place] as const] : [])))
  // What is picked stands a little off the floor (./lifting.ts).
  const lifted = useLifted(new Set(props.picked))
  const disabled = new Set(props.disabled)

  const solids = pieces.map((piece): Solid => ({
    id: piece.id,
    model: piece.model,
    round: piece.shape === 'ellipse',
    x: piece.x,
    z: piece.z,
    w: piece.w,
    d: piece.d,
    yaw: piece.yaw,
    lift: (lifted.get(piece.id) ?? 0) * LIFT,
    look: lookOf(piece, palette, props, disabled),
  }))

  // Cut down while the camera is up high, so it sees into the rooms, and at full height once it is down among the
  // seats. Drawn in hairlines, as the 2D drawing draws a wall's band.
  const walls = wallsOf(plan).map((wall, i): Solid => ({
    id: `${wall.id}:${i}`,
    model: 'wall',
    round: false,
    x: wall.x,
    z: wall.z,
    w: wall.w,
    d: wall.d,
    yaw: wall.yaw,
    h: overhead ? WALL_CUT : WALL_HEIGHT,
    look: { fill: palette.solid, line: 'edge' },
  }))

  return (
    <>
      <color attach="background" args={[palette.ground]} />
      <Daylight />
      {/* The ground is the page's own colour, unlit so it meets the background. */}
      <mesh position={[overview.x, -1, overview.z]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[reach * 12, reach * 12]} />
        <meshBasicMaterial color={palette.ground} />
      </mesh>
      {seatPlan.roomsOf(plan).map((room, i) => (
        <Floor key={i} points={room.points} color={palette.floor} />
      ))}
      <Shade solids={solids} />
      <Solids solids={walls} palette={palette} />
      <Solids
        solids={solids}
        palette={palette}
        onHover={(solid) => {
          const place = placeOf(solid, places, disabled)
          props.onHover(place && solid ? { id: place.id, at: topOf(solid, get()) } : null)
        }}
        onTap={(solid) => {
          const place = placeOf(solid, places, disabled)

          if (place) props.onTap(place)
        }}
      />
      {[...writingOf(plan, pieces, fixtureLabel), ...categoryWritingOf(plan)].map((writing, i) =>
        writing.overhead && !overhead ? null : (
          <Text
            key={i}
            writing={writing}
            // What is written on something that stands there, or on the floor itself.
            color={writing.on === undefined ? palette.text : palette.onSolid}
            font={palette.font}
          />
        ),
      )}
      {mark && <Mark piece={mark} palette={palette} />}
    </>
  )
}

// A place as the 2D preview draws it: picked filled with the accent, one that cannot be picked a dashed outline, the
// one under the pointer tracing its dashes. A category is read from its label, not from a place's paint.
function lookOf(
  piece: Piece,
  palette: Palette,
  { picked, hovered }: Pick<SceneProps, 'picked' | 'hovered'>,
  disabled: ReadonlySet<string>,
): Look {
  const place = piece.place

  if (!place) return { fill: palette.solid, line: 'edge' }

  if (picked.includes(place.id)) return { fill: palette.accent, line: 'edge' }

  if (disabled.has(place.id)) return { fill: null, line: 'label', dash: true }

  return hovered === place.id
    ? { fill: palette.solid, line: 'edge', dash: true, march: true }
    : { fill: palette.solid, line: 'edge' }
}

// Where the top of a solid shows in the view, in its pixels — what a tip points at.
function topOf(solid: Solid, state: RootState): TipAt {
  const height = solid.model === 'wall' ? (solid.h ?? 0) : HEIGHT[solid.model]
  const top = TOP.set(solid.x, height + (solid.lift ?? 0), solid.z).project(state.camera)

  return { x: ((top.x + 1) / 2) * state.size.width, y: ((1 - top.y) / 2) * state.size.height }
}

// Whether the pointer is still on the same place, its tip where it was to within half a pixel.
function samePointed(a: Pointed | null, b: Pointed | null): boolean {
  if (a === null || b === null) return a === b

  return a.id === b.id && Math.abs(a.at.x - b.at.x) < 0.5 && Math.abs(a.at.y - b.at.y) < 0.5
}

// The place a solid stands for, when it can be picked.
function placeOf(
  solid: Solid | null,
  places: ReadonlyMap<string, Place<string>>,
  disabled: ReadonlySet<string>,
): Place<string> | null {
  const place = solid === null ? null : (places.get(solid.id) ?? null)

  return place && !disabled.has(place.id) ? place : null
}

// Whether the camera is up high — over the walls, looking into the rooms — rather than down among the seats.
function useOverhead(): boolean {
  const camera = useThree((state) => state.camera)
  const [overhead, setOverhead] = useState(true)
  useFrame(() => {
    const now = camera.position.y > WALL_HEIGHT * 1.6

    if (now !== overhead) setOverhead(now)
  })

  return overhead
}

// A ring on the floor round the place the card is about.
function Mark({ piece, palette }: { piece: Piece; palette: Palette }) {
  const radius = Math.max(piece.w, piece.d) * 0.62 + 6

  return (
    <mesh position={[piece.x, 2, piece.z]} rotation-x={-Math.PI / 2} geometry={RING} scale={[radius, radius, 1]}>
      <meshBasicMaterial color={palette.ink} />
    </mesh>
  )
}

// ---------- Camera ----------

// The overview orbits the plan; from a seat the camera stays put and turns (the orbit point sits just in front of
// the eye, which makes orbiting a look around).
function CameraRig({
  overview,
  sight,
  viewing,
  fromAbove,
  controlsRef,
}: {
  overview: Overview
  sight: Sight | null
  viewing: string | null
  fromAbove: boolean
  controlsRef: RefObject<CameraControls | null>
}) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const [controls] = useState(() => new CameraControls(camera))
  const flown = useRef(false)

  useFrame((_, delta) => {
    // A frame after a long idle carries the whole wait; a transition would jump to its end.
    controls.update(Math.min(delta, MAX_FRAME_S))
  }, -1)

  useEffect(() => {
    controls.connect(gl.domElement)
    controlsRef.current = controls
    const wake = () => invalidate()

    for (const type of WAKE_EVENTS) controls.addEventListener(type, wake)

    return () => {
      for (const type of WAKE_EVENTS) controls.removeEventListener(type, wake)
      controls.disconnect()
      controlsRef.current = null
    }
  }, [controls, gl, invalidate, controlsRef])

  const fly = useEffectEvent((animate: boolean) => {
    if (sight) flyTo(controls, sight, animate)
    else flyOver(controls, overview, animate)
    invalidate()
  })

  // The first view is set at once — or, coming from the 2D plan, flown to from straight above it; later ones fly.
  useEffect(() => {
    const down = !flown.current && fromAbove && above(controls, overview)
    fly(flown.current || down)
    flown.current = true
  }, [viewing])

  return null
}

function flyOver(controls: CameraControls, overview: Overview, animate: boolean) {
  const reach = overview.radius
  controls.minDistance = 2 * METRE
  controls.maxDistance = reach * 6
  controls.minPolarAngle = 0
  controls.maxPolarAngle = MAX_TILT
  controls.azimuthRotateSpeed = 1
  controls.polarRotateSpeed = 1
  controls.dollyToCursor = true
  controls.mouseButtons.left = CameraControls.ACTION.ROTATE
  controls.mouseButtons.right = CameraControls.ACTION.SCREEN_PAN
  controls.mouseButtons.middle = CameraControls.ACTION.DOLLY
  controls.mouseButtons.wheel = CameraControls.ACTION.DOLLY
  controls.touches.one = CameraControls.ACTION.TOUCH_ROTATE
  // Two fingers pinch and slide along the floor.
  // SAFETY: camera-controls runs TOUCH_DOLLY_SCREEN_PAN on two fingers (its readme lists it for `touches.two`); only
  // its `Touches` type leaves the action out.
  const touches = controls.touches as { two: number }
  touches.two = CameraControls.ACTION.TOUCH_DOLLY_SCREEN_PAN
  controls.touches.three = CameraControls.ACTION.TOUCH_SCREEN_PAN
  // The orbit point stays over the drawing.
  controls.setBoundary(
    new Box3(
      new Vector3(overview.x - reach, 0, overview.z - reach),
      new Vector3(overview.x + reach, 0, overview.z + reach),
    ),
  )
  const camera = controls.camera

  // The Canvas makes a perspective camera — the only kind with a field of view to fit the drawing in.
  if (!(camera instanceof PerspectiveCamera)) return
  // From a corner, as the editor's first view is — a quarter of a half-turn round from where the room faces.
  const azimuth = overview.azimuth + CORNER
  const distance = fitDistance(camera, overview, azimuth)
  const x = overview.x + distance * Math.sin(HOME_TILT) * Math.sin(azimuth)
  const z = overview.z + distance * Math.sin(HOME_TILT) * Math.cos(azimuth)
  controls.normalizeRotations()
  controls.zoomTo(LENS, animate && !reducedMotion())
  controls.setLookAt(x, distance * Math.cos(HOME_TILT), z, overview.x, 0, overview.z, animate && !reducedMotion())
}

// Puts the camera straight above the drawing, north up, as the 2D plan shows it. false when it cannot.
function above(controls: CameraControls, overview: Overview): boolean {
  const camera = controls.camera

  if (!(camera instanceof PerspectiveCamera) || reducedMotion()) return false
  const distance = fitDistance(camera, overview, 0)
  controls.zoomTo(LENS, false)
  // A hair south of straight above, so the top of the screen is north.
  controls.setLookAt(overview.x, distance, overview.z + distance * 0.001, overview.x, 0, overview.z, false)

  return true
}

// How far back the overview stands to show the whole drawing. The drawing's near edge is the closest to the camera,
// so it is the widest and the lowest on screen: its corners must fit the sides of the view and its middle the
// bottom.
function fitDistance(camera: PerspectiveCamera, overview: Overview, azimuth: number): number {
  const vertical = Math.tan((camera.fov * Math.PI) / 360) / LENS
  const horizontal = vertical * camera.aspect
  const sin = Math.abs(Math.sin(azimuth))
  const cos = Math.abs(Math.cos(azimuth))
  const across = (overview.w / 2) * cos + (overview.h / 2) * sin
  const along = (overview.w / 2) * sin + (overview.h / 2) * cos
  const near = along * Math.sin(HOME_TILT)

  return Math.max(across / horizontal + near, (along * Math.cos(HOME_TILT)) / vertical + near) * FIT_MARGIN
}

function flyTo(controls: CameraControls, sight: Sight, animate: boolean) {
  const { eye, look } = sight
  const d = Math.hypot(look.x - eye.x, look.y - eye.y, look.z - eye.z) || 1
  controls.minDistance = EYE_REACH
  controls.maxDistance = EYE_REACH
  controls.minPolarAngle = Math.PI / 2 - LOOK_DOWN
  controls.maxPolarAngle = Math.PI / 2 + LOOK_UP
  // Dragging turns the view the way a panorama does.
  controls.azimuthRotateSpeed = -0.35
  controls.polarRotateSpeed = -0.35
  controls.dollyToCursor = false
  controls.minZoom = 1
  controls.maxZoom = 4
  controls.mouseButtons.left = CameraControls.ACTION.ROTATE
  controls.mouseButtons.right = CameraControls.ACTION.NONE
  controls.mouseButtons.middle = CameraControls.ACTION.NONE
  controls.mouseButtons.wheel = CameraControls.ACTION.ZOOM
  controls.touches.one = CameraControls.ACTION.TOUCH_ROTATE
  controls.touches.two = CameraControls.ACTION.TOUCH_ZOOM
  controls.touches.three = CameraControls.ACTION.NONE
  controls.setBoundary()
  controls.normalizeRotations()
  // A guest's eyes, not the overview's long lens.
  controls.zoomTo(1, animate && !reducedMotion())
  controls.setLookAt(
    eye.x,
    eye.y,
    eye.z,
    eye.x + ((look.x - eye.x) / d) * EYE_REACH,
    eye.y + ((look.y - eye.y) / d) * EYE_REACH,
    eye.z + ((look.z - eye.z) / d) * EYE_REACH,
    animate && !reducedMotion(),
  )
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// ---------- Constants ----------

const FOV = 40

// The overview's tilt from straight down — the editor's corner view, 35° above the floor — and how far a drag may tip
// it toward the horizon.
const HOME_TILT = (55 * Math.PI) / 180

// How far round from the way the room faces the overview stands: at a corner.
const CORNER = Math.PI / 4

// The overview's zoom: a long lens from further back, which flattens the room toward the editor's drawing of it.
const LENS = 2

const MAX_TILT = (80 * Math.PI) / 180

// From a seat: the orbit point's distance in front of the eye, and how far one may look down and up.
const EYE_REACH = 1

const LOOK_DOWN = (60 * Math.PI) / 180

const LOOK_UP = (35 * Math.PI) / 180

const MAX_FRAME_S = 1 / 30

// Room around the drawing in the overview; a zoom button's step in the overview and through the lens from a seat.
const FIT_MARGIN = 1.06

const DOLLY_STEP = 0.6

const LENS_STEP = 0.5

const WAKE_EVENTS = ['control', 'transitionstart', 'update', 'wake'] as const

const RING = new RingGeometry(0.86, 1, 48)

const TOP = new Vector3()
