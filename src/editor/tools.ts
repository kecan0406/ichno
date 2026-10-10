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
  // (Shift keeps it to 15° steps, ending where the pointer falls on that direction) — Alt draws either from its
  // centre — `point` only where the pointer is (a drag moves the preview; letting go places it), and `polygon` a
  // corner at every tap (Shift keeps the edge to 15°
  // steps), closed by tapping its first corner or its last one again, or Enter (`closePolygon`); Backspace takes back
  // a corner (`removePoint`) and Escape drops it. A polygon's stroke lists its corners in `points`. `path` draws
  // corners the same way but may stay open — a wall: tapping its first corner closes it (`closed` on the stroke),
  // tapping its last one again or Enter ends it where it is, two corners at least, and a corner near a wall lands on
  // it, on the walls' step (`Snap.wall`). A drag before the first corner of either draws a rectangle (Shift: a square),
  // closed.
  draw: 'box' | 'line' | 'point' | 'polygon' | 'path'
  // The plan with the new objects, or null when nothing can be made there. A tap passes a stroke with no length —
  // make something of a default size centred on it. Called for every preview, so it must be pure.
  create(plan: SeatPlan<S>, stroke: PlanStroke): SeatPlan<S> | null
  // Stay active after making something (one row after another). By default the editor goes back to selecting.
  keep?: boolean
  // `false` hands the tool the pointer as it is, in whole units — neither the grid nor the smart guides move it — for a
  // tool that places what it makes itself (a wall piece hinged on the end of a wall, on the grid line under the
  // pointer).
  snap?: false
}

// The keys held while drawing, as the viewport reports them — Shift constrains, Alt draws from the centre.
export type StrokeKeys = { constrain?: boolean; fromCenter?: boolean }

// 15° — the steps a constrained line keeps to.
const LINE_STEP = Math.PI / 12
const EPSILON = 1e-9

// The stroke a tool gets for a press at `anchor` dragged to `pointer`: both ends snapped like everything the editor
// moves (to half cells when snapping, or to `step` — the walls' step for a path — whole units otherwise), then
// constrained by the keys held.
export function strokeOf(
  draw: EditorTool['draw'],
  anchor: PlanPoint,
  pointer: PlanPoint,
  keys: StrokeKeys,
  snap: Snap | null,
  step: number = snap ? snap.cell / 2 : 1,
): PlanStroke {
  const end = snapped(pointer, step)
  if (draw === 'point' || draw === 'polygon' || draw === 'path') return { start: end, end }
  const start = snapped(anchor, step)
  let d = { x: end.x - start.x, y: end.y - start.y }
  if (keys.constrain && draw === 'box') {
    const side = Math.max(Math.abs(d.x), Math.abs(d.y))
    d = { x: side * signOf(d.x), y: side * signOf(d.y) }
  }
  if (keys.constrain && draw === 'line') {
    // The pointer projected onto the nearest 15° step — a level or upright line as far as the grid goes, so a pointer a
    // little off the line does not stretch it past the grid.
    const angle = Math.round(Math.atan2(d.y, d.x) / LINE_STEP) * LINE_STEP
    const along = { x: Math.cos(angle), y: Math.sin(angle) }
    const level = Math.abs(along.x) < EPSILON || Math.abs(along.y) < EPSILON
    const reach = d.x * along.x + d.y * along.y
    const length = level ? Math.round(reach / step) * step : reach
    d = { x: Math.round(length * along.x) || 0, y: Math.round(length * along.y) || 0 }
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
