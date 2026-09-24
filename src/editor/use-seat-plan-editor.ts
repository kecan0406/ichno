'use client'

import { useEffect, useEffectEvent, useState } from 'react'
import { seatPlan } from '../core/geometry'
import { DEFAULT_SEAT_CELLS, seatGrid } from '../core/grid'
import type { PlanObject, PlanPoint, PlanSize, SeatPlan } from '../core/types'
import type { EditorSelection } from './selection'

export type SeatPlanEditor<S extends string> = ReturnType<typeof useSeatPlanEditor<S>>

// Headless seat plan editor — document state, selection and every edit operation; no UI. Build panels, buttons
// and saving yourself. Edits stay local until you save `plan`. The plan is grid-normalized on open, so a
// pre-grid plan starts dirty. To adopt a new baseline after saving, remount (e.g. key the component by the saved
// version).
export function useSeatPlanEditor<S extends string>({ initialPlan }: { initialPlan: SeatPlan<S> }) {
  const [normalizedInitial] = useState(() => seatGrid.normalize(initialPlan))
  const [plan, setPlan] = useState(normalizedInitial)
  const [selection, setSelection] = useState<EditorSelection<S> | null>(null)

  const dirty = JSON.stringify(plan) !== JSON.stringify(initialPlan)
  const selectedObject = selection?.kind === 'object' ? seatPlan.objectById(plan, selection.id) : undefined
  const selectedSection = selection?.kind === 'section' ? seatPlan.sectionOf(plan, selection.id) : undefined

  function updateObject(id: string, update: (object: PlanObject<S>) => PlanObject<S>) {
    setPlan((prev) => ({ ...prev, objects: prev.objects.map((o) => (o.id === id ? update(o) : o)) }))
  }

  // Adds a standard desk (2×2 cells) at the section's first free cell and selects it.
  // Returns the new desk id, or null when the section has no free 2×2 spot.
  function addDesk(section: S): string | null {
    const pos = seatPlan.findFreeDeskPos(plan, section)
    if (!pos) return null
    const span = seatGrid.seatSpanPxOf(DEFAULT_SEAT_CELLS)
    const id = seatPlan.nextPlaceId(plan, section)
    const desk = { kind: 'desk' as const, id, section, ...pos, w: span, h: span, chairSide: 'down' as const }
    setPlan((prev) => ({ ...prev, objects: [...prev.objects, desk] }))
    setSelection({ kind: 'object', id })
    return id
  }

  // Adds a fixture of the consumer's `role` in the first spot clear of every object, and selects it.
  // Returns the new fixture id, or null when the plan has no room.
  function addFixture(role: string, size: PlanSize): string | null {
    const pos = seatPlan.findFreeFixturePos(plan, size)
    if (!pos) return null
    const id = seatPlan.nextObjectId(plan, role)
    const fixture = { kind: 'fixture' as const, id, role, ...pos, ...size }
    // Fixtures go under everything else — object order is drawing order.
    setPlan((prev) => ({ ...prev, objects: [fixture, ...prev.objects] }))
    setSelection({ kind: 'object', id })
    return id
  }

  function removeObject(id: string) {
    setPlan((prev) => ({ ...prev, objects: prev.objects.filter((o) => o.id !== id) }))
    setSelection(null)
  }

  // Changes an object id (for places, the key other records reference). Validate uniqueness/length first.
  function renameObject(id: string, nextId: string) {
    updateObject(id, (o) => ({ ...o, id: nextId }))
    setSelection({ kind: 'object', id: nextId })
  }

  // Turns a desk's chair one edge clockwise.
  function rotateDesk(id: string) {
    updateObject(id, (o) => (o.kind === 'desk' ? { ...o, chairSide: seatPlan.nextChairSide(o.chairSide) } : o))
  }

  // Moves an object so its top-left (a row: its start point) lands on `to`, snapped to its grid and kept inside
  // the plan. A desk also moves to the section its centre lands in.
  function moveObject(id: string, to: PlanPoint) {
    updateObject(id, (o) => {
      if (o.kind === 'desk') {
        const pos = seatGrid.placeSeat(plan, o, to)
        const section = seatPlan.sectionAt(plan, { x: pos.x + o.w / 2, y: pos.y + o.h / 2 }) ?? o.section
        return { ...o, ...pos, section }
      }
      if (o.kind === 'fixture') return { ...o, ...seatGrid.placeFixture(plan, o, to) }
      const from = o.kind === 'row' ? o.start : o
      const snapped = seatGrid.placeFixture(plan, { w: 0, h: 0 }, to)
      return seatPlan.translate(o, snapped.x - from.x, snapped.y - from.y)
    })
  }

  // Moves a section outline by whole cells.
  function moveSection(id: S, delta: PlanPoint) {
    setPlan((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === id
          ? { ...s, points: s.points.map((p) => seatGrid.snapPoint(prev, { x: p.x + delta.x, y: p.y + delta.y })) }
          : s,
      ),
    }))
  }

  // Replaces a section outline (e.g. after resizing), snapped to cell corners.
  function reshapeSection(id: S, points: PlanPoint[]) {
    setPlan((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === id ? { ...s, points: points.map((p) => seatGrid.snapPoint(prev, p)) } : s,
      ),
    }))
  }

  // Removes the selected object (sections are fixed and cannot be removed).
  function removeSelected() {
    if (selection?.kind === 'object') removeObject(selection.id)
  }

  function rotateSelected() {
    if (selection?.kind === 'object') rotateDesk(selection.id)
  }

  function reset() {
    setPlan(normalizedInitial)
    setSelection(null)
  }

  return {
    plan,
    dirty,
    selection,
    select: setSelection,
    selectedObject,
    selectedSection,
    addDesk,
    addFixture,
    updateObject,
    removeObject,
    renameObject,
    rotateDesk,
    moveObject,
    moveSection,
    reshapeSection,
    removeSelected,
    rotateSelected,
    reset,
  }
}

// Keyboard shortcuts — Delete/Backspace removes the selected object, R turns the selected desk's chair.
// Ignored while typing in an input, textarea, select or contenteditable.
export function useSeatPlanEditorShortcuts<S extends string>(editor: SeatPlanEditor<S>) {
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return
    // Physical key — with a non-Latin input method active `e.key` is not 'r'. Modifier combos belong to the browser.
    if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      editor.rotateSelected()
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') editor.removeSelected()
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}
