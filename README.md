# ichno

Seat plans for React — one JSON document, headless primitives around it.

- **`ichno`** — zod-free core: the document types, geometry (turned shapes, overlap, section crops), layouts (rows
  on an arc, seats around a table, blocks), soft lint rules, selection rules and a renderer-independent interaction
  core (hit-testing, gestures, keyboard movement)
- **`ichno/schema`** — `createSeatPlanSchema({ sectionIds })`: zod validation with structured issue codes; upgrades
  documents stored by ichno 0.1 and 0.2
- **`ichno/react`** — `SeatMap.*`: headless SVG components. The parts render as React Server Components; the
  `Viewport` adds pan, zoom, taps, drags and keyboard movement on the client
- **`ichno/editor`** — `useSeatPlanEditor`: headless editor state and operations; you build the panels

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
`seatPlan.boundsOf(object)`, `contains` and `overlaps` work on the turned shape.

## Layouts

Rows, tables and blocks of desks are layouts — functions that return the boxes to create places (or fixtures) on:

```ts
import { layout } from 'ichno'

layout.arc({ start, end, curve: -0.1, count: 12, size: 40 }) // a row, seats turned along the arc
layout.line({ start, end, count: 8, size: 40 }) // a straight row
layout.around({ table: top, shape: 'ellipse', count: 6, size: 36 }) // seats around a table top, facing it
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

Softer rules warn instead of refusing a save. Each has a severity you can change:

```ts
import { lintSeatPlan } from 'ichno'

lintSeatPlan(plan, { empty_section: 'warning', missing_category: 'off' })
// [{ code: 'duplicate_label', label: '1', ids: ['A1', 'B1'], severity: 'warning' }, …]
```

Lint codes: `duplicate_label`, `outside_section`, `missing_category` (only in plans with categories) and
`empty_section` (off by default).

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
// Interactive — pan, wheel/pinch zoom, taps, arrow keys (Enter/Space picks), the same children.
<SeatMap.Viewport plan={plan} view={view} onViewChange={setView} onPlaceClick={(place) => toggle(place.id)}
  className="h-[480px]">
  <SeatMap.Content plan={plan} selected={picked} />
</SeatMap.Viewport>
```

`SeatMap.Content` is a convenience; compose the parts yourself when you need something else —
`SeatMap.Section`, `SeatMap.Place`, `SeatMap.Fixture`, `SeatMap.Label`, `SeatMap.Grid`, `SeatMap.Handles` and
`SeatMap.Marquee`, fed by `plan.objects`. `renderPlace` swaps one place's drawing while keeping the rest. Turned
places keep their label level.

**Styling.** Parts paint with presentation attributes that read the theme variables, so any class overrides them.
State is on the element: `data-kind` (`place`, `fixture`, `label`), `data-role`, `data-group`, `data-shape`,
`data-status`, `data-selected`, `data-disabled`, `data-highlighted`, `data-dimmed`, `data-invalid`,
`data-category`; pieces are named by `data-part` (`shape`, `label`, `hit`, `floor`, `wall`, `handle`, `marquee`,
`focus-ring`). Style your roles by `data-role` — `[data-role='chair'] [data-part='shape']`.

```tsx
<SeatMap.Place
  place={place}
  status={status[place.id]}
  className="[&_[data-part=shape]]:fill-muted data-[status=held]:[&_[data-part=shape]]:fill-amber-200"
/>
```

**Large plans.** Give the viewport a function child and pass the frame on — objects outside the view (plus a
margin) are skipped and labels too small to read are left out. Content redraws only when a pan leaves the margin
or the zoom crosses a step, so 20,000 seats pan at 60fps.

```tsx
<SeatMap.Viewport plan={plan}>
  {(frame) => <SeatMap.Content plan={plan} region={frame.region} scale={frame.scale} />}
</SeatMap.Viewport>
```

**Views** are viewBoxes in plan units (`planView.home(plan)`, `planView.zoom`, `planView.pan`, `planView.fitTo`
for zoom-to-places), so nothing is measured while rendering. Leave `view` out and the viewport keeps its own.

**Accessibility.** The viewport is a listbox: places are options with `aria-selected`; arrow keys move a focus ring
to the nearest place in that direction and `aria-activedescendant` follows it.

For narrow screens, `seatPlan.sectionPlansOf(plan)` returns one crop per section at a shared scale — stack them.

## Edit

```tsx
'use client'
import { labeling, layout } from 'ichno'
import { useSeatPlanEditor, useSeatPlanEditorShortcuts } from 'ichno/editor'
import { SeatMap } from 'ichno/react'

const editor = useSeatPlanEditor({ initialPlan, lockedIds: bookedSeatIds, snap: { cell: 46 } })
useSeatPlanEditorShortcuts(editor) // Delete, R / ⇧R (turn), ⌘Z / ⇧⌘Z, ⌘D (duplicate), ⌘G (group)

<SeatMap.Viewport {...editor.viewportProps}>
  <SeatMap.Grid plan={editor.displayPlan} />
  <SeatMap.Content plan={editor.displayPlan} selected={editor.selectedPlaceIds} invalid={editor.conflictIds} />
  <SeatMap.Handles handles={editor.handles} frame={editor.frame} />
  <SeatMap.Marquee rect={editor.marquee} />
</SeatMap.Viewport>

const seats = layout.arc({ start: { x: 552, y: 400 }, end: { x: 920, y: 400 }, curve: 0.2, count: 10, size: 40 })
<button onClick={() => editor.addPlaces('B', seats, { role: 'seat', group: { role: 'row', label: 'A' } })}>
  Add row
</button>
<button onClick={() => editor.label(seatIds, labeling.numbers({ reverse: true }))}>Number right to left</button>
<button disabled={!editor.canUndo} onClick={editor.undo}>Undo</button>
<button disabled={!editor.dirty} onClick={() => save(editor.plan)}>Save</button>
```

Tapping a grouped object selects its group; tapping it again selects the object alone (shift/⌘ adds to the
selection). Dragging moves the selection with the snapping the commit will use. Dragging on a section's floor
draws a marquee that selects everything it touches; a selected section moves instead. Space outside every section
and the middle mouse button pan. Nothing stops you from dragging one place onto another; `conflictIds` lists the
places that overlap (the same check the schema runs on save) so you can mark them while arranging. A single
selected item shows handles: an object resizes from its corners (in its own turned frame) and turns from the knob
above it, a group turns as one about the centre of its frame — the box around its members in the direction the
group faces (`group.rotation`), which turns with it, so the centre stays put turn after turn — and a section's
vertices reshape it. `frame` outlines the selected object or group; corner handles carry their turned `angle` so
`SeatMap.Handles` shows matching resize cursors. `rotateSelected` turns one item about its own centre and several
together about the middle of their centres. `displayPlan` is the plan with the drag in
progress; `plan` is what you save. `onTap` also reports the plan point, for tools that place things where you click.

Operations take object and group ids alike — a group acts as one.

- **Create:** `addPlaces(section, boxes, { shape, capacity, role, category, group })`, `addFixtures(boxes, …)`,
  `addLabels(groupId, boxes)`, `duplicateSelected`, `groupSelected` — each returns the new ids and selects them
  (`group: { role, label }` makes a new group in the same step). New places continue the section numbering.
- **Change:** `layoutGroup(groupId, boxes)` (grow, shrink or bend a row — members move onto the boxes, extra boxes
  get new places, surplus ones go from the end), `arrange(ids, boxes)`, `convert(ids, 'place' | 'fixture')` (book a
  table whole), `rotateSelected(degrees)`, `moveSelected`, `alignSelected`, `distributeSelected`, `label(ids,
sequence)` with `labeling.numbers`, `labeling.letters({ skip: ['I'] })` or `labeling.custom`, `renameObject`
  (objects and groups), `updateObject`, `updateGroup`, `ungroup`, `moveSection`, `reshapeSection`.
- **Compose:** `edit(plan => plan)` runs any combination of `planEdits` and `layout` as one undo step.
- **Remove:** `removeObjects`, `removeSelected` — return the ids they refused. Groups left empty go too.
- **History:** `undo`, `redo`, `canUndo`, `canRedo`, `reset`.

`lockedIds` are ids your other records point at: objects holding one cannot be removed, renamed or turned into a
fixture, while labels stay free. Every operation is also available as a pure function in `planEdits` (plan in, plan
out) for imports and scripts. To adopt a new baseline after saving, remount the editor (key it by the saved version).

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
