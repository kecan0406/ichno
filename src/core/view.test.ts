import { describe, expect, it } from 'vitest'
import { planView } from './view'

describe('planView — screen and plan coordinates without reading layout', () => {
  const view = { x: 100, y: 50, w: 400, h: 200 }

  it('fits the view by its tighter side', () => {
    expect(planView.scaleOf(view, { width: 800, height: 800 })).toBe(2)
    expect(planView.scaleOf(view, { width: 1600, height: 200 })).toBe(1)
  })

  it('maps viewport points through the centred letterbox', () => {
    // 800×800 viewport, scale 2 → the drawing is 800×400, centred with 200px above.
    expect(planView.toPlan(view, { width: 800, height: 800 }, { x: 0, y: 200 })).toEqual({ x: 100, y: 50 })
    expect(planView.toPlan(view, { width: 800, height: 800 }, { x: 400, y: 400 })).toEqual({ x: 300, y: 150 })
  })

  it('grows a region around the view and tells when a view leaves it', () => {
    const area = planView.region(view, 0.5)
    expect(area).toEqual({ x: -100, y: -50, w: 800, h: 400 })
    expect(planView.contains(area, { ...view, x: 250 })).toBe(true)
    expect(planView.contains(area, { ...view, x: 350 })).toBe(false)
  })

  it('rounds scales to quarter octaves', () => {
    expect(planView.scaleStep(1)).toBe(1)
    expect(planView.scaleStep(1.1)).toBe(2 ** 0.25)
    expect(planView.scaleStep(0.5)).toBe(0.5)
  })
})
