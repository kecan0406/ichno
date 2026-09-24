# ichno

Seat plans for React — one JSON document, headless primitives around it.

- **`ichno`** — zod-free core: the document types, grid snapping, geometry (desks, curved rows, tables, section
  crops), soft lint rules, selection rules and a renderer-independent interaction core (hit-testing, gestures,
  keyboard movement)
- **`ichno/schema`** — `createSeatPlanSchema({ sectionIds })`: zod validation with structured issue codes; upgrades
  documents stored by ichno 0.1
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

```ts
type SeatPlan<S extends string> = {
  version: 2
  width: number
  height: number
  sections: { id: S; points: { x: number; y: number }[] }[] // venue sections — composition fixed by you
  categories: { key: string; accessible?: boolean }[] // names, colours and prices are yours
  objects: PlanObject<S>[] // drawing order
}

type PlanObject<S> =
  | { kind: 'desk'; id; section: S; x; y; w; h; chairSide: 'up' | 'right' | 'down' | 'left' } // one person
  | { kind: 'row'; id; section: S; start; end; curve; seatSize; seats: { id }[] } // seats spread along an arc
  | { kind: 'table'; id; section: S; shape: 'round' | 'rect'; x; y; w; h; seatSize; seats: { id }[]; wholeBooking? }
  | { kind: 'booth'; id; section: S; x; y; w; h }
  | { kind: 'area'; id; section: S; shape: 'rect' | 'ellipse'; x; y; w; h; capacity; wholeBooking? }
  | { kind: 'fixture'; id; role: string; x; y; w; h } // walls, TVs, stages — never capacity
```

Every bookable unit also takes `label`, `category` and `tags`. Coordinates are integer plan units.

- **Ids are booking keys.** A place's `id` (1–8 characters) is what your other records (bookings, sessions) point
  at — keep it stable. `label` is what people read and may change freely; it defaults to the id. Ids share one
  namespace across the document, seats inside rows and tables included.
- **Row seats are computed.** A row stores its end points, `curve` (0 straight, ±1 a half circle, positive bows to
  the left of start → end) and its seat list; `seatPlan.rowSeatsOf(row)` returns the positions.
- **Status stays outside.** Taken, held or blocked are yours to keep; renderers take them as props.
- **Desks use the grid.** Desks snap to a 46-unit cell grid (a standard desk is 2×2 cells = 88 units with a 4-unit
  gap), fixtures to half cells, section outlines to cell corners.

`seatPlan.placesOf(plan)` flattens every bookable unit — desks, row seats, table seats (or whole tables), booths
and areas — with its section, label, centre, bounds and capacity.

## Validate

```ts
import { createSeatPlanSchema, seatPlanIssueOf } from 'ichno/schema'

export const { SeatPlan } = createSeatPlanSchema({ sectionIds: ['A', 'B'] as const })

const result = SeatPlan.safeParse(input) // 0.1 documents (rooms under `zones`) are upgraded here
if (!result.success) {
  for (const issue of result.error.issues) {
    const planIssue = seatPlanIssueOf(issue) // null for ordinary zod issues (types, sizes)
    // { code: 'overlap', ids: ['A1', 'A2'] } → your message
  }
}
```

Plan-level issue codes: `duplicate_section`, `duplicate_category`, `duplicate_id`, `unknown_category`,
`out_of_bounds`, `overlap`, `fixture_overlap`. Callers holding a trusted 0.1 document can use `upgradeSeatPlan`.

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

Codes: `too_few`, `too_many`, `not_consecutive` (row seats side by side in one row) and `orphan_seat` (a free
seat the selection strands between taken seats or a row end).

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
`SeatMap.Section`, `SeatMap.Place`, `SeatMap.Fixture`, `SeatMap.Table` and `SeatMap.Grid`, fed by
`seatPlan.placesOf(plan)`. `renderPlace` swaps one place's drawing while keeping the rest.

**Styling.** Parts paint with presentation attributes that read the theme variables, so any class overrides them.
State is on the element: `data-kind`, `data-status`, `data-selected`, `data-disabled`, `data-highlighted`,
`data-dimmed`, `data-category`, `data-chair-side`; pieces are named by `data-part` (`shape`, `chair`, `label`,
`floor`, `wall`, `top`, `focus-ring`).

```tsx
<SeatMap.Place
  place={place}
  status={status[place.id]}
  className="[&_[data-part=shape]]:fill-muted data-[status=held]:[&_[data-part=shape]]:fill-amber-200"
/>
```

**Views** are viewBoxes in plan units (`planView.home(plan)`, `planView.zoom`, `planView.pan`, `planView.fitTo`
for zoom-to-places), so nothing is measured while rendering. Leave `view` out and the viewport keeps its own.

**Accessibility.** The viewport is a listbox: places are options with `aria-selected`; arrow keys move a focus ring
to the nearest place in that direction and `aria-activedescendant` follows it.

For narrow screens, `seatPlan.sectionPlansOf(plan)` returns one crop per section at a shared scale — stack them.

## Edit

```tsx
'use client'
import { labeling } from 'ichno'
import { useSeatPlanEditor, useSeatPlanEditorShortcuts } from 'ichno/editor'
import { SeatMap } from 'ichno/react'

const editor = useSeatPlanEditor({ initialPlan, lockedIds: bookedSeatIds })
useSeatPlanEditorShortcuts(editor) // Delete, R (turn chair), ⌘Z / ⇧⌘Z, ⌘D (duplicate)

<SeatMap.Viewport {...editor.viewportProps}>
  <SeatMap.Grid plan={editor.displayPlan} />
  <SeatMap.Content plan={editor.displayPlan} selected={editor.selectedPlaceIds} />
</SeatMap.Viewport>

<button onClick={() => editor.addDesk('A') ?? alert('No free 2×2 spot')}>Add desk</button>
<button onClick={() => editor.addRow('B', { start: { x: 552, y: 400 }, end: { x: 920, y: 400 }, seats: 10, curve: 0.2 })}>
  Add row
</button>
<button onClick={() => editor.labelSeats(rowId, labeling.numbers({ reverse: true }))}>Number right to left</button>
<button disabled={!editor.canUndo} onClick={editor.undo}>Undo</button>
<button disabled={!editor.dirty} onClick={() => save(editor.plan)}>Save</button>
```

Tapping selects (a seat selects its row or table; shift/⌘ adds to the selection), dragging moves the selection
with the snapping the commit will use, and dragging empty floor pans. `displayPlan` is the plan with the drag in
progress; `plan` is what you save. `onTap` also reports the plan point, for tools that place things where you click.

- **Create:** `addDesk`, `addFixture(role, size)`, `addRow`, `addTable`, `addBooth`, `addArea`,
  `duplicateSelected` — each returns the new id (or null) and selects it. New places continue the section numbering.
- **Change:** `moveObject`, `moveSection`, `reshapeSection`, `rotateDesk`, `setSeatCount` (a row keeps its length),
  `labelSeats` / `labelObjects` with `labeling.numbers`, `labeling.letters({ skip: ['I'] })` or `labeling.custom`,
  `alignSelected`, `distributeSelected`, `renameObject`, `updateObject`.
- **Remove:** `removeObjects`, `removeSelected` — return the ids they refused.
- **History:** `undo`, `redo`, `canUndo`, `canRedo`, `reset`.

`lockedIds` are ids your other records point at: objects holding one cannot be removed, renamed or shrunk past it,
while labels stay free. Every operation is also available as a pure function in `planEdits` (plan in, plan out) for
imports and scripts. The plan is grid-normalized on open. To adopt a new baseline after saving, remount the editor
(key it by the saved version).

## Theme

Parts read CSS custom properties; set them on `:root` (and again for dark mode). Unset ones fall back to neutral
defaults (`themeVars` lists them). Classes on parts override them outright.

| Variable                    | Role                                            |
| --------------------------- | ----------------------------------------------- |
| `--ichno-surface`           | section floor, desks, empty chairs              |
| `--ichno-fixture`           | fixture faces                                   |
| `--ichno-grid`              | editor grid                                     |
| `--ichno-label`             | furniture outlines, seat numbers, fixture names |
| `--ichno-ink`               | walls, taken places, selection rings            |
| `--ichno-ink-foreground`    | numbers on ink-filled places                    |
| `--ichno-accent`            | picked places, editor selection                 |
| `--ichno-accent-foreground` | numbers on accent-filled places                 |
| `--ichno-warning`           | warning marks                                   |
| `--ichno-font`              | text font (inherits when unset)                 |
| `--ichno-number-font`       | seat number font (falls back to `--ichno-font`) |

## License

MIT
