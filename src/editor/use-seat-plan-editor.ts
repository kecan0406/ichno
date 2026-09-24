'use client'

import { useEffect, useEffectEvent, useState } from 'react'
import { seatPlan } from '../core/geometry'
import { DEFAULT_SEAT_CELLS, GRID_CELL, seatGrid } from '../core/grid'
import type { PlanDrag, PlanObject, PlanPoint, PlanSize, PlanTarget, SeatPlan, Section } from '../core/types'
import type { EditorSelection } from './selection'

export type SeatPlanEditor<S extends string> = ReturnType<typeof useSeatPlanEditor<S>>

// Headless seat plan editor — document state, selection and every edit operation; no UI. Spread
// `viewportProps` into <SeatMap.Viewport> (ichno/react) for tap-to-select and drag-to-move, draw `displayPlan`
// (the plan with the drag in progress), and build panels, buttons and saving yourself. Edits stay local until you
// save `plan`. The plan is grid-normalized on open, so a pre-grid plan starts dirty. To adopt a new baseline after
// saving, remount (e.g. key the component by the saved version).
export function useSeatPlanEditor<S extends string>({ initialPlan }: { initialPlan: SeatPlan<S> }) {
  const [normalizedInitial] = useState(() => seatGrid.normalize(initialPlan))
  const [plan, setPlan] = useState(normalizedInitial)
  const [selection, setSelection] = useState<EditorSelection<S> | null>(null)
  const [drag, setDrag] = useState<PlanDrag<S> | null>(null)

  const dirty = JSON.stringify(plan) !== JSON.stringify(initialPlan)
  const selectedObject = selection?.kind === 'object' ? seatPlan.objectById(plan, selection.id) : undefined
  const selectedSection = selection?.kind === 'section' ? seatPlan.sectionOf(plan, selection.id) : undefined
  // The places of the selected object — pass them to the renderer as selected.
  const selectedPlaceIds = selectedObject
    ? seatPlan.placesOf({ objects: [selectedObject] }).map((place) => place.id)
    : []
  // The plan as drawn — the drag in progress applied with the snapping it will commit with.
  const displayPlan = drag === null || drag.phase === 'end' ? plan : draggedPlan(plan, drag)

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
    updateObject(id, (o) => movedObject(plan, o, to))
  }

  // Moves a section outline by whole cells (the delta is rounded to cells).
  function moveSection(id: S, delta: PlanPoint) {
    setPlan((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === id ? movedSection(prev, s, delta) : s)),
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

  // A tap selects what it landed on — a seat selects its row or table — and empty floor clears the selection.
  function handleTap(target: PlanTarget<S> | null) {
    setSelection(selectionOf(target))
  }

  function handleDrag(next: PlanDrag<S>) {
    if (next.phase === 'start') setSelection(selectionOf(next.target))
    if (next.phase !== 'end') {
      setDrag(next)
      return
    }
    setDrag(null)
    setPlan((prev) => draggedPlan(prev, next))
  }

  return {
    plan,
    dirty,
    selection,
    select: setSelection,
    selectedObject,
    selectedSection,
    selectedPlaceIds,
    displayPlan,
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
    // Spread into <SeatMap.Viewport> (ichno/react).
    viewportProps: {
      plan: displayPlan,
      onTap: handleTap,
      canDrag: canDragTarget,
      onTargetDrag: handleDrag,
    },
  }
}

function selectionOf<S extends string>(target: PlanTarget<S> | null): EditorSelection<S> | null {
  if (target === null) return null
  if (target.kind === 'section') return { kind: 'section', id: target.id }
  return { kind: 'object', id: target.kind === 'place' ? target.objectId : target.id }
}

function canDragTarget(): boolean {
  return true
}

// The plan with a drag applied — objects move by the drag total from where they are, sections by whole cells.
function draggedPlan<S extends string>(plan: SeatPlan<S>, drag: PlanDrag<S>): SeatPlan<S> {
  const { target, total } = drag
  if (target.kind === 'section') {
    return { ...plan, sections: plan.sections.map((s) => (s.id === target.id ? movedSection(plan, s, total) : s)) }
  }
  const id = target.kind === 'place' ? target.objectId : target.id
  return {
    ...plan,
    objects: plan.objects.map((o) => {
      if (o.id !== id) return o
      const from = o.kind === 'row' ? o.start : o
      return movedObject(plan, o, { x: from.x + total.x, y: from.y + total.y })
    }),
  }
}

// An object moved so its top-left (a row: its start point) lands on `to`, snapped to its grid and kept inside
// the plan. A desk also moves to the section its centre lands in.
function movedObject<S extends string>(plan: SeatPlan<S>, object: PlanObject<S>, to: PlanPoint): PlanObject<S> {
  if (object.kind === 'desk') {
    const pos = seatGrid.placeSeat(plan, object, to)
    const section = seatPlan.sectionAt(plan, { x: pos.x + object.w / 2, y: pos.y + object.h / 2 }) ?? object.section
    return { ...object, ...pos, section }
  }
  if (object.kind === 'fixture') return { ...object, ...seatGrid.placeFixture(plan, object, to) }
  const from = object.kind === 'row' ? object.start : object
  const snapped = seatGrid.placeFixture(plan, { w: 0, h: 0 }, to)
  return seatPlan.translate(object, snapped.x - from.x, snapped.y - from.y)
}

function movedSection<S extends string>(plan: SeatPlan<S>, section: Section<S>, delta: PlanPoint): Section<S> {
  const dx = Math.round(delta.x / GRID_CELL) * GRID_CELL
  const dy = Math.round(delta.y / GRID_CELL) * GRID_CELL
  return { ...section, points: section.points.map((p) => seatGrid.snapPoint(plan, { x: p.x + dx, y: p.y + dy })) }
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
