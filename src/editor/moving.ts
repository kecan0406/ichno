import { seatPlan } from '../core/geometry'
import { spatialIndex } from '../core/spatial'
import type { SeatPlan } from '../core/types'

// What a drag or a preview moves, apart from what it leaves alone — so the editor hands out a still part that keeps
// its identity for the whole drag, and checks overlaps for the moving part only. Internal to the editor hook.

// Joins ids into keys — a character no id holds.
export const KEY_SEPARATOR = '\u0000'

// The ids of the objects that differ between two plans — changed, added or gone — as one string, so what is built
// from it keeps its identity while the same objects move; '' when none do, null when sections changed as well.
export function changedKey(before: SeatPlan<string>, after: SeatPlan<string>): string | null {
  if (before === after) return ''
  if (before.sections !== after.sections) return null
  const gone = new Map(before.objects.map((o) => [o.id, o]))
  const ids: string[] = []
  for (const object of after.objects) {
    if (gone.get(object.id) !== object) ids.push(object.id)
    gone.delete(object.id)
  }
  return [...ids, ...gone.keys()].join(KEY_SEPARATOR)
}

export function withoutIds<S extends string>(plan: SeatPlan<S>, key: string): SeatPlan<S> {
  const ids = new Set(key.split(KEY_SEPARATOR))
  return { ...plan, objects: plan.objects.filter((o) => !ids.has(o.id)) }
}

export function onlyIds<S extends string>(plan: SeatPlan<S>, key: string): SeatPlan<S> {
  const ids = new Set(key.split(KEY_SEPARATOR))
  return { ...plan, sections: [], objects: plan.objects.filter((o) => ids.has(o.id)) }
}

// The places of a plan that overlap one another, and an index of all of them to check others against.
export function overlapsOf(plan: SeatPlan<string>) {
  const places = seatPlan.placesOf(plan)
  return {
    ids: seatPlan.conflictsOf(plan).flat(),
    byId: new Map(places.map((place) => [place.id, place])),
    index: spatialIndex.create(places.map((place) => ({ id: place.id, bounds: seatPlan.boundsOf(place) }))),
  }
}

// The moving places that overlap one another or a still one, and the still ones they overlap.
export function overlapsWith(moving: SeatPlan<string>, still: ReturnType<typeof overlapsOf>): string[] {
  const ids = seatPlan.conflictsOf(moving).flat()
  for (const place of seatPlan.placesOf(moving)) {
    for (const { id } of spatialIndex.query(still.index, seatPlan.boundsOf(place))) {
      const other = still.byId.get(id)
      if (other && seatPlan.overlaps(place, other)) ids.push(place.id, id)
    }
  }
  return ids
}

// Ids as one sorted string without repeats — equal lists make equal keys.
export function idsKey(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join(KEY_SEPARATOR)
}
