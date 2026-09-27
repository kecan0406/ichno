import type { Group, PlanObject, PlanTemplate, SeatPlan } from 'ichno'
import { planEdits, type EditorTool } from 'ichno/editor'
import { blockTool, boxPlaceTool, deskTool, fixtureTool, rowTool, tableTool } from './build'
import type { SavedObject } from './library'

// The playground's own objects — made in advance for this demo out of ichno's places, fixtures and groups
// (./build.ts), the way an app makes its own. ichno ships none of them. Most are drawn: a drag sizes them and a tap
// drops the standard one. Two are fixed arrangements, placed as they are — like the objects people save.

// Something the object panel can place — its name, its key, what the status line says while it is picked, and the
// ichno tool that places it.
export type ToolDef = { id: string; name: string; key: string; hint: string; tool: EditorTool<string> }

export type PlaygroundObject = ToolDef & {
  shelf: 'seating' | 'fixtures'
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
  key = '',
  hint,
  draw,
  create,
}: Omit<PlaygroundObject, 'tool' | 'sample' | 'key'> & Pick<EditorTool<string>, 'draw' | 'create'> & { key?: string }) {
  const at = { x: SCRATCH.width / 2, y: SCRATCH.height / 2 }
  const made = create(SCRATCH, { start: at, end: at })!
  const units = [...made.groups.map((g) => g.id), ...made.objects.flatMap((o) => (o.group === undefined ? [o.id] : []))]
  const sample = planEdits.templateOf(made, units)!.template
  return { id, shelf, name, key, hint, tool: { id, draw, create }, sample } satisfies PlaygroundObject
}

function placed(id: string, name: string, template: PlanTemplate): PlaygroundObject {
  return { id, shelf: 'seating', name, key: '', sample: template, ...placeAsIs(id, name, template) }
}

// A fixed arrangement as a tool — it follows the pointer, and a tap puts it down.
function placeAsIs(id: string, name: string, template: PlanTemplate): Pick<ToolDef, 'hint' | 'tool'> {
  return {
    hint: `Tap to place “${name}”.`,
    tool: {
      id,
      draw: 'point',
      create: (plan, stroke) => planEdits.insertTemplate(plan, template, stroke.end)?.plan ?? null,
    },
  }
}

// An object someone saved, placed the same way.
export function savedObjectTool(saved: SavedObject): ToolDef {
  const id = `saved:${saved.id}`
  return { id, name: saved.name, key: '', ...placeAsIs(id, saved.name, saved.template) }
}

// A fixed arrangement drawn on the scratch plan and kept with `planEdits.templateOf` — the way a selection is saved.
function arrangement(group: Group, objects: PlanObject<string>[]): PlanTemplate {
  return planEdits.templateOf({ ...SCRATCH, groups: [group], objects }, [group.id])!.template
}

const seat = (id: string, x: number, y: number, rotation: number, label: string): PlanObject<string> => ({
  kind: 'place',
  id,
  section: '_',
  x,
  y,
  w: 36,
  h: 36,
  ...(rotation ? { rotation } : {}),
  shape: 'ellipse',
  capacity: 1,
  label,
  group: 'square',
  role: 'seat',
})

const SQUARE_TABLE = arrangement({ id: 'square', role: 'table' }, [
  { kind: 'fixture', id: 'top', shape: 'rect', x: 465, y: 465, w: 70, h: 70, group: 'square', role: 'table' },
  seat('s1', 482, 423, 0, '1'),
  seat('s2', 541, 482, 90, '2'),
  seat('s3', 482, 541, 180, '3'),
  seat('s4', 423, 482, 270, '4'),
])

const LOUNGE = arrangement({ id: 'lounge', role: 'lounge' }, [
  { kind: 'fixture', id: 'coffee', shape: 'rect', x: 454, y: 477, w: 92, h: 46, group: 'lounge', role: 'coffee' },
  {
    kind: 'place',
    id: 'sofa1',
    section: '_',
    shape: 'rect',
    x: 431,
    y: 419,
    w: 138,
    h: 46,
    capacity: 3,
    group: 'lounge',
    role: 'sofa',
  },
  {
    kind: 'place',
    id: 'sofa2',
    section: '_',
    shape: 'rect',
    x: 350,
    y: 523,
    w: 138,
    h: 46,
    rotation: 90,
    capacity: 3,
    group: 'lounge',
    role: 'sofa',
  },
])

// Fixtures are the app's words — these are this site's. A wall is drawn along a line; the rest as boxes.
const FIXTURES: { role: string | undefined; name: string; size: { w: number; h: number }; along?: boolean }[] = [
  { role: 'stage', name: 'Stage', size: { w: 414, h: 115 } },
  { role: 'screen', name: 'Screen', size: { w: 460, h: 46 } },
  { role: 'bar', name: 'Bar', size: { w: 368, h: 69 } },
  { role: 'wall', name: 'Wall', size: { w: 23, h: 230 }, along: true },
  { role: 'door', name: 'Door', size: { w: 92, h: 23 } },
  { role: 'pillar', name: 'Pillar', size: { w: 46, h: 46 } },
  { role: undefined, name: 'Other', size: { w: 92, h: 92 } },
]

export const PLAYGROUND_OBJECTS: PlaygroundObject[] = [
  drawn({
    id: 'row',
    shelf: 'seating',
    name: 'Row',
    key: '1',
    hint: `Drag to draw a row, a seat every step. Tap for seven seats. ${LINE_KEYS}`,
    draw: 'line',
    create: rowTool,
  }),
  drawn({
    id: 'block',
    shelf: 'seating',
    name: 'Seat block',
    key: '2',
    hint: `Drag a rectangle to fill it with rows. Tap for four rows of eight. ${BOX_KEYS}`,
    draw: 'box',
    create: blockTool,
  }),
  drawn({
    id: 'table',
    shelf: 'seating',
    name: 'Round table',
    key: '3',
    hint: `Drag to size a table; seats fill its edge. Tap for one for six. ${BOX_KEYS}`,
    draw: 'box',
    create: tableTool,
  }),
  drawn({
    id: 'desk',
    shelf: 'seating',
    name: 'Desk',
    key: '4',
    hint: `Drag to fill an area with desks. Tap for one desk. ${BOX_KEYS}`,
    draw: 'box',
    create: deskTool,
  }),
  drawn({
    id: 'booth',
    shelf: 'seating',
    name: 'Booth',
    key: '5',
    hint: `Drag to draw a booth. Tap for the standard one. ${BOX_KEYS}`,
    draw: 'box',
    create: boxPlaceTool('booth'),
  }),
  drawn({
    id: 'area',
    shelf: 'seating',
    name: 'Standing area',
    key: '6',
    hint: `Drag to draw an area; its floor sets its capacity. Tap for one for forty. ${BOX_KEYS}`,
    draw: 'box',
    create: boxPlaceTool('area'),
  }),
  placed('square-table', 'Square table for four', SQUARE_TABLE),
  placed('lounge', 'Lounge corner', LOUNGE),
  ...FIXTURES.map(({ role, name, size, along = false }) =>
    drawn({
      id: `fixture:${role ?? 'other'}`,
      shelf: 'fixtures',
      name,
      hint: along
        ? `Drag to draw a ${name.toLowerCase()} along a line. Tap for a short one. ${LINE_KEYS}`
        : role === undefined
          ? `Drag to draw a fixture, then name its role in the inspector. ${BOX_KEYS}`
          : `Drag to draw the ${name.toLowerCase()}. Tap for the standard one. ${BOX_KEYS}`,
      draw: along ? 'line' : 'box',
      create: fixtureTool(role, size, along),
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
