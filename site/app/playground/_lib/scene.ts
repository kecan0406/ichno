import {
  SECTION_LABEL_BAND,
  SECTION_LABEL_FONT,
  WALL_THICKNESS,
  seatPlan,
  type Fixture,
  type Place,
  type PlanPoint,
  type SeatPlan,
  type Shape,
} from 'ichno'

// The playground's 3D reading of a document, for its 3D preview (../_components/preview-3d.tsx). ichno stores
// footprints — a box on the floor, a turn, a role word — and nothing upward: how tall a stage is, which way a chair
// faces and where a guest's eyes are are this site's reading of its own roles (./build.ts, ../../_demo/plans.ts).
// An app with a 3D view writes its own. The plan's x and y lie on the floor (y becomes z); heights are plan units.

type Plan = SeatPlan<string>
type Thing = Place<string> | Fixture

// Plan units have no size. This site draws a seat 36 units wide — 45 cm — so a metre is 80.
export const METRE = 80

// What stands on a footprint, by the role this site gave it. A role it does not know stands as a plain block.
export type Model =
  | 'chair'
  | 'sofa'
  | 'table'
  | 'coffee'
  | 'desk'
  | 'booth'
  | 'area'
  | 'stage'
  | 'screen'
  | 'bar'
  | 'door'
  | 'pillar'
  | 'block'

const PLACE_MODELS: Record<string, Model> = {
  seat: 'chair',
  sofa: 'sofa',
  table: 'table',
  desk: 'desk',
  booth: 'booth',
  area: 'area',
}

const FIXTURE_MODELS: Record<string, Model> = {
  chair: 'chair',
  table: 'table',
  coffee: 'coffee',
  stage: 'stage',
  screen: 'screen',
  bar: 'bar',
  door: 'door',
  pillar: 'pillar',
}

// How tall each model stands.
export const HEIGHT: Record<Model, number> = {
  chair: 0.9 * METRE,
  sofa: 0.8 * METRE,
  table: 0.76 * METRE,
  coffee: 0.4 * METRE,
  desk: 0.76 * METRE,
  booth: 1.2 * METRE,
  area: 0.15 * METRE,
  stage: 0.9 * METRE,
  screen: 3.2 * METRE,
  bar: 1.1 * METRE,
  door: 2.1 * METRE,
  pillar: 3 * METRE,
  block: 0.9 * METRE,
}

// Where a screen's picture starts.
export const SCREEN_BOTTOM = 1 * METRE
// Walls in full, and cut down while the camera is up high, so it sees into the rooms.
export const WALL_HEIGHT = 2.8 * METRE
export const WALL_CUT = 0.5 * METRE
// How high a group's label stands as a sign.
export const SIGN_HEIGHT = 0.95 * METRE
const SEATED_EYE = 1.2 * METRE
const STANDING_EYE = 1.6 * METRE

// What people sit on, what they gather round, and what a room looks at.
const SEATING = new Set<Model>(['chair', 'sofa'])
const SURFACES = new Set<Model>(['table', 'desk', 'coffee'])
const FOCI = new Set<Model>(['stage', 'screen'])

// One thing on the floor: the centre of its footprint, its size across (`w`) and along (`d`) the way it faces, and
// which way that is — `yaw`, in radians about the vertical: 0 toward the top of the plan, counterclockwise seen
// from above. `place` is set when it can be booked.
export type Piece = {
  id: string
  model: Model
  shape: Shape
  x: number
  z: number
  w: number
  d: number
  yaw: number
  group: string | undefined
  place: Place<string> | null
}

// A wall as a box on the floor, cut down with the rest in the overview. `id` is the wall fixture it is drawn for
// (none for a section's outline).
export type Wall = { x: number; z: number; w: number; d: number; yaw: number; id?: string }

// Text in the room: `flat` lies on a surface (a fixture's name on its top), `face` stands on a screen, `sign` always
// turns to the camera (a section's name, a group's label). `size` is the height of a line; `tone` the theme colour
// the 2D view writes it in. `overhead` text stands on the cut-down walls, so it shows only while they are cut.
export type Writing = {
  text: string
  lie: 'flat' | 'face' | 'sign'
  tone: 'ink' | 'label'
  x: number
  y: number
  z: number
  size: number
  yaw: number
  anchor: 'start' | 'middle'
  overhead: boolean
  // Where and how the 2D view writes it, seen from straight above: the middle of its line (its start, for `anchor:
  // 'start'`) at `y` — upright text lies down there — its size and turn. The 3D views bring each text toward this as
  // the camera looks down; straight down they write what the 2D view writes, so switching views changes no text.
  plan: { x: number; y: number; z: number; size: number; yaw: number }
}

export type Point3 = { x: number; y: number; z: number }

// Where a guest's eyes are at a place, and what they look at.
export type Sight = { eye: Point3; look: Point3 }

// Where the camera first looks from: over the middle of the drawing (`w` × `h`, `radius` its reach), from `azimuth`
// (radians, 0 from the bottom of the plan) — the audience's side of the biggest stage or screen, or the bottom of
// the plan.
export type Overview = { x: number; z: number; w: number; h: number; radius: number; azimuth: number }

// Everything but walls and group labels, in drawing order.
export function piecesOf(plan: Plan): Piece[] {
  const things = plan.objects.filter((object): object is Thing => object.kind !== 'label' && object.role !== 'wall')
  const models = new Map(things.map((thing) => [thing.id, modelOf(thing)]))
  const members = new Map<string, Thing[]>()
  for (const thing of things) {
    if (thing.group === undefined) continue
    const list = members.get(thing.group)
    if (list) list.push(thing)
    else members.set(thing.group, [thing])
  }
  return things.map((thing) => {
    const model = models.get(thing.id)!
    const center = seatPlan.centerOf(thing)
    const turn = -radians(thing.rotation ?? 0)
    const target = targetOf(plan, thing, model, members, models)
    const toward = target === null ? null : yawToward(center, target)
    // Seating keeps to quarter turns of its box, so it stands on the footprint the plan shows.
    const quarter = toward === null ? 0 : Math.round(angleBetween(turn, toward) / (Math.PI / 2))
    const across = Math.abs(quarter) % 2 === 1
    return {
      id: thing.id,
      model,
      shape: thing.shape,
      x: center.x,
      z: center.y,
      w: across ? thing.h : thing.w,
      d: across ? thing.w : thing.h,
      yaw: turn + (quarter * Math.PI) / 2,
      group: thing.group,
      place: thing.kind === 'place' ? thing : null,
    }
  })
}

// Every section's outer wall, a box per side on the outline the 2D view strokes, and the band a wall fixture paints.
export function wallsOf(plan: Plan): Wall[] {
  const outer = plan.sections.flatMap((section) => {
    const points = seatPlan.sectionWallOf(section)
    return points.map((a, i): Wall => {
      const b = points[(i + 1) % points.length]!
      // Each side runs half a wall past its corners, so neighbouring sides close them.
      return {
        x: (a.x + b.x) / 2,
        z: (a.y + b.y) / 2,
        w: Math.hypot(b.x - a.x, b.y - a.y) + WALL_THICKNESS,
        d: WALL_THICKNESS,
        yaw: -Math.atan2(b.y - a.y, b.x - a.x),
      }
    })
  })
  const inner = plan.objects.flatMap((object): Wall[] => {
    if (object.kind !== 'fixture' || object.role !== 'wall') return []
    const band = seatPlan.innerWallOf(object)
    const center = seatPlan.centerOf(object)
    const at = turned(
      { x: object.x + band.x + band.w / 2, y: object.y + band.y + band.h / 2 },
      center,
      object.rotation ?? 0,
    )
    return [{ x: at.x, z: at.y, w: band.w, d: band.h, yaw: -radians(object.rotation ?? 0), id: object.id }]
  })
  return [...outer, ...inner]
}

// What the 2D view writes, placed in the room: section names on the top-left corner of their walls (the site names
// its sections, so the 2D view writes them even for one), fixture names on the fixture (the names `fixtureName`
// gives, turned like the 2D view's, and larger — the room is seen from further off), group labels as signs at their
// label boxes. Each carries where the 2D view writes it (`plan`).
export function writingOf(
  plan: Plan,
  pieces: readonly Piece[],
  sectionName: (id: string) => string,
  fixtureName: (fixture: Fixture) => string | null,
): Writing[] {
  const sections = plan.sections.map((section): Writing => {
    const bounds = seatPlan.sectionBoundsOf(section)
    const x = bounds.x - WALL_THICKNESS
    return {
      text: sectionName(section.id),
      lie: 'sign',
      tone: 'ink',
      x,
      y: WALL_CUT + 6,
      z: bounds.y - WALL_THICKNESS,
      size: SECTION_LABEL_FONT * 1.4,
      yaw: 0,
      anchor: 'start',
      overhead: true,
      // In the name band above the outline, its line starting 10 units below the band's top.
      plan: {
        x,
        y: WALL_CUT + 6,
        z: bounds.y - SECTION_LABEL_BAND + 10 + SECTION_LABEL_FONT / 2,
        size: SECTION_LABEL_FONT,
        yaw: 0,
      },
    }
  })
  const byId = new Map(pieces.map((piece) => [piece.id, piece]))
  const fixtures = plan.objects.flatMap((object): Writing[] => {
    if (object.kind !== 'fixture') return []
    const piece = byId.get(object.id)
    const layout = piece ? seatPlan.fixtureLabelOf(object, fixtureName(object)) : null
    if (!piece || !layout) return []
    const long = Math.max(object.w, object.h)
    // Tall fixtures read bottom to top, like the 2D view.
    const yaw = -radians(object.rotation ?? 0) + (layout.vertical ? Math.PI / 2 : 0)
    const top = piece.model === 'door' ? 1 : HEIGHT[piece.model] + 1
    const written = { x: piece.x, y: top, z: piece.z, size: layout.fontSize, yaw }
    if (piece.model === 'screen') {
      // On the picture, facing the room.
      const out = piece.d / 2 + 1
      return [
        {
          text: layout.text,
          lie: 'face',
          tone: 'label',
          x: piece.x - Math.sin(piece.yaw) * out,
          y: (SCREEN_BOTTOM + HEIGHT.screen) / 2,
          z: piece.z - Math.cos(piece.yaw) * out,
          size: fitted(layout.text, long, (HEIGHT.screen - SCREEN_BOTTOM) * 0.3),
          yaw: piece.yaw,
          anchor: 'middle',
          overhead: false,
          plan: written,
        },
      ]
    }
    return [
      {
        text: layout.text,
        lie: 'flat',
        tone: 'label',
        x: piece.x,
        // A door's name is on the floor between its posts; everything else's on its top.
        y: top,
        z: piece.z,
        size: Math.max(layout.fontSize, fitted(layout.text, long, Math.min(object.w, object.h) * 0.4)),
        yaw,
        anchor: 'middle',
        overhead: false,
        plan: written,
      },
    ]
  })
  const groups = plan.objects.flatMap((object): Writing[] => {
    if (object.kind !== 'label') return []
    const group = seatPlan.groupById(plan, object.group)
    const center = seatPlan.centerOf(object)
    const layout = seatPlan.groupLabelOf(object, group?.label ?? object.group)
    if (!layout) return []
    return [
      {
        text: layout.text,
        lie: 'sign',
        tone: 'label',
        x: center.x,
        y: SIGN_HEIGHT,
        z: center.y,
        size: Math.max(12, Math.min(object.w, object.h) * 0.6),
        yaw: 0,
        anchor: 'middle',
        overhead: false,
        plan: { x: center.x, y: SIGN_HEIGHT, z: center.y, size: layout.fontSize, yaw: 0 },
      },
    ]
  })
  return [...sections, ...fixtures, ...groups]
}

// The view from a place. A guest at a desk or a table booked whole sits on its chair; seats, sofas and those chairs
// are sat on, everything else is stood at. Guests look at the stage or screen of their section (the nearest), or
// else ahead of them when seated, or into the middle of their section. Null when the plan has no such place.
export function sightFrom(plan: Plan, pieces: readonly Piece[], id: string): Sight | null {
  const own = pieces.find((piece) => piece.id === id)
  if (!own?.place) return null
  const chair =
    own.model === 'desk' || own.model === 'table'
      ? pieces.find((piece) => piece.group !== undefined && piece.group === own.group && piece.model === 'chair')
      : undefined
  const spot = chair ?? own
  const seated = SEATING.has(spot.model)
  const eye = { x: spot.x, y: seated ? SEATED_EYE : STANDING_EYE, z: spot.z }
  const section = own.place.section
  const focus = pieces
    .filter((piece) => FOCI.has(piece.model) && seatPlan.sectionAt(plan, { x: piece.x, y: piece.z }) === section)
    .sort((a, b) => distance(eye, a) - distance(eye, b))[0]
  if (focus) {
    const y = focus.model === 'screen' ? (SCREEN_BOTTOM + HEIGHT.screen) / 2 : HEIGHT.stage + 0.8 * METRE
    return { eye, look: { x: focus.x, y, z: focus.z } }
  }
  const middle = middleOf(plan, section)
  if (!seated && middle && distance(eye, { x: middle.x, z: middle.y }) > METRE) {
    return { eye, look: { x: middle.x, y: METRE, z: middle.y } }
  }
  // Ahead, and a little down.
  const reach = 3 * METRE
  return {
    eye,
    look: { x: eye.x - Math.sin(spot.yaw) * reach, y: 0.8 * METRE, z: eye.z - Math.cos(spot.yaw) * reach },
  }
}

export function overviewOf(plan: Plan, pieces: readonly Piece[]): Overview {
  const bounds = seatPlan.drawingBoundsOf(plan)
  const focus = pieces.filter((piece) => FOCI.has(piece.model)).sort((a, b) => b.w * b.d - a.w * a.d)[0]
  return {
    x: bounds.x + bounds.w / 2,
    z: bounds.y + bounds.h / 2,
    w: bounds.w,
    h: bounds.h,
    radius: Math.hypot(bounds.w, bounds.h) / 2,
    // From the side the focus faces — its audience.
    azimuth: focus ? focus.yaw + Math.PI : 0,
  }
}

function modelOf(thing: Thing): Model {
  const models = thing.kind === 'place' ? PLACE_MODELS : FIXTURE_MODELS
  return (thing.role === undefined ? undefined : models[thing.role]) ?? 'block'
}

// What a piece turns to face, if anything: seating the nearest table, desk or coffee table of its group, a stage or
// screen the middle of its section. Anything else — a row's seats too — faces the way its box is turned: this site
// draws rows facing the left of the direction they were drawn in.
function targetOf(
  plan: Plan,
  thing: Thing,
  model: Model,
  members: ReadonlyMap<string, Thing[]>,
  models: ReadonlyMap<string, Model>,
): PlanPoint | null {
  const center = seatPlan.centerOf(thing)
  if (SEATING.has(model)) {
    const surfaces = (thing.group === undefined ? [] : (members.get(thing.group) ?? []))
      .filter((other) => other !== thing && SURFACES.has(models.get(other.id)!))
      .map(seatPlan.centerOf)
      .sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y))
    return surfaces[0] ?? null
  }
  if (FOCI.has(model)) {
    const section = seatPlan.sectionAt(plan, center)
    return section === null ? null : middleOf(plan, section)
  }
  return null
}

// A size for `text` that keeps it to most of `long` (bold letters run about 0.62 of their size) and at most `most`.
function fitted(text: string, long: number, most: number): number {
  return Math.min(most, (long * 0.8) / (0.62 * text.length))
}

function middleOf(plan: Plan, section: string): PlanPoint | null {
  const found = seatPlan.sectionOf(plan, section)
  return found ? seatPlan.centerOf(seatPlan.sectionBoundsOf(found)) : null
}

// The yaw that faces `to` from `from`; null when they are the same point.
function yawToward(from: PlanPoint, to: PlanPoint): number | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  return dx === 0 && dy === 0 ? null : Math.atan2(-dx, -dy)
}

// The turn from `a` to `b`, between −π and π.
function angleBetween(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a))
}

// `point` turned clockwise (y down) by `degrees` about `center` — the way the plan turns boxes.
function turned(point: PlanPoint, center: PlanPoint, degrees: number): PlanPoint {
  const a = radians(degrees)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return { x: center.x + dx * Math.cos(a) - dy * Math.sin(a), y: center.y + dx * Math.sin(a) + dy * Math.cos(a) }
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}
