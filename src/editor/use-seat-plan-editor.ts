'use client'

import { useEffect, useEffectEvent, useState } from 'react'
import { seatPlan } from '../core/geometry'
import { seatGrid } from '../core/grid'
import type { LabelSequence } from '../core/labeling'
import type {
  AreaShape,
  PlanDrag,
  PlanObject,
  PlanPoint,
  PlanRect,
  PlanSize,
  PlanTarget,
  SeatPlan,
  TableShape,
} from '../core/types'
import { planEdits, type AlignEdge } from './operations'
import type { EditorSelection } from './selection'

export type SeatPlanEditor<S extends string> = ReturnType<typeof useSeatPlanEditor<S>>

type Options<S extends string> = {
  initialPlan: SeatPlan<S>
  // Ids your other records reference (booked seats, active sessions). Objects holding one cannot be removed,
  // renamed or shrunk past it; labels stay free to change.
  lockedIds?: Iterable<string>
}

type History<S extends string> = { past: SeatPlan<S>[]; present: SeatPlan<S>; future: SeatPlan<S>[] }

// Undo depth — plenty for an editing session, bounded so a long one does not hold every version.
const HISTORY_LIMIT = 100

// Headless seat plan editor — document state, selection, undo history and every edit operation; no UI. Spread
// `viewportProps` into <SeatMap.Viewport> (ichno/react) for tap-to-select and drag-to-move, draw `displayPlan`
// (the plan with the drag in progress), and build panels, buttons and saving yourself. Edits stay local until you
// save `plan`. The plan is grid-normalized on open, so a pre-grid plan starts dirty. To adopt a new baseline after
// saving, remount (e.g. key the component by the saved version).
export function useSeatPlanEditor<S extends string>({ initialPlan, lockedIds }: Options<S>) {
  const [normalizedInitial] = useState(() => seatGrid.normalize(initialPlan))
  const [history, setHistory] = useState<History<S>>({ past: [], present: normalizedInitial, future: [] })
  const [selection, setSelection] = useState<EditorSelection<S>[]>([])
  const [drag, setDrag] = useState<PlanDrag<S> | null>(null)
  const locked = new Set(lockedIds)

  const plan = history.present
  const dirty = JSON.stringify(plan) !== JSON.stringify(initialPlan)
  const selectedObjectIds = selection.flatMap((item) => (item.kind === 'object' ? [item.id] : []))
  const selectedObjects = plan.objects.filter((object) => selectedObjectIds.includes(object.id))
  const selectedSectionId = selection.find((item) => item.kind === 'section')?.id as S | undefined
  // The places of the selected objects — pass them to the renderer as selected.
  const selectedPlaceIds = seatPlan.placesOf({ objects: selectedObjects }).map((place) => place.id)
  // The plan as drawn — the drag in progress applied with the snapping it will commit with.
  const displayPlan = drag === null ? plan : planEdits.applyDrag(plan, drag, selectedObjectIds)

  // Every change goes through here: one undo step each, and the redo branch is dropped.
  function apply(update: (current: SeatPlan<S>) => SeatPlan<S> | null) {
    setHistory((h) => {
      const next = update(h.present)
      if (next === null || next === h.present) return h
      return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] }
    })
  }

  // Runs an operation that creates an object, commits it and selects the result.
  function create(result: { plan: SeatPlan<S>; id: string } | null): string | null {
    if (!result) return null
    apply(() => result.plan)
    setSelection([{ kind: 'object', id: result.id }])
    return result.id
  }

  function undo() {
    setHistory((h) => {
      const previous = h.past.at(-1)
      if (!previous) return h
      return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] }
    })
  }

  function redo() {
    setHistory((h) => {
      const [next, ...future] = h.future
      if (!next) return h
      return { past: [...h.past, h.present], present: next, future }
    })
  }

  // Selects what a target points at — a seat selects its row or table. `additive` toggles it in the selection
  // (shift/⌘-click); otherwise it replaces the selection. null clears it.
  function select(target: PlanTarget<S> | EditorSelection<S> | null, additive?: boolean) {
    const item = target === null ? null : selectionOf(target)
    if (!additive) {
      setSelection(item ? [item] : [])
      return
    }
    if (!item) return
    setSelection((current) =>
      current.some((other) => sameSelection(other, item))
        ? current.filter((other) => !sameSelection(other, item))
        : [...current, item],
    )
  }

  function handleTap(target: PlanTarget<S> | null, info: { additive: boolean }) {
    select(target, info.additive)
  }

  function handleDrag(next: PlanDrag<S>) {
    if (next.phase === 'start') {
      const item = selectionOf(next.target)
      // Dragging something outside the selection selects it alone; dragging a selected object moves the group.
      if (!selection.some((other) => sameSelection(other, item))) setSelection([item])
    }
    if (next.phase !== 'end') {
      setDrag(next)
      return
    }
    setDrag(null)
    apply((current) => planEdits.applyDrag(current, next, selectedObjectIds))
  }

  // Removes objects; returns the ids refused because they hold a locked id.
  function removeObjects(ids: readonly string[]): string[] {
    const { plan: next, refused } = planEdits.remove(plan, ids, locked)
    apply(() => next)
    setSelection((current) => current.filter((item) => item.kind !== 'object' || refused.includes(item.id)))
    return refused
  }

  // Changes an object id. false when the id is locked or already taken.
  function renameObject(id: string, nextId: string): boolean {
    const next = planEdits.rename(plan, id, nextId, locked)
    if (!next) return false
    apply(() => next)
    setSelection((current) =>
      current.map((item) => (item.kind === 'object' && item.id === id ? { ...item, id: nextId } : item)),
    )
    return true
  }

  // Grows or shrinks a row or table. false when a seat to remove is locked.
  function setSeatCount(id: string, count: number): boolean {
    const next = planEdits.setSeatCount(plan, id, count, locked)
    if (!next) return false
    apply(() => next)
    return true
  }

  // Copies the selected objects next to themselves and selects the copies.
  function duplicateSelected(): string[] {
    const result = planEdits.duplicate(plan, selectedObjectIds)
    if (result.ids.length === 0) return []
    apply(() => result.plan)
    setSelection(result.ids.map((id) => ({ kind: 'object' as const, id })))
    return result.ids
  }

  function reset() {
    setHistory({ past: [], present: normalizedInitial, future: [] })
    setSelection([])
  }

  return {
    plan,
    displayPlan,
    dirty,
    selection,
    selectedObjects,
    selectedSection: selectedSectionId === undefined ? undefined : seatPlan.sectionOf(plan, selectedSectionId),
    selectedPlaceIds,
    select,
    isLocked: (object: PlanObject<S>) => planEdits.isLocked(object, locked),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    reset,

    // Creating — each returns the new object's id and selects it (null when there is no room).
    addDesk: (section: S) => create(planEdits.addDesk(plan, section)),
    addFixture: (role: string, size: PlanSize) => create(planEdits.addFixture(plan, role, size)),
    addRow: (section: S, row: { start: PlanPoint; end: PlanPoint; seats: number; curve?: number; seatSize?: number }) =>
      create(planEdits.addRow(plan, section, row)),
    addTable: (
      section: S,
      table: { center: PlanPoint; seats: number; shape?: TableShape; size?: PlanSize; seatSize?: number },
    ) => create(planEdits.addTable(plan, section, table)),
    addBooth: (section: S, rect: PlanRect) => create(planEdits.addBooth(plan, section, rect)),
    addArea: (section: S, area: { rect: PlanRect; capacity: number; shape?: AreaShape }) =>
      create(planEdits.addArea(plan, section, area)),
    duplicateSelected,

    // Changing.
    updateObject: (id: string, update: (object: PlanObject<S>) => PlanObject<S>) =>
      apply((current) => ({ ...current, objects: current.objects.map((o) => (o.id === id ? update(o) : o)) })),
    moveObject: (id: string, to: PlanPoint) => apply((current) => planEdits.move(current, id, to)),
    moveSection: (id: S, delta: PlanPoint) => apply((current) => planEdits.moveSection(current, id, delta)),
    reshapeSection: (id: S, points: PlanPoint[]) => apply((current) => planEdits.reshapeSection(current, id, points)),
    rotateDesk: (id: string) => apply((current) => planEdits.rotateDesk(current, id)),
    setSeatCount,
    labelSeats: (id: string, sequence: LabelSequence) =>
      apply((current) => planEdits.labelSeats(current, id, sequence)),
    labelObjects: (ids: readonly string[], sequence: LabelSequence) =>
      apply((current) => planEdits.labelObjects(current, ids, sequence)),
    alignSelected: (edge: AlignEdge) => apply((current) => planEdits.align(current, selectedObjectIds, edge)),
    distributeSelected: (axis: 'x' | 'y') => apply((current) => planEdits.distribute(current, selectedObjectIds, axis)),
    renameObject,
    rotateSelected: () =>
      apply((current) => selectedObjectIds.reduce((next, id) => planEdits.rotateDesk(next, id), current)),

    // Removing — returns the ids refused because they are locked.
    removeObjects,
    removeSelected: () => removeObjects(selectedObjectIds),

    // Spread into <SeatMap.Viewport> (ichno/react).
    viewportProps: {
      plan: displayPlan,
      onTap: handleTap,
      canDrag: canDragTarget,
      onTargetDrag: handleDrag,
    },
  }
}

// Keyboard shortcuts — Delete/Backspace removes the selection, R turns selected desks' chairs, ⌘/Ctrl+Z undoes,
// ⇧⌘Z / Ctrl+Y redoes, ⌘/Ctrl+D duplicates. Ignored while typing in an input, textarea, select or contenteditable.
export function useSeatPlanEditorShortcuts<S extends string>(editor: SeatPlanEditor<S>) {
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
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
    if (command || e.altKey) return
    if (e.code === 'KeyR') {
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

function selectionOf<S extends string>(target: PlanTarget<S> | EditorSelection<S>): EditorSelection<S> {
  if (target.kind === 'section') return { kind: 'section', id: target.id }
  if (target.kind === 'place') return { kind: 'object', id: target.objectId }
  return { kind: 'object', id: target.id }
}

function sameSelection<S extends string>(a: EditorSelection<S>, b: EditorSelection<S>): boolean {
  return a.kind === b.kind && a.id === b.id
}

function canDragTarget(): boolean {
  return true
}
