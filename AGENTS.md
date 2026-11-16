# ichno — agent guide

Seat plans for React: one JSON document (`SeatPlan`) of primitives — places, fixtures, group labels, the groups they
belong to and the walls around them — a zod schema for it, geometry, layouts and rules, a renderer-independent
interaction core, headless SVG components (server-safe parts plus a client viewport), and a headless editor hook. It
is published to npm and consumed by apps that store the document in their own database — every rule below follows
from that.

The long-term target (headless SVG primitives, a Seats.io-level document, no canvas dependency) and the decisions
behind it are in [`docs/direction.md`](docs/direction.md). Read it before changing the document shape or a
renderer.

## Commands

| Command               | What it does                                                              |
| --------------------- | ------------------------------------------------------------------------- |
| `pnpm check`          | Everything CI runs, in order. Run it before handing work back.            |
| `pnpm test`           | vitest (`src/**/*.test.ts`)                                               |
| `pnpm lint`           | oxlint with the vendored anti-slop rules                                  |
| `pnpm typecheck`      | `tsc --noEmit`                                                            |
| `pnpm check:compiler` | Fails if React Compiler bails out of any client component or hook         |
| `pnpm build`          | tsdown → `dist/` (one file per source file, React Compiler applied)       |
| `pnpm check:pkg`      | publint + are-the-types-wrong on the packed tarball                       |
| `pnpm format`         | prettier (no semicolons, single quotes, width 120)                        |
| `pnpm release`        | Release `## Unreleased`: version, check, tag, push, watch npm — see below |

The anti-slop rules are vendored in `tools/oxlint/anti-slop`; its `UPSTREAM.md` records the source commit and the two
places ichno's configuration departs from it. Fix what they report instead of disabling them. A type assertion that has
to stay carries a `// SAFETY:` comment naming the invariant that makes it true.

## Layout and dependency rules

Each directory is an entry point (or feeds one). The rules keep heavy dependencies out of bundles that do not need
them — a consumer importing the core must never pull in zod or React. No canvas or drawing library: SVG only
(see `docs/direction.md`).

| Source             | Entry                | May import           | Notes                                                                                                                                                                     |
| ------------------ | -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core`         | `ichno`              | nothing external     | Types, geometry, layouts, rules, view math, projections, interaction core. Pure functions only.                                                                           |
| `src/theme`        | `ichno`              | nothing external     | The CSS variable contract (`vars.ts`).                                                                                                                                    |
| `src/schema`       | `ichno/schema`       | `zod`, core          | The only place zod is allowed.                                                                                                                                            |
| `src/react`        | `ichno/react`        | `react`, core, theme | Server-safe parts: no hooks, no state, no handlers, no `'use client'`. Not compiled. Never import `src/react/client` — a page that only draws a plan must send no script. |
| `src/react/client` | `ichno/react/client` | `react`, core, theme | Every file starts with `'use client'`. Interaction only; draws nothing the parts could.                                                                                   |
| `src/editor`       | `ichno/editor`       | `react`, core        | `'use client'`. Never import `src/react` — hook users must not pull the components.                                                                                       |

`site/` is the landing page and the editor playground (`/playground`) — a private Next.js app in the pnpm workspace
that consumes the built `dist/` through `ichno: workspace:*`, like any app would. It is never published. `pnpm check`
only formats it; after changing it run `pnpm --filter ichno-site build`, which builds the library, then type-checks
and builds the site. Its demo documents are parsed with the schema at build time, so a library change that breaks
them fails that build.

Adding an entry point means three edits together: `entry` in `tsdown.config.ts`, `exports` in `package.json`, and a
section in `README.md`. Client directories must also be listed in the babel `include` of `tsdown.config.ts` **and** in
`DIRS` of `scripts/check-compiler.mjs`.

Namespaced exports follow one shape: the object (`seatPlan`, `layout`) at the top of the file, its members as
`function` declarations below it (hoisting makes that work; `const` arrows would hit the TDZ). File-private helpers
stay out of the object.

`SeatMap` is the exception: a module namespace (`export * as SeatMap from './seat-map.js'` in `src/react/index.ts`),
so consumers' bundlers drop the parts they do not name. It holds server-safe parts only — the viewport is
`SeatMapViewport`, from `ichno/react/client`. The build must leave that line as written — `seat-map` is an
entry of its own and kept out of the bundle in `tsdown.config.ts`; bundled, it turns back into one object holding
every part. A new part goes in `src/react/seat-map.ts`.

## Principles

- **No copy.** The library never contains user-facing text in any language. Labels come in through props/callbacks
  (`sectionLabel`, `fixtureLabel`); validation reports structured codes (`SeatPlanIssue`, read with `seatPlanIssueOf`)
  and consumers write the message. Adding a rule means adding an issue code, never a sentence.
- **Theme through CSS variables only.** Colours and fonts come from `--ichno-*` (`src/theme/vars.ts` is the
  contract, with a neutral fallback for each). Parts paint with `var(...)` presentation attributes so a consumer's
  `className` always wins. Never hard-code a colour in a part.
- **Headless.** Parts expose state as `data-*` attributes and name their pieces with `data-part`; they never
  decide a meaning (a status is the consumer's word). The viewport delegates events through `data-ichno-*`.
- **Sections are the consumer's.** Section ids flow through the `S` type parameter; roles and category keys are
  strings the consumer picks; never hard-code one.
- **Primitives, not kinds.** The document knows places, fixtures, group labels, groups and walls. A row, a table, a
  desk, a door is the consumer's `role`; ichno never reads a role. A new way to arrange seats is a `layout`, not a new
  kind. Rooms are found from walls, never stored; a section is a booking zone, not a room.
- **Stored documents must keep parsing.** Plans live in consumers' databases for years.
  - A new document field needs a `.default(...)` or an optional type so documents saved before it still parse
    (see `categories`, `groups`). A reshaped document needs a new `version` and an upgrade (see
    `src/core/legacy.ts`). An upgrade keeps every place id and position and should produce a document the current
    rules accept; where it cannot, say so in `docs/direction.md`.
  - Do not tighten an existing validation rule in a non-breaking release.
  - Place `id` limits (1–8 chars) are referenced by consumers' records — treat them as fixed.
  - The rotation convention (degrees clockwise about the box centre, 0 ≤ r < 360), `OVERLAP_TOLERANCE` and the
    `layout` curve definition shape stored geometry and what parses. Changing them is a breaking change.

## React Compiler

Client code ships already compiled, because consumers do not compile `node_modules`. Write components the way the
compiler expects:

- No `useMemo`, `useCallback` or `memo` — the compiler memoizes.
- No arrow functions as default parameter values (`label = (z) => z.id`) — the compiler abandons the whole component.
  Hoist the default to a module-level function.
- After touching `src/react/client` or `src/editor`, run `pnpm check:compiler`. A bailout is silent in the build
  otherwise.
- Declare a function before anything that calls it during render or from another function in the same component —
  a reference to one declared further down can make the compiler give up the whole component.
- The compiler keeps one cache per component or hook, and a value handed to a function it cannot see into shares a
  cache block with whatever that function's other arguments depend on. A value that must keep its identity while
  something else changes every frame (the editor's `stillPlan`, its selection lists) goes in a small hook of its own
  whose inputs hold still; a hook that calls no hook is not compiled unless it starts with `'use memo'`.
- `src/react` parts are not compiled. `SeatMap.Content` is wrapped in `memo` — the one exception — because an editor
  redraws it on every frame of a drag otherwise.

## Tests

Tests pin decisions that must not change; they are not a deliverable per change.

- Write them for pure branching: geometry, turned shapes, layouts, snapping, schema rules, edge cases (touching
  edges, empty sections, legacy documents).
- For a bug, write the failing test first, then fix.
- Do not test rendering output, prop forwarding or 1:1 mappings — typecheck and the compiler check cover wiring.
- Refactors get no new tests; existing ones staying green is the verification.

## Versioning and releases

Semver, pre-1.0: a breaking change bumps the minor (0.1 → 0.2), anything else bumps the patch. Breaking includes
renaming or removing an export, a CSS variable or an issue code, changing a component prop, tightening validation,
and changing the stored-geometry conventions above.

Record every user-visible change under `## Unreleased` in `CHANGELOG.md` in the same commit, and start a breaking
entry with `Breaking —` — `pnpm release` picks the version from that word. Releasing follows the `releasing-ichno`
skill (`.claude/skills/releasing-ichno/SKILL.md`): `pnpm release` checks, commits, tags and pushes, and the tag push
publishes from GitHub Actions (`.github/workflows/release.yml`, npm trusted publishing — no token or one-time
password), so an agent runs it only once the maintainer confirms the version.
