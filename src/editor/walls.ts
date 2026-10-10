import { seatPlan } from '../core/geometry'
import { outlineOf, polygonContains, signedArea } from '../core/math'
import type { PlanHandle, PlanObject, PlanPoint, SeatPlan, Wall, WallOpening } from '../core/types'
import { distanceToEdge, isClosed, wallEdgesOf, wallOutlineOf } from '../core/walls'
import type { Snap } from './operations'

// Wall edits — adding walls and their openings, what a closed wall carries when it moves, and reshaping a wall from
// its handles with the walls joined to it following. Pure; `planEdits` and `planHandles` hand them out.
//
// A wall's vertices land on the walls' step when snapping (`Snap.wall`, half a cell unless given), and stay on the plan;
// where they are worked out (a wall built or joined, a run of it followed) they keep a hundredth of a unit. Its
// openings keep their place along their edge as the wall changes shape — moved back within an edge that got shorter,
// dropped from one shorter than they are wide. Another wall whose corner or end lies on a wall (within half its
// thickness) is joined to it: when that wall is reshaped, the joint goes with the edge it is on.

// How close (screen pixels) a dragged vertex comes to its neighbour to merge with it.
const MERGE_PX = 8

// How far (plan units) a corner where runs join may lie off the line through its neighbours and still be left out as
// straight — the most whole units put between corners of a slanted line.
const STRAIGHT = 1

// How close (plan units) a fixture's outline comes to a wall's face to stand against it.
const TOUCH = 1

const EPSILON = 1e-9

// Adds a wall — its points to a hundredth of a unit on the plan, a point repeated right after itself dropped; a closed wall
// needs three corners, an open one two. Its id is `wall-<n>`. Openings that do not fit their edge are moved back
// within it or dropped. null when too few points remain.
export function addWall<S extends string>(
  plan: SeatPlan<S>,
  wall: Omit<Wall, 'id'>,
): { plan: SeatPlan<S>; ids: string[] } | null {
  const points = wall.points
    .map((p) => ({
      x: Math.min(plan.width, Math.max(0, hundredth(p.x))),
      y: Math.min(plan.height, Math.max(0, hundredth(p.y))),
    }))
    .filter((p, i, all) => i === 0 || !samePoint(p, all[i - 1]!))

  if (wall.closed && points.length > 1 && samePoint(points[0]!, points.at(-1)!)) points.pop()
  const closed = wall.closed === true && points.length >= 3

  if (points.length < 2 || (wall.closed && !closed)) return null
  const id = seatPlan.nextObjectId(plan, 'wall')
  const made: Wall = { id, points, thickness: Math.max(1, Math.round(wall.thickness)) }

  if (closed) made.closed = true

  if (wall.openings?.length) made.openings = wall.openings

  return { plan: { ...plan, walls: [...plan.walls, fitted(made)] }, ids: [id] }
}

// Adds a run of wall — `points` to a hundredth of a unit, `thickness` across — joined to the open walls its ends meet, the way a
// housing game builds a wall a piece at a time: it carries one on (a straight continuation lengthens that wall's last
// edge rather than adding a corner), links two into one, or closes one round into a room. The wall it carries on keeps
// its id and thickness; one it links in is folded into it, openings and all. Straight on means within a unit of it:
// the corners of a slanted wall sit on whole units. A run that meets no wall's end is a new
// wall, `wall-<n>`. Returns the id of the wall the run is part of; null when the run has no length, leaves the plan,
// or runs along an edge a wall has already.
export function buildWall<S extends string>(
  plan: SeatPlan<S>,
  run: { points: readonly PlanPoint[]; thickness: number },
): { plan: SeatPlan<S>; ids: string[] } | null {
  const points = run.points
    .map((p) => ({ x: hundredth(p.x), y: hundredth(p.y) }))
    .filter((p, i, all) => i === 0 || !samePoint(p, all[i - 1]!))

  if (points.length < 2) return null

  if (points.some((p) => p.x < 0 || p.y < 0 || p.x > plan.width || p.y > plan.height)) return null

  if (points.some((p, i) => i > 0 && alongWall(plan.walls, points[i - 1]!, p))) return null
  const from = openEndAt(plan.walls, points[0]!)
  const to = openEndAt(plan.walls, points.at(-1)!)

  if (!from && !to) return addWall(plan, { points, thickness: run.thickness })
  // Carried on from the wall at its start — or, meeting one at its end only, from that one the other way round.
  const path = from ? points : [...points].reverse()
  const head = endingAt(from ?? to!, path[0]!)
  const tail = from && to ? to : null
  const run2 = path.slice(1)
  let made: Wall

  if (tail && tail.id === head.id) {
    // Back at its own start — round into a room.
    made = joinedWall(head, [...head.points, ...run2.slice(0, -1)], true, stationsOf(head), [head.points.length - 1, 0])
  } else if (tail) {
    const next = endingAt(tail, path.at(-1)!, true)
    const offset = lengthOf([...head.points, ...run2])
    made = joinedWall(
      head,
      [...head.points, ...run2.slice(0, -1), ...next.points],
      false,
      [...stationsOf(head), ...stationsOf(next).map((o) => ({ ...o, start: o.start + offset }))],
      [head.points.length - 1, head.points.length + run2.length - 1],
    )
  } else {
    made = joinedWall(head, [...head.points, ...run2], false, stationsOf(head), [head.points.length - 1])
  }

  const walls = plan.walls.flatMap((w) => (w.id === head.id ? [made] : tail && w.id === tail.id ? [] : [w]))

  return { plan: { ...plan, walls }, ids: [made.id] }
}

// Puts an opening in a wall — `seatPlan.openingAt` says where one goes for a point. null when the wall is missing,
// or the opening does not fit its edge or cuts into one already there.
export function addOpening<S extends string>(
  plan: SeatPlan<S>,
  wallId: string,
  opening: WallOpening,
): SeatPlan<S> | null {
  const wall = seatPlan.wallOf(plan, wallId)
  const edge = wall ? wallEdgesOf(wall)[opening.edge] : undefined

  if (!wall || !edge || opening.at < 0 || opening.at + opening.width > edge.length + EPSILON) return null
  const others = wall.openings ?? []

  if (others.some((o) => o.edge === opening.edge && o.at < opening.at + opening.width && opening.at < o.at + o.width))
    return null

  return withWall(plan, { ...wall, openings: [...others, { ...opening, at: Math.round(opening.at) }] })
}

// Takes an opening out of a wall, by its index in the wall's list.
export function removeOpening<S extends string>(plan: SeatPlan<S>, wallId: string, index: number): SeatPlan<S> {
  const wall = seatPlan.wallOf(plan, wallId)

  if (!wall?.openings?.[index]) return plan
  const openings = wall.openings.filter((_, i) => i !== index)
  const { openings: _, ...rest } = wall

  return withWall(plan, openings.length > 0 ? { ...rest, openings } : rest)
}

// Replaces a wall's points — on the walls' step when snapping, to a hundredth of a unit otherwise, on the plan — its
// openings kept within their edges.
export function reshapeWall<S extends string>(
  plan: SeatPlan<S>,
  id: string,
  points: readonly PlanPoint[],
  snap: Snap | null = null,
): SeatPlan<S> {
  const wall = seatPlan.wallOf(plan, id)

  if (!wall) return plan
  const step = wallStepOf(snap)

  const placed = points.map((p) =>
    snap
      ? onPlan(plan, p, step)
      : { x: Math.min(plan.width, Math.max(0, hundredth(p.x))), y: Math.min(plan.height, Math.max(0, hundredth(p.y))) },
  )

  return withWall(plan, fitted({ ...wall, points: placed }))
}

// Unit ids (a group by its own) and wall ids — what a closed wall carries.
type WallContents = { units: string[]; walls: string[] }

// What the closed walls among `ids` carry when they move — the units standing in them (a group whole when one of
// its members stands there, a loose object by its centre) and the walls inside them — but nothing `ids` holds itself.
export function wallContents(plan: SeatPlan<string>, ids: readonly string[]): WallContents {
  const listed = new Set(ids)
  const units = new Set<string>()
  const walls = new Set<string>()

  for (const id of ids) {
    const wall = seatPlan.wallOf(plan, id)

    if (!wall || !isClosed(wall)) continue

    for (const o of plan.objects) {
      if (o.kind === 'label' || listed.has(o.id) || (o.group !== undefined && listed.has(o.group))) continue

      if (polygonContains(wall.points, seatPlan.centerOf(o))) units.add(o.group ?? o.id)
    }

    for (const other of plan.walls) {
      if (!listed.has(other.id) && other.points.every((p) => polygonContains(wall.points, p))) walls.add(other.id)
    }
  }

  return { units: [...units], walls: [...walls] }
}

// The handles a selected wall shows — every vertex, and the middle of every edge (dragging it pushes the edge; with
// Alt it adds a vertex there).
export function wallHandlesOf<S extends string>(wall: Wall): PlanHandle<S>[] {
  const owner = { kind: 'wall' as const, id: wall.id }

  return [
    ...wall.points.map((point, i) => ({ owner, name: `vertex-${i}`, point })),
    ...wallEdgesOf(wall).flatMap((edge) =>
      edge.length === 0
        ? []
        : [{ owner, name: `edge-${edge.index}`, point: middle(edge.a, edge.b), angle: angleOf(edge.a, edge.b) + 90 }],
    ),
  ]
}

// The outline drawn round a wall in the editor — its band, the outer ring of a closed one.
export function wallFrameOf(wall: Wall): PlanPoint[] | null {
  const rings = wallOutlineOf({ ...wall, openings: [] })
  let widest: PlanPoint[] | null = null

  for (const ring of rings) {
    if (widest === null || Math.abs(signedArea(ring)) > Math.abs(signedArea(widest))) widest = ring
  }

  return widest
}

// The plan with a wall's handle dragged by `total` — a vertex moved (merged into its neighbour when dropped on it, as
// long as the wall keeps enough corners), an edge pushed straight out or in, or with `alt` a vertex added in the
// middle of the edge and moved. Joined walls follow a moved vertex or a pushed edge; loose fixtures standing against a
// pushed edge go with it, the way furniture stays against its wall.
export function dragWallHandle<S extends string>(
  plan: SeatPlan<S>,
  id: string,
  name: string,
  total: PlanPoint,
  snap: Snap | null,
  constrain: boolean,
  pixel: number,
  alt: boolean,
): SeatPlan<S> {
  const wall = seatPlan.wallOf(plan, id)
  const [kind, at] = name.split('-')
  const index = Number(at)

  if (!wall || (kind !== 'vertex' && kind !== 'edge') || !Number.isInteger(index)) return plan
  const step = wallStepOf(snap)
  const by = constrain ? alongAxisOf(total) : total
  const { points } = wall

  if (kind === 'edge' && !alt) return pushedEdge(plan, wall, index, total, snap)

  if (kind === 'edge') {
    const edge = wallEdgesOf(wall)[index]

    if (!edge || edge.length === 0) return plan
    const point = onPlan(plan, add(middle(edge.a, edge.b), by), step)
    const half = edge.length / 2

    const openings = wall.openings?.map((o) =>
      o.edge > index
        ? { ...o, edge: o.edge + 1 }
        : o.edge === index && o.at + o.width / 2 > half
          ? { ...o, edge: index + 1, at: Math.max(0, o.at - half) }
          : o,
    )

    const next = { ...wall, points: [...points.slice(0, index + 1), point, ...points.slice(index + 1)] }

    return withWall(plan, fitted(openings ? { ...next, openings } : next))
  }

  const from = points[index]

  if (!from) return plan
  const point = onPlan(plan, add(from, by), step)
  const closed = isClosed(wall)
  const count = points.length
  const previous = closed || index > 0 ? points[(index - 1 + count) % count] : undefined
  const next = closed || index < count - 1 ? points[(index + 1) % count] : undefined

  const near = (other: PlanPoint | undefined) =>
    other !== undefined && Math.hypot(other.x - point.x, other.y - point.y) <= MERGE_PX * pixel

  if (count > (closed ? 3 : 2) && (near(previous) || near(next))) {
    return withWall(plan, fitted(withoutVertex(wall, index)))
  }

  const moved = fitted({ ...wall, points: points.map((p, i) => (i === index ? point : p)) })

  return joined(withWall(plan, moved), wall, moved)
}

// A wall with one edge pushed straight out or in by as much of `total` as runs across it — both its ends together,
// onto a line of the walls' step when snapping a level or upright edge, by whole units otherwise. It stops a step short of any
// corner it would pass over, and at the plan's edge.
function pushedEdge<S extends string>(
  plan: SeatPlan<S>,
  wall: Wall,
  index: number,
  total: PlanPoint,
  snap: Snap | null,
): SeatPlan<S> {
  const edge = wallEdgesOf(wall)[index]

  if (!edge || edge.length === 0) return plan
  const { points } = wall
  const next = (index + 1) % points.length
  const across = { x: -edge.along.y, y: edge.along.x }
  const step = wallStepOf(snap)
  const [low, high] = pushRange(plan, points, index, next, edge.a, edge.along, edge.length, across, step)
  const wanted = Math.min(high, Math.max(low, total.x * across.x + total.y * across.y))
  const level = across.x === 0 || across.y === 0
  let push = level ? onLine(edge.a, across, wanted, step) : wanted

  if (push > high) push -= step

  if (push < low) push += step
  const d = { x: Math.round(across.x * push), y: Math.round(across.y * push) }

  if (d.x === 0 && d.y === 0) return plan
  const reach = wall.thickness / 2 + TOUCH

  const carried = new Set<PlanObject<S>>(
    plan.objects.flatMap((o) =>
      o.kind === 'fixture' && o.group === undefined && against(o, edge.a, edge.along, edge.length, across, reach)
        ? [o]
        : [],
    ),
  )

  const moved = fitted({
    ...wall,
    points: points.map((p, i) => (i === index || i === next ? { x: p.x + d.x, y: p.y + d.y } : p)),
  })

  const pushed = withWall(plan, moved)

  return joined(
    carried.size === 0
      ? pushed
      : { ...pushed, objects: pushed.objects.map((o) => (carried.has(o) ? seatPlan.translate(o, d.x, d.y) : o)) },
    wall,
    moved,
  )
}

// The plan after `before` became `after` (the same edges, reshaped), with every other wall's corner or end that lay
// on one of its edges kept on it: where the edge still runs through it, it stays; otherwise it goes to the same place
// along the edge as it was. Those walls' openings are kept within their edges.
function joined<S extends string>(plan: SeatPlan<S>, before: Wall, after: Wall): SeatPlan<S> {
  const old = wallEdgesOf(before)
  const now = wallEdgesOf(after)

  if (old.length !== now.length) return plan
  const reach = before.thickness / 2 + 0.5
  let changed = false

  const walls = plan.walls.map((wall) => {
    if (wall.id === before.id) return wall
    let moved = false

    const points = wall.points.map((p) => {
      let best: { index: number; t: number; distance: number } | null = null

      for (const edge of old) {
        const { t, distance } = distanceToEdge(edge, p)

        if (distance <= reach && (best === null || distance < best.distance)) best = { index: edge.index, t, distance }
      }

      if (best === null) return p
      const edge = now[best.index]!

      if (distanceToEdge(edge, p).distance <= reach) return p
      moved = true

      return {
        x: hundredth(edge.a.x + (edge.b.x - edge.a.x) * best.t),
        y: hundredth(edge.a.y + (edge.b.y - edge.a.y) * best.t),
      }
    })

    if (!moved) return wall
    changed = true

    return fitted({ ...wall, points })
  })

  return changed ? { ...plan, walls } : plan
}

// A wall without one vertex — the edges either side become one (an open wall's end edge goes); openings on a
// vanished edge go, the rest keep their edges.
function withoutVertex(wall: Wall, k: number): Wall {
  const edges = wallEdgesOf(wall)
  const closed = isClosed(wall)
  const last = wall.points.length - 1

  const openings = wall.openings?.flatMap((o): WallOpening[] => {
    if (!closed && ((k === 0 && o.edge === 0) || (k === last && o.edge === last - 1))) return []

    if (o.edge === k && (closed || k > 0)) {
      const before = edges[(k - 1 + edges.length) % edges.length]!

      return [{ ...o, edge: k === 0 ? edges.length - 2 : k - 1, at: o.at + before.length }]
    }

    return [o.edge > k ? { ...o, edge: o.edge - 1 } : o]
  })

  const next = { ...wall, points: wall.points.filter((_, i) => i !== k) }

  return openings ? { ...next, openings } : next
}

// An opening by how far along the whole wall it starts — what survives a wall turned round or joined to another.
type Stationed = { start: number; width: number; role?: string }

function stationsOf(wall: Wall): Stationed[] {
  const edges = wallEdgesOf(wall)
  const before = edges.map((_, i) => edges.slice(0, i).reduce((sum, e) => sum + e.length, 0))

  return (wall.openings ?? []).flatMap((o) => {
    if (!edges[o.edge]) return []
    const station: Stationed = { start: before[o.edge]! + o.at, width: o.width }

    if (o.role) station.role = o.role

    return [station]
  })
}

// An open wall ending at `point` (starting there with `start`) — turned round when it is the other way.
function endingAt(wall: Wall, point: PlanPoint, start = false): Wall {
  const atEnd = samePoint(wall.points.at(-1)!, point)

  if (atEnd !== start) return wall
  const total = lengthOf(wall.points)
  const openings = stationsOf(wall).map((o) => ({ ...o, start: total - o.start - o.width }))

  return withStations({ ...wall, points: [...wall.points].reverse() }, openings)
}

// A wall through `points` (closed or not) with `base`'s id and thickness and the openings at their stations — the
// corners at `junctions` (indices into `points`) left out where the line runs straight through them, to within a unit.
function joinedWall(
  base: Wall,
  points: readonly PlanPoint[],
  closed: boolean,
  stations: readonly Stationed[],
  junctions: readonly number[],
): Wall {
  const straight = new Set(
    junctions.filter((i) => {
      const previous = points[i - 1] ?? (closed ? points.at(-1) : undefined)
      const next = points[i + 1] ?? (closed ? points[0] : undefined)
      const p = points[i]

      if (!previous || !next || !p) return false
      const a = { x: p.x - previous.x, y: p.y - previous.y }
      const b = { x: next.x - p.x, y: next.y - p.y }
      // Within a unit of the line between its neighbours — corners on whole units leave a slanted wall that far off.
      const chord = Math.hypot(next.x - previous.x, next.y - previous.y)
      const off = chord === 0 ? Infinity : Math.abs(a.x * (next.y - previous.y) - a.y * (next.x - previous.x)) / chord

      return off < STRAIGHT && a.x * b.x + a.y * b.y > 0
    }),
  )

  const kept = points.filter((_, i) => !straight.has(i))
  const { closed: _, openings: __, ...rest } = base
  const joined: Wall = { ...rest, points: kept }

  if (closed) joined.closed = true

  return withStations(joined, stations)
}

// A wall with openings placed at their stations along it, each on the edge it falls within.
function withStations(wall: Wall, stations: readonly Stationed[]): Wall {
  const { openings: _, ...rest } = wall
  const edges = wallEdgesOf(wall)
  let before = 0

  const starts = edges.map((edge) => {
    const at = before
    before += edge.length

    return at
  })

  const openings = stations.flatMap((o): WallOpening[] => {
    const i = edges.findIndex(
      (edge, k) => o.start >= starts[k]! - EPSILON && o.start + o.width <= starts[k]! + edge.length + 0.5,
    )

    if (i < 0) return []
    const opening: WallOpening = { edge: i, at: Math.max(0, Math.round(o.start - starts[i]!)), width: o.width }

    if (o.role) opening.role = o.role

    return [opening]
  })

  return openings.length > 0 ? { ...rest, openings } : rest
}

function lengthOf(points: readonly PlanPoint[]): number {
  return points.reduce(
    (sum, p, i) => (i === 0 ? sum : sum + Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y)),
    0,
  )
}

// The open wall one of whose ends is `point`.
function openEndAt(walls: readonly Wall[], point: PlanPoint): Wall | undefined {
  return walls.find(
    (wall) =>
      !isClosed(wall) &&
      wall.points.length > 1 &&
      (samePoint(wall.points[0]!, point) || samePoint(wall.points.at(-1)!, point)),
  )
}

// Whether a stretch from `a` to `b` lies along an edge a wall has already.
function alongWall(walls: readonly Wall[], a: PlanPoint, b: PlanPoint): boolean {
  return walls.some((wall) =>
    wallEdgesOf(wall).some((edge) => distanceToEdge(edge, a).distance < 0.5 && distanceToEdge(edge, b).distance < 0.5),
  )
}

// The step walls' corners snap to — `Snap.wall`, half a cell unless given, whole units without snapping.
export function wallStepOf(snap: Snap | null): number {
  return snap ? (snap.wall ?? snap.cell / 2) : 1
}

// A wall with its openings kept within their edges — moved back within one that got shorter, whole units, dropped
// from an edge that is gone or shorter than they are wide.
export function fitted(wall: Wall): Wall {
  if (!wall.openings) return wall
  const edges = wallEdgesOf(wall)

  const openings = wall.openings.flatMap((o) => {
    const edge = edges[o.edge]

    if (!edge || edge.length < o.width) return []
    const at = Math.max(0, Math.min(Math.round(o.at), Math.floor(edge.length - o.width)))

    return [at === o.at ? o : { ...o, at }]
  })

  const { openings: _, ...rest } = wall

  return openings.length > 0 ? { ...rest, openings } : rest
}

function withWall<S extends string>(plan: SeatPlan<S>, wall: Wall): SeatPlan<S> {
  return { ...plan, walls: plan.walls.map((w) => (w.id === wall.id ? wall : w)) }
}

// How far an edge can be pushed across itself (negative: the other way) — a step short of every other corner of the
// wall it would pass over, and no further than the plan's edge. Staying put is always in range.
function pushRange(
  plan: Pick<SeatPlan, 'width' | 'height'>,
  points: readonly PlanPoint[],
  index: number,
  next: number,
  a: PlanPoint,
  along: PlanPoint,
  length: number,
  across: PlanPoint,
  step: number,
): [number, number] {
  let low = -Infinity
  let high = Infinity
  points.forEach((p, i) => {
    if (i === index || i === next) return
    const u = (p.x - a.x) * along.x + (p.y - a.y) * along.y
    const v = (p.x - a.x) * across.x + (p.y - a.y) * across.y

    if (u < -EPSILON || u > length + EPSILON) return

    if (v > EPSILON) high = Math.min(high, v - step)
    else if (v < -EPSILON) low = Math.max(low, v + step)
  })

  for (const p of [a, { x: a.x + along.x * length, y: a.y + along.y * length }]) {
    for (const [n, start, extent] of [
      [across.x, p.x, plan.width],
      [across.y, p.y, plan.height],
    ] as const) {
      if (Math.abs(n) < EPSILON) continue
      const [t1, t2] = [-start / n, (extent - start) / n]
      low = Math.max(low, Math.min(t1, t2))
      high = Math.min(high, Math.max(t1, t2))
    }
  }

  return [Math.min(low, 0), Math.max(high, 0)]
}

// The push `wanted` from `a` across a level or upright edge, landing the edge on the nearest step line.
function onLine(a: PlanPoint, across: PlanPoint, wanted: number, step: number): number {
  const axis = across.x === 0 ? 'y' : 'x'
  const sign = across[axis]

  return (roundTo(a[axis] + wanted * sign, step) - a[axis]) * sign
}

// Whether a fixture stands against a wall's edge or across it — its outline within `reach` of the centre line, its
// centre beside the edge rather than past one end.
function against(
  object: PlanObject,
  a: PlanPoint,
  along: PlanPoint,
  length: number,
  across: PlanPoint,
  reach: number,
): boolean {
  const center = seatPlan.centerOf(object)
  const u = (center.x - a.x) * along.x + (center.y - a.y) * along.y

  if (u < 0 || u > length) return false
  const offsets = outlineOf(object, 'rect').map((p) => (p.x - a.x) * across.x + (p.y - a.y) * across.y)

  return Math.min(...offsets) <= reach && Math.max(...offsets) >= -reach
}

// A point on the step grid, on the plan.
function onPlan(plan: Pick<SeatPlan, 'width' | 'height'>, point: PlanPoint, step: number): PlanPoint {
  return {
    x: Math.min(Math.floor(plan.width / step) * step, Math.max(0, roundTo(point.x, step))),
    y: Math.min(Math.floor(plan.height / step) * step, Math.max(0, roundTo(point.y, step))),
  }
}

function alongAxisOf(delta: PlanPoint): PlanPoint {
  return Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y }
}

function middle(a: PlanPoint, b: PlanPoint): PlanPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function angleOf(from: PlanPoint, to: PlanPoint): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
}

function add(a: PlanPoint, b: PlanPoint): PlanPoint {
  return { x: a.x + b.x, y: a.y + b.y }
}

function samePoint(a: PlanPoint, b: PlanPoint): boolean {
  return a.x === b.x && a.y === b.y
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

// A coordinate of a wall's corner — to a hundredth of a unit, so a metre turned any way measures a metre.
function hundredth(value: number): number {
  return Math.round(value * 100) / 100
}

// The point on a wall nearest `point` within `reach` plan units of its band — a corner or end first, then anywhere
// along a centre line, to a hundredth — so a wall drawn there meets the wall. null when no wall is that near.
export function onWalls(plan: Pick<SeatPlan, 'walls'>, point: PlanPoint, reach: number): PlanPoint | null {
  let corner: { point: PlanPoint; distance: number } | null = null
  let line: { point: PlanPoint; distance: number } | null = null

  for (const wall of plan.walls) {
    const near = wall.thickness / 2 + reach

    for (const p of wall.points) {
      const distance = Math.hypot(p.x - point.x, p.y - point.y)

      if (distance <= near && (corner === null || distance < corner.distance)) corner = { point: p, distance }
    }

    for (const edge of wallEdgesOf(wall)) {
      const { t, distance } = distanceToEdge(edge, point)

      if (distance > near || (line !== null && distance >= line.distance)) continue
      const foot = { x: edge.a.x + (edge.b.x - edge.a.x) * t, y: edge.a.y + (edge.b.y - edge.a.y) * t }
      line = { point: { x: hundredth(foot.x), y: hundredth(foot.y) }, distance }
    }
  }

  return corner?.point ?? line?.point ?? null
}
