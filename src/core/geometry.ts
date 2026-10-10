import { GRID_CELL } from './grid'
import {
  boundsOfBox,
  boundsOfPoints,
  boxContains,
  centerOfBox,
  offsetPolygon,
  outlineOf,
  polygonContains,
  polygonsOverlap,
  rotatePoint,
  signedArea,
  unionBounds,
} from './math'
import { spatialIndex } from './spatial'
import type {
  Fixture,
  Group,
  GroupLabel,
  Place,
  PlanBox,
  PlanObject,
  PlanPoint,
  PlanRect,
  Room,
  SeatPlan,
  Section,
  SectionPlan,
  Shape,
  Wall,
  WallOpening,
} from './types'
import {
  openingAt as openingAtOf,
  openingShapesOf,
  roomAt as roomAtOf,
  roomsOf as roomsOfWalls,
  wallBoundsOf,
  wallEdgesOf,
  wallOutlineOf,
  wallsBoundsOf,
  type OpeningShape,
} from './walls'

// Seat plan geometry — zod-free so client bundles (seat pickers, viewers) never pull the schema in.

// Id length limits — a place id is the booking key other records store (the 0.1 seat limit), other ids (fixtures,
// labels, groups) are editor handles. The schema enforces them; id generators never exceed them.
export const PLACE_ID_MAX = 8

export const OBJECT_ID_MAX = 16

// Drawing dimensions (plan units) — every renderer draws with the same values.
// The outer wall wraps outside the section outline, so it never covers places near the room edge.
export const WALL_THICKNESS = 5

// A wall fixture paints only a centre band this thick, so a thick wall box does not block the aisle.
export const INNER_WALL_THICKNESS = 8

// Section name — written above each section's outer wall when a plan holds more than one section. The band is
// one line of text plus breathing room above the wall.
export const SECTION_LABEL_FONT = 28

export const SECTION_LABEL_BAND = 64

// Places overlap only when they cut into each other by more than this (plan units). Positions computed on arcs
// and around tables are rounded to whole units, so neighbours that touch may cross by a fraction.
export const OVERLAP_TOLERANCE = 1

// Margin around the drawing — holds the outer wall plus a little air.
const DRAWING_MARGIN = 8

// Crop padding — breathing room between the crop edge and the outermost object (before cell snapping).
const SECTION_PLAN_PADDING = 20

const FIXTURE_LABEL_MAX_FONT = 20

const FIXTURE_LABEL_MIN_FONT = 10

const GROUP_LABEL_MAX_FONT = 20

const GROUP_LABEL_MIN_FONT = 10

export const seatPlan = {
  objectById,
  groupById,
  placesOf,
  membersOf,
  idsOf,
  sectionAt,
  sectionOf,
  sectionBoundsOf,
  sectionWallOf,
  wallOf,
  wallEdgesOf,
  wallOutlineOf,
  wallBoundsOf,
  wallsInRect,
  openingsOf,
  openingAt,
  roomsOf,
  roomAt,
  areaOf,
  nextPlaceId,
  nextObjectId,
  fixtureLabelOf,
  groupLabelOf,
  sectionPlanOf,
  sectionPlansOf,
  objectsInRect,
  innerWallOf,
  shapeOf,
  centerOf,
  outlineOf: outlineOfObject,
  boundsOf,
  boundsOfIds,
  extentOf,
  frameOf,
  orderAlong,
  contains,
  overlaps,
  conflictsOf,
  translate,
  showsSectionLabels,
  drawingBoundsOf,
}

function objectById<S extends string>(plan: Pick<SeatPlan<S>, 'objects'>, id: string): PlanObject<S> | undefined {
  return plan.objects.find((object) => object.id === id)
}

function groupById(plan: Pick<SeatPlan, 'groups'>, id: string): Group | undefined {
  return plan.groups.find((group) => group.id === id)
}

// Every bookable object, in drawing order.
function placesOf<S extends string>(plan: Pick<SeatPlan<S>, 'objects'>): Place<S>[] {
  return plan.objects.filter((object) => object.kind === 'place')
}

// The objects of a group, in drawing order — a row's seats in row order when they were laid out in it.
function membersOf<S extends string>(plan: Pick<SeatPlan<S>, 'objects'>, groupId: string): PlanObject<S>[] {
  return plan.objects.filter((object) => object.group === groupId)
}

// Every id in the document — objects, groups and walls share one namespace.
function idsOf(plan: Pick<SeatPlan, 'objects'> & Partial<Pick<SeatPlan, 'groups' | 'walls'>>): string[] {
  return [
    ...plan.objects.map((object) => object.id),
    ...(plan.groups ?? []).map((group) => group.id),
    ...(plan.walls ?? []).map((wall) => wall.id),
  ]
}

// The section containing a point — the editor re-homes a moved place to the section its centre lands in.
function sectionAt<S extends string>(plan: Pick<SeatPlan<S>, 'sections'>, point: PlanPoint): S | null {
  return plan.sections.find((section) => polygonContains(section.points, point))?.id ?? null
}

function sectionOf<S extends string>(plan: Pick<SeatPlan<S>, 'sections'>, id: S): Section<S> | undefined {
  return plan.sections.find((section) => section.id === id)
}

function sectionBoundsOf(section: Pick<Section, 'points'>): PlanRect {
  return boundsOfPoints(section.points)
}

// The outline the outer wall is stroked on — the section pushed out by half the wall, so the wall's inner edge
// runs exactly on the section edge.
function sectionWallOf(section: Pick<Section, 'points'>): PlanPoint[] {
  return offsetPolygon(section.points, WALL_THICKNESS / 2)
}

function wallOf(plan: Pick<SeatPlan, 'walls'>, id: string): Wall | undefined {
  return plan.walls.find((wall) => wall.id === id)
}

// The walls whose band touches a rectangle — marquee selection.
function wallsInRect(plan: Pick<SeatPlan, 'walls'>, rect: PlanRect): string[] {
  const band = outlineOf(rect, 'rect')

  return plan.walls
    .filter((wall) => wallOutlineOf({ ...wall, openings: [] }).some((ring) => polygonsOverlap(ring, band, true)))
    .map((wall) => wall.id)
}

// Where a wall's openings are drawn — the stretch of the centre line each takes (`from` → `to`, along the edge) and
// the box across the band (`points`), with the opening and its index in the wall's list.
function openingsOf(wall: Wall): OpeningShape[] {
  return openingShapesOf(wall)
}

// Where an opening `width` wide would go for a point — in the nearest wall edge within `reach` plan units (plus the
// wall's half thickness), centred where the point meets it, kept within the edge and on a whole unit: the wall's id
// and the opening to add to it (`planEdits.addOpening`). `far` when no wall is that near, `short` when the edge is
// shorter than the opening, `taken` when it would cut into an opening already there. The role is yours to add.
function openingAt(
  plan: Pick<SeatPlan, 'walls'>,
  point: PlanPoint,
  width: number,
  reach: number,
): { wall: string; opening: WallOpening } | 'far' | 'short' | 'taken' {
  return openingAtOf(plan.walls, point, width, reach)
}

// The rooms the walls close (see `Room`) — found from the walls each time; nothing about them is stored. A partition
// across a room makes two; an open wall's end within a wall's half thickness of another meets it.
function roomsOf(plan: Pick<SeatPlan, 'walls'>): Room[] {
  return roomsOfWalls(plan.walls)
}

// The innermost room around a point, or null outside every room. Pass the rooms when you have them already.
function roomAt(plan: Pick<SeatPlan, 'walls'> | readonly Room[], point: PlanPoint): Room | null {
  return roomAtOf(isRoomList(plan) ? plan : roomsOfWalls(plan.walls), point)
}

// Rooms found already, not a plan to find them in. `Array.isArray` alone does not narrow a readonly array away.
function isRoomList(plan: Pick<SeatPlan, 'walls'> | readonly Room[]): plan is readonly Room[] {
  return Array.isArray(plan)
}

// The area inside an outline (a room's, a section's) in square plan units.
function areaOf(points: readonly PlanPoint[]): number {
  return Math.abs(signedArea(points))
}

// Next place id — `<section><n>` with n = the highest number any id with that prefix carries + 1. Deleted numbers
// are never reused, so "delete then add" in one editing session cannot silently reconnect to records that
// referenced the old id.
function nextPlaceId(
  plan: Pick<SeatPlan, 'objects' | 'groups'> & Partial<Pick<SeatPlan, 'walls'>>,
  section: string,
): string {
  return `${section}${maxSuffix(plan, new RegExp(`^${escapeRegExp(section)}(\\d+)$`)) + 1}`
}

// Next id for anything but a place — `<prefix>-<n>` (fixtures, labels, groups), with the prefix shortened when
// the id would pass OBJECT_ID_MAX. Callers check place ids against PLACE_ID_MAX themselves — a section id cannot
// be shortened.
function nextObjectId(
  plan: Pick<SeatPlan, 'objects' | 'groups'> & Partial<Pick<SeatPlan, 'walls'>>,
  prefix: string,
): string {
  const number = maxSuffix(plan, new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`)) + 1
  const room = OBJECT_ID_MAX - String(number).length - 1

  if (prefix.length <= room) return `${prefix}-${number}`

  return nextObjectId(plan, prefix.slice(0, Math.max(1, room)))
}

// Fixture label layout — text runs along the long edge (tall fixtures read bottom-to-top), the font follows the
// short edge. Glyph width is estimated from the font size; when the text would not fit or the font would fall
// below the minimum, no label is drawn — the shape still reads. `text` is the consumer's name for the fixture.
function fixtureLabelOf(
  fixture: Pick<Fixture, 'w' | 'h'>,
  text: string | null | undefined,
): { text: string; fontSize: number; vertical: boolean } | null {
  if (!text) return null
  const vertical = fixture.h > fixture.w
  const long = Math.max(fixture.w, fixture.h)
  const short = Math.min(fixture.w, fixture.h)
  const fontSize = Math.min(FIXTURE_LABEL_MAX_FONT, Math.floor(short * 0.6))

  if (fontSize < FIXTURE_LABEL_MIN_FONT || text.length * fontSize + 8 > long) return null

  return { text, fontSize, vertical }
}

// Group label layout — the text centred in the label box, upright, its font half the box's short side within
// reading bounds. `text` is the consumer's name for the group (its `label`, or its id).
function groupLabelOf(
  label: Pick<GroupLabel, 'w' | 'h'>,
  text: string | null | undefined,
): { text: string; fontSize: number } | null {
  if (!text) return null

  return { text, fontSize: groupLabelFont(label) }
}

// A group label's font size in plan units — for the parts, whose label may be any node.
export function groupLabelFont(label: Pick<GroupLabel, 'w' | 'h'>): number {
  return Math.min(GROUP_LABEL_MAX_FONT, Math.max(GROUP_LABEL_MIN_FONT, Math.min(label.w, label.h) * 0.5))
}

// Section crop — bounded by the section's objects rather than its outline, because rooms keep wide empty floor
// that would become empty crop height when crops are stacked on a narrow screen. The outer wall may be clipped
// by the frame; a heading above the crop names the section.
// Places belong to their section. Fixtures and labels have none: one belongs to the section when a place of its
// group does, or else when its centre lies in the outline (a stage on the wall). The crop origin snaps to whole
// cells, so coordinates stay integers. null when the section does not exist.
function sectionPlanOf<S extends string>(plan: SeatPlan<S>, id: S): SeatPlan<S> | null {
  const section = sectionOf(plan, id)

  if (!section) return null
  const places = placesOf(plan)
  const groupsHere = new Set(places.flatMap((p) => (p.section === id && p.group !== undefined ? [p.group] : [])))
  const groupsWithPlaces = new Set(places.flatMap((p) => (p.group === undefined ? [] : [p.group])))

  const objects = plan.objects.filter((object) => {
    if (object.kind === 'place') return object.section === id

    if (object.group !== undefined && groupsWithPlaces.has(object.group)) return groupsHere.has(object.group)

    return polygonContains(section.points, centerOf(object))
  })

  const used = new Set(objects.flatMap((object) => (object.group === undefined ? [] : [object.group])))
  // A section with nothing in it has nothing to crop to — its outline is the bound.
  const bounds = extentOf(objects) ?? sectionBoundsOf(section)
  const x0 = Math.floor((bounds.x - SECTION_PLAN_PADDING) / GRID_CELL) * GRID_CELL
  const y0 = Math.floor((bounds.y - SECTION_PLAN_PADDING) / GRID_CELL) * GRID_CELL
  const width = Math.ceil((bounds.x + bounds.w + SECTION_PLAN_PADDING - x0) / GRID_CELL) * GRID_CELL
  const height = Math.ceil((bounds.y + bounds.h + SECTION_PLAN_PADDING - y0) / GRID_CELL) * GRID_CELL
  // The walls the crop shows some of — cut off by its frame like the rest.
  const frame = { x: x0, y: y0, w: width, h: height }

  return {
    version: 3,
    width,
    height,
    sections: [{ ...section, points: section.points.map((p) => ({ x: p.x - x0, y: p.y - y0 })) }],
    walls: plan.walls.filter((wall) => touches(wallBoundsOf(wall), frame)).map((wall) => moveWall(wall, -x0, -y0)),
    categories: plan.categories,
    groups: plan.groups.filter((group) => used.has(group.id)),
    objects: objects.map((object) => translate(object, -x0, -y0)),
  }
}

// One crop per section in left-to-right plan order, all padded to the widest crop. Renderers fill their width,
// so equal widths mean equal scale — otherwise a narrow section would be stretched to a wide one's width and
// seat sizes would differ between crops. Padding is added on both sides in GRID_CELL steps only.
function sectionPlansOf<S extends string>(plan: SeatPlan<S>): SectionPlan<S>[] {
  const cropped: SectionPlan<S>[] = []
  const ordered = [...plan.sections].sort((a, b) => sectionBoundsOf(a).x - sectionBoundsOf(b).x)

  for (const section of ordered) {
    const sectionPlan = sectionPlanOf(plan, section.id)

    if (sectionPlan) cropped.push({ id: section.id, plan: sectionPlan })
  }

  if (cropped.length === 0) return []

  const width = Math.max(...cropped.map((entry) => entry.plan.width))

  return cropped.map(({ id, plan: sectionPlan }) => {
    const left = Math.floor((width - sectionPlan.width) / 2 / GRID_CELL) * GRID_CELL

    return {
      id,
      plan: {
        ...sectionPlan,
        width,
        sections: sectionPlan.sections.map((s) => ({ ...s, points: s.points.map((p) => ({ x: p.x + left, y: p.y })) })),
        walls: sectionPlan.walls.map((wall) => moveWall(wall, left, 0)),
        objects: sectionPlan.objects.map((object) => translate(object, left, 0)),
      },
    }
  })
}

// The objects whose shape touches a rectangle — marquee selection. Every kind included.
function objectsInRect(plan: Pick<SeatPlan, 'objects'>, rect: PlanRect): string[] {
  const band = outlineOf(rect, 'rect')

  return plan.objects
    .filter((object) => polygonsOverlap(outlineOfObject(object), band, true))
    .map((object) => object.id)
}

// The painted band of a wall fixture — INNER_WALL_THICKNESS centred along the long edge (local coordinates).
function innerWallOf(fixture: Pick<Fixture, 'w' | 'h'>): PlanRect {
  const thickness = Math.min(INNER_WALL_THICKNESS, fixture.w, fixture.h)

  return fixture.w >= fixture.h
    ? { x: 0, y: (fixture.h - thickness) / 2, w: fixture.w, h: thickness }
    : { x: (fixture.w - thickness) / 2, y: 0, w: thickness, h: fixture.h }
}

// A group label is a text box — it tests as a rectangle.
function shapeOf(object: PlanObject): Shape {
  return object.kind === 'label' ? 'rect' : object.shape
}

function centerOf(box: PlanRect): PlanPoint {
  return centerOfBox(box)
}

// The object's outline in plan coordinates — the turned rectangle's corners (nw, ne, se, sw of the unturned box),
// or a polygon inscribed in the ellipse.
function outlineOfObject(object: PlanObject): PlanPoint[] {
  return outlineOf(object, shapeOf(object))
}

// The axis-aligned rectangle around what an object draws — turned shapes included.
function boundsOf(object: PlanObject): PlanRect {
  return boundsOfBox(object, shapeOf(object))
}

// What ids cover — each object's bounds, a group's members' — for zooming to what a list of problems or a search
// points at. Unknown ids cover nothing.
function boundsOfIds(plan: Pick<SeatPlan, 'objects' | 'groups'>, ids: readonly string[]): PlanRect[] {
  return ids.flatMap((id) => {
    const object = objectById(plan, id)

    return (object ? [object] : groupById(plan, id) ? membersOf(plan, id) : []).map(boundsOf)
  })
}

// Ids in the order their centres come along a direction (degrees clockwise from +x: 0 left to right, 90 top to
// bottom) — a group by the centre of its frame. Label seats or rows in the order people read them, whatever order
// the document holds them in. Ties keep the order given; unknown ids are left out.
function orderAlong(plan: Pick<SeatPlan, 'objects' | 'groups'>, ids: readonly string[], degrees = 0): string[] {
  const a = (degrees * Math.PI) / 180
  const along = { x: Math.cos(a), y: Math.sin(a) }

  return ids
    .flatMap((id) => {
      const group = objectById(plan, id) ? undefined : groupById(plan, id)
      const box = group ? frameOf(membersOf(plan, id), group.rotation ?? 0) : (objectById(plan, id) ?? null)

      if (!box) return []
      const c = centerOf(box)

      // Rounded, so centres level in that direction tie instead of being ordered by a trigonometric crumb.
      return [{ id, at: Math.round((c.x * along.x + c.y * along.y) * 1000) / 1000 }]
    })
    .sort((p, q) => p.at - q.at)
    .map((item) => item.id)
}

// The rectangle around several objects, or null when there are none.
function extentOf(objects: readonly PlanObject[]): PlanRect | null {
  return unionBounds(objects.map(boundsOf))
}

// The box around several objects, level in the direction `rotation` faces — a group's frame. Unlike their extent
// (the level box around them), it turns with them: turning the objects and the direction together about the
// frame's centre leaves the centre where it was. null when there are no objects.
function frameOf(objects: readonly PlanObject[], rotation = 0): PlanBox | null {
  const points = objects.flatMap(outlineOfObject).map((p) => rotatePoint(p, ORIGIN, -rotation))

  if (points.length === 0) return null
  const local = boundsOfPoints(points)
  const center = rotatePoint({ x: local.x + local.w / 2, y: local.y + local.h / 2 }, ORIGIN, rotation)
  const box = { x: center.x - local.w / 2, y: center.y - local.h / 2, w: local.w, h: local.h }

  return rotation ? { ...box, rotation } : box
}

const ORIGIN: PlanPoint = { x: 0, y: 0 }

// Whether a plan point lies on an object (its edge included).
function contains(object: PlanObject, point: PlanPoint): boolean {
  return boxContains(object, shapeOf(object), point)
}

// Whether two objects cut into each other by more than OVERLAP_TOLERANCE — touching is not overlapping.
function overlaps(a: PlanObject, b: PlanObject): boolean {
  const inset = OVERLAP_TOLERANCE / 2

  return polygonsOverlap(outlineOf(a, shapeOf(a), inset), outlineOf(b, shapeOf(b), inset))
}

// Places that overlap — the rule the schema refuses to save and the editor marks while you drag. Fixtures and
// labels may overlap anything (a chair at its desk, a stage behind the front row). Pairs are in document order.
function conflictsOf(plan: Pick<SeatPlan, 'objects'>): [string, string][] {
  const places = placesOf(plan)
  const order = new Map(places.map((place, i) => [place.id, i]))
  const byId = new Map(places.map((place) => [place.id, place]))
  const index = spatialIndex.create(places.map((place) => ({ id: place.id, bounds: boundsOf(place) })))
  const overlapping: [string, string][] = []

  for (const place of places) {
    for (const other of spatialIndex.query(index, boundsOf(place))) {
      // Each pair once — from its earlier place.
      if (order.get(other.id)! <= order.get(place.id)!) continue

      if (overlaps(place, byId.get(other.id)!)) overlapping.push([place.id, other.id])
    }
  }

  return overlapping.sort((p, q) => order.get(p[1])! - order.get(q[1])! || order.get(p[0])! - order.get(q[0])!)
}

// The same object moved by (dx, dy).
function translate<O extends PlanBox>(object: O, dx: number, dy: number): O {
  return { ...object, x: object.x + dx, y: object.y + dy }
}

// Whether section names are drawn on the plan — not on a single-section crop, where there is nothing to tell
// apart and a heading outside the drawing says it louder.
function showsSectionLabels(plan: Pick<SeatPlan, 'sections'>): boolean {
  return plan.sections.length > 1
}

// The drawn extent — the outer wall reaches past the document size, so do walls whose centre line runs along its
// edge, and labelled plans gain the name band on top. Fit views and the SVG viewBox use this; object coordinates are
// unchanged.
function drawingBoundsOf(
  plan: Pick<SeatPlan, 'width' | 'height' | 'sections'> & Partial<Pick<SeatPlan, 'walls'>>,
): PlanRect {
  const top = showsSectionLabels(plan) ? SECTION_LABEL_BAND : DRAWING_MARGIN

  const paper = {
    x: -DRAWING_MARGIN,
    y: -top,
    w: plan.width + DRAWING_MARGIN * 2,
    h: plan.height + top + DRAWING_MARGIN,
  }

  const walls = wallsBoundsOf(plan.walls ?? [])

  return walls ? unionBounds([paper, walls])! : paper
}

// The same wall moved by (dx, dy).
function moveWall(wall: Wall, dx: number, dy: number): Wall {
  return { ...wall, points: wall.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
}

function touches(a: PlanRect, b: PlanRect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

function maxSuffix(
  plan: Pick<SeatPlan, 'objects' | 'groups'> & Partial<Pick<SeatPlan, 'walls'>>,
  pattern: RegExp,
): number {
  return idsOf(plan).reduce((acc, id) => {
    const match = pattern.exec(id)

    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
