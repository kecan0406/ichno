# ichno

Seat plans for React — one JSON document, headless primitives around it.

- **`ichno`** — zod-free core: the document types, geometry (turned shapes, overlap, section crops), layouts (rows
  on an arc, seats around a table, blocks), soft lint rules, selection rules and a renderer-independent interaction
  core (hit-testing, gestures, keyboard movement)
- **`ichno/schema`** — `createSeatPlanSchema({ sectionIds })`: zod validation with structured issue codes; upgrades
  documents stored by ichno 0.1 and 0.2
- **`ichno/react`** — `SeatMap.*`: headless SVG components. The parts render as React Server Components; the
  `Viewport` adds pan, zoom, taps, drags and keyboard movement on the client
- **`ichno/editor`** — `useSeatPlanEditor`: headless editor state, operations, creation tools you write, saved
  objects and a clipboard; you build the panels

The library ships **no copy** and **no canvas**. Section names, category names and every message come from you;
everything is SVG you can style with CSS. Where the project is heading is in [`docs/direction.md`](docs/direction.md).

```sh
pnpm add ichno zod   # core + schema
```

Peer dependencies: `react ^19.2` (components, editor), `zod ^4` (schema). Client code ships already compiled with React
Compiler.

## The document

The document holds primitives only — what is where, and what can be booked. A row, a table or a desk is not a kind
ichno decides; it is a group of places and fixtures, and `role` carries your word for each.

```ts
type SeatPlan<S extends string> = {
  version: 3
  width: number
  height: number
  sections: { id: S; points: { x: number; y: number }[] }[] // venue sections — composition fixed by you
  categories: { key: string; accessible?: boolean }[] // names, colours and prices are yours
  groups: { id: string; label?: string; role?: string; rotation?: number }[] // a row, a table with its chairs, …
  objects: PlanObject<S>[] // drawing order
}

// Every object is a box: integer x, y, w, h, turned `rotation` degrees clockwise about its centre.
type PlanObject<S> =
  | {
      kind: 'place'
      id
      section: S
      shape: 'rect' | 'ellipse'
      capacity
      x
      y
      w
      h
      rotation?
      label?
      group?
      role?
      category?
      tags?
    }
  | { kind: 'fixture'; id; shape: 'rect' | 'ellipse'; x; y; w; h; rotation?; group?; role? } // stage, wall, chair — never capacity
  | { kind: 'label'; id; group; x; y; w; h } // where a group's label is written (a row's ends)
```

- **Ids are booking keys.** A place's `id` (1–8 characters) is what your other records (bookings, sessions) point
  at — keep it stable. `label` is what people read and may change freely; it defaults to the id. Objects and groups
  share one id namespace.
- **Places are stored as they are drawn.** A seat in a curved row is a place with its own box; `layout` (below)
  computes those boxes, and nothing about how they were made is kept. `capacity` is how many people a place holds —
  1 for a seat, more for a standing area or a table booked whole.
- **Groups move as one.** A group's members are the objects pointing at it; the editor selects, moves, turns and
  copies them together, and selection rules read a group's places as a line.
- **Status stays outside.** Taken, held or blocked are yours to keep; renderers take them as props.
- **No grid in the document.** Coordinates are whole plan units; the editor snaps to a cell grid only when asked.

`seatPlan.placesOf(plan)` lists the places; `seatPlan.membersOf(plan, groupId)` a group's objects;
`seatPlan.boundsOf(object)`, `contains` and `overlaps` work on the turned shape. `seatPlan.boundsOfIds(plan, ids)` is
what objects and groups cover (to zoom to), and `seatPlan.orderAlong(plan, ids, degrees)` puts them in the order they
come along a direction — 0 left to right, 90 top to bottom — so seats and rows are labelled the way people read them,
whatever order the document holds them in.

## Layouts

Rows, tables and blocks of desks are layouts — functions that return the boxes to create places (or fixtures) on:

```ts
import { layout } from 'ichno'

layout.arc({ start, end, curve: -0.1, count: 12, size: 40 }) // a row, seats turned along the arc
layout.line({ start, end, count: 8, size: 40 }) // a straight row
layout.around({ table: top, shape: 'ellipse', count: 6, size: 36 }) // seats around a table top (round or oval), facing it
layout.grid({ origin, columns: 4, rows: 2, size: { w: 88, h: 60 }, gap: 4 }) // a block of desks
layout.curveOf(centres) // the curve of an existing row — the inverse of `arc`
```

`curve` is 0 for a straight row and ±1 for a half circle; positive bows to the left of start → end.

## Validate

```ts
import { createSeatPlanSchema, seatPlanIssueOf } from 'ichno/schema'

export const { SeatPlan } = createSeatPlanSchema({ sectionIds: ['A', 'B'] as const })

const result = SeatPlan.safeParse(input) // 0.1 and 0.2 documents are upgraded here
if (!result.success) {
  for (const issue of result.error.issues) {
    const planIssue = seatPlanIssueOf(issue) // null for ordinary zod issues (types, sizes)
    // { code: 'overlap', ids: ['A1', 'A2'] } → your message
  }
}
```

Plan-level issue codes: `duplicate_section`, `duplicate_category`, `duplicate_id`, `unknown_category`,
`unknown_group`, `out_of_bounds` (places and fixtures; group labels may sit in the margin) and `overlap` (places
only, on their turned shapes — touching, or crossing by less than `OVERLAP_TOLERANCE`, is fine). Callers holding a
trusted older document can use `upgradeSeatPlan`.

The same factory returns `Template`, which checks a stored `PlanTemplate` (a saved object, see [Edit](#edit)) — its
places carry no section, and only ids and group references are checked; where it lands decides the rest.

Softer rules warn instead of refusing a save. Each has a severity you can change:

```ts
import { lintSeatPlan } from 'ichno'

lintSeatPlan(plan, { empty_section: 'warning', missing_category: 'off' })
// [{ code: 'duplicate_label', label: '1', ids: ['A1', 'B1'], severity: 'warning' }, …]
```

Lint codes: `duplicate_label`, `outside_section`, `missing_category` (only in plans with categories) and
`empty_section` (off by default).

Schema issues and lint results name the objects they are about the same way, in `ids` or `id`; `issueIdsOf(issue)`
reads them for either (none for an issue about a section or a category) — select them with the editor's `selectIds`
and zoom to `seatPlan.boundsOfIds`.

## Selection rules

```ts
import { validateSelection } from 'ichno'

validateSelection(plan, { selected, unavailable }, { max: 4, consecutive: true, noOrphans: true })
// [{ code: 'orphan_seat', id: 'A2' }]
```

Codes: `too_few`, `too_many`, `not_consecutive` (places side by side in one group) and `orphan_seat` (a free place
the selection strands between taken places or a group's end). A group's places, in document order, form the line;
a group with a single place (a desk) forms none.

## Interaction core

Pure building blocks any renderer can share:

- `spatialIndex.create(items)` / `.at(index, point)` / `.query(index, rect)` — hit-testing and area selection
- `gesture.down/move/up/cancel` — a pointer state machine that turns pointer events into `tap`, `drag`
  (`target: null` means pan) and `pinch`
- `placeNavigation.next(items, fromId, 'left')` — arrow-key movement between places

## Draw

```tsx
import { SeatMap } from 'ichno/react'

// Read-only — a Server Component; no JavaScript ships for it.
;<SeatMap.Root plan={plan} aria-label="Floor plan">
  <SeatMap.Content
    plan={plan}
    status={{ A2: 'booked' }} // your words — exposed as data-status; places with a status are disabled
    selected={['B4']}
    sectionLabel={(section) => names[section.id]}
    groupLabel={(group) => group.label} // what a group's labels say (defaults to its label, or id)
    fixtureVariant={(fixture) => (fixture.role === 'wall' ? 'wall' : 'box')}
  />
</SeatMap.Root>
```

```tsx
'use client'
import { SeatMap, useSeatMapView } from 'ichno/react'

// Interactive — pan, wheel/pinch zoom, taps, arrow keys (Enter/Space picks), the same children.
const map = useSeatMapView(plan) // the view, and zoom controls for the buttons you draw
<SeatMap.Viewport plan={plan} {...map.viewProps} onPlaceClick={(place) => toggle(place.id)} className="h-[480px]">
  <SeatMap.Content plan={plan} selected={picked} />
</SeatMap.Viewport>
<button onClick={map.zoomOut} disabled={!map.canZoomOut}>−</button>
<button onClick={map.fit}>{Math.round(map.level * 100)}%</button>
<button onClick={map.zoomIn} disabled={!map.canZoomIn}>+</button>
```

`SeatMap.Content` is a convenience; compose the parts yourself when you need something else —
`SeatMap.Section`, `SeatMap.Place`, `SeatMap.Fixture`, `SeatMap.Label`, `SeatMap.Grid`, `SeatMap.Handles`,
`SeatMap.Outline` and `SeatMap.Marquee`, fed by `plan.objects`; `SeatMap.EditorOverlay` layers the editing ones
(see Edit). `renderPlace` swaps one place's drawing while keeping the rest. Turned places keep their label level.

**Styling.** Parts paint with presentation attributes that read the theme variables, so any class overrides them.
State is on the element: `data-kind` (`place`, `fixture`, `label`), `data-role`, `data-group`, `data-shape`,
`data-status`, `data-selected`, `data-disabled`, `data-highlighted`, `data-dimmed`, `data-invalid`,
`data-category`; pieces are named by `data-part` (`shape`, `label`, `hit`, `floor`, `wall`, `handle`, `outline`,
`marquee`, `focus-ring`, and `editor-overlay` with its `selection`, `hover` and `stroke`). Style your roles by
`data-role` — `[data-role='chair'] [data-part='shape']`.

```tsx
<SeatMap.Place
  place={place}
  status={status[place.id]}
  className="[&_[data-part=shape]]:fill-muted data-[status=held]:[&_[data-part=shape]]:fill-amber-200"
/>
```

**Large plans.** Give the viewport a function child and pass the frame on — objects outside what the viewport shows
(plus a margin) are skipped and labels too small to read are left out. Content redraws only when a pan leaves the
margin or the zoom crosses a step, so 20,000 seats pan at 60fps.

```tsx
<SeatMap.Viewport plan={plan}>
  {(frame) => <SeatMap.Content plan={plan} region={frame.region} scale={frame.scale} />}
</SeatMap.Viewport>
```

**Pointer and keys.** A drag on empty floor pans; so does any drag with Space held or the middle button, whatever
is under it — the svg carries `data-pan` (`ready` while Space is held, `active` while panning) for grab cursors.
`wheel="pan"` makes the wheel and two-finger scrolling pan and pinching or ⌘/Ctrl + wheel zoom, the way design tools
do; the default zooms, the way maps do. Zoom follows how far the wheel turned, so trackpads zoom smoothly, and
Safari's pinch zooms the plan rather than the page. `onHover(point, target)` reports the pointer while nothing is
pressed; `onDraw(stroke, info)` turns every press into a stroke for a creation tool (the editor passes both).
`navigable={false}` turns the arrow-key focus off — the editor does while the arrows move its selection.
Drags are followed in plan units: what is dragged stays under the pointer while the view zooms or scrolls, and a
drag, marquee or stroke held near the edge scrolls the plan toward it until the drawing's edge is in view.

**Views** are viewBoxes in plan units (`planView.home(plan)`, `planView.zoom`, `planView.pan`, `planView.pinch`,
`planView.fitTo` for zoom-to-places), so nothing is measured while rendering. Zoom goes from the home view (the
whole drawing) in to 6×, and zooming out stops at the home view exactly. A viewport of another shape shows more
than its view — `planView.visible(view, size)` is what it shows. Leave `view` out and the viewport keeps its own.
`useSeatMapView(plan)` keeps one for you with the controls around it: `zoomIn` and `zoomOut` about the middle, `fit`
(the whole plan), `zoomTo(rects)` (e.g. `seatPlan.boundsOf` of the places to show), `level` (how far in — 1 is the
whole plan; write it the way your app writes zoom), `canZoomIn` / `canZoomOut` for disabling buttons at the limits,
and `viewProps` to spread into the viewport — the wheel and pinching change the same view.

**Accessibility.** The viewport is a listbox: places are options with `aria-selected`; arrow keys move a focus ring
to the nearest place in that direction and `aria-activedescendant` follows it. Focus from the keyboard shows the
ring at once, and Enter or Space picks the place it shows.

For narrow screens, `seatPlan.sectionPlansOf(plan)` returns one crop per section at a shared scale — stack them.

## Edit

```tsx
'use client'
import { labeling, layout } from 'ichno'
import { useSeatPlanEditor, useSeatPlanEditorShortcuts } from 'ichno/editor'
import { SeatMap, useSeatMapView } from 'ichno/react'

const editor = useSeatPlanEditor({ initialPlan, lockedIds: bookedSeatIds, snap: { cell: 46 } })
const map = useSeatMapView(editor.plan)
// arrows, Delete, R / ⇧R, Escape, Enter / ⇧Enter, ⌘A, ⌘C / ⌘X / ⌘V, ⌘D, ⌘G / ⇧⌘G, ⌘] / ⌘[, ⌘Z / ⇧⌘Z —
// and with the view, + / − / ⇧1 / ⇧2
useSeatPlanEditorShortcuts(editor, { view: map })

<SeatMap.Viewport {...editor.viewportProps} {...map.viewProps} wheel="pan">
  <SeatMap.Grid plan={editor.displayPlan} />
  <SeatMap.Content plan={editor.displayPlan} selected={editor.selectedPlaceIds} invalid={editor.conflictIds} />
  {editor.draft && (
    <g opacity={0.5} pointerEvents="none">
      <SeatMap.Content plan={editor.draft} invalid={editor.conflictIds} />
    </g>
  )}
  <SeatMap.EditorOverlay {...editor.overlayProps} />
</SeatMap.Viewport>

const seats = layout.arc({ start: { x: 552, y: 400 }, end: { x: 920, y: 400 }, curve: 0.2, count: 10, size: 40 })
<button onClick={() => editor.addPlaces('B', seats, { role: 'seat', group: { role: 'row', label: 'A' } })}>
  Add row
</button>
<button onClick={() => editor.label(seatIds, labeling.numbers({ reverse: true }))}>Number right to left</button>
<button disabled={!editor.canUndo} onClick={editor.undo}>Undo</button>
<button
  disabled={!editor.dirty}
  onClick={async () => {
    const saved = editor.plan
    await save(saved)
    editor.markSaved(saved) // edits made meanwhile stay dirty
  }}
>
  Save
</button>
```

Tapping a grouped object selects its group; tapping it again selects the object alone (shift/⌘ adds to the
selection). Dragging moves the selection with the snapping the commit will use — with Shift along one axis, with
Alt a copy, leaving the original (`PlanDrag.copy`).
Dragging empty floor draws a marquee that selects everything it touches; a selected section moves instead. Space
and the middle mouse button pan. `cancel()` (Escape) drops the drag, marquee or stroke under way — what was
dragged goes back and letting go changes nothing. Nothing stops you from dragging one place onto another; `conflictIds` lists the
places that overlap (the same check the schema runs on save) so you can mark them while arranging. A single
selected item shows handles: an object resizes from its corners (in its own turned frame; Shift keeps its
proportions) and turns from the knob above it (Shift: 15° steps), a group turns as one about the centre of its
frame — the box around its members in the direction the group faces (`group.rotation`), which turns with it, so the
centre stays put turn after turn — and a section's vertices reshape it: drag the middle of an edge to add a vertex,
drop a vertex on its neighbour to take it away. `frame` outlines the selected object or
group; corner handles carry their turned `angle` so `SeatMap.Handles` shows matching resize cursors. `frames`
outlines every selected item and `hoverFrame` what a tap would select, so fixtures and groups show they are
selected too. `SeatMap.EditorOverlay` draws all of it in order — the selection's outlines, the hover outline, the
handles, the marquee and a tool's stroke — from `overlayProps`; draw the pieces yourself with `SeatMap.Outline`,
`SeatMap.Handles` and `SeatMap.Marquee` when you want another order or look. `selectionBounds` is what the
selection covers, for `map.zoomTo`. `rotateSelected` turns one item about its own centre and several together about
the middle of their centres. `displayPlan` is the plan with the drag in progress; `plan` is what you save. A
selection never holds what an undo, a redo or an edit took away.

### Creation tools

Rows, tables and booths are your words, so the tools that make them are yours too: an `EditorTool` says what a drag
draws and turns the stroke into a plan. Pick one with `setTool`; every press on the plan then draws with it — the
editor shows what it would make under the pointer (`draft`) and while the stroke is drawn, commits it as one undo
step when it is let go, selects what it made and goes back to selecting (`keep: true` stays).

```ts
import { layout, seatPlan } from 'ichno'
import { planEdits, type EditorTool } from 'ichno/editor'

// A row along the stroke, a seat for every 46 units of it — a tap drops a single seat.
const row: EditorTool<'hall'> = {
  id: 'row',
  draw: 'line',
  create(plan, { start, end }) {
    const section = seatPlan.sectionAt(plan, start)
    if (section === null) return null // every place belongs to a section
    const count = Math.floor(Math.hypot(end.x - start.x, end.y - start.y) / 46) + 1
    const seats = layout.line({ start, end, count, size: 40 })
    return planEdits.addPlaces(plan, section, seats, { role: 'seat' })?.plan ?? null
  },
}

<button aria-pressed={editor.tool?.id === 'row'} onClick={() => editor.setTool(row)}>Row</button>
```

`draw` is `box` (a rectangle between the press and the pointer; Shift keeps it square), `line` (Shift keeps it to
15° steps), `point` (only where the pointer is — a stamp) or `polygon` (a corner at every tap, Shift keeping the edge
to 15° steps; tapping the first corner, or the last one again, or Enter closes it, Backspace takes a corner back,
Escape drops it — `create` gets the corners in `stroke.points`, and `corners`, `closePolygon` and `removePoint` are
on the editor); Alt draws a box or a line from its centre. Strokes snap
like everything else. A tap is a stroke with no length, so one tool both draws at any size and drops something of a
standard size. `create` runs for every preview — keep it pure. `stroke` is the stroke being drawn (draw it as a
guide), `pointer` where a tap would draw — with `draft` null there, the tool can make nothing at that spot (say
why). While a tool is active the handles hide; Escape drops the stroke, then the tool.

The playground builds a full set this way — rows (a seat every step, lettered, with labels at both ends), blocks of
rows, round and oval tables, desks with chairs, booths, standing areas sized by their floor, walls along a line — and
grows a row or a table while keeping its numbering: [`site/app/playground/_lib/build.ts`](https://github.com/kecan0406/ichno/blob/main/site/app/playground/_lib/build.ts).
Copy what fits; it is yours to change, not part of ichno.

### Saved objects and the clipboard

`planEdits.templateOf(plan, ids)` keeps what a selection holds as a `PlanTemplate` — objects and the groups they
form, around their centre, with no sections — and where it came from. Store templates like documents (they carry
`version`; check them with the schema's `Template`) to offer a library of objects people made themselves.
`planEdits.insertTemplate(plan, template, at)` adds one centred on `at` with fresh ids: places continue the
numbering of the section they land in, groups get new ids, the copy stays inside the plan and drops categories the
plan does not list. A `point` tool that inserts one is a stamp:

```ts
const { template } = planEdits.templateOf(editor.plan, editor.selectedIds)!
const stamp: EditorTool<'hall'> = {
  draw: 'point',
  keep: true,
  create: (plan, { end }) => planEdits.insertTemplate(plan, template, end)?.plan ?? null,
}
```

The editor keeps a clipboard of its own: `copySelected`, `cutSelected` and `paste(at?)` — under the pointer when it
is over the plan, otherwise beside what was copied. `insert(template, at)` adds any template and selects it.

### Operations

Operations take object and group ids alike — a group acts as one.

- **Create:** `addPlaces(section, boxes, { shape, capacity, role, category, group })`, `addFixtures(boxes, …)`,
  `addLabels(groupId, boxes)`, `insert(template, at)`, `duplicateSelected` (duplicating the copies again repeats
  how far they were moved), `groupSelected` — each returns the new
  ids and selects them (`group: { role, label }` makes a new group in the same step). New places continue the
  section numbering.
- **Change:** `layoutGroup(groupId, boxes)` (grow, shrink or bend a row — members move onto the boxes, extra boxes
  get new places, surplus ones go from the end), `arrange(ids, boxes)`, `convert(ids, 'place' | 'fixture')` (book a
  table whole), `rotateSelected(degrees)`, `moveSelected(delta)` (objects, groups and sections), `alignSelected`,
  `distributeSelected`, `label(ids, sequence)` with `labeling.numbers`, `labeling.letters({ skip: ['I'] })` or
  `labeling.custom`, `assign(ids, props)` and `assignSelected(props)` (shape, capacity, role, category or tags on
  many objects in one step — a group through its members, `undefined` clears an optional one, values the schema
  would refuse are refused), `renameObject` (objects and groups), `updateObject`, `updateGroup`, `ungroup`,
  `ungroupSelected`, `addSection({ id, points })` (selects it), `moveSection`, `reshapeSection`,
  `reorderSelected('front' | 'back' | 'forward' | 'backward')`.
- **Compose:** `edit(plan => plan)` runs any combination of `planEdits` and `layout` as one undo step.
  `preview(plan => plan)` shows one without committing it — while a slider is dragged — applied to the plan as it is,
  until the next edit or `preview(null)`; `edit` the final value when the slider is let go.
- **Select:** `select(target, additive)` (what a tap selects), `selectAll()`, `setSelection(items)` (exactly these
  objects, groups and sections — for a layers panel), `selectIds(ids)` (exactly these object and group ids — for a
  list of problems or a search), `selectMembers()` and `selectGroups()` (Enter and ⇧Enter).

`objects` is the drawing order, later on top. `reorderSelected` moves the selection to the front or back, or a step
past the next unit — a group as one, or an object outside one. Units stand in the order of their highest member, so
a group whose members are drawn apart (a table top under everything, its seats on top) is listed where its highest
member is; list your layers that way and a step moves one row.

- **Remove:** `removeObjects`, `removeSelected`, `removeSection(id)`, `cutSelected` — return the ids they refused.
  Groups left empty go too. A section goes with what stands in it — its places, every group holding one (whole), and
  the loose fixtures inside its outline — or, when any of that is locked, not at all.
- **History:** `undo`, `redo`, `canUndo`, `canRedo`, `reset` (back to the plan as opened or last saved),
  `markSaved(saved?)`.

`useSeatPlanEditorShortcuts` binds the arrow keys (move the selection one unit — with Shift ten, or half a cell and
a cell when snapping; with nothing selected they move the viewport's focus ring), Delete, R / ⇧R, Escape (the
stroke, drag or marquee under way, then the tool, then the selection), Enter / ⇧Enter (the selected groups'
members, the selected objects' groups), ⌘A, ⌘C / ⌘X / ⌘V, ⌘D, ⌘G / ⇧⌘G (group, ungroup), ⌘] / ⌘[ (a step
forward, backward), ⌥⌘] / ⌥⌘[ (to the front, back) and ⌘Z / ⇧⌘Z. Given `{ view }` — `useSeatMapView`, or anything
with `zoomIn`, `zoomOut`, `fit` and `zoomTo` (`ViewControls`) — + and − zoom, ⇧1 shows the whole plan and ⇧2 the
selection. It ignores keys typed into a field, Enter on a control that answers it (a button, a link, a menu item),
and keys a handler already took (`preventDefault`), so your own shortcuts can run first.

`lockedIds` are ids your other records point at: objects holding one cannot be removed, renamed or turned into a
fixture, while labels stay free. `frozenIds` and `hiddenIds` are a layers panel's lock and eye — editor state, never
in the document: frozen objects and groups are drawn but cannot be tapped, dragged, hovered, marqueed or caught by
⌘A (a drag starting on one draws a marquee); hidden ones are left out of `displayPlan` as well. `setSelection` and
`selectIds` still select both, for the panel. Every operation is also available as a pure function in `planEdits` (plan in, plan
out) for imports and scripts. After saving, `markSaved(saved)` makes the plan you stored the baseline `dirty`
compares against — history and selection stay, and edits made while the save was under way stay dirty. To open
another document, remount the editor (key it by the document).

## Theme

Parts read CSS custom properties; set them on `:root` (and again for dark mode). Unset ones fall back to neutral
defaults (`themeVars` lists them). Classes on parts override them outright.

| Variable                    | Role                                            |
| --------------------------- | ----------------------------------------------- |
| `--ichno-surface`           | section floor, empty places                     |
| `--ichno-fixture`           | fixture faces                                   |
| `--ichno-grid`              | editor grid                                     |
| `--ichno-label`             | outlines, seat numbers, group and fixture names |
| `--ichno-ink`               | walls, taken places, selection rings            |
| `--ichno-ink-foreground`    | numbers on ink-filled places                    |
| `--ichno-accent`            | picked places, editor selection                 |
| `--ichno-accent-foreground` | numbers on accent-filled places                 |
| `--ichno-warning`           | warning marks                                   |
| `--ichno-font`              | text font (inherits when unset)                 |
| `--ichno-number-font`       | seat number font (falls back to `--ichno-font`) |

## License

MIT
