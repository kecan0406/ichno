import { describe, expect, it } from 'vitest'
import { strokeOf } from './tools'

describe('strokeOf — what a creation tool gets from a press', () => {
  const snap = { cell: 46 }

  it('snaps both ends — to half cells when snapping, whole units otherwise', () => {
    expect(strokeOf('box', { x: 10, y: 12 }, { x: 100.4, y: 57 }, {}, snap)).toEqual({
      start: { x: 0, y: 23 },
      end: { x: 92, y: 46 },
    })
    expect(strokeOf('box', { x: 10.4, y: 12.6 }, { x: 100.4, y: 57 }, {}, null)).toEqual({
      start: { x: 10, y: 13 },
      end: { x: 100, y: 57 },
    })
  })

  it('keeps a constrained box square the way it was dragged, and draws from the centre with Alt', () => {
    expect(strokeOf('box', { x: 100, y: 100 }, { x: 40, y: 130 }, { constrain: true }, null)).toEqual({
      start: { x: 100, y: 100 },
      end: { x: 40, y: 160 },
    })
    expect(strokeOf('box', { x: 100, y: 100 }, { x: 130, y: 120 }, { fromCenter: true }, null)).toEqual({
      start: { x: 70, y: 80 },
      end: { x: 130, y: 120 },
    })
  })

  it('keeps a constrained line to 15° steps, as long as it was drawn', () => {
    expect(strokeOf('line', { x: 0, y: 0 }, { x: 100, y: 12 }, { constrain: true }, null).end).toEqual({ x: 101, y: 0 })
    expect(strokeOf('line', { x: 0, y: 0 }, { x: 70, y: 72 }, { constrain: true }, null).end).toEqual({ x: 71, y: 71 })
  })

  it('gives a point tool the pointer alone, whatever the keys', () => {
    expect(strokeOf('point', { x: 0, y: 0 }, { x: 50, y: 60 }, { constrain: true, fromCenter: true }, snap)).toEqual({
      start: { x: 46, y: 69 },
      end: { x: 46, y: 69 },
    })
  })
})
