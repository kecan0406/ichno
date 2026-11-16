'use client'

import { useFrame, useThree, type RootState } from '@react-three/fiber'
import { ISOMETRIC_ELEVATION, type PlanPoint, type PlanTarget } from 'ichno'
import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  InstancedBufferAttribute,
  Matrix4,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  ShapeGeometry,
  Shape as Outline,
  ShaderMaterial,
  Sprite,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Camera,
  type DirectionalLight,
  type InstancedMesh,
  type Mesh,
  type MeshBasicMaterial,
  type Object3D,
} from 'three'
import { creasesOf, facesOf, polesOf, type Solid3D } from '../_lib/models'
import type { Writing } from '../_lib/scene'

// How the playground's canvas draws (./plan-canvas.tsx): faces in one colour, lit only enough to tell a top from
// the two sides that show, every edge a hairline in the ink — dashed for guides and for what cannot be had — and the
// selection filled with its one colour. Colours come from the page's theme variables.

// ---------- Look ----------

export type Palette = {
  ground: Color
  // What stands on the plan, as the 2D canvases paint it (the `--plan-*` tokens): the faces, their edges, what is
  // written on them, the floor they stand on, lettering on that floor, and the selection.
  solid: Color
  edge: Color
  onSolid: Color
  floor: Color
  text: Color
  accent: Color
  // What is written on the selection's colour.
  onAccent: Color
  // What the editor draws over the plan — outlines, strokes, the mark under a place.
  ink: Color
  label: Color
  grid: Color
  warning: Color
  // Faces of places that overlap.
  warningFill: Color
  font: string
  // The font of a place's number.
  numberFont: string
}

// The theme's colours, read again when the page switches between light and dark — with the system, or with the
// playground's theme button (`data-theme` on <html>).
export function usePalette(hostRef: RefObject<HTMLElement | null>): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(null)
  useLayoutEffect(() => {
    const host = hostRef.current

    if (!host) return
    const read = () => setPalette(paletteOf(host))
    read()
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    scheme.addEventListener('change', read)
    const picked = new MutationObserver(read)
    picked.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      scheme.removeEventListener('change', read)
      picked.disconnect()
    }
  }, [hostRef])

  return palette
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

  const mix = (a: string, share: number) => read(`color-mix(in srgb, ${a} ${share}%, var(--plan-solid))`)

  const palette: Palette = {
    ground: read('var(--plan-ground)'),
    solid: read('var(--plan-solid)'),
    edge: read('var(--plan-edge)'),
    onSolid: read('var(--plan-solid-fg)'),
    floor: read('var(--plan-floor)'),
    text: read('var(--plan-text)'),
    accent: read('var(--plan-accent)'),
    onAccent: read('var(--plan-accent-fg)'),
    ink: read('var(--ichno-ink)'),
    label: read('var(--ichno-label)'),
    grid: read('var(--ichno-grid)'),
    warning: read('var(--ichno-warning)'),
    warningFill: mix('var(--ichno-warning)', 18),
    font: getComputedStyle(host).getPropertyValue('--ichno-font').trim() || 'sans-serif',
    numberFont: getComputedStyle(host).getPropertyValue('--ichno-number-font').trim() || 'sans-serif',
  }

  probe.remove()

  return palette
}

// Three tones for the three faces a corner view shows, the way an isometric drawing shades its volumes: a top in its
// own colour, the side on the left a little darker, the side on the right darker again — on the screen, so they hold
// whichever way the view is turned. The light stands over the left of the two sides that face the eye and follows
// the camera round. Lambert light is (ambient + direct · cos) / π of the colour: a top is exactly its colour, the
// left side LEFT_SHADE of it, the right side — square to the light — RIGHT_SHADE.
export function Daylight() {
  const light = useRef<DirectionalLight>(null)
  useFrame(({ camera }) => {
    const [rx = 1, , rz = 0, , ux = 0, , uz = 0, , tx = 0, , tz = 0] = camera.matrixWorld.elements
    // The way toward the eye along the floor — straight down, the bottom of the view stands in for it.
    const [x, z] = Math.hypot(tx, tz) > 1e-3 ? [tx, tz] : [-ux, -uz]
    const length = Math.hypot(x, z) || 1
    light.current?.position.set((x / length - rx) * LIGHT_ASIDE, 1, (z / length - rz) * LIGHT_ASIDE)
  })

  return (
    <>
      <ambientLight intensity={Math.PI * RIGHT_SHADE} />
      <directionalLight ref={light} intensity={Math.PI * (1 - RIGHT_SHADE) * Math.hypot(1, LIGHT_ASIDE * Math.SQRT2)} />
    </>
  )
}

const RIGHT_SHADE = 0.72

const LEFT_SHADE = 0.86

// How far aside the light stands for each unit it stands up. Of the two sides that show, the left one faces
// (toward − right) / √2 and the right one (toward + right) / √2: a light this far along (toward − right) is square
// to the right side and lights the left one to LEFT_SHADE.
const LIGHT_ASIDE = (LEFT_SHADE - RIGHT_SHADE) / (1 - RIGHT_SHADE) / Math.SQRT2

// ---------- Solids ----------

// The ink a hairline is drawn in — `edge` round what stands on the plan, `ink` for what the editor draws over it.
export type Ink = 'ink' | 'edge' | 'label' | 'warning' | 'grid'

// How a solid is drawn: its faces' colour (null for none — only its edges), its edges' ink, dashed or solid, and
// whether the dashes march (as the 2D view's outlines do under the pointer and round the selection).
export type Look = { fill: Color | null; line: Ink; dash?: boolean; march?: boolean }

// Something standing on the floor: a model on a footprint centred at (x, z), `w` across and `d` along the way it
// faces, turned by `yaw` radians about the vertical; `h` stretches it upward (walls). `target` is what a tap on it
// means to the editor.
export type Solid = {
  id: string
  model: Solid3D
  round: boolean
  x: number
  z: number
  w: number
  d: number
  yaw: number
  h?: number
  // Its size about its foot while it settles in or away (./settling.ts) — 1 when left out.
  grow?: number
  // How far off the floor it stands while it is selected or picked (./lifting.ts), in plan units — 0 when left out.
  lift?: number
  look: Look
  target?: PlanTarget<string>
}

// Faces the caller hit-tests itself, with what each instance stands for.
export type Picks = Map<Object3D, (instance: number | undefined) => PlanTarget<string> | null>

// Solids in their looks: one draw call per model for the faces, one per look for the edges. `ghost` draws the
// faces see-through — what a tool would make. Faces registered in `picks` are what the canvas hit-tests.
export function Solids({
  solids,
  palette,
  ghost = false,
  picks,
}: {
  solids: readonly Solid[]
  palette: Palette
  ghost?: boolean
  picks?: Picks
}) {
  const faces = groupBy(
    solids.filter((solid) => solid.look.fill !== null),
    (solid) => `${solid.model}:${solid.round}`,
  )

  const lines = groupBy(solids, (solid) => lookKey(solid.look))

  return (
    <>
      {[...faces].map(([key, batch]) => (
        <Faces
          // A new count is a new mesh — and its registration for hit-testing.
          key={`${key}:${batch.length}`}
          solids={batch}
          ghost={ghost}
          picks={picks}
        />
      ))}
      {[...lines].map(([key, group]) => (
        <SolidEdges key={key} solids={group} color={inkOf(palette, group[0]!.look.line)} look={group[0]!.look} />
      ))}
    </>
  )
}

function Faces({ solids, ghost, picks }: { solids: readonly Solid[]; ghost: boolean; picks?: Picks }) {
  const ref = useRef<InstancedMesh>(null)
  // The solids as last drawn — what a hit on an instance means.
  const drawn = useRef(solids)
  const invalidate = useThree((state) => state.invalidate)
  const first = solids[0]!

  useLayoutEffect(() => {
    const mesh = ref.current

    if (!mesh) return
    drawn.current = solids
    solids.forEach((solid, i) => mesh.setMatrixAt(i, matrixOf(solid)))
    mesh.instanceMatrix.needsUpdate = true
    solids.forEach((solid, i) => mesh.setColorAt(i, solid.look.fill!))

    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    invalidate()
  })

  useEffect(() => {
    const mesh = ref.current

    if (!mesh || !picks) return
    picks.set(mesh, (i) => (i === undefined ? null : (drawn.current[i]?.target ?? null)))

    return () => {
      picks.delete(mesh)
    }
  }, [picks])

  return (
    <instancedMesh ref={ref} args={[facesOf(first.model, first.round), ghost ? GHOST_FACES : FACES, solids.length]} />
  )
}

// The edges of solids sharing a look — the folds of their models, fixed to them, and the outline of their round
// parts, which follows the camera round.
function SolidEdges({ solids, color, look }: { solids: readonly Solid[]; color: Color; look: Look }) {
  const [creases] = useState(() => new BufferGeometry())
  const [outlines] = useState(() => new BufferGeometry())
  const invalidate = useThree((state) => state.invalidate)
  // Where the outlines were last drawn from, and for which solids.
  const seen = useRef<{ eye: Matrix4; solids: readonly Solid[] } | null>(null)
  const signature = solids.map(signatureOf).join(';')

  useEffect(
    () => () => {
      creases.dispose()
      outlines.dispose()
    },
    [creases, outlines],
  )

  // Rebuilt only when a solid moved or changed — a render for a hover elsewhere draws the same edges.
  useLayoutEffect(() => {
    setSegments(creases, creaseSegments(solids))
    seen.current = null
    invalidate()
    // `signature` stands for the solids' geometry.
  }, [signature, creases, invalidate])

  useFrame(({ camera }) => {
    const last = seen.current

    if (last && last.solids === solids && last.eye.equals(camera.matrixWorld)) return
    seen.current = { eye: camera.matrixWorld.clone(), solids }
    setSegments(outlines, outlineSegments(solids, camera))
  })

  return (
    <>
      <Hairlines geometry={creases} color={color} look={look} />
      <Hairlines geometry={outlines} color={color} look={look} />
    </>
  )
}

function creaseSegments(solids: readonly Solid[]): Float32Array {
  const total = solids.reduce((sum, solid) => sum + creasesOf(solid.model, solid.round).length, 0)
  const out = new Float32Array(total)
  let at = 0

  for (const solid of solids) {
    const local = creasesOf(solid.model, solid.round)
    const matrix = matrixOf(solid)

    for (let i = 0; i < local.length; i += 3) {
      POINT.set(local[i]!, local[i + 1]!, local[i + 2]!).applyMatrix4(matrix)
      out[at++] = POINT.x
      out[at++] = POINT.y
      out[at++] = POINT.z
    }
  }

  return out
}

// The two upright lines where the view grazes each round part. A part is a cylinder stretched over its footprint
// — an ellipse with half-axes a and b — and the view grazes it where the ellipse's normal is square to the
// direction the camera looks at it from.
function outlineSegments(solids: readonly Solid[], camera: Camera): Float32Array {
  camera.getWorldDirection(AHEAD)
  const lines: number[] = []

  for (const solid of solids) {
    const poles = polesOf(solid.model, solid.round)

    if (poles.length === 0) continue
    // A parallel view looks at every solid from the same side.
    const vx = AHEAD.x
    const vz = AHEAD.z

    if (Math.hypot(vx, vz) < 1e-6) continue
    const cos = Math.cos(solid.yaw)
    const sin = Math.sin(solid.yaw)
    // The view direction in the solid's own frame (turned back by its yaw).
    const lx = vx * cos - vz * sin
    const lz = vx * sin + vz * cos

    const grow = solid.grow ?? 1

    for (const pole of poles) {
      const a = pole.r * Math.max(solid.w, 1) * grow
      const b = pole.r * Math.max(solid.d, 1) * grow
      const t = Math.atan2(-b * lx, a * lz)

      for (const side of [1, -1]) {
        const px = side * a * Math.cos(t)
        const pz = side * b * Math.sin(t)
        const x = solid.x + px * cos + pz * sin
        const z = solid.z - px * sin + pz * cos
        const h = (solid.h ?? 1) * grow
        const lift = solid.lift ?? 0
        lines.push(x, pole.y0 * h + lift, z, x, pole.y1 * h + lift, z)
      }
    }
  }

  return new Float32Array(lines)
}

function matrixOf(solid: Solid): Matrix4 {
  const grow = solid.grow ?? 1

  return MATRIX.compose(
    POSITION.set(solid.x, solid.lift ?? 0, solid.z),
    TURN.setFromAxisAngle(UP, solid.yaw),
    SCALE.set(Math.max(solid.w, 1) * grow, (solid.h ?? 1) * grow, Math.max(solid.d, 1) * grow),
  )
}

function signatureOf(solid: Solid): string {
  return `${solid.model}:${solid.round}:${solid.x}:${solid.z}:${solid.w}:${solid.d}:${solid.yaw}:${solid.h ?? 1}:${solid.grow ?? 1}:${solid.lift ?? 0}`
}

function lookKey(look: Look): string {
  return `${look.line}:${look.dash === true}:${look.march === true}`
}

export function inkOf(palette: Palette, ink: Ink): Color {
  switch (ink) {
    case 'ink':
      return palette.ink
    case 'edge':
      return palette.edge
    case 'label':
      return palette.label
    case 'warning':
      return palette.warning
    case 'grid':
      return palette.grid
  }
}

// ---------- Shade ----------

// A soft patch of shade on the floor under each solid, so what stands there reads as standing on it. One draw call: a
// patch over each footprint and SHADE_REACH past it, fading from the footprint's edge outward — the same width round
// a seat and round a stage. It stays on the floor while a solid lifts.
export function Shade({ solids }: { solids: readonly Solid[] }) {
  const ref = useRef<InstancedMesh>(null)
  const invalidate = useThree((state) => state.invalidate)
  const [material] = useState(shadeMaterial)
  // Its own geometry — which of the patches are round is written on it.
  const [plane] = useState(() => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2))

  useEffect(
    () => () => {
      material.dispose()
      plane.dispose()
    },
    [material, plane],
  )

  useLayoutEffect(() => {
    const mesh = ref.current

    if (!mesh) return
    const round = new Float32Array(solids.length)
    solids.forEach((solid, i) => {
      const grow = solid.grow ?? 1
      round[i] = solid.round ? 1 : 0
      mesh.setMatrixAt(
        i,
        MATRIX.compose(
          POSITION.set(solid.x, SHADE_Y, solid.z),
          TURN.setFromAxisAngle(UP, solid.yaw),
          SCALE.set(Math.max(solid.w, 1) * grow + SHADE_REACH * 2, 1, Math.max(solid.d, 1) * grow + SHADE_REACH * 2),
        ),
      )
    })
    plane.setAttribute('round', new InstancedBufferAttribute(round, 1))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    invalidate()
  })

  if (solids.length === 0) return null

  // A new count is a new mesh.
  return <instancedMesh key={solids.length} ref={ref} args={[plane, material, solids.length]} />
}

// The footprint is the patch less SHADE_REACH all round; the shade is full over it and gone SHADE_REACH away — from a
// rectangle's edge, or an ellipse's for what is round.
function shadeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { strength: { value: SHADE_STRENGTH }, reach: { value: SHADE_REACH } },
    vertexShader: `
      attribute float round;
      uniform float reach;
      varying vec2 vAt;
      varying vec2 vHalf;
      varying float vRound;

      void main() {
        vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
        vAt = (uv - 0.5) * size;
        vHalf = size * 0.5 - reach;
        vRound = round;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float strength;
      uniform float reach;
      varying vec2 vAt;
      varying vec2 vHalf;
      varying float vRound;

      void main() {
        float away = vRound > 0.5
          ? (length(vAt / vHalf) - 1.0) * min(vHalf.x, vHalf.y)
          : length(max(abs(vAt) - vHalf, 0.0));
        float shade = 1.0 - smoothstep(0.0, reach, away);
        gl_FragColor = vec4(0.0, 0.0, 0.0, strength * shade * shade);
      }
    `,
  })
}

// How dark the shade is at a footprint's edge, how far past the footprint it reaches (plan units), and how high off
// the floor it lies — over the grid, under everything else.
const SHADE_STRENGTH = 0.22

const SHADE_REACH = 22

const SHADE_Y = 0.4

// ---------- Hairlines ----------

// Lines one pixel wide at any zoom, in one colour — dashed by the screen pixel like the 2D view's (`3 3` for
// what cannot be had and the outlines, `2 4` for the grid), and marching while `march` unless motion is reduced.
export function Hairlines({ geometry, color, look }: { geometry: BufferGeometry; color: Color; look: Look }) {
  const [{ material, uniforms }] = useState(() => inkMaterial())
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => () => material.dispose(), [material])
  const [dash, gap] = !look.dash ? [0, 0] : look.line === 'grid' ? [2, 4] : [3, 3]
  const march = look.march === true
  // The material is three.js's, changed outside render: its ink once drawn, its scale and march every frame.
  useLayoutEffect(() => {
    setInk(uniforms, color, dash, gap)
    invalidate()
  }, [uniforms, color, dash, gap, invalidate])
  useFrame((state, delta) => {
    if (stepInk(uniforms, state, delta, march)) state.invalidate()
  })

  return <lineSegments geometry={geometry} material={material} frustumCulled={false} renderOrder={1} />
}

function setInk(uniforms: InkUniforms, color: Color, dash: number, gap: number) {
  uniforms.color.value.copy(color)
  uniforms.dash.value = dash
  uniforms.gap.value = gap
}

// A frame of the ink: dashes measured in screen pixels, and marching — true while they march.
function stepInk(uniforms: InkUniforms, state: RootState, delta: number, march: boolean): boolean {
  uniforms.scale.value = state.camera.zoom

  if (!march || reducedMotion()) return false
  // Six pixels in 0.6 s, the 2D view's march.
  uniforms.offset.value = (uniforms.offset.value - Math.min(delta, 0.1) * 10) % 6

  return true
}

// Replaces a geometry's segments (x, y, z pairs), each measured from its own start so its dashes begin there.
export function setSegments(geometry: BufferGeometry, positions: Float32Array) {
  const distances = new Float32Array(positions.length / 3)

  for (let i = 0; i + 5 < positions.length; i += 6) {
    distances[i / 3 + 1] = Math.hypot(
      positions[i + 3]! - positions[i]!,
      positions[i + 4]! - positions[i + 1]!,
      positions[i + 5]! - positions[i + 2]!,
    )
  }

  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('lineDistance', new BufferAttribute(distances, 1))
  geometry.computeBoundingSphere()
}

// Closed outlines and open lines on the floor (plan points), a little above it so the floor never hides them.
export function floorSegments(
  shapes: readonly (readonly PlanPoint[])[],
  closed: boolean,
  y = FLOOR_LINE,
): Float32Array {
  const out: number[] = []

  for (const points of shapes) {
    const count = closed ? points.length : points.length - 1

    for (let i = 0; i < count; i++) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      out.push(a.x, y, a.y, b.x, y, b.y)
    }
  }

  return new Float32Array(out)
}

// Floor lines sit this far above the floor.
export const FLOOR_LINE = 0.5

type InkUniforms = {
  color: { value: Color }
  dash: { value: number }
  gap: { value: number }
  offset: { value: number }
  scale: { value: number }
}

// The material, and its uniforms kept typed — the same objects the material reads.
type InkShader = { material: ShaderMaterial; uniforms: InkUniforms }

function inkMaterial(): InkShader {
  const uniforms: InkUniforms = {
    color: { value: new Color() },
    dash: { value: 0 },
    gap: { value: 0 },
    offset: { value: 0 },
    scale: { value: 1 },
  }

  const material = new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float lineDistance;
      uniform float scale;
      varying float vDistance;
      void main() {
        vDistance = lineDistance * scale;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float dash;
      uniform float gap;
      uniform float offset;
      varying float vDistance;
      void main() {
        if (dash > 0.0 && mod(vDistance + offset, dash + gap) > dash) discard;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })

  return { material, uniforms }
}

let motionQuery: MediaQueryList | null = null

export function reducedMotion(): boolean {
  motionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)')

  return motionQuery.matches
}

// ---------- Floors and writing ----------

// A room's floor in the surface colour, unlit so it matches the 2D floor. Rooms are found from the walls, so a floor
// is nothing to pick.
export function Floor({ points, color }: { points: readonly PlanPoint[]; color: Color }) {
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)
  useEffect(() => {
    // Drawn in x and −y, then laid down: y becomes z and the face looks up.
    const made = new ShapeGeometry(new Outline(points.map((p) => new Vector2(p.x, -p.y)))).rotateX(-Math.PI / 2)
    setGeometry(made)

    return () => made.dispose()
  }, [points])

  if (!geometry) return null

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color={color} polygonOffset polygonOffsetFactor={2} polygonOffsetUnits={2} />
    </mesh>
  )
}

// A mesh with one plain material — a text.
type PaintedMesh = Mesh<BufferGeometry, MeshBasicMaterial>

// Text drawn once into a canvas and shown on a plane (flat or upright) or a sprite (a sign facing the camera). Each
// text has two places: where the isometric view writes it and where the plan view does (`writing.plan`). The steeper
// the camera looks down, the nearer it comes to the plan view's, so text never jumps on the way between the views.
// Upright text cannot lie down: a flat copy takes over from it instead. Text lying flat reads from the left
// whichever corner it is seen from — turned half round when the view would show it upside down.
export function Text({ writing, color, font }: { writing: Writing; color: Color; font: string }) {
  const [label, setLabel] = useState<TextLabel | null>(null)
  const hex = color.getHexString()
  // The text as shown — a sign's sprite, or a plane — and an upright text's flat copy.
  const sign = useRef<Sprite>(null)
  const plane = useRef<PaintedMesh>(null)
  const lying = useRef<PaintedMesh>(null)
  useEffect(() => {
    const made = textTexture(writing.text, `#${hex}`, font)
    setLabel(made)

    return () => made.texture.dispose()
  }, [writing.text, hex, font])
  useFrame((state) => {
    if (label) placeText(writing, label.aspect, state.camera, sign.current ?? plane.current, lying.current)
  })

  if (!label) return null
  // Drawn at the 3D size; every frame scales and moves it (placeText).
  const h = writing.size * TEXT_LINE
  const w = h * label.aspect

  if (writing.lie === 'sign') {
    return (
      <sprite ref={sign}>
        <spriteMaterial map={label.texture} transparent depthWrite={false} />
      </sprite>
    )
  }

  return (
    <>
      <mesh
        ref={plane}
        // Laid down with its top toward the top of the plan, then turned; upright text faces the way its piece does.
        rotation={writing.lie === 'flat' ? [-Math.PI / 2, 0, writing.yaw] : [0, writing.yaw + Math.PI, 0]}
      >
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={label.texture} transparent depthWrite={false} />
      </mesh>
      {writing.lie === 'face' && (
        <mesh ref={lying} rotation={[-Math.PI / 2, 0, writing.plan.yaw]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial map={label.texture} transparent depthWrite={false} />
        </mesh>
      )}
    </>
  )
}

// How far a camera looks straight down, 0 to 1: nothing from the isometric view's elevation (or flatter) up, all of
// it from a degree off straight down, smoothly between.
function downOf(camera: Camera): number {
  camera.getWorldDirection(AHEAD)
  const steep = (Math.asin(Math.min(1, Math.max(-1, -AHEAD.y))) * 180) / Math.PI
  const t = Math.min(1, Math.max(0, (steep - TEXT_FROM_DEG) / (TEXT_TO_DEG - TEXT_FROM_DEG)))

  return t * t * (3 - 2 * t)
}

// Puts a text where the camera's steepness says, between the isometric view's place and size and the plan view's.
// `shown` is the text as the isometric view writes it; `lying`, for upright text, its flat copy, coming in as the
// upright one goes.
function placeText(
  writing: Writing,
  aspect: number,
  camera: Camera,
  shown: PaintedMesh | Sprite | null,
  lying: PaintedMesh | null,
) {
  if (!shown) return
  const down = downOf(camera)
  const mix = (a: number, b: number) => a + (b - a) * down
  const upright = writing.lie === 'face'
  const size = upright ? writing.size : mix(writing.size, writing.plan.size)
  const h = size * TEXT_LINE
  const w = h * aspect
  // The canvas leaves TEXT_PAD of the size either side of the letters: left-aligned text is drawn that much left of
  // its point, so the letters start on it.
  const pad = writing.anchor === 'start' ? TEXT_PAD * size : 0
  const x = upright ? writing.x : mix(writing.x, writing.plan.x)
  const z = upright ? writing.z : mix(writing.z, writing.plan.z)

  if (shown instanceof Sprite) {
    shown.position.set(x - pad, writing.y, z)
    shown.scale.set(w, h, 1)
    // A sign stands on its point; seen from above it is centred on it, as the 2D view writes it.
    shown.center.set(writing.anchor === 'start' ? 0 : 0.5, mix(0, 0.5))

    return
  }

  const written = upright ? writing.yaw : mix(writing.yaw, writing.plan.yaw)
  const yaw = upright || readsFromLeft(written, camera) ? written : written + Math.PI
  const along = { x: Math.cos(yaw), z: -Math.sin(yaw) }
  // A plane is centred on its position — a left-aligned one moves half its width along the line.
  const shift = pad === 0 ? 0 : w / 2 - pad
  shown.position.set(x + along.x * shift, writing.y, z + along.z * shift)
  shown.scale.setScalar(size / writing.size)

  if (!upright) {
    shown.rotation.z = yaw

    return
  }

  shown.material.opacity = 1 - down
  shown.visible = down < 1

  if (!lying) return
  lying.rotation.z = readsFromLeft(writing.plan.yaw, camera) ? writing.plan.yaw : writing.plan.yaw + Math.PI
  lying.position.set(writing.plan.x, writing.plan.y, writing.plan.z)
  lying.scale.setScalar(writing.plan.size / writing.size)
  lying.material.opacity = down
  lying.visible = down > 0
}

// Whether text lying flat, its line turned by `yaw`, runs toward the right of the view — or straight up it, as a
// drawing's upright lettering does.
function readsFromLeft(yaw: number, camera: Camera): boolean {
  const [rx = 1, , rz = 0] = camera.matrixWorld.elements

  return Math.cos(yaw) * rx - Math.sin(yaw) * rz > -1e-6
}

// A text drawn into a canvas, and how wide it is for its height.
type TextLabel = { texture: CanvasTexture; aspect: number }

function textTexture(text: string, color: string, font: string): TextLabel {
  const canvas = document.createElement('canvas')
  // Kept on the CPU — WebGL takes the pixels without reading them back from the GPU.
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const style = `700 ${TEXT_PX}px ${font}`
  context.font = style
  canvas.width = Math.ceil(context.measureText(text).width + TEXT_PX * TEXT_PAD * 2)
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

// ---------- Numbers ----------

// A place's number where it is written: lying on its seat at (x, y, z), `size` the height of its letters, in `color`.
export type PlaceNumber = {
  id: string
  text: string
  x: number
  y: number
  z: number
  size: number
  // Its size while its place settles in or away (./settling.ts) — 1 when left out.
  grow?: number
  color: Color
}

// Every place's number in one draw call: the texts are drawn once into a sheet, and each number is a patch of it
// lying on its seat. They read level in the plan view and along the floor's axis in the isometric one, turning with
// the view a quarter at a time, and are left out while too small to read — as a drawing leaves out its small print.
export function Numbers({ numbers, font }: { numbers: readonly PlaceNumber[]; font: string }) {
  const ref = useRef<InstancedMesh>(null)
  const invalidate = useThree((state) => state.invalidate)
  const [{ material, uniforms }] = useState(numberMaterial)
  // Its own geometry — which patch of the sheet each number is, and its ink, are written on it.
  const [plane] = useState(() => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2))
  const [sheet, setSheet] = useState<NumberSheet | null>(null)
  // The texts there are to write — the sheet is drawn again only when one of them is new.
  const texts = [...new Set(numbers.map((number) => number.text))].sort().join('\u0000')

  useEffect(() => {
    const made = numberSheet(texts === '' ? [] : texts.split('\u0000'), font)
    setSheet(made)

    return () => made.texture.dispose()
  }, [texts, font])

  useEffect(
    () => () => {
      material.dispose()
      plane.dispose()
    },
    [material, plane],
  )

  useLayoutEffect(() => {
    const mesh = ref.current

    if (!mesh || !sheet) return
    writeSheet(uniforms, sheet.texture)
    const cells = new Float32Array(numbers.length * 4)
    const inks = new Float32Array(numbers.length * 3)
    numbers.forEach((number, i) => {
      const cell = sheet.cells.get(number.text)
      // A text the sheet had no room for is not written.
      const h = cell ? number.size * TEXT_LINE * (number.grow ?? 1) : 0
      mesh.setMatrixAt(
        i,
        MATRIX.compose(
          POSITION.set(number.x, number.y, number.z),
          TURN.identity(),
          SCALE.set(h * (cell?.aspect ?? 0), 1, h),
        ),
      )

      if (cell) cells.set([cell.u, cell.v, cell.w, cell.h], i * 4)
      inks.set([number.color.r, number.color.g, number.color.b], i * 3)
    })
    plane.setAttribute('cell', new InstancedBufferAttribute(cells, 4))
    plane.setAttribute('ink', new InstancedBufferAttribute(inks, 3))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    invalidate()
  })

  useFrame(({ camera }) => stepNumbers(uniforms, camera))

  if (numbers.length === 0 || !sheet) return null

  // A new count is a new mesh.
  return <instancedMesh key={numbers.length} ref={ref} args={[plane, material, numbers.length]} />
}

// The texts drawn into one canvas, and where each lies in it: its patch in the texture's own coordinates (from the
// bottom left) and how wide it is for its height.
type NumberSheet = {
  texture: CanvasTexture
  cells: Map<string, { u: number; v: number; w: number; h: number; aspect: number }>
}

function numberSheet(texts: readonly string[], font: string): NumberSheet {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const style = `600 ${NUMBER_PX}px ${font}`
  const line = Math.ceil(NUMBER_PX * TEXT_LINE)
  context.font = style
  // Laid out in rows, left to right; what does not fit the sheet is left out.
  const placed: { text: string; x: number; y: number; w: number }[] = []
  let x = 0
  let y = 0

  for (const text of texts) {
    const w = Math.ceil(context.measureText(text).width + NUMBER_PX * TEXT_PAD * 2)

    if (x + w > SHEET_PX) {
      x = 0
      y += line
    }

    if (y + line > SHEET_PX || w > SHEET_PX) break
    placed.push({ text, x, y, w })
    x += w
  }

  canvas.width = SHEET_PX
  canvas.height = Math.max(line, y + line)
  // Resizing a canvas resets its state.
  context.font = style
  context.fillStyle = '#fff'
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  for (const cell of placed) context.fillText(cell.text, cell.x + cell.w / 2, cell.y + line / 2)
  const texture = new CanvasTexture(canvas)
  texture.anisotropy = 8

  return {
    texture,
    cells: new Map(
      placed.map((cell) => [
        cell.text,
        {
          u: cell.x / canvas.width,
          v: 1 - (cell.y + line) / canvas.height,
          w: cell.w / canvas.width,
          h: line / canvas.height,
          aspect: cell.w / line,
        },
      ]),
    ),
  }
}

type NumberUniforms = {
  sheet: { value: CanvasTexture | null }
  turn: { value: number }
  zoom: { value: number }
  least: { value: number }
}

// The material is three.js's, changed outside render: its sheet once drawn, its turn and zoom every frame.
function writeSheet(uniforms: NumberUniforms, texture: CanvasTexture) {
  uniforms.sheet.value = texture
}

function stepNumbers(uniforms: NumberUniforms, camera: RootState['camera']) {
  const [, , , , ux = 0, , uz = 0, , tx = 0, , tz = 0] = camera.matrixWorld.elements
  // Where the eye stands round the plan — straight down, the bottom of the view stands in for it.
  const [x, z] = Math.hypot(tx, tz) > 1e-3 ? [tx, tz] : [-ux, -uz]
  // The quarter the view is turned to: the plan view rests on a quarter, the isometric one half way to the next.
  uniforms.turn.value = Math.floor(Math.atan2(x, z) / (Math.PI / 2) + 0.25) * (Math.PI / 2)
  uniforms.zoom.value = camera.zoom
}

// The material, and its uniforms kept typed — the same objects the material reads.
type NumberShader = { material: ShaderMaterial; uniforms: NumberUniforms }

function numberMaterial(): NumberShader {
  const uniforms: NumberUniforms = {
    sheet: { value: null },
    turn: { value: 0 },
    zoom: { value: 1 },
    least: { value: NUMBER_MIN_PX },
  }

  const material = new ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec4 cell;
      attribute vec3 ink;
      uniform float turn;
      uniform float zoom;
      uniform float least;
      varying vec2 vUv;
      varying vec3 vInk;
      void main() {
        vUv = cell.xy + uv * cell.zw;
        vInk = ink;
        // Too small on the screen to read.
        if (length(instanceMatrix[2].xyz) * zoom < least) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        // Turned about its own middle, on the floor's plane, to the quarter the view is turned to.
        vec3 middle = instanceMatrix[3].xyz;
        vec3 off = (instanceMatrix * vec4(position, 1.0)).xyz - middle;
        float c = cos(turn);
        float s = sin(turn);
        vec3 turned = vec3(off.x * c + off.z * s, off.y, off.z * c - off.x * s);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(middle + turned, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D sheet;
      varying vec2 vUv;
      varying vec3 vInk;
      void main() {
        float cover = texture2D(sheet, vUv).a;
        if (cover < 0.02) discard;
        gl_FragColor = vec4(vInk, cover);
        #include <colorspace_fragment>
      }
    `,
  })

  return { material, uniforms }
}

// Numbers are drawn this many pixels tall into a sheet this wide (and at most as tall), and left out below this
// height on the screen — unreadable anyway.
const NUMBER_PX = 40

const SHEET_PX = 2048

const NUMBER_MIN_PX = 6

// ---------- Errors ----------

// WebGL can fail to start (blocked, no GPU); the page keeps working.
export class Fallback extends Component<{ children: ReactNode; onError(): void }, { failed: boolean }> {
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

// ---------- Helpers ----------

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()

  for (const item of items) {
    const key = keyOf(item)
    const group = groups.get(key)

    if (group) group.push(item)
    else groups.set(key, [item])
  }

  return groups
}

// Text is drawn this many pixels tall, on a line this many times its size.
const TEXT_PX = 96

const TEXT_LINE = 1.3

// The room the canvas leaves either side of the letters, in the text's size.
const TEXT_PAD = 0.2

// Text is the isometric view's at its elevation and the plan view's from a degree off straight down.
const TEXT_FROM_DEG = (ISOMETRIC_ELEVATION * 180) / Math.PI

const TEXT_TO_DEG = 89

// Faces sit a little behind their edges, so the hairlines are never hidden in them.
const FACES = new MeshLambertMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })

const GHOST_FACES = new MeshLambertMaterial({
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
})

const UP = new Vector3(0, 1, 0)

const MATRIX = new Matrix4()

const POSITION = new Vector3()

const TURN = new Quaternion()

const SCALE = new Vector3()

const POINT = new Vector3()

const AHEAD = new Vector3()
