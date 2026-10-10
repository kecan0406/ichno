import type { PlanPoint, PlanSize, PlanTemplate, SeatPlan, Shape } from 'ichno'
import { planEdits, type EditorTool } from 'ichno/editor'
import { fixtureTool, openingRefusal, openingTool, placeTool, roomTool, wallPieceRefusal, wallPieceTool } from './build'
import type { SavedObject } from './library'

// The playground's own objects — one ichno place or fixture each, with a role this site gave it (./build.ts), the
// way an app makes its own. ichno ships none of them. A drag sizes one and a tap drops the standard one; grouping
// them into rows and tables is left to whoever draws them.

// Something the playground can place — its name, the key that picks it (`key` as shown, `code` the physical key),
// what the hint says while it is picked, the ichno tool that places it, one dropped at its standard size (none for a
// wall) and, for a tool that can refuse, why it makes nothing where the pointer is — said while the sample is drawn
// there in the colour of what cannot be had.
export type ToolDef<Id extends string = string> = {
  id: Id
  name: string
  key: string
  code: string
  hint: string
  tool: EditorTool<string>
  sample: PlanTemplate | null
  why?(plan: SeatPlan<string>, at: PlanPoint): string
}

export type PlaygroundObject = ToolDef & {
  shelf: 'places' | 'fixtures' | 'structure'
  // Its thumbnail, and what it is made of.
  sample: PlanTemplate
}

const BOX_KEYS = 'Shift: square · Alt: from the centre.'

const NOWHERE = 'Places go on the plan — move onto it to place one.'

const OPENING_REASONS = {
  far: 'A door goes in a wall — move onto one.',
  short: 'This wall is too short for a door.',
  taken: 'There is a door here already.',
} as const

const PIECE_REASONS = {
  outside: 'Walls go on the plan — move onto it.',
  taken: 'There is a wall here already — turn the piece (wheel or R) or move on.',
} as const

// How thick walls are built — 15 cm.
const WALL_THICKNESS = 15

// How far the wheel or R turns the next wall piece — ⇧ for the fine step.
export const PIECE_TURN = 15

export const PIECE_FINE_TURN = 5

// A scratch plan to drop each object on once, for its sample.
const SCRATCH: SeatPlan<string> = {
  version: 3,
  width: 1600,
  height: 1600,
  sections: [{ id: '_', points: square(1600) }],
  walls: [],
  categories: [],
  groups: [],
  objects: [],
}

// What a tool drops with a tap on the scratch plan, kept as a template — its thumbnail, and its ghost.
function sampleOf(create: EditorTool<string>['create']): PlanTemplate {
  const at = { x: SCRATCH.width / 2, y: SCRATCH.height / 2 }
  const made = create(SCRATCH, { start: at, end: at })!

  return planEdits.templateOf(
    made,
    made.objects.map((o) => o.id),
  )!.template
}

// An object drawn with a tool. `sample` drops one where the tool would need more around it — a door needs a wall, so
// its thumbnail is a box the size of one.
function drawn({
  id,
  shelf,
  name,
  digit,
  hint,
  draw,
  create,
  why,
  sample = create,
}: Pick<PlaygroundObject, 'id' | 'shelf' | 'name' | 'hint'> &
  Pick<EditorTool<string>, 'draw' | 'create'> & {
    digit?: number
    why?: ToolDef['why']
    sample?: EditorTool<string>['create']
  }) {
  const keys = digit === undefined ? { key: '', code: '' } : { key: String(digit), code: `Digit${digit}` }

  return {
    id,
    shelf,
    name,
    ...keys,
    hint,
    tool: { id, draw, create },
    sample: sampleOf(sample),
    why,
  } satisfies PlaygroundObject
}

// An object someone saved, as a tool — it follows the pointer, and a tap puts it down.
export function savedObjectTool(saved: SavedObject): ToolDef {
  const id = `saved:${saved.id}`

  return {
    id,
    name: saved.name,
    key: '',
    code: '',
    hint: `Tap to place “${saved.name}”.`,
    tool: {
      id,
      draw: 'point',
      create: (plan, stroke) => planEdits.insertTemplate(plan, saved.template, stroke.end)?.plan ?? null,
    },
    sample: saved.template,
    why: nowhere,
  }
}

// What stops the place tools: the places they make go on the plan.
function nowhere(): string {
  return NOWHERE
}

// Places and fixtures are the app's words — these are this site's, at their real sizes (a unit is a centimetre).
const PLACES: { role: string; name: string; size: PlanSize; capacity?: number }[] = [
  { role: 'seat', name: 'Seat', size: { w: 45, h: 45 } },
  { role: 'desk', name: 'Desk', size: { w: 120, h: 60 } },
  { role: 'sofa', name: 'Sofa', size: { w: 180, h: 85 }, capacity: 3 },
  { role: 'booth', name: 'Booth', size: { w: 180, h: 120 } },
  { role: 'area', name: 'Standing area', size: { w: 300, h: 150 } },
]

// A door is an opening put in a wall, as wide as the box it is drawn as; the rest are drawn as boxes.
const FIXTURES: {
  role: string
  name: string
  size: PlanSize
  shape?: Shape
}[] = [
  { role: 'table', name: 'Round table', size: { w: 120, h: 120 }, shape: 'ellipse' },
  { role: 'table', name: 'Square table', size: { w: 80, h: 80 } },
  { role: 'chair', name: 'Chair', size: { w: 45, h: 45 } },
  { role: 'coffee', name: 'Coffee table', size: { w: 100, h: 50 } },
  { role: 'stage', name: 'Stage', size: { w: 600, h: 300 } },
  { role: 'screen', name: 'Screen', size: { w: 500, h: 20 } },
  { role: 'bar', name: 'Bar', size: { w: 400, h: 60 } },
  { role: 'pillar', name: 'Pillar', size: { w: 50, h: 50 } },
]

// The Wall tool turned `degrees` clockwise from the right — the toolbar's Wall, as the wheel and R turn it. It stays
// picked, a piece at every click, until it is put down.
export function wallPiece(degrees: number): ToolDef<'wall'> {
  const turn = ((degrees % 360) + 360) % 360

  return {
    id: 'wall',
    name: 'Wall',
    key: 'W',
    code: 'KeyW',
    hint:
      `Turned ${turn}° — click to put up a metre of wall; beside a wall’s end it carries that wall on, back at its ` +
      `start it closes a room. The wheel or R turns it ${PIECE_TURN}° (⇧ ${PIECE_FINE_TURN}°).`,
    tool: { id: 'wall', draw: 'point', create: wallPieceTool(WALL_THICKNESS, turn), keep: true, snap: false },
    sample: null,
    why: (plan, at) => PIECE_REASONS[wallPieceRefusal(plan, at, turn)],
  }
}

export type PrimitiveId = 'place' | 'fixture' | 'wall'

// ichno's own primitives as the toolbar's tools — a place (something to book) and a fixture (anything else), each a
// bare box, and a wall, put up a metre at a time; rooms close where walls meet. What they are for — a role, a capacity,
// a category, a wall's thickness — is set in Design once they are drawn.
export const PRIMITIVE_TOOLS: ToolDef<PrimitiveId>[] = [
  {
    id: 'place',
    name: 'Place',
    key: 'P',
    code: 'KeyP',
    hint: `Drag to draw a place, tap for a seat. ${BOX_KEYS}`,
    tool: { id: 'place', draw: 'box', create: placeTool(undefined, { w: 45, h: 45 }) },
    sample: sampleOf(placeTool(undefined, { w: 45, h: 45 })),
    why: nowhere,
  },
  {
    id: 'fixture',
    name: 'Fixture',
    key: 'F',
    code: 'KeyF',
    hint: `Drag to draw a fixture — nothing to book. ${BOX_KEYS}`,
    tool: { id: 'fixture', draw: 'box', create: fixtureTool(undefined, { w: 100, h: 100 }) },
    sample: sampleOf(fixtureTool(undefined, { w: 100, h: 100 })),
  },
  wallPiece(0),
]

export const PLAYGROUND_OBJECTS: PlaygroundObject[] = [
  ...PLACES.map(({ role, name, size, capacity }, i) =>
    drawn({
      id: `place:${role}`,
      shelf: 'places',
      name,
      digit: i + 1,
      hint: `Drag to draw the ${name.toLowerCase()}. Tap for the standard one. ${BOX_KEYS}`,
      draw: 'box',
      create: placeTool(role, size, { capacity }),
      why: nowhere,
    }),
  ),
  ...FIXTURES.map(({ role, name, size, shape }) =>
    drawn({
      id: `fixture:${name.toLowerCase().replace(/ /g, '-')}`,
      shelf: 'fixtures',
      name,
      hint: `Drag to draw the ${name.toLowerCase()}. Tap for the standard one. ${BOX_KEYS}`,
      draw: 'box',
      create: fixtureTool(role, size, { shape }),
    }),
  ),
  // The building: a room is one closed wall on the metre grid, a door an opening in a wall. Their thumbnails are boxes
  // the size of one — a template holds no walls.
  drawn({
    id: 'structure:room',
    shelf: 'structure',
    name: 'Room',
    hint:
      'Drag a room on the metre grid, or tap its corners and tap the first (or press Enter) to close it. Type a ' +
      'length and press Enter for the next edge. ⌫ takes a corner back. Shift: square, 15° edges.',
    draw: 'path',
    create: roomTool(WALL_THICKNESS),
    sample: fixtureTool('room', { w: 300, h: 300 }),
  }),
  drawn({
    id: 'structure:door',
    shelf: 'structure',
    name: 'Door',
    hint: 'Tap a wall to put a door in it — the wall opens there.',
    draw: 'point',
    create: openingTool(90, 'door'),
    why: (plan, at) => OPENING_REASONS[openingRefusal(plan, at, 90) ?? 'far'],
    sample: fixtureTool('door', { w: 90, h: WALL_THICKNESS }),
  }),
]

function square(size: number) {
  return [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ]
}
