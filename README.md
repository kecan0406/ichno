# ichno

Seat plans for React — one JSON document, headless primitives around it.

- **`ichno`** — zod-free core: the document types, geometry (turned shapes, overlap, walls and the rooms they close,
  section crops), layouts (rows on an arc, seats around a table, blocks), soft lint rules, selection rules and a
  renderer-independent interaction core (hit-testing, gestures, keyboard movement)
- **`ichno/schema`** — `createSeatPlanSchema({ sectionIds })`: zod validation with structured issue codes; upgrades
  documents stored by ichno 0.1 and 0.2
- **`ichno/react`** — `SeatMap.*`: headless SVG components, every one a React Server Component — a plan that is only
  drawn sends no script
- **`ichno/react/client`** — `SeatMapViewport` adds pan, zoom, taps, drags and keyboard movement in the browser, and
  `useSeatMapView` the zoom controls around it
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
ichno decides; it is a group of places and fixtures, and `role` carries your word for each. Walls are the building
around them; the rooms they close are found from them, not stored.

```ts
type SeatPlan<S extends string> = {
  version: 3
  width: number
  height: number
  sections: { id: S; points: { x: number; y: number }[] }[] // venue sections — composition fixed by you
  walls: Wall[] // the building — rooms close where walls meet
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

// A centre line through `points` (back to the first when `closed`; corners to a hundredth of a unit, so a metre
// turned any way stays a metre), `thickness` across, with gaps cut in it.
type Wall = {
  id
  points: { x: number; y: number }[]
  thickness: number
  closed?: boolean
  openings?: { edge: number; at: number; width: number; role?: string }[] // a door, a window — `role` is yours
}
```

- **Ids are booking keys.** A place's `id` (1–8 characters) is what your other records (bookings, orders) point
  at — keep it stable. `label` is what people read and may change freely; it defaults to the id. Objects, groups and
  walls share one id namespace.
- **Places are stored as they are drawn.** A seat in a curved row is a place with its own box; `layout` (below)
  computes those boxes, and nothing about how they were made is kept. `capacity` is how many people a place holds —
  1 for a seat, more for a standing area or a table booked whole.
- **Groups move as one.** A group's members are the objects pointing at it; the editor selects, moves, turns and
  copies them together, and selection rules read a group's places as a line.
- **Walls make the rooms.** A wall is a centre line and a thickness; an opening is a stretch of one of its edges
  (`edge`, from `at`, `width` long). `seatPlan.roomsOf(plan)` finds the rooms walls close — a closed wall round one,
  a partition across it making two, rooms built side by side sharing their wall; an open wall's end within half a
  thickness of another wall meets it there. `seatPlan.roomAt(plan, point)` is the innermost room around a point,
  `seatPlan.openingAt(plan, point, width, reach)` where an opening of that width would go in the nearest wall, and
  `seatPlan.wallOutlineOf(wall)` the band a wall paints. Rooms are not sections: a section is what a place belongs to
  for booking; one that is the whole plan is enough for most venues.
- **Status stays outside.** Taken, held or blocked are yours to keep; renderers take them as props.
- **No grid in the document.** Coordinates are whole plan units; the editor snaps to a cell grid only when asked.
  Plan units have no size, but ichno's defaults read them as centimetres: `GRID_CELL` is 50 (half a metre), so
  snapping lands on 25 cm steps.

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
`unknown_group`, `out_of_bounds` (places and fixtures; group labels may sit in the margin; a wall's centre line — its
band may reach past the edge by half its thickness), `overlap` (places only, on their turned shapes — touching, or
crossing by less than `OVERLAP_TOLERANCE`, is fine) and `opening_off_wall` (an opening whose edge is not there or
that runs past its end). Callers holding a
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
- `press.down/move/up/cancel` — what a press on the plan means, on top of `gesture`: a tap, a target dragged, a
  marquee, a tool's stroke, a pan or a pinch, with points handed back in plan units through the view's own `toPlan`.
  `press.keys` and `press.restate` report a drag again when a key changes or the view moves under it. It is what
  `SeatMapViewport` runs on; a renderer of your own (a canvas, a 3D view reading the floor under the pointer) feeds
  it the same way and gets the same presses
- `edgeScroll.step(state, pointer, size, now)` — how far a view scrolls this frame while a press is held at its edge
- `placeNavigation.next(items, fromId, 'left')` — arrow-key movement between places

## Draw

```tsx
import { SeatMap } from 'ichno/react'

// Read-only — a Server Component: no script is sent for it.
;<SeatMap.Root plan={plan} aria-label="Floor plan">
  <SeatMap.Content
    plan={plan}
    status={{ A2: 'booked' }} // your words — exposed as data-status, never read
    disabled={['A2']} // what cannot be picked — drawn in ink; which places those are is yours to say
    selected={['B4']}
    sectionLabel={(section) => names[section.id]}
    groupLabel={(group) => group.label} // what a group's labels say (defaults to its label, or id)
    fixtureVariant={(fixture) => (fixture.role === 'wall' ? 'wall' : 'box')}
  />
</SeatMap.Root>
```

```tsx
'use client'
import { SeatMap } from 'ichno/react'
import { SeatMapViewport, useSeatMapView } from 'ichno/react/client'

// Interactive — pan, wheel/pinch zoom, taps, arrow keys (Enter/Space picks), the same children.
const map = useSeatMapView(plan) // the view, and zoom controls for the buttons you draw
// `disabled` goes to both: Content draws those places in ink, the viewport calls no onPlaceClick for them.
<SeatMapViewport
  plan={plan}
  {...map.viewProps}
  onPlaceClick={(place) => toggle(place.id)}
  disabled={taken}
  className="h-[480px]"
>
  <SeatMap.Content plan={plan} selected={picked} disabled={taken} />
</SeatMapViewport>
<button onClick={map.zoomOut} disabled={!map.canZoomOut}>−</button>
<button onClick={map.fit}>{Math.round(map.level * 100)}%</button>
<button onClick={map.zoomIn} disabled={!map.canZoomIn}>+</button>
```

`ichno/react` holds nothing that runs in the browser: the viewport and its view hook are `ichno/react/client`'s, so a
Server Component that draws a plan with `SeatMap.Root` sends no script for it. `SeatMap` is a module namespace, so in
a client bundle too the members an app never names are left out.

`SeatMap.Content` is a convenience — sections, the floors of the rooms the walls close, the walls, then the objects;
compose the parts yourself when you need something else — `SeatMap.Section`, `SeatMap.Room`, `SeatMap.Wall`,
`SeatMap.Place`, `SeatMap.Fixture`, `SeatMap.Label`, `SeatMap.Grid`, `SeatMap.Handles`, `SeatMap.Outline` and
`SeatMap.Marquee`, fed by `plan.objects`, `plan.walls` and `seatPlan.roomsOf(plan)`; `SeatMap.EditorOverlay` layers
the editing ones (see Edit). A wall paints its band in ink, broken at its openings; each opening's box across the band
is a `data-part="opening"` with its `data-role`, unpainted, for a class to draw a door or a window. `renderPlace` swaps one place's drawing while keeping the rest. Turned places keep their label level.

**Styling.** Parts paint with presentation attributes that read the theme variables, so any class overrides them.
State is on the element: `data-kind` (`place`, `fixture`, `label`, `wall`), `data-role`, `data-group`, `data-shape`,
`data-status`, `data-selected`, `data-disabled`, `data-highlighted`, `data-dimmed`, `data-invalid`,
`data-category`, `data-closed`; pieces are named by `data-part` (`shape`, `label`, `hit`, `floor`, `wall`, `room`,
`opening`, `handle`, `outline`, `marquee`, `focus-ring`, and `editor-overlay` with its `selection`, `hover` and
`stroke`). Style your roles by
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
<SeatMapViewport plan={plan}>
  {(frame) => <SeatMap.Content plan={plan} region={frame.region} scale={frame.scale} />}
</SeatMapViewport>
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
Events are delegated by the parts' `data-ichno-*` attributes; `planTargetOf(element)` reads the same way — what a
right-click landed on, or a handle in an overlay you draw yourself.

**Views** are viewBoxes in plan units (`planView.home(plan)`, `planView.zoom`, `planView.pan`, `planView.pinch`,
`planView.fitTo` for zoom-to-places), so nothing is measured while rendering. Zoom goes from the home view (the
whole drawing) in to 6×, and zooming out stops at the home view exactly. `planView.home(plan, margin)` leaves that
many plan units round the drawing; give the viewport that view as `home`, or `useSeatMapView(plan, { margin })`,
and the drawing keeps off the edges. A viewport of another shape shows more
than its view — `planView.visible(view, size)` is what it shows. `planView.toScreen(view, size, point)` is where a
plan point shows in the viewport, in pixels from its top-left — the anchor for a tooltip above a place or a popover
beside a table, following the view as it moves. Leave `view` out and the viewport keeps its own.
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
import { SeatMap } from 'ichno/react'
import { SeatMapViewport, useSeatMapView } from 'ichno/react/client'

const editor = useSeatPlanEditor({ initialPlan, lockedIds: bookedSeatIds, snap: { cell: 50 } })
const map = useSeatMapView(editor.plan)
// arrows, Delete, R / ⇧R, Escape, Enter / ⇧Enter, ⌘A, ⌘C / ⌘X / ⌘V, ⌘D, ⌘G / ⇧⌘G, ⌘] / ⌘[, ⌘Z / ⇧⌘Z —
// and with the view, + / − / ⇧1 / ⇧2
useSeatPlanEditorShortcuts(editor, { view: map })

<SeatMapViewport {...editor.viewportProps} {...map.viewProps} wheel="pan">
  <SeatMap.Grid plan={editor.displayPlan} />
  <SeatMap.Content plan={editor.displayPlan} selected={editor.selectedPlaceIds} invalid={editor.conflictIds} />
  {editor.draft && (
    <g opacity={0.5} pointerEvents="none">
      <SeatMap.Content plan={editor.draft} invalid={editor.conflictIds} />
    </g>
  )}
  <SeatMap.EditorOverlay {...editor.overlayProps} />
</SeatMapViewport>

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

The editor itself lives outside React: `createSeatPlanEditor(options)` is a store with every command on it
(`editor.commands`), and the hook is that store bound to a component — it redraws with every change. `editor.store`
is the same store, for the parts of an app that should not: `getState`, `getInitialState` and `subscribe` are the shape
`useSyncExternalStore` and zustand's `useStore` take, so a panel follows one slice and stays still through a drag.
What `getState()` answers with is what the hook returns, less the commands; whatever a change does not reach — the
selection's lists, the still part of the plan — is the same object as before.

```tsx
import { useSyncExternalStore } from 'react'

function UndoButton({ store }: { store: SeatPlanEditorStore<SectionId> }) {
  const canUndo = useSyncExternalStore(
    store.subscribe,
    () => store.getState().canUndo,
    () => false,
  )
  return (
    <button disabled={!canUndo} onClick={store.commands.undo}>
      Undo
    </button>
  )
}

// Without React — a test, a script:
const editor = createSeatPlanEditor({ initialPlan })
editor.commands.addFixtures([{ x: 100, y: 100, w: 200, h: 80 }], { role: 'stage' })
editor.getState().plan // the document, with the stage in it
```

Tapping a grouped object selects its group; tapping it again selects the object alone (shift/⌘ adds to the
selection). Dragging moves the selection with the snapping the commit will use — with Shift along one axis, with
Alt a copy, leaving the original (`PlanDrag.copy`).
Dragging empty floor draws a marquee that selects everything it touches, walls included; a selected section moves
instead, with what stands in it — its places, every group holding one (whole) and the loose fixtures inside its
outline — keeping its shape against the plan's edge. A wall drags as soon as it is pressed; a closed one carries what
stands in the room it goes round and the walls inside it, and an Alt-drag copies the room whole. Space
and the middle mouse button pan. `cancel()` (Escape) drops the drag, marquee or stroke under way — what was
dragged goes back and letting go changes nothing. Nothing stops you from dragging one place onto another; `conflictIds` lists the
places that overlap (the same check the schema runs on save) so you can mark them while arranging. A single
selected item shows handles: an object resizes from its corners (in its own turned frame; Shift keeps its
proportions) and turns from the knob above it (Shift: 15° steps), a group turns as one about the centre of its
frame — the box around its members in the direction the group faces (`group.rotation`), which turns with it, so the
centre stays put turn after turn — and a section's or a wall's handles reshape it: drag a vertex to move it (drop it
on its neighbour to take it away), the middle of an edge to push it straight out or in — the loose fixtures standing
against it go along — or the middle with Alt to add a vertex there. A wall's openings keep their place along their
edge (moved back within one that got shorter, dropped from one shorter than they are wide), and the corners and ends
of other walls lying on a reshaped wall stay joined to it. Several selected items show
one knob above the box around them that
turns them together about the middle of their centres, as `rotateSelected` does (its owner is
`{ kind: 'selection' }`). `frame` outlines the selected object or group, or the box around several; corner and edge
handles carry the `angle` they resize along, so `SeatMap.Handles` shows matching resize cursors. `frames`
outlines every selected item and `hoverFrame` what a tap would select, so fixtures and groups show they are
selected too. `SeatMap.EditorOverlay` draws all of it in order — the selection's outlines, the hover outline, the
handles, the marquee and a tool's stroke — from `overlayProps`; draw the pieces yourself with `SeatMap.Outline`,
`SeatMap.Handles` and `SeatMap.Marquee` when you want another order or look. `selectionBounds` is what the
selection covers, for `map.zoomTo`. With `guides: true` a move snaps to the edges and centre lines of what stands
around it — every unit (a group as one), section, and both faces of every wall edge — and to the spacing between its
neighbours, and a level object's corner and a tool's stroke to those lines, within 6 screen pixels and ahead of the
grid; ⌘ or Ctrl held lets go. A wall being drawn (a `path` tool) lines up with the corners of other walls only
(`planGuides.wallTargetsOf`), and a move that takes walls along is left to the grid, so walls stay where the grid
puts them. Walls keep a step of their own — `snap: { cell: 50, wall: 100 }` puts their corners on whole metres for a
path tool's strokes, their vertex and edge handles and moves; it is half a cell unless given.
`overlayProps.guides` are the lines and equal gaps to draw (`planGuides` is the math, for other renderers). `rotateSelected` turns one item about its own centre and several together about
the middle of their centres. `displayPlan` is the plan with the drag in progress; `plan` is what you save. A
selection never holds what an undo, a redo or an edit took away.

**Large plans.** While a drag or a `preview` changes some objects, `stillPlan` is the plan without them and
`movingPlan` only them (no sections or walls; null while nothing moves). The still part keeps its identity for the whole drag,
and so do `selectedPlaceIds` and `conflictIds` while they say the same, so `SeatMap.Content` — which skips redrawing
when its props are unchanged — draws it once per drag; only the moving part redraws each frame. Overlaps are checked
for what moves only. A drag of a section or a wall, or of more than half the objects, is drawn as one layer (`stillPlan` is then
`displayPlan`). With 20,000 seats a row drags at the idle frame rate zoomed in; drawing `displayPlan` in one layer
redraws every place in view on every move.

```tsx
<SeatMapViewport {...editor.viewportProps} {...map.viewProps}>
  {(frame) => (
    <>
      <SeatMap.Content
        plan={editor.stillPlan}
        selected={editor.selectedPlaceIds}
        invalid={editor.conflictIds}
        region={frame.region}
        scale={frame.scale}
      />
      {editor.movingPlan && (
        <SeatMap.Content
          plan={editor.movingPlan}
          selected={editor.selectedPlaceIds}
          invalid={editor.conflictIds}
          scale={frame.scale}
        />
      )}
      <SeatMap.EditorOverlay {...editor.overlayProps} />
    </>
  )}
</SeatMapViewport>
```

Whatever else you pass `Content` (`status`, `disabled` and the other id lists, label functions) must keep its identity too — compile your app with the
React Compiler, or hold them steady yourself.

### Creation tools

Rows, tables and booths are your words, so the tools that make them are yours too: an `EditorTool` says what a drag
draws and turns the stroke into a plan. Pick one with `setTool`; every press on the plan then draws with it — the
editor shows what it would make under the pointer (`draft`) and while the stroke is drawn, commits it as one undo
step when it is let go, selects what it made and goes back to selecting (`keep: true` stays).

```ts
import { layout, seatPlan } from 'ichno'
import { planEdits, type EditorTool } from 'ichno/editor'

// A row along the stroke, a seat for every 50 units of it — a tap drops a single seat.
const row: EditorTool<'hall'> = {
  id: 'row',
  draw: 'line',
  create(plan, { start, end }) {
    const section = seatPlan.sectionAt(plan, start)
    if (section === null) return null // every place belongs to a section
    const count = Math.floor(Math.hypot(end.x - start.x, end.y - start.y) / 50) + 1
    const seats = layout.line({ start, end, count, size: 45 })
    return planEdits.addPlaces(plan, section, seats, { role: 'seat' })?.plan ?? null
  },
}

<button aria-pressed={editor.tool?.id === 'row'} onClick={() => editor.setTool(row)}>Row</button>
```

`draw` is `box` (a rectangle between the press and the pointer; Shift keeps it square), `line` (Shift keeps it to
15° steps, ending where the pointer falls on that direction — on the grid for a level or upright one), `point` (only where the pointer is — a stamp), `polygon` (a corner at every tap, Shift keeping the edge
to 15° steps; tapping the first corner, or the last one again, or Enter closes it, Backspace takes a corner back,
Escape drops it; a drag before the first corner draws a rectangle instead, Shift a square — `create` gets the corners
in `stroke.points`, and `corners`, `closePolygon`, `removePoint` and `addPoint` (a corner exactly where you say, for
a typed length) are on the editor) or `path` — a polygon that may stay open, for walls: tapping its first corner
closes it (`stroke.closed`), tapping its last one again or Enter ends it open, a dragged rectangle comes closed, and a
corner within 6 screen pixels of a wall lands on it, so the walls meet. Alt draws a box or a line from its centre. Strokes snap
like everything else. A tap is a stroke with no length, so one tool both draws at any size and drops something of a
standard size. `snap: false` on a tool hands it the pointer as it is, in whole units — no grid, no guides — for a tool
that places what it makes itself. `create` runs for every preview — keep it pure. `stroke` is the stroke being drawn (draw it as a
guide), `pointer` where a tap would draw — with `draft` null there, the tool can make nothing at that spot (say
why). While a tool is active the handles hide; Escape drops the stroke, then the tool.

The playground builds its own this way — one place or fixture each (seats, desks, booths, standing areas sized by
their floor, tables), a wall put up a metre at a time (a `point` tool whose `create` calls `planEdits.buildWall`, the
wheel turning the next piece), a room dragged out on the metre grid (a `path` tool), a door put in the nearest wall
(`seatPlan.openingAt` and `planEdits.addOpening`) — and lays out a group it reads as a row or a table again while
keeping its numbering:
[`site/app/playground/_lib/build.ts`](https://github.com/kecan0406/ichno/blob/main/site/app/playground/_lib/build.ts).
Copy what fits; it is yours to change, not part of ichno.

### Handles of your own

What a row's end does when dragged is yours to say, like what a row is. An `EditorHandles` set puts handles on the
one selected item it is for — ichno draws them with its own (`SeatMap.Handles`, named `<set>:<name>` in
`data-ichno-handle`), previews every move and commits the drag as one undo step:

```ts
import { seatPlan } from 'ichno'
import { type EditorHandles } from 'ichno/editor'

const rowEnds: EditorHandles<'hall'> = {
  id: 'row',
  of(plan, item) {
    if (item.kind !== 'group' || seatPlan.groupById(plan, item.id)?.role !== 'row') return []
    const seats = seatPlan.membersOf(plan, item.id)
    return [{ name: 'end', point: seatPlan.centerOf(seats.at(-1)!) }]
  },
  // Called with the plan as it was at the press and the total since — for the preview, then for the commit.
  // `lengthenedRow` is yours: `layout.line` from the first seat to the new end, then `planEdits.layoutGroup`.
  drag(plan, { owner, name }, { total }) {
    return name === 'end' ? lengthenedRow(plan, owner.id, total) : null
  },
}

const editor = useSeatPlanEditor({ initialPlan, handles: [rowEnds] })
```

`of` decides which items have handles — ichno never reads a role. They show with ichno's own for that item (a
group's turning knob) and hide while a tool is active. The playground's row handles — drag the last seat to make the
row longer, a seat every pitch, the middle to bend it — are `rowHandles` in
[`site/app/playground/_lib/build.ts`](https://github.com/kecan0406/ichno/blob/main/site/app/playground/_lib/build.ts).

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

Operations take object and group ids alike — a group acts as one. Moving, copying and removing take wall ids too.

- **Create:** `addPlaces(section, boxes, { shape, capacity, role, category, group })`, `addFixtures(boxes, …)`,
  `addLabels(groupId, boxes)`, `insert(template, at)`, `duplicateSelected` (duplicating the copies again repeats
  how far they were moved), `groupSelected` — each returns the new
  ids and selects them (`group: { role, label }` makes a new group in the same step). New places continue the
  section numbering.
- **Change:** `layoutGroup(groupId, boxes)` (grow, shrink or bend a row — members move onto the boxes, extra boxes
  get new places, surplus ones go from the end), `arrange(ids, boxes)`, `convert(ids, 'place' | 'fixture')` (book a
  table whole), `rotateSelected(degrees)`, `moveSelected(delta)` (objects, groups, walls and sections), `alignSelected`,
  `distributeSelected`, `label(ids, sequence)` with `labeling.numbers`, `labeling.letters({ skip: ['I'] })` or
  `labeling.custom`, `assign(ids, props)` and `assignSelected(props)` (shape, capacity, role, category or tags on
  many objects in one step — a group through its members, `undefined` clears an optional one, values the schema
  would refuse are refused), `renameObject` (objects and groups), `updateObject`, `updateGroup`, `ungroup`,
  `ungroupSelected`, `addSection({ id, points })` (inside the plan; selects it), `moveSection` (with what stands in
  it), `reshapeSection`, `addWall({ points, thickness, closed, openings })` (whole units on the plan; selects it and
  returns its id), `updateWall`, `reshapeWall`, `addOpening(wallId, opening)`, `removeOpening(wallId, index)`,
  `planEdits.buildWall(plan, { points, thickness })` (a wall put up a piece at a time, the way a housing game builds:
  a run joined to the open walls its ends meet — carrying one on, a straight continuation lengthening its last edge,
  linking two into one, or closing one round into a room — their openings kept where they were),
  `reorderSelected('front' | 'back' | 'forward' | 'backward')`.
- **Compose:** `edit(plan => plan)` runs any combination of `planEdits` and `layout` as one undo step.
  `preview(plan => plan)` shows one without committing it — while a slider is dragged — applied to the plan as it is,
  until the next edit or `preview(null)`; `edit` the final value when the slider is let go.
- **Select:** `select(target, additive)` (what a tap selects), `selectAll()`, `setSelection(items)` (exactly these
  objects, groups, walls and sections — for a layers panel), `selectIds(ids)` (exactly these object, group and wall
  ids — for a list of problems or a search), `selectMembers()` and `selectGroups()` (Enter and ⇧Enter).
  `selectedWallIds` and `selectedWall` are the walls in the selection; `selectedIds` stays objects and groups.

`objects` is the drawing order, later on top. `reorderSelected` moves the selection to the front or back, or a step
past the next unit — a group as one, or an object outside one. Units stand in the order of their highest member, so
a group whose members are drawn apart (a table top under everything, its seats on top) is listed where its highest
member is; list your layers that way and a step moves one row.

- **Remove:** `removeObjects` (walls too), `removeSelected`, `removeSection(id)`, `cutSelected` — return the ids they
  refused.
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
in the document: frozen objects, groups and walls are drawn but cannot be tapped, dragged, hovered, marqueed or caught by
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
| `--ichno-surface`           | section and room floors, empty places           |
| `--ichno-fixture`           | fixture faces                                   |
| `--ichno-grid`              | editor grid                                     |
| `--ichno-label`             | outlines, seat numbers, group and fixture names |
| `--ichno-ink`               | walls, disabled places, selection rings         |
| `--ichno-ink-foreground`    | numbers on ink-filled places                    |
| `--ichno-accent`            | picked places, editor selection                 |
| `--ichno-accent-foreground` | numbers on accent-filled places                 |
| `--ichno-warning`           | warning marks                                   |
| `--ichno-guide`             | editor smart guides                             |
| `--ichno-font`              | text font (inherits when unset)                 |
| `--ichno-number-font`       | seat number font (falls back to `--ichno-font`) |

## License

MIT
