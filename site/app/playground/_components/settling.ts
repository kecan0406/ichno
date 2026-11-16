'use client'

import type { PlanObject, SeatPlan } from 'ichno'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { everyFrame } from './frames'

// What stands on the plan settles when an edit lands: what the edit added pops in, what it removed shrinks away and
// what it moved glides to where it goes. A drag or a preview is drawn as given — the hand moves it — and so is an edit
// that touches more than a screenful, or any edit under reduced motion. Done on the plan itself, so whatever is drawn
// from it — the objects, their names, a group's labels — moves together.

// How long each takes, in milliseconds — leaving quicker than arriving.
const ENTER_MS = 240

const LEAVE_MS = 150

const GLIDE_MS = 240

// The size a new object starts at, before it pops to its own.
const ENTER_FROM = 0.9

// Back-ease constants: how far a pop and a glide run past their end before settling — 3% and 2% of the way.
const POP = 0.9

const SETTLE = 0.73

// An edit that changes more objects than this is drawn at once.
const MOST = 400

const NO_GROW: ReadonlyMap<string, number> = new Map()

const NO_IDS: ReadonlySet<string> = new Set()

type Pose = { x: number; y: number; rotation: number }

type Point = { x: number; y: number }

// A group turned as one: by how much, and where its middle was and is — its members swing round that, not straight
// across, so a row keeps its length while it turns.
type Turn = { degrees: number; before: Point; after: Point }

// An edit settling: when it landed, where what it moved came from, the groups it turned, what it added and what it
// removed.
type Run<S extends string> = {
  start: number
  from: ReadonlyMap<string, Pose>
  turns: ReadonlyMap<string, Turn>
  entering: ReadonlySet<string>
  leaving: readonly PlanObject<S>[]
}

export type Settled<S extends string> = {
  // The plan to draw this frame: its objects part-way to where the edit put them, and after them the ones it removed,
  // on their way out.
  plan: SeatPlan<S>
  // How large to draw what is arriving or leaving, by id — everything else is its own size.
  grow: ReadonlyMap<string, number>
  // The objects on their way out — drawn, but no longer there to pick.
  leaving: ReadonlySet<string>
  // An edit is still settling.
  settling: boolean
  // Something is on its way to where the edit put it: what the editor draws round the selection would run ahead of it.
  gliding: boolean
}

// The plan as drawn this frame. `committed` is the plan as history holds it: when it changes, an edit landed, and what
// differs from the frame before settles; while it stays, the plan is drawn as given.
export function useSettledPlan<S extends string>(plan: SeatPlan<S>, committed: SeatPlan<S>): Settled<S> {
  const [run, setRun] = useState<Run<S> | null>(null)
  const [now, setNow] = useState(0)
  // The edit last seen, and what stood where in the frame before — where a glide starts from.
  const seen = useRef(committed)
  const stood = useRef<readonly PlanObject<S>[]>(plan.objects)
  const frame = run === null ? null : frameOf(plan, run, now)
  const staying = frame?.staying ?? plan.objects

  useLayoutEffect(() => {
    if (seen.current !== committed) {
      seen.current = committed
      const next = reducedMotion() ? null : runOf(stood.current, plan, performance.now())
      setRun(next)

      if (next) setNow(next.start)
    }

    stood.current = staying
  })

  useEffect(() => {
    if (run === null) return

    return everyFrame((time) => {
      if (time - run.start >= Math.max(ENTER_MS, LEAVE_MS, GLIDE_MS)) {
        setRun(null)

        return false
      }

      setNow(time)

      return true
    })
  }, [run])

  if (frame === null || run === null) return { plan, grow: NO_GROW, leaving: NO_IDS, settling: false, gliding: false }

  return {
    plan: { ...plan, objects: [...frame.staying, ...frame.leaving] },
    grow: frame.grow,
    leaving: new Set(frame.leaving.map((object) => object.id)),
    settling: true,
    gliding: run.from.size > 0,
  }
}

// What an edit changed between two frames — null when nothing did, or too much to animate. A label goes with its
// group at once; a removed object whose group went too is drawn on its own.
function runOf<S extends string>(before: readonly PlanObject<S>[], after: SeatPlan<S>, start: number): Run<S> | null {
  const was = new Map(before.map((object) => [object.id, object]))
  const ids = new Set(after.objects.map((object) => object.id))
  const groups = new Set(after.groups.map((group) => group.id))
  const from = new Map<string, Pose>()
  const entering = new Set<string>()

  for (const object of after.objects) {
    const old = was.get(object.id)

    if (!old) entering.add(object.id)
    else if (old.x !== object.x || old.y !== object.y || (old.rotation ?? 0) !== (object.rotation ?? 0))
      from.set(object.id, { x: old.x, y: old.y, rotation: old.rotation ?? 0 })
  }

  const leaving = before.flatMap((object): PlanObject<S>[] => {
    if (ids.has(object.id) || object.kind === 'label') return []

    if (object.group === undefined || groups.has(object.group)) return [object]
    const { group: _, ...alone } = object

    return [alone]
  })

  const changed = from.size + entering.size + leaving.length

  return changed === 0 || changed > MOST ? null : { start, from, turns: turnsOf(was, after, from), entering, leaving }
}

// The groups among what moved whose members all turned by the same amount.
function turnsOf<S extends string>(
  was: ReadonlyMap<string, PlanObject<S>>,
  after: SeatPlan<S>,
  from: ReadonlyMap<string, Pose>,
): Map<string, Turn> {
  type Sum = { degrees: number | null; even: boolean; before: Point; after: Point; count: number }

  const sums = new Map<string, Sum>()

  for (const object of after.objects) {
    const old = was.get(object.id)
    const pose = from.get(object.id)

    if (!old || !pose || object.group === undefined) continue

    const sum = sums.get(object.group) ?? {
      degrees: null,
      even: true,
      before: { x: 0, y: 0 },
      after: { x: 0, y: 0 },
      count: 0,
    }

    const turned = shortest((object.rotation ?? 0) - pose.rotation)

    // A label keeps level while its group turns — it has no turn of its own to compare.
    if (object.kind !== 'label') {
      if (sum.degrees === null) sum.degrees = turned
      else if (Math.abs(sum.degrees - turned) > 0.01) sum.even = false
    }

    sum.before.x += old.x + old.w / 2
    sum.before.y += old.y + old.h / 2
    sum.after.x += object.x + object.w / 2
    sum.after.y += object.y + object.h / 2
    sum.count += 1
    sums.set(object.group, sum)
  }

  const turns = new Map<string, Turn>()

  for (const [group, sum] of sums) {
    if (!sum.even || sum.degrees === null || sum.degrees === 0 || sum.count < 2) continue
    turns.set(group, {
      degrees: sum.degrees,
      before: { x: sum.before.x / sum.count, y: sum.before.y / sum.count },
      after: { x: sum.after.x / sum.count, y: sum.after.y / sum.count },
    })
  }

  return turns
}

// The objects part-way through a run: those that stay, at their place for `now`, those leaving, and how large the
// arriving and the leaving are drawn.
function frameOf<S extends string>(plan: SeatPlan<S>, run: Run<S>, now: number) {
  const elapsed = now - run.start
  const pop = ENTER_FROM + (1 - ENTER_FROM) * backOut(share(elapsed, ENTER_MS), POP)
  const glide = backOut(share(elapsed, GLIDE_MS), SETTLE)
  const away = 1 - share(elapsed, LEAVE_MS) ** 3
  const grow = new Map<string, number>()

  const staying = plan.objects.map((object): PlanObject<S> => {
    if (run.entering.has(object.id)) grow.set(object.id, pop)
    const from = run.from.get(object.id)

    if (!from) return object
    const rotation = from.rotation + shortest((object.rotation ?? 0) - from.rotation) * glide
    const turn = object.group === undefined ? undefined : run.turns.get(object.group)

    if (!turn) {
      return { ...object, x: from.x + (object.x - from.x) * glide, y: from.y + (object.y - from.y) * glide, rotation }
    }

    // Round the group's middle, which itself goes straight to where it ends up.
    const angle = (turn.degrees * glide * Math.PI) / 180
    const dx = from.x + object.w / 2 - turn.before.x
    const dy = from.y + object.h / 2 - turn.before.y

    return {
      ...object,
      x:
        turn.before.x +
        (turn.after.x - turn.before.x) * glide +
        dx * Math.cos(angle) -
        dy * Math.sin(angle) -
        object.w / 2,
      y:
        turn.before.y +
        (turn.after.y - turn.before.y) * glide +
        dx * Math.sin(angle) +
        dy * Math.cos(angle) -
        object.h / 2,
      rotation,
    }
  })

  const leaving = away <= 0 ? [] : run.leaving

  for (const object of leaving) grow.set(object.id, away)

  return { staying, leaving, grow }
}

// How much of `duration` has passed, 0 to 1.
function share(elapsed: number, duration: number): number {
  return Math.min(1, Math.max(0, elapsed / duration))
}

// Fast out, a little past the end, and back — the further past the larger `back` is.
function backOut(t: number, back: number): number {
  return 1 + (back + 1) * (t - 1) ** 3 + back * (t - 1) ** 2
}

// A turn the short way round, in degrees.
function shortest(turn: number): number {
  return ((((turn + 180) % 360) + 360) % 360) - 180
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
