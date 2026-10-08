import type { PlanSize, PlanTemplate, SeatPlan, Shape } from 'ichno'
import { planEdits, type EditorTool } from 'ichno/editor'
import { fixtureTool, placeTool, sectionTool } from './build'
import type { SavedObject } from './library'

// The playground's own objects — one ichno place or fixture each, with a role this site gave it (./build.ts), the
// way an app makes its own. ichno ships none of them. A drag sizes one and a tap drops the standard one; grouping
// them into rows and tables is left to whoever draws them.

// Something the playground can place — its name, the key that picks it (`key` as shown, `code` the physical key),
// what the hint says while it is picked, and the ichno tool that places it.
export type ToolDef = { id: string; name: string; key: string; code: string; hint: string; tool: EditorTool<string> }

export type PlaygroundObject = ToolDef & {
  shelf: 'places' | 'fixtures'
  // One dropped at its standard size — its thumbnail, and what it is made of.
  sample: PlanTemplate
}

const BOX_KEYS = 'Shift: square · Alt: from the centre.'
const LINE_KEYS = 'Shift: 15° steps · Alt: from the centre.'

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

// An object drawn with a tool — its sample is one dropped on the scratch plan with a tap.
function drawn({
  id,
  shelf,
  name,
  digit,
  hint,
  draw,
  create,
}: Pick<PlaygroundObject, 'id' | 'shelf' | 'name' | 'hint'> &
  Pick<EditorTool<string>, 'draw' | 'create'> & { digit?: number }) {
  const at = { x: SCRATCH.width / 2, y: SCRATCH.height / 2 }
  const made = create(SCRATCH, { start: at, end: at })!
  const sample = planEdits.templateOf(
    made,
    made.objects.map((o) => o.id),
  )!.template
  const keys = digit === undefined ? { key: '', code: '' } : { key: String(digit), code: `Digit${digit}` }
  return { id, shelf, name, ...keys, hint, tool: { id, draw, create }, sample } satisfies PlaygroundObject
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
  }
}

// Places and fixtures are the app's words — these are this site's.
const PLACES: { role: string; name: string; size: PlanSize; capacity?: number }[] = [
  { role: 'seat', name: 'Seat', size: { w: 36, h: 36 } },
  { role: 'desk', name: 'Desk', size: { w: 88, h: 60 } },
  { role: 'sofa', name: 'Sofa', size: { w: 138, h: 46 }, capacity: 3 },
  { role: 'booth', name: 'Booth', size: { w: 184, h: 138 } },
  { role: 'area', name: 'Standing area', size: { w: 276, h: 138 } },
]

// A wall is drawn along a line; the rest as boxes.
const FIXTURES: { role: string; name: string; size: PlanSize; shape?: Shape; along?: boolean }[] = [
  { role: 'table', name: 'Round table', size: { w: 92, h: 92 }, shape: 'ellipse' },
  { role: 'table', name: 'Square table', size: { w: 70, h: 70 } },
  { role: 'chair', name: 'Chair', size: { w: 36, h: 36 } },
  { role: 'coffee', name: 'Coffee table', size: { w: 92, h: 46 } },
  { role: 'stage', name: 'Stage', size: { w: 414, h: 115 } },
  { role: 'screen', name: 'Screen', size: { w: 460, h: 46 } },
  { role: 'bar', name: 'Bar', size: { w: 368, h: 69 } },
  { role: 'wall', name: 'Wall', size: { w: 23, h: 230 }, along: true },
  { role: 'door', name: 'Door', size: { w: 92, h: 23 } },
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
  },
  {
    id: 'fixture',
    name: 'Fixture',
    key: 'F',
    code: 'KeyF',
    hint: `Drag to draw a fixture — nothing to book. ${BOX_KEYS}`,
    tool: { id: 'fixture', draw: 'box', create: fixtureTool(undefined, { w: 92, h: 92 }) },
  },
  {
    id: 'section',
    name: 'Section',
    key: 'S',
    code: 'KeyS',
    hint: 'Tap corner by corner; tap the first (or press Enter) to close. ⌫ takes a corner back. Shift: 15° edges.',
    tool: { id: 'section', draw: 'polygon', create: sectionTool },
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
    }),
  ),
  ...FIXTURES.map(({ role, name, size, shape, along = false }) =>
    drawn({
      id: `fixture:${name.toLowerCase().replace(/ /g, '-')}`,
      shelf: 'fixtures',
      name,
      hint: along
        ? `Drag to draw a ${name.toLowerCase()} along a line. Tap for a short one. ${LINE_KEYS}`
        : `Drag to draw the ${name.toLowerCase()}. Tap for the standard one. ${BOX_KEYS}`,
      draw: along ? 'line' : 'box',
      create: fixtureTool(role, size, { shape, along }),
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
