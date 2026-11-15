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

  it('maps plan points back to the viewport, the same way round', () => {
    const size = { width: 800, height: 800 }
    expect(planView.toScreen(view, size, { x: 100, y: 50 })).toEqual({ x: 0, y: 200 })
    expect(planView.toScreen(view, size, planView.toPlan(view, size, { x: 123, y: 456 }))).toEqual({ x: 123, y: 456 })
  })

  it('shows more than the view along its short side — the letterbox is plan too', () => {
    // 800×800 viewport, scale 2 → the view's 400×200 fills 800×400; 200px above and below show 100 plan units each.
    expect(planView.visible(view, { width: 800, height: 800 })).toEqual({ x: 100, y: -50, w: 400, h: 400 })
    expect(planView.visible(view, { width: 1600, height: 200 })).toEqual({ x: -500, y: 50, w: 1600, h: 200 })
    // A hidden viewport shows nothing more than the view.
    expect(planView.visible(view, { width: 0, height: 0 })).toEqual(view)
  })

  it('leaves a margin on every side of the whole drawing when asked for one', () => {
    const plan = { width: 1000, height: 500, sections: [] }
    const drawn = planView.home(plan)
    expect(planView.home(plan, 50)).toEqual({ x: drawn.x - 50, y: drawn.y - 50, w: drawn.w + 100, h: drawn.h + 100 })
  })

  it('leaves more room at single sides, on top of the margin — a side left out gets none', () => {
    const plan = { width: 1000, height: 500, sections: [] }
    const drawn = planView.home(plan)
    expect(planView.home(plan, 10, { left: 300, top: 40 })).toEqual({
      x: drawn.x - 310,
      y: drawn.y - 50,
      w: drawn.w + 320,
      h: drawn.h + 60,
    })
  })

  it('finds the room that keeps pixels clear at each side of the viewport', () => {
    const plan = { width: 1000, height: 500, sections: [] }
    const drawn = planView.home(plan)
    const size = { width: 1400, height: 900 }
    const clear = { top: 100, right: 60, bottom: 120, left: 320 }
    const home = planView.home(plan, 0, planView.roomFor(plan, size, clear))
    const from = planView.toScreen(home, size, { x: drawn.x, y: drawn.y })
    const to = planView.toScreen(home, size, { x: drawn.x + drawn.w, y: drawn.y + drawn.h })

    // The width is the tighter side here: the drawing runs from the left room to the right room exactly…
    expect(from.x).toBeCloseTo(clear.left)
    expect(to.x).toBeCloseTo(size.width - clear.right)
    // …and sits in the middle of what the top and bottom room leave.
    expect(from.y).toBeGreaterThan(clear.top)
    expect(to.y).toBeLessThan(size.height - clear.bottom)
    expect(from.y - clear.top).toBeCloseTo(size.height - clear.bottom - to.y)
  })

  it('asks for no room where nothing is left to draw in', () => {
    const plan = { width: 1000, height: 500, sections: [] }
    expect(planView.roomFor(plan, { width: 300, height: 600 }, { left: 200, right: 100 })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    })
  })

  it('zooms out no further than the whole drawing, so zooming in and out comes back to it exactly', () => {
    const home = { x: 0, y: 0, w: 1000, h: 500 }
    const center = { x: 500, y: 250 }
    expect(planView.zoom(home, 1 / 1.4, center, home).w).toBe(home.w)
    // In a step, out three (the last two held at the whole drawing), in again: the level it had before, not one
    // cut short at the limit (90% × 1.1 = 99%).
    const levels: number[] = []
    let view = home

    for (const factor of [1.1, 1 / 1.1, 1 / 1.1, 1 / 1.1, 1.1]) {
      view = planView.zoom(view, factor, center, home)
      levels.push(Math.round((home.w / view.w) * 100))
    }

    expect(levels).toEqual([110, 100, 100, 100, 110])
    // Framing places reaches no further out either.
    const everything = planView.fitTo([{ x: -50, y: -50, w: 1100, h: 600 }], 100, home)
    expect(everything).toEqual({ x: 0, y: 0, w: 1000, h: 500 })
  })

  it('keeps the plan point between pinching fingers under them as they move and spread', () => {
    const size = { width: 800, height: 400 }
    const before = { x: 200, y: 100 }
    const under = planView.toPlan(view, size, before)
    const step = { center: { x: 240, y: 120 }, delta: { x: 40, y: 20 }, factor: 2 }
    const after = planView.pinch(view, size, step, { x: 0, y: 0, w: 800, h: 400 })
    expect(planView.toPlan(after, size, step.center)).toEqual(under)
    expect(after.w).toBe(view.w / 2)
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
