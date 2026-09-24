import { describe, expect, it } from 'vitest'
import { IDLE_GESTURE, gesture, type GestureEvent, type GestureState } from './gesture'
import { placeNavigation } from './navigation'
import { spatialIndex } from './spatial'

describe('spatialIndex', () => {
  const index = spatialIndex.create(
    [
      { id: 'a', bounds: { x: 0, y: 0, w: 88, h: 88 } },
      { id: 'b', bounds: { x: 92, y: 0, w: 88, h: 88 } },
      // Spans several buckets, and overlaps `a` — inserted later, so it is on top.
      { id: 'big', bounds: { x: 40, y: 40, w: 500, h: 500 } },
    ],
    100,
  )

  it('returns each intersecting item once, in insertion order', () => {
    expect(spatialIndex.query(index, { x: 0, y: 0, w: 200, h: 200 }).map((i) => i.id)).toEqual(['a', 'b', 'big'])
  })

  it('counts touching edges as intersecting', () => {
    expect(spatialIndex.query(index, { x: 180, y: 0, w: 5, h: 5 }).map((i) => i.id)).toEqual(['b'])
  })

  it('picks the topmost item at a point', () => {
    expect(spatialIndex.at(index, { x: 50, y: 50 })?.id).toBe('big')
    expect(spatialIndex.at(index, { x: 10, y: 10 })?.id).toBe('a')
    expect(spatialIndex.at(index, { x: 1000, y: 1000 })).toBeNull()
  })

  it('falls through to the item below when the precise test rejects the top one', () => {
    const hit = spatialIndex.at(index, { x: 50, y: 50 }, (item) => item.id !== 'big')
    expect(hit?.id).toBe('a')
  })

  it('finds items in negative coordinates', () => {
    const negative = spatialIndex.create([{ id: 'n', bounds: { x: -300, y: -300, w: 50, h: 50 } }], 100)
    expect(spatialIndex.at(negative, { x: -280, y: -280 })?.id).toBe('n')
  })
})

describe('gesture', () => {
  function run(steps: ((s: GestureState) => ReturnType<typeof gesture.down>)[]) {
    let state: GestureState = IDLE_GESTURE
    const events: GestureEvent[] = []
    for (const step of steps) {
      const result = step(state)
      state = result.state
      events.push(...result.events)
    }
    return { state, events }
  }
  const p = (id: number, x: number, y: number) => ({ id, x, y })

  it('treats a release inside the threshold as a tap', () => {
    const { state, events } = run([
      (s) => gesture.down(s, p(1, 10, 10), 'A1'),
      (s) => gesture.move(s, p(1, 12, 11)),
      (s) => gesture.up(s, p(1, 12, 11)),
    ])
    expect(events).toEqual([{ type: 'tap', target: 'A1', point: { x: 12, y: 11 } }])
    expect(state).toEqual(IDLE_GESTURE)
  })

  it('starts a drag past the threshold and reports deltas and totals', () => {
    const { events } = run([
      (s) => gesture.down(s, p(1, 0, 0), null),
      (s) => gesture.move(s, p(1, 10, 0)),
      (s) => gesture.move(s, p(1, 15, 5)),
      (s) => gesture.up(s, p(1, 15, 5)),
    ])
    expect(events.map((e) => e.type)).toEqual(['dragstart', 'drag', 'drag', 'dragend'])
    expect(events[1]).toMatchObject({ delta: { x: 10, y: 0 }, total: { x: 10, y: 0 } })
    expect(events[2]).toMatchObject({ delta: { x: 5, y: 5 }, total: { x: 15, y: 5 } })
    expect(events[3]).toMatchObject({ target: null, total: { x: 15, y: 5 } })
  })

  it('honours a larger threshold for touch', () => {
    const { events } = run([(s) => gesture.down(s, p(1, 0, 0), null), (s) => gesture.move(s, p(1, 6, 0), 8)])
    expect(events).toEqual([])
  })

  it('turns a second pointer into a pinch and ends the running drag first', () => {
    const { state, events } = run([
      (s) => gesture.down(s, p(1, 0, 0), null),
      (s) => gesture.move(s, p(1, 10, 0)),
      (s) => gesture.down(s, p(2, 110, 0), null),
      (s) => gesture.move(s, p(2, 210, 0)),
    ])
    expect(events.map((e) => e.type)).toEqual(['dragstart', 'drag', 'dragend', 'pinch'])
    expect(events[3]).toMatchObject({ factor: 2, center: { x: 110, y: 0 }, delta: { x: 50, y: 0 } })
    expect(state.kind).toBe('pinching')
  })

  it('resumes a pan from the remaining pointer without a jump, and never taps after a pinch', () => {
    const { events } = run([
      (s) => gesture.down(s, p(1, 0, 0), null),
      (s) => gesture.down(s, p(2, 100, 0), null),
      (s) => gesture.up(s, p(1, 0, 0)),
      (s) => gesture.move(s, p(2, 130, 0)),
      (s) => gesture.up(s, p(2, 130, 0)),
    ])
    expect(events.map((e) => e.type)).toEqual(['dragstart', 'drag', 'dragend'])
    expect(events[0]).toMatchObject({ point: { x: 100, y: 0 } })
    expect(events[1]).toMatchObject({ delta: { x: 30, y: 0 } })
  })

  it('ignores a third pointer during a pinch', () => {
    const { state, events } = run([
      (s) => gesture.down(s, p(1, 0, 0), null),
      (s) => gesture.down(s, p(2, 100, 0), null),
      (s) => gesture.down(s, p(3, 50, 50), null),
      (s) => gesture.up(s, p(3, 50, 50)),
    ])
    expect(events).toEqual([])
    expect(state.kind).toBe('pinching')
  })

  it('ends a drag on cancel', () => {
    const { state, events } = run([
      (s) => gesture.down(s, p(1, 0, 0), 'A1'),
      (s) => gesture.move(s, p(1, 20, 0)),
      (s) => gesture.cancel(s),
    ])
    expect(events.at(-1)).toMatchObject({ type: 'dragend', target: 'A1', total: { x: 20, y: 0 } })
    expect(state).toEqual(IDLE_GESTURE)
  })
})

describe('placeNavigation', () => {
  // A 3×2 block of desks plus one off to the lower right.
  const items = [
    { id: 'A1', center: { x: 0, y: 0 } },
    { id: 'A2', center: { x: 100, y: 0 } },
    { id: 'A3', center: { x: 200, y: 0 } },
    { id: 'B1', center: { x: 0, y: 100 } },
    { id: 'B2', center: { x: 100, y: 100 } },
    { id: 'C1', center: { x: 150, y: 60 } },
  ]

  it('starts at the top-left place', () => {
    expect(placeNavigation.first(items)).toBe('A1')
    expect(placeNavigation.first([])).toBeNull()
  })

  it('prefers the place straight ahead over a closer diagonal one', () => {
    expect(placeNavigation.next(items, 'A2', 'right')).toBe('A3')
  })

  it('moves between rows', () => {
    expect(placeNavigation.next(items, 'A1', 'down')).toBe('B1')
    expect(placeNavigation.next(items, 'B2', 'up')).toBe('A2')
  })

  it('stays put at the edge', () => {
    expect(placeNavigation.next(items, 'A1', 'left')).toBeNull()
    expect(placeNavigation.next(items, 'A1', 'up')).toBeNull()
  })

  it('ignores places more than 45° off the direction', () => {
    const steep = [
      { id: 'O', center: { x: 0, y: 0 } },
      { id: 'D', center: { x: 50, y: 100 } },
    ]
    expect(placeNavigation.next(steep, 'O', 'right')).toBeNull()
    expect(placeNavigation.next(steep, 'O', 'down')).toBe('D')
  })

  it('restarts from the first place when the focused one is gone', () => {
    expect(placeNavigation.next(items, 'gone', 'right')).toBe('A1')
  })
})
