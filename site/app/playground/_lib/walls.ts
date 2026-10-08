import {
  seatPlan,
  type Fixture,
  type PlanBox,
  type PlanObject,
  type PlanPoint,
  type PlanSize,
  type SeatPlan,
} from 'ichno'

// Where this site's doors go. ichno stores a door as a fixture like any other — `door` is this site's role — and the
// playground puts one in a wall: a room's edge (a section's outline; the door stands just inside it, a side on the
// edge) or a wall fixture (the door stands across the band it paints). Where a door stands in a wall, that wall is
// left open — in 2D (../_components/openings.tsx) and in 3D (./scene.ts).

type Plan = SeatPlan<string>

// A wall as a line: from `a` along `along` (a unit vector) for `length` plan units. A room's edge knows which way is
// in (`inward`); a wall fixture has no inside — a door stands across its line.
export type WallLine = {
  kind: 'room' | 'wall'
  // The section's id (with the edge's index) or the wall fixture's.
  id: string
  edge: number
  a: PlanPoint
  along: PlanPoint
  length: number
  inward: PlanPoint | null
}

// The stretch of a wall a door stands in, from `from` to `to` plan units along it.
export type Opening = { wall: WallLine; from: number; to: number }

// How far (plan units) from a wall a door can be dropped and still go in it — a cell.
const REACH = 46
// How far a door's side may lie off a wall's line and still stand in it — rounding to whole units moves it half one.
const TOUCH = 1.5

// Every wall a door can go in: each section's edges, then the wall fixtures.
export function wallLinesOf(plan: Plan): WallLine[] {
  const rooms = plan.sections.flatMap((section) =>
    section.points.flatMap((a, edge): WallLine[] => {
      const b = section.points[(edge + 1) % section.points.length]!
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      if (length === 0) return []
      const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
      const left = { x: -along.y, y: along.x }
      const probe = { x: (a.x + b.x) / 2 + left.x, y: (a.y + b.y) / 2 + left.y }
      const inside = seatPlan.sectionAt({ sections: [section] }, probe) !== null
      const inward = inside ? left : { x: -left.x, y: -left.y }
      return [{ kind: 'room', id: section.id, edge, a, along, length, inward }]
    }),
  )
  const walls = plan.objects.flatMap((object): WallLine[] => {
    if (object.kind !== 'fixture' || object.role !== 'wall') return []
    const { along, length } = longSideOf(object)
    const center = seatPlan.centerOf(object)
    const a = { x: center.x - (along.x * length) / 2, y: center.y - (along.y * length) / 2 }
    return [{ kind: 'wall', id: object.id, edge: 0, a, along, length, inward: null }]
  })
  return [...rooms, ...walls]
}

// Where a door `size` wide (along the wall) and deep goes for the pointer at `point`: in the nearest wall within
// REACH, centred where the pointer meets it but kept within the wall, turned to it — just inside a room's edge, or
// across a wall fixture. `far` when no wall is near enough, `short` when the nearest is narrower than the door.
export function doorAt(
  plan: Plan,
  point: PlanPoint,
  size: PlanSize,
): { box: PlanBox; wall: WallLine } | 'far' | 'short' {
  let nearest: { wall: WallLine; at: number; distance: number } | null = null
  for (const wall of wallLinesOf(plan)) {
    const at = clamp(along(wall, point), 0, wall.length)
    const foot = pointOn(wall, at, 0)
    const distance = Math.hypot(point.x - foot.x, point.y - foot.y)
    if (distance <= REACH && (nearest === null || distance < nearest.distance)) nearest = { wall, at, distance }
  }
  if (nearest === null) return 'far'
  const { wall } = nearest
  if (wall.length < size.w) return 'short'
  const center = pointOn(wall, clamp(nearest.at, size.w / 2, wall.length - size.w / 2), wall.inward ? size.h / 2 : 0)
  // A door's box is the same turned half way round, so a quarter of the turns do.
  const rotation = (Math.round((Math.atan2(wall.along.y, wall.along.x) * 180) / Math.PI) + 360) % 180
  const box = { x: Math.round(center.x - size.w / 2), y: Math.round(center.y - size.h / 2), w: size.w, h: size.h }
  return { box: rotation === 0 ? box : { ...box, rotation }, wall }
}

// The walls the doors stand in, and where: a door lying along a room's edge with a side on it, or along a wall
// fixture across its line, opens the stretch of it the door covers.
export function openingsOf(plan: Plan): Opening[] {
  const doors = plan.objects.filter((o): o is Fixture => o.kind === 'fixture' && o.role === 'door')
  if (doors.length === 0) return []
  const walls = wallLinesOf(plan)
  return doors.flatMap((door) => {
    const side = longSideOf(door)
    const corners = seatPlan.outlineOf(door)
    return walls.flatMap((wall): Opening[] => {
      if (Math.abs(side.along.x * wall.along.x + side.along.y * wall.along.y) < 0.99) return []
      const across = corners.map((p) => offsetOf(wall, p))
      const inLine = wall.inward
        ? Math.min(...across) >= -TOUCH && Math.min(...across) <= TOUCH
        : Math.min(...across) <= TOUCH && Math.max(...across) >= -TOUCH
      if (!inLine) return []
      const spans = corners.map((p) => along(wall, p))
      const from = Math.max(0, Math.min(...spans))
      const to = Math.min(wall.length, Math.max(...spans))
      return to - from >= 1 ? [{ wall, from, to }] : []
    })
  })
}

// The point `at` along a wall and `off` across it — into the room for a room's edge.
export function pointOn(wall: WallLine, at: number, off: number): PlanPoint {
  const inward = wall.inward ?? { x: -wall.along.y, y: wall.along.x }
  return {
    x: wall.a.x + wall.along.x * at + inward.x * off,
    y: wall.a.y + wall.along.y * at + inward.y * off,
  }
}

// How far along a wall a point lies, from its start.
function along(wall: WallLine, point: PlanPoint): number {
  return (point.x - wall.a.x) * wall.along.x + (point.y - wall.a.y) * wall.along.y
}

// How far a point lies off a wall's line — into the room for a room's edge.
function offsetOf(wall: WallLine, point: PlanPoint): number {
  const inward = wall.inward ?? { x: -wall.along.y, y: wall.along.x }
  return (point.x - wall.a.x) * inward.x + (point.y - wall.a.y) * inward.y
}

// The direction a box's long side runs, turned with it, and how long it is.
function longSideOf(object: PlanObject<string>): { along: PlanPoint; length: number } {
  const turn = ((object.rotation ?? 0) * Math.PI) / 180
  const wide = object.w >= object.h
  const local = wide ? { x: 1, y: 0 } : { x: 0, y: 1 }
  return {
    along: {
      x: local.x * Math.cos(turn) - local.y * Math.sin(turn),
      y: local.x * Math.sin(turn) + local.y * Math.cos(turn),
    },
    length: wide ? object.w : object.h,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
