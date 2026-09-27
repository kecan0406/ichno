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
  rows, tables and blocks; `TABLE_SEAT_GAP` moved here.
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
