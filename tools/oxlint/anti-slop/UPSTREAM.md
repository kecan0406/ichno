# Vendored anti-slop Oxlint plugin

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), commit
`e6676e8d0bf17c678cb45b9dacb2bd6ca8dea53a` (2026-09-10), copied from the `install-anti-slop` skill assets
(`skills/install-anti-slop/assets/anti-slop`, tree `a7831feb0c097943ac813ddcb1367e26eef52da5`; upstream syncs them
from `src/` with `pnpm sync:skill-assets`). Installed 2026-10-10. Apart from this record, the copied files match that
tree byte for byte.

Last compared with upstream `main` at `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (2026-10-10): the commits since
`e6676e8` change only `README.md`, and the asset tree is still `a7831fe`, so nothing was merged.

Installed paths:

- `tools/oxlint/anti-slop/index.ts` — the generic plugin, registered in `.oxlintrc.json` as `anti-slop`.
- `tools/oxlint/anti-slop/effect/` — the opt-in Effect plugin. Copied with the rest, not registered: ichno does not
  depend on `effect`.
- `tools/oxlint/anti-slop/vendor/eslint-stylistic/` — keeps its own `LICENSE` and `UPSTREAM.md`.

Dependencies: `oxlint` and `@oxlint/plugins`, both pinned to the same exact version — upgrade them together.

## Intentional deviations

The plugin source is unchanged. ichno's configuration differs from the generic setup in two places:

- `anti-slop/no-shape-in-symbol-names` is `off`. In ichno "shape" is a domain word, not a structural one: the stored
  document's `shape` field on places and fixtures, the exported `Shape`, `SHAPES` and `OpeningShape`, and the
  `data-shape` attribute. Renaming them would be a breaking change to the document and the public API.
- `anti-slop/no-runtime-typeof` runs with `allowInTypeGuards: true`. Unparsed input still goes through the schema; a
  `typeof` that tells apart the members of a public union (a render-prop `children`, a `number | object` option)
  lives in a named type-guard function.

The plugin directory is excluded from Oxlint and from Prettier (`.prettierignore`), so it stays a pristine copy.

## Updating

Follow the `install-anti-slop` skill's update procedure: compare against an explicit upstream revision, keep the
deviations above, and update this record.
