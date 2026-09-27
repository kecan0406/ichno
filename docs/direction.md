# Direction

Where ichno is heading and the decisions that got it there. `AGENTS.md` holds the rules for today's code; this file
holds the target the code is moving toward. When the two disagree, the code and `AGENTS.md` describe what ships and
this file describes what to build next.

Decided with the maintainer on 2026-09-24, benchmarked against Seats.io (the market leader for seating charts).
The data model was revised on 2026-09-27: the document moves from built-in object kinds to pure primitives
(document v3, below).

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

| Topic            | Decision                                                                                                                                                                                                                                                                                                                  | Rejected                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Distribution     | npm package of headless compound components                                                                                                                                                                                                                                                                               | copy-paste registry                                                                               |
| Renderer         | SVG + viewport culling + zoom level of detail; interaction core independent of the renderer (Felt-style)                                                                                                                                                                                                                  | Konva (55 KB gz, no `className`), WebGL (261 KB)                                                  |
| Data model scope | pure primitives: bookable `place`s and non-bookable `fixture`s with stored geometry, named `group`s; desk, row, table, booth and area are the consumer's `role` words                                                                                                                                                     | built-in kinds (v2: desk, row, table, booth, area, fixture); structural kinds with stored layouts |
| Bookable unit    | one `place` kind with `capacity` (1 for a seat, N for standing room); a whole-booked table is one place (the top) with fixture chairs                                                                                                                                                                                     | separate seat and area kinds; a `wholeBooking` flag on a group                                    |
| Row storage      | per-seat coordinates; rows and tables are editor layouts (`layout.line`/`arc`/`around`/`grid`) that create places and re-arrange a selection                                                                                                                                                                              | storing layout parameters (v2)                                                                    |
| Grouping         | flat: items point at a `group` id; `groups` holds the label and role                                                                                                                                                                                                                                                      | nested group trees; tags only                                                                     |
| Geometry         | integer `x, y, w, h` of the unrotated box, `shape: 'rect' \| 'ellipse'`, optional `rotation` in degrees about the box centre                                                                                                                                                                                              | centre coordinates; float coordinates; polygons and lines for fixtures (later, if needed)         |
| Group turning    | a group stores the way it faces (`rotation`) and turns about the centre of its frame — the box around its members in that direction — so the centre stays put turn after turn; positions round half to even                                                                                                               | turning about the level extent's centre (it wanders with every turn); float coordinates           |
| Grid             | an editor snap option (`snap: { cell: 46 }`), not a document rule                                                                                                                                                                                                                                                         | grid as a validation rule                                                                         |
| Sections         | a place stores its `section`; containment is checked by validation                                                                                                                                                                                                                                                        | deriving membership from position                                                                 |
| Row labels       | a `label` item placed in the document that draws its group's label                                                                                                                                                                                                                                                        | stored text; positions computed at render time                                                    |
| Overlap          | a schema error between places only; fixtures overlap freely (`fixture_overlap` goes)                                                                                                                                                                                                                                      | all overlap as lint; place–fixture overlap errors                                                 |
| Naming           | today's `zones` become `sections` (Seats.io and industry vocabulary); the array stays `objects`, non-bookable items stay `fixture`                                                                                                                                                                                        | `items` / `shape`                                                                                 |
| Identity         | a stable `id` (booking key, 1–8 chars) separate from the displayed `label`                                                                                                                                                                                                                                                | Seats.io's label-as-key                                                                           |
| Scale            | target thousands of seats on screen; a canvas seat layer only if tens of thousands become a real need                                                                                                                                                                                                                     | canvas from the start                                                                             |
| Editor boundary  | ichno ships what every editor does — the document, selection, history, the tool contract, the view with its controls (`useSeatMapView`) and what the editor draws over the plan (`SeatMap.EditorOverlay`); the consumer ships what makes an editor theirs — its tools (what a row or a table is), panels, copy and styles | built-in row and table tools; a styled editor, or a copy-paste registry of panels                 |

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

## Document v3

Plain JSON, integer plan units, `version: 3`. The document records what is where and what can be booked — never how
it was made. v2 and v1 documents are upgraded when parsed; stored plans must keep opening.

```ts
type SeatPlan<S extends string = string> = {
  version: 3
  width: number
  height: number
  sections: { id: S; points: PlanPoint[] }[]
  categories: { key: string; accessible?: boolean }[]
  groups: { id: string; label?: string; role?: string; rotation?: number }[] // rotation: the way it faces
  objects: PlanObject<S>[] // drawing order
}

// The unrotated box; `rotation` turns it clockwise about its centre (SVG `rotate(r, cx, cy)`).
type Box = { x: number; y: number; w: number; h: number; shape: 'rect' | 'ellipse'; rotation?: number }

type PlanObject<S> =
  | (Box & { kind: 'place'; id; section: S; capacity; label?; group?; role?; category?; tags? })
  | (Box & { kind: 'fixture'; id; group?; role? }) // never capacity
  | (Box & { kind: 'label'; id; group: string }) // draws the group's label (or its id)
```

- **Places** are what can be booked, exactly as stored — no flattening. A desk, a row seat, a booth and a standing
  area differ only in shape, capacity and the consumer's `role`.
- **Roles** are the consumer's words (`desk`, `row`, `table`, `stage`, `chair`, …); ichno never reads them. Parts
  expose them as `data-role`.
- **Ids** share one namespace across places, fixtures, labels and groups. Place ids are 1–8 characters.
- **Status is not in the document.** Renderers take it as a `Record<id, string>` prop, like Seats.io's event.

The v2 → v3 upgrade keeps every place id and coordinate:

| v2                        | v3                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `desk`                    | `place` (`role: 'desk'`) + a chair `fixture` on `chairSide`, in one group           |
| `row`                     | a group (`role: 'row'`) + one `place` per computed seat + `label` items at its ends |
| `table`                   | a group (`role: 'table'`) + a top `fixture` + seat `place`s                         |
| `table` with wholeBooking | a group + the top as a `place` (`capacity` = seat count) + chair `fixture`s         |
| `booth`                   | `place` (`role: 'booth'`)                                                           |
| `area`                    | `place` (`role: 'area'`, `capacity`); with wholeBooking the same place              |
| `fixture`                 | `fixture` (its `role` unchanged)                                                    |

Known gap: 0.2 checked a table's top, not its seats, against other objects. A 0.2 document whose table seats
overlap another place upgrades into one the schema refuses with `overlap`; `upgradeSeatPlan` still returns it, and
the editor opens it with the pair marked.

Schema errors keep a stored document well-formed (duplicate ids, unknown sections, groups or categories, out of
bounds, overlapping places). Softer rules come from `lint(plan, severities)` as warnings the consumer can turn up or
off (duplicate labels, places outside their section, places without a category, empty sections).

## Components

```tsx
// Read-only — renders on the server, no JavaScript shipped.
<SeatMap.Root plan={plan}>
  {plan.sections.map((s) => <SeatMap.Section key={s.id} section={s} />)}
  {seatPlan.placesOf(plan).map((p) => ( // a filter over `objects`
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
- State is exposed as attributes: `data-kind`, `data-role`, `data-group`, `data-status`, `data-selected`,
  `data-highlighted`, `data-dimmed`, `data-category`, `data-part` (shape, label, …).
- The view is a viewBox in plan units (`planView`), so rendering never needs to measure the container.
- Events are delegated at the viewport (`data-ichno-id`), so place components carry no handlers and stay
  server-safe.

The editor stays a headless hook: it owns the document, selection, history and commands, and hands the viewport
its drag, click and draw handlers. Creation follows the same split as the document: the viewport turns a press into
a stroke, the editor previews and commits it, and what the stroke makes — a row, a table, a stage — is a tool the
consumer writes with `layout` and `planEdits`. Saved objects are `PlanTemplate`s the consumer stores; they never
enter the document.

The view splits the same way: `useSeatMapView` holds it with the controls every plan needs — zoom in and out,
back to the whole plan, to some places, whether a zoom can go further — and the consumer draws the buttons. What
the editor draws over the plan (outlines, handles, the marquee, a tool's stroke) comes out of the hook as data,
`overlayProps`, and `SeatMap.EditorOverlay` draws it; neither entry point imports the other, so hook users still
never pull the components. An editor built on ichno is its panels and its tools.

## Roadmap

Each phase is one pre-1.0 minor release. Mark a phase done here when it ships; phases 1–5 are built on the
`redesign/headless` branch and ship together as 0.2.

1. ✅ **Interaction core** — spatial index and hit-testing, pointer gesture state machine (tap, drag, pan, pinch),
   keyboard movement between places. Pure, no UI.
2. ✅ **Document v2** — types, schema, v1 upgrade, places, row and table geometry, `lint`, `validateSelection`.
   Removes `ichno/svg` and `ichno/konva` (and the Konva peer dependencies).
3. ✅ **Headless SVG components** — `ichno/react`: `SeatMap.Root`, `Viewport`, `Section`, `Place`, `Fixture`,
   `Grid`; viewBox view math.
4. ✅ **Editor v2** — row, table, booth and area tools, curve, labeling combinators, multi-select, align and
   distribute, undo/redo, `lockedIds`.
   Marquee selection, on-plan handles (corner resize, row ends and curve, section vertices) and row labels are
   in. Rotating tables, booths and areas needs a `rotation` field (overlap and bounds would change with it) and is
   left for a later minor.
5. ✅ **Scale** — measured on a 900×600 viewport (Chrome, production build, two-frame steps so 33 ms = 60fps):

   | Seats  | Pan, whole plan | Zoom  | Pan, zoomed in | Without LOD (pan / zoom / zoomed pan) |
   | ------ | --------------- | ----- | -------------- | ------------------------------------- |
   | 1,000  | 33 ms           | 33 ms | 33 ms          | same                                  |
   | 5,000  | 33 ms           | 35 ms | 33 ms          | 37 / 38 ms (p95 60)                   |
   | 20,000 | 38 ms           | 58 ms | 33 ms          | 169 / 154 / 129 ms                    |

   The cost was the browser, not React: SVG text (labels) and forced layouts. So the viewport never reads
   layout during a gesture (`planView.toPlan` with a ResizeObserver size), labels below 9 screen pixels are left
   out, and objects outside the view plus half its size are not drawn — redrawn only when a pan leaves that
   region or the zoom crosses a quarter-octave step. **Decision: no canvas seat layer.** Revisit only for plans
   well past 20,000 seats.

6. ✅ **Document v3** — pure primitives (above): types, schema, v2 upgrade, `rotation` through hit-testing, bounds
   and overlap; `layout` functions in core; editor `addPlaces`, `arrange` and `snap`; `SeatMap.Table` and
   `SeatMap.RowLabel` give way to `SeatMap.Fixture` and `SeatMap.Label`. Ships as 0.3.
7. ✅ **Editor creation** — creation tools (`EditorTool`: a `box`, `line` or `point` stroke in, a plan out,
   previewed while drawn and committed as one step), saved objects and the clipboard as `PlanTemplate`s (objects
   and groups around their centre, no sections, versioned like documents), selection and hover outlines, Shift
   constraints, keyboard nudging, Space and wheel panning; the view's controls (`useSeatMapView`, zoom keys) and
   `SeatMap.EditorOverlay`, so an editor is its panels and tools. Ships with phase 6 as 0.3.

## Out of scope

Booking flow (holds, sessions, channels, seasons, best available), prices and ticket types, finished UI chrome
(legend, filters, popovers, loading states), 3D and image scanning. These need a server or a design system, and
both belong to the consumer.
