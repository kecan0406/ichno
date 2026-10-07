import { BoxGeometry, CylinderGeometry, EdgesGeometry, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { HEIGHT, SCREEN_BOTTOM, METRE, type Model } from './scene'

// What each of the playground's 3D models is made of — boxes and upright cylinders on a 1 × 1 footprint about the
// origin (facing −z), standing on y = 0 with their real heights. Instances stretch them over their footprints. The
// 3D views draw their faces and, like the 2D drawing, their edges as hairlines (../_components/drawing-3d.tsx).
// A wall is a unit box its view stretches upward.

export type Solid3D = Model | 'wall'

export type Part =
  | { kind: 'box'; x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }
  | { kind: 'pole'; r: number; y0: number; y1: number }

// Round parts are cylinders of this many sides — their edges show only where they meet a top or a floor.
const SIDES = 40

export function partsOf(model: Solid3D, round: boolean): Part[] {
  if (model === 'wall') return [box(-0.5, 0.5, -0.5, 0.5, 0, 1)]
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
      return [slab(round, 0, top - 0.04 * m, top), pole(0.12, 0, top - 0.04 * m), pole(0.3, 0, 0.03 * m)]
    case 'coffee':
      return [slab(round, 0, top - 0.06 * m, top), slab(round, 0.1, 0, top - 0.06 * m)]
    case 'desk':
      return [
        box(-0.5, 0.5, -0.5, 0.5, top - 0.04 * m, top),
        box(-0.5, -0.46, -0.45, 0.45, 0, top - 0.04 * m),
        box(0.46, 0.5, -0.45, 0.45, 0, top - 0.04 * m),
      ]
    case 'booth':
      return [
        slab(round, 0, 0, 0.03 * m),
        box(-0.5, 0.5, 0.46, 0.5, 0.03 * m, top),
        box(-0.5, -0.46, -0.5, 0.46, 0.03 * m, top),
        box(0.46, 0.5, -0.5, 0.46, 0.03 * m, top),
      ]
    case 'screen':
      return [box(-0.5, 0.5, -0.2, 0.2, SCREEN_BOTTOM, top), box(-0.02, 0.02, -0.1, 0.1, 0, SCREEN_BOTTOM)]
    case 'door':
      return [
        box(-0.5, -0.44, -0.5, 0.5, 0, top - 0.1 * m),
        box(0.44, 0.5, -0.5, 0.5, 0, top - 0.1 * m),
        box(-0.5, 0.5, -0.5, 0.5, top - 0.1 * m, top),
      ]
    default:
      return [slab(round, 0, 0, top)]
  }
}

// The faces of a model, built once.
export function facesOf(model: Solid3D, round: boolean): BufferGeometry {
  return cached(FACES, model, round, () => mergeGeometries(partsOf(model, round).map(geometryOf)))
}

// Where the faces of a model fold — its box edges and the rims of its cylinders — as segment ends, built once.
// The sides of a cylinder fold nowhere; its outline depends on where it is seen from (`polesOf`).
export function creasesOf(model: Solid3D, round: boolean): Float32Array {
  return cached(CREASES, model, round, () => {
    // Part by part, so two parts that touch keep both their edges.
    const arrays = partsOf(model, round).map(
      (part) => new EdgesGeometry(geometryOf(part), CREASE_ANGLE).attributes.position!.array,
    )
    const out = new Float32Array(arrays.reduce((sum, array) => sum + array.length, 0))
    let at = 0
    for (const array of arrays) {
      out.set(array, at)
      at += array.length
    }
    return out
  })
}

// The upright cylinders of a model — their outlines are drawn where the view grazes them.
export function polesOf(model: Solid3D, round: boolean): Extract<Part, { kind: 'pole' }>[] {
  return partsOf(model, round).filter((part) => part.kind === 'pole')
}

// Faces meeting at more than this many degrees draw an edge.
const CREASE_ANGLE = 30
const FACES = new Map<string, BufferGeometry>()
const CREASES = new Map<string, Float32Array>()

function cached<T>(cache: Map<string, T>, model: Solid3D, round: boolean, make: () => T): T {
  const key = `${model}:${round}`
  const found = cache.get(key)
  if (found) return found
  const made = make()
  cache.set(key, made)
  return made
}

function geometryOf(part: Part): BufferGeometry {
  return part.kind === 'box'
    ? new BoxGeometry(part.x1 - part.x0, part.y1 - part.y0, part.z1 - part.z0).translate(
        (part.x0 + part.x1) / 2,
        (part.y0 + part.y1) / 2,
        (part.z0 + part.z1) / 2,
      )
    : new CylinderGeometry(part.r, part.r, part.y1 - part.y0, SIDES).translate(0, (part.y0 + part.y1) / 2, 0)
}

// A box from x0 to x1, z0 to z1 (footprint units) and y0 to y1 (plan units).
function box(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number): Part {
  return { kind: 'box', x0, x1, z0, z1, y0, y1 }
}

// The whole footprint, `inset` in from its edge, from y0 to y1 — a disc for round shapes.
function slab(round: boolean, inset: number, y0: number, y1: number): Part {
  return round ? pole(0.5 - inset, y0, y1) : box(-0.5 + inset, 0.5 - inset, -0.5 + inset, 0.5 - inset, y0, y1)
}

function pole(r: number, y0: number, y1: number): Part {
  return { kind: 'pole', r, y0, y1 }
}
