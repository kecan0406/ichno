# Direction

Where ichno is heading and the decisions that got it there. `AGENTS.md` holds the rules for today's code; this file
holds the target the code is moving toward. When the two disagree, the code and `AGENTS.md` describe what ships and
this file describes what to build next.

Decided with the maintainer on 2026-09-24, benchmarked against Seats.io (the market leader for seating charts).

## Goal

Seats.io-level seating plans as **lightweight, headless React primitives** — the way shadcn/ui and Radix treat
UI: ichno owns the document, the geometry and the behaviour; the consumer owns the look, the copy and the storage.

| Principle                   | Meaning                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| No runtime dependencies     | `react` is the only peer for the components, `zod` only for `ichno/schema`. No canvas lib.  |
| Headless, DOM-stylable      | Every drawn part is an SVG element carrying `data-*` state; consumers style it with CSS.    |
| One renderer                | SVG only. The read-only plan renders as a React Server Component; interaction layers on it. |
| Renderer-agnostic behaviour | Hit-testing, gestures, selection rules and keyboard movement are pure functions in core.    |
| Consumer-owned data         | The document lives in the consumer's database. Status, prices and bookings stay outside.    |
| No copy                     | Unchanged: labels come in through props, problems go out as issue codes.                    |

## Decisions

| Topic            | Decision                                                                                                 | Rejected                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Distribution     | npm package of headless compound components                                                              | copy-paste registry                              |
| Renderer         | SVG + viewport culling + zoom level of detail; interaction core independent of the renderer (Felt-style) | Konva (55 KB gz, no `className`), WebGL (261 KB) |
| Data model scope | Seats.io-level: sections, rows (curved), tables, booths, general-admission areas, categories             | keeping the room + desk model only               |
| Row storage      | parameters only (`start`, `end`, `curve`, seat list); seat positions are computed                        | storing parameters and per-seat coordinates      |
| Naming           | today's `zones` become `sections` (Seats.io and industry vocabulary)                                     | keeping `zones`                                  |
| Desk seats       | kept as their own object kind `desk` (chair side, 46-unit grid) — ichno's own concept                    | folding into one-seat tables                     |
| Identity         | a stable `id` (booking key, 1–8 chars) separate from the displayed `label`                               | Seats.io's label-as-key                          |
| Scale            | target thousands of seats on screen; a canvas seat layer only if tens of thousands become a real need    | canvas from the start                            |

## Benchmark: what we take from Seats.io

Verified from `@seatsio/seatsio-types` 6.25.0, the React wrapper source, docs.seats.io and the shipped CDN bundles.
Seats.io renders in an iframe with Canvas 2D (an invisible SVG layer does pointer hit-testing, 3D is three.js);
style callbacks are serialized with `toString()`, so they cannot reach application state.

| Area       | Take                                                                                                   | Change                                                                                               | Leave out                                              |
| ---------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Renderer   | object events, selection limits, selection validators (orphans, consecutive, minimum), zoom-to-objects | colour/label callbacks → `className` + `data-*`; popovers → an anchor rect the consumer positions    | legend, category filter UI, minimap button, fullscreen |
| Designer   | rows (straight, curved), tables, areas, labeling algorithms, multi-select, align, undo/redo            | safe mode → `lockedIds` (ids other records reference cannot be deleted; labels stay free)            | auto-save, draft/publish, reference-image scanner, 3D  |
| Data model | object kinds, categories (`key`, `accessible`), chart/event split, validation codes with severities    | categories carry no name or colour (no copy, CSS themes); flags → free-form `tags`                   | channels, seasons, holds, pricing, ticket types        |
| Beyond     | —                                                                                                      | keyboard navigation and screen-reader semantics (undocumented in Seats.io); a public document format | —                                                      |

## Document v2

Plain JSON, integer plan units, `version: 2`. Documents without `version` are v1 and are upgraded when parsed —
stored plans must keep opening.

```ts
type SeatPlan<S extends string = string> = {
  version: 2
  width: number
  height: number
  sections: { id: S; points: PlanPoint[] }[] // polygons; v1 zones become rectangles
  categories: { key: string; accessible?: boolean }[]
  objects: PlanObject<S>[]
}

type PlanObject<S> =
  | { kind: 'desk'; id; section: S; x; y; w; h; chairSide; label?; category?; tags? } // v1 seat
  | { kind: 'row'; id; section: S; start; end; curve; seatSize; seats: RowSeat[]; label? }
  | {
      kind: 'table'
      id
      section: S
      shape: 'round' | 'rect'
      x
      y
      w
      h
      seats: TableSeat[]
      wholeBooking?
      label?
      category?
    }
  | { kind: 'booth'; id; section: S; x; y; w; h; label?; category?; tags? }
  | { kind: 'area'; id; section: S; shape: 'rect' | 'ellipse'; x; y; w; h; capacity; wholeBooking?; label?; category? }
  | { kind: 'fixture'; id; role: string; x; y; w; h } // v1 wall/tv/counter; decoration, never capacity
```

- **Places** are what can be booked: desks, row seats, table seats (or the table when `wholeBooking`), booths and
  areas. `seatPlan.placesOf(plan)` flattens them with computed geometry.
- **Ids** share one namespace across the document. Place ids are 1–8 characters (the existing seat limit).
- **Status is not in the document.** Renderers take it as a `Record<id, string>` prop, like Seats.io's event.

Schema errors keep a stored document well-formed (duplicate ids, unknown sections or categories, out of bounds,
overlapping footprints). Softer rules come from `lint(plan, severities)` as warnings the consumer can turn up or off
(duplicate labels, objects outside their section, objects without a category, empty sections).

## Components

```tsx
// Read-only — renders on the server, no JavaScript shipped.
<SeatMap.Root plan={plan}>
  {plan.sections.map((s) => <SeatMap.Section key={s.id} section={s} />)}
  {seatPlan.placesOf(plan).map((p) => (
    <SeatMap.Place key={p.id} place={p} status={status[p.id]} className="data-[status=taken]:opacity-40" />
  ))}
</SeatMap.Root>

// Interactive — the same children inside a client viewport.
<SeatMap.Viewport plan={plan} view={view} onViewChange={setView} onPlaceClick={toggle} selection={ids}>
  …
</SeatMap.Viewport>
```

- Parts render with presentation attributes that read the `--ichno-*` variables, so an unstyled plan looks right and
  any `className` overrides it.
- State is exposed as attributes: `data-kind`, `data-status`, `data-selected`, `data-highlighted`, `data-dimmed`,
  `data-category`, `data-part` (desk, chair, label, …).
- The view is a viewBox in plan units (`planView`), so rendering never needs to measure the container.
- Events are delegated at the viewport (`data-ichno-id`), so place components carry no handlers and stay
  server-safe.

The editor stays a headless hook: it owns the document, selection, history and commands, and hands the viewport
its drag and click handlers.

## Roadmap

Each phase is one pre-1.0 minor release. Mark a phase done here when it ships; phases 1–4 are built on the
`redesign/headless` branch and ship together as 0.2.

1. ✅ **Interaction core** — spatial index and hit-testing, pointer gesture state machine (tap, drag, pan, pinch),
   keyboard movement between places. Pure, no UI.
2. ✅ **Document v2** — types, schema, v1 upgrade, places, row and table geometry, `lint`, `validateSelection`.
   Removes `ichno/svg` and `ichno/konva` (and the Konva peer dependencies).
3. ✅ **Headless SVG components** — `ichno/react`: `SeatMap.Root`, `Viewport`, `Section`, `Place`, `Fixture`,
   `Grid`; viewBox view math.
4. ✅ **Editor v2** — row, table, booth and area tools, curve, labeling combinators, multi-select, align and
   distribute, undo/redo, `lockedIds`.
   Still open: marquee (rubber-band) selection, on-plan handles (resize, curve, section vertices, rotation) and
   a row-label part — the operations exist, the pointer affordances do not.
5. **Scale** — viewport culling and level of detail; measure 1k, 5k and 20k seats before considering a canvas
   seat layer.

The consumer app (tusa) moves to each release after it ships; its call sites for the removed Konva canvases are the
largest migration.

## Out of scope

Booking flow (holds, sessions, channels, seasons, best available), prices and ticket types, finished UI chrome
(legend, filters, popovers, loading states), 3D and image scanning. These need a server or a design system, and
both belong to the consumer.
