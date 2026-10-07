'use client'

import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import type { PlanPoint, PlanTarget } from 'ichno'
import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  ShapeGeometry,
  Shape as Outline,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Camera,
  type InstancedMesh,
  type Mesh,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
} from 'three'
import { creasesOf, facesOf, polesOf, type Solid3D } from '../_lib/models'
import type { Writing } from '../_lib/scene'

// The playground's 3D views drawn the way its 2D plan is: faces in one colour, lit only enough to tell a top from a
// side, every edge a hairline in the ink — dashed for guides and for what cannot be had — and the selection filled
// with the ink. Shared by the 3D preview and the 3D editor; colours come from the page's theme variables.

// ---------- Look ----------

export type Palette = {
  ground: Color
  surface: Color
  ink: Color
  label: Color
  grid: Color
  warning: Color
  // Faces of places that overlap.
  warningFill: Color
  // Faces of places in a category, tinted like the 2D view's.
  categories: Record<string, Color>
  font: string
}

// The theme's colours, read again when the page switches between light and dark.
export function usePalette(hostRef: RefObject<HTMLElement | null>): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(null)
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const read = () => setPalette(paletteOf(host))
    read()
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    scheme.addEventListener('change', read)
    return () => scheme.removeEventListener('change', read)
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
  const mix = (a: string, share: number) => read(`color-mix(in srgb, ${a} ${share}%, var(--ichno-surface))`)
  const palette: Palette = {
    ground: read('var(--theme-bg)'),
    surface: read('var(--ichno-surface)'),
    ink: read('var(--ichno-ink)'),
    label: read('var(--ichno-label)'),
    grid: read('var(--ichno-grid)'),
    warning: read('var(--ichno-warning)'),
    warningFill: mix('var(--ichno-warning)', 18),
    categories: { premium: mix('var(--theme-premium)', 14), access: mix('var(--theme-access)', 14) },
    font: getComputedStyle(host).getPropertyValue('--ichno-font').trim() || 'sans-serif',
  }
  probe.remove()
  return palette
}

// A top in its own colour and the sides a little darker, the way light from above shows a drawing's volumes —
// whatever way the camera turns. Lambert light is (ambient + direct · cos) / π of the colour: a top facing the
// light is exactly its colour, a side in the shade 72% of it.
export function Daylight() {
  return (
    <>
      <ambientLight intensity={Math.PI * SHADE} />
      <directionalLight position={LIGHT_FROM} intensity={(Math.PI * (1 - SHADE)) / LIGHT_FROM.clone().normalize().y} />
    </>
  )
}

const SHADE = 0.72
const LIGHT_FROM = new Vector3(0.25, 1, 0.45)

// ---------- Solids ----------

// The ink a hairline is drawn in — `paper` over an ink fill.
export type Ink = 'ink' | 'paper' | 'label' | 'warning' | 'grid'

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
  look: Look
  target?: PlanTarget<string>
}

// Faces the caller hit-tests itself, with what each instance stands for.
export type Picks = Map<Object3D, (instance: number | undefined) => PlanTarget<string> | null>

// Solids in their looks: one draw call per model for the faces, one per look for the edges. `ghost` draws the
// faces see-through — what a tool would make. Pass `picks` to hit-test the faces yourself, or `onHover` and `onTap`
// for react-three-fiber's events.
export function Solids({
  solids,
  palette,
  ghost = false,
  picks,
  onHover,
  onTap,
}: {
  solids: readonly Solid[]
  palette: Palette
  ghost?: boolean
  picks?: Picks
  onHover?(solid: Solid | null): void
  onTap?(solid: Solid, e: ThreeEvent<MouseEvent>): void
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
          onHover={onHover}
          onTap={onTap}
        />
      ))}
      {[...lines].map(([key, group]) => (
        <SolidEdges key={key} solids={group} color={inkOf(palette, group[0]!.look.line)} look={group[0]!.look} />
      ))}
    </>
  )
}

function Faces({
  solids,
  ghost,
  picks,
  onHover,
  onTap,
}: {
  solids: readonly Solid[]
  ghost: boolean
  picks?: Picks
  onHover?(solid: Solid | null): void
  onTap?(solid: Solid, e: ThreeEvent<MouseEvent>): void
}) {
  const ref = useRef<InstancedMesh>(null)
  // The solids as last drawn — what a hit on an instance means.
  const drawn = useRef(solids)
  const invalidate = useThree((state) => state.invalidate)
  const first = solids[0]!

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    drawn.current = solids
    solids.forEach((solid, i) => {
      mesh.setMatrixAt(i, matrixOf(solid))
      mesh.setColorAt(i, solid.look.fill!)
    })
    mesh.instanceMatrix.needsUpdate = true
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

  const solidAt = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    e.instanceId === undefined ? null : (drawn.current[e.instanceId] ?? null)

  return (
    <instancedMesh
      ref={ref}
      args={[facesOf(first.model, first.round), ghost ? GHOST_FACES : FACES, solids.length]}
      onPointerMove={
        onHover &&
        ((e) => {
          e.stopPropagation()
          onHover(solidAt(e))
        })
      }
      onPointerOut={onHover && (() => onHover(null))}
      onClick={
        onTap &&
        ((e) => {
          e.stopPropagation()
          // A drag turned the camera; it picked nothing.
          if (e.delta > CLICK_SLOP_PX) return
          const solid = solidAt(e)
          if (solid) onTap(solid, e)
        })
      }
    />
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
  const ortho = (camera as OrthographicCamera).isOrthographicCamera === true
  camera.getWorldDirection(AHEAD)
  const lines: number[] = []
  for (const solid of solids) {
    const poles = polesOf(solid.model, solid.round)
    if (poles.length === 0) continue
    const vx = ortho ? AHEAD.x : solid.x - camera.position.x
    const vz = ortho ? AHEAD.z : solid.z - camera.position.z
    if (Math.hypot(vx, vz) < 1e-6) continue
    const cos = Math.cos(solid.yaw)
    const sin = Math.sin(solid.yaw)
    // The view direction in the solid's own frame (turned back by its yaw).
    const lx = vx * cos - vz * sin
    const lz = vx * sin + vz * cos
    for (const pole of poles) {
      const a = pole.r * Math.max(solid.w, 1)
      const b = pole.r * Math.max(solid.d, 1)
      const t = Math.atan2(-b * lx, a * lz)
      for (const side of [1, -1]) {
        const px = side * a * Math.cos(t)
        const pz = side * b * Math.sin(t)
        const x = solid.x + px * cos + pz * sin
        const z = solid.z - px * sin + pz * cos
        const h = solid.h ?? 1
        lines.push(x, pole.y0 * h, z, x, pole.y1 * h, z)
      }
    }
  }
  return new Float32Array(lines)
}

function matrixOf(solid: Solid): Matrix4 {
  return MATRIX.compose(
    POSITION.set(solid.x, 0, solid.z),
    TURN.setFromAxisAngle(UP, solid.yaw),
    SCALE.set(Math.max(solid.w, 1), solid.h ?? 1, Math.max(solid.d, 1)),
  )
}

function signatureOf(solid: Solid): string {
  return `${solid.model}:${solid.round}:${solid.x}:${solid.z}:${solid.w}:${solid.d}:${solid.yaw}:${solid.h ?? 1}`
}

function lookKey(look: Look): string {
  return `${look.line}:${look.dash === true}:${look.march === true}`
}

export function inkOf(palette: Palette, ink: Ink): Color {
  switch (ink) {
    case 'ink':
      return palette.ink
    case 'paper':
      return palette.surface
    case 'label':
      return palette.label
    case 'warning':
      return palette.warning
    case 'grid':
      return palette.grid
  }
}

// ---------- Hairlines ----------

// Lines one pixel wide at any zoom, in one colour — dashed by the screen pixel like the 2D view's (`3 3` for
// what cannot be had and the outlines, `2 4` for the grid), and marching while `march` unless motion is reduced.
export function Hairlines({ geometry, color, look }: { geometry: BufferGeometry; color: Color; look: Look }) {
  const [material] = useState(() => inkMaterial())
  useEffect(() => () => material.dispose(), [material])
  const uniforms = material.uniforms as InkUniforms
  uniforms.color.value.copy(color)
  const [dash, gap] = !look.dash ? [0, 0] : look.line === 'grid' ? [2, 4] : [3, 3]
  uniforms.dash.value = dash
  uniforms.gap.value = gap

  useFrame((state, delta) => {
    uniforms.scale.value = pixelsPerUnit(state.camera, state.size.height)
    if (!look.march || reducedMotion()) return
    // Six pixels in 0.6 s, the 2D view's march.
    uniforms.offset.value = (uniforms.offset.value - Math.min(delta, 0.1) * 10) % 6
    state.invalidate()
  })

  return <lineSegments geometry={geometry} material={material} frustumCulled={false} renderOrder={1} />
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

function inkMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      color: { value: new Color() },
      dash: { value: 0 },
      gap: { value: 0 },
      offset: { value: 0 },
      scale: { value: 1 },
    },
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
}

// Screen pixels per plan unit where the view is aimed — exact for the editor's orthographic camera, at the floor
// ahead for the preview's perspective one.
function pixelsPerUnit(camera: Camera, height: number): number {
  if ((camera as OrthographicCamera).isOrthographicCamera) return (camera as OrthographicCamera).zoom
  camera.getWorldDirection(AHEAD)
  const distance = AHEAD.y < -0.05 ? camera.position.y / -AHEAD.y : FAR_AHEAD
  return height / (2 * Math.max(distance, 1) * Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360))
}

const FAR_AHEAD = 2000

let motionQuery: MediaQueryList | null = null

export function reducedMotion(): boolean {
  motionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)')
  return motionQuery.matches
}

// ---------- Floors and writing ----------

// A section's floor in the surface colour, unlit so it matches the 2D floor. `picks` registers it for hit-testing
// as the section.
export function Floor({
  id,
  points,
  color,
  picks,
}: {
  id: string
  points: readonly PlanPoint[]
  color: Color
  picks?: Picks
}) {
  const ref = useRef<Mesh>(null)
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)
  useEffect(() => {
    // Drawn in x and −y, then laid down: y becomes z and the face looks up.
    const made = new ShapeGeometry(new Outline(points.map((p) => new Vector2(p.x, -p.y)))).rotateX(-Math.PI / 2)
    setGeometry(made)
    return () => made.dispose()
  }, [points])
  useEffect(() => {
    const mesh = ref.current
    if (!mesh || !picks) return
    picks.set(mesh, () => ({ kind: 'section', id }))
    return () => {
      picks.delete(mesh)
    }
  }, [picks, id, geometry])
  if (!geometry) return null
  return (
    <mesh ref={ref} geometry={geometry}>
      <meshBasicMaterial color={color} polygonOffset polygonOffsetFactor={2} polygonOffsetUnits={2} />
    </mesh>
  )
}

// Text drawn once into a canvas and shown on a plane (flat or upright) or a sprite (a sign facing the camera).
export function Text({ writing, color, font }: { writing: Writing; color: Color; font: string }) {
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

// How far a press may travel and still be a tap.
const CLICK_SLOP_PX = 6
// Text is drawn this many pixels tall, on a line this many times its size.
const TEXT_PX = 96
const TEXT_LINE = 1.3

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
