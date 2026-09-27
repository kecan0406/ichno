'use client'

import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import CameraControls from 'camera-controls'
import type { Fixture, Place, SeatPlan } from 'ichno'
import {
  Component,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Raycaster,
  RingGeometry,
  Shape as Outline,
  ShapeGeometry,
  Sphere,
  Spherical,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4,
  type BufferGeometry,
  type InstancedMesh,
  type PerspectiveCamera,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  HEIGHT,
  METRE,
  SCREEN_BOTTOM,
  WALL_CUT,
  WALL_HEIGHT,
  overviewOf,
  piecesOf,
  sightFrom,
  wallsOf,
  writingOf,
  type Model,
  type Overview,
  type Piece,
  type Sight,
  type Wall,
  type Writing,
} from '../_lib/scene'
import styles from '../playground.module.css'

// The playground's 3D preview — the same document the 2D preview draws, stood up with three.js by this site
// (ichno draws 2D only). What stands where, how tall and facing which way is the site's reading of its roles
// (../_lib/scene.ts); the look is this file's. Loaded only when someone switches to 3D.

CameraControls.install({
  THREE: { Box3, Matrix4, Quaternion, Raycaster, Sphere, Spherical, Vector2, Vector3, Vector4 },
})

export type Preview3DProps = {
  plan: SeatPlan<string>
  status: Record<string, string>
  picked: readonly string[]
  isDisabled(place: Place<string>): boolean
  sectionName(id: string): string
  fixtureName(fixture: Fixture): string | null
  onPlaceTap(place: Place<string>): void
}

export default function Preview3D(props: Preview3DProps) {
  const { plan, sectionName } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<CameraControls | null>(null)
  const [palette, setPalette] = useState<Palette | null>(null)
  // The place tapped last — the card offers the view from it — and the place being looked from.
  const [focus, setFocus] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const pieces = piecesOf(plan)
  const overview = overviewOf(plan, pieces)
  const sight = viewing === null ? null : sightFrom(plan, pieces, viewing)
  const focused = pieces.find((piece) => piece.id === (viewing ?? focus))?.place ?? null

  // Colours come from the page's theme, read again when it switches between light and dark.
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const read = () => setPalette(paletteOf(host))
    read()
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    scheme.addEventListener('change', read)
    return () => scheme.removeEventListener('change', read)
  }, [])

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

  const status =
    viewing !== null
      ? 'Drag to look around, scroll or pinch to zoom. Esc goes back.'
      : 'Drag to orbit, right-drag or two fingers to pan, scroll or pinch to zoom. Tap a place to pick it.'

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
            shadows="percentage"
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
                status={props.status}
                picked={props.picked}
                hovered={hovered}
                marked={viewing === null ? focus : null}
                isDisabled={props.isDisabled}
                sectionName={sectionName}
                fixtureName={props.fixtureName}
                onHover={setHovered}
                onTap={tap}
              />
            )}
            <CameraRig overview={overview} sight={sight} viewing={viewing} controlsRef={controlsRef} />
          </Canvas>
        </Fallback>
      )}

      {focused && (
        <div className={styles.seatCard} aria-live="polite">
          <div>
            <strong>{focused.label ?? focused.id}</strong>
            <span>
              {[focused.role, sectionName(focused.section), props.status[focused.id]].filter(Boolean).join(' · ')}
            </span>
          </div>
          {viewing === null ? (
            <button type="button" className={styles.button} onClick={() => setViewing(focused.id)}>
              View from here
            </button>
          ) : (
            <button type="button" className={styles.button} onClick={() => setViewing(null)} title="Esc">
              Back to overview
            </button>
          )}
        </div>
      )}

      <div className={styles.status} aria-live="polite">
        {status}
      </div>
      <div className={styles.zoom}>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(-1)}>
          −
        </button>
        <button
          type="button"
          className={styles.zoomLevel}
          title={viewing === null ? 'Back to the whole plan' : 'Back to the overview (Esc)'}
          onClick={home}
        >
          {viewing === null ? 'Fit' : 'Overview'}
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1)}>
          +
        </button>
      </div>
    </div>
  )
}

// ---------- Scene ----------

type SceneProps = Pick<Preview3DProps, 'plan' | 'status' | 'picked' | 'isDisabled' | 'sectionName' | 'fixtureName'> & {
  pieces: Piece[]
  overview: Overview
  palette: Palette
  hovered: string | null
  // The place the card is about, ringed on the floor.
  marked: string | null
  onHover(id: string | null): void
  onTap(place: Place<string>): void
}

function Scene({ plan, pieces, overview, palette, marked, sectionName, fixtureName, ...batchProps }: SceneProps) {
  const reach = overview.radius
  const [sun] = useState(() => new Object3D())
  // One batch of instances per model and shape.
  const batches = new Map<string, Piece[]>()
  for (const piece of pieces) {
    const key = `${piece.model}:${piece.shape}`
    const batch = batches.get(key)
    if (batch) batch.push(piece)
    else batches.set(key, [piece])
  }
  const mark = marked === null ? undefined : pieces.find((piece) => piece.id === marked)
  const overhead = useOverhead()

  return (
    <>
      <color attach="background" args={[palette.ground]} />
      <hemisphereLight args={[palette.sky, palette.ground, 1.6]} />
      <primitive object={sun} position={[overview.x, 0, overview.z]} />
      <directionalLight
        target={sun}
        position={[overview.x - reach * 0.5, reach * 1.4, overview.z + reach * 0.8]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={1.5}
        shadow-camera-left={-reach * 1.2}
        shadow-camera-right={reach * 1.2}
        shadow-camera-top={reach * 1.2}
        shadow-camera-bottom={-reach * 1.2}
        shadow-camera-near={reach * 0.2}
        shadow-camera-far={reach * 4}
      />
      {/* The ground is the page's own colour, unlit so it meets the background; shadows fall on a catcher above it. */}
      <mesh position={[overview.x, 0, overview.z]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[reach * 12, reach * 12]} />
        <meshBasicMaterial color={palette.ground} />
      </mesh>
      <mesh position={[overview.x, 0.5, overview.z]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[reach * 12, reach * 12]} />
        <shadowMaterial opacity={0.12} />
      </mesh>
      {plan.sections.map((section) => (
        <Floor key={section.id} points={section.points} color={palette.floor} />
      ))}
      <Walls walls={wallsOf(plan)} color={palette.wall} cut={overhead} />
      {[...batches].map(([key, batch]) => (
        <Batch key={key} pieces={batch} palette={palette} {...batchProps} />
      ))}
      {writingOf(plan, pieces, sectionName, fixtureName).map((writing, i) =>
        writing.overhead && !overhead ? null : (
          <Text key={i} writing={writing} color={palette[writing.tone]} font={palette.font} />
        ),
      )}
      {mark && <Mark piece={mark} color={palette.picked} />}
    </>
  )
}

// A batch of pieces sharing a model — one draw call. Places take their colour from their state.
function Batch({
  pieces,
  palette,
  status,
  picked,
  hovered,
  isDisabled,
  onHover,
  onTap,
}: Pick<SceneProps, 'palette' | 'status' | 'picked' | 'hovered' | 'isDisabled' | 'onHover' | 'onTap'> & {
  pieces: Piece[]
}) {
  const ref = useRef<InstancedMesh>(null)
  const invalidate = useThree((state) => state.invalidate)
  const first = pieces[0]!

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    pieces.forEach((piece, i) => {
      MATRIX.compose(
        POSITION.set(piece.x, 0, piece.z),
        TURN.setFromAxisAngle(UP, piece.yaw),
        SCALE.set(Math.max(piece.w, 1), 1, Math.max(piece.d, 1)),
      )
      mesh.setMatrixAt(i, MATRIX)
      mesh.setColorAt(i, colorOf(piece, palette, status, picked, hovered))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    invalidate()
  })

  // The place under the pointer, when it can be picked.
  function placeAt(e: ThreeEvent<PointerEvent | MouseEvent>): Place<string> | null {
    const place = e.instanceId === undefined ? null : (pieces[e.instanceId]?.place ?? null)
    return place && !isDisabled(place) ? place : null
  }

  return (
    <instancedMesh
      ref={ref}
      args={[geometryOf(first.model, first.shape === 'ellipse'), MATERIAL, pieces.length]}
      castShadow
      receiveShadow
      onPointerMove={(e) => {
        e.stopPropagation()
        onHover(placeAt(e)?.id ?? null)
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation()
        // A drag turned the camera; it picked nothing.
        if (e.delta > CLICK_SLOP_PX) return
        const place = placeAt(e)
        if (place) onTap(place)
      }}
    />
  )
}

function colorOf(
  piece: Piece,
  palette: Palette,
  status: Record<string, string>,
  picked: readonly string[],
  hovered: string | null,
): Color {
  const place = piece.place
  if (!place) return palette.models[piece.model]
  if (picked.includes(place.id)) return palette.picked
  if (status[place.id] !== undefined) return palette.booked
  const base = (place.category === undefined ? undefined : palette.categories[place.category]) ?? palette.open
  return hovered === place.id ? MIXED.copy(base).lerp(palette.picked, 0.4) : base
}

// A section's floor, a little above the ground so the two never fight.
function Floor({ points, color }: { points: { x: number; y: number }[]; color: Color }) {
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)
  useEffect(() => {
    // Drawn in x and −y, then laid down: y becomes z and the face looks up.
    const made = new ShapeGeometry(new Outline(points.map((p) => new Vector2(p.x, -p.y)))).rotateX(-Math.PI / 2)
    setGeometry(made)
    return () => made.dispose()
  }, [points])
  if (!geometry) return null
  return (
    <mesh geometry={geometry} position-y={1} receiveShadow>
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  )
}

// Every wall — cut down while the camera is up high, so it sees into the rooms, and grown to full height once it is
// down among the seats.
function Walls({ walls, color, cut }: { walls: Wall[]; color: Color; cut: boolean }) {
  const ref = useRef<InstancedMesh>(null)
  const invalidate = useThree((state) => state.invalidate)

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    walls.forEach((wall, i) => {
      MATRIX.compose(POSITION.set(wall.x, 0, wall.z), TURN.setFromAxisAngle(UP, wall.yaw), SCALE.set(wall.w, 1, wall.d))
      mesh.setMatrixAt(i, MATRIX)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    invalidate()
  })

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const wanted = cut ? WALL_CUT : WALL_HEIGHT
    const next = mesh.scale.y + (wanted - mesh.scale.y) * 0.2
    mesh.scale.y = Math.abs(wanted - next) < 0.5 ? wanted : next
    if (mesh.scale.y !== wanted) invalidate()
  })

  if (walls.length === 0) return null
  return (
    <instancedMesh
      ref={ref}
      args={[WALL_GEOMETRY, undefined, walls.length]}
      scale-y={WALL_CUT}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial color={color} roughness={0.9} />
    </instancedMesh>
  )
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
function Mark({ piece, color }: { piece: Piece; color: Color }) {
  const radius = Math.max(piece.w, piece.d) * 0.62 + 6
  return (
    <mesh position={[piece.x, 2, piece.z]} rotation-x={-Math.PI / 2} geometry={RING} scale={[radius, radius, 1]}>
      <meshBasicMaterial color={color} />
    </mesh>
  )
}

// Text drawn once into a canvas and shown on a plane (flat or upright) or a sprite (a sign facing the camera).
function Text({ writing, color, font }: { writing: Writing; color: Color; font: string }) {
  const [label, setLabel] = useState<{ texture: CanvasTexture; aspect: number } | null>(null)
  const hex = color.getHexString()
  useEffect(() => {
    const made = textTexture(writing.text, `#${hex}`, font)
    setLabel(made)
    return () => made.texture.dispose()
  }, [writing.text, hex, font])
  if (!label) return null
  const h = writing.size * TEXT_LINE
  const w = h * label.aspect
  // Left-aligned text starts at its point; the plane is centred, so shift it along the line.
  const shift = writing.anchor === 'start' ? w / 2 : 0
  if (writing.lie === 'sign') {
    return (
      <sprite
        position={[writing.x, writing.y, writing.z]}
        scale={[w, h, 1]}
        center={[writing.anchor === 'start' ? 0 : 0.5, 0]}
      >
        <spriteMaterial map={label.texture} transparent depthWrite={false} />
      </sprite>
    )
  }
  const along = { x: Math.cos(writing.yaw), z: -Math.sin(writing.yaw) }
  return (
    <mesh
      position={[writing.x + along.x * shift, writing.y, writing.z + along.z * shift]}
      // Laid down with its top toward the top of the plan, then turned; upright text faces the way its piece does.
      rotation={writing.lie === 'flat' ? [-Math.PI / 2, 0, writing.yaw] : [0, writing.yaw + Math.PI, 0]}
    >
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={label.texture} transparent depthWrite={false} />
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
  controlsRef,
}: {
  overview: Overview
  sight: Sight | null
  viewing: string | null
  controlsRef: RefObject<CameraControls | null>
}) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera
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
  // The first view is set at once; later ones fly.
  useEffect(() => {
    fly(flown.current)
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
  // Two fingers pinch and slide along the floor. camera-controls handles this for two fingers (its readme lists
  // it) but leaves it out of the type.
  controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_SCREEN_PAN as number as CameraControls['touches']['two']
  controls.touches.three = CameraControls.ACTION.TOUCH_SCREEN_PAN
  // The orbit point stays over the drawing.
  controls.setBoundary(
    new Box3(
      new Vector3(overview.x - reach, 0, overview.z - reach),
      new Vector3(overview.x + reach, 0, overview.z + reach),
    ),
  )
  const distance = fitDistance(controls.camera as PerspectiveCamera, overview)
  const x = overview.x + distance * Math.sin(HOME_TILT) * Math.sin(overview.azimuth)
  const z = overview.z + distance * Math.sin(HOME_TILT) * Math.cos(overview.azimuth)
  controls.normalizeRotations()
  controls.zoomTo(1, animate && !reducedMotion())
  controls.setLookAt(x, distance * Math.cos(HOME_TILT), z, overview.x, 0, overview.z, animate && !reducedMotion())
}

// How far back the overview stands to show the whole drawing. The drawing's near edge is the closest to the camera,
// so it is the widest and the lowest on screen: its corners must fit the sides of the view and its middle the
// bottom.
function fitDistance(camera: PerspectiveCamera, overview: Overview): number {
  const vertical = Math.tan((camera.fov * Math.PI) / 360)
  const horizontal = vertical * camera.aspect
  const sin = Math.abs(Math.sin(overview.azimuth))
  const cos = Math.abs(Math.cos(overview.azimuth))
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

// ---------- Look ----------

// The theme, resolved to colours three.js can use.
type Palette = {
  ground: Color
  sky: Color
  floor: Color
  wall: Color
  label: Color
  ink: Color
  open: Color
  booked: Color
  picked: Color
  categories: Record<string, Color>
  models: Record<Model, Color>
  font: string
}

function paletteOf(host: HTMLElement): Palette {
  const probe = document.createElement('i')
  probe.hidden = true
  host.append(probe)
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  // Through the probe for the page's variables, then through a pixel for sRGB — `color()` and `color-mix()` come
  // back from the style in forms three.js cannot parse.
  const read = (css: string) => {
    probe.style.color = css
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = getComputedStyle(probe).color
    context.fillRect(0, 0, 1, 1)
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data
    return new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace)
  }
  const mix = (a: string, share: number, b = 'var(--ichno-surface)') => read(`color-mix(in srgb, ${a} ${share}%, ${b})`)
  const furniture = mix('var(--ichno-ink)', 10)
  const fixture = mix('var(--ichno-ink)', 22)
  const structure = mix('var(--ichno-ink)', 45)
  const palette: Palette = {
    ground: read('var(--theme-bg)'),
    sky: read('var(--ichno-surface)'),
    floor: read('var(--ichno-surface)'),
    wall: mix('var(--ichno-ink)', 28),
    label: read('var(--ichno-label)'),
    ink: read('var(--ichno-ink)'),
    open: mix('var(--ichno-ink)', 10),
    booked: mix('var(--ichno-ink)', 62),
    picked: read('var(--ichno-accent)'),
    categories: { premium: mix('var(--theme-premium)', 55), access: mix('var(--theme-access)', 55) },
    models: {
      chair: furniture,
      sofa: furniture,
      table: furniture,
      coffee: furniture,
      desk: furniture,
      booth: fixture,
      area: fixture,
      stage: fixture,
      screen: read('var(--ichno-surface)'),
      bar: fixture,
      door: structure,
      pillar: structure,
      block: fixture,
    },
    font: getComputedStyle(host).getPropertyValue('--ichno-font').trim() || 'sans-serif',
  }
  probe.remove()
  return palette
}

function textTexture(text: string, color: string, font: string): { texture: CanvasTexture; aspect: number } {
  const canvas = document.createElement('canvas')
  // Kept on the CPU — WebGL takes the pixels without reading them back from the GPU.
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const style = `700 ${TEXT_PX}px ${font}`
  context.font = style
  canvas.width = Math.ceil(context.measureText(text).width + TEXT_PX * 0.4)
  canvas.height = Math.ceil(TEXT_PX * TEXT_LINE)
  // Resizing a canvas resets its state.
  context.font = style
  context.fillStyle = color
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, canvas.width / 2, canvas.height / 2)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  return { texture, aspect: canvas.width / canvas.height }
}

// ---------- Models ----------

// Each model on a 1 × 1 footprint about the origin (facing −z) standing on y = 0, with its real heights; instances
// stretch it over their footprints. Built once, on first use.
const GEOMETRIES = new Map<string, BufferGeometry>()

function geometryOf(model: Model, round: boolean): BufferGeometry {
  const key = `${model}:${round}`
  const cached = GEOMETRIES.get(key)
  if (cached) return cached
  const made = mergeGeometries(partsOf(model, round))
  GEOMETRIES.set(key, made)
  return made
}

function partsOf(model: Model, round: boolean): BufferGeometry[] {
  const top = HEIGHT[model]
  const m = METRE
  switch (model) {
    case 'chair':
      return [
        slab(round, 0.14, 0, 0.42 * m),
        slab(round, 0, 0.42 * m, 0.48 * m),
        round ? box(-0.32, 0.32, 0.3, 0.44, 0.48 * m, top) : box(-0.46, 0.46, 0.34, 0.5, 0.48 * m, top),
      ]
    case 'sofa':
      return [
        box(-0.5, 0.5, -0.5, 0.5, 0, 0.42 * m),
        box(-0.5, 0.5, 0.28, 0.5, 0.42 * m, top),
        box(-0.5, -0.42, -0.5, 0.28, 0.42 * m, 0.62 * m),
        box(0.42, 0.5, -0.5, 0.28, 0.42 * m, 0.62 * m),
      ]
    case 'table':
      return [slab(round, 0, top - 0.04 * m, top), pole(0.12, 0, top), pole(0.3, 0, 0.03 * m)]
    case 'coffee':
      return [slab(round, 0, top - 0.06 * m, top), slab(round, 0.1, 0, top)]
    case 'desk':
      return [
        box(-0.5, 0.5, -0.5, 0.5, top - 0.04 * m, top),
        box(-0.5, -0.46, -0.45, 0.45, 0, top),
        box(0.46, 0.5, -0.45, 0.45, 0, top),
      ]
    case 'booth':
      return [
        slab(round, 0, 0, 0.03 * m),
        box(-0.5, 0.5, 0.46, 0.5, 0, top),
        box(-0.5, -0.46, -0.5, 0.5, 0, top),
        box(0.46, 0.5, -0.5, 0.5, 0, top),
      ]
    case 'screen':
      return [box(-0.5, 0.5, -0.2, 0.2, SCREEN_BOTTOM, top), box(-0.02, 0.02, -0.1, 0.1, 0, SCREEN_BOTTOM)]
    case 'door':
      return [
        box(-0.5, -0.44, -0.5, 0.5, 0, top),
        box(0.44, 0.5, -0.5, 0.5, 0, top),
        box(-0.5, 0.5, -0.5, 0.5, top - 0.1 * m, top),
      ]
    default:
      return [slab(round, 0, 0, top)]
  }
}

// A box from x0 to x1, z0 to z1 (footprint units) and y0 to y1 (plan units).
function box(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number): BufferGeometry {
  return new BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
}

// The whole footprint, `inset` in from its edge, from y0 to y1 — a disc for round shapes.
function slab(round: boolean, inset: number, y0: number, y1: number): BufferGeometry {
  return round ? pole(0.5 - inset, y0, y1) : box(-0.5 + inset, 0.5 - inset, -0.5 + inset, 0.5 - inset, y0, y1)
}

function pole(radius: number, y0: number, y1: number): BufferGeometry {
  return new CylinderGeometry(radius, radius, y1 - y0, 40).translate(0, (y0 + y1) / 2, 0)
}

// ---------- Errors ----------

// WebGL can fail to start (blocked, no GPU); the page keeps working.
class Fallback extends Component<{ children: ReactNode; onError(): void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onError()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

// ---------- Constants ----------

const FOV = 40
// The overview's tilt from straight down, and how far a drag may tip it toward the horizon.
const HOME_TILT = (48 * Math.PI) / 180
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
// How far a press may travel and still be a tap.
const CLICK_SLOP_PX = 6
const WAKE_EVENTS = ['control', 'transitionstart', 'update', 'wake'] as const
// Text is drawn this many pixels tall, on a line this many times its size.
const TEXT_PX = 96
const TEXT_LINE = 1.3

const MATERIAL = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 })
const WALL_GEOMETRY = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
const RING = new RingGeometry(0.86, 1, 48)
const UP = new Vector3(0, 1, 0)
const MATRIX = new Matrix4()
const POSITION = new Vector3()
const TURN = new Quaternion()
const SCALE = new Vector3()
const MIXED = new Color()
