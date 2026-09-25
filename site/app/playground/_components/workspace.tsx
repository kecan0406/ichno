'use client'

import {
  HALF_CELL,
  planView,
  seatPlan,
  validateSelection,
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
import {
  DEFAULT_LINT,
  PRESETS,
  boundsOfIds,
  checksOf,
  objectIdsOf,
  saveWorkbench,
  type Workbench,
} from '../_lib/documents'
import styles from '../playground.module.css'
import { Icon, type IconName } from './icons'
import { Inspector } from './inspector'
import { ChecksPanel, ImportDialog, JsonPanel, PreviewPanel, type PickRules } from './panels'

type Tool = 'select' | 'row' | 'table' | 'booth' | 'area'
type Panel = 'inspect' | 'checks' | 'json'

// Tap-to-place tools — the object lands where the floor is tapped, in the section under it.
const PLACING: { tool: Tool; name: string; icon: IconName; hint: string }[] = [
  { tool: 'select', name: 'Select', icon: 'select', hint: 'Tap to select, drag to move, drag the floor to marquee.' },
  { tool: 'row', name: 'Row', icon: 'row', hint: 'Tap the floor to drop a row of seven seats.' },
  { tool: 'table', name: 'Table', icon: 'table', hint: 'Tap the floor to drop a round table for six.' },
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
  const editor = useSeatPlanEditor({ initialPlan: initial.plan, lockedIds: booked })
  useSeatPlanEditorShortcuts(editor)
  const { onTap, ...viewportProps } = editor.viewportProps

  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [tool, setTool] = useState<Tool>('select')
  const [panel, setPanel] = useState<Panel>('inspect')
  const [fixtureMenu, setFixtureMenu] = useState(false)
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
    const section = seatPlan.sectionAt(plan, point)
    if (section === null) {
      setNotice('Tap inside a section — every place belongs to one.')
      return
    }
    const at = { x: snap(point.x), y: snap(point.y) }
    const id =
      kind === 'row'
        ? editor.addRow(section, { start: { x: at.x - 138, y: at.y }, end: { x: at.x + 138, y: at.y }, seats: 7 })
        : kind === 'table'
          ? editor.addTable(section, { center: at, seats: 6 })
          : kind === 'booth'
            ? editor.addBooth(section, { x: at.x - 92, y: at.y - 69, w: 184, h: 138 })
            : editor.addArea(section, { rect: { x: at.x - 138, y: at.y - 69, w: 276, h: 138 }, capacity: 40 })
    setNotice(id ? null : 'Could not place it there.')
    if (id) setPanel('inspect')
  }

  function addDesk() {
    const target =
      editor.selectedSection?.id ??
      editor.selectedObjects.flatMap((object) => (object.kind === 'fixture' ? [] : [object.section]))[0] ??
      plan.sections[0]?.id
    if (target === undefined) return
    const id = editor.addDesk(target)
    setNotice(id ? null : `No free 2×2 spot left in ${sectionLabel({ id: target })}.`)
    if (id) setPanel('inspect')
  }

  function addFixture(role: string, size: { w: number; h: number }) {
    setFixtureMenu(false)
    const id = editor.addFixture(role, size)
    setNotice(id ? null : 'No room left for that fixture.')
    if (id) setPanel('inspect')
  }

  function focus(ids: string[]) {
    const objectIds = objectIdsOf(plan, ids)
    objectIds.forEach((id, i) => editor.select({ kind: 'object', id }, i > 0))
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
  const activeHint = PLACING.find((option) => option.tool === tool)?.hint

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
            <button type="button" className={styles.tool} onClick={addDesk} title="Adds a desk at the first free spot">
              <Icon name="desk" />
              <span>Desk</span>
            </button>
            <div className={styles.menuAnchor}>
              <button
                type="button"
                className={styles.tool}
                aria-expanded={fixtureMenu}
                onClick={() => setFixtureMenu((open) => !open)}
              >
                <Icon name="fixture" />
                <span>Fixture</span>
              </button>
              {fixtureMenu && (
                <div className={styles.menu} role="menu">
                  {FIXTURES.map((fixture) => (
                    <button
                      key={fixture.role}
                      type="button"
                      role="menuitem"
                      onClick={() => addFixture(fixture.role, fixture.size)}
                    >
                      {fixtureNames[fixture.role] ?? fixture.role}
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
                fixtureLabel={(fixture) => fixtureNames[fixture.role] ?? fixture.role}
                fixtureVariant={(fixture) => (fixture.role === 'wall' ? 'wall' : 'box')}
              />
              <SeatMap.Handles handles={editor.handles} />
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
                fixtureLabel={(fixture) => fixtureNames[fixture.role] ?? fixture.role}
                fixtureVariant={(fixture) => (fixture.role === 'wall' ? 'wall' : 'box')}
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

function snap(value: number): number {
  return Math.round(value / HALF_CELL) * HALF_CELL
}

function centerOf(view: PlanView): PlanPoint {
  return { x: view.x + view.w / 2, y: view.y + view.h / 2 }
}
