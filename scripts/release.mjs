// Releases what CHANGELOG.md holds under `## Unreleased`: picks the version, dates the section, runs `pnpm check`,
// commits `release: v<version>`, pushes the commit and its tag — the tag push is what publishes, from
// .github/workflows/release.yml — then waits for that run and for npm to serve the version.
//
//   pnpm release          the version from the changelog: a `Breaking` entry bumps the minor before 1.0 (the major
//                         after), anything else the patch
//   pnpm release <x.y.z>  that version instead
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const CHANGELOG = 'CHANGELOG.md'

const PACKAGE = 'package.json'

const UNRELEASED = '## Unreleased\n'

// How long npm may take to serve a version the run published.
const REGISTRY_WAIT_MS = 180_000

release(process.argv[2])

function release(requested) {
  const current = JSON.parse(readFileSync(PACKAGE, 'utf8')).version
  const changelog = readFileSync(CHANGELOG, 'utf8')

  if (git('branch', '--show-current') !== 'main') fail('Release from main.')

  if (git('status', '--porcelain', '--untracked-files=no') !== '') fail('Commit or stash the changes first.')
  git('fetch', '--quiet', 'origin', 'main', '--tags')

  if (git('rev-list', '--count', 'main..origin/main') !== '0') fail('main is behind origin/main — pull first.')
  const version = requested ?? bumped(current, /\bBreaking\b/.test(unreleasedOf(changelog)))

  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`"${version}" is not a version (x.y.z).`)
  const tag = `v${version}`

  if (git('tag', '--list', tag) !== '') fail(`${tag} exists already.`)
  const date = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD, local time
  console.log(`Releasing ${current} → ${version}`)

  writeFileSync(PACKAGE, readFileSync(PACKAGE, 'utf8').replace(`"version": "${current}"`, `"version": "${version}"`))
  writeFileSync(CHANGELOG, changelog.replace(UNRELEASED, `${UNRELEASED}\n## ${version} — ${date}\n`))

  try {
    run('pnpm', 'check')
  } catch {
    git('checkout', '--', PACKAGE, CHANGELOG)
    fail('pnpm check failed — package.json and CHANGELOG.md are back as they were.')
  }

  git('commit', '--quiet', '-m', `release: ${tag}`, '--', PACKAGE, CHANGELOG)
  git('tag', '-a', tag, '-m', tag)
  run('git', 'push', 'origin', 'main', tag)

  const runId = releaseRunOf(tag)
  console.log(`Release run ${runId}: https://github.com/kecan0406/ichno/actions/runs/${runId}`)

  try {
    run('gh', 'run', 'watch', runId, '--exit-status', '--compact')
  } catch {
    fail(
      `The release run failed and ${version} is not on npm. Read it with \`gh run view ${runId} --log-failed\`; ` +
        `once fixed, \`gh run rerun ${runId}\` publishes from the same tag.`,
    )
  }

  if (!servedByNpm(version)) fail(`The run passed, but npm does not serve ${version} yet — check \`npm view ichno\`.`)
  console.log(`ichno ${version} is on npm.`)
}

// What the changelog holds under `## Unreleased`; stops when that is nothing.
function unreleasedOf(changelog) {
  const start = changelog.indexOf(UNRELEASED)

  if (start === -1) fail(`${CHANGELOG} has no "${UNRELEASED.trim()}" section.`)
  const bodyStart = start + UNRELEASED.length
  const next = changelog.indexOf('\n## ', bodyStart)
  const body = changelog.slice(bodyStart, next === -1 ? undefined : next)

  if (body.trim() === '') fail('Nothing under "## Unreleased" — nothing to release.')

  return body
}

function bumped(current, breaking) {
  const [major, minor, patch] = current.split('.').map(Number)

  if (!breaking) return `${major}.${minor}.${patch + 1}`

  return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`
}

// The run the tag push started — it can take a few seconds to show up.
function releaseRunOf(ref) {
  const query = ['run', 'list', '--workflow', 'release.yml', '--branch', ref, '--limit', '1', '--json', 'databaseId']

  for (let attempt = 0; attempt < 30; attempt++) {
    const id = execFileSync('gh', [...query, '-q', '.[0].databaseId'], { encoding: 'utf8' }).trim()

    if (id !== '') return id
    pause(2000)
  }

  fail(`No release run started for ${ref} — see https://github.com/kecan0406/ichno/actions.`)
}

function servedByNpm(wanted) {
  const deadline = Date.now() + REGISTRY_WAIT_MS

  while (Date.now() < deadline) {
    try {
      const versions = execFileSync('npm', ['view', 'ichno', 'versions', '--json', '--prefer-online'], {
        encoding: 'utf8',
      })

      if (JSON.parse(versions).includes(wanted)) return true
    } catch {
      // The registry briefly answers 404 for a version it just took.
    }

    pause(5000)
  }

  return false
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function run(command, ...args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
