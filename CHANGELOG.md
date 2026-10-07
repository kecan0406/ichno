# Changelog

All notable changes to this package. Versions follow semver; before 1.0 a breaking change bumps the minor.

## Unreleased

Breaking — document version 3: primitives instead of built-in object kinds (see `docs/direction.md`).

- `ichno`: document v3 — `objects` hold `place`s (anything bookable, with `shape`, `capacity` and an optional
  `rotation`), `fixture`s (anything else) and `label`s (where a group's label is written), and the new `groups` list
  names sets of objects (a row, a table with its chairs, a desk with its chair). A group's optional `rotation` is
  the way it faces. Desk, row, table, booth and area are
  no longer kinds; they are the consumer's `role` words. Places are stored with their own boxes — a row keeps its
  seats' positions, not its layout. Coordinates stay whole plan units; any object can be turned about its centre.
- `ichno`: `upgradeSeatPlan` now takes 0.1 and 0.2 documents and returns v3, keeping every place id and position:
  a desk becomes its top (the place) and its chair (a fixture) in a group; a row becomes a group of seat places plus a
  label at each end when it had a label; a table becomes a group of its top and seats (booked whole, the top is the
  place and the seats are chairs); booths and areas become places; seats a 0.2 row or table crowded together shrink
  about their centres until they only touch. An area's `wholeBooking` is dropped — whether one booking takes a whole
  place is the consumer's rule.
- `ichno`: `layout.line`, `layout.arc`, `layout.around`, `layout.grid` and `layout.curveOf` compute seat boxes for
  rows, tables and blocks; `TABLE_SEAT_GAP` moved here. `layout.around` spaces the seats of a round or oval top
  evenly along its edge, each the seat gap away and facing it squarely.
- `ichno`: `seatPlan` works on turned shapes — `boundsOf`, `contains`, `overlaps` (with `OVERLAP_TOLERANCE`),
  `outlineOf`, `centerOf`, `extentOf`, `frameOf` (the box around objects in a given direction), `groupById`,
  `membersOf`. `PlanHandle` carries the turned `angle` of a corner. `conflictsOf` returns overlapping place pairs.
  Removed: `rowSeatsOf`, `rowApexOf`, `rowLabelAnchorsOf`, `tableSeatsOf`, `furnitureOf`, `footprintOf`,
  `footprintsOf`, `nextChairSide`, `findFreeDeskPos`, `findFreeFixturePos`, `translate` for rows, and the whole
  `seatGrid` namespace with `HALF_CELL`, `DEFAULT_SEAT_CELLS` and `MIN_SEAT_SIZE`. `GRID_CELL` stays as the editor's
  default cell. Removed types: `Desk`, `Row`, `RowSeat`, `Table`, `TableSeat`, `Booth`, `Area`, `PlaceKind`,
  `SeatChairSide`, `TableShape`, `AreaShape` (and their constant lists); `Place` is now the document object, and
  `Group`, `GroupLabel`, `PlanBox`, `Shape`, `SeatPlanV2` are new.
- `ichno`: `validateSelection` reads lines from groups — a group's places in document order — instead of rows; a
  group with one place forms no line.
- `ichno/schema`: validates v3 and upgrades 0.2 documents while parsing. New issue code `unknown_group`;
  `fixture_overlap` is gone — fixtures may overlap anything, and `overlap` is between places only, on their turned
  shapes. Group labels may sit outside the plan. The 46-unit grid is no longer checked.
- `ichno/react`: parts draw turned boxes (labels stay level) and expose `data-role`, `data-group` and `data-shape`.
  `SeatMap.Label` draws a group's label; `SeatMap.Content` takes `groupLabel`. Removed: `SeatMap.Table`,
  `SeatMap.RowLabel`, `data-chair-side` and the `chair`, `top` and `row-label` parts. `SeatMap.Grid` takes `cell`.
  `PlanTarget` for a place no longer carries `objectId`.
- `ichno/editor`: selection holds objects, groups and sections — tapping a grouped object selects its group, tapping
  again the object. Operations take object and group ids alike. New: `addPlaces`, `addFixtures`, `addLabels`,
  `layoutGroup`, `arrange`, `convert`, `groupSelected`, `ungroup`, `label`, `rotateSelected(degrees)`,
  `moveSelected`, `updateGroup`, `edit` (compose operations into one undo step), a rotation knob on objects and
  groups, and the `snap` option (off by default). A group turns about the centre of its frame and keeps facing
  the way it was turned, so its centre stays put turn after turn; several selected items turn together about the
  middle of their centres. `frame` outlines the selected object or group; pass it to `SeatMap.Handles`, which
  draws it with a stem to the knob and turns the corner cursors with the object. Removed: `addDesk`, `addFixture`, `addRow`, `addTable`, `addBooth`,
  `addArea`, `setSeatCount`, `labelSeats`, `labelObjects`, `rotateDesk`, `moveObject`, `DEFAULT_*` sizes, row end and
  curve handles, and grid normalization on open. `isLocked` takes an id. Shortcuts: R / ⇧R turn the selection a
  quarter, ⌘G groups.
- `ichno/editor`: creation tools — `setTool(tool)` with an `EditorTool` (`draw: 'box' | 'line' | 'point'`,
  `create(plan, stroke)`, optional `keep` and `id`). Presses on the plan then draw strokes: the editor previews what
  the tool would make under the pointer and while the stroke is drawn (`draft`, `stroke`, `pointer`), commits it as
  one undo step, selects what it made and goes back to selecting unless `keep` is set. Strokes snap like moves;
  Shift keeps a box square and a line to 15° steps, Alt draws from the centre, and a tap is a stroke with no
  length. Handles hide while a tool is active.
- `ichno/editor`: `cancel()` drops the stroke, drag or marquee under way — a stroke makes nothing, a drag puts back
  what it moved, a marquee selects nothing — and letting go then changes nothing. `ungroupSelected` dissolves every
  selected group in one step, its members taking its place in the selection.
- `ichno/editor`: saved objects — `planEdits.templateOf(plan, ids)` keeps what a selection holds as a
  `PlanTemplate`, and `planEdits.insertTemplate(plan, template, at, { section })` adds one with fresh ids, in the
  sections it lands in and inside the plan; `editor.insert(template, at)`. A clipboard: `copySelected`,
  `cutSelected`, `paste(at?)` (under the pointer, or beside what was copied) and `clipboard`.
- `ichno/editor`: `selectAll`; `frames` outlines every selected item and `hoverFrame` what a tap would select
  (`planHandles.frames`); `moveSelected` moves selected sections too; the selection drops what an undo, a redo or an
  edit took away. Shift constrains drags — moves keep to one axis, turns step by 15° without snapping, corners keep
  their proportions and vertices move straight (`planHandles.drag` takes `constrain`).
- `ichno/editor`: shortcuts — the arrow keys move the selection (Shift: ten units, or a cell when snapping), Escape
  drops the stroke, drag or marquee under way, then the tool, then the selection, ⌘A selects everything, ⌘C / ⌘X /
  ⌘V copy, cut and paste, and ⇧⌘G ungroups. `useSeatPlanEditorShortcuts(editor, { view })` also zooms — + and −,
  ⇧1 the whole plan, ⇧2 the selection — with `useSeatMapView` or any `ViewControls`. Keys a handler already took
  (`preventDefault`) are left alone.
- `ichno/editor`: `overlayProps` — what the editor draws over the plan, for `SeatMap.EditorOverlay` — and
  `selectionBounds`, what the selection covers, for zooming to it.
- `ichno/editor`: layers panels — `setSelection(items)` selects exactly the given objects, groups and sections, where
  a tap picks a grouped object's group first. `planEdits.reorder(plan, ids, to)` and `reorderSelected(to)` move
  objects and groups in the drawing order: `front`, `back`, or a step `forward` or `backward` past the next unit — a
  group as one, standing where its highest member is drawn. Shortcuts: ⌘] / ⌘[ step forward and backward, ⌥⌘] /
  ⌥⌘[ go to the front and back (with nothing selected they stay the browser's), Enter selects the selected groups'
  members and ⇧Enter the selected objects' groups. Enter on a button, a link or a menu item is left to it.
- `ichno/react`: `useSeatMapView(plan)` keeps the view of a `SeatMap.Viewport` with the controls around it —
  `zoomIn`, `zoomOut`, `fit`, `zoomTo(rects)`, `level` (1: the whole plan), `canZoomIn`, `canZoomOut` — and
  `viewProps` to spread into the viewport.
- `ichno/react`: `SeatMap.EditorOverlay` draws what an editor draws over the plan, in order: the selection's outlines,
  what a tap would select, the handles, the marquee and a tool's stroke (a box outlined, a line drawn along). New
  `data-part`s `selection`, `hover` and `stroke`.
- `ichno`: `PlanTemplate`, `TemplateObject` and `PlanStroke`; `PlanDrag` carries `constrain`.
- `ichno/schema`: `createSeatPlanSchema` also returns `Template`, which checks a stored template's ids and group
  references.
- `ichno/react`: `SeatMap.Viewport` takes `onDraw` (presses draw strokes for a creation tool), `onHover` (the
  pointer while nothing is pressed), `wheel: 'zoom' | 'pan'` and `navigable`. Space held or the middle button pans
  whatever is under the pointer, and the svg carries `data-pan` (`ready`, `active`) with a grab cursor. Wheel zoom
  follows how far the wheel turned, so trackpads zoom smoothly, and Safari's trackpad pinch zooms the plan instead of
  the page (on a touch screen the fingers' own pointers zoom, never Safari's gesture events as well). With
  `onMarquee`, a mouse drag on empty space outside every section draws a marquee instead of panning (touch still
  pans). Enter and Space pick only the place the focus ring shows, and focus from the keyboard shows the ring at
  once. New part `SeatMap.Outline` draws the editor's `frames` and `hoverFrame`.
- `ichno/react`: drags, marquees and strokes are followed in plan units, so what is dragged stays under the pointer
  when the view zooms or scrolls mid-drag. Held near the viewport's edge, they scroll the plan toward it — after a
  moment, faster the closer the pointer is, and only until the drawing's edge is in view (as tldraw's edge
  scrolling and React Flow's auto-pan do).
- `ichno/react`: a two-finger pinch keeps the plan point between the fingers under them; it drifted as the fingers
  moved while spreading (`planView.pinch` is the math).
- `ichno`: `planView.zoom` — and with it the viewport's wheel and pinch — zooms out no further than the home view
  (the whole drawing). It went to 90% of it, and the step cut short there put every later step off the home view:
  zooming in and back out stopped at 99% instead of 100%. `planView.fitTo` frames no further out than the home view
  either.
- `ichno/react`: large plans — the frame's `region` covers what the viewport shows. A viewport of another shape
  than its view shows plan beyond the view, and places there were left out while visible. Arrow-key focus recentres
  only on a place outside what is shown. New: `planView.visible(view, size)`.
- `ichno/react`: a press whose release never arrives — pointer capture lost, a menu that opened mid-drag — ends
  where it last was instead of dragging on with no button held, and the context menu stays shut while a press is
  under way.
- `ichno/editor`: `markSaved(saved?)` makes the plan you stored the baseline `dirty` compares against and `reset`
  goes back to, keeping history and selection — no remount after saving. Edits made while a save was under way stay
  dirty.
- `ichno/editor`: `planEdits.assign(plan, ids, props)`, `editor.assign(ids, props)` and `assignSelected(props)` set
  `shape`, `capacity`, `role`, `category` or `tags` on many objects in one step — a group through its members, each
  on the objects that have it; `undefined` clears an optional one. Values the schema would refuse (a capacity below
  one, a padded role, an unknown category, an empty tag) are refused. New type `ObjectProps`.
- `ichno`: `seatPlan.boundsOfIds(plan, ids)` — what objects and groups cover, to zoom to — and
  `seatPlan.orderAlong(plan, ids, degrees)`, ids in the order they come along a direction (a group by its frame), to
  label seats and rows the way people read them. `issueIdsOf(issue)` reads the objects a schema issue or a lint
  result is about.
- `ichno/editor`: `selectIds(ids)` selects exactly these object and group ids; `selectMembers()` and
  `selectGroups()` are what Enter and ⇧Enter do, for menus. `preview(update)` shows an edit without committing it —
  while a slider is dragged — applied to the plan as it is, until the next edit or `preview(null)`.
- `ichno/editor`: an Alt-drag moves a copy and leaves the original (`PlanDrag.copy`, reported by the viewport while
  Alt is held), selecting the copies — a group as a new group. Duplicating the copies again repeats how far they were
  moved: duplicate, move the copy, ⌘D, and the next one lands as far on.
- `ichno/editor`: `frozenIds` and `hiddenIds` — a layers panel's lock and eye, kept outside the document. Frozen
  objects and groups (and a frozen group's members) are drawn but cannot be tapped, dragged, hovered, marqueed or
  selected with ⌘A; a drag that starts on one draws a marquee. Hidden ones are also left out of `displayPlan` (and
  so the viewport's plan); `conflictIds` still counts them. `setSelection` and `selectIds` select both.
- `ichno/editor`: sections are drawn and removed in the editor. `EditorTool.draw` takes `'polygon'`: a corner at
  every tap (Shift keeps the edge to 15° steps), closed by tapping the first corner or the last one again, or Enter
  (`closePolygon`); Backspace takes a corner back (`removePoint`), Escape drops it (`cancel`). `create` gets the
  corners in the new `PlanStroke.points`; `corners` are the ones placed so far. `planEdits.addSection` /
  `editor.addSection` add one (selected, as a polygon tool's section is); `planEdits.removeSection` /
  `editor.removeSection` and `removeSelected` remove one with its places, every group holding one (whole) and the
  loose fixtures inside it — or nothing, when any of that is locked.
- `ichno/editor`: a selected section shows a handle in the middle of each edge (`edge-<index>`) that adds a vertex
  there, and a vertex dropped on its neighbour merges with it while three remain (within 8 screen pixels — viewports
  report `pixel`, the plan units a screen pixel spans, on `PlanDrag` and on strokes; `planHandles.drag` takes it).
- `ichno/react`: `SeatMap.EditorOverlay` draws a polygon being drawn — its edges, a fainter one back to the first
  corner and that corner marked (`data-part="stroke-start"`). `SeatMap.Handles` draws edge handles smaller and round.
- `ichno/editor`: several selected items show one rotation knob above the box around them (`frame`), turning them
  together about the middle of their centres as `rotateSelected` does — Shift or snapping in 15° steps; the box and
  the knob turn with the pointer. `HandleOwner` gains `{ kind: 'selection' }`; `planHandles.selectionTurn` is the
  turn a drag of that knob makes, and `planHandles.of` and `frame` take it to draw the knob mid-turn. Taps on handles
  leave the selection as it is.
- `ichno/editor`: handles of your own — `useSeatPlanEditor({ handles })` takes `EditorHandles` sets: `of(plan, item)`
  gives the handles for the one selected item, `drag(plan, handle, { total, constrain, snap, pixel })` the plan with
  one dragged. ichno draws them beside its own (named `<set>:<name>`), previews every move and commits the drag as one
  undo step; it never reads what the item is. The playground's rows get an end handle (longer or shorter, a seat
  every pitch) and a curve handle this way.

## 0.2.1 — 2026-09-25

- `ichno/react`: seat, row label, whole-table chair and handle coordinates are printed rounded to hundredths.
  Server-rendered plans with rows or tables inside `SeatMap.Viewport` no longer fail hydration when the server's
  JavaScript engine computes the last digits of a seat position differently from the browser's.
- `ichno/editor`: a selected table's corner handles sit just outside its seats instead of on the corners of the
  top, where they covered the chairs. Dragging one still resizes the top.

## 0.2.0 — 2026-09-24

Breaking — document version 2, and the canvas renderers are gone (see `docs/direction.md`).

- `ichno`: document v2 — `sections` (polygons) replace `zones`, and `objects` hold desks (the 0.1 seats), curved
  rows, tables, booths, general-admission areas and fixtures (`role` replaces `kind`). Places carry an optional
  `label` separate from the booking `id`, plus `category` and `tags`; plans list their `categories`.
- `ichno`: `seatPlan.placesOf`, `rowSeatsOf`, `tableSeatsOf`, `sectionAt`, `sectionWallOf`, `sectionPlanOf(s)`,
  `nextPlaceId`, `nextObjectId`, `footprintOf`, `boundsOf` and `translate`. Renamed: `zonePlanOf(s)` →
  `sectionPlanOf(s)`, `nextSeatId` → `nextPlaceId`, `findFreeSeatPos` → `findFreeDeskPos`, `showsZoneLabels` →
  `showsSectionLabels`, `ZONE_LABEL_*` → `SECTION_LABEL_*`, `seatGrid.*Zone*` → `seatGrid.*Section*`. Removed:
  `byId`, `zoneAt`, `FIXTURE_KINDS`, `FIXTURE_DEFAULT_SIZE`.
- `ichno`: `lintSeatPlan` (soft rules with consumer severities), `validateSelection` (count limits, consecutive
  seats, orphan seats) and `upgradeSeatPlan` (0.1 → 2).
- `ichno`: interaction core, independent of any renderer — `spatialIndex` (bucket-grid index for hit-testing and
  area queries), `gesture` (a pure pointer state machine for tap, drag, pan and pinch) and `placeNavigation`
  (arrow-key movement between places).
- `ichno/schema`: `createSeatPlanSchema({ sectionIds })` validates v2 and upgrades 0.1 documents while parsing.
  Issue codes are now `duplicate_section`, `duplicate_category`, `duplicate_id`, `unknown_category`,
  `out_of_bounds`, `overlap` and `fixture_overlap`.
- `ichno/editor`: works on v2 — `addDesk`, `addFixture(role, size)`, `updateObject`, `moveObject`, `moveSection`,
  `reshapeSection`, `removeObject`, `renameObject`, `rotateDesk`; selection is `{ kind: 'object' | 'section' }`.
  `stageProps` is gone with the canvas.
- `ichno/react` (new): headless SVG components — `SeatMap.Root`, `Content`, `Section`, `Place`, `Fixture`,
  `Table` and `Grid` render as React Server Components and expose state as `data-*` attributes; `SeatMap.Viewport`
  adds pan, wheel/pinch zoom, taps, target drags and arrow-key focus (listbox semantics) on the client.
- `ichno`: views are viewBoxes in plan units — `planView.home/zoom/pan/fitTo` and `PlanView` replace `fitView`,
  `zoomView`, `centerZoom`, `fitScaleOf`, `SeatMapView` and `ViewportSize`. New `PlanTarget` and `PlanDrag` types.
- `ichno/editor`: `viewportProps` (tap to select, drag to move with snapping), `displayPlan` (the drag in
  progress) and `selectedPlaceIds`.
- `ichno/editor`: row, table, booth and area tools, `setSeatCount`, labeling, multi-selection (`selection` is now
  a list; shift/⌘ taps add), group drags, `alignSelected`, `distributeSelected`, `duplicateSelected`, undo/redo
  (`⌘Z`, `⇧⌘Z`, `⌘D` in the shortcuts hook) and `lockedIds`. `removeObject` became `removeObjects`, which returns
  the ids it refused. The operations are exported as pure functions in `planEdits`.
- `ichno`: `PLACE_ID_MAX` (8) and `OBJECT_ID_MAX` (16). Editor operations never create an id the schema would
  refuse: adds return null, `nextObjectId` shortens long prefixes, `rename` checks the new id and also renames
  seats inside rows and tables. Moves and resizes keep the whole object — table seats, a row's far end — inside
  the plan.
- `ichno/editor`: calls in one handler build on each other (add a table, then set its seat count); edits that
  change nothing leave the undo and redo history alone.
- `ichno/schema`: a 0.1 fixture whose id a seat also uses is renamed on upgrade (v1 kept the two apart).
- `ichno/react`: after a pinch the remaining finger always pans; horizontal wheel swipes no longer zoom.
- `ichno`: `labeling.numbers`, `labeling.letters` (skipped letters, AA after Z) and `labeling.custom`.
- `ichno/react`: `onTap` also reports the plan point and whether the tap was additive.
- `ichno/react`: marquee selection (`onMarquee`; drags that start on something that does not move draw a
  rectangle), middle-button panning, and the `SeatMap.RowLabel`, `SeatMap.Handles` and `SeatMap.Marquee` parts.
  `SeatMap.Content` draws row labels.
- `ichno/editor`: `handles` for a single selected item — corners resize, row ends and the curve handle reshape a
  row, section vertices reshape the outline — and `marquee`. A section moves only once selected. The handle rules
  are pure functions in `planHandles`.
- `ichno/react`: large plans — `SeatMap.Viewport` accepts a function child that gets a `ViewportFrame`
  (`region`, `scale`), and `SeatMap.Content` takes `region` (cull), `scale` and `minLabelPx` (label level of
  detail). The viewport no longer reads layout during gestures; it keeps its size with a ResizeObserver.
- `ichno`: `seatPlan.conflictsOf` (overlapping footprints, fixtures on places) — the schema and the editor share
  it. Rows claim their seats (`seatPlan.footprintsOf`), not their bounding box, so curved and diagonal rows side
  by side are not reported as overlapping. `ichno/editor` exposes `conflictIds`; `SeatMap.Content` / `Place` / `Fixture` take `invalid` and mark it
  with `data-invalid` and the warning colour. Row end handles sit beside the end seats instead of on them.
- `ichno`: `planView.scaleOf`, `toPlan`, `region`, `contains` and `scaleStep`; `ViewportSize`.
- `ichno`: `PlanHandle`, `HandleOwner` and a `handle` kind in `PlanTarget`; `seatPlan.objectsInRect`,
  `seatPlan.rowApexOf` and `seatPlan.rowLabelAnchorsOf`.
- Removed `ichno/svg` and `ichno/konva` (replaced by `ichno/react`), the `konva` / `react-konva` peer
  dependencies and the `--ichno-occupied-tint` variable.

## 0.1.0 — 2026-09-24

First release.

- `ichno`: document types, grid snapping (`seatGrid`), geometry (`seatPlan`: furniture layout, zone crops, free-spot
  search, id generation), view math (`fitView`, `zoomView`, `centerZoom`) and the theme variable contract.
- `ichno/schema`: `createSeatPlanSchema({ zoneIds })` and `seatPlanIssueOf` with structured issue codes.
- `ichno/svg`: `SeatMapSvg`, a read-only plan that renders on the server.
- `ichno/konva`: `SeatMapStage` (pan, zoom, pick) and `SeatPlanEditorStage` (drag to arrange).
- `ichno/editor`: `useSeatPlanEditor` and `useSeatPlanEditorShortcuts`.
