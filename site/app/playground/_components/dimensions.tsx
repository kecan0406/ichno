import { seatPlan, type PlanPoint, type PlanStroke, type Wall } from 'ichno'
import { metres } from '../_lib/units'
import styles from './marks.module.css'

// What there is to measure on the plan.
export type Measured = {
  // What a creation tool is drawing, and how it draws.
  stroke: PlanStroke | null
  draw: 'box' | 'line' | 'point' | 'polygon' | 'path' | undefined
  // A wall's corners so far, where the next would go, and a length typed for it (metres, as typed).
  corners: readonly PlanPoint[] | null
  pointer: PlanPoint | null
  typed: string
  // The selection's outline — one item's turned box, or the box round several — or the one selected wall.
  frame: readonly PlanPoint[] | null
  wall: Wall | null
}

// A length where it is written: the point its middle sits on, the angle it is turned to (degrees, for a view that
// writes along what it measures), and whether it measures what is being drawn.
export type DimensionLabel = { at: PlanPoint; text: string; angle?: number; live?: boolean }

type Props = Measured & {
  // Screen pixels a plan unit spans — the lengths are written the same size at any zoom.
  scale: number
}

// Lengths written where they are measured, the way a drawing's dimensions are: what a tool is drawing (a box's width
// and height, a line's length, a wall's edges — the next as it is typed), the size of what is selected, and a
// selected wall's edges, outside a room. What is being drawn is written in the guides' colour; what stands, in the
// labels'.
export function Dimensions({ scale, ...measured }: Props) {
  const labels = dimensionLabelsOf(measured, OFF_PX / scale)

  if (labels.length === 0) return null

  return (
    <g className={styles.dimensions} fontSize={TEXT_PX / scale} strokeWidth={3 / scale} aria-hidden>
      {labels.map(({ at, text, angle = 0, live }, i) => (
        <text
          key={i}
          x={at.x}
          y={at.y}
          transform={angle === 0 ? undefined : `rotate(${angle} ${at.x} ${at.y})`}
          data-live={live || undefined}
        >
          {text}
        </text>
      ))}
    </g>
  )
}

// Where each length is written, in plan units: `off` away from what it measures. Seen from straight above a box's
// size is written under it, width by height; seen from a corner — `toward` the way the bottom of the screen lies on
// the plan — each of its two lengths is written beside the edge on the viewer's side.
export function dimensionLabelsOf(
  { stroke, draw, corners, pointer, typed, frame, wall }: Measured,
  off: number,
  toward?: PlanPoint,
): DimensionLabel[] {
  const labels: DimensionLabel[] = []
  const sized = (box: Quad) => (toward ? edgeSizes(box, off, toward) : [boxSize(box, off)])
  const live = (found: DimensionLabel[]) => found.map((label) => ({ ...label, live: true }))

  if (draw === 'box' && stroke) labels.push(...live(sized(outlineOf(stroke))))
  else if (draw === 'line' && stroke) labels.push({ ...along(stroke.start, stroke.end, off, 1), live: true })
  else if ((draw === 'polygon' || draw === 'path') && corners === null && stroke?.points?.length === 5) {
    // A rectangle being dragged out — its first four points are its corners.
    const rect = stroke.points.slice(0, 4)

    if (isQuad(rect)) labels.push(...live(sized(rect)))
  } else if ((draw === 'polygon' || draw === 'path') && corners) {
    corners.slice(1).forEach((b, i) => labels.push(along(corners[i]!, b, off, 1)))
    const last = corners.at(-1)!

    if (pointer && (typed !== '' || pointer.x !== last.x || pointer.y !== last.y)) {
      const edge = along(last, pointer, off, 1)
      labels.push({ ...edge, text: typed === '' ? edge.text : `${typed} m`, live: true })
    }
  }

  if (frame && isQuad(frame)) labels.push(...sized(frame))

  if (wall) {
    const outward = wall.closed ? Math.sign(signedArea(wall.points)) || 1 : 1
    const clear = off + wall.thickness / 2

    for (const edge of seatPlan.wallEdgesOf(wall)) labels.push(along(edge.a, edge.b, clear, outward))
  }

  return labels
}

// Text height and how far lengths stand off what they measure, in screen pixels — clear of the handles on an edge.
export const TEXT_PX = 11

export const OFF_PX = 16

// A box's four corners, in order round it.
type Quad = readonly [PlanPoint, PlanPoint, PlanPoint, PlanPoint]

function isQuad(points: readonly PlanPoint[]): points is Quad {
  return points.length === 4
}

// A box's width and height, written under it — level, below its lowest corner.
function boxSize(corners: Quad, off: number): DimensionLabel {
  const [a, b, c] = corners
  const xs = corners.map((p) => p.x)
  const bottom = Math.max(...corners.map((p) => p.y))

  return {
    at: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: bottom + off },
    text: `${metres(distance(a, b))} × ${metres(distance(b, c))}`,
  }
}

// A box's two lengths, each written `off` outside the edge on the viewer's side — of the two edges that run each
// way, the one further `toward` the bottom of the screen.
function edgeSizes(corners: Quad, off: number, toward: PlanPoint): DimensionLabel[] {
  const [a, , c] = corners
  const middle = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }
  const near = (p: PlanPoint) => (p.x - middle.x) * toward.x + (p.y - middle.y) * toward.y

  return [0, 1].map((k) => {
    const one = midpoint(corners[k]!, corners[k + 1]!)
    const other = midpoint(corners[k + 2]!, corners[(k + 3) % 4]!)
    const at = near(one) > near(other) ? one : other
    const out = Math.hypot(at.x - middle.x, at.y - middle.y) || 1

    return {
      at: { x: at.x + ((at.x - middle.x) / out) * off, y: at.y + ((at.y - middle.y) / out) * off },
      text: metres(distance(corners[k]!, corners[k + 1]!)),
    }
  })
}

function midpoint(a: PlanPoint, b: PlanPoint): PlanPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

// A length written along it, `off` to one side — `side` 1 the left of a → b (y down), -1 the right — and turned so it
// reads from below or from the right, as a drawing's dimensions do.
function along(a: PlanPoint, b: PlanPoint, off: number, side: number) {
  const length = distance(a, b)
  const normal = length === 0 ? { x: 0, y: -1 } : { x: (b.y - a.y) / length, y: -(b.x - a.x) / length }
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI

  return {
    at: { x: (a.x + b.x) / 2 + normal.x * off * side, y: (a.y + b.y) / 2 + normal.y * off * side },
    text: metres(length),
    angle: angle >= 90 ? angle - 180 : angle < -90 ? angle + 180 : angle,
  }
}

function outlineOf({ start, end }: PlanStroke): Quad {
  return [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }]
}

function distance(a: PlanPoint, b: PlanPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

// Twice the signed area, y down — positive when the corners run clockwise on screen.
function signedArea(points: readonly PlanPoint[]): number {
  return points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length]!

    return sum + a.x * b.y - b.x * a.y
  }, 0)
}
