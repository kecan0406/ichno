# ichno — agent guide

Seat plans for React: one JSON document (`SeatPlan`), a zod schema for it, geometry and rules, a
renderer-independent interaction core, headless SVG components (server-safe parts plus a client viewport), and a
headless editor hook. It is published to npm and consumed by apps that store the document in their own database —
every rule below follows from that.

The long-term target (headless SVG primitives, a Seats.io-level document, no canvas dependency) and the decisions
behind it are in [`docs/direction.md`](docs/direction.md). Read it before changing the document shape or a
renderer.

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
them — a consumer importing the core must never pull in zod or React. No canvas or drawing library: SVG only
(see `docs/direction.md`).

| Source             | Entry          | May import           | Notes                                                                                   |
| ------------------ | -------------- | -------------------- | --------------------------------------------------------------------------------------- |
| `src/core`         | `ichno`        | nothing external     | Types, grid, geometry, rules, view math, interaction core. Pure functions only.         |
| `src/theme`        | `ichno`        | nothing external     | The CSS variable contract (`vars.ts`).                                                  |
| `src/schema`       | `ichno/schema` | `zod`, core          | The only place zod is allowed.                                                          |
| `src/react`        | `ichno/react`  | `react`, core, theme | Server-safe parts: no hooks, no state, no handlers, no `'use client'`. Not compiled.    |
| `src/react/client` | `ichno/react`  | `react`, core, theme | Every file starts with `'use client'`. Interaction only; draws nothing the parts could. |
| `src/editor`       | `ichno/editor` | `react`, core        | `'use client'`. Never import `src/react` — hook users must not pull the components.     |

`site/` is the landing page and the editor playground (`/playground`) — a private Next.js app in the pnpm workspace
that consumes the built `dist/` through `ichno: workspace:*`, like any app would. It is never published. `pnpm check`
only formats it; after changing it run `pnpm --filter ichno-site build`, which builds the library, then type-checks
and builds the site. Its demo documents are parsed with the schema at build time, so a library change that breaks
them fails that build.

Adding an entry point means three edits together: `entry` in `tsdown.config.ts`, `exports` in `package.json`, and a
section in `README.md`. Client directories must also be listed in the babel `include` of `tsdown.config.ts` **and** in
`DIRS` of `scripts/check-compiler.mjs`.

Namespaced exports follow one shape: the object (`seatPlan`, `seatGrid`) at the top of the file, its members as
`function` declarations below it (hoisting makes that work; `const` arrows would hit the TDZ). File-private helpers
stay out of the object.

## Principles

- **No copy.** The library never contains user-facing text in any language. Labels come in through props/callbacks
  (`sectionLabel`, `fixtureLabel`); validation reports structured codes (`SeatPlanIssue`, read with `seatPlanIssueOf`)
  and consumers write the message. Adding a rule means adding an issue code, never a sentence.
- **Theme through CSS variables only.** Colours and fonts come from `--ichno-*` (`src/theme/vars.ts` is the
  contract, with a neutral fallback for each). Parts paint with `var(...)` presentation attributes so a consumer's
  `className` always wins. Never hard-code a colour in a part.
- **Headless.** Parts expose state as `data-*` attributes and name their pieces with `data-part`; they never
  decide a meaning (a status is the consumer's word). The viewport delegates events through `data-ichno-*`.
- **Sections are the consumer's.** Section ids flow through the `S` type parameter, fixture roles and category
  keys are strings the consumer picks; never hard-code one.
- **Stored documents must keep parsing.** Plans live in consumers' databases for years.
  - A new document field needs a `.default(...)` or an optional type so documents saved before it still parse
    (see `categories`). A reshaped document needs a new `version` and an upgrade (see `src/core/v1.ts`).
  - Do not tighten an existing validation rule in a non-breaking release.
  - Place `id` limits (1–8 chars) are referenced by consumers' records — treat them as fixed.
  - Grid constants (`GRID_CELL` 46, the 2-unit desk inset, half-cell fixtures) and the row `curve` definition
    define stored geometry. Changing them is a breaking change that needs a migration story.

## React Compiler

Client code ships already compiled, because consumers do not compile `node_modules`. Write components the way the
compiler expects:

- No `useMemo`, `useCallback` or `memo` — the compiler memoizes.
- No arrow functions as default parameter values (`label = (z) => z.id`) — the compiler abandons the whole component.
  Hoist the default to a module-level function.
- After touching `src/react/client` or `src/editor`, run `pnpm check:compiler`. A bailout is silent in the build
  otherwise.

## Tests

Tests pin decisions that must not change; they are not a deliverable per change.

- Write them for pure branching: geometry, grid snapping, schema rules, edge cases (touching edges, empty sections,
  legacy documents).
- For a bug, write the failing test first, then fix.
- Do not test rendering output, prop forwarding or 1:1 mappings — typecheck and the compiler check cover wiring.
- Refactors get no new tests; existing ones staying green is the verification.

## Versioning and releases

Semver, pre-1.0: a breaking change bumps the minor (0.1 → 0.2), anything else bumps the patch. Breaking includes
renaming or removing an export, a CSS variable or an issue code, changing a component prop, tightening validation,
and changing grid constants.

Record every user-visible change under `## Unreleased` in `CHANGELOG.md` in the same commit. Releasing follows the
`releasing-ichno` skill (`.claude/skills/releasing-ichno/SKILL.md`). Pushing a `v<version>` tag publishes it from
GitHub Actions (`.github/workflows/release.yml`, npm trusted publishing — no token or one-time password), so an agent
prepares the release commit and pushes the tag only once the maintainer confirms.
