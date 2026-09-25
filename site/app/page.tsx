import { seatPlan } from 'ichno'
import pkg from 'ichno/package.json'
import { SeatMap } from 'ichno/react'
import { createSeatPlanSchema } from 'ichno/schema'
import Link from 'next/link'
import { fixtureNames, roomPlan, venuePlan, venueSectionIds, venueStatus } from './_demo/plans'
import { VenueDemo } from './_demo/venue-demo'
import { CodeTabs, type CodeTab } from './_ui/code-tabs'
import { InstallCommand } from './_ui/install-command'
import { Logo } from './_ui/logo'
import { Reveal } from './_ui/reveal'
import styles from './page.module.css'

// The demo documents are checked against the schema at build time — a library change that breaks them fails the
// build instead of the page.
createSeatPlanSchema({ sectionIds: venueSectionIds }).SeatPlan.parse(venuePlan)
createSeatPlanSchema({ sectionIds: ['R'] }).SeatPlan.parse(roomPlan)

// The lounge on its own — `sectionPlanOf` crops a plan to one section, for narrow screens and thumbnails.
const lounge = seatPlan.sectionPlanOf(venuePlan, 'L')!

const PLAYGROUND_POINTS = [
  'Rows, tables, desks, booths, standing areas and fixtures',
  'An inspector for ids, labels, categories, seat counts and curves',
  'Schema errors and lint warnings as you edit, with severities you choose',
  'A customer preview with selection rules and bookings that lock the editor',
  'JSON export and import — including documents from ichno 0.1',
]

const GITHUB = 'https://github.com/kecan0406/ichno'
const NPM = 'https://www.npmjs.com/package/ichno'

const FEATURES = [
  {
    title: 'One JSON document',
    body: 'Desks, curved rows, tables, booths, standing areas and fixtures in one versioned document. Your database keeps it for years; old documents keep parsing.',
  },
  {
    title: 'Headless SVG',
    body: 'Parts expose state as data-* attributes and paint with CSS variables, so your className always wins. No canvas, nothing to override.',
  },
  {
    title: 'Validation as codes',
    body: 'The schema, lint rules and selection rules report codes like overlap or orphan_seat. The library ships no copy — the words are yours, in any language.',
  },
  {
    title: 'An editor hook, not an editor',
    body: 'useSeatPlanEditor holds the document, selection, snapping, handles and undo history. Build whatever panels your product needs around it.',
  },
  {
    title: 'Fast at 20,000 seats',
    body: 'Culling and label level of detail keep large plans panning at 60 fps. Gestures never read layout, so nothing forces the browser to reflow.',
  },
  {
    title: 'Accessible by default',
    body: 'The viewport is a listbox: places are options, arrow keys move a focus ring to the nearest place, Enter or Space picks it.',
  },
]

const ENTRY_POINTS = [
  {
    name: 'ichno',
    deps: 'no dependencies',
    body: 'Types, grid, geometry, lint and selection rules, view math, the interaction core.',
  },
  {
    name: 'ichno/schema',
    deps: 'zod',
    body: 'createSeatPlanSchema with structured issue codes; upgrades documents from 0.1.',
  },
  {
    name: 'ichno/react',
    deps: 'react',
    body: 'SeatMap parts that render on the server, plus a client Viewport for gestures.',
  },
  { name: 'ichno/editor', deps: 'react', body: 'useSeatPlanEditor — headless editor state and every edit operation.' },
]

const CODE: CodeTab[] = [
  {
    id: 'draw',
    title: 'Draw',
    caption: 'A read-only map is a Server Component. Swap Root for Viewport to add pan, zoom, taps and keys.',
    code: `import { SeatMap } from 'ichno/react'

<SeatMap.Viewport plan={plan} onPlaceClick={(place) => toggle(place.id)}>
  <SeatMap.Content
    plan={plan}
    status={{ A2: 'booked' }}   // your words, exposed as data-status
    selected={picked}
    sectionLabel={(section) => names[section.id]}
  />
</SeatMap.Viewport>`,
  },
  {
    id: 'validate',
    title: 'Validate',
    caption: 'Parse before you save. Issues come back as codes; you write the message.',
    code: `import { createSeatPlanSchema, seatPlanIssueOf } from 'ichno/schema'

export const { SeatPlan } = createSeatPlanSchema({ sectionIds: ['hall', 'lounge'] as const })

const result = SeatPlan.safeParse(input)
if (!result.success) {
  for (const issue of result.error.issues) {
    const planIssue = seatPlanIssueOf(issue)
    // { code: 'overlap', ids: ['A1', 'A2'] } → your message
  }
}`,
  },
  {
    id: 'select',
    title: 'Selection rules',
    caption: 'Check a booking before it happens — limits, seats side by side, no stranded seats.',
    code: `import { validateSelection } from 'ichno'

validateSelection(plan, { selected, unavailable }, { max: 8, consecutive: true, noOrphans: true })
// [{ code: 'orphan_seat', id: 'A2' }]`,
  },
  {
    id: 'edit',
    title: 'Edit',
    caption: 'The hook holds the state; the buttons are yours.',
    code: `import { useSeatPlanEditor } from 'ichno/editor'

const editor = useSeatPlanEditor({ initialPlan, lockedIds: bookedSeatIds })

<SeatMap.Viewport {...editor.viewportProps}>
  <SeatMap.Grid plan={editor.displayPlan} />
  <SeatMap.Content plan={editor.displayPlan} selected={editor.selectedPlaceIds} invalid={editor.conflictIds} />
  <SeatMap.Handles handles={editor.handles} />
</SeatMap.Viewport>

<button onClick={() => editor.addRow('hall', { start, end, seats: 12, curve: -0.1 })}>Add row</button>
<button disabled={!editor.dirty} onClick={() => save(editor.plan)}>Save</button>`,
  },
  {
    id: 'theme',
    title: 'Theme',
    caption: 'Map the CSS variables onto your design tokens; dark mode is one more block.',
    code: `:root {
  --ichno-surface: var(--background);
  --ichno-ink: var(--foreground);
  --ichno-accent: var(--primary);
  --ichno-font: var(--font-sans);
}

[data-category='vip'] [data-part='shape'] {
  fill: var(--amber-100);
}`,
  },
]

export default function Home() {
  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a href="#top" className={styles.brand}>
            <Logo className={styles.logo} />
            ichno
            <span className={styles.version}>v{pkg.version}</span>
          </a>
          <nav className={styles.nav} aria-label="Main">
            <a href="#features">Features</a>
            <Link href="/playground">Playground</Link>
            <a href="#code">Code</a>
            <a href={GITHUB} className={styles.navButton}>
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className={styles.hero}>
          <Reveal className={styles.heroText}>
            <p className={styles.eyebrow}>Headless seat maps for React</p>
            <h1 className={styles.title}>
              Seat plans as data.
              <br />
              <span className={styles.titleMuted}>Drawn in SVG, styled by you.</span>
            </h1>
            <p className={styles.lede}>
              One JSON document for halls, rooms and floors — with a schema, geometry, components that render on the
              server and an editor hook. ichno brings the rules; you bring the design.
            </p>
            <div className={styles.heroActions}>
              <InstallCommand command="pnpm add ichno zod" />
              <Link href="/playground" className={styles.primary}>
                Open the playground
              </Link>
            </div>
          </Reveal>
          <Reveal delay={0.12} className={styles.heroDemo}>
            <VenueDemo />
          </Reveal>
          <ul className={styles.facts}>
            <li>SVG only, no canvas</li>
            <li>React Server Components</li>
            <li>20,000 seats at 60 fps</li>
            <li>Zero user-facing strings</li>
            <li>MIT</li>
          </ul>
        </section>

        <section id="features" className={styles.section}>
          <Reveal className={styles.sectionHead}>
            <h2>Everything a seat plan needs, nothing it doesn&apos;t</h2>
            <p>ichno owns the document and its rules. Status, prices, labels and looks stay in your app.</p>
          </Reveal>
          <div className={styles.features}>
            <Reveal className={`${styles.card} ${styles.cardWide}`}>
              <div className={styles.cardText}>
                <h3>Renders on the server</h3>
                <p>
                  This plan is a Server Component — plain SVG in the HTML, no JavaScript shipped for it. Add the
                  Viewport when people need to pan, zoom and pick.
                </p>
              </div>
              <div className={styles.cardVisual}>
                <SeatMap.Root plan={lounge} aria-label="The lounge, rendered on the server">
                  <SeatMap.Content
                    plan={lounge}
                    status={venueStatus}
                    fixtureLabel={(fixture) => fixtureNames[fixture.role] ?? null}
                  />
                </SeatMap.Root>
              </div>
            </Reveal>
            {FEATURES.map((feature, i) => (
              <Reveal key={feature.title} delay={(i % 3) * 0.06} className={styles.card}>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="playground" className={styles.section}>
          <Reveal className={`${styles.card} ${styles.teaser}`}>
            <div className={styles.teaserText}>
              <h2>Bring your own editor UI</h2>
              <p>
                useSeatPlanEditor holds the document, selection, snapping, handles and undo; the panels are yours. The
                playground is one editor built on it — try every operation before you write your own.
              </p>
              <ul className={styles.points}>
                {PLAYGROUND_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <Link href="/playground" className={styles.primary}>
                Open the playground
              </Link>
            </div>
            <div className={styles.teaserVisual}>
              <SeatMap.Root plan={roomPlan} aria-label="A room in the editor">
                <SeatMap.Grid plan={roomPlan} />
                <SeatMap.Content
                  plan={roomPlan}
                  selected={seatPlan
                    .placesOf(roomPlan)
                    .flatMap((place) => (place.parent?.id === 'row-1' ? [place.id] : []))}
                  fixtureLabel={(fixture) => fixtureNames[fixture.role] ?? null}
                />
              </SeatMap.Root>
            </div>
          </Reveal>
        </section>

        <section id="code" className={styles.section}>
          <Reveal className={styles.sectionHead}>
            <h2>A few lines to get going</h2>
            <p>Every import below is tree-shakable, and each entry point only pulls what it needs.</p>
          </Reveal>
          <Reveal>
            <CodeTabs tabs={CODE} />
          </Reveal>
          <div className={styles.entries}>
            {ENTRY_POINTS.map((entry, i) => (
              <Reveal key={entry.name} delay={i * 0.05} className={styles.entry}>
                <code>{entry.name}</code>
                <span className={styles.entryDeps}>{entry.deps}</span>
                <p>{entry.body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section className={styles.cta}>
          <Reveal className={styles.ctaInner}>
            <h2>Start with the document.</h2>
            <p>Store it, validate it, draw it, edit it. The rest is your product.</p>
            <div className={styles.heroActions}>
              <InstallCommand command="pnpm add ichno zod" />
              <a href={GITHUB} className={styles.primary}>
                Read the docs
              </a>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>MIT licensed</span>
        <span className={styles.footerLinks}>
          <a href={GITHUB}>GitHub</a>
          <a href={NPM}>npm</a>
          <a href={`${GITHUB}/blob/main/CHANGELOG.md`}>Changelog</a>
        </span>
      </footer>
    </>
  )
}
