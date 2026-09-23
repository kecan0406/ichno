# Changelog

All notable changes to this package. Versions follow semver; before 1.0 a breaking change bumps the minor.

## Unreleased

## 0.1.0 — 2026-09-24

First release.

- `ichno`: document types, grid snapping (`seatGrid`), geometry (`seatPlan`: furniture layout, zone crops, free-spot
  search, id generation), view math (`fitView`, `zoomView`, `centerZoom`) and the theme variable contract.
- `ichno/schema`: `createSeatPlanSchema({ zoneIds })` and `seatPlanIssueOf` with structured issue codes.
- `ichno/svg`: `SeatMapSvg`, a read-only plan that renders on the server.
- `ichno/konva`: `SeatMapStage` (pan, zoom, pick) and `SeatPlanEditorStage` (drag to arrange).
- `ichno/editor`: `useSeatPlanEditor` and `useSeatPlanEditorShortcuts`.
