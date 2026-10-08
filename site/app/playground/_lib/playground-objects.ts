import type { PlanPoint, PlanSize, PlanTemplate, SeatPlan, Shape } from 'ichno'
import { planEdits, type EditorTool } from 'ichno/editor'
import { doorTool, fixtureTool, placeTool, sectionTool } from './build'
import type { SavedObject } from './library'
import { doorAt } from './walls'

// The playground's own objects — one ichno place or fixture each, with a role this site gave it (./build.ts), the
// way an app makes its own. ichno ships none of them. A drag sizes one and a tap drops the standard one; grouping
// them into rows and tables is left to whoever draws them.

// Something the playground can place — its name, the key that picks it (`key` as shown, `code` the physical key),
// what the hint says while it is picked, the ichno tool that places it, one dropped at its standard size (none for a
// section) and, for a tool that can refuse, why it makes nothing where the pointer is — said while the sample is drawn
// there in the colour of what cannot be had.
export type ToolDef = {
  id: string
  name: string
  key: string
  code: string
  hint: string
  tool: EditorTool<string>
  sample: PlanTemplate | null
  why?(plan: SeatPlan<string>, at: PlanPoint): string
}

export type PlaygroundObject = ToolDef & {
  shelf: 'places' | 'fixtures'
  // Its thumbnail, and what it is made of.
  sample: PlanTemplate
}

const BOX_KEYS = 'Shift: square · Alt: from the centre.'
const LINE_KEYS = 'Shift: 15° steps · Alt: from the centre.'
const NOWHERE = 'Every place belongs to a section — move inside one to place it.'
const NO_WALL = 'A door goes in a wall — move onto a wall or the edge of a section.'
const SHORT_WALL = 'This wall is too short for a door.'

// A scratch plan to drop each object on once, for its sample.
const SCRATCH: SeatPlan<string> = {
  version: 3,
  width: 1600,
  height: 1600,
  sections: [{ id: '_', points: square(1600) }],
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

// An object drawn with a tool. `sample` drops one where the tool would need more around it (a door needs a wall).
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

// What stops most tools: the places they make need a section.
function nowhere(): string {
  return NOWHERE
}

// Places and fixtures are the app's words — these are this site's.
const PLACES: { role: string; name: string; size: PlanSize; capacity?: number }[] = [
  { role: 'seat', name: 'Seat', size: { w: 36, h: 36 } },
  { role: 'desk', name: 'Desk', size: { w: 88, h: 60 } },
  { role: 'sofa', name: 'Sofa', size: { w: 138, h: 46 }, capacity: 3 },
  { role: 'booth', name: 'Booth', size: { w: 184, h: 138 } },
  { role: 'area', name: 'Standing area', size: { w: 276, h: 138 } },
]

// A wall is drawn along a line, a door put in a wall (as deep as a wall fixture is thick, so it stands across the band
// one paints); the rest are drawn as boxes.
const FIXTURES: {
  role: string
  name: string
  size: PlanSize
  shape?: Shape
  draw?: 'line' | 'wall'
}[] = [
  { role: 'table', name: 'Round table', size: { w: 92, h: 92 }, shape: 'ellipse' },
  { role: 'table', name: 'Square table', size: { w: 70, h: 70 } },
  { role: 'chair', name: 'Chair', size: { w: 36, h: 36 } },
  { role: 'coffee', name: 'Coffee table', size: { w: 92, h: 46 } },
  { role: 'stage', name: 'Stage', size: { w: 414, h: 115 } },
  { role: 'screen', name: 'Screen', size: { w: 460, h: 46 } },
  { role: 'bar', name: 'Bar', size: { w: 368, h: 69 } },
  { role: 'wall', name: 'Wall', size: { w: 23, h: 230 }, draw: 'line' },
  { role: 'door', name: 'Door', size: { w: 92, h: 23 }, draw: 'wall' },
  { role: 'pillar', name: 'Pillar', size: { w: 46, h: 46 } },
]

// ichno's own primitives as the toolbar's tools — a place (something to book) and a fixture (anything else), each a
// bare box. What they are for — a role, a capacity, a category — is set in Design once they are drawn.
export const PRIMITIVE_TOOLS: ToolDef[] = [
  {
    id: 'place',
    name: 'Place',
    key: 'P',
    code: 'KeyP',
    hint: `Drag to draw a place, tap for a seat — every place belongs to a section. ${BOX_KEYS}`,
    tool: { id: 'place', draw: 'box', create: placeTool(undefined, { w: 36, h: 36 }) },
    sample: sampleOf(placeTool(undefined, { w: 36, h: 36 })),
    why: nowhere,
  },
  {
    id: 'fixture',
    name: 'Fixture',
    key: 'F',
    code: 'KeyF',
    hint: `Drag to draw a fixture — nothing to book. ${BOX_KEYS}`,
    tool: { id: 'fixture', draw: 'box', create: fixtureTool(undefined, { w: 92, h: 92 }) },
    sample: sampleOf(fixtureTool(undefined, { w: 92, h: 92 })),
  },
  {
    id: 'section',
    name: 'Section',
    key: 'S',
    code: 'KeyS',
    hint:
      'Drag a rectangle, or tap corner by corner and tap the first (or press Enter) to close. Type a length and ' +
      'press Enter for the next edge. ⌫ takes a corner back. Shift: square, 15° edges.',
    tool: { id: 'section', draw: 'polygon', create: sectionTool },
    sample: null,
  },
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
  ...FIXTURES.map(({ role, name, size, shape, draw }) =>
    draw === 'wall'
      ? drawn({
          id: `fixture:${role}`,
          shelf: 'fixtures',
          name,
          hint: `Tap a wall or the edge of a section to put a ${name.toLowerCase()} in it — the wall opens there.`,
          draw: 'point',
          create: doorTool(size),
          why: (plan, at) => (doorAt(plan, at, size) === 'short' ? SHORT_WALL : NO_WALL),
          sample: fixtureTool(role, size),
        })
      : drawn({
          id: `fixture:${name.toLowerCase().replace(/ /g, '-')}`,
          shelf: 'fixtures',
          name,
          hint:
            draw === 'line'
              ? `Drag to draw a ${name.toLowerCase()} along a line. Tap for a short one. ${LINE_KEYS}`
              : `Drag to draw the ${name.toLowerCase()}. Tap for the standard one. ${BOX_KEYS}`,
          draw: draw === 'line' ? 'line' : 'box',
          create: fixtureTool(role, size, { shape, along: draw === 'line' }),
        }),
  ),
]

function square(size: number) {
  return [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ]
}
