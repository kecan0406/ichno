# Changelog

All notable changes to this package. Versions follow semver; before 1.0 a breaking change bumps the minor.

## Unreleased

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
- `ichno`: `labeling.numbers`, `labeling.letters` (skipped letters, AA after Z) and `labeling.custom`.
- `ichno/react`: `onTap` also reports the plan point and whether the tap was additive.
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
