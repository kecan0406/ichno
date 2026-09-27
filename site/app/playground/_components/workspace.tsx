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
} from 'ichno'
import {
  planEdits,
  planHandles,
  useSeatPlanEditor,
  useSeatPlanEditorShortcuts,
  type EditorSelection,
} from 'ichno/editor'
import { SeatMap, useSeatMapView } from 'ichno/react'
import dynamic from 'next/dynamic'
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { describe } from '../../_demo/messages'
import { fixtureNames } from '../../_demo/plans'
import {
  DEFAULT_LINT,
  PRESETS,
  boundsOfIds,
  checksOf,
  copyDocument,
  downloadDocument,
  saveWorkbench,
  type Workbench,
} from '../_lib/documents'
import { loadLibrary, newObjectId, saveLibrary, type SavedObject } from '../_lib/library'
import { PLAYGROUND_OBJECTS, PRIMITIVE_TOOLS, savedObjectTool, type ToolDef } from '../_lib/playground-objects'
import { AssetsPanel } from './assets'
import { CanvasMenu, type CanvasMenuAt } from './context-menu'
import controls from './controls.module.css'
import { DesignPanel } from './design'
import { DocumentHead } from './file-menu'
import { Resizer, usePanels } from './frame'
import { Icon } from './icons'
import { LayersPanel } from './layers'
import { MenuButton, MenuItem, MenuSeparator } from './menu'
import { ChecksPanel, ImportDialog, JsonPanel, PreviewPanel, type PickRules } from './panels'
import { ShortcutsDialog } from './shortcuts'
import { Toolbar } from './toolbar'
import styles from './workspace.module.css'

// The playground's editor, laid out the way a design tool (Figma) is: the document's layers and the assets on the
// left, the plan in the middle with the tools floating over it, the properties of the selection on the right. Every
// area is its own component; this file holds the state they share and wires them to ichno's editor.

type LeftTab = 'layers' | 'assets'
type RightTab = 'design' | 'checks' | 'json'

// The 3D preview is this site's own (three.js) — fetched only when someone switches to it.
const Preview3D = dynamic(() => import('./preview-3d'), {
  ssr: false,
  loading: () => <p className={styles.loading}>Loading the 3D view…</p>,
})

const NOWHERE = 'Every place belongs to a section — move inside one to place it.'

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
  // One view for both modes — switching keeps where you were looking.
  const map = useSeatMapView(editor.plan)
  useSeatPlanEditorShortcuts(editor, { view: map })
  const { onTap, onHover, ...viewportProps } = editor.viewportProps
  const panels = usePanels()

  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  // Preview draws the plan with ichno (2D) or stands it up in the site's 3D view.
  const [dimension, setDimension] = useState<'2d' | '3d'>('2d')
  const [leftTab, setLeftTab] = useState<LeftTab>('layers')
  const [rightTab, setRightTab] = useState<RightTab>('design')
  // The Hand: every drag pans. It is the site's, not an ichno tool — the viewport simply gets nothing to drag.
  const [hand, setHand] = useState(false)
  // Keep the tool picked after placing something, instead of going back to selecting.
  const [keep, setKeep] = useState(false)
  const [library, setLibrary] = useState<SavedObject[]>([])
  // The Assets tab's form for saving the selection is open.
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [lint, setLint] = useState<Record<LintCode, LintSeverity>>(DEFAULT_LINT)
  const [picking, setPicking] = useState<'pick' | 'book'>('pick')
  const [picked, setPicked] = useState<string[]>([])
  const [rules, setRules] = useState<PickRules>({ max: 8, consecutive: false, noOrphans: true })
  // The layers row under the pointer — outlined on the plan.
  const [layerHover, setLayerHover] = useState<EditorSelection<string> | null>(null)
  const [menu, setMenu] = useState<CanvasMenuAt | null>(null)
  // The plan point under the pointer as last seen — where the menu's Paste lands.
  const pointRef = useRef<PlanPoint | null>(null)

  const plan = editor.plan
  const checks = checksOf(plan, lint)
  const errorCount = checks.filter((check) => check.severity === 'error').length
  const bookedStatus = Object.fromEntries(booked.map((id) => [id, 'booked']))
  const places = seatPlan.placesOf(plan)
  const guests = picked.reduce((sum, id) => sum + (places.find((place) => place.id === id)?.capacity ?? 0), 0)
  const pickIssues = validateSelection(plan, { selected: picked, unavailable: booked }, rules)
  const sectionLabel = (section: { id: string }) => initial.sectionNames[section.id] ?? section.id

  // The tool in use as this site knows it — its name and hint — and, for an asset, what it places.
  const tools = [...PRIMITIVE_TOOLS, ...PLAYGROUND_OBJECTS, ...library.map(savedObjectTool)]
  const activeTool = editor.tool === null ? null : (tools.find((def) => def.id === editor.tool?.id) ?? null)
  const placing =
    editor.tool === null
      ? null
      : (PLAYGROUND_OBJECTS.find((object) => object.id === editor.tool?.id)?.sample ??
        library.find((saved) => `saved:${saved.id}` === editor.tool?.id)?.template ??
        null)
  const asset = activeTool && placing ? { name: activeTool.name, template: placing } : null

  // Kept in this browser, so a reload picks up where you left off.
  useEffect(() => {
    if (autosave) saveWorkbench({ name: initial.name, plan, sectionNames: initial.sectionNames, booked })
  }, [autosave, plan, booked, initial.name, initial.sectionNames])

  // Saved objects live in localStorage, which the server cannot read.
  useEffect(() => {
    setLibrary(loadLibrary())
  }, [])

  // The site's own keys — its tools and panels. The editor's and the view's keys are ichno's
  // (useSeatPlanEditorShortcuts).
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented) return
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable], dialog')) return
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === 'Backslash') {
      e.preventDefault()
      panels.toggle()
      return
    }
    if (mode !== 'edit' || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) return openDialog('shortcuts-dialog')
    if (e.shiftKey && e.code === 'KeyI') return toggleAssets()
    if (e.shiftKey) return
    const def = [...PRIMITIVE_TOOLS, ...PLAYGROUND_OBJECTS].find((candidate) => candidate.code === e.code)
    if (def) return choose(def)
    if (e.code === 'KeyV') return choose(null)
    if (e.code === 'KeyH') return chooseHand()
    if (e.code === 'KeyQ') toggleKeep()
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // Picks a tool to draw with, or goes back to selecting with null.
  function choose(def: ToolDef | null) {
    setNotice(null)
    setHand(false)
    editor.setTool(def === null ? null : { ...def.tool, keep })
  }

  function chooseHand() {
    setNotice(null)
    editor.setTool(null)
    setHand(true)
  }

  function toggleKeep() {
    const next = !keep
    setKeep(next)
    if (editor.tool) editor.setTool({ ...editor.tool, keep: next })
  }

  function toggleAssets() {
    const showing = leftTab === 'assets' && !panels.hidden
    panels.setHidden(false)
    setLeftTab(showing ? 'layers' : 'assets')
  }

  // Opens the Assets tab's form for saving what is selected.
  function startSaving() {
    panels.setHidden(false)
    setLeftTab('assets')
    setSaving(true)
  }

  function saveObject(name: string) {
    const made = planEdits.templateOf(editor.plan, editor.selectedIds)
    if (!made) return
    const next = [...library, { id: newObjectId(), name, template: made.template }]
    setLibrary(next)
    saveLibrary(next)
    setNotice(`Saved “${name}” — it is under Your objects in Assets, ready to place again.`)
  }

  function deleteObject(id: string) {
    const next = library.filter((saved) => saved.id !== id)
    setLibrary(next)
    saveLibrary(next)
    if (editor.tool?.id === `saved:${id}`) editor.setTool(null)
  }

  // Deletes the selection and says what stays because it holds a booked place.
  function remove() {
    const refused = editor.removeSelected()
    setNotice(
      refused.length > 0
        ? `${refused.map((id) => describe(editor.plan, id)).join(', ')} holds a booked place and stays.`
        : null,
    )
  }

  // Selects exactly what a check points at and brings it into view.
  function focus(ids: string[]) {
    editor.setSelection(
      ids.map((id): EditorSelection<string> => ({ kind: seatPlan.groupById(plan, id) ? 'group' : 'object', id })),
    )
    map.zoomTo(boundsOfIds(plan, ids), 160)
  }

  // A layers row renamed — the label people read, on a group or a place.
  function relabel(item: EditorSelection<string>, label: string) {
    if (item.kind === 'group') {
      editor.updateGroup(item.id, (group) => {
        const { label: _, ...rest } = group
        return label ? { ...rest, label } : rest
      })
    } else {
      editor.updateObject(item.id, (object) => {
        if (object.kind !== 'place') return object
        const { label: _, ...rest } = object
        return label ? { ...rest, label } : rest
      })
    }
  }

  function switchMode(next: 'edit' | 'preview') {
    setMode(next)
    setNotice(null)
    setMenu(null)
    setLayerHover(null)
    // Keep the editor's shortcuts from acting on a selection or a tool that preview hides.
    if (next === 'preview') {
      editor.setTool(null)
      editor.select(null)
      setHand(false)
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

  function handleTap(target: PlanTarget<string> | null, info: { point: PlanPoint | null; additive: boolean }) {
    setNotice(null)
    onTap(target, info)
  }

  // A right-click selects what it is on (the way a click does) unless that is selected already, then opens the menu.
  function openMenu(e: MouseEvent<SVGSVGElement>) {
    e.preventDefault()
    if (mode !== 'edit') return
    if (editor.tool !== null) editor.setTool(null)
    const element = e.target instanceof Element ? e.target : null
    const id =
      element?.closest('[data-ichno-id]')?.getAttribute('data-ichno-id') ??
      element?.closest('[data-ichno-object]')?.getAttribute('data-ichno-object') ??
      null
    const section = element?.closest('[data-ichno-section]')?.getAttribute('data-ichno-section')
    if (id !== null) {
      if (!editor.selectedObjects.some((object) => object.id === id)) editor.select({ kind: 'object', id })
    } else if (!editor.selection.some((item) => item.kind === 'section' && item.id === section)) {
      editor.select(null)
    }
    setMenu({ screen: { x: e.clientX, y: e.clientY }, plan: pointRef.current })
  }

  // Zooms to a level of the whole plan (1: all of it), about the middle of the view.
  function zoomToLevel(level: number) {
    const home = planView.home(plan)
    const view = map.view
    const middle = { x: view.x + view.w / 2, y: view.y + view.h / 2 }
    map.setView(planView.zoom(view, (level * view.w) / home.w, middle, home))
  }

  // Over the plan with a tool that can make nothing there — its places need a section to belong to.
  const nowhere = activeTool !== null && editor.pointer !== null && editor.draft === null
  const threeD = mode === 'preview' && dimension === '3d'
  const hint =
    mode !== 'edit'
      ? null
      : (notice ??
        (nowhere ? NOWHERE : hand ? 'Drag to pan the plan — V to select again.' : (activeTool?.hint ?? null)))
  const canvasTool = hand ? 'hand' : editor.tool === null ? 'select' : 'draw'
  const layerFrame = mode === 'edit' && layerHover !== null ? planHandles.frame(editor.displayPlan, [layerHover]) : null

  return (
    <div
      className={styles.app}
      data-mode={mode}
      data-panels={panels.hidden ? 'hidden' : undefined}
      style={{ '--left': `${panels.widths.left}px`, '--right': `${panels.widths.right}px` } as CSSProperties}
    >
      <aside className={styles.left} aria-label="Layers and assets">
        <DocumentHead
          name={initial.name}
          dirty={editor.dirty}
          onPreset={loadPreset}
          onImport={() => openDialog('import-dialog')}
          onCopy={() => void copyDocument(plan)}
          onDownload={() => downloadDocument(plan, initial.name)}
          onRevert={editor.reset}
          onShortcuts={() => openDialog('shortcuts-dialog')}
          onHidePanels={() => panels.setHidden(true)}
        />
        <div className={controls.tabs} role="tablist" aria-label="Left panel">
          <button
            type="button"
            role="tab"
            className={controls.tab}
            aria-selected={leftTab === 'layers'}
            onClick={() => setLeftTab('layers')}
          >
            Layers
          </button>
          <button
            type="button"
            role="tab"
            className={controls.tab}
            aria-selected={leftTab === 'assets'}
            title="Assets (⇧I)"
            onClick={() => setLeftTab('assets')}
          >
            Assets
          </button>
        </div>
        <div className={styles.tabPanel} role="tabpanel">
          {leftTab === 'layers' ? (
            <LayersPanel
              plan={plan}
              selection={editor.selection}
              sectionNames={initial.sectionNames}
              isLocked={editor.isLocked}
              onSelect={(items) => {
                setNotice(null)
                editor.setSelection(items)
              }}
              onHover={setLayerHover}
              onRename={relabel}
            />
          ) : (
            <AssetsPanel
              objects={PLAYGROUND_OBJECTS}
              saved={library}
              activeId={editor.tool?.id ?? null}
              canSave={editor.selectedIds.length > 0}
              saving={saving}
              onSavingChange={setSaving}
              onPick={choose}
              onSave={saveObject}
              onDelete={deleteObject}
            />
          )}
        </div>
        <Resizer
          side="left"
          label="Width of the layers panel"
          width={panels.widths.left}
          onResize={(width, keepIt) => panels.resize('left', width, keepIt)}
          onDone={panels.keep}
          onReset={() => panels.reset('left')}
        />
      </aside>

      <main className={styles.canvas} data-tool={canvasTool}>
        {mode === 'edit' ? (
          <SeatMap.Viewport
            {...(hand ? { plan: editor.displayPlan } : viewportProps)}
            {...map.viewProps}
            onTap={hand ? undefined : handleTap}
            onHover={(point, target) => {
              pointRef.current = point
              if (!hand) onHover(point, target)
            }}
            onContextMenu={openMenu}
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
            <SeatMap.EditorOverlay {...editor.overlayProps} hoverFrame={layerFrame ?? editor.overlayProps.hoverFrame} />
          </SeatMap.Viewport>
        ) : threeD ? (
          <Preview3D
            plan={plan}
            status={bookedStatus}
            picked={picked}
            isDisabled={(place) => picking === 'pick' && booked.includes(place.id)}
            sectionName={(id) => initial.sectionNames[id] ?? id}
            fixtureName={fixtureLabel}
            onPlaceTap={previewTap}
          />
        ) : (
          <SeatMap.Viewport
            plan={plan}
            {...map.viewProps}
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

        {mode === 'edit' && editor.conflictIds.length > 0 && (
          <p className={styles.conflicts} role="status">
            {editor.conflictIds.length} overlapping — the schema would refuse to save them
          </p>
        )}
        {hint && (
          <p className={styles.hint} aria-live="polite" data-warn={nowhere || undefined}>
            {hint}
          </p>
        )}
        {mode === 'edit' && !panels.hidden && (
          <Toolbar
            active={hand ? 'hand' : (editor.tool?.id ?? 'select')}
            asset={asset}
            assetsOpen={leftTab === 'assets'}
            snapping={snapping}
            keep={keep}
            onSelect={() => choose(null)}
            onHand={chooseHand}
            onTool={choose}
            onAssets={toggleAssets}
            onSnap={() => setSnapping((on) => !on)}
            onKeep={toggleKeep}
          />
        )}
        {mode === 'preview' && (
          <div className={`${controls.segmented} ${styles.dimension}`} role="radiogroup" aria-label="Preview as">
            <button
              type="button"
              role="radio"
              aria-checked={dimension === '2d'}
              title="The plan as ichno draws it"
              onClick={() => setDimension('2d')}
            >
              2D
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={dimension === '3d'}
              title="The same document stood up in 3D by this playground (three.js) — not part of ichno"
              onClick={() => setDimension('3d')}
            >
              3D
            </button>
          </div>
        )}
        {panels.hidden && (
          <button
            type="button"
            className={`${controls.button} ${styles.showPanels}`}
            title="Show panels (⌘\)"
            onClick={() => panels.setHidden(false)}
          >
            <Icon name="sidebar" size={14} />
            Show panels
          </button>
        )}
      </main>

      <aside className={styles.right} aria-label={mode === 'edit' ? 'Properties' : 'Preview'}>
        <div className={styles.head}>
          {mode === 'edit' && (
            <>
              <button
                type="button"
                className={controls.iconButton}
                aria-label="Undo"
                title="Undo (⌘Z)"
                disabled={!editor.canUndo}
                onClick={editor.undo}
              >
                <Icon name="undo" />
              </button>
              <button
                type="button"
                className={controls.iconButton}
                aria-label="Redo"
                title="Redo (⇧⌘Z)"
                disabled={!editor.canRedo}
                onClick={editor.redo}
              >
                <Icon name="redo" />
              </button>
            </>
          )}
          <span className={styles.spacer} />
          <button
            type="button"
            className={controls.button}
            data-primary={mode === 'edit' || undefined}
            title={mode === 'edit' ? 'See the plan as your customers would' : 'Back to editing'}
            onClick={() => switchMode(mode === 'edit' ? 'preview' : 'edit')}
          >
            <Icon name={mode === 'edit' ? 'play' : 'edit'} size={14} />
            {mode === 'edit' ? 'Preview' : 'Edit'}
          </button>
          {!threeD && (
            <MenuButton
              label="Zoom and view"
              className={styles.zoom}
              align="end"
              button={
                <>
                  {Math.round(map.level * 100)}%
                  <Icon name="chevronDown" size={12} />
                </>
              }
            >
              <MenuItem keys="+" disabled={!map.canZoomIn} onSelect={map.zoomIn}>
                Zoom in
              </MenuItem>
              <MenuItem keys="−" disabled={!map.canZoomOut} onSelect={map.zoomOut}>
                Zoom out
              </MenuItem>
              <MenuItem keys="⇧1" onSelect={map.fit}>
                Zoom to fit
              </MenuItem>
              <MenuItem
                keys="⇧2"
                disabled={mode !== 'edit' || editor.selection.length === 0}
                onSelect={() => map.zoomTo(editor.selectionBounds)}
              >
                Zoom to selection
              </MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => zoomToLevel(2)}>Zoom to 200%</MenuItem>
              <MenuItem onSelect={() => zoomToLevel(4)}>Zoom to 400%</MenuItem>
              <MenuSeparator />
              {mode === 'edit' && (
                <MenuItem checked={snapping} onSelect={() => setSnapping((on) => !on)}>
                  Snap to the grid
                </MenuItem>
              )}
              <MenuItem keys="⌘\" onSelect={panels.toggle}>
                Hide panels
              </MenuItem>
            </MenuButton>
          )}
        </div>

        {mode === 'edit' ? (
          <>
            <div className={controls.tabs} role="tablist" aria-label="Right panel">
              <button
                type="button"
                role="tab"
                className={controls.tab}
                aria-selected={rightTab === 'design'}
                onClick={() => setRightTab('design')}
              >
                Design
              </button>
              <button
                type="button"
                role="tab"
                className={controls.tab}
                aria-selected={rightTab === 'checks'}
                onClick={() => setRightTab('checks')}
              >
                Checks
                {checks.length > 0 && (
                  <span className={controls.count} data-error={errorCount > 0 || undefined}>
                    {checks.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                className={controls.tab}
                aria-selected={rightTab === 'json'}
                onClick={() => setRightTab('json')}
              >
                JSON
              </button>
            </div>
            <div className={styles.tabPanel} role="tabpanel">
              {rightTab === 'design' && (
                <DesignPanel
                  editor={editor}
                  name={initial.name}
                  sectionNames={initial.sectionNames}
                  booked={booked}
                  snapping={snapping}
                  onSnappingChange={setSnapping}
                  onNotice={setNotice}
                  onRemove={remove}
                  onSaveAsset={startSaving}
                />
              )}
              {rightTab === 'checks' && (
                <ChecksPanel checks={checks} lint={lint} onLintChange={setLint} onFocus={focus} />
              )}
              {rightTab === 'json' && (
                <JsonPanel plan={plan} name={initial.name} onImport={() => openDialog('import-dialog')} />
              )}
            </div>
          </>
        ) : (
          <div className={styles.tabPanel}>
            <PreviewPanel
              plan={plan}
              threeD={threeD}
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
        <Resizer
          side="right"
          label="Width of the properties panel"
          width={panels.widths.right}
          onResize={(width, keepIt) => panels.resize('right', width, keepIt)}
          onDone={panels.keep}
          onReset={() => panels.reset('right')}
        />
      </aside>

      <CanvasMenu
        at={menu}
        editor={editor}
        onClose={() => setMenu(null)}
        onRemove={remove}
        onSaveAsset={startSaving}
        onZoomToSelection={() => map.zoomTo(editor.selectionBounds)}
        onFit={map.fit}
        onHidePanels={() => panels.setHidden(true)}
      />
      <ImportDialog onLoad={(next) => onReplace({ name: 'Imported plan', plan: next, sectionNames: {}, booked: [] })} />
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
