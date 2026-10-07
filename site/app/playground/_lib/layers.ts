import type { Group, PlanObject, SeatPlan } from 'ichno'
import type { EditorSelection } from 'ichno/editor'

// The plan as the layers panel lists it — the way the document holds it: groups and the objects outside them, top of
// the drawing first. A group stands where its highest member is drawn (the order `planEdits.reorder` steps through),
// with its members inside it, highest first.

export type Layer =
  { kind: 'group'; group: Group; members: PlanObject<string>[] } | { kind: 'object'; object: PlanObject<string> }

export function layersOf(plan: SeatPlan<string>): Layer[] {
  const groups = new Map(plan.groups.map((group) => [group.id, group]))
  const opened = new Map<string, Extract<Layer, { kind: 'group' }>>()
  const layers: Layer[] = []
  for (let i = plan.objects.length - 1; i >= 0; i--) {
    const object = plan.objects[i]!
    const group = object.group === undefined ? undefined : groups.get(object.group)
    // An object pointing at a group the plan does not list stands alone (the Checks panel reports it).
    if (group === undefined) {
      layers.push({ kind: 'object', object })
      continue
    }
    let layer = opened.get(group.id)
    if (layer === undefined) {
      layer = { kind: 'group', group, members: [] }
      opened.set(group.id, layer)
      layers.push(layer)
    }
    layer.members.push(object)
  }
  return layers
}

// One key per selectable item — objects and groups share one id namespace, sections have their own.
export function keyOf(item: EditorSelection<string>): string {
  return `${item.kind}:${item.id}`
}
