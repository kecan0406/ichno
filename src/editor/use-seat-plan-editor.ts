'use client'

import { useEffect, useEffectEvent, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import type { PlanPoint, PlanRect } from '../core/types'
import type { SeatPlanEditorOptions } from './state'
import { createSeatPlanEditor } from './store'

export type SeatPlanEditor<S extends string> = ReturnType<typeof useSeatPlanEditor<S>>

// Headless seat plan editor — document state, selection, creation tools, clipboard, undo history and every edit
// operation; no UI. Spread `viewportProps` into <SeatMap.Viewport> (ichno/react) for tap-to-select, drag-to-move,
// marquee selection and drawing with a tool; draw `displayPlan` (the plan with the drag in progress), `draft` (what
// the tool would make), `handles`, `frames` and `marquee` on top, and build panels, buttons and saving yourself.
// Edits stay local until you save `plan`; `markSaved` then makes what you saved the baseline `dirty` compares
// against. To open another document, remount (e.g. key the component by its id).
//
// Tapping an object in a group selects the group; tapping it again (with the group selected) selects the object
// alone. Operations that take ids accept object and group ids alike — a group acts as one.
//
// The editor itself lives outside React (`createSeatPlanEditor`, ./store.ts): this hook makes one, hands it the
// options after every render and redraws the component whenever anything changes. `store` is that editor — pass it
// down, and a panel can follow one part of it on its own (`useSyncExternalStore(store.subscribe, () =>
// store.getState().selection)`, or zustand's `useStore(store, (editor) => editor.selection)`) instead of redrawing
// with every frame of a drag. The commands keep their identity for the editor's whole life.
export function useSeatPlanEditor<S extends string>(options: SeatPlanEditorOptions<S>) {
  const [store] = useState(() => createSeatPlanEditor(options))
  const view = useSyncExternalStore(store.subscribe, store.getState, store.getInitialState)

  // After every render, before the browser paints: options that changed are drawn with at once.
  useLayoutEffect(() => {
    store.configure(options)
  })

  return { ...view, ...store.commands, store }
}

// The view controls the zoom keys drive — what useSeatMapView (ichno/react) returns, or your own.
export type ViewControls = {
  zoomIn(): void
  zoomOut(): void
  fit(): void
  zoomTo(rects: readonly PlanRect[]): boolean
}

// Keyboard shortcuts — Delete/Backspace removes the selection; the arrow keys move it (Shift: ten units, or a
// whole cell when snapping); R turns it a quarter clockwise (⇧R back); Escape drops the stroke, drag or marquee
// under way, then the tool, then the selection; ⌘/Ctrl+A selects everything; ⌘C, ⌘X and ⌘V copy, cut and paste
// (under the pointer when it is over the plan); ⌘D duplicates; ⌘G groups and ⇧⌘G ungroups; ⌘] and ⌘[ move the
// selection a step forward or backward in the drawing order, ⌥⌘] and ⌥⌘[ to the front or back; Enter selects the
// members of the selected groups and ⇧Enter the groups of the selected objects; ⌘Z undoes and ⇧⌘Z / Ctrl+Y redo.
// Given the `view`, + and − zoom, ⇧1 shows the whole plan and ⇧2 the selection. Ignored while typing in an input,
// textarea, select or contenteditable, for Enter on a control that answers it (a button, a link, a menu item), and
// for keys a handler already took (`preventDefault`).
export function useSeatPlanEditorShortcuts<S extends string>(
  editor: SeatPlanEditor<S>,
  options: { view?: ViewControls } = {},
) {
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented) return

    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return
    const command = e.metaKey || e.ctrlKey

    // Physical keys — with a non-Latin input method active `e.key` is not a Latin letter.
    if (command && e.code === 'KeyZ') {
      e.preventDefault()

      if (e.shiftKey) editor.redo()
      else editor.undo()

      return
    }

    if (command && e.code === 'KeyY') {
      e.preventDefault()
      editor.redo()

      return
    }

    if (command && e.code === 'KeyD') {
      e.preventDefault()
      editor.duplicateSelected()

      return
    }

    // With nothing selected ⌘[ and ⌘] stay the browser's (back and forward).
    if (command && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
      if (editor.selectedIds.length === 0) return
      e.preventDefault()
      const up = e.code === 'BracketRight'
      editor.reorderSelected(e.altKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward')

      return
    }

    if (command && e.code === 'KeyG') {
      e.preventDefault()

      if (e.shiftKey) editor.ungroupSelected()
      else editor.groupSelected()

      return
    }

    if (command && e.code === 'KeyA') {
      e.preventDefault()
      editor.selectAll()

      return
    }

    // Text the page has selected is the browser's to copy.
    if (command && (e.code === 'KeyC' || e.code === 'KeyX')) {
      if (editor.selectedIds.length === 0 || hasTextSelection()) return
      e.preventDefault()

      if (e.code === 'KeyC') editor.copySelected()
      else editor.cutSelected()

      return
    }

    if (command && e.code === 'KeyV') {
      if (editor.clipboard === null) return
      e.preventDefault()
      editor.paste()

      return
    }

    if (command || e.altKey) return
    const view = options.view
    const zoom = view ? zoomOf(e) : null

    if (view && zoom) {
      e.preventDefault()

      if (zoom === 'fit') view.fit()
      else if (zoom === 'selection') view.zoomTo(editor.selectionBounds)
      else if (zoom === 'in') view.zoomIn()
      else view.zoomOut()

      return
    }

    if (e.key === 'Escape') {
      if (editor.cancel()) return

      if (editor.tool !== null) editor.setTool(null)
      else if (editor.selection.length > 0) editor.select(null)

      return
    }

    if (e.key === 'Enter' && !answersEnter(e.target)) {
      if (editor.closePolygon() || (e.shiftKey ? editor.selectGroups() : editor.selectMembers())) e.preventDefault()

      return
    }

    const arrow = ARROWS.get(e.key)

    if (arrow) {
      if (editor.selection.length === 0) return
      e.preventDefault()
      const step = editor.snap ? (e.shiftKey ? editor.snap.cell : editor.snap.cell / 2) : e.shiftKey ? 10 : 1
      editor.moveSelected({ x: arrow.x * step, y: arrow.y * step })

      return
    }

    if (e.code === 'KeyR') {
      editor.rotateSelected(e.shiftKey ? -90 : 90)

      return
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!editor.removePoint()) editor.removeSelected()
    }
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e)
    window.addEventListener('keydown', listener)

    return () => window.removeEventListener('keydown', listener)
  }, [])
}

const ARROWS = new Map<string, PlanPoint>([
  ['ArrowLeft', { x: -1, y: 0 }],
  ['ArrowRight', { x: 1, y: 0 }],
  ['ArrowUp', { x: 0, y: -1 }],
  ['ArrowDown', { x: 0, y: 1 }],
])

// The zoom a key asks for — ⇧1 and ⇧2 by the physical key, since what Shift makes of a digit depends on the keyboard.
function zoomOf(e: KeyboardEvent): 'fit' | 'selection' | 'in' | 'out' | null {
  if (e.shiftKey && e.code === 'Digit1') return 'fit'

  if (e.shiftKey && e.code === 'Digit2') return 'selection'

  if (e.key === '+' || e.key === '=') return 'in'

  if (e.key === '-' || e.key === '_') return 'out'

  return null
}

// Whether a range of page text is selected — ⌘C then copies it, not the plan's selection.
function hasTextSelection(): boolean {
  const selected = window.getSelection()

  return selected !== null && !selected.isCollapsed && selected.toString().length > 0
}

// Controls that answer Enter themselves — a button presses, a link follows, a menu item picks.
const ENTER_CONTROLS =
  'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="treeitem"], [role="checkbox"], [role="radio"], [role="switch"]'

function answersEnter(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ENTER_CONTROLS) !== null
}
