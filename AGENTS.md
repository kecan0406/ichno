# ichno — agent guide

Seat floor plans for React: one JSON document (`SeatPlan`), a zod schema for it, grid/geometry helpers, a
server-rendered SVG, Konva canvases for viewing and editing, and a headless editor hook. It is published to npm and
consumed by apps that store the document in their own database — every rule below follows from that.

## Commands

| Command               | What it does                                                        |
| --------------------- | ------------------------------------------------------------------- |
| `pnpm check`          | Everything CI runs, in order. Run it before handing work back.      |
| `pnpm test`           | vitest (`src/**/*.test.ts`)                                         |
| `pnpm typecheck`      | `tsc --noEmit`                                                      |
| `pnpm check:compiler` | Fails if React Compiler bails out of any client component or hook   |
| `pnpm build`          | tsdown → `dist/` (one file per source file, React Compiler applied) |
| `pnpm check:pkg`      | publint + are-the-types-wrong on the packed tarball                 |
| `pnpm format`         | prettier (no semicolons, single quotes, width 120)                  |

## Layout and dependency rules

Each directory is an entry point (or feeds one). The rules keep heavy dependencies out of bundles that do not need
them — a consumer importing the core must never pull in zod, React or Konva.

| Source       | Entry          | May import                                                     | Notes                                                                            |
| ------------ | -------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/core`   | `ichno`        | nothing external                                               | Types, grid, geometry, view math. Pure functions only.                           |
| `src/theme`  | `ichno`        | nothing external                                               | The CSS variable contract (`vars.ts`).                                           |
| `src/schema` | `ichno/schema` | `zod`, core                                                    | The only place zod is allowed.                                                   |
| `src/svg`    | `ichno/svg`    | `react`, core, theme                                           | Must render as a React Server Component: no hooks, no state, no `'use client'`.  |
| `src/konva`  | `ichno/konva`  | `react`, `konva`, `react-konva`, core, theme, editor **types** | Every file starts with `'use client'`.                                           |
| `src/editor` | `ichno/editor` | `react`, core                                                  | `'use client'`. Never import konva values — hook users must not pull the canvas. |

Adding an entry point means three edits together: `entry` in `tsdown.config.ts`, `exports` in `package.json`, and a
section in `README.md`. Client directories must also be listed in the babel `include` of `tsdown.config.ts` **and** in
`DIRS` of `scripts/check-compiler.mjs`.

Namespaced exports follow one shape: the object (`seatPlan`, `seatGrid`) at the top of the file, its members as
`function` declarations below it (hoisting makes that work; `const` arrows would hit the TDZ). File-private helpers
stay out of the object.

## Principles

- **No copy.** The library never contains user-facing text in any language. Labels come in through props/callbacks
  (`zoneLabel`, `fixtureLabel`); validation reports structured codes (`SeatPlanIssue`, read with `seatPlanIssueOf`)
  and consumers write the message. Adding a rule means adding an issue code, never a sentence.
- **Theme through CSS variables only.** Colours and fonts come from `--ichno-*` (`src/theme/vars.ts` is the
  contract, with a neutral fallback for each). The SVG paints with `var(...)`; the canvas resolves the same variables
  at runtime. Never hard-code a colour in a renderer, and keep the SVG and canvas colour roles in step — they draw the
  same grammar.
- **Zones are the consumer's.** Zone ids flow through the `Z` type parameter; never hard-code an id.
- **Stored documents must keep parsing.** Plans live in consumers' databases for years.
  - A new document field needs a `.default(...)` so documents saved before it still parse (see `chairSide`,
    `fixtures`).
  - Do not tighten an existing validation rule in a non-breaking release.
  - Seat `id` limits (1–8 chars) are referenced by consumers' records — treat them as fixed.
  - Grid constants (`GRID_CELL` 46, the 2-unit seat inset, half-cell fixtures) define stored coordinates. Changing
    them is a breaking change that needs a migration story.

## React Compiler

Client code ships already compiled, because consumers do not compile `node_modules`. Write components the way the
compiler expects:

- No `useMemo`, `useCallback` or `memo` — the compiler memoizes.
- No arrow functions as default parameter values (`label = (z) => z.id`) — the compiler abandons the whole component.
  Hoist the default to a module-level function.
- After touching `src/konva` or `src/editor`, run `pnpm check:compiler`. A bailout is silent in the build otherwise.

## Tests

Tests pin decisions that must not change; they are not a deliverable per change.

- Write them for pure branching: geometry, grid snapping, schema rules, edge cases (touching edges, empty zones,
  legacy documents).
- For a bug, write the failing test first, then fix.
- Do not test rendering output, prop forwarding or 1:1 mappings — typecheck and the compiler check cover wiring.
- Refactors get no new tests; existing ones staying green is the verification.

## Versioning and releases

Semver, pre-1.0: a breaking change bumps the minor (0.1 → 0.2), anything else bumps the patch. Breaking includes
renaming or removing an export, a CSS variable or an issue code, changing a component prop, tightening validation,
and changing grid constants.

Record every user-visible change under `## Unreleased` in `CHANGELOG.md` in the same commit. Releasing follows the
`releasing-ichno` skill (`.claude/skills/releasing-ichno/SKILL.md`); publishing needs the maintainer's npm one-time
password, so an agent prepares everything and the maintainer runs `npm publish`.
