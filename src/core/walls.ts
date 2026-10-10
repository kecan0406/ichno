import { boundsOfPoints, polygonContains, signedArea, unionBounds } from './math'
import type { PlanPoint, PlanRect, Room, Wall, WallOpening } from './types'

// Wall geometry — the band a wall paints, the gaps its openings leave, where a new opening goes, and the rooms walls
// close. File-level helpers behind `seatPlan`; not public API on their own.

// An edge of a wall's centre line — from point `index` to the next (the last back to the first on a closed wall).
// `along` is the unit direction, zero on an edge with no length.
export type WallEdge = { index: number; a: PlanPoint; b: PlanPoint; length: number; along: PlanPoint }

// Where an opening is drawn: the stretch of the centre line it takes (`from` → `to`) and the box across the band.
export type OpeningShape = { index: number; opening: WallOpening; from: PlanPoint; to: PlanPoint; points: PlanPoint[] }

// A corner sharper than this (the mitre this many half-thicknesses long) is cut off square instead.
const MITRE_LIMIT = 4
// Points closer than this (plan units) are one node when rooms are found — float crumbs of intersections.
const NODE_EPSILON = 1e-3
// Parameters this close to an edge's ends count as on them.
const EPSILON = 1e-9

export function wallEdgesOf(wall: Pick<Wall, 'points' | 'closed'>): WallEdge[] {
  const { points } = wall
  const count = wall.closed && points.length > 2 ? points.length : points.length - 1
  const edges: WallEdge[] = []
  for (let index = 0; index < count; index++) {
    const a = points[index]!
    const b = points[(index + 1) % points.length]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const along = length === 0 ? { x: 0, y: 0 } : { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
    edges.push({ index, a, b, length, along })
  }
  return edges
}

// Whether a wall goes round — a closed one needs three corners; with two it is a line drawn there and back.
export function isClosed(wall: Pick<Wall, 'points' | 'closed'>): boolean {
  return wall.closed === true && wall.points.length > 2
}

// The point `at` units along an edge.
export function pointAlong(edge: WallEdge, at: number): PlanPoint {
  return { x: edge.a.x + edge.along.x * at, y: edge.a.y + edge.along.y * at }
}

// The outline of what a wall paints — closed rings in plan units, to fill with the nonzero rule: the band along its
// centre line, `thickness` across, corners mitred (cut square past MITRE_LIMIT), broken where its openings are. A
// free end runs half the thickness past its last point, so two walls whose ends meet fill the corner between them; an
// end at an opening stops square on it. A closed wall without openings is two rings — the outer one and the inner one
// the other way round, which leaves the hole.
export function wallOutlineOf(wall: Wall): PlanPoint[][] {
  const half = wall.thickness / 2
  return piecesOf(wall).flatMap((piece) => {
    if (piece.closed) {
      const left = piece.points.map((p, i, all) =>
        joinOf(all[(i - 1 + all.length) % all.length]!, p, all[(i + 1) % all.length]!, half),
      )
      return [left.flatMap((join) => join.left), left.flatMap((join) => join.right).reverse()]
    }
    const { points } = piece
    if (points.length < 2) return []
    const joins = points.map((p, i) => {
      const previous = points[i - 1]
      const next = points[i + 1]
      if (previous && next) return joinOf(previous, p, next, half)
      const from = previous ?? p
      const to = next ?? p
      const d = unit(from, to)
      // A free end runs past its point; an end at an opening stops on it.
      const cap = (i === 0 ? piece.capStart : piece.capEnd) ? half : 0
      const end = i === 0 ? { x: p.x - d.x * cap, y: p.y - d.y * cap } : { x: p.x + d.x * cap, y: p.y + d.y * cap }
      const n = normalOf(d)
      return {
        left: [{ x: end.x + n.x * half, y: end.y + n.y * half }],
        right: [{ x: end.x - n.x * half, y: end.y - n.y * half }],
      }
    })
    return [[...joins.flatMap((join) => join.left), ...joins.flatMap((join) => join.right).reverse()]]
  })
}

// The rectangle around everything a wall paints, its openings filled in.
export function wallBoundsOf(wall: Wall): PlanRect {
  return boundsOfPoints(wallOutlineOf({ ...wall, openings: [] }).flat())
}

// Whether a point lies on a wall's band — within half its thickness of the centre line, openings included.
export function wallContains(wall: Wall, point: PlanPoint, slack = 0): boolean {
  return wallEdgesOf(wall).some((edge) => distanceToEdge(edge, point).distance <= wall.thickness / 2 + slack)
}

// Where each opening is drawn — the stretch of the centre line it takes and the box across the band. Openings whose
// edge is gone are left out.
export function openingShapesOf(wall: Wall): OpeningShape[] {
  const edges = wallEdgesOf(wall)
  const half = wall.thickness / 2
  return (wall.openings ?? []).flatMap((opening, index) => {
    const edge = edges[opening.edge]
    if (!edge || edge.length === 0) return []
    const from = pointAlong(edge, Math.max(0, opening.at))
    const to = pointAlong(edge, Math.min(edge.length, opening.at + opening.width))
    const n = normalOf(edge.along)
    const across = (p: PlanPoint, side: number) => ({ x: p.x + n.x * half * side, y: p.y + n.y * half * side })
    return [{ index, opening, from, to, points: [across(from, 1), across(to, 1), across(to, -1), across(from, -1)] }]
  })
}

// Where an opening `width` wide goes for a point: in the nearest wall edge within `reach`, centred where the point
// meets it and kept within the edge, at a whole unit. `far` when no wall is that near, `short` when the nearest edge
// is shorter than the opening, `taken` when it would cut into an opening already there.
export function openingAt(
  walls: readonly Wall[],
  point: PlanPoint,
  width: number,
  reach: number,
): { wall: string; opening: WallOpening } | 'far' | 'short' | 'taken' {
  let nearest: { wall: Wall; edge: WallEdge; t: number; distance: number } | null = null
  for (const wall of walls) {
    for (const edge of wallEdgesOf(wall)) {
      if (edge.length === 0) continue
      const { t, distance } = distanceToEdge(edge, point)
      if (distance <= reach + wall.thickness / 2 && (nearest === null || distance < nearest.distance))
        nearest = { wall, edge, t, distance }
    }
  }
  if (nearest === null) return 'far'
  const { wall, edge, t } = nearest
  if (edge.length < width) return 'short'
  const at = Math.round(Math.min(Math.max(t * edge.length - width / 2, 0), edge.length - width))
  const clash = (wall.openings ?? []).some((o) => o.edge === edge.index && o.at < at + width && at < o.at + o.width)
  if (clash) return 'taken'
  return { wall: wall.id, opening: { edge: edge.index, at, width } }
}

// The rooms walls close — every area their centre lines go all the way round, however many walls that takes: a
// partition across a room makes two, rooms built side by side share their wall. An open wall's end within a wall's
// half thickness of another wall meets it there. Openings do not break a room. Each room once, its points running
// clockwise; an area inside another is a room of its own (the outer one does not leave a hole for it).
export function roomsOf(walls: readonly Wall[]): Room[] {
  const segments = segmentsOf(walls)
  // Every point where a segment meets another splits it there.
  const cuts = segments.map(() => [0, 1])
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const [u, v] = meetingOf(segments[i]!, segments[j]!)
      cuts[i]!.push(...u)
      cuts[j]!.push(...v)
    }
  }
  const nodes = new Map<string, PlanPoint>()
  const edges = new Map<string, { from: string; to: string; walls: Set<string> }>()
  const nodeOf = (p: PlanPoint) => {
    const key = `${Math.round(p.x / NODE_EPSILON)}:${Math.round(p.y / NODE_EPSILON)}`
    if (!nodes.has(key)) nodes.set(key, p)
    return key
  }
  segments.forEach((segment, i) => {
    const ts = [...new Set(cuts[i]!.map((t) => Math.min(1, Math.max(0, t))))].sort((p, q) => p - q)
    for (let k = 1; k < ts.length; k++) {
      const from = nodeOf(lerp(segment.a, segment.b, ts[k - 1]!))
      const to = nodeOf(lerp(segment.a, segment.b, ts[k]!))
      if (from === to) continue
      const key = from < to ? `${from}|${to}` : `${to}|${from}`
      const edge = edges.get(key)
      if (edge) edge.walls.add(segment.wall)
      else edges.set(key, { from, to, walls: new Set([segment.wall]) })
    }
  })
  // Neighbours by node — ends that lead nowhere are pruned, so a wall sticking out of a room does not split its outline.
  const neighbours = new Map<string, Set<string>>()
  for (const { from, to } of edges.values()) {
    neighbours.set(from, (neighbours.get(from) ?? new Set()).add(to))
    neighbours.set(to, (neighbours.get(to) ?? new Set()).add(from))
  }
  const loose = [...neighbours.keys()].filter((key) => neighbours.get(key)!.size < 2)
  while (loose.length > 0) {
    const key = loose.pop()!
    for (const other of neighbours.get(key) ?? []) {
      const rest = neighbours.get(other)!
      rest.delete(key)
      if (rest.size === 1) loose.push(other)
    }
    neighbours.delete(key)
  }
  // Each node's neighbours by the direction they lie in; walking a half edge, the next one turns as far right as it
  // can — that walks every bounded area clockwise (positive area, y down) and the outside of each cluster the other way.
  const sorted = new Map(
    [...neighbours].map(([key, around]) => {
      const p = nodes.get(key)!
      const angle = (other: string) => Math.atan2(nodes.get(other)!.y - p.y, nodes.get(other)!.x - p.x)
      return [key, [...around].sort((a, b) => angle(a) - angle(b))]
    }),
  )
  const seen = new Set<string>()
  const rooms: Room[] = []
  for (const [start, around] of sorted) {
    for (const first of around) {
      if (seen.has(`${start}>${first}`)) continue
      const cycle: string[] = []
      const ids = new Set<string>()
      let from = start
      let to = first
      while (!seen.has(`${from}>${to}`)) {
        seen.add(`${from}>${to}`)
        cycle.push(from)
        const key = from < to ? `${from}|${to}` : `${to}|${from}`
        for (const id of edges.get(key)!.walls) ids.add(id)
        const list = sorted.get(to)!
        const back = list.indexOf(from)
        const next = list[(back - 1 + list.length) % list.length]!
        from = to
        to = next
      }
      const points = withoutStraights(cycle.map((key) => nodes.get(key)!))
      if (points.length >= 3 && signedArea(points) > NODE_EPSILON) rooms.push({ points, walls: [...ids].sort() })
    }
  }
  return rooms
}

// The innermost room containing a point, or null.
export function roomAt(rooms: readonly Room[], point: PlanPoint): Room | null {
  let found: Room | null = null
  for (const room of rooms) {
    if (!polygonContains(room.points, point)) continue
    if (found === null || Math.abs(signedArea(room.points)) < Math.abs(signedArea(found.points))) found = room
  }
  return found
}

// The rectangle around several walls' bands, or null for none.
export function wallsBoundsOf(walls: readonly Wall[]): PlanRect | null {
  return unionBounds(walls.map(wallBoundsOf))
}

// How far a point lies from an edge, and where along it (0 at `a`, 1 at `b`) its nearest point is.
export function distanceToEdge(edge: WallEdge, point: PlanPoint): { t: number; distance: number } {
  if (edge.length === 0) return { t: 0, distance: Math.hypot(point.x - edge.a.x, point.y - edge.a.y) }
  const u = (point.x - edge.a.x) * edge.along.x + (point.y - edge.a.y) * edge.along.y
  const t = Math.min(1, Math.max(0, u / edge.length))
  const foot = pointAlong(edge, t * edge.length)
  return { t, distance: Math.hypot(point.x - foot.x, point.y - foot.y) }
}

// A wall's centre line cut where its openings are — the pieces left standing, in order. A piece starting or ending at
// the wall's own end has a free end there (`capStart`, `capEnd`); a closed wall without openings is one closed piece.
function piecesOf(wall: Wall): { points: PlanPoint[]; closed: boolean; capStart: boolean; capEnd: boolean }[] {
  const edges = wallEdgesOf(wall)
  const closed = isClosed(wall)
  const openings = (wall.openings ?? []).filter((o) => edges[o.edge] !== undefined && o.width > 0)
  if (openings.length === 0) {
    const points = withoutRepeats(wall.points, closed)
    return [{ points, closed, capStart: !closed, capEnd: !closed }]
  }
  // What stands of each edge, from its start.
  const runs = edges.flatMap((edge) => {
    const gaps = openings
      .filter((o) => o.edge === edge.index)
      .map((o) => [Math.max(0, o.at), Math.min(edge.length, o.at + o.width)] as const)
      .sort((p, q) => p[0] - q[0])
    const standing: { edge: WallEdge; from: number; to: number }[] = []
    let t = 0
    for (const [from, to] of gaps) {
      if (from > t) standing.push({ edge, from: t, to: from })
      t = Math.max(t, to)
    }
    if (t < edge.length || (edge.length === 0 && gaps.length === 0)) standing.push({ edge, from: t, to: edge.length })
    return standing
  })
  const chains: (typeof runs)[] = []
  for (const run of runs) {
    const last = chains.at(-1)?.at(-1)
    const joins =
      last !== undefined && last.to === last.edge.length && run.from === 0 && run.edge.index === last.edge.index + 1
    if (joins) chains.at(-1)!.push(run)
    else chains.push([run])
  }
  // Round a closed wall, the piece through its first corner is one.
  const first = chains[0]?.[0]
  const tail = chains.at(-1)?.at(-1)
  if (closed && chains.length > 1 && first && tail && first.from === 0 && first.edge.index === 0) {
    if (tail.to === tail.edge.length && tail.edge.index === edges.length - 1)
      chains[0] = [...chains.pop()!, ...chains[0]!]
  }
  return chains.map((chain) => {
    const start = chain[0]!
    const end = chain.at(-1)!
    const points = withoutRepeats(
      [pointAlong(start.edge, start.from), ...chain.map((run) => pointAlong(run.edge, run.to))],
      false,
    )
    return {
      points,
      closed: false,
      capStart: !closed && start.edge.index === 0 && start.from === 0,
      capEnd: !closed && end.edge.index === edges.length - 1 && end.to === end.edge.length,
    }
  })
}

// The two corners of the band at a point between two others — a mitre on either side, or both corners of a square
// cut when the turn is too sharp (or turns straight back).
function joinOf(previous: PlanPoint, p: PlanPoint, next: PlanPoint, half: number) {
  const n1 = normalOf(unit(previous, p))
  const n2 = normalOf(unit(p, next))
  const sum = { x: n1.x + n2.x, y: n1.y + n2.y }
  const size = Math.hypot(sum.x, sum.y)
  const m = size < EPSILON ? null : { x: sum.x / size, y: sum.y / size }
  const reach = m ? half / (m.x * n1.x + m.y * n1.y) : Infinity
  if (!m || reach > half * MITRE_LIMIT) {
    return {
      left: [offset(p, n1, half), offset(p, n2, half)],
      right: [offset(p, n1, -half), offset(p, n2, -half)],
    }
  }
  return { left: [offset(p, m, reach)], right: [offset(p, m, -reach)] }
}

type Segment = { a: PlanPoint; b: PlanPoint; wall: string; half: number }

// Every edge of every wall with a length, an open wall's ends moved onto the wall they stop within half a thickness
// of — onto its centre line, where they meet.
function segmentsOf(walls: readonly Wall[]): Segment[] {
  const all = walls.flatMap((wall) =>
    wallEdgesOf(wall).flatMap((edge) =>
      edge.length === 0 ? [] : [{ a: edge.a, b: edge.b, wall: wall.id, half: wall.thickness / 2, edge: edge.index }],
    ),
  )
  const moved = new Map<string, PlanPoint>()
  for (const wall of walls) {
    if (isClosed(wall) || wall.points.length < 2) continue
    const last = wall.points.length - 1
    for (const end of [0, last]) {
      const p = wall.points[end]!
      let best: { point: PlanPoint; distance: number } | null = null
      for (const s of all) {
        // Not onto the wall's own edge at that end.
        if (s.wall === wall.id && (s.edge === end || s.edge === end - 1)) continue
        const edge = {
          index: 0,
          a: s.a,
          b: s.b,
          length: Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y),
          along: unit(s.a, s.b),
        }
        const { t, distance } = distanceToEdge(edge, p)
        if (distance > EPSILON && distance <= s.half + 0.5 && (best === null || distance < best.distance))
          best = { point: pointAlong(edge, t * edge.length), distance }
      }
      if (best) moved.set(`${wall.id}:${end}`, best.point)
    }
  }
  return walls.flatMap((wall) =>
    wallEdgesOf(wall).flatMap((edge): Segment[] => {
      if (edge.length === 0) return []
      const next = (edge.index + 1) % wall.points.length
      const a = moved.get(`${wall.id}:${edge.index}`) ?? edge.a
      const b = moved.get(`${wall.id}:${next}`) ?? edge.b
      return [{ a, b, wall: wall.id, half: wall.thickness / 2 }]
    }),
  )
}

// Where two segments meet, as parameters along each (0 at `a`, 1 at `b`): a crossing or a touch, or — lying along
// one line — each one's ends that fall on the other.
function meetingOf(s: Segment, t: Segment): [number[], number[]] {
  const r = { x: s.b.x - s.a.x, y: s.b.y - s.a.y }
  const q = { x: t.b.x - t.a.x, y: t.b.y - t.a.y }
  const w = { x: t.a.x - s.a.x, y: t.a.y - s.a.y }
  const denom = cross(r, q)
  const rr = r.x * r.x + r.y * r.y
  const qq = q.x * q.x + q.y * q.y
  const tolerance = 1e-9 * Math.sqrt(rr * qq)
  if (Math.abs(denom) > tolerance) {
    const u = cross(w, q) / denom
    const v = cross(w, r) / denom
    const slackU = NODE_EPSILON / Math.sqrt(rr)
    const slackV = NODE_EPSILON / Math.sqrt(qq)
    if (u < -slackU || u > 1 + slackU || v < -slackV || v > 1 + slackV) return [[], []]
    return [[u], [v]]
  }
  // Parallel — they meet only lying along one line.
  if (Math.abs(cross(w, r)) / Math.sqrt(rr) > NODE_EPSILON) return [[], []]
  const along = (p: PlanPoint, a: PlanPoint, d: PlanPoint, dd: number) => ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / dd
  const onS = [along(t.a, s.a, r, rr), along(t.b, s.a, r, rr)].filter((u) => u > -EPSILON && u < 1 + EPSILON)
  const onT = [along(s.a, t.a, q, qq), along(s.b, t.a, q, qq)].filter((v) => v > -EPSILON && v < 1 + EPSILON)
  return [onS, onT]
}

// A closed outline without corners that lie straight between their neighbours.
function withoutStraights(points: readonly PlanPoint[]): PlanPoint[] {
  return points.filter((p, i) => {
    const previous = points[(i - 1 + points.length) % points.length]!
    const next = points[(i + 1) % points.length]!
    return Math.abs(cross({ x: p.x - previous.x, y: p.y - previous.y }, { x: next.x - p.x, y: next.y - p.y })) > 1e-6
  })
}

// Points without one repeated right after itself (round the end too, for a closed line).
function withoutRepeats(points: readonly PlanPoint[], closed: boolean): PlanPoint[] {
  const kept = points.filter((p, i) => i === 0 || !samePoint(p, points[i - 1]!))
  if (closed && kept.length > 1 && samePoint(kept[0]!, kept.at(-1)!)) kept.pop()
  return kept
}

function samePoint(a: PlanPoint, b: PlanPoint): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON
}

function unit(from: PlanPoint, to: PlanPoint): PlanPoint {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  return length === 0 ? { x: 1, y: 0 } : { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

// The left normal of a direction (y down: a quarter turn anticlockwise on screen).
function normalOf(d: PlanPoint): PlanPoint {
  return { x: d.y, y: -d.x }
}

function offset(p: PlanPoint, n: PlanPoint, distance: number): PlanPoint {
  return { x: p.x + n.x * distance, y: p.y + n.y * distance }
}

function lerp(a: PlanPoint, b: PlanPoint, t: number): PlanPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function cross(a: PlanPoint, b: PlanPoint): number {
  return a.x * b.y - a.y * b.x
}
