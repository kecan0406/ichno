import { seatPlan, type PlanObject, type PlanRect, type PlanTemplate, type SeatPlan } from 'ichno'
import { createSeatPlanSchema } from 'ichno/schema'
import { z } from 'zod'

// Objects people saved themselves — a selection kept as an ichno `PlanTemplate`, with a name, in this browser. An
// app would keep them in its database; like documents, they are checked with the schema when they are read back.

export type SavedObject = { id: string; name: string; template: PlanTemplate }

const STORAGE_KEY = 'ichno-playground-objects'

// Templates carry no sections, so any section id builds the schema.
const { Template } = createSeatPlanSchema({ sectionIds: ['_'] })

// What this browser kept: a list, read entry by entry — an entry that does not read is left out.
const Library = z
  .array(z.object({ id: z.string(), name: z.string(), template: Template }).nullable().catch(null))
  .catch([])

// The saved objects — none until something is saved. Anything unreadable is left out.
export function loadLibrary(): SavedObject[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (raw === null) return []

    return Library.parse(JSON.parse(raw)).filter((entry) => entry !== null)
  } catch {
    return []
  }
}

export function saveLibrary(objects: readonly SavedObject[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(objects))
  } catch {
    // Storage full or blocked — the objects stay until the page is reloaded.
  }
}

export function newObjectId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

// A template as a plan of its own, and the view that frames it — for thumbnails.
type Preview = { plan: SeatPlan<string>; view: PlanRect }

export function previewOf(template: PlanTemplate): Preview {
  const objects = template.objects.map((o): PlanObject<string> => (o.kind === 'place' ? { ...o, section: '' } : o))
  const extent = seatPlan.extentOf(objects) ?? { x: -1, y: -1, w: 2, h: 2 }
  const pad = Math.max(extent.w, extent.h) * 0.08
  const view = { x: extent.x - pad, y: extent.y - pad, w: extent.w + pad * 2, h: extent.h + pad * 2 }

  return {
    plan: {
      version: 3,
      width: 1,
      height: 1,
      sections: [],
      walls: [],
      categories: [],
      groups: template.groups,
      objects,
    },
    view,
  }
}
