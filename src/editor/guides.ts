import { seatPlan } from '../core/geometry'
import { boundsOfPoints, unionBounds } from '../core/math'
import type { PlanGuide, PlanPoint, PlanRect, SeatPlan } from '../core/types'
import { wallEdgesOf, type WallEdge } from '../core/walls'

// Smart guides — what is dragged or drawn snaps to the edges and centre lines of what stands around it, and a move
// to the spacing already between its neighbours, the way design tools do it. Pure: the editor hook gathers what to
// line up with (`targetsOf`) and asks on every move; `SeatMap.EditorOverlay` draws the guides that come back.

type Axis = 'x' | 'y'

// Which axes a snap may move — Shift keeps a move to one.
type Axes = { x: boolean; y: boolean }

type Snapped<T> = { guides: PlanGuide[]; exact: Axes } & T

export const planGuides = {
  targetsOf,
  wallTargetsOf,
  snapMove,
  snapPoint,
}

// What can be lined up with: the box of every unit — a group as one, an object outside groups — of every section and
// of the band along every edge of a wall (both its faces and its centre line), but the objects, groups and walls in
// `moving` (and their members). Group labels are left out.
function targetsOf(plan: SeatPlan<string>, moving: ReadonlySet<string>): PlanRect[] {
  const units = new Map<string, PlanRect[]>()

  for (const object of plan.objects) {
    if (object.kind === 'label' || moving.has(object.id)) continue

    if (object.group !== undefined && moving.has(object.group)) continue
    const key = object.group ?? object.id
    units.set(key, [...(units.get(key) ?? []), seatPlan.boundsOf(object)])
  }

  return [
    ...[...units.values()].flatMap((rects) => unionBounds(rects) ?? []),
    ...plan.sections.map((section) => boundsOfPoints(section.points)),
    ...plan.walls.flatMap((wall) =>
      moving.has(wall.id) ? [] : wallEdgesOf(wall).map((edge) => bandOf(edge, wall.thickness / 2)),
    ),
  ]
}

// What a wall being drawn lines up with: the corners of the other walls (but those in `moving`), on both axes — so
// rooms line up. Not furniture, and not the faces of walls: a wall's centre line stays where its corners are drawn.
function wallTargetsOf(plan: Pick<SeatPlan, 'walls'>, moving: ReadonlySet<string>): PlanRect[] {
  return plan.walls.flatMap((wall) =>
    moving.has(wall.id) ? [] : wall.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })),
  )
}

// The box around the band along one edge of a wall.
function bandOf(edge: WallEdge, half: number): PlanRect {
  const n = { x: edge.along.y * half, y: -edge.along.x * half }

  return boundsOfPoints([
    { x: edge.a.x + n.x, y: edge.a.y + n.y },
    { x: edge.a.x - n.x, y: edge.a.y - n.y },
    { x: edge.b.x + n.x, y: edge.b.y + n.y },
    { x: edge.b.x - n.x, y: edge.b.y - n.y },
  ])
}

// A move of `rect` by `delta`, snapped on the `axes` it may take: an edge or the centre line onto one of the targets',
// or the gap to its neighbours made the same on both sides or the same as the one beside them. `exact` says which
// axes a guide took — leave those off the grid.
function snapMove(
  rect: PlanRect,
  delta: PlanPoint,
  targets: readonly PlanRect[],
  tolerance: number,
  axes: Axes = BOTH,
): Snapped<{ delta: PlanPoint }> {
  const moved = { ...rect, x: rect.x + delta.x, y: rect.y + delta.y }
  const x = axes.x ? bestShift('x', moved, targets, tolerance) : null
  const y = axes.y ? bestShift('y', moved, targets, tolerance) : null
  const placed = { ...moved, x: moved.x + (x?.shift ?? 0), y: moved.y + (y?.shift ?? 0) }

  return {
    delta: { x: delta.x + (x?.shift ?? 0), y: delta.y + (y?.shift ?? 0) },
    exact: { x: x !== null, y: y !== null },
    guides: [
      ...linesThrough('x', placed, targets),
      ...linesThrough('y', placed, targets),
      // Gaps are found where the snap puts the rect along their axis; across it, it may have moved too.
      ...(x?.gap ? [{ ...x.gap, at: placed.y + placed.h / 2 }] : []),
      ...(y?.gap ? [{ ...y.gap, at: placed.x + placed.w / 2 }] : []),
    ],
  }
}

// A point — a corner being dragged, the end of a stroke — snapped to the nearest edge or centre line of a target on
// each axis.
function snapPoint(point: PlanPoint, targets: readonly PlanRect[], tolerance: number): Snapped<{ point: PlanPoint }> {
  const spot = { ...point, w: 0, h: 0 }
  const x = bestShift('x', spot, targets, tolerance, false)
  const y = bestShift('y', spot, targets, tolerance, false)
  const placed = { x: point.x + (x?.shift ?? 0), y: point.y + (y?.shift ?? 0) }

  return {
    point: placed,
    exact: { x: x !== null, y: y !== null },
    guides: [
      ...linesThrough('x', { ...placed, w: 0, h: 0 }, targets),
      ...linesThrough('y', { ...placed, w: 0, h: 0 }, targets),
    ],
  }
}

type Gap = Extract<PlanGuide, { kind: 'gap' }>

// The smallest shift along `axis` within `tolerance` that lines `rect` up with a target, or (with `spacing`) evens its
// gaps — null when none is that close.
function bestShift(
  axis: Axis,
  rect: PlanRect,
  targets: readonly PlanRect[],
  tolerance: number,
  spacing = true,
): { shift: number; gap?: Gap } | null {
  let best: { shift: number; gap?: Gap } | null = null

  const consider = (shift: number, gap?: Gap) => {
    if (Math.abs(shift) <= tolerance && (best === null || Math.abs(shift) < Math.abs(best.shift))) best = { shift, gap }
  }

  const own = linesOf(axis, rect)

  for (const target of targets) {
    for (const line of linesOf(axis, target)) for (const mine of own) consider(line - mine)
  }

  if (spacing) for (const option of spacings(axis, rect, targets)) consider(option.shift, option.gap)

  return best
}

// Ways to even `rect`'s gaps along `axis` among the targets beside it (sharing its band on the other axis): halfway
// between its neighbours, or as far from one as that one is from the next.
function spacings(axis: Axis, rect: PlanRect, targets: readonly PlanRect[]): { shift: number; gap: Gap }[] {
  const [start, size] = axis === 'x' ? (['x', 'w'] as const) : (['y', 'h'] as const)
  const [cross, crossSize] = axis === 'x' ? (['y', 'h'] as const) : (['x', 'w'] as const)

  const band = (other: PlanRect) =>
    other[cross] < rect[cross] + rect[crossSize] && rect[cross] < other[cross] + other[crossSize]

  const beside = targets.filter(band)
  const mid = rect[start] + rect[size] / 2

  const before = nearest(
    beside.filter((t) => t[start] + t[size] <= mid),
    (t) => t[start] + t[size],
    'max',
  )

  const after = nearest(
    beside.filter((t) => t[start] >= mid),
    (t) => t[start],
    'min',
  )

  const at = rect[cross] + rect[crossSize] / 2
  const gap = (size: number, gaps: { from: number; to: number }[]): Gap => ({ kind: 'gap', axis, at, size, gaps })
  const options: { shift: number; gap: Gap }[] = []

  if (before && after) {
    const room = after[start] - (before[start] + before[size]) - rect[size]

    if (room >= 0) {
      const from = before[start] + before[size] + room / 2
      options.push({
        shift: from - rect[start],
        gap: gap(room / 2, [
          { from: before[start] + before[size], to: from },
          { from: from + rect[size], to: after[start] },
        ]),
      })
    }
  }

  if (before) {
    const previous = nearest(
      beside.filter((t) => t[start] + t[size] <= before[start]),
      (t) => t[start] + t[size],
      'max',
    )

    if (previous) {
      const space = before[start] - (previous[start] + previous[size])
      const from = before[start] + before[size] + space
      options.push({
        shift: from - rect[start],
        gap: gap(space, [
          { from: previous[start] + previous[size], to: before[start] },
          { from: before[start] + before[size], to: from },
        ]),
      })
    }
  }

  if (after) {
    const next = nearest(
      beside.filter((t) => t[start] >= after[start] + after[size]),
      (t) => t[start],
      'min',
    )

    if (next) {
      const space = next[start] - (after[start] + after[size])
      const from = after[start] - space - rect[size]
      options.push({
        shift: from - rect[start],
        gap: gap(space, [
          { from: from + rect[size], to: after[start] },
          { from: after[start] + after[size], to: next[start] },
        ]),
      })
    }
  }

  return options.filter((option) => option.gap.size > 0)
}

// The guides along `axis` through `rect`'s edges and centre line that targets share — each spanning what lines up.
function linesThrough(axis: Axis, rect: PlanRect, targets: readonly PlanRect[]): PlanGuide[] {
  const [cross, crossSize] = axis === 'x' ? (['y', 'h'] as const) : (['x', 'w'] as const)

  return [...new Set(linesOf(axis, rect))].flatMap((at) => {
    const sharing = targets.filter((target) => linesOf(axis, target).some((line) => Math.abs(line - at) < SAME))

    if (sharing.length === 0) return []
    const all = [rect, ...sharing]
    const from = Math.min(...all.map((r) => r[cross]))
    const to = Math.max(...all.map((r) => r[cross] + r[crossSize]))

    return [{ kind: 'line' as const, axis, at, from, to }]
  })
}

// A rectangle's edges and centre line across `axis` — left, middle and right for x.
function linesOf(axis: Axis, rect: PlanRect): number[] {
  const [start, size] = axis === 'x' ? [rect.x, rect.w] : [rect.y, rect.h]

  return [start, start + size / 2, start + size]
}

function nearest<T>(items: readonly T[], key: (item: T) => number, way: 'min' | 'max'): T | undefined {
  let found: T | undefined

  for (const item of items) {
    if (found === undefined || (way === 'min' ? key(item) < key(found) : key(item) > key(found))) found = item
  }

  return found
}

// Lines this close count as the same (plan units) — positions are whole units, centres halves.
const SAME = 0.5

const BOTH: Axes = { x: true, y: true }
