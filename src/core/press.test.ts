import { describe, expect, it } from 'vitest'
import { IDLE_PRESS, press, type PressEnv, type PressKeys, type PressPointer } from './press'
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
