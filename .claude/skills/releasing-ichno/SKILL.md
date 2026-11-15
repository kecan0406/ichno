---
name: releasing-ichno
description: Use when releasing ichno to npm — "release", "publish", "배포", "새 버전", bumping the version, or updating a consumer to a new ichno version. Runs `pnpm release`, which picks the version from the changelog, checks, tags and pushes — the tag push publishes from GitHub Actions — then handles a failed run and consumer updates.
---

# Releasing ichno

Publishing is outward-facing and permanent for that version number. `pnpm release` pushes the tag that publishes —
confirm the version with the maintainer before running it.

1. **Read `## Unreleased`** in `CHANGELOG.md` and tell the maintainer the version it gives: an entry marked
   `Breaking` bumps the minor before 1.0 (the major after), anything else the patch. Empty means there is nothing to
   release — say so and stop. A breaking entry lists what consumers must change.
2. **Run `pnpm release`** once confirmed (`pnpm release <x.y.z>` when the maintainer wants another version). From a
   clean `main` that is not behind `origin/main`, it dates the section, sets `package.json`, runs `pnpm check`
   (undoing both files if it fails), commits `release: v<version>`, tags, pushes `main` and the tag, watches the
   Release run (`.github/workflows/release.yml`) and waits until npm serves the version.
3. **If the run fails**, the tag is already pushed. Read it with `gh run view <id> --log-failed`, fix the cause and
   `gh run rerun <id>` — it publishes from the same tag. Move a tag only when the fix must change the tagged commit,
   and only with the maintainer's go-ahead: `git tag -d v<version>`, `git push origin :refs/tags/v<version>`, tag
   again, push.
   - `E403 … OIDC permission denied for this action` — the trusted publisher on npmjs.com
     (https://www.npmjs.com/package/ichno/access) is missing, or it was created without "Allow npm publish" (then
     it allows only staged publishing). Connections cannot be edited: delete it and create GitHub Actions /
     `kecan0406` / `ichno` / `release.yml` / no environment / "Allow npm publish" checked. npm asks for the
     maintainer's security key for the page and again for saving. The working connection was created 2026-11-15.
   - Renaming `release.yml` breaks the connection — npm matches the workflow file name.
4. **Consumers**: each consumer bumps its dependency (`pnpm add ichno@^<version>` in the consuming package) and runs
   its own checks.

Before a release, a consumer can be tested against unpublished work with `pnpm pack` and a `file:` install of the
tarball — never commit a `file:` dependency.
