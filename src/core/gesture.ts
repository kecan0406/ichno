// Pointer gestures as a pure state machine — renderer and framework free, so the SVG viewport, a future canvas
// layer and tests share one definition of tap, drag, pan and pinch. Feed it pointer events in screen pixels and
// act on the events it returns; it never touches the DOM.
//
// A press becomes a drag once the pointer travels past the threshold, otherwise releasing it is a tap. A second
// pointer turns any press or drag into a pinch; when one of the two lifts, the remaining pointer continues as a
// fresh drag from where it is (so the view does not jump). A drag on no target is a pan — the caller decides.

export type GesturePointer = { id: number; x: number; y: number }
export type ScreenPoint = { x: number; y: number }

export type GestureState =
  | { kind: 'idle' }
  | { kind: 'pressed'; pointer: GesturePointer; target: string | null }
  | { kind: 'dragging'; pointer: GesturePointer; origin: ScreenPoint; target: string | null }
  | { kind: 'pinching'; pointers: [GesturePointer, GesturePointer] }

export type GestureEvent =
  | { type: 'tap'; target: string | null; point: ScreenPoint }
  | { type: 'dragstart'; target: string | null; point: ScreenPoint }
  // `delta` is the movement since the previous drag event; `total` since the drag started.
  | { type: 'drag'; target: string | null; point: ScreenPoint; delta: ScreenPoint; total: ScreenPoint }
  | { type: 'dragend'; target: string | null; point: ScreenPoint; total: ScreenPoint }
  // `factor` scales relative to the previous pinch event; `center` is the midpoint of the two pointers.
  | { type: 'pinch'; factor: number; center: ScreenPoint; delta: ScreenPoint }

export type GestureResult = { state: GestureState; events: GestureEvent[] }

// Movement (px) before a press counts as a drag. Touch fingers wobble more than a mouse.
export const DRAG_THRESHOLD_PX = 4
export const TOUCH_DRAG_THRESHOLD_PX = 8

export const IDLE_GESTURE: GestureState = { kind: 'idle' }

export const gesture = {
  down,
  move,
  up,
  cancel,
}

function down(state: GestureState, pointer: GesturePointer, target: string | null): GestureResult {
  switch (state.kind) {
    case 'idle':
      return { state: { kind: 'pressed', pointer, target }, events: [] }
    case 'pressed':
      return { state: { kind: 'pinching', pointers: [state.pointer, pointer] }, events: [] }
    case 'dragging':
      return {
        state: { kind: 'pinching', pointers: [state.pointer, pointer] },
        events: [dragEnd(state, state.pointer)],
      }
    // A third finger is ignored.
    case 'pinching':
      return { state, events: [] }
  }
}

function move(state: GestureState, pointer: GesturePointer, threshold: number = DRAG_THRESHOLD_PX): GestureResult {
  switch (state.kind) {
    case 'idle':
      return { state, events: [] }
    case 'pressed': {
      if (pointer.id !== state.pointer.id) return { state, events: [] }
      const total = minus(pointer, state.pointer)
      if (Math.hypot(total.x, total.y) < threshold) return { state, events: [] }
      const origin = point(state.pointer)
      return {
        state: { kind: 'dragging', pointer, origin, target: state.target },
        events: [
          { type: 'dragstart', target: state.target, point: origin },
          { type: 'drag', target: state.target, point: point(pointer), delta: total, total },
        ],
      }
    }
    case 'dragging': {
      if (pointer.id !== state.pointer.id) return { state, events: [] }
      return {
        state: { ...state, pointer },
        events: [
          {
            type: 'drag',
            target: state.target,
            point: point(pointer),
            delta: minus(pointer, state.pointer),
            total: minus(pointer, state.origin),
          },
        ],
      }
    }
    case 'pinching': {
      const [a, b] = state.pointers
      if (pointer.id !== a.id && pointer.id !== b.id) return { state, events: [] }
      const next: [GesturePointer, GesturePointer] = pointer.id === a.id ? [pointer, b] : [a, pointer]
      const before = Math.hypot(b.x - a.x, b.y - a.y)
      const after = Math.hypot(next[1].x - next[0].x, next[1].y - next[0].y)
      const center = midpoint(next[0], next[1])
      return {
        state: { kind: 'pinching', pointers: next },
        events: [
          {
            type: 'pinch',
            factor: before > 0 && after > 0 ? after / before : 1,
            center,
            delta: minus(center, midpoint(a, b)),
          },
        ],
      }
    }
  }
}

function up(state: GestureState, pointer: GesturePointer): GestureResult {
  switch (state.kind) {
    case 'idle':
      return { state, events: [] }
    case 'pressed':
      if (pointer.id !== state.pointer.id) return { state, events: [] }
      return { state: IDLE_GESTURE, events: [{ type: 'tap', target: state.target, point: point(pointer) }] }
    case 'dragging':
      if (pointer.id !== state.pointer.id) return { state, events: [] }
      return { state: IDLE_GESTURE, events: [dragEnd(state, pointer)] }
    case 'pinching': {
      const [a, b] = state.pointers
      if (pointer.id !== a.id && pointer.id !== b.id) return { state, events: [] }
      // The remaining finger pans from where it is — a new drag with no target and a fresh origin, so lifting
      // it later ends a drag, never a tap.
      const rest = pointer.id === a.id ? b : a
      return {
        state: { kind: 'dragging', pointer: rest, origin: point(rest), target: null },
        events: [{ type: 'dragstart', target: null, point: point(rest) }],
      }
    }
  }
}

// Pointer cancelled or capture lost — an ongoing drag still ends so the caller can commit or roll back.
function cancel(state: GestureState): GestureResult {
  if (state.kind === 'dragging') return { state: IDLE_GESTURE, events: [dragEnd(state, state.pointer)] }
  return { state: IDLE_GESTURE, events: [] }
}

function dragEnd(state: Extract<GestureState, { kind: 'dragging' }>, pointer: GesturePointer): GestureEvent {
  return { type: 'dragend', target: state.target, point: point(pointer), total: minus(pointer, state.origin) }
}

function point(p: ScreenPoint): ScreenPoint {
  return { x: p.x, y: p.y }
}

function minus(a: ScreenPoint, b: ScreenPoint): ScreenPoint {
  return { x: a.x - b.x, y: a.y - b.y }
}

function midpoint(a: ScreenPoint, b: ScreenPoint): ScreenPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}
