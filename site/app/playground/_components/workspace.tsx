'use client'

import {
  GRID_CELL,
  seatPlan,
  validateSelection,
  type LintCode,
  type LintSeverity,
  type Place,
  type PlanObject,
  type PlanPoint,
  type PlanTarget,
  type PlanTemplate,
  type ScreenPoint,
  type SeatPlan,
} from 'ichno'
import {
  planEdits,
  planHandles,
  useSeatPlanEditor,
  useSeatPlanEditorShortcuts,
  type EditorSelection,
} from 'ichno/editor'
import { planTargetOf, useSeatMapView } from 'ichno/react'
import dynamic from 'next/dynamic'
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { describe } from '../../_demo/messages'
import { DEFAULT_LINT, PRESETS, checksOf, type Workbench } from '../_lib/documents'
import { rowHandles } from '../_lib/build'
import { fixtureLabel } from '../_lib/fixtures'
import { loadLibrary, newObjectId, saveLibrary, type SavedObject } from '../_lib/library'
import {
  PIECE_FINE_TURN,
  PIECE_TURN,
  PLAYGROUND_OBJECTS,
  PRIMITIVE_TOOLS,
  savedObjectTool,
  wallPiece,
  type ToolDef,
} from '../_lib/playground-objects'
import { METRE, WALL_STEP } from '../_lib/units'
import { BookingPanel, type PickRules } from './booking'
import { CanvasMenu, type CanvasMenuAt } from './context-menu'
import controls from './controls.module.css'
import { openDialog } from './dialogs'
import type { Measured } from './dimensions'
import { EditCanvas2D } from './edit-canvas-2d'
import { EditSide } from './edit-side'
import { Resizer, usePanels } from './frame'
import { Icon } from './icons'
import { LeftSide, type LeftTab } from './left-side'
import { ImportDialog } from './panels'
import { VIEW_MARGIN, useEditViews } from './use-edit-views'
import { Preview2D } from './preview-2d'
import { PreviewTitle } from './preview-chrome'
import preview from './preview.module.css'
import { ShortcutsDialog } from './shortcuts'
import { Toolbar } from './toolbar'
import styles from './workspace.module.css'

// The playground's editor, laid out the way a design tool (Figma) is: the document's layers and the assets on the
// left, the plan in the middle with the tools floating over it, the properties of the selection on the right. Every
// area is its own component; this file holds the state they share and wires them to ichno's editor.

// The 3D preview is this site's own (three.js) — fetched only when someone switches to it.
const Preview3D = dynamic(() => import('./preview-3d'), {
  ssr: false,
  loading: () => <p className={styles.loading}>Loading the 3D view…</p>,
})

// Editing in 3D is the site's as well — the same ichno editor, drawn by three.js. It is what opens first, so while
// it loads the 2D plan (drawn on the server) lies under it and hands over when it is ready.
const Build3D = dynamic(() => import('./build-3d'), { ssr: false })

const UNPASTABLE = 'What was copied holds places — paste it on the plan.'

const NO_IDS: ReadonlySet<string> = new Set()

const NO_STRAYS: string[] = []

// The steps a typed edge keeps to, toward the pointer — 15°, as Shift keeps a corner.
const EDGE_STEP = Math.PI / 12

// How far (screen pixels) the wheel scrolls to turn the next wall piece a step.
const TURN_WHEEL_PX = 40

// A set of ids with one put in or taken out.
function toggled(ids: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> {
  const next = new Set(ids)

  if (on) next.add(id)
  else next.delete(id)

  return next
}

export function Workspace({ initial, onReplace }: { initial: Workbench; onReplace(next: Workbench): void }) {
  const [booked, setBooked] = useState<string[]>(initial.booked)
  const [snapping, setSnapping] = useState(true)
  const [guiding, setGuiding] = useState(true)
  // Layers locked and hidden in the layers panel — editor state, never saved with the document.
  const [frozen, setFrozen] = useState<ReadonlySet<string>>(NO_IDS)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(NO_IDS)

  const editor = useSeatPlanEditor({
    initialPlan: initial.plan,
    lockedIds: booked,
    snap: snapping ? SNAP : undefined,
    frozenIds: frozen,
    hiddenIds: hidden,
    handles: [rowHandles(new Set(booked))],
    guides: guiding,
  })

  // One view for both modes — switching keeps where you were looking.
  const map = useSeatMapView(editor.plan, { margin: VIEW_MARGIN })
  const { onTap, onHover, ...viewportProps } = editor.viewportProps
  const panels = usePanels()

  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const canvasRef = useRef<HTMLElement>(null)
  // 2D or 3D, to edit or to preview — and the hand-over between them (./use-edit-views.ts).
  const views = useEditViews({ mode, plan: editor.plan, map, canvasRef })
  const { dimension, building, view, zoom } = views

  useSeatPlanEditorShortcuts(editor, { view })
  const [leftTab, setLeftTab] = useState<LeftTab>('layers')
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
  // A length typed for the next edge of the room being drawn, in metres as typed.
  const [typed, setTyped] = useState('')
  // Which way the next wall piece runs — degrees clockwise from the right, turned by the wheel and R.
  const [pieceTurn, setPieceTurn] = useState(0)
  // The wheel scrolled toward the next turn.
  const wheeled = useRef(0)

  const plan = editor.plan
  const checks = checksOf(plan, lint)
  const bookedStatus = Object.fromEntries(booked.map((id) => [id, 'booked']))
  const places = seatPlan.placesOf(plan)
  const pickIssues = validateSelection(plan, { selected: picked, unavailable: booked }, rules)

  // The tool in use as this site knows it — its name and hint — and, for an asset, what it places. The Wall is turned
  // the way the next piece runs.
  const primitives = PRIMITIVE_TOOLS.map((def) => (def.id === 'wall' ? wallPiece(pieceTurn) : def))
  const tools = [...primitives, ...PLAYGROUND_OBJECTS, ...library.map(savedObjectTool)]
  const activeTool = editor.tool === null ? null : (tools.find((def) => def.id === editor.tool?.id) ?? null)

  const placing =
    editor.tool === null
      ? null
      : (PLAYGROUND_OBJECTS.find((object) => object.id === editor.tool?.id)?.sample ??
        library.find((saved) => `saved:${saved.id}` === editor.tool?.id)?.template ??
        null)

  const asset = activeTool && placing ? { name: activeTool.name, template: placing } : null

  // Saved objects live in localStorage, which the server cannot read.
  useEffect(() => {
    setLibrary(loadLibrary())
  }, [])

  // Picks a tool to draw with, or goes back to selecting with null. A tool that stays picked by itself (the Wall) does
  // whatever Keep says.
  function choose(def: ToolDef | null) {
    setNotice(null)
    setTyped('')
    setHand(false)
    const picked = def?.id === 'wall' ? wallPiece(pieceTurn) : def
    editor.setTool(picked === null ? null : { ...picked.tool, keep: keep || picked.tool.keep === true })
  }

  // Turns the next wall piece by `degrees`.
  function turnPiece(degrees: number) {
    const next = (((pieceTurn + degrees) % 360) + 360) % 360
    setPieceTurn(next)

    if (editor.tool?.id === 'wall') editor.setTool(wallPiece(next).tool)
  }

  function chooseHand() {
    setNotice(null)
    editor.setTool(null)
    setHand(true)
  }

  function toggleKeep() {
    const next = !keep
    setKeep(next)

    if (editor.tool) editor.setTool({ ...editor.tool, keep: next || activeTool?.tool.keep === true })
  }

  function toggleAssets() {
    const showing = leftTab === 'assets' && !panels.hidden
    panels.setHidden(false)
    setLeftTab(showing ? 'layers' : 'assets')
  }

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

    if (e.code === 'KeyQ') return toggleKeep()

    if (e.code === 'Comma' || e.code === 'Period') views.turn(e.code === 'Period' ? 1 : -1)
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e)
    window.addEventListener('keydown', listener)

    return () => window.removeEventListener('keydown', listener)
  }, [])

  // Pastes — under the pointer, or where the menu opened — and says why when nothing could go there.
  function pasteAt(at: PlanPoint | undefined) {
    setNotice(editor.paste(at).length === 0 ? UNPASTABLE : null)
  }

  // The length typed for the next edge, while a wall is being drawn.
  const typedLength = editor.tool?.draw === 'path' && editor.corners !== null ? typed : ''

  // Keys caught before ichno's (which end a wall on Enter and take a corner back on ⌫): while a wall is drawn, digits
  // type a length — Enter puts the next corner that far toward the pointer, in 15° steps, and ⌫ and Esc take the
  // typing back first; ⌘V pastes the way ichno does, saying why when it cannot.
  const onEarlyKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || mode !== 'edit' || e.altKey) return

    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable], dialog')) return

    if (e.metaKey || e.ctrlKey) {
      if (e.code !== 'KeyV' || editor.clipboard === null) return
      e.preventDefault()
      pasteAt(undefined)

      return
    }

    // R turns the next wall piece, ahead of ichno's R (which turns the selection).
    if (editor.tool?.id === 'wall' && e.code === 'KeyR') {
      e.preventDefault()
      turnPiece(e.shiftKey ? -PIECE_TURN : PIECE_TURN)

      return
    }

    const last = editor.tool?.draw === 'path' ? editor.corners?.at(-1) : undefined

    if (last === undefined) return
    const decimal = (e.key === '.' || e.key === ',') && !typedLength.includes('.')

    if (/^[0-9]$/.test(e.key) || decimal) {
      e.preventDefault()
      setTyped(typedLength + (decimal ? '.' : e.key))

      return
    }

    if (typedLength === '') return

    if (e.key === 'Backspace' || e.key === 'Escape') {
      e.preventDefault()
      setTyped(e.key === 'Escape' ? '' : typedLength.slice(0, -1))

      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      setTyped('')
      const length = Number(typedLength) * METRE

      if (length > 0) editor.addPoint(edgeToward(last, editor.pointer, length))
    }
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onEarlyKey(e)
    window.addEventListener('keydown', listener, { capture: true })

    return () => window.removeEventListener('keydown', listener, { capture: true })
  }, [])

  // While the Wall is picked the wheel turns the next piece, the way a housing game turns what it holds — 15° a step,
  // ⇧ 5° — instead of panning. Pinching and ⌘ or Ctrl with the wheel still zoom.
  const onWheel = useEffectEvent((e: WheelEvent) => {
    if (editor.tool?.id !== 'wall' || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    e.stopPropagation()
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    const pixels = e.deltaMode === 1 ? delta * 33 : e.deltaMode === 2 ? delta * 800 : delta

    if (Math.sign(pixels) !== Math.sign(wheeled.current)) wheeled.current = 0
    wheeled.current += pixels

    if (Math.abs(wheeled.current) < TURN_WHEEL_PX) return
    turnPiece(Math.sign(wheeled.current) * (e.shiftKey ? PIECE_FINE_TURN : PIECE_TURN))
    wheeled.current = 0
  })

  useEffect(() => {
    const element = canvasRef.current

    if (!element) return
    const listener = (e: WheelEvent) => onWheel(e)
    element.addEventListener('wheel', listener, { capture: true, passive: false })

    return () => element.removeEventListener('wheel', listener, { capture: true })
  }, [])

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
    editor.selectIds(ids)
    views.reveal(seatPlan.boundsOfIds(plan, ids))
  }

  function switchMode(next: 'edit' | 'preview') {
    setMode(next)
    views.settle()
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

  // The preview's Book button: what is picked becomes taken.
  function bookPicked() {
    setBooked((current) => [...new Set([...current, ...picked])])
    setPicked([])
  }

  function loadPreset(id: string) {
    const preset = PRESETS.find((candidate) => candidate.id === id)

    if (!preset) return

    if (editor.dirty && !window.confirm('Replace the current document? Undo history is cleared.')) return
    onReplace(preset.workbench)
  }

  // What a marquee in 3D touched, picked the way the 2D marquee picks: grouped objects as their group, walls, nothing
  // frozen or hidden, Shift adding to the selection.
  function pickSwept(ids: readonly string[], info: { additive: boolean }) {
    const off = (id: string | undefined) => id !== undefined && (frozen.has(id) || hidden.has(id))

    const units = ids.flatMap((id): EditorSelection<string>[] => {
      if (seatPlan.wallOf(plan, id)) return off(id) ? [] : [{ kind: 'wall', id }]
      const object = seatPlan.objectById(plan, id)

      if (!object || off(object.id) || off(object.group)) return []

      return [object.group === undefined ? { kind: 'object', id } : { kind: 'group', id: object.group }]
    })

    editor.setSelection(info.additive ? [...editor.selection, ...units] : units)
  }

  function handleTap(target: PlanTarget<string> | null, info: { point: PlanPoint | null; additive: boolean }) {
    setNotice(null)
    onTap(target, info)
  }

  // A right-click selects what it is on (the way a click does) unless that is selected already, then opens the menu.
  function openMenuOn(screen: ScreenPoint, target: PlanTarget<string> | null) {
    if (mode !== 'edit') return

    if (editor.tool !== null) editor.setTool(null)

    if (target?.kind === 'wall') {
      if (!editor.selectedWallIds.includes(target.id)) editor.select(target)
    } else if (target?.kind === 'place' || target?.kind === 'object') {
      const id = target.id

      if (!editor.selectedObjects.some((object) => object.id === id)) editor.select({ kind: 'object', id })
    } else {
      editor.select(null)
    }

    setMenu({ screen, plan: pointRef.current })
  }

  // A right-click on the 2D canvas — on whatever its parts say is there.
  function openMenu(e: MouseEvent<SVGSVGElement>) {
    e.preventDefault()
    const target = planTargetOf<string>(e.target)
    const on = target?.kind === 'handle' || target?.kind === 'section' ? null : target
    openMenuOn({ x: e.clientX, y: e.clientY }, on ?? null)
  }

  // The pointer over the plan, 2D or 3D — where Paste lands, and what the tool previews (the Hand previews nothing).
  function hover(point: PlanPoint | null, target: PlanTarget<string> | null, info?: { pixel: number }) {
    pointRef.current = point

    if (!hand) onHover(point, target, info)
  }

  // Where the tool would draw — the end of the stroke under way, or where the pointer is — and whether it can make
  // nothing there, and why. A wall has no draft to miss before its second corner: the corners drawn show it.
  const drawAt = editor.stroke?.end ?? editor.pointer
  const refused = activeTool !== null && activeTool.tool.draw !== 'path' && drawAt !== null && editor.draft === null
  const reason = refused && activeTool && drawAt ? (activeTool.why?.(plan, drawAt) ?? null) : null

  // What it would have dropped, under the pointer, in the colour of what cannot be had — a stroke under way is marked
  // itself.
  const refusedSample =
    refused && editor.stroke === null && editor.pointer !== null && activeTool?.sample
      ? sampleAt(activeTool.sample, editor.pointer, plan)
      : null

  // Places standing outside their section — as drawn, and where a drag is taking them — marked like overlaps, unless
  // Checks has the warning off. The playground's section is the whole plan, so only an imported document has any. A
  // drag drawn in one layer (walls, or most of the plan) is all in `stillPlan`.
  const strayOff = lint.outside_section === 'off'
  const strays = strayOff ? NO_STRAYS : straysOf(editor.stillPlan.objects, editor.stillPlan)

  const movingStrays =
    strayOff || editor.movingPlan === null ? NO_STRAYS : straysOf(editor.movingPlan.objects, editor.stillPlan)

  const stillInvalid = strays.length === 0 ? editor.conflictIds : [...editor.conflictIds, ...strays]
  const movingInvalid = movingStrays.length === 0 ? editor.conflictIds : [...editor.conflictIds, ...movingStrays]
  const strayCount = strays.length + movingStrays.length
  // The wall whose edges are measured — the one a wall tool would make or carry on, or else the one selected wall.
  const [only] = editor.selection.length === 1 ? editor.selection : []

  const measuredWall =
    editor.tool !== null
      ? (editor.draft?.walls[0] ?? null)
      : only?.kind === 'wall'
        ? (seatPlan.wallOf(editor.displayPlan, only.id) ?? null)
        : null

  // What there is to measure — the lengths are written beside it, in 2D and in 3D.
  const measured: Measured = {
    stroke: editor.stroke,
    draw: editor.tool?.draw,
    corners: editor.corners,
    pointer: editor.pointer,
    typed: typedLength,
    frame: measuredWall === null ? editor.overlayProps.frame : null,
    wall: measuredWall,
  }

  // What is selected, for the parts to mark — places and walls.
  const selectedMarks =
    editor.selectedWallIds.length === 0
      ? editor.selectedPlaceIds
      : [...editor.selectedPlaceIds, ...editor.selectedWallIds]

  const threeD = mode === 'preview' && dimension === '3d'

  const hint =
    mode !== 'edit'
      ? null
      : (notice ??
        (typedLength !== ''
          ? `Next edge ${typedLength} m — Enter puts the corner toward the pointer, Esc clears it.`
          : (reason ?? (hand ? 'Drag to pan the plan — V to select again.' : (activeTool?.hint ?? null)))))

  const canvasTool = hand ? 'hand' : editor.tool === null ? 'select' : 'draw'
  const layerFrame = mode === 'edit' && layerHover !== null ? planHandles.frame(editor.displayPlan, [layerHover]) : null

  return (
    <div
      className={styles.app}
      data-mode={mode}
      data-panels={panels.hidden ? 'hidden' : undefined}
      // SAFETY: CSSProperties lists the standard properties only; these are custom ones, which an inline style takes.
      style={{ '--left': `${panels.widths.left}px`, '--right': `${panels.widths.right}px` } as CSSProperties}
    >
      <aside className={styles.left} aria-label="Layers and assets">
        <LeftSide
          editor={editor}
          name={initial.name}
          tab={leftTab}
          onTabChange={setLeftTab}
          frozen={frozen}
          hidden={hidden}
          onFreeze={(id, on) => setFrozen((current) => toggled(current, id, on))}
          onHide={(id, on) => setHidden((current) => toggled(current, id, on))}
          onLayerHover={setLayerHover}
          library={library}
          saving={saving}
          onSavingChange={setSaving}
          onPick={choose}
          onSave={saveObject}
          onDelete={deleteObject}
          onPreset={loadPreset}
          onHidePanels={() => panels.setHidden(true)}
          onNotice={setNotice}
        />
        <Resizer
          side="left"
          label="Width of the layers panel"
          width={panels.widths.left}
          onResize={(width, keepIt) => panels.resize('left', width, keepIt)}
          onDone={panels.keep}
          onReset={() => panels.reset('left')}
        />
      </aside>

      <main
        ref={canvasRef}
        className={styles.canvas}
        data-tool={canvasTool}
        data-refused={(refused && editor.stroke !== null) || undefined}
      >
        {building && (
          <Build3D
            plan={editor.displayPlan}
            committed={editor.plan}
            draft={editor.draft}
            refused={refusedSample}
            selected={[...editor.selectedObjects.map((object) => object.id), ...editor.selectedWallIds]}
            conflicts={movingStrays.length === 0 ? stillInvalid : [...stillInvalid, ...movingStrays]}
            status={bookedStatus}
            overlay={{ ...editor.overlayProps, hoverFrame: layerFrame ?? editor.overlayProps.hoverFrame }}
            measured={measured}
            grid={snapping ? GRID_CELL : null}
            tool={canvasTool}
            handlers={{
              onTap: handleTap,
              onHover: hover,
              canDrag: viewportProps.canDrag,
              onTargetDrag: viewportProps.onTargetDrag,
              onMarquee: pickSwept,
              onDraw: viewportProps.onDraw,
            }}
            onMenu={openMenuOn}
            {...views.build3D}
            fixtureName={fixtureLabel}
          />
        )}
        {building && !views.underlaid ? null : mode === 'edit' ? (
          <EditCanvas2D
            editor={editor}
            map={map}
            hand={hand}
            snapping={snapping}
            selected={selectedMarks}
            stillInvalid={stillInvalid}
            movingInvalid={movingInvalid}
            status={bookedStatus}
            refused={refusedSample}
            measured={measured}
            hoverFrame={layerFrame ?? editor.overlayProps.hoverFrame}
            onTap={handleTap}
            onHover={hover}
            onContextMenu={openMenu}
          />
        ) : (
          <div className={preview.stage}>
            {threeD ? (
              <Preview3D
                plan={plan}
                status={bookedStatus}
                picked={picked}
                isDisabled={(place) => picking === 'pick' && booked.includes(place.id)}
                onPlaceTap={previewTap}
                fromAbove={views.fromAbove}
              />
            ) : (
              <Preview2D
                plan={plan}
                map={map}
                status={bookedStatus}
                picked={picked}
                bookable={picking === 'book'}
                onPlaceTap={previewTap}
              />
            )}
          </div>
        )}

        {mode === 'preview' && (
          <>
            <PreviewTitle
              name={initial.name}
              free={places.filter((place) => !booked.includes(place.id)).length}
              total={places.length}
            />
            <button
              type="button"
              className={`${controls.button} ${preview.edit}`}
              title="Back to editing"
              onClick={() => switchMode('edit')}
            >
              <Icon name="edit" size={14} />
              Edit
            </button>
          </>
        )}
        {mode === 'edit' && (editor.conflictIds.length > 0 || strayCount > 0) && (
          <p className={styles.conflicts} role="status">
            {[
              editor.conflictIds.length > 0 &&
                `${editor.conflictIds.length} overlapping — the schema would refuse to save them`,
              strayCount > 0 && `${strayCount} outside their section`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        {hint && (
          <p className={styles.hint} aria-live="polite" data-warn={(notice === null && reason !== null) || undefined}>
            {hint}
          </p>
        )}
        {mode === 'edit' && !panels.hidden && (
          <Toolbar
            active={hand ? 'hand' : (editor.tool?.id ?? 'select')}
            asset={asset}
            assetsOpen={leftTab === 'assets'}
            snapping={snapping}
            guiding={guiding}
            keep={keep}
            onSelect={() => choose(null)}
            onHand={chooseHand}
            onTool={choose}
            onAssets={toggleAssets}
            onSnap={() => setSnapping((on) => !on)}
            onGuides={() => setGuiding((on) => !on)}
            onKeep={toggleKeep}
          />
        )}
        <div
          className={`${controls.segmented} ${styles.dimension}`}
          role="radiogroup"
          aria-label={mode === 'edit' ? 'Edit in' : 'Preview as'}
        >
          <button
            type="button"
            role="radio"
            aria-checked={dimension === '2d'}
            title={
              mode === 'edit'
                ? 'The plan as ichno draws it — with handles for exact edits'
                : 'The plan as ichno draws it'
            }
            onClick={() => views.switchDimension('2d')}
          >
            2D
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={dimension === '3d'}
            title={
              mode === 'edit'
                ? 'Build in 3D, seen from a corner — the same ichno editor, drawn by this playground (three.js)'
                : 'The same document stood up in 3D by this playground (three.js) — not part of ichno'
            }
            onClick={() => views.switchDimension('3d')}
          >
            3D
          </button>
        </div>
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

      <aside className={styles.right} aria-label={mode === 'edit' ? 'Properties' : 'Your selection'}>
        {mode === 'edit' ? (
          <EditSide
            editor={editor}
            name={initial.name}
            booked={booked}
            snapping={snapping}
            onSnappingChange={setSnapping}
            checks={checks}
            lint={lint}
            onLintChange={setLint}
            onFocus={focus}
            zoom={zoom}
            view={view}
            onZoomToLevel={views.zoomToLevel}
            onPreview={() => switchMode('preview')}
            onHidePanels={panels.toggle}
            onNotice={setNotice}
            onRemove={remove}
            onSaveAsset={startSaving}
          />
        ) : (
          <BookingPanel
            plan={plan}
            threeD={threeD}
            picked={picked}
            booked={booked}
            issues={picked.length > 0 ? pickIssues : []}
            rules={rules}
            onRulesChange={setRules}
            picking={picking}
            onPickingChange={setPicking}
            onRemove={(id) => setPicked((current) => current.filter((other) => other !== id))}
            onClear={() => setPicked([])}
            onBook={bookPicked}
            onFree={() => setBooked([])}
          />
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
        onPaste={pasteAt}
        onSaveAsset={startSaving}
        onFreeze={() => setFrozen((current) => new Set([...current, ...editor.selectedIds, ...editor.selectedWallIds]))}
        onHide={() => setHidden((current) => new Set([...current, ...editor.selectedIds, ...editor.selectedWallIds]))}
        onZoomToSelection={() => view.zoomTo(editor.selectionBounds)}
        onFit={view.fit}
        onHidePanels={() => panels.setHidden(true)}
      />
      <ImportDialog onLoad={(next) => onReplace({ name: 'Imported plan', plan: next, booked: [] })} />
      <ShortcutsDialog />
    </div>
  )
}

// A template centred on `at` — what a tool would drop there, to draw: the objects alone (no sections, and none of the
// plan's walls — they are not what is refused), with the ids they were kept with.
function sampleAt(template: PlanTemplate, at: PlanPoint, plan: SeatPlan<string>): SeatPlan<string> {
  return {
    ...plan,
    sections: [],
    walls: [],
    groups: template.groups,
    objects: template.objects.map((object): PlanObject<string> => {
      const moved = seatPlan.translate(object, at.x, at.y)

      return moved.kind === 'place' ? { ...moved, section: '' } : moved
    }),
  }
}

// The places among `objects` standing outside their section in `plan` — the way Checks finds them (`lintSeatPlan`).
function straysOf(objects: readonly PlanObject<string>[], plan: SeatPlan<string>): string[] {
  return objects.flatMap((object) => {
    if (object.kind !== 'place') return []
    const section = seatPlan.sectionOf(plan, object.section)

    return section && seatPlan.sectionAt({ sections: [section] }, seatPlan.centerOf(object)) === null ? [object.id] : []
  })
}

// `length` from `from` toward `toward` (rightward with no pointer), the direction kept to 15° steps — a typed edge.
function edgeToward(from: PlanPoint, toward: PlanPoint | null, length: number): PlanPoint {
  const angle =
    toward === null ? 0 : Math.round(Math.atan2(toward.y - from.y, toward.x - from.x) / EDGE_STEP) * EDGE_STEP

  return { x: Math.round(from.x + Math.cos(angle) * length), y: Math.round(from.y + Math.sin(angle) * length) }
}

// The editor snaps to the site's 50-unit cells (half a metre) when Snap is on — walls to whole metres.
const SNAP = { cell: GRID_CELL, wall: WALL_STEP }
