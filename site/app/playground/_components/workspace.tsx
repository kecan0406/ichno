'use client'

import {
  GRID_CELL,
  planView,
  seatPlan,
  validateSelection,
  type Fixture,
  type LintCode,
  type LintSeverity,
  type Place,
  type PlanPoint,
  type PlanTarget,
  type PlanView,
} from 'ichno'
import { useSeatPlanEditor, useSeatPlanEditorShortcuts } from 'ichno/editor'
import { SeatMap } from 'ichno/react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { fixtureNames } from '../../_demo/plans'
import { Logo } from '../../_ui/logo'
import { fixtureAt, placeAt, type Made, type Placing } from '../_lib/build'
import {
  DEFAULT_LINT,
  PRESETS,
  boundsOfIds,
  checksOf,
  saveWorkbench,
  selectionOf,
  type Workbench,
} from '../_lib/documents'
import styles from '../playground.module.css'
import { Icon, type IconName } from './icons'
import { Inspector } from './inspector'
import { ChecksPanel, ImportDialog, JsonPanel, PreviewPanel, type PickRules } from './panels'

type Tool = 'select' | Placing | 'fixture'
type Panel = 'inspect' | 'checks' | 'json'

// Tap-to-place tools — the thing lands where the floor is tapped, in the section under it. ichno stores places,
// fixtures and groups; these tools (../_lib/build) assemble this site's rows, tables and desks from them.
const PLACING: { tool: Tool; name: string; icon: IconName; hint: string }[] = [
  {
    tool: 'select',
    name: 'Select',
    icon: 'select',
    hint: 'Tap to select (again to pick one seat of a group), drag to move, drag the floor to marquee.',
  },
  { tool: 'row', name: 'Row', icon: 'row', hint: 'Tap the floor to drop a row of seven seats.' },
  { tool: 'table', name: 'Table', icon: 'table', hint: 'Tap the floor to drop a round table for six.' },
  { tool: 'desk', name: 'Desk', icon: 'desk', hint: 'Tap the floor to drop a desk with its chair.' },
  { tool: 'booth', name: 'Booth', icon: 'booth', hint: 'Tap the floor to drop a booth.' },
  { tool: 'area', name: 'Area', icon: 'area', hint: 'Tap the floor to drop a standing area for forty.' },
]

// Fixtures are the app's words — these are this site's.
const FIXTURES: { role: string; size: { w: number; h: number } }[] = [
  { role: 'stage', size: { w: 414, h: 115 } },
  { role: 'screen', size: { w: 460, h: 46 } },
  { role: 'bar', size: { w: 368, h: 69 } },
  { role: 'wall', size: { w: 23, h: 230 } },
  { role: 'door', size: { w: 92, h: 23 } },
  { role: 'pillar', size: { w: 46, h: 46 } },
]

export function Workspace({
  initial,
  autosave,
  onReplace,
}: {
  initial: Workbench
  autosave: boolean
  onReplace(next: Workbench): void
}) {
  const [booked, setBooked] = useState<string[]>(initial.booked)
  const editor = useSeatPlanEditor({ initialPlan: initial.plan, lockedIds: booked, snap: SNAP })
  useSeatPlanEditorShortcuts(editor)
  const { onTap, ...viewportProps } = editor.viewportProps

  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [tool, setTool] = useState<Tool>('select')
  const [panel, setPanel] = useState<Panel>('inspect')
  const [fixtureMenu, setFixtureMenu] = useState(false)
  const [fixture, setFixture] = useState<(typeof FIXTURES)[number] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [lint, setLint] = useState<Record<LintCode, LintSeverity>>(DEFAULT_LINT)
  const [picking, setPicking] = useState<'pick' | 'book'>('pick')
  const [picked, setPicked] = useState<string[]>([])
  const [rules, setRules] = useState<PickRules>({ max: 8, consecutive: false, noOrphans: true })

  const plan = editor.plan
  const home = planView.home(plan)
  const [view, setView] = useState<PlanView>(home)

  const checks = checksOf(plan, lint)
  const errorCount = checks.filter((check) => check.severity === 'error').length
  const bookedStatus = Object.fromEntries(booked.map((id) => [id, 'booked']))
  const places = seatPlan.placesOf(plan)
  const guests = picked.reduce((sum, id) => sum + (places.find((place) => place.id === id)?.capacity ?? 0), 0)
  const pickIssues = validateSelection(plan, { selected: picked, unavailable: booked }, rules)
  const sectionLabel = (section: { id: string }) => initial.sectionNames[section.id] ?? section.id

  // Kept in this browser, so a reload picks up where you left off.
  useEffect(() => {
    if (autosave) saveWorkbench({ plan, sectionNames: initial.sectionNames, booked })
  }, [autosave, plan, booked, initial.sectionNames])

  // A tool is a one-shot; Escape drops it (and closes the fixture menu).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setTool('select')
      setFixtureMenu(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function handleTap(target: PlanTarget<string> | null, info: { point: PlanPoint | null; additive: boolean }) {
    setNotice(null)
    if (tool !== 'select' && info.point) {
      place(tool, info.point)
      setTool('select')
      return
    }
    onTap(target, info)
  }

  function place(kind: Exclude<Tool, 'select'>, point: PlanPoint) {
    const at = { x: snap(point.x), y: snap(point.y) }
    let made: Made | null
    if (kind === 'fixture') {
      if (!fixture) return
      made = fixtureAt(plan, fixture.role, fixture.size, at)
    } else {
      const section = seatPlan.sectionAt(plan, point)
      if (section === null) {
        setNotice('Tap inside a section — every place belongs to one.')
        return
      }
      made = placeAt(plan, kind, section, at)
    }
    if (!made) {
      setNotice('Could not place it there — its ids would be too long.')
      return
    }
    const { plan: next, select } = made
    // One undo step for everything the tool builds (a row with its labels, a table with its top).
    editor.edit(() => next)
    editor.select(select)
    setNotice(null)
    setPanel('inspect')
  }

  function chooseFixture(choice: (typeof FIXTURES)[number]) {
    setFixtureMenu(false)
    setFixture(choice)
    setTool('fixture')
  }

  function focus(ids: string[]) {
    selectionOf(plan, ids).forEach((id, i) =>
      editor.select(seatPlan.groupById(plan, id) ? { kind: 'group', id } : { kind: 'object', id }, i > 0),
    )
    const next = planView.fitTo(boundsOfIds(plan, ids), 160, home)
    if (next) setView(next)
  }

  function switchMode(next: 'edit' | 'preview') {
    setMode(next)
    setTool('select')
    setNotice(null)
    // Keep the editor's shortcuts from acting on a selection that preview hides.
    if (next === 'preview') editor.select(null)
  }

  function previewTap(target: Place<string>) {
    if (picking === 'book') {
      setBooked((current) =>
        current.includes(target.id) ? current.filter((id) => id !== target.id) : [...current, target.id],
      )
      setPicked((current) => current.filter((id) => id !== target.id))
      return
    }
    setPicked((current) =>
      current.includes(target.id) ? current.filter((id) => id !== target.id) : [...current, target.id],
    )
  }

  function loadPreset(id: string) {
    const preset = PRESETS.find((candidate) => candidate.id === id)
    if (!preset) return
    if (editor.dirty && !window.confirm('Replace the current document? Undo history is cleared.')) return
    onReplace(preset.workbench)
  }

  const zoomed = view.w < home.w - 1
  const activeHint =
    tool === 'fixture' && fixture
      ? `Tap the floor to place the ${(fixtureNames[fixture.role] ?? fixture.role).toLowerCase()}.`
      : PLACING.find((option) => option.tool === tool)?.hint

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          <Logo className={styles.logo} />
          ichno
        </Link>
        <span className={styles.crumb}>Playground</span>
        <label className={styles.presetPicker}>
          <span className={styles.srOnly}>Start from</span>
          <select value="" onChange={(e) => loadPreset(e.currentTarget.value)}>
            <option value="" disabled>
              Start from…
            </option>
            {PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.modeSwitch} role="radiogroup" aria-label="Mode">
          <button type="button" role="radio" aria-checked={mode === 'edit'} onClick={() => switchMode('edit')}>
            Edit
          </button>
          <button type="button" role="radio" aria-checked={mode === 'preview'} onClick={() => switchMode('preview')}>
            Preview
          </button>
        </div>
        <span className={styles.spacer} />
        <div className={styles.history}>
          <button type="button" onClick={editor.undo} disabled={!editor.canUndo} title="⌘Z">
            Undo
          </button>
          <button type="button" onClick={editor.redo} disabled={!editor.canRedo} title="⇧⌘Z">
            Redo
          </button>
          <button type="button" onClick={editor.reset} disabled={!editor.dirty} title="Back to the loaded document">
            Reset
          </button>
        </div>
      </header>

      <div className={styles.body} data-mode={mode}>
        {mode === 'edit' && (
          <nav className={styles.rail} aria-label="Tools">
            {PLACING.map((option) => (
              <button
                key={option.tool}
                type="button"
                className={styles.tool}
                aria-pressed={tool === option.tool}
                onClick={() => setTool(option.tool)}
              >
                <Icon name={option.icon} />
                <span>{option.name}</span>
              </button>
            ))}
            <span className={styles.railRule} />
            <div className={styles.menuAnchor}>
              <button
                type="button"
                className={styles.tool}
                aria-pressed={tool === 'fixture'}
                aria-expanded={fixtureMenu}
                onClick={() => setFixtureMenu((open) => !open)}
              >
                <Icon name="fixture" />
                <span>Fixture</span>
              </button>
              {fixtureMenu && (
                <div className={styles.menu} role="menu">
                  {FIXTURES.map((choice) => (
                    <button key={choice.role} type="button" role="menuitem" onClick={() => chooseFixture(choice)}>
                      {fixtureNames[choice.role] ?? choice.role}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </nav>
        )}

        <main className={styles.canvas} data-tool={tool}>
          {mode === 'edit' ? (
            <SeatMap.Viewport
              {...viewportProps}
              onTap={handleTap}
              view={view}
              onViewChange={setView}
              className={styles.viewport}
              aria-label="Seat plan editor"
            >
              <SeatMap.Grid plan={editor.displayPlan} />
              <SeatMap.Content
                plan={editor.displayPlan}
                selected={editor.selectedPlaceIds}
                invalid={editor.conflictIds}
                status={bookedStatus}
                isDisabled={never}
                sectionLabel={sectionLabel}
                fixtureLabel={fixtureLabel}
                fixtureVariant={fixtureVariant}
              />
              <SeatMap.Handles handles={editor.handles} frame={editor.frame} />
              <SeatMap.Marquee rect={editor.marquee} />
            </SeatMap.Viewport>
          ) : (
            <SeatMap.Viewport
              plan={plan}
              view={view}
              onViewChange={setView}
              onPlaceClick={previewTap}
              className={styles.viewport}
              aria-label="Seat plan preview"
              aria-multiselectable
            >
              <SeatMap.Content
                plan={plan}
                status={bookedStatus}
                selected={picked}
                isDisabled={picking === 'book' ? never : undefined}
                sectionLabel={sectionLabel}
                fixtureLabel={fixtureLabel}
                fixtureVariant={fixtureVariant}
              />
            </SeatMap.Viewport>
          )}

          <div className={styles.status} aria-live="polite">
            {notice ?? (mode === 'edit' ? activeHint : 'Drag to pan, scroll or pinch to zoom.')}
            {mode === 'edit' && editor.conflictIds.length > 0 && (
              <span className={styles.statusWarn}>{editor.conflictIds.length} overlapping</span>
            )}
          </div>
          <div className={styles.zoom}>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => setView((current) => planView.zoom(current, 1.4, centerOf(current), home))}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              disabled={!zoomed}
              onClick={() => setView((current) => planView.zoom(current, 1 / 1.4, centerOf(current), home))}
            >
              −
            </button>
            <button type="button" aria-label="Fit the plan" disabled={!zoomed} onClick={() => setView(home)}>
              ⤢
            </button>
          </div>
        </main>

        <aside className={styles.side}>
          {mode === 'edit' ? (
            <>
              <div className={styles.tabs} role="tablist" aria-label="Panels">
                <button
                  type="button"
                  role="tab"
                  aria-selected={panel === 'inspect'}
                  onClick={() => setPanel('inspect')}
                >
                  Inspect
                </button>
                <button type="button" role="tab" aria-selected={panel === 'checks'} onClick={() => setPanel('checks')}>
                  Checks
                  {checks.length > 0 && (
                    <span className={styles.count} data-error={errorCount > 0 || undefined}>
                      {checks.length}
                    </span>
                  )}
                </button>
                <button type="button" role="tab" aria-selected={panel === 'json'} onClick={() => setPanel('json')}>
                  JSON
                </button>
              </div>
              <div className={styles.panel} role="tabpanel">
                {panel === 'inspect' && (
                  <Inspector editor={editor} sectionNames={initial.sectionNames} booked={booked} onNotice={setNotice} />
                )}
                {panel === 'checks' && (
                  <ChecksPanel checks={checks} lint={lint} onLintChange={setLint} onFocus={focus} />
                )}
                {panel === 'json' && (
                  <JsonPanel
                    plan={plan}
                    onImport={() => (document.getElementById('import-dialog') as HTMLDialogElement | null)?.showModal()}
                  />
                )}
              </div>
            </>
          ) : (
            <div className={styles.panel}>
              <PreviewPanel
                plan={plan}
                picking={picking}
                onPickingChange={setPicking}
                rules={rules}
                onRulesChange={setRules}
                picked={picked}
                guests={guests}
                issues={picked.length > 0 ? pickIssues : []}
                booked={booked}
                onClear={() => setPicked([])}
              />
            </div>
          )}
        </aside>
      </div>

      <ImportDialog onLoad={(next) => onReplace({ plan: next, sectionNames: {}, booked: [] })} />
    </div>
  )
}

function never(): boolean {
  return false
}

// Loose fixtures are named; the furniture in a group (chairs, table tops) goes unlabelled.
function fixtureLabel(fixture: Fixture): string | null {
  if (fixture.group !== undefined || fixture.role === undefined) return null
  return fixtureNames[fixture.role] ?? fixture.role
}

function fixtureVariant(fixture: Fixture): 'box' | 'wall' {
  return fixture.role === 'wall' ? 'wall' : 'box'
}

// The editor snaps to the site's 46-unit cells; taps place things on half cells.
const SNAP = { cell: GRID_CELL }

function snap(value: number): number {
  return Math.round(value / (GRID_CELL / 2)) * (GRID_CELL / 2)
}

function centerOf(view: PlanView): PlanPoint {
  return { x: view.x + view.w / 2, y: view.y + view.h / 2 }
}
