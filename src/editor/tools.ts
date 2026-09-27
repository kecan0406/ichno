import type { PlanPoint, PlanStroke, SeatPlan } from '../core/types'
import type { Snap } from './operations'

// Creation tools — how a press on the plan becomes new objects. The editor turns the press into a stroke, previews
// what the tool would make while it is drawn (and under the pointer before it is), commits it as one undo step and
// selects what it made. What gets made — a row, a table, a stage, a saved object — is the tool's `create`, written
// by the consumer with `layout` and `planEdits`; ichno never decides what a row or a table is.

export type EditorTool<S extends string = string> = {
  // Your name for the tool, so a toolbar can tell which one is active (`editor.tool?.id`).
  id?: string
  // What a drag draws: `box` a rectangle between its corners (Shift keeps it square), `line` from start to end
  // (Shift keeps it to 15° steps) — Alt draws either from its centre — and `point` only where the pointer is (a
  // drag moves the preview; letting go places it).
  draw: 'box' | 'line' | 'point'
  // The plan with the new objects, or null when nothing can be made there. A tap passes a stroke with no length —
  // make something of a default size centred on it. Called for every preview, so it must be pure.
  create(plan: SeatPlan<S>, stroke: PlanStroke): SeatPlan<S> | null
  // Stay active after making something (one row after another). By default the editor goes back to selecting.
  keep?: boolean
}

// The keys held while drawing, as the viewport reports them — Shift constrains, Alt draws from the centre.
export type StrokeKeys = { constrain?: boolean; fromCenter?: boolean }

// 15° — the steps a constrained line keeps to.
const LINE_STEP = Math.PI / 12

// The stroke a tool gets for a press at `anchor` dragged to `pointer`: both ends snapped like everything the editor
// moves (to half cells when snapping, whole units otherwise), then constrained by the keys held.
export function strokeOf(
  draw: EditorTool['draw'],
  anchor: PlanPoint,
  pointer: PlanPoint,
  keys: StrokeKeys,
  snap: Snap | null,
): PlanStroke {
  const step = snap ? snap.cell / 2 : 1
  const end = snapped(pointer, step)
  if (draw === 'point') return { start: end, end }
  const start = snapped(anchor, step)
  let d = { x: end.x - start.x, y: end.y - start.y }
  if (keys.constrain && draw === 'box') {
    const side = Math.max(Math.abs(d.x), Math.abs(d.y))
    d = { x: side * signOf(d.x), y: side * signOf(d.y) }
  }
  if (keys.constrain && draw === 'line') {
    const length = Math.hypot(d.x, d.y)
    const angle = Math.round(Math.atan2(d.y, d.x) / LINE_STEP) * LINE_STEP
    d = { x: Math.round(length * Math.cos(angle)) || 0, y: Math.round(length * Math.sin(angle)) || 0 }
  }
  return {
    start: keys.fromCenter ? { x: start.x - d.x, y: start.y - d.y } : start,
    end: { x: start.x + d.x, y: start.y + d.y },
  }
}

function snapped(point: PlanPoint, step: number): PlanPoint {
  return { x: Math.round(point.x / step) * step || 0, y: Math.round(point.y / step) * step || 0 }
}

function signOf(value: number): number {
  return value < 0 ? -1 : 1
}
