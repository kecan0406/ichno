'use client'

import { useEffect, useEffectEvent, useState } from 'react'
import { FIXTURE_DEFAULT_SIZE, seatPlan } from '../core/geometry'
import { DEFAULT_SEAT_CELLS, seatGrid } from '../core/grid'
import type { Fixture, FixtureKind, PlanPoint, PlanRect, Seat, SeatPlan } from '../core/types'
import type { EditorSelection } from './selection'

export type SeatPlanEditor<Z extends string> = ReturnType<typeof useSeatPlanEditor<Z>>

// Headless seat plan editor — document state, selection and every edit operation; no UI. Draw with
// `SeatPlanEditorStage` (ichno/konva) fed by `stageProps`, and build panels/buttons/saving yourself.
// Edits stay local until you save `plan`. The plan is grid-normalized on open, so a pre-grid plan starts dirty.
// To adopt a new baseline after saving, remount (e.g. key the component by the saved version).
export function useSeatPlanEditor<Z extends string>({ initialPlan }: { initialPlan: SeatPlan<Z> }) {
  const [normalizedInitial] = useState(() => seatGrid.normalize(initialPlan))
  const [plan, setPlan] = useState(normalizedInitial)
  const [selection, setSelection] = useState<EditorSelection<Z> | null>(null)

  const dirty = JSON.stringify(plan) !== JSON.stringify(initialPlan)
  const selectedSeat = selection?.kind === 'seat' ? seatPlan.byId(plan, selection.id) : undefined
  const selectedZone = selection?.kind === 'zone' ? plan.zones.find((z) => z.id === selection.id) : undefined
  const selectedFixture = selection?.kind === 'fixture' ? plan.fixtures.find((f) => f.id === selection.id) : undefined

  function updateSeat(id: string, patch: Partial<Seat<Z>>) {
    setPlan((prev) => ({ ...prev, seats: prev.seats.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  }

  function updateZone(id: Z, patch: Partial<PlanRect>) {
    setPlan((prev) => ({ ...prev, zones: prev.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) }))
  }

  function updateFixture(id: string, patch: Partial<Fixture>) {
    setPlan((prev) => ({ ...prev, fixtures: prev.fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f)) }))
  }

  // Adds a standard seat (2×2 cells) at the zone's first free cell and selects it.
  // Returns the new seat id, or null when the zone has no free 2×2 spot.
  function addSeat(zone: Z): string | null {
    const pos = seatPlan.findFreeSeatPos(plan, zone)
    if (!pos) return null
    const span = seatGrid.seatSpanPxOf(DEFAULT_SEAT_CELLS)
    const id = seatPlan.nextSeatId(plan, zone)
    setPlan((prev) => ({ ...prev, seats: [...prev.seats, { id, zone, ...pos, w: span, h: span, chairSide: 'down' }] }))
    setSelection({ kind: 'seat', id })
    return id
  }

  // Adds a fixture at its default size in the first spot clear of seats and fixtures, and selects it.
  // Returns the new fixture id, or null when the plan has no room.
  function addFixture(kind: FixtureKind): string | null {
    const size = FIXTURE_DEFAULT_SIZE[kind]
    const pos = seatPlan.findFreeFixturePos(plan, size)
    if (!pos) return null
    const id = seatPlan.nextFixtureId(plan, kind)
    setPlan((prev) => ({ ...prev, fixtures: [...prev.fixtures, { id, kind, ...pos, ...size }] }))
    setSelection({ kind: 'fixture', id })
    return id
  }

  function removeSeat(id: string) {
    setPlan((prev) => ({ ...prev, seats: prev.seats.filter((s) => s.id !== id) }))
    setSelection(null)
  }

  function removeFixture(id: string) {
    setPlan((prev) => ({ ...prev, fixtures: prev.fixtures.filter((f) => f.id !== id) }))
    setSelection(null)
  }

  // Changes a seat id (the key other records reference). Validate uniqueness/length before calling.
  function renameSeat(id: string, nextId: string) {
    setPlan((prev) => ({ ...prev, seats: prev.seats.map((s) => (s.id === id ? { ...s, id: nextId } : s)) }))
    setSelection({ kind: 'seat', id: nextId })
  }

  // Turns a seat's chair one edge clockwise.
  function rotateSeat(id: string) {
    setPlan((prev) => ({
      ...prev,
      seats: prev.seats.map((s) => (s.id === id ? { ...s, chairSide: seatPlan.nextChairSide(s.chairSide) } : s)),
    }))
  }

  // Removes the selected seat or fixture (zones are fixed and cannot be removed).
  function removeSelected() {
    if (selection?.kind === 'seat') removeSeat(selection.id)
    if (selection?.kind === 'fixture') removeFixture(selection.id)
  }

  function rotateSelected() {
    if (selection?.kind === 'seat') rotateSeat(selection.id)
  }

  function reset() {
    setPlan(normalizedInitial)
    setSelection(null)
  }

  // Drag commit — the stage already snapped/clamped; the seat also moves to the zone its centre landed in.
  function moveSeat(id: string, pos: PlanPoint) {
    const seat = seatPlan.byId(plan, id)
    if (!seat) return
    const zone = seatPlan.zoneAt(plan, { x: pos.x + seat.w / 2, y: pos.y + seat.h / 2 }) ?? seat.zone
    updateSeat(id, { ...pos, zone } as Partial<Seat<Z>>)
  }

  return {
    plan,
    dirty,
    selection,
    select: setSelection,
    selectedSeat,
    selectedZone,
    selectedFixture,
    addSeat,
    addFixture,
    updateSeat,
    updateZone,
    updateFixture,
    removeSeat,
    removeFixture,
    renameSeat,
    rotateSeat,
    removeSelected,
    rotateSelected,
    reset,
    // Spread into <SeatPlanEditorStage> (ichno/konva) together with size and view.
    stageProps: {
      plan,
      selection,
      onSelect: setSelection,
      onSeatDragEnd: moveSeat,
      onZoneDragEnd: (id: Z, pos: PlanPoint) => updateZone(id, pos),
      onFixtureDragEnd: (id: string, pos: PlanPoint) => updateFixture(id, pos),
    },
  }
}

// Keyboard shortcuts — Delete/Backspace removes the selected seat or fixture, R turns the selected seat's chair.
// Ignored while typing in an input, textarea, select or contenteditable.
export function useSeatPlanEditorShortcuts<Z extends string>(editor: SeatPlanEditor<Z>) {
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
