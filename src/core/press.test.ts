import { describe, expect, it } from 'vitest'
import { IDLE_PRESS, press, type PressEnv, type PressEvent, type PressKeys, type PressPointer } from './press'
import type { PlanTarget } from './types'

const NO_KEYS: PressKeys = { constrain: false, fromCenter: false, free: false }

const SEAT: PlanTarget = { kind: 'place', id: 'A1' }

const STAGE: PlanTarget = { kind: 'object', id: 'stage' }

// A view where a pixel is a plan unit, with an editor's rules by default: places drag, the stage is frozen.
function envOf(overrides: Partial<PressEnv> = {}): PressEnv {
  return {
    toPlan: (point) => point,
    pixel: 1,
    draws: false,
    marquees: true,
    pans: true,
    grabs: false,
    canDrag: (target) => target.kind === 'place',
    ...overrides,
  }
}

function pointerOf(overrides: Partial<PressPointer> = {}): PressPointer {
  return { id: 1, x: 10, y: 10, type: 'mouse', button: 0, buttons: 1, ...overrides }
}

// What a press starting like this does.
function modeOf(
  target: PlanTarget | null,
  options: { pointer?: Partial<PressPointer>; keys?: Partial<PressKeys>; env?: Partial<PressEnv> } = {},
) {
  const held = { ...NO_KEYS, ...options.keys }

  return press.down(IDLE_PRESS, pointerOf(options.pointer), target, held, envOf(options.env)).state
}

describe('press — what a press does', () => {
  it('drags what can be dragged', () => {
    expect(modeOf(SEAT).mode).toBe('drag')
  })

  it('draws a marquee from what does not drag, and from empty floor with a mouse', () => {
    expect(modeOf(STAGE).mode).toBe('marquee')
    expect(modeOf(null).mode).toBe('marquee')
  })

  it('pans from empty floor with a finger, unless Shift, ⌘ or Ctrl is held', () => {
    expect(modeOf(null, { pointer: { type: 'touch' } }).mode).toBe('pan')
    expect(modeOf(null, { pointer: { type: 'touch' }, keys: { constrain: true } }).mode).toBe('marquee')
    expect(modeOf(null, { pointer: { type: 'touch' }, keys: { free: true } }).mode).toBe('marquee')
    // A finger on something that does not drag still selects round it.
    expect(modeOf(STAGE, { pointer: { type: 'touch' } }).mode).toBe('marquee')
  })

  it('pans when there is no marquee to draw', () => {
    expect(modeOf(null, { env: { marquees: false } }).mode).toBe('pan')
    expect(modeOf(STAGE, { env: { marquees: false } }).mode).toBe('pan')
  })

  it('draws with a tool whatever it starts on', () => {
    expect(modeOf(SEAT, { env: { draws: true } }).mode).toBe('draw')
    expect(modeOf(null, { env: { draws: true } }).mode).toBe('draw')
  })

  it('pans with the middle button or while the view grabs, letting go of what is under the pointer', () => {
    const middle = modeOf(SEAT, { pointer: { button: 1 }, env: { draws: true } })
    expect(middle.mode).toBe('pan')
    expect(middle.target).toBeNull()

    const grabbed = modeOf(SEAT, { env: { grabs: true } })
    expect(grabbed.mode).toBe('pan')
    expect(grabbed.target).toBeNull()
  })

  it('leaves the other mouse buttons alone', () => {
    expect(modeOf(SEAT, { pointer: { button: 2 } })).toBe(IDLE_PRESS)
  })

  it('makes a press additive with Shift, ⌘ or Ctrl — not with Alt', () => {
    expect(modeOf(SEAT, { keys: { constrain: true } }).additive).toBe(true)
    expect(modeOf(SEAT, { keys: { free: true } }).additive).toBe(true)
    expect(modeOf(SEAT, { keys: { fromCenter: true } }).additive).toBe(false)
  })
})

describe('press — a press under way', () => {
  // Each event as `type:phase` — a drag's phase is on the drag it carries.
  const kinds = (events: readonly PressEvent[]) =>
    events.map((event) => {
      if (event.type === 'drag') return `drag:${event.drag.phase}`

      return 'phase' in event ? `${event.type}:${event.phase}` : event.type
    })

  it('drops a stroke when a second finger lands, and pinches from there', () => {
    const env = envOf({ draws: true })
    const finger = { type: 'touch' }
    const pressed = press.down(IDLE_PRESS, pointerOf(finger), null, NO_KEYS, env).state
    const drawing = press.move(pressed, pointerOf({ ...finger, x: 60, y: 10 }), NO_KEYS, env)
    expect(kinds(drawing.events)).toEqual(['draw:start', 'hold', 'draw:move'])

    const second = press.down(drawing.state, pointerOf({ ...finger, id: 2, x: 90, y: 90 }), null, NO_KEYS, env)
    // The stroke makes nothing: cancelled, never ended.
    expect(kinds(second.events)).toContain('draw:cancel')
    expect(kinds(second.events)).not.toContain('draw:end')
    expect(second.state.gesture.kind).toBe('pinching')
    expect(second.state.touches).toEqual([1, 2])

    const pinched = press.move(second.state, pointerOf({ ...finger, id: 2, x: 120, y: 120 }), NO_KEYS, env)
    expect(kinds(pinched.events)).toEqual(['pinch'])
  })

  it('reports a drag again where the pointer is when the view moves under it', () => {
    const dragging = press.move(
      press.down(IDLE_PRESS, pointerOf(), SEAT, NO_KEYS, envOf()).state,
      pointerOf({ x: 30, y: 10 }),
      NO_KEYS,
      envOf(),
    )

    expect(dragging.events.at(-1)).toMatchObject({ type: 'drag', drag: { phase: 'move', total: { x: 20, y: 0 } } })

    // The view scrolled a hundred units: the same pixel is over another plan point, and the drag follows it.
    const scrolled = envOf({ toPlan: (point) => ({ x: point.x + 100, y: point.y }) })
    expect(press.restate(dragging.state, scrolled)).toMatchObject([
      { type: 'drag', drag: { target: SEAT, phase: 'move', total: { x: 120, y: 0 } } },
    ])
    // A changed key says the same, shaped by the key.
    const constrained = press.keys(dragging.state, { ...NO_KEYS, constrain: true }, envOf())
    expect(constrained.events).toMatchObject([{ type: 'drag', drag: { phase: 'move', constrain: true } }])
  })

  it('ends a mouse drag whose release never arrived, the next time the mouse moves with no button held', () => {
    const dragging = press.move(
      press.down(IDLE_PRESS, pointerOf(), SEAT, NO_KEYS, envOf()).state,
      pointerOf({ x: 30, y: 10 }),
      NO_KEYS,
      envOf(),
    )

    const lost = press.move(dragging.state, pointerOf({ x: 50, y: 10, buttons: 0 }), NO_KEYS, envOf())
    expect(kinds(lost.events)).toEqual(['drag:end', 'hold'])
    expect(lost.state.gesture.kind).toBe('idle')

    // A finger has no buttons to read — its move is a move.
    const finger = press.move(
      press.down(IDLE_PRESS, pointerOf({ type: 'touch' }), SEAT, NO_KEYS, envOf()).state,
      pointerOf({ type: 'touch', x: 30, y: 10, buttons: 0 }),
      NO_KEYS,
      envOf(),
    )

    expect(finger.state.gesture.kind).toBe('dragging')
  })
})
