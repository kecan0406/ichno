'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import type { Writing } from '../_lib/scene'
import { everyFrame } from './frames'

// What is selected — or picked, in the preview — stands a little off the floor. It rises and sets down eased, at once
// under reduced motion, and not at all when more is chosen than anyone watches lift.

// How far off the floor, in plan units (centimetres).
export const LIFT = 8

// How long a rise or a setting down takes, in milliseconds.
const LIFT_MS = 160

// More than this chosen at once stays on the floor.
const MOST = 400

const NONE: ReadonlyMap<string, Move> = new Map()

const FLAT: ReadonlyMap<string, number> = new Map()

// One object on its way up (`to` 1) or down (`to` 0), from where it was when that began.
type Move = { from: number; to: number; start: number }

// How far up each of `ids` stands this frame — 0 on the floor, 1 fully lifted — with those still setting down.
export function useLifted(ids: ReadonlySet<string>): ReadonlyMap<string, number> {
  const [moves, setMoves] = useState(NONE)
  const [now, setNow] = useState(0)
  const few = ids.size <= MOST
  // The set by what is in it — a new set holding the same ids starts nothing.
  const key = few ? [...ids].sort().join('\u0000') : null

  useLayoutEffect(() => {
    const time = performance.now()
    const still = reducedMotion()
    const chosen = key === null || key === '' ? [] : key.split('\u0000')
    setNow(time)
    setMoves((current) => {
      const next = new Map<string, Move>()

      for (const id of chosen) {
        const move = current.get(id)

        if (move && move.to === 1) next.set(id, move)
        else next.set(id, { from: still ? 1 : move ? heightOf(move, time) : 0, to: 1, start: time })
      }

      for (const [id, move] of current) {
        if (next.has(id) || still) continue

        if (move.to === 1) next.set(id, { from: heightOf(move, time), to: 0, start: time })
        else if (time - move.start < LIFT_MS) next.set(id, move)
      }

      return next.size === 0 ? NONE : next
    })
  }, [key])

  useEffect(() => {
    if (moves.size === 0) return
    const latest = Math.max(...[...moves.values()].map((move) => move.start))

    return everyFrame((time) => {
      setNow(time)

      if (time - latest < LIFT_MS) return true

      // What has set down is done with.
      setMoves((current) => {
        const kept = new Map([...current].filter(([, move]) => move.to === 1))

        return kept.size === current.size ? current : kept.size === 0 ? NONE : kept
      })

      return false
    })
  }, [moves])

  if (moves.size === 0) return FLAT
  const heights = new Map<string, number>()

  for (const [id, move] of moves) {
    const height = heightOf(move, now)

    if (height > 0) heights.set(id, height)
  }

  return heights
}

// A writing on a piece that is lifted, raised with it.
export function raised(writing: Writing, lifted: ReadonlyMap<string, number>): Writing {
  const lift = writing.on === undefined ? undefined : lifted.get(writing.on)

  if (lift === undefined) return writing
  const up = lift * LIFT

  return { ...writing, y: writing.y + up, plan: { ...writing.plan, y: writing.plan.y + up } }
}

// Where a move has got to at `time` — fast at first, easing into its end.
function heightOf(move: Move, time: number): number {
  const t = Math.min(1, Math.max(0, (time - move.start) / LIFT_MS))

  return move.from + (move.to - move.from) * (1 - (1 - t) ** 3)
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
