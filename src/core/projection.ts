import type { ScreenPoint } from './gesture'
import type { PlanPoint, PlanRect } from './types'

// Parallel projections of the plan — the plan view, seen straight down, and the isometric view, seen from a corner
// with the three axes drawn at one scale. A projection is a definition, not a camera: one linear map from the plan
// (and a height above it) to the drawing, which an SVG transform, a WebGL camera and a hit-test can all be given, so
// they agree to the pixel.
//
// The plan's x and y are the floor (y down, as stored); z is a height above it in the same units. The drawing's x
// runs right and its y down, from where the plan's origin shows.

// Where the eye stands and how large a plan unit is drawn.
export type Projection = {
  // The eye's bearing from what it looks at, in radians: 0 from the bottom of the plan (the south), counted toward
  // the right (the east) — so π/4 is the bottom-right corner.
  azimuth: number
  // How far above the floor the eye stands, in radians: π/2 straight down. Above 0 — edge-on, the floor is a line.
  elevation: number
  // Drawing units per plan unit across the line of sight.
  scale: number
}

// A point of the room: a plan point and how high above the floor it is (the floor itself when left out).
export type SpacePoint = PlanPoint & { z?: number }

// A direction in the room.
export type SpaceVector = { x: number; y: number; z: number }

// A view's own directions in the room, each one unit long: the drawing's right and its up, and the way toward the
// eye.
export type ProjectionBasis = { right: SpaceVector; up: SpaceVector; toward: SpaceVector }

// The floor's map into the drawing, in the order an SVG or CSS `matrix(a, b, c, d, 0, 0)` takes it: a step along the
// plan's x moves the drawing by (a, b), a step along its y by (c, d).
export type FloorMatrix = readonly [a: number, b: number, c: number, d: number]

// The isometric view's elevation — the eye on the diagonal of a cube standing on the floor, 35.264°. Seen from
// there the three axes foreshorten alike and lie 120° apart on the drawing.
export const ISOMETRIC_ELEVATION = Math.atan(Math.SQRT1_2)

// What undoes that foreshortening (√(2/3) along every axis), so a plan unit along x, along y or upward is one unit
// on the drawing — an isometric drawing, as drafting calls it, rather than the isometric projection 0.8165 of its
// size. A length along an axis measures the same in the plan view and in the isometric one.
export const ISOMETRIC_SCALE = Math.sqrt(1.5)

export const projection = {
  plan,
  isometric,
  toScreen,
  toFloor,
  floorMatrix,
  basis,
  extent,
}

// The plan view: straight down at the plan's own scale, its top up — or turned `quarter` quarter turns. Quarters
// keep counting past four, so the way from one view to the next is the turn that was made.
function plan(quarter = 0): Projection {
  return { azimuth: (quarter * Math.PI) / 2, elevation: Math.PI / 2, scale: 1 }
}

// The isometric view from a corner: the bottom-right one, or `quarter` quarter turns round from it. The floor's
// axes run 30° off the level, heights run straight up, and all three measure true.
function isometric(quarter = 0): Projection {
  return { azimuth: Math.PI / 4 + (quarter * Math.PI) / 2, elevation: ISOMETRIC_ELEVATION, scale: ISOMETRIC_SCALE }
}

// Where a point of the room is drawn, from where the plan's origin is.
function toScreen(view: Projection, point: SpacePoint): ScreenPoint {
  const [a, b, c, d] = floorMatrix(view)

  return {
    x: a * point.x + c * point.y,
    y: b * point.x + d * point.y - view.scale * Math.cos(view.elevation) * (point.z ?? 0),
  }
}

// The floor point drawn at a point of the drawing — `toScreen` the other way, for what lies on the floor.
function toFloor(view: Projection, point: ScreenPoint): PlanPoint {
  const [a, b, c, d] = floorMatrix(view)
  const area = a * d - b * c

  return { x: (d * point.x - c * point.y) / area, y: (a * point.y - b * point.x) / area }
}

function floorMatrix(view: Projection): FloorMatrix {
  const cos = Math.cos(view.azimuth) * view.scale
  const sin = Math.sin(view.azimuth) * view.scale
  const steep = Math.sin(view.elevation)

  return [cos, sin * steep, -sin, cos * steep]
}

// The view's own directions in the room — what a camera is set by.
function basis(view: Projection): ProjectionBasis {
  const cos = Math.cos(view.azimuth)
  const sin = Math.sin(view.azimuth)
  const steep = Math.sin(view.elevation)
  const flat = Math.cos(view.elevation)

  return {
    right: { x: cos, y: -sin, z: 0 },
    up: { x: -sin * steep, y: -cos * steep, z: flat },
    toward: { x: sin * flat, y: cos * flat, z: steep },
  }
}

// The room a box takes on the drawing: a rectangle of the plan and everything up to `height` above it.
function extent(view: Projection, rect: PlanRect, height = 0): PlanRect {
  const corners = [rect.x, rect.x + rect.w].flatMap((x) =>
    [rect.y, rect.y + rect.h].flatMap((y) => [0, height].map((z) => toScreen(view, { x, y, z }))),
  )

  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)

  return { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top }
}
