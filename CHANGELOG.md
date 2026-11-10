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
- `ichno`, `ichno/react`: a margin round the whole plan — `planView.home(plan, margin)`, `useSeatMapView(plan, {
margin })` and a `home` prop on `SeatMap.Viewport` (the widest view, which `viewProps` now carries), so a
  drawing no longer has to touch the viewport's edges. None by default.
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
- `ichno`: `seatPlan.groupLabelOf(label, text)` — a group label's text and font size as `SeatMap.Label` writes it,
  the counterpart of `fixtureLabelOf` for renderers of your own (a 3D view that should write what the 2D view
  writes).
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
  (`closePolygon`); Backspace takes a corner back (`removePoint`), Escape drops it (`cancel`). A drag before the
  first corner draws a rectangle instead (Shift: a square), made with its four corners when let go. `addPoint(point)`
  places the next corner exactly where you say — a length typed in. `create` gets the corners in the new
  `PlanStroke.points`; `corners` are the ones placed so far. `planEdits.addSection` /
  `editor.addSection` add one inside the plan (selected, as a polygon tool's section is); `planEdits.removeSection` /
  `editor.removeSection` and `removeSelected` remove one with its places, every group holding one (whole) and the
  loose fixtures inside it — or nothing, when any of that is locked.
- `ichno/editor`: a selected section shows a handle in the middle of each edge (`edge-<index>`) that pushes that wall
  straight out or in — both its corners, onto a cell line when snapping a level or upright edge, stopping a step short
  of the far side and at the plan's edge — and takes the loose fixtures standing against it or across it (a door in
  its wall) along. With Alt (`PlanDrag.copy`) it adds a vertex there instead; `planHandles.drag` takes `alt` after
  `pixel`. A vertex dropped on its neighbour merges with it while three remain (within 8 screen pixels — viewports
  report `pixel`, the plan units a screen pixel spans, on `PlanDrag` and on strokes; `planHandles.drag` takes it).
- `ichno/react`: `SeatMap.EditorOverlay` draws a polygon being drawn — its edges, a fainter one back to the first
  corner and that corner marked (`data-part="stroke-start"`). `SeatMap.Handles` draws edge handles smaller and round,
  with a resize cursor across the edge (edge handles carry that `angle`).
- `ichno/editor`: moving a section takes what stands in it, the way a room moves with its furniture —
  `planEdits.moveSection`, a drag of a selected section and `moveSelected` move its places, every group holding one
  (whole) and the loose fixtures inside its outline (what `removeSection` takes) by the same whole cells. Its places
  keep it; a place it carries for a group lands in the section under it, as a move does. The outline keeps its shape:
  it is held inside the plan as a whole, with what it carries. Before, only the outline moved, each vertex held
  inside the plan on its own.
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
- `ichno/editor`: smart guides, opt-in with `useSeatPlanEditor({ guides: true })`. A move snaps to the edges and
  centre lines of every unit (a group as one) and section around it, or to the spacing between its neighbours —
  halfway, or repeating the gap beside one; a level object's corner and a tool's stroke snap to those lines. Within 6
  screen pixels, ahead of the grid (`planEdits.move` and `applyDrag` take the `exact` axes a guide took); ⌘ or Ctrl
  held lets go (`PlanDrag.free`, and `free` on strokes). `overlayProps.guides` are the guides to draw; `planGuides`
  (`targetsOf`, `snapMove`, `snapPoint`) is the math. New type `PlanGuide` (`ichno`).
- `ichno/react`: `SeatMap.EditorOverlay` draws `guides` — lines and equal gaps (`data-part` `guides`, `guide`,
  `gap`) in the new `--ichno-guide` colour. The viewport reports ⌘ or Ctrl on drags and strokes (`free`) and
  `pixel` to `onHover`.
- `ichno/editor`: large plans drag without redrawing everything — `stillPlan` (the plan without what a drag or a
  preview changes, keeping its identity for the whole drag) and `movingPlan` (only what moves, without sections; null
  otherwise). Overlaps are checked for what moves only during a drag, and `conflictIds`, `selectedPlaceIds` and the
  selection lists keep their identity while they say the same. With 20,000 seats a row now drags at the idle frame
  rate zoomed in (was about twice it). A drag of a section or of more than half the objects is drawn as one layer.
- `ichno/react`: `SeatMap.Content` skips redrawing when its props are the ones it last drew with (`memo`), so the layer
  drawing an editor's `stillPlan` stays put while only the moving part redraws.
- `ichno`: walls — the document gains `walls`: each a centre line through `points` (back to the first when
  `closed`), `thickness` plan units across, with `openings` cut in it (`edge`, `at`, `width` and your `role` — a
  door, a window). Documents saved without the field read as having none, and 0.1 and 0.2 documents upgrade to none.
  Objects, groups and walls share one id namespace. Rooms are not stored: `seatPlan.roomsOf(plan)` finds the areas
  walls close — a closed wall round one, a partition across it making two, rooms built side by side sharing their
  wall, an open wall's end within half a thickness of another wall meeting it — and `roomAt` the innermost one round
  a point. Also new: `wallOf`, `wallEdgesOf`, `wallOutlineOf` (the band a wall paints — mitred corners, broken at its
  openings), `wallBoundsOf`, `wallsInRect`, `openingsOf`, `openingAt` (where an opening of a width goes for a point,
  or why it cannot: `far`, `short`, `taken`) and `areaOf`. `drawingBoundsOf` and section crops take walls in. New
  types `Wall`, `WallOpening`, `Room`, `WallEdge`, `OpeningShape`; `PlanTarget` and `HandleOwner` gain
  `{ kind: 'wall' }`, `PlanStroke` gains `closed`.
- `ichno/schema`: walls are checked — their ids against every other id (`duplicate_id`), their centre line on the
  plan (`out_of_bounds`; the band may reach past the edge by half its thickness), and the new issue code
  `opening_off_wall` for an opening whose edge is not there or that runs past its end. `createSeatPlanSchema` also
  returns `Wall` and `Opening`.
- `ichno/react`: `SeatMap.Wall` paints a wall's band in ink, broken at its openings, each opening's box across the
  band a `data-part="opening"` with its `data-role`, unpainted for a class to draw a door or a window;
  `SeatMap.Room` paints a room's floor. `SeatMap.Content` draws the rooms' floors and the walls between the sections
  and the objects, and marks the walls in `selected`. The viewport reports a wall as a target (`data-ichno-wall`);
  `SeatMap.EditorOverlay` draws a `path` stroke.
- `ichno/editor`: walls are edited like objects — tapped, dragged, marqueed, caught by ⌘A, moved by the arrow keys,
  deleted, duplicated, frozen and hidden (`EditorSelection` gains `{ kind: 'wall' }`; `selectedWallIds` and
  `selectedWall` list them, `selectedIds` stays objects and groups). A closed wall carries what stands in the room it
  goes round and the walls inside it; an Alt-drag or ⌘D copies the room whole. A selected wall shows a handle on
  every vertex and in the middle of every edge, working as a section's do; the corners and ends of other walls lying
  on it stay joined when it is reshaped, and its openings keep their place along their edge — moved back within one
  that got shorter, dropped from one shorter than they are wide. New `draw: 'path'` for a tool: corners like a
  polygon's, closed on the first corner (`stroke.closed`), ended open on the last one or with Enter, a dragged
  rectangle closed, and a corner near a wall landing on it. New operations `planEdits.addWall`, `reshapeWall`,
  `addOpening` and `removeOpening`, and on the editor `addWall`, `updateWall`, `reshapeWall`, `addOpening` and
  `removeOpening`; `planEdits.move`, `remove`, `rename`, `duplicate` and `applyDrag` take wall ids (`move` takes
  `carry`). Smart guides line up with walls. A drag that changes walls is drawn as one layer (`movingPlan` holds no
  walls).
- `ichno`: `GRID_CELL` is 50 (was 46, the desk cell ichno started with) — half a metre when a plan unit is a
  centimetre, the scale ichno's defaults now read units at (they still have no size of their own); snapping lands on
  25 cm steps. `SeatMap.Grid`, section crops, the editor's duplicate and paste offsets (two cells) and the margin
  `zoomTo` leaves (two cells) follow it, and the spatial index's default bucket is 200. Plans laid out on the old cell
  keep it with `snap: { cell: 46 }` and `<SeatMap.Grid cell={46}>`.
- `ichno/editor`: walls stay on the grid while they are drawn. A `path` tool's corners line up with the corners of
  other walls only (`planGuides.wallTargetsOf`) — before, smart guides pulled them onto furniture edges and the outer
  faces of walls, up to 6 screen pixels away (more than half a grid step at the whole-plan zoom), so walls came out
  0.95 m or 1.05 m long. A move that takes walls along is no longer lined up by the guides. `planGuides.targetsOf`
  gives each wall edge's band (both faces and the centre line) instead of the box round the whole wall, so furniture
  lines up flush with the inside of a room. A constrained (Shift) line ends where the pointer falls on its 15°
  direction — level and upright ones on the grid — instead of keeping the pointer's distance, which stretched a
  slightly slanted drag past the grid.
- `ichno/editor`: walls keep a step of their own — `Snap.wall` (`snap: { cell: 50, wall: 100 }` for whole metres; half
  a cell unless given). A path tool's strokes, a wall's vertex and edge handles, `reshapeWall` and moves that take
  walls along land on it. New `planEdits.buildWall(plan, { points, thickness })` puts a wall up a piece at a time: the
  run joins the open walls its ends meet — carrying one on (a straight continuation lengthens its last edge), linking
  two into one (the second folded in, its openings kept where they were) or closing one round into a room — and is a
  new wall where it meets none; null along a wall already there or off the plan. `EditorTool.snap: false` hands a
  tool the pointer as it is, in whole units — neither the grid nor the guides move it — for one that places what it
  makes itself (the playground's wall piece, hinged on a wall's end).
- `ichno`: `layout` rounds a seat box that falls on a half the same way on every engine. An odd seat (45) on a whole
  centre lands on a half, and sines and cosines differ in their last bits between engines, so a server and a browser
  laying out the same row put a seat a unit apart — a hydration mismatch in a server-rendered plan.
- `ichno/editor`: `planEdits.buildWall` carries a wall on in one edge when the run continues it within a unit of
  straight — a slanted wall's corners sit on whole units, so they were never exactly in line, and its edges grew a
  corner per piece.
- `ichno`, `ichno/schema`: a wall's corners keep a hundredth of a unit, unlike boxes. Whole units cannot hold a metre
  turned any way — at 10° its far corner rounds to 99.46 away — so a run of turned metres read 0.99 m and a room of
  them never closed with whole-metre edges. The schema takes wall corners that are not whole; `addWall`, `buildWall`,
  `reshapeWall` (without snapping), joined walls that follow a reshaped one and a path tool's corner on a wall keep
  them to a hundredth.
- `ichno`: `press` — what a press on the plan means, as pure functions on top of `gesture`: `down`, `move`, `up`
  and `cancel` take pointer events with what each landed on and answer with a tap, a target dragged, a marquee, a
  tool's stroke, a pan or a pinch, points in plan units through the view's own `toPlan`; `keys` and `restate` report
  a drag again when a modifier changes or the view moves under it. `edgeScroll.step` is the scrolling of a press held
  at a view's edge. `SeatMap.Viewport` runs on both, and a renderer of your own gets the same presses from them (the
  playground's 3D editor does). New types `PressState`, `PressEvent`, `PressEnv`, `PressKeys`, `PressMode`,
  `PressPointer`, `PressResult`, `EdgeScrollState`, `EdgeScrollStep`.
- `ichno/react`: `planTargetOf(element)` — the handle, place, object, wall or section an element belongs to, read
  from the parts' `data-ichno-*` attributes the way the viewport delegates its events.
- `ichno`: `planView.toScreen(view, size, point)` — where a plan point shows in the viewport, `toPlan` the other way:
  the anchor for a tooltip or a popover you position over the plan.

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
