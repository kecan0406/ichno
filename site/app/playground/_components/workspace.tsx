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
  type PlanRect,
  type PlanTarget,
  type PlanView,
} from 'ichno'
import { planEdits, useSeatPlanEditor, useSeatPlanEditorShortcuts } from 'ichno/editor'
import { SeatMap } from 'ichno/react'
import Link from 'next/link'
import { useEffect, useEffectEvent, useState } from 'react'
import { fixtureNames } from '../../_demo/plans'
import { Logo } from '../../_ui/logo'
import { rectOf } from '../_lib/build'
import {
  DEFAULT_LINT,
  PRESETS,
  boundsOfIds,
  checksOf,
  saveWorkbench,
  selectionOf,
  type Workbench,
} from '../_lib/documents'
import { loadLibrary, newObjectId, saveLibrary, type SavedObject } from '../_lib/library'
import { PLAYGROUND_OBJECTS, savedObjectTool, type ToolDef } from '../_lib/playground-objects'
import styles from '../playground.module.css'
import { Icon } from './icons'
import { Inspector } from './inspector'
import { ObjectPanel } from './objects'
import { ChecksPanel, ImportDialog, JsonPanel, PreviewPanel, type PickRules } from './panels'
import { ShortcutsDialog } from './shortcuts'

type Panel = 'inspect' | 'checks' | 'json'

const SELECT_HINT =
  'Tap to select, again for one seat of a group. Drag to move, or drag the floor to select an area. ? for keys.'

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
  const [snapping, setSnapping] = useState(true)
  const editor = useSeatPlanEditor({ initialPlan: initial.plan, lockedIds: booked, snap: snapping ? SNAP : undefined })
  useSeatPlanEditorShortcuts(editor)
  const { onTap, ...viewportProps } = editor.viewportProps

  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [panel, setPanel] = useState<Panel>('inspect')
  // Keep the object picked after placing one, instead of going back to selecting.
  const [keep, setKeep] = useState(false)
  const [library, setLibrary] = useState<SavedObject[]>([])
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

  // The object being placed, as this site knows it — its name and hint.
  const activeTool =
    editor.tool === null
      ? null
      : ([...PLAYGROUND_OBJECTS, ...library.map(savedObjectTool)].find((def) => def.id === editor.tool?.id) ?? null)

  // Kept in this browser, so a reload picks up where you left off.
  useEffect(() => {
    if (autosave) saveWorkbench({ plan, sectionNames: initial.sectionNames, booked })
  }, [autosave, plan, booked, initial.sectionNames])

  // Saved objects live in localStorage, which the server cannot read.
  useEffect(() => {
    setLibrary(loadLibrary())
  }, [])

  // The site's own keys — objects and the view.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || mode !== 'edit') return
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable], dialog')) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.shiftKey && e.code === 'Digit1') return fitPlan()
    if (e.shiftKey && e.code === 'Digit2') return zoomToSelection()
    if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) return openDialog('shortcuts-dialog')
    if (e.key === '=' || e.key === '+') return zoomBy(ZOOM_BUTTON_STEP)
    if (e.key === '-' || e.key === '_') return zoomBy(1 / ZOOM_BUTTON_STEP)
    if (e.shiftKey) return
    const object = PLAYGROUND_OBJECTS.find((def) => def.key !== '' && def.key === e.key)
    if (object) return choose(object)
    if (e.code === 'KeyV') return choose(null)
    if (e.code === 'KeyQ') toggleKeep()
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  function handleTap(target: PlanTarget<string> | null, info: { point: PlanPoint | null; additive: boolean }) {
    setNotice(null)
    onTap(target, info)
  }

  // Picks an object to place, or back to selecting with null.
  function choose(def: ToolDef | null) {
    setNotice(null)
    editor.setTool(def === null ? null : { ...def.tool, keep })
  }

  function toggleKeep() {
    const next = !keep
    setKeep(next)
    if (editor.tool) editor.setTool({ ...editor.tool, keep: next })
  }

  function saveObject(name: string) {
    const made = planEdits.templateOf(editor.plan, editor.selectedIds)
    if (!made) return
    const next = [...library, { id: newObjectId(), name, template: made.template }]
    setLibrary(next)
    saveLibrary(next)
    setNotice(`Saved “${name}” — it is under Your objects, ready to place again.`)
    // Show where it went, once the panel has drawn it.
    requestAnimationFrame(() =>
      document.querySelector('[aria-labelledby="your-objects"]')?.scrollIntoView({ block: 'end', behavior: 'smooth' }),
    )
  }

  function deleteObject(id: string) {
    const next = library.filter((saved) => saved.id !== id)
    setLibrary(next)
    saveLibrary(next)
    if (editor.tool?.id === `saved:${id}`) editor.setTool(null)
  }

  function focus(ids: string[]) {
    selectionOf(plan, ids).forEach((id, i) =>
      editor.select(seatPlan.groupById(plan, id) ? { kind: 'group', id } : { kind: 'object', id }, i > 0),
    )
    const next = planView.fitTo(boundsOfIds(plan, ids), 160, home)
    if (next) setView(next)
  }

  function zoomBy(factor: number) {
    setView((current) => planView.zoom(current, factor, centerOf(current), home))
  }

  function fitPlan() {
    setView(home)
  }

  function zoomToSelection() {
    const rects: PlanRect[] = [
      ...editor.selectedObjects.map(seatPlan.boundsOf),
      ...(editor.selectedSection ? [seatPlan.sectionBoundsOf(editor.selectedSection)] : []),
    ]
    const next = planView.fitTo(rects, 80, home)
    if (next) setView(next)
  }

  function switchMode(next: 'edit' | 'preview') {
    setMode(next)
    setNotice(null)
    // Keep the editor's shortcuts from acting on a selection or a tool that preview hides.
    if (next === 'preview') {
      editor.setTool(null)
      editor.select(null)
    }
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

  const zoom = Math.round((home.w / view.w) * 100)
  // Over the plan with a tool that can make nothing there — its places need a section to belong to.
  const nowhere = activeTool !== null && editor.pointer !== null && editor.draft === null
  const status =
    notice ??
    (mode === 'preview'
      ? 'Drag to pan, scroll or pinch to zoom.'
      : nowhere
        ? 'Every place belongs to a section — move inside one to place it.'
        : (activeTool?.hint ?? SELECT_HINT))

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
        {mode === 'edit' && (
          <div className={styles.history}>
            <button
              type="button"
              aria-pressed={snapping}
              onClick={() => setSnapping((on) => !on)}
              title="Snap to the grid — places land on half cells, turns on 15°"
            >
              <Icon name="snap" />
              Snap
            </button>
            <button
              type="button"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              onClick={() => openDialog('shortcuts-dialog')}
            >
              <Icon name="keyboard" />
            </button>
          </div>
        )}
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
          <ObjectPanel
            objects={PLAYGROUND_OBJECTS}
            saved={library}
            activeId={editor.tool?.id ?? null}
            keep={keep}
            canSave={editor.selectedIds.length > 0}
            onPick={choose}
            onToggleKeep={toggleKeep}
            onSave={saveObject}
            onDelete={deleteObject}
          />
        )}

        <main className={styles.canvas} data-tool={editor.tool === null ? 'select' : editor.tool.draw}>
          {mode === 'edit' ? (
            <SeatMap.Viewport
              {...viewportProps}
              onTap={handleTap}
              view={view}
              onViewChange={setView}
              wheel="pan"
              className={styles.viewport}
              aria-label="Seat plan editor"
            >
              {snapping && <SeatMap.Grid plan={editor.displayPlan} />}
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
              {editor.draft && (
                <g className={styles.draft}>
                  <SeatMap.Content
                    plan={editor.draft}
                    invalid={editor.conflictIds}
                    fixtureLabel={fixtureLabel}
                    fixtureVariant={fixtureVariant}
                  />
                </g>
              )}
              {editor.stroke && editor.tool?.draw === 'box' && <SeatMap.Marquee rect={rectOf(editor.stroke)} />}
              {editor.selection.length > 1 &&
                editor.frames.map((points, i) => <SeatMap.Outline key={i} points={points} />)}
              <SeatMap.Outline points={editor.hoverFrame} className={styles.hoverOutline} />
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

          <div className={styles.status} aria-live="polite" data-warn={nowhere || undefined}>
            {status}
            {mode === 'edit' && editor.conflictIds.length > 0 && (
              <span className={styles.statusWarn}>{editor.conflictIds.length} overlapping</span>
            )}
          </div>
          <div className={styles.zoom}>
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out (−)"
              onClick={() => zoomBy(1 / ZOOM_BUTTON_STEP)}
            >
              −
            </button>
            <button type="button" className={styles.zoomLevel} title="Fit the plan (⇧1)" onClick={fitPlan}>
              {zoom}%
            </button>
            <button type="button" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(ZOOM_BUTTON_STEP)}>
              +
            </button>
            {mode === 'edit' && (
              <button
                type="button"
                aria-label="Zoom to the selection"
                title="Zoom to the selection (⇧2)"
                disabled={editor.selection.length === 0}
                onClick={zoomToSelection}
              >
                <Icon name="focus" />
              </button>
            )}
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
                  <Inspector
                    editor={editor}
                    sectionNames={initial.sectionNames}
                    booked={booked}
                    onNotice={setNotice}
                    onSaveObject={saveObject}
                  />
                )}
                {panel === 'checks' && (
                  <ChecksPanel checks={checks} lint={lint} onLintChange={setLint} onFocus={focus} />
                )}
                {panel === 'json' && <JsonPanel plan={plan} onImport={() => openDialog('import-dialog')} />}
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
      <ShortcutsDialog />
    </div>
  )
}

function openDialog(id: string) {
  ;(document.getElementById(id) as HTMLDialogElement | null)?.showModal()
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

// The editor snaps to the site's 46-unit cells when Snap is on.
const SNAP = { cell: GRID_CELL }
const ZOOM_BUTTON_STEP = 1.4

function centerOf(view: PlanView): PlanPoint {
  return { x: view.x + view.w / 2, y: view.y + view.h / 2 }
}
