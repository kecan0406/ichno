import { describe, expect, it } from 'vitest'
import { ISOMETRIC_ELEVATION, ISOMETRIC_SCALE, projection, type Projection } from './projection'

const DEG = Math.PI / 180

function lengthOf(point: { x: number; y: number }): number {
  return Math.hypot(point.x, point.y)
}

// The angle between two directions on the drawing, in degrees.
function between(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.acos((a.x * b.x + a.y * b.y) / (lengthOf(a) * lengthOf(b))) / DEG
}

describe('projection.isometric', () => {
  const view = projection.isometric()
  const x = projection.toScreen(view, { x: 1, y: 0 })
  const y = projection.toScreen(view, { x: 0, y: 1 })
  const up = projection.toScreen(view, { x: 0, y: 0, z: 1 })

  it('draws a unit along each of the three axes one unit long', () => {
    expect(lengthOf(x)).toBeCloseTo(1, 12)
    expect(lengthOf(y)).toBeCloseTo(1, 12)
    expect(lengthOf(up)).toBeCloseTo(1, 12)
  })

  it('lays the three axes 120° apart', () => {
    expect(between(x, y)).toBeCloseTo(120, 9)
    expect(between(y, up)).toBeCloseTo(120, 9)
    expect(between(up, x)).toBeCloseTo(120, 9)
  })

  it('runs the floor axes 30° off the level and heights straight up', () => {
    expect(x.x).toBeCloseTo(Math.cos(30 * DEG), 12)
    expect(x.y).toBeCloseTo(Math.sin(30 * DEG), 12)
    expect(y.x).toBeCloseTo(-Math.cos(30 * DEG), 12)
    expect(y.y).toBeCloseTo(Math.sin(30 * DEG), 12)
    expect(up.x).toBeCloseTo(0, 12)
    expect(up.y).toBeCloseTo(-1, 12)
  })

  it('stands the eye on the diagonal of a cube', () => {
    const { toward } = projection.basis(view)

    expect(toward.x).toBeCloseTo(1 / Math.sqrt(3), 12)
    expect(toward.y).toBeCloseTo(1 / Math.sqrt(3), 12)
    expect(toward.z).toBeCloseTo(1 / Math.sqrt(3), 12)
    expect(ISOMETRIC_ELEVATION / DEG).toBeCloseTo(35.2644, 4)
  })

  it('is the true projection enlarged until the axes measure true', () => {
    const projected = projection.toScreen({ ...view, scale: 1 }, { x: 1, y: 0 })

    expect(lengthOf(projected)).toBeCloseTo(Math.sqrt(2 / 3), 12)
    expect(lengthOf(projected) * ISOMETRIC_SCALE).toBeCloseTo(1, 12)
  })

  it('turns a quarter at a time: the next corner sees the plan turned by 90°', () => {
    const turned = projection.isometric(1)
    const point = { x: 30, y: 10, z: 5 }
    // Seen from the next corner round, a point shows where the point a quarter turn back showed from the first.
    const back = { x: -point.y, y: point.x, z: point.z }
    const seen = projection.toScreen(turned, point)
    const first = projection.toScreen(view, back)

    expect(seen.x).toBeCloseTo(first.x, 9)
    expect(seen.y).toBeCloseTo(first.y, 9)
    expect(projection.isometric(5).azimuth - projection.isometric(4).azimuth).toBeCloseTo(Math.PI / 2, 12)
  })
})

describe('projection.plan', () => {
  it('draws the floor as stored and shows no height', () => {
    const view = projection.plan()
    const seen = projection.toScreen(view, { x: 40, y: -25, z: 300 })

    expect(seen.x).toBeCloseTo(40, 9)
    expect(seen.y).toBeCloseTo(-25, 9)
  })

  it('turned a quarter keeps lengths and turns the plan', () => {
    const seen = projection.toScreen(projection.plan(1), { x: 10, y: 0 })

    expect(seen.x).toBeCloseTo(0, 9)
    expect(Math.abs(seen.y)).toBeCloseTo(10, 9)
  })
})

describe('projection.toFloor', () => {
  const views: [string, Projection][] = [
    ['the plan view', projection.plan()],
    ['the plan view turned', projection.plan(3)],
    ['the isometric view', projection.isometric()],
    ['the isometric view turned', projection.isometric(2)],
    ['a view part-way between', { azimuth: 0.3, elevation: 1.1, scale: 1.1 }],
  ]

  it.each(views)('undoes toScreen on the floor in %s', (_name, view) => {
    const point = { x: 123.5, y: -47.25 }
    const back = projection.toFloor(view, projection.toScreen(view, point))

    expect(back.x).toBeCloseTo(point.x, 9)
    expect(back.y).toBeCloseTo(point.y, 9)
  })
})

describe('projection.floorMatrix', () => {
  it('is what toScreen does to the floor', () => {
    const view = projection.isometric(1)
    const [a, b, c, d] = projection.floorMatrix(view)
    const seen = projection.toScreen(view, { x: 7, y: 3 })

    expect(a * 7 + c * 3).toBeCloseTo(seen.x, 12)
    expect(b * 7 + d * 3).toBeCloseTo(seen.y, 12)
  })
})

describe('projection.basis', () => {
  it('gives three directions square to each other, a unit long', () => {
    const { right, up, toward } = projection.basis(projection.isometric(3))
    const dot = (p: typeof right, q: typeof right) => p.x * q.x + p.y * q.y + p.z * q.z

    expect(dot(right, right)).toBeCloseTo(1, 12)
    expect(dot(up, up)).toBeCloseTo(1, 12)
    expect(dot(toward, toward)).toBeCloseTo(1, 12)
    expect(dot(right, up)).toBeCloseTo(0, 12)
    expect(dot(up, toward)).toBeCloseTo(0, 12)
    expect(dot(toward, right)).toBeCloseTo(0, 12)
  })

  it('keeps an up direction straight down, where the plan’s top is up', () => {
    const { up, toward } = projection.basis(projection.plan())

    expect(up.x).toBeCloseTo(0, 12)
    expect(up.y).toBeCloseTo(-1, 12)
    expect(toward.z).toBeCloseTo(1, 12)
  })
})

describe('projection.extent', () => {
  it('is the rectangle itself in the plan view, whatever stands on it', () => {
    const seen = projection.extent(projection.plan(), { x: 10, y: 20, w: 300, h: 200 }, 90)

    expect(seen.x).toBeCloseTo(10, 9)
    expect(seen.y).toBeCloseTo(20, 9)
    expect(seen.w).toBeCloseTo(300, 9)
    expect(seen.h).toBeCloseTo(200, 9)
  })

  it('is the diamond of the floor and the height above it in the isometric view', () => {
    const seen = projection.extent(projection.isometric(), { x: 0, y: 0, w: 300, h: 200 }, 90)

    expect(seen.w).toBeCloseTo((300 + 200) * Math.cos(30 * DEG), 9)
    expect(seen.h).toBeCloseTo((300 + 200) * Math.sin(30 * DEG) + 90, 9)
  })
})
