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
  type PlanObject,
  type PlanPoint,
  type PlanRect,
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
  type ViewControls,
} from 'ichno/editor'
import { SeatMap, useSeatMapView } from 'ichno/react'
import dynamic from 'next/dynamic'
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { describe } from '../../_demo/messages'
import { fixtureNames } from '../../_demo/plans'
import { DEFAULT_LINT, PRESETS, checksOf, copyDocument, downloadDocument, type Workbench } from '../_lib/documents'
import { rowHandles } from '../_lib/build'
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
import { AssetsPanel } from './assets'
import type { BuildCamera, BuildControls, BuildView, Handoff } from './build-3d'
import { CanvasMenu, type CanvasMenuAt } from './context-menu'
import controls from './controls.module.css'
import { DesignPanel } from './design'
import { Dimensions } from './dimensions'
import { DocumentHead } from './file-menu'
import { Resizer, usePanels } from './frame'
import { Icon } from './icons'
import { LayersPanel } from './layers'
import { MenuButton, MenuItem, MenuSeparator } from './menu'
import marks from './marks.module.css'
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

// Editing in 3D is the site's as well — the same ichno editor, drawn by three.js and loaded the same way.
const Build3D = dynamic(() => import('./build-3d'), {
  ssr: false,
  loading: () => <p className={styles.loading}>Loading the 3D view…</p>,
})

const UNPASTABLE = 'What was copied holds places — paste it on the plan.'
const NO_IDS: ReadonlySet<string> = new Set()
const NO_STRAYS: string[] = []
// The steps a typed edge keeps to, toward the pointer — 15°, as Shift keeps a corner.
const EDGE_STEP = Math.PI / 12
// Seat numbers drawn smaller than this on screen are left out (`SeatMap.Content` defaults to 9).
const LABEL_MIN_PX = 6
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
  const map = useSeatMapView(editor.plan)
  const { onTap, onHover, ...viewportProps } = editor.viewportProps
  const panels = usePanels()

  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  // The plan as ichno draws it (2D), or stood up by the site in 3D — to edit or to preview.
  const [dimension, setDimension] = useState<'2d' | '3d'>('2d')
  // The 2D view lies under the 3D editor while one gives way to the other: until the 3D canvas has faded in, and
  // while it tilts back and fades away.
  const [entering3D, setEntering3D] = useState(false)
  const [leaving3D, setLeaving3D] = useState(false)
  const building = mode === 'edit' && (dimension === '3d' || leaving3D)
  // The 3D editor's view, for the zoom menu and keys and the turn keys.
  const build = useRef<BuildControls | null>(null)
  const buildCamera = useRef<BuildCamera | null>(null)
  // The 2D view the 3D editor takes over from.
  const handoff = useRef<Handoff | null>(null)
  const canvasRef = useRef<HTMLElement>(null)
  const [buildView, setBuildView] = useState<BuildView>({ level: 1, canZoomIn: true, canZoomOut: false })
  // What the zoom menu and the zoom keys drive — the 2D canvas's view or the 3D editor's.
  const view: ViewControls & BuildView = building
    ? {
        ...buildView,
        zoomIn: () => build.current?.zoomIn(),
        zoomOut: () => build.current?.zoomOut(),
        fit: () => build.current?.fit(),
        zoomTo: (rects: readonly PlanRect[]) => build.current?.zoomTo(rects) ?? false,
      }
    : map
  // What the zoom menu shows — read apart from the controls, which call into the 3D view's ref.
  const zoom: BuildView = building
    ? buildView
    : { level: map.level, canZoomIn: map.canZoomIn, canZoomOut: map.canZoomOut }
  useSeatPlanEditorShortcuts(editor, { view })
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
  // A length typed for the next edge of the room being drawn, in metres as typed.
  const [typed, setTyped] = useState('')
  // Which way the next wall piece runs — degrees clockwise from the right, turned by the wheel and R.
  const [pieceTurn, setPieceTurn] = useState(0)
  // The wheel scrolled toward the next turn.
  const wheeled = useRef(0)

  const plan = editor.plan
  const checks = checksOf(plan, lint)
  const errorCount = checks.filter((check) => check.severity === 'error').length
  const bookedStatus = Object.fromEntries(booked.map((id) => [id, 'booked']))
  const places = seatPlan.placesOf(plan)
  const guests = picked.reduce((sum, id) => sum + (places.find((place) => place.id === id)?.capacity ?? 0), 0)
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
    if (building && (e.code === 'Comma' || e.code === 'Period')) build.current?.turn(e.code === 'Period' ? 1 : -1)
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
    if (building) build.current?.zoomTo(seatPlan.boundsOfIds(plan, ids))
    else map.zoomTo(seatPlan.boundsOfIds(plan, ids), 160)
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

  // Editing, 2D and 3D hand the view over — the same spot in the middle, zoomed in as far — and the 3D camera tilts
  // between straight down, where the 2D view is, and its corner.
  function switchDimension(next: '2d' | '3d') {
    if (next === dimension) return
    setDimension(next)
    const element = canvasRef.current
    if (mode !== 'edit' || !element) return
    const size = { width: element.clientWidth, height: element.clientHeight }
    if (next === '3d') {
      if (leaving3D) {
        build.current?.rest()
        setLeaving3D(false)
        return
      }
      const center = { x: map.view.x + map.view.w / 2, y: map.view.y + map.view.h / 2 }
      handoff.current = { center, zoom: planView.scaleOf(map.view, size), level: map.level }
      setEntering3D(true)
      return
    }
    const camera = buildCamera.current
    if (!camera || !build.current) return
    // The 2D view over the 3D camera's spot, zoomed in as far.
    const home = planView.home(plan)
    const center = { x: camera.x, y: camera.z }
    const around = { x: center.x - home.w / 2, y: center.y - home.h / 2, w: home.w, h: home.h }
    const target = planView.zoom(around, buildView.level, center, home)
    // The 2D view is laid under the 3D one at once — drawing it is the heavy part, done before anything moves — and
    // shows as the canvas fades away at the end of the tilt.
    map.setView(target)
    setLeaving3D(true)
    build.current.leave({ center, zoom: planView.scaleOf(target, size) }, () => setLeaving3D(false))
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
    const element = e.target instanceof Element ? e.target : null
    const id =
      element?.closest('[data-ichno-id]')?.getAttribute('data-ichno-id') ??
      element?.closest('[data-ichno-object]')?.getAttribute('data-ichno-object') ??
      null
    const wall = element?.closest('[data-ichno-wall]')?.getAttribute('data-ichno-wall') ?? null
    openMenuOn(
      { x: e.clientX, y: e.clientY },
      id !== null ? { kind: 'object', id } : wall !== null ? { kind: 'wall', id: wall } : null,
    )
  }

  // The pointer over the plan, 2D or 3D — where Paste lands, and what the tool previews (the Hand previews nothing).
  function hover(point: PlanPoint | null, target: PlanTarget<string> | null) {
    pointRef.current = point
    if (!hand) onHover(point, target)
  }

  // Zooms to a level of the whole plan (1: all of it), about the middle of the view.
  function zoomToLevel(level: number) {
    if (building) {
      build.current?.setLevel(level)
      return
    }
    const home = planView.home(plan)
    const current = map.view
    const middle = { x: current.x + current.w / 2, y: current.y + current.h / 2 }
    map.setView(planView.zoom(current, (level * current.w) / home.w, middle, home))
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
              isLocked={editor.isLocked}
              onSelect={(items) => {
                setNotice(null)
                editor.setSelection(items)
              }}
              onHover={setLayerHover}
              onRename={relabel}
              frozen={frozen}
              hidden={hidden}
              onFreeze={(id, on) => setFrozen((current) => toggled(current, id, on))}
              onHide={(id, on) => setHidden((current) => toggled(current, id, on))}
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

      <main
        ref={canvasRef}
        className={styles.canvas}
        data-tool={canvasTool}
        data-refused={(refused && editor.stroke !== null) || undefined}
      >
        {building && (
          <Build3D
            plan={editor.displayPlan}
            draft={editor.draft}
            refused={refusedSample}
            selected={[...editor.selectedObjects.map((object) => object.id), ...editor.selectedWallIds]}
            conflicts={movingStrays.length === 0 ? stillInvalid : [...stillInvalid, ...movingStrays]}
            status={bookedStatus}
            overlay={{ ...editor.overlayProps, hoverFrame: layerFrame ?? editor.overlayProps.hoverFrame }}
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
            controlsRef={build}
            cameraRef={buildCamera}
            onCamera={(camera) => {
              buildCamera.current = camera
            }}
            handoffRef={handoff}
            onViewChange={setBuildView}
            fixtureName={fixtureLabel}
            onShown={() => {
              // The hand-over is taken — a later opening (after the preview) starts where the camera was.
              handoff.current = null
              setEntering3D(false)
            }}
          />
        )}
        {building && !entering3D && !leaving3D ? null : mode === 'edit' ? (
          <SeatMap.Viewport
            {...(hand ? { plan: editor.displayPlan } : viewportProps)}
            {...map.viewProps}
            onTap={hand ? undefined : handleTap}
            onHover={hover}
            onContextMenu={openMenu}
            wheel="pan"
            className={styles.viewport}
            aria-label="Seat plan editor"
          >
            {(frame) => (
              <>
                {/* The grid only reads the plan's size — the saved plan's does not change mid-drag. */}
                {snapping && <SeatMap.Grid plan={editor.plan} />}
                {/* What a drag leaves alone keeps its identity, so this layer is drawn once per drag. Numbers smaller
                    than 6 screen pixels are left out — unreadable anyway, and SVG text is what large plans pay for. */}
                <SeatMap.Content
                  plan={editor.stillPlan}
                  selected={selectedMarks}
                  invalid={stillInvalid}
                  status={bookedStatus}
                  isDisabled={never}
                  fixtureLabel={fixtureLabel}
                  fixtureVariant={fixtureVariant}
                  region={frame.region}
                  scale={frame.scale}
                  minLabelPx={LABEL_MIN_PX}
                />
                {editor.movingPlan && (
                  <SeatMap.Content
                    plan={editor.movingPlan}
                    selected={selectedMarks}
                    invalid={movingInvalid}
                    status={bookedStatus}
                    isDisabled={never}
                    fixtureLabel={fixtureLabel}
                    fixtureVariant={fixtureVariant}
                    scale={frame.scale}
                    minLabelPx={LABEL_MIN_PX}
                  />
                )}
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
                {refusedSample && (
                  <g className={marks.refused}>
                    <SeatMap.Content plan={refusedSample} fixtureVariant={fixtureVariant} minLabelPx={Infinity} />
                  </g>
                )}
                <Dimensions
                  stroke={editor.stroke}
                  draw={editor.tool?.draw}
                  corners={editor.corners}
                  pointer={editor.pointer}
                  typed={typedLength}
                  frame={measuredWall === null ? editor.overlayProps.frame : null}
                  wall={measuredWall}
                  scale={frame.scale}
                />
                <SeatMap.EditorOverlay
                  {...editor.overlayProps}
                  hoverFrame={layerFrame ?? editor.overlayProps.hoverFrame}
                />
              </>
            )}
          </SeatMap.Viewport>
        ) : threeD ? (
          <Preview3D
            plan={plan}
            status={bookedStatus}
            picked={picked}
            isDisabled={(place) => picking === 'pick' && booked.includes(place.id)}
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
              fixtureLabel={fixtureLabel}
              fixtureVariant={fixtureVariant}
            />
          </SeatMap.Viewport>
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
            onClick={() => switchDimension('2d')}
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
            onClick={() => switchDimension('3d')}
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
                  {Math.round(zoom.level * 100)}%
                  <Icon name="chevronDown" size={12} />
                </>
              }
            >
              <MenuItem keys="+" disabled={!zoom.canZoomIn} onSelect={view.zoomIn}>
                Zoom in
              </MenuItem>
              <MenuItem keys="−" disabled={!zoom.canZoomOut} onSelect={view.zoomOut}>
                Zoom out
              </MenuItem>
              <MenuItem keys="⇧1" onSelect={view.fit}>
                Zoom to fit
              </MenuItem>
              <MenuItem
                keys="⇧2"
                disabled={mode !== 'edit' || editor.selection.length === 0}
                onSelect={() => view.zoomTo(editor.selectionBounds)}
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

function openDialog(id: string) {
  ;(document.getElementById(id) as HTMLDialogElement | null)?.showModal()
}

function never(): boolean {
  return false
}

// A template centred on `at` — what a tool would drop there, to draw (no section; the ids it was kept with).
function sampleAt(template: PlanTemplate, at: PlanPoint, plan: SeatPlan<string>): SeatPlan<string> {
  return {
    ...plan,
    sections: [],
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

// Loose fixtures are named; the furniture in a group (chairs, table tops) goes unlabelled.
function fixtureLabel(fixture: Fixture): string | null {
  if (fixture.group !== undefined || fixture.role === undefined) return null
  return fixtureNames[fixture.role] ?? fixture.role
}

function fixtureVariant(fixture: Fixture): 'box' | 'wall' {
  return fixture.role === 'wall' ? 'wall' : 'box'
}

// The editor snaps to the site's 50-unit cells (half a metre) when Snap is on — walls to whole metres.
const SNAP = { cell: GRID_CELL, wall: WALL_STEP }
