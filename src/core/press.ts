// What a press on the plan means — renderer and framework free, like `gesture`, which it drives. A view feeds it
// pointer events in its own pixels with what each landed on, and acts on what comes back: a tap, a target dragged, a
// marquee, a tool's stroke, a pan or a pinch. Points are handed back in plan units through the view's own `toPlan`, so
// an SVG viewBox and a 3D camera reading the floor under the pointer share one definition of every press.
//
// A drag follows the pointer in plan units: `restate` reports it again where the pointer last was when the view moved
// under it (a wheel, edge scrolling) or a key changed, so what is dragged stays under the pointer.

import {
  IDLE_GESTURE,
  TOUCH_DRAG_THRESHOLD_PX,
  gesture,
  type GestureEvent,
  type GesturePointer,
  type GestureState,
  type ScreenPoint,
} from './gesture'
import type { PlanDrag, PlanPoint, PlanRect, PlanStroke, PlanTarget } from './types'
import type { ViewportSize } from './view'

// The keys that shape a press: Shift constrains a drag or a stroke; Alt draws a stroke from its centre and drags a
// copy; ⌘ or Ctrl lets go of smart guides. Shift, ⌘ or Ctrl held as a press starts make it additive.
export type PressKeys = { constrain: boolean; fromCenter: boolean; free: boolean }

// A pointer as the browser reports it — `type`, `button` and `buttons` are PointerEvent's `pointerType`, `button` and
// `buttons`.
export type PressPointer = GesturePointer & { type: string; button: number; buttons: number }

// What a press does: drags its target, draws a marquee or a tool's stroke, or pans. `none` once it was dropped
// (`press.drop`) — the rest of it does nothing.
export type PressMode = 'drag' | 'marquee' | 'draw' | 'pan' | 'none'

export type PressState<S extends string = string> = {
  gesture: GestureState
  // What the press started on.
  target: PlanTarget<S> | null
  mode: PressMode
  additive: boolean
  // Where a drag, a marquee or a stroke started, in plan units and in the view's pixels, and where the pointer last
  // was.
  anchor: PlanPoint | null
  start: ScreenPoint | null
  at: ScreenPoint | null
  keys: PressKeys
  // Fingers on the view — a trackpad's pinch events for the same fingers are not to be zoomed again.
  touches: readonly number[]
}

// The view a press happens in, as it is when the event arrives.
export type PressEnv<S extends string = string> = {
  // The plan point under a point of the view (pixels from its top-left); null when there is none.
  toPlan(point: ScreenPoint): PlanPoint | null
  // Plan units a screen pixel spans.
  pixel: number
  // A creation tool is active — presses draw strokes instead of selecting, moving or panning.
  draws: boolean
  // Rubber-band selection: a drag that moves nothing draws a rectangle. On touch only one that starts on something
  // or with Shift, ⌘ or Ctrl held, so a finger on empty floor still pans.
  marquees: boolean
  // Drags that do nothing else pan the view.
  pans: boolean
  // Every press pans — Space is held, or a hand tool is picked.
  grabs: boolean
  // Whether a target moves when dragged.
  canDrag(target: PlanTarget<S>): boolean
}

export type PressEvent<S extends string = string> =
  // A press let go where it began — on a target, or on empty floor (null). Not reported while a tool draws: a tap is
  // then a stroke with no length.
  | { type: 'tap'; target: PlanTarget<S> | null; point: PlanPoint | null; at: ScreenPoint; additive: boolean }
  | { type: 'drag'; drag: PlanDrag<S> }
  // The rubber band, corner to corner in the view's pixels and as a rectangle of the plan (null when a corner is
  // not over it).
  | {
      type: 'marquee'
      phase: 'start' | 'move' | 'end'
      from: ScreenPoint
      to: ScreenPoint
      rect: PlanRect | null
      additive: boolean
    }
  // `cancel` ends a stroke that must make nothing — a second finger landed, or the pointer was lost.
  | { type: 'draw'; phase: 'start' | 'move' | 'end' | 'cancel'; stroke: PlanStroke; keys: PressKeys; pixel: number }
  // `delta` is how far the pointer moved since the last one, in the view's pixels.
  | { type: 'pan'; phase: 'start' | 'move' | 'end'; delta: ScreenPoint }
  | { type: 'pinch'; factor: number; center: ScreenPoint; delta: ScreenPoint }
  // A drag, a marquee or a stroke is under way (`held`), or over — while it is, a view may scroll at its edges.
  | { type: 'hold'; held: boolean }

export type PressResult<S extends string = string> = { state: PressState<S>; events: PressEvent<S>[] }

const NO_KEYS: PressKeys = { constrain: false, fromCenter: false, free: false }

export const IDLE_PRESS: PressState<never> = {
  gesture: IDLE_GESTURE,
  target: null,
  mode: 'pan',
  additive: false,
  anchor: null,
  start: null,
  at: null,
  keys: NO_KEYS,
  touches: [],
}

export const press = {
  down,
  move,
  up,
  cancel,
  keys,
  restate,
  drop,
  keysOf,
  holds,
}

// A pointer went down on `target`. The first one decides what the press does; a second turns it into a pinch — a
// stroke under way is dropped, and whichever finger stays afterwards pans.
function down<S extends string>(
  state: PressState<S>,
  pointer: PressPointer,
  target: PlanTarget<S> | null,
  held: PressKeys,
  env: PressEnv<S>,
): PressResult<S> {
  const middle = pointer.type === 'mouse' && pointer.button === 1

  // Any other mouse button is not a press — the right one opens a menu.
  if (pointer.type === 'mouse' && pointer.button !== 0 && !middle) return { state, events: [] }

  const touches =
    pointer.type === 'touch' ? [...state.touches.filter((id) => id !== pointer.id), pointer.id] : state.touches

  const events: PressEvent<S>[] = []
  let next: PressState<S> = { ...state, keys: held, touches }

  if (state.gesture.kind === 'idle') {
    const grabbed = middle || env.grabs
    const on = grabbed ? null : target
    const additive = held.constrain || held.free

    next = {
      ...next,
      target: on,
      mode: grabbed ? 'pan' : modeOf(on, pointer.type, additive, env),
      additive,
      anchor: null,
      start: null,
      at: null,
    }
  } else if (state.mode === 'draw') {
    const dropped = strokeDropped(next, env)
    next = dropped.state
    events.push(...dropped.events)
  }

  const result = gesture.down(next.gesture, pointer, next.target ? 'target' : null)
  const handled = handle({ ...next, gesture: result.state }, result.events, env)
  events.push(...handled.events)

  // Whatever the first finger landed on is let go, even when no drag had started yet.
  return { state: result.state.kind === 'pinching' ? released(handled.state) : handled.state, events }
}

// The pointer moved. Nothing while no press is under way — hovering is the view's own.
function move<S extends string>(
  state: PressState<S>,
  pointer: PressPointer,
  held: PressKeys,
  env: PressEnv<S>,
): PressResult<S> {
  if (state.gesture.kind === 'idle') return { state, events: [] }

  // A button let go where the release never arrived (a menu opened mid-drag took it) — the press ends where it last
  // was, instead of dragging on with nothing held.
  if (pointer.buttons === 0 && pointer.type !== 'touch' && holds(state, pointer.id)) return cancel(state, pointer, env)

  const threshold = pointer.type === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : undefined
  const result = gesture.move(state.gesture, pointer, threshold)

  return handle({ ...state, keys: held, gesture: result.state }, result.events, env)
}

function up<S extends string>(
  state: PressState<S>,
  pointer: GesturePointer,
  held: PressKeys,
  env: PressEnv<S>,
): PressResult<S> {
  const result = gesture.up(state.gesture, pointer)

  return handle({ ...lifted(state, pointer.id), keys: held, gesture: result.state }, result.events, env)
}

// The pointer was cancelled or its capture lost: a stroke makes nothing, a drag or a marquee ends where it was.
function cancel<S extends string>(
  state: PressState<S>,
  pointer: Pick<GesturePointer, 'id'>,
  env: PressEnv<S>,
): PressResult<S> {
  const dropped = strokeDropped(lifted(state, pointer.id), env)
  const result = gesture.cancel(dropped.state.gesture)
  const handled = handle({ ...dropped.state, gesture: result.state }, result.events, env)

  return { state: handled.state, events: [...dropped.events, ...handled.events] }
}

// Shift, Alt, ⌘ or Ctrl changed mid-press — the drag or the stroke is reported again, shaped by the keys held now.
function keys<S extends string>(state: PressState<S>, held: PressKeys, env: PressEnv<S>): PressResult<S> {
  const next = { ...state, keys: held }

  return { state: next, events: restate(next, env) }
}

// The drag, marquee or stroke under way, reported again where the pointer last was on the view as it is now.
function restate<S extends string>(state: PressState<S>, env: PressEnv<S>): PressEvent<S>[] {
  return state.gesture.kind === 'dragging' ? reported(state, 'move', env) : []
}

// Lets go of the press under way (Escape on a marquee) — until it is released it does nothing more.
function drop<S extends string>(state: PressState<S>): PressState<S> {
  return state.gesture.kind === 'idle' ? state : { ...state, mode: 'none' }
}

function keysOf(e: { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }): PressKeys {
  return { constrain: e.shiftKey, fromCenter: e.altKey, free: e.metaKey || e.ctrlKey }
}

// Whether a press still follows this pointer — when its capture is lost meanwhile, the release is not coming.
function holds(state: PressState<string>, pointerId: number): boolean {
  const current = state.gesture

  if (current.kind === 'pressed' || current.kind === 'dragging') return current.pointer.id === pointerId

  if (current.kind === 'pinching') return current.pointers.some((pointer) => pointer.id === pointerId)

  return false
}

// What a press that starts on `target` does.
function modeOf<S extends string>(
  target: PlanTarget<S> | null,
  pointerType: string,
  additive: boolean,
  env: PressEnv<S>,
): PressMode {
  if (env.draws) return 'draw'

  if (target !== null && env.canDrag(target)) return 'drag'

  return env.marquees && (additive || target !== null || pointerType !== 'touch') ? 'marquee' : 'pan'
}

function handle<S extends string>(
  from: PressState<S>,
  gestures: readonly GestureEvent[],
  env: PressEnv<S>,
): PressResult<S> {
  const events: PressEvent<S>[] = []
  let state = from

  for (const event of gestures) {
    switch (event.type) {
      case 'tap': {
        const point = env.toPlan(event.point)

        if (state.mode === 'draw') {
          if (point) events.push(drawn('end', { start: point, end: point }, state, env))
        } else if (state.mode !== 'none') {
          events.push({ type: 'tap', target: state.target, point, at: event.point, additive: state.additive })
        }

        state = released(state)
        break
      }

      case 'dragstart': {
        if (state.mode === 'pan') {
          if (env.pans) events.push({ type: 'pan', phase: 'start', delta: NO_MOVE })
          break
        }

        if (state.mode === 'none') break
        const anchor = env.toPlan(event.point)
        state = { ...state, anchor, start: event.point, at: event.point }

        if (state.mode === 'marquee') events.push(...reported(state, 'start', env))
        else if (anchor === null) break
        else if (state.mode === 'draw') events.push(drawn('start', { start: anchor, end: anchor }, state, env))
        else events.push(...reported(state, 'start', env))

        events.push({ type: 'hold', held: true })
        break
      }

      case 'drag':
        if (state.mode === 'pan') {
          if (env.pans) events.push({ type: 'pan', phase: 'move', delta: event.delta })
          break
        }

        state = { ...state, at: event.point }
        events.push(...reported(state, 'move', env))
        break
      case 'dragend':
        if (state.mode === 'pan') {
          // Reported whatever the view allows by now, so a pan it began is never left open.
          events.push({ type: 'pan', phase: 'end', delta: NO_MOVE })
        } else {
          state = { ...state, at: event.point }
          events.push(...reported(state, 'end', env), { type: 'hold', held: false })
        }

        // After a pinch the finger that stays pans — it never drags what the press began on.
        state = released(state)
        break
      case 'pinch':
        events.push({ type: 'pinch', factor: event.factor, center: event.center, delta: event.delta })
        break
    }
  }

  return { state, events }
}

// The drag, marquee or stroke under way as it stands, the pointer where it last was.
function reported<S extends string>(
  state: PressState<S>,
  phase: 'start' | 'move' | 'end',
  env: PressEnv<S>,
): PressEvent<S>[] {
  if (state.mode === 'pan' || state.mode === 'none' || state.start === null || state.at === null) return []
  const to = env.toPlan(state.at)

  if (state.mode === 'marquee') {
    const rect = state.anchor === null || to === null ? null : rectBetween(state.anchor, to)

    return [{ type: 'marquee', phase, from: state.start, to: state.at, rect, additive: state.additive }]
  }

  if (state.anchor === null || to === null) return []

  if (state.mode === 'draw') return [drawn(phase, { start: state.anchor, end: to }, state, env)]

  if (state.target === null) return []

  return [
    {
      type: 'drag',
      drag: {
        target: state.target,
        phase,
        total: { x: to.x - state.anchor.x, y: to.y - state.anchor.y },
        constrain: state.keys.constrain,
        copy: state.keys.fromCenter,
        free: state.keys.free,
        pixel: env.pixel,
      },
    },
  ]
}

function drawn<S extends string>(
  phase: 'start' | 'move' | 'end' | 'cancel',
  stroke: PlanStroke,
  state: PressState<S>,
  env: PressEnv<S>,
): PressEvent<S> {
  return { type: 'draw', phase, stroke, keys: state.keys, pixel: env.pixel }
}

// A stroke under way dropped — it must make nothing — and the press let go of. Anything else is left as it is.
function strokeDropped<S extends string>(state: PressState<S>, env: PressEnv<S>): PressResult<S> {
  if (state.mode !== 'draw') return { state, events: [] }
  const end = state.at === null ? null : env.toPlan(state.at)
  const events: PressEvent<S>[] = []

  if (state.anchor !== null && end !== null) {
    events.push(drawn('cancel', { start: state.anchor, end }, state, env), { type: 'hold', held: false })
  }

  return { state: released(state), events }
}

// The press over, or let go of: what follows on the same pointers pans.
function released<S extends string>(state: PressState<S>): PressState<S> {
  return { ...state, target: null, mode: 'pan', additive: false, anchor: null, start: null, at: null }
}

function lifted<S extends string>(state: PressState<S>, pointerId: number): PressState<S> {
  return state.touches.includes(pointerId)
    ? { ...state, touches: state.touches.filter((id) => id !== pointerId) }
    : state
}

function rectBetween(a: PlanPoint, b: PlanPoint): PlanRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

const NO_MOVE: ScreenPoint = { x: 0, y: 0 }

// Edge scrolling — while a drag, a marquee or a stroke is held near a view's edge the plan scrolls toward it (like
// tldraw's edge scrolling and React Flow's auto-pan): after a moment, so passing over the edge does nothing, faster
// the closer the pointer is and at full speed past it. Call `step` every frame of a hold with where the pointer is.

// `since` is when the pointer reached the edge, `last` the frame before this one.
export type EdgeScrollState = { since: number | null; last: number | null }

export const IDLE_EDGE_SCROLL: EdgeScrollState = { since: null, last: null }

// A frame's answer: how far to scroll, in the view's pixels toward each edge — null for not at all.
export type EdgeScrollStep = { state: EdgeScrollState; scroll: ScreenPoint | null }

export const edgeScroll = {
  step,
}

// One frame: how far to scroll, in the view's pixels toward each edge (null: not at all). Speed is per 60 Hz frame
// and scaled by the time since the last one, so fast displays scroll alike.
function step(state: EdgeScrollState, at: ScreenPoint | null, size: ViewportSize | null, now: number): EdgeScrollStep {
  const elapsed = state.last === null ? 0 : Math.min(now - state.last, EDGE_MAX_STEP_MS)
  const push = at && size ? edgePush(at, size) : null

  if (push === null) return { state: { since: null, last: now }, scroll: null }
  const since = state.since ?? now
  const held = now - since - EDGE_DELAY_MS

  if (held <= 0) return { state: { since, last: now }, scroll: null }
  const pixels = EDGE_SPEED_PX * Math.min(1, held / EDGE_EASE_MS) * (elapsed / FRAME_MS)

  return { state: { since, last: now }, scroll: { x: push.x * pixels, y: push.y * pixels } }
}

// How hard a pointer pushes toward each edge — 0 clear of the edge band, up to ±1 at the edge and beyond it. null
// when it pushes toward none.
function edgePush(at: ScreenPoint, size: ViewportSize): ScreenPoint | null {
  const x = pushAlong(at.x, size.width)
  const y = pushAlong(at.y, size.height)

  return x === 0 && y === 0 ? null : { x, y }
}

function pushAlong(at: number, length: number): number {
  if (at < EDGE_PX) return -Math.min(1, (EDGE_PX - at) / EDGE_PX)

  if (at > length - EDGE_PX) return Math.min(1, (at - (length - EDGE_PX)) / EDGE_PX)

  return 0
}

// The band along each edge (screen pixels) where a held pointer scrolls, how long it waits there before scrolling and
// how long it takes to reach full speed — at most EDGE_SPEED_PX per 60 Hz frame.
const EDGE_PX = 24

const EDGE_DELAY_MS = 200

const EDGE_EASE_MS = 300

const EDGE_SPEED_PX = 18

const FRAME_MS = 1000 / 60

// A frame late by more than this (a background tab) scrolls as if it were not — no leap on return.
const EDGE_MAX_STEP_MS = 50
