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

| Topic            | Decision                                                                                                                                                                                                                                                                                                                                                                         | Rejected                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Distribution     | npm package of headless compound components                                                                                                                                                                                                                                                                                                                                      | copy-paste registry                                                                               |
| Renderer         | SVG + viewport culling + zoom level of detail; interaction core independent of the renderer (Felt-style)                                                                                                                                                                                                                                                                         | Konva (55 KB gz, no `className`), WebGL (261 KB)                                                  |
| Data model scope | pure primitives: bookable `place`s and non-bookable `fixture`s with stored geometry, named `group`s; desk, row, table, booth and area are the consumer's `role` words                                                                                                                                                                                                            | built-in kinds (v2: desk, row, table, booth, area, fixture); structural kinds with stored layouts |
| Bookable unit    | one `place` kind with `capacity` (1 for a seat, N for standing room); a whole-booked table is one place (the top) with fixture chairs                                                                                                                                                                                                                                            | separate seat and area kinds; a `wholeBooking` flag on a group                                    |
| Row storage      | per-seat coordinates; rows and tables are editor layouts (`layout.line`/`arc`/`around`/`grid`) that create places and re-arrange a selection                                                                                                                                                                                                                                     | storing layout parameters (v2)                                                                    |
| Grouping         | flat: items point at a `group` id; `groups` holds the label and role                                                                                                                                                                                                                                                                                                             | nested group trees; tags only                                                                     |
| Geometry         | integer `x, y, w, h` of the unrotated box, `shape: 'rect' \| 'ellipse'`, optional `rotation` in degrees about the box centre                                                                                                                                                                                                                                                     | centre coordinates; float coordinates; polygons and lines for fixtures (later, if needed)         |
| Group turning    | a group stores the way it faces (`rotation`) and turns about the centre of its frame — the box around its members in that direction — so the centre stays put turn after turn; positions round half to even                                                                                                                                                                      | turning about the level extent's centre (it wanders with every turn); float coordinates           |
| Grid             | an editor snap option (`snap: { cell: 50 }`), not a document rule                                                                                                                                                                                                                                                                                                                | grid as a validation rule                                                                         |
| Units            | plan units have no size, but ichno's defaults read them as centimetres (decided 2026-10-10): `GRID_CELL` is 50, half a metre, so snapping lands on 25 cm and lengths read round; walls keep a step of their own (`Snap.wall`), a metre in the playground                                                                                                                         | a unit stored in the document; the 46-unit desk cell of 0.1                                       |
| Sections         | a place stores its `section`; containment is checked by validation                                                                                                                                                                                                                                                                                                               | deriving membership from position                                                                 |
| Walls            | the building, beside the sections: a centre line through points (closed or open), a thickness and openings along its edges; rooms are found where walls meet and never stored (phase 10)                                                                                                                                                                                         | walls as fixtures ichno cannot read; a wall graph of shared corners; a `wall` object kind         |
| Row labels       | a `label` item placed in the document that draws its group's label                                                                                                                                                                                                                                                                                                               | stored text; positions computed at render time                                                    |
| Overlap          | a schema error between places only; fixtures overlap freely (`fixture_overlap` goes)                                                                                                                                                                                                                                                                                             | all overlap as lint; place–fixture overlap errors                                                 |
| Naming           | today's `zones` become `sections` (Seats.io and industry vocabulary); the array stays `objects`, non-bookable items stay `fixture`                                                                                                                                                                                                                                               | `items` / `shape`                                                                                 |
| Identity         | a stable `id` (booking key, 1–8 chars) separate from the displayed `label`                                                                                                                                                                                                                                                                                                       | Seats.io's label-as-key                                                                           |
| Scale            | target thousands of seats on screen; a canvas seat layer only if tens of thousands become a real need                                                                                                                                                                                                                                                                            | canvas from the start                                                                             |
| Editor boundary  | ichno ships what every editor does — the document, selection, history, the tool and handle contracts, smart guides, the view with its controls (`useSeatMapView`) and what the editor draws over the plan (`SeatMap.EditorOverlay`); the consumer ships what makes an editor theirs — its tools and handles (what a row or a table is and how it grows), panels, copy and styles | built-in row and table tools; a styled editor, or a copy-paste registry of panels                 |

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

Plain JSON, integer plan units (a wall's corners to a hundredth), `version: 3`. The document records what is where and what can be booked — never how
it was made. v2 and v1 documents are upgraded when parsed; stored plans must keep opening.

```ts
type SeatPlan<S extends string = string> = {
  version: 3
  width: number
  height: number
  sections: { id: S; points: PlanPoint[] }[]
  walls: { id: string; points: PlanPoint[]; thickness: number; closed?: boolean; openings?: Opening[] }[]
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

// A gap `width` long in edge `edge` of its wall (from point `edge` to the next), starting `at` along it.
type Opening = { edge: number; at: number; width: number; role?: string } // a door, a window — the consumer's word
```

- **Places** are what can be booked, exactly as stored — no flattening. A desk, a row seat, a booth and a standing
  area differ only in shape, capacity and the consumer's `role`.
- **Roles** are the consumer's words (`desk`, `row`, `table`, `stage`, `chair`, …); ichno never reads them. Parts
  expose them as `data-role`.
- **Ids** share one namespace across places, fixtures, labels, groups and walls. Place ids are 1–8 characters.
- **Walls** are the building; the rooms they close are found from them (`seatPlan.roomsOf`). A room is not a section:
  a section is what a place belongs to for booking, and one that is the whole plan serves most venues.
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
bounds, overlapping places, openings that do not fit their wall). Softer rules come from `lint(plan, severities)` as warnings the consumer can turn up or
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
   `SeatMap.EditorOverlay`, so an editor is its panels and tools; what a layers panel needs — exact selection
   (`setSelection`), the drawing order (`planEdits.reorder`, ⌘] / ⌘[) and moving between a group and its members
   (Enter / ⇧Enter). Ships with phase 6 as 0.3.

8. ✅ **Editor usability** — benchmarked against design tools (Figma) and the playground's own needs, decided with
   the maintainer on 2026-10-08:

   | Topic         | Decision                                                                                                                                                                                         | Rejected                                                                                     |
   | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
   | Smart guides  | opt-in `guides`: edges, centre lines and equal gaps of units and sections; moves, level corners and tool strokes; 6 screen pixels, ahead of the grid; ⌘/Ctrl lets go                             | on by default (changes existing apps' drags); edges and centres only                         |
   | Own handles   | `EditorHandles` sets on the hook — `of(plan, item)` and `drag(plan, handle, drag)`, drawn and committed by the editor                                                                            | forwarding unknown handles to the consumer to preview and commit itself                      |
   | Sections      | a `polygon` draw mode (a corner per tap); edge handles add vertices, a vertex dropped on its neighbour merges; removing a section takes its places, their groups whole and loose fixtures inside | drawing boxes and adding vertices only; refusing a section that holds places; re-homing them |
   | Lock and hide | `frozenIds` and `hiddenIds`, editor state outside the document; `lockedIds` keeps meaning ids bookings reference                                                                                 | one `frozenIds` with hiding left to the consumer; renaming `lockedIds`                       |
   | Saving        | `markSaved(saved)` moves the `dirty` baseline and `reset` target; history stays                                                                                                                  | remounting after every save                                                                  |
   | Batch edits   | `planEdits.assign` — shape, capacity, role, category, tags on many objects, `undefined` clears, unsavable values refused                                                                         | per-property helpers                                                                         |

   Also in: Alt-drag copies and ⌘D repeats the last step, one knob turning a multi-selection, `selectIds`,
   `selectMembers`/`selectGroups`, `preview` for live panel edits, `seatPlan.boundsOfIds`, `seatPlan.orderAlong` and
   `issueIdsOf`.

   **Editor scale**, measured 2026-10-08 with the site's production build in headless Chrome (a 920×900 canvas,
   rows of 100 seats, snapping on). Steps are an input followed by two frames, p50 / p95 in ms; an idle step costs
   about 48 ms in this setup (two frames plus DevTools round trips), so read the numbers against that. A minimal
   editor page — `useSeatPlanEditor`, `SeatMap.Viewport`, the two `Content` layers and `EditorOverlay`, as in the
   README — measures ichno alone:

   | Seats  | Drag a row, whole plan | Drag a row, zoomed in | Arrow-key nudge | Drag everything | Let go (commit) |
   | ------ | ---------------------- | --------------------- | --------------- | --------------- | --------------- |
   | 1,000  | 48 / 49                | 48 / 49               | 30 / 32         | 49 / 49         | 32              |
   | 5,000  | 46 / 47                | 46 / 47               | 29 / 55         | 96 / 97         | 45              |
   | 20,000 | 109 / 146              | 41 / 93               | 74 / 144        | 305 / 364       | 122             |

   First measured with one layer, a row of 20,000 dragged at 152 / 176 (whole plan) and 90 / 124 (zoomed). The pure
   work per frame was only about 15 ms (`conflictsOf` 10.6, guide targets 2.8, the move under 1) — the rest was drawing:
   `displayPlan` is a new plan on every move, and the editor's derived lists got new identities on every render, so
   `SeatMap.Content` redrew every place in view each frame. The fix is the `stillPlan` / `movingPlan` split (still part
   keyed by the ids that move), overlaps checked for the moving part only, `Content` memoized, and the selection and
   id lists derived in small `'use memo'` hooks — the compiler had merged them into cache blocks that depend on the
   drag. What is left at the whole plan is the browser painting 20,000 SVG nodes. Smart guides add nothing measurable
   up to 5,000 seats and about 16 ms per step zoomed in at 20,000.

   The playground went from 447 / 499 to 188 / 196 (whole plan) and from 272 / 292 to 106 / 140 (zoomed in) for a row
   of 20,000: the site now compiles with the React Compiler (its main component had silently bailed out, so the checks
   parsed the whole plan on every frame), draws the two layers, culls to the view and leaves out numbers under 6
   screen pixels.

9. ✅ **Housing-style editing** — benchmarked against game housing (The Sims 4's room as the unit; colour for what
   cannot be placed from Valheim; basic and precise modes from WoW; Tiny Glade's automatic dimensions) and, for
   precision, design and CAD tools (SketchUp's typed lengths and live dimensions). The scope and the wall handle were
   decided with the maintainer on 2026-10-09; the rest are calls made building it:

   | Topic     | Decision                                                                                                                                                                                                                                             | Rejected                                                                   |
   | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
   | Rooms     | a section is the room (superseded by phase 10 — rooms come from walls): a `polygon` tool's drag before the first corner draws a rectangle; moving a section moves what stands in it (what removing it takes), the outline held whole inside the plan | a room primitive; moving the outline alone, each vertex clamped on its own |
   | Walls     | the middle of an edge pushes that wall straight out or in (both corners, onto cell lines when snapping, a step short of the far side) and carries the loose fixtures standing against it; Alt adds a vertex                                          | phase 8's edge handle adding a vertex; pushing behind Alt                  |
   | Precision | `addPoint(point)` places a polygon corner exactly — the consumer turns a typed length into a point, as units are its own                                                                                                                             | typed lengths and units in ichno                                           |

   The playground builds the rest on that, as an app would: a door snaps into the nearest wall (a section's edge or a
   wall fixture) and the wall is left open there in 2D and 3D; a tool shows what it cannot make where the pointer is
   in the colour of what cannot be had, with the reason; places a drag takes outside their section are marked like
   overlaps; lengths are written in metres while drawing and on what is selected (2D), a section's edges take typed
   lengths, and Design shows a section's floor area and how many it holds. 3D stays the basic mode — no handles.

10. ✅ **Walls** — decided with the maintainer on 2026-10-10. Phase 9 made the section the room, so a place could
    not go anywhere until a section was drawn, and two things on the plan looked like walls (a section's edge and a
    wall fixture) while only one of them made a room. Game housing builds the other way round — walls first, the
    rooms are where they close — and the playground's visitors never need to see a section at all.

    | Topic    | Decision                                                                                                                                                                                                                                                                                                                                                                            | Rejected                                                                                                                |
    | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
    | Walls    | a `walls` list beside `sections` (default `[]`): a centre line through `points`, `closed` or open, `thickness` across; ids in the shared namespace; the centre line stays on the plan, the band may reach past it; corners to a hundredth of a unit — whole units cannot hold a metre turned any way (10° rounds to 99.46), so a room of turned metres never closed in whole metres | walls as fixtures (`role: 'wall'`), which ichno never reads; a graph of shared corners; a `wall` kind among the boxes   |
    | Rooms    | found where walls meet (`seatPlan.roomsOf`): a closed wall, walls meeting end to end, a partition across one; an open wall's end within half a thickness of another meets it; never stored                                                                                                                                                                                          | stored rooms; a room primitive                                                                                          |
    | Sections | stay the booking zone a place stores; separate from rooms. The playground keeps one that is the whole plan and never shows it                                                                                                                                                                                                                                                       | sections found from rooms (ids would change with the walls; a stadium's blocks have no walls); `place.section` optional |
    | Openings | stored on their wall — `edge`, `at`, `width`, the consumer's `role`; kept within an edge that changes, dropped from one shorter than they are wide; the renderer leaves the gap                                                                                                                                                                                                     | door fixtures whose gaps the consumer works out                                                                         |
    | Editing  | walls select, drag and copy like objects; a closed wall carries what stands in it; vertex and edge handles as a section's, the walls joined to one following; a `path` draw mode whose corners land on nearby walls and line up with other walls' corners only — never furniture or a wall's faces, so walls stay on the grid                                                       | moving the walls of a room found from several walls (which walls would move is not clear)                               |

    Building walls, decided with the maintainer the same day after the playground's first tool (corners tapped or a
    rectangle dragged) left lengths like 0.95 m: walls keep their own step (`Snap.wall`, a metre in the playground),
    and the playground puts a wall up the way housing games do — a metre piece at a click, under the pointer (hinged
    on a wall's end the pointer is beside, else on the grid line under it, or centred on it when turned), carrying
    that wall on (`planEdits.buildWall`), the wheel or R turning the next piece 15° (⇧ 5°), back at its start closing
    a room — the corner the last piece runs from moves so it and the edge into it stay whole metres. The piece tool
    takes the pointer unsnapped (`EditorTool.snap: false`) and places itself. A rectangle room
    is the playground's Room asset, a door its Door asset.

    Not yet: templates (the clipboard, saved objects) carry no walls, turning leaves walls where they are, and a
    section still draws its outer wall — whether a section draws as a zone now that walls are their own is open.

## Restructure

Begun with the maintainer on 2026-11-10. In the table below the Surfaces, Preview and Editor core rows are the
maintainer's answers and so is the Look; the Store row and the phases are proposals not yet confirmed. Ten phases left the playground with four canvases (2D and 3D, each to edit
and to preview), an editor hook of 83 members and a preview that read as unfinished — the editor's canvas with its
panels taken away. The goal is an editor and a preview that look finished and stay light. Nothing after 0.2.1 is
published, so the hook's API and the shape of document v3 can still change without an upgrade path; v1 and v2
documents must keep upgrading.

Measured that day, minified and gzipped, without react and zod:

| What                                           | Size    |
| ---------------------------------------------- | ------- |
| `ichno`, everything                            | 11.3 KB |
| `ichno/schema`                                 | 10.2 KB |
| `ichno/react`, everything                      | 17.6 KB |
| `SeatMap.Root` and `SeatMap.Content` alone     | 17.1 KB |
| the same two from their own files              | 8.8 KB  |
| `ichno/editor`, everything                     | 27.7 KB |
| an editor app (`ichno/editor` + `ichno/react`) | 38.9 KB |

`SeatMap` is one object, so any part brings the viewport and the editor overlay with it. The playground loads about
363 KB of script (161 KB of it the page's own chunk) and three.js another 251 KB when 3D opens. What a press means —
drag, marquee, stroke or pan — is written twice, in `SeatMap.Viewport` (990 lines) and in the playground's 3D editor
(1,441 lines); the editor's state machine lives inside the hook, where no test reaches it.

| Topic       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Rejected                                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Surfaces    | the reference's objects reach the editor as well as the preview ("에디터까지", after the reference arrived) — so editing from the corner view stays. First answered, before the reference, as two 2D surfaces and a 3D preview with the 3D editor removed. The flat editor stays beside it (see First view)                                                                                                                                                                          | 2D only; the reference's objects in the 3D preview alone, or only as the preview's first view                                                                                                                                                          |
| Preview     | a booking screen the site builds from ichno's primitives — a legend, what the pointer is on, the picked places, zoom controls, a phone layout; ichno stays headless and gains only what that needs (an anchor for a popover, a fit with a margin)                                                                                                                                                                                                                                    | a default skin with Legend and Tooltip parts in ichno; a read-only viewer with no booking UI                                                                                                                                                           |
| Editor core | the editor's state machine as pure functions and a store outside React; the hook subscribes to slices of it                                                                                                                                                                                                                                                                                                                                                                          | splitting the hook into smaller hooks; leaving ichno as it is and splitting only the site                                                                                                                                                              |
| Store       | **recommended, not yet confirmed**: ichno writes its own store (318 B) in the shape zustand's `useStore(api, selector)` takes — `getState`, `getInitialState`, `subscribe` — so no runtime dependency is added and an app on zustand binds to it as it is; the site keeps its own state (panels, tabs, mode) in zustand                                                                                                                                                              | zustand as a dependency (the same forty lines); @xstate/store (event transitions and undo, but 3–4 KB, React bindings in a second package, and an undo that knows nothing of `markSaved`, `preview` or no-op edits); nanostores, jotai, TanStack Store |
| Look        | the maintainer pointed at the objects in Diverse System's "works. 24/7 stream" visuals — their mood, not the frame round the screen: matte charcoal volumes with a light edge and a soft shadow on a warm light-grey floor — and confirmed the rough boards drawn from it. The boards also carry lettering written on the floor, one accent kept for the selection and categories read from labels on the floor rather than a seat's fill; those were on the boards, not singled out | passed over, not refused: three rough previews shown that day (hairlines refined, category colours, dark)                                                                                                                                              |
| Corner view | three.js stays (decided 2026-11-10, knowing the cost): orbit and the view from a seat are kept; handles, dimensions and guides, which exist only in 2D today, are to be drawn in WebGL; the 251 KB chunk loads with the first view                                                                                                                                                                                                                                                   | an SVG projection of the same parts, tried first or adopted outright (no dependency, the 2D overlay for free, but a fixed angle and untried for turned and round objects, walls and thousands of seats)                                                |
| First view  | the corner view opens first, in the editor and in the preview; the flat plan stays a switch away, for exact work                                                                                                                                                                                                                                                                                                                                                                     | the flat plan first; the corner view alone                                                                                                                                                                                                             |
| Dark theme  | the canvas keeps the look whatever the theme — only the panels turn dark                                                                                                                                                                                                                                                                                                                                                                                                             | a dark version of the look; the old two inks in the dark                                                                                                                                                                                               |
| Motion      | objects move when the plan changes, the preview included (reverses the static decision of 2026-10-08): placing settles from above, removing sinks away, aligning, turning and undoing glide to where things go, a selection lifts a little, a picked seat lifts in the preview, the views hand over with a camera move. Never while dragging, and not under reduced motion. Cute, never too much, modern — effects and their curves taken from open-source practice, not invented    | motion only for placing, removing and selecting; motion in the editor only; none                                                                                                                                                                       |

Open: whether exports that tree-shake
replace the namespace objects (`SeatMap`, `seatPlan`, `planEdits`), which changes the "Namespaced exports" rule in
`AGENTS.md`; and whether a place still needs a `section` when the playground's one section is the whole plan and
hidden.

Proposed phases, not yet reviewed by the maintainer — each would end with `pnpm check`, the site's build and the
sizes above measured again. On 2026-11-11 the maintainer asked for them to be carried out as far as they go without
further questions and brought back for one confirmation; what is marked _built_ below is on the `restructure` branch,
checked, and waiting for that — where building it meant choosing between options, the choice is a proposal, named as
one.

11. **Look** — the playground's canvases in the reference look: the site's CSS for the 2D parts, palette roles of
    their own for the three.js views (object faces, their edges, the floor, lettering, the selection), the same in
    the dark theme; the corner view first; motion when the plan changes.
    Handles, dimensions and guides in the corner view follow — in WebGL, since three.js stays; proposed to come
    after phase 12, when the corner view no longer carries its own copy of what a press means.

    _Built_ (look and motion on `main`, the rest on `restructure`). **Proposal, not the WebGL the Corner view row
    names:** what the editor draws over the plan is an SVG layer over the canvas. The corner view's camera is
    orthographic, so the floor maps to the screen with one matrix; the layer carries that matrix (written whenever the
    camera moves) and draws ichno's own `SeatMap.EditorOverlay` inside it — the selection's frame, the handles, smart
    guides, a tool's stroke — as the 2D canvas does, with lengths written level beside what they measure. Handles are
    DOM elements, so they take the pointer and keep their cursors; nothing was rewritten for WebGL. What it costs: the
    overlay is drawn over everything, so a frame shows through what stands in front of it. The first load shows the
    2D plan (drawn on the server) until three.js is there, then hands over with the switch's camera move — which
    leans on the 2D ↔ 3D hand-over, itself still to be confirmed.

12. **Interaction in core** — what a press means, the modifier keys and edge scrolling as pure functions beside
    `gesture`; a renderer hit-tests, converts coordinates and passes the press on.

    _Built._ `press` and `edgeScroll` in `src/core/press.ts`: the view passes its own `toPlan` and how many plan units
    a pixel spans, and gets taps, drags, marquees, strokes, pans and pinches back. `SeatMap.Viewport` (994 → 742
    lines) and the playground's 3D editor both run on it, so the 3D editor gained what only the viewport had — smart
    guides and merge distances measured in screen pixels, ⌘/Ctrl letting go of guides, a release lost to a menu
    ending the press, edge scrolling — and kept what is its own: a marquee that is a box on the screen, and the Hand.

13. **Editor store** — history, selection, press, tool and hover as one state with a reducer, tested without React;
    selectors memoized on their inputs replace the `'use memo'` hooks; `useSeatPlanEditor` becomes a thin binding and
    its 83 members are grouped.

    _Built_, with the store the Store row recommends — **still a proposal**: ichno's own, no dependency, in the
    shape zustand's `useStore` takes. `src/editor/state.ts` is the state and its pure pieces, `view.ts` what is drawn
    from it (each piece remembering its last answer, in place of the `'use memo'` hooks), `store.ts` the commands;
    the hook is thirty lines. Tested without React (`store.test.ts`), the identity of what a drag leaves alone
    included. A drag of a row of 100 among 20,000 seats in the playground measured 227 / 257 ms a step before and
    209 / 223 after (p50 / p95, 2D; an idle step is 50), letting go 384 → 366 ms — the same within the noise.
    **Not done, and proposed to stay so:** grouping the 83 members. The hook returns what it did, so nothing an
    app wrote changes; the commands are apart from the state now (`store.commands`, `store.getState()`), which is the
    grouping that pays. The site's own state did not need zustand — see phase 16.

14. **Viewer split** — a viewport without the editor's code, exports that tree-shake, a section's and a wall's edge
    editing as one implementation.
15. **Preview** — the booking screen in the reference look, the 3D preview in it too. Needs only the viewer, so it can
    start once the look is confirmed.

    _Built_, after the boards the maintainer confirmed (a title, a legend, what the pointer is on, the picks, the
    zoom): over the plan, its name with how many places are free, a legend and the zoom; a tip above the place under
    the pointer, in 2D and 3D; beside the plan, the picks by name with what `validateSelection` says of them, and a
    Book button that makes them taken — and so locked in the editor. The playground's own switches (the rules, a tap
    that books) fold away under the picks. ichno gained one function for it, `planView.toScreen`, the anchor the tip
    is placed by; the legend, the tip and the panel are the site's. **Proposals:** the legend lists only what the
    plan paints differently — available, picked, taken; the boards' "Accessible" is left to the category labels,
    since categories are read from labels now. On a narrow screen the picks are a sheet at the bottom that shows the
    total and the button and opens for the rest — the simplest sheet, not on the boards.

16. **Editor** — the playground's workspace split by feature, its state in a store, its canvas in the same look.
17. **Release 0.3.**

## Out of scope

Booking flow (holds, sessions, channels, seasons, best available), prices and ticket types, finished UI chrome
(legend, filters, popovers, loading states), 3D and image scanning. These need a server or a design system, and
both belong to the consumer.

A 3D view is a renderer the consumer adds over the same document. The playground's 3D preview shows the shape:
three.js in the site, loaded only when opened, reading places, fixtures, groups, walls and roles as stored and supplying
what the document does not hold — a scale for plan units, heights, which way seating faces, where a guest's eyes
are — as its own reading of its roles (`site/app/playground/_lib/scene.ts`). Nothing in ichno changed for it.

The editor is renderer-independent the same way. The playground also edits in 3D, in a tycoon game's fixed-tilt
view turned a quarter at a time (`site/app/playground/_components/build-3d.tsx`): presses go through the `gesture`
core, and plan points are read off the floor under the pointer. They reach the same `useSeatPlanEditor` as the
2D canvas — taps, drags, marquees and tool strokes, its draft, overlaps and outlines — so one selection, history and
tool set serve both views. Handles stay in 2D. Both 3D views are drawn like the 2D plan: hairline edges, one fill,
dashes for guides and for what cannot be had (`_components/drawing-3d.tsx`). ichno did not change for this either.
Real heights (raked rows, balconies, floors) would be a document change — an optional field and a decision recorded
here — not a renderer one.
