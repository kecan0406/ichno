---
name: releasing-ichno
description: Use when releasing ichno to npm — "release", "publish", "배포", "새 버전", bumping the version, or updating a consumer to a new ichno version. Walks version choice, changelog, checks, the tag push that publishes from GitHub Actions, and consumer updates.
---

# Releasing ichno

Publishing is outward-facing and permanent for that version number. Pushing the tag in step 4 is what publishes —
confirm with the maintainer before it.

1. **Pick the version** from `## Unreleased` in `CHANGELOG.md` (semver, pre-1.0):
   - breaking → bump the minor (0.1.x → 0.2.0): removed/renamed export, CSS variable or issue code; changed
     component props; tightened validation; changed grid constants
   - anything else → bump the patch
     If `Unreleased` is empty, there is nothing to release — stop and say so.
2. **Prepare the commit**: set `version` in `package.json`, rename `## Unreleased` to `## <version> — <YYYY-MM-DD>`
   and add a fresh empty `## Unreleased` above it. Commit as `release: v<version>`.
3. **Check**: `pnpm check` must pass (format, types, tests, compiler bailouts, build, package shape). The same runs
   again in `prepublishOnly`.
4. **Tag and push — this publishes.** `git tag -a v<version> -m "v<version>"`, then
   `git push origin main v<version>`. The tag starts `.github/workflows/release.yml`, which checks that the tag
   matches `package.json`, runs `pnpm check` (`prepublishOnly`) and publishes with npm trusted publishing — no token,
   no one-time password, provenance attached.
5. **Confirm**: `gh run watch` on the Release run, then `npm view ichno version`. If the run fails before publishing,
   fix it on `main`, and with the maintainer's go-ahead move the tag (`git tag -d v<version>`,
   `git push origin :refs/tags/v<version>`, tag again, push). An authentication error means the trusted publisher on
   npmjs.com (package settings: `kecan0406` / `ichno` / `release.yml`) is missing or no longer matches the workflow.
6. **Consumers**: each consumer bumps its dependency (`pnpm add ichno@^<version>` in the consuming package) and runs
   its own checks. For a breaking release, list what consumers must change in the changelog entry.

Before a release, a consumer can be tested against unpublished work with `pnpm pack` and a `file:` install of the
tarball — never commit a `file:` dependency.
