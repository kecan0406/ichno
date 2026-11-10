import { describe, expect, it } from 'vitest'
import type { Place, PlanStroke, PlanTarget, SeatPlan } from '../core/types'
import { planEdits } from './operations'
import { createSeatPlanEditor } from './store'
import type { EditorTool } from './tools'

function seat(id: string, x: number): Place<'hall'> {
  return { kind: 'place', id, section: 'hall', shape: 'rect', capacity: 1, group: 'row', x, y: 300, w: 44, h: 44 }
}

const plan: SeatPlan<'hall'> = {
  version: 3,
  width: 1000,
  height: 600,
  sections: [
    {
      id: 'hall',
      points: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 600 },
        { x: 0, y: 600 },
      ],
    },
  ],
  walls: [],
  categories: [],
  groups: [{ id: 'row', label: 'A', role: 'row' }],
  objects: [
    { kind: 'fixture', id: 'stage', shape: 'rect', x: 300, y: 20, w: 400, h: 100 },
    seat('A1', 100),
    seat('A2', 150),
    seat('A3', 200),
  ],
}

const STAGE: PlanTarget<'hall'> = { kind: 'object', id: 'stage' }

const A1: PlanTarget<'hall'> = { kind: 'place', id: 'A1' }

const HELD = { constrain: false, fromCenter: false }

// A tool that drops a 10 × 10 fixture where its stroke ends — or, for a polygon, once it has its corners.
function dropper(draw: EditorTool<'hall'>['draw'], keep = false): EditorTool<'hall'> {
  return {
    id: 'dropper',
    draw,
    keep,
    create: (current, stroke) =>
      planEdits.addFixtures(current, [{ x: stroke.end.x, y: stroke.end.y, w: 10, h: 10 }]).plan,
  }
}

function tapAt(editor: ReturnType<typeof createSeatPlanEditor<'hall'>>, x: number, y: number) {
  const stroke: PlanStroke = { start: { x, y }, end: { x, y } }
  editor.getState().viewportProps.onDraw?.(stroke, { phase: 'end', ...HELD, pixel: 1 })
}

describe('createSeatPlanEditor — the editor outside React', () => {
  it('selects a grouped object’s group on a tap, and the object on the next', () => {
    const editor = createSeatPlanEditor({ initialPlan: plan })
    const press = editor.getState().viewportProps

    press.onTap(A1, { additive: false })
    expect(editor.getState().selection).toEqual([{ kind: 'group', id: 'row' }])
    press.onTap(A1, { additive: false })
    expect(editor.getState().selection).toEqual([{ kind: 'object', id: 'A1' }])
    press.onTap(STAGE, { additive: true })
    expect(editor.getState().selectedIds).toEqual(['A1', 'stage'])
    press.onTap(null, { additive: false })
    expect(editor.getState().selection).toEqual([])
  })

  it('commits a drag as one undo step and selects what it moved', () => {
    const editor = createSeatPlanEditor({ initialPlan: plan })
    const { onTargetDrag } = editor.getState().viewportProps

    onTargetDrag({ target: STAGE, phase: 'start', total: { x: 0, y: 0 } })
    onTargetDrag({ target: STAGE, phase: 'move', total: { x: 40, y: 10 } })
    // Drawn where the drag has it, not yet in the document.
    expect(editor.getState().displayPlan.objects[0]).toMatchObject({ x: 340, y: 30 })
    expect(editor.getState().plan).toBe(plan)
    onTargetDrag({ target: STAGE, phase: 'end', total: { x: 40, y: 10 } })

    const after = editor.getState()
    expect(after.plan.objects[0]).toMatchObject({ x: 340, y: 30 })
    expect(after.selectedIds).toEqual(['stage'])
    expect(after.dirty).toBe(true)
    expect(after.canUndo).toBe(true)

    editor.commands.undo()
    expect(editor.getState().plan).toBe(plan)
    expect(editor.getState().dirty).toBe(false)
    editor.commands.redo()
    expect(editor.getState().plan.objects[0]).toMatchObject({ x: 340, y: 30 })
  })

  it('puts back what a drag moved when it is cancelled, and ignores its release', () => {
    const editor = createSeatPlanEditor({ initialPlan: plan })
    const { onTargetDrag } = editor.getState().viewportProps

    onTargetDrag({ target: STAGE, phase: 'start', total: { x: 0, y: 0 } })
    onTargetDrag({ target: STAGE, phase: 'move', total: { x: 40, y: 10 } })
    expect(editor.commands.cancel()).toBe(true)
    expect(editor.getState().displayPlan).toBe(plan)
    onTargetDrag({ target: STAGE, phase: 'end', total: { x: 40, y: 10 } })
    expect(editor.getState().plan).toBe(plan)
    expect(editor.getState().canUndo).toBe(false)
    expect(editor.commands.cancel()).toBe(false)
  })

  it('keeps what a drag leaves alone the same objects from frame to frame', () => {
    const editor = createSeatPlanEditor({ initialPlan: plan })
    const { onTargetDrag } = editor.getState().viewportProps

    onTargetDrag({ target: STAGE, phase: 'start', total: { x: 0, y: 0 } })
    onTargetDrag({ target: STAGE, phase: 'move', total: { x: 10, y: 0 } })
    const first = editor.getState()
    onTargetDrag({ target: STAGE, phase: 'move', total: { x: 20, y: 0 } })
    const second = editor.getState()

    expect(second).not.toBe(first)
    expect(second.movingPlan).not.toBe(first.movingPlan)
    // The still layer, the selection's lists and the overlaps are what a memoized layer and the panels draw from.
    expect(second.stillPlan).toBe(first.stillPlan)
    expect(second.stillPlan.objects.map((object) => object.id)).toEqual(['A1', 'A2', 'A3'])
    expect(second.selection).toBe(first.selection)
    expect(second.selectedObjects).toBe(first.selectedObjects)
    expect(second.conflictIds).toBe(first.conflictIds)
    expect(second.viewportProps.onTargetDrag).toBe(first.viewportProps.onTargetDrag)
  })

  it('makes what a tool’s tap asks for, selects it, and goes back to selecting unless the tool is kept', () => {
    const editor = createSeatPlanEditor({ initialPlan: plan })

    editor.commands.setTool(dropper('point'))
    tapAt(editor, 500, 400)
    expect(editor.getState().plan.objects).toHaveLength(5)
    expect(editor.getState().selectedObjects).toMatchObject([{ x: 500, y: 400, w: 10, h: 10 }])
    expect(editor.getState().tool).toBeNull()

    editor.commands.setTool(dropper('point', true))
    tapAt(editor, 600, 400)
    expect(editor.getState().plan.objects).toHaveLength(6)
    expect(editor.getState().tool?.id).toBe('dropper')
  })

  it('draws a polygon corner by corner, and makes it when a tap comes back to the first', () => {
    const editor = createSeatPlanEditor({ initialPlan: plan })

    editor.commands.setTool(dropper('polygon'))
    tapAt(editor, 500, 400)
    tapAt(editor, 600, 400)
    tapAt(editor, 600, 500)
    expect(editor.getState().corners).toHaveLength(3)
    expect(editor.getState().plan).toBe(plan)
    expect(editor.commands.removePoint()).toBe(true)
    expect(editor.getState().corners).toHaveLength(2)
    tapAt(editor, 600, 500)
    tapAt(editor, 500, 400)
    expect(editor.getState().corners).toBeNull()
    expect(editor.getState().plan.objects).toHaveLength(5)
  })

  it('leaves what is frozen or hidden alone on the plan, and what is hidden out of what is drawn', () => {
    const editor = createSeatPlanEditor({ initialPlan: plan, frozenIds: ['stage'] })

    editor.getState().viewportProps.onTap(STAGE, { additive: false })
    expect(editor.getState().selection).toEqual([])
    expect(editor.getState().viewportProps.canDrag(STAGE)).toBe(false)
    // A panel still picks it.
    editor.commands.selectIds(['stage'])
    expect(editor.getState().selectedIds).toEqual(['stage'])

    editor.configure({ hiddenIds: ['row'] })
    expect(editor.getState().displayPlan.objects.map((object) => object.id)).toEqual(['stage'])
    expect(editor.getState().plan.objects).toHaveLength(4)
    expect(editor.getState().viewportProps.canDrag(A1)).toBe(false)
    expect(editor.getState().viewportProps.canDrag(STAGE)).toBe(true)
  })

  it('shows a preview without committing it, and ends it with the next edit', () => {
    const editor = createSeatPlanEditor({ initialPlan: plan })
    const wider = (current: SeatPlan<'hall'>) => ({ ...current, width: 1200 })

    editor.commands.preview(wider)
    expect(editor.getState().displayPlan.width).toBe(1200)
    expect(editor.getState().plan).toBe(plan)
    expect(editor.getState().canUndo).toBe(false)

    expect(editor.commands.edit((current) => ({ ...current, height: 700 }))).toBe(true)
    expect(editor.getState().displayPlan).toMatchObject({ width: 1000, height: 700 })
    // An edit that changes nothing is no step.
    expect(editor.commands.edit((current) => ({ ...current }))).toBe(false)
    expect(editor.getState().plan.height).toBe(700)
  })

  it('moves the baseline with markSaved, and goes back to it with reset', () => {
    const editor = createSeatPlanEditor({ initialPlan: plan })

    editor.commands.edit((current) => ({ ...current, height: 700 }))
    expect(editor.getState().dirty).toBe(true)
    editor.commands.markSaved()
    expect(editor.getState().dirty).toBe(false)
    expect(editor.getState().canUndo).toBe(true)
    editor.commands.edit((current) => ({ ...current, height: 800 }))
    editor.commands.reset()
    expect(editor.getState().plan.height).toBe(700)
    expect(editor.getState().canUndo).toBe(false)
  })

  it('tells its listeners once per command, and not at all when nothing changed', () => {
    const editor = createSeatPlanEditor({ initialPlan: plan, lockedIds: ['A1'] })
    let heard = 0

    const stop = editor.subscribe(() => {
      heard += 1
    })

    // Adds, commits and selects — one change to whoever listens.
    editor.commands.addFixtures([{ x: 10, y: 10, w: 20, h: 20 }])
    expect(heard).toBe(1)

    const before = editor.getState()
    // The same options handed over again — as a hook does after every render — are no change.
    editor.configure({ lockedIds: ['A1'] })
    expect(heard).toBe(1)
    expect(editor.getState()).toBe(before)

    editor.configure({ lockedIds: ['A1', 'A2'] })
    expect(heard).toBe(2)
    expect(editor.getState().isLocked('A2')).toBe(true)
    expect(editor.commands.removeObjects(['row'])).toEqual(['row'])

    stop()
    editor.commands.undo()
    expect(heard).toBe(3)
  })
})
