import { OBJECT_ID_MAX, PLACE_ID_MAX, seatPlan } from '../core/geometry'
import { GRID_CELL } from '../core/grid'
import type { LabelSequence } from '../core/labeling'
import { boundsOfBox, centerOfBox, normalizeRotation, polygonContains, unionBounds } from '../core/math'
import type {
  Fixture,
  Group,
  GroupLabel,
  Place,
  PlanBox,
  PlanDrag,
  PlanObject,
  PlanPoint,
  PlanRect,
  PlanTemplate,
  SeatPlan,
  Section,
  Shape,
  TemplateObject,
} from '../core/types'
import { alongAxis, planHandles } from './handles'
import { pivotOf, turnObjects, withGroupRotation } from './turn'

// Editor operations as pure functions — plan in, plan out. The hook keeps history and selection around them;
// keeping them pure makes each rule testable and lets consumers run them outside React (imports, scripts).
// Ids other records reference (`locked`) are never deleted or renamed, and no operation creates an id the schema
// would refuse (place ids stay within PLACE_ID_MAX); operations that would do either refuse and return null.
//
// Objects and groups share one id namespace, so operations that act on "ids" take either: a group id stands for
// all of its members, which then move, turn, copy and go as one.

// Editor snapping — sections snap to cell corners, objects to half cells. Without it, to whole plan units.
export type Snap = { cell: number }

export type AlignEdge = 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y'
// Where `reorder` moves objects in the drawing order.
export type Reorder = 'front' | 'back' | 'forward' | 'backward'
export type Added<S extends string> = { plan: SeatPlan<S>; ids: string[] }
// Which members of a group `layoutGroup` lays out — its places, or its fixtures of one role (a table's chairs).
export type GroupMembers = { kind: 'place' } | { kind: 'fixture'; role?: string }
// What `assign` sets — each on the objects that have it: `shape` and `role` on places and fixtures, `capacity`,
// `category` and `tags` on places. A key given as undefined clears an optional one (role, category, tags).
export type ObjectProps = { shape?: Shape; capacity?: number; role?: string; category?: string; tags?: string[] }

export const planEdits = {
  addGroup,
  addPlaces,
  addFixtures,
  addLabels,
  layoutGroup,
  arrange,
  convert,
  group,
  ungroup,
  label,
  assign,
  align,
  distribute,
  reorder,
  duplicate,
  templateOf,
  insertTemplate,
  remove,
  rename,
  addSection,
  removeSection,
  rotate,
  move,
  moveSection,
  reshapeSection,
  applyDrag,
  isLocked,
  unitOf,
}

// A new empty group. Its id is `<role>-<n>` (or `group-<n>`).
function addGroup<S extends string>(
  plan: SeatPlan<S>,
  group: Omit<Group, 'id'> = {},
): { plan: SeatPlan<S>; id: string } {
  const id = seatPlan.nextObjectId(plan, group.role ?? 'group')
  return { plan: { ...plan, groups: [...plan.groups, { id, ...group }] }, id }
}

// Places on the given boxes, drawn on top. Ids continue the section's numbering; labels are left to `label`.
// null when the ids would pass PLACE_ID_MAX.
function addPlaces<S extends string>(
  plan: SeatPlan<S>,
  section: S,
  boxes: readonly PlanBox[],
  options: { shape?: Shape; capacity?: number; role?: string; group?: string; category?: string } = {},
): Added<S> | null {
  const ids = placeIds(plan, section, boxes.length)
  if (!ids) return null
  const places = boxes.map((box, i): Place<S> => ({
    kind: 'place',
    id: ids[i]!,
    section,
    ...boxOf(box),
    shape: options.shape ?? 'ellipse',
    capacity: options.capacity ?? 1,
    ...defined({ group: options.group, role: options.role, category: options.category }),
  }))
  return { plan: { ...plan, objects: [...plan.objects, ...places] }, ids }
}

// Fixtures on the given boxes, drawn under everything else (object order is drawing order). Ids are
// `<role>-<n>` (or `fixture-<n>`).
function addFixtures<S extends string>(
  plan: SeatPlan<S>,
  boxes: readonly PlanBox[],
  options: { shape?: Shape; role?: string; group?: string } = {},
): Added<S> {
  const ids = objectIds(plan, options.role ?? 'fixture', boxes.length)
  const fixtures = boxes.map((box, i): Fixture => ({
    kind: 'fixture',
    id: ids[i]!,
    ...boxOf(box),
    shape: options.shape ?? 'rect',
    ...defined({ group: options.group, role: options.role }),
  }))
  return { plan: { ...plan, objects: [...fixtures, ...plan.objects] }, ids }
}

// Labels for a group on the given boxes (a row's ends), drawn on top.
function addLabels<S extends string>(plan: SeatPlan<S>, groupId: string, boxes: readonly PlanBox[]): Added<S> {
  const ids = objectIds(plan, 'label', boxes.length)
  const labels = boxes.map((box, i): GroupLabel => ({ kind: 'label', id: ids[i]!, group: groupId, ...boxOf(box) }))
  return { plan: { ...plan, objects: [...plan.objects, ...labels] }, ids }
}

// Lays a group's places (or its fixtures of a role) out on `boxes`, in order: the members move onto them, extra
// boxes get new members like the last one (places continue its section's numbering), and members past the last
// box are removed from the end. How a row grows, shrinks or bends. null when a member to remove is locked, the
// group has no such member to copy, or the new ids would not save.
function layoutGroup<S extends string>(
  plan: SeatPlan<S>,
  groupId: string,
  boxes: readonly PlanBox[],
  members: GroupMembers = { kind: 'place' },
  locked: ReadonlySet<string> = NONE,
): SeatPlan<S> | null {
  const matches = (o: PlanObject<S>): o is Place<S> | Fixture =>
    o.kind !== 'label' &&
    o.group === groupId &&
    o.kind === members.kind &&
    (members.kind === 'place' || members.role === undefined || o.role === members.role)
  const current = plan.objects.filter(matches)
  const last = current.at(-1)
  if (!last || boxes.length === 0) return null
  const surplus = current.slice(boxes.length)
  if (surplus.some((o) => locked.has(o.id))) return null
  const extra = boxes.length - current.length
  let added: PlanObject<S>[] = []
  if (extra > 0) {
    const ids =
      last.kind === 'place' ? placeIds(plan, last.section, extra) : objectIds(plan, last.role ?? 'fixture', extra)
    if (!ids) return null
    // Copies of the last member — a new seat takes no label; `label` numbers it.
    added = ids.map((id) => defined({ ...last, id, label: undefined }) as PlanObject<S>)
  }
  const gone = new Set(surplus.map((o) => o.id))
  const at = plan.objects.indexOf(last)
  const objects = [...plan.objects.slice(0, at + 1), ...added, ...plan.objects.slice(at + 1)].filter(
    (o) => !gone.has(o.id),
  )
  const ids = [...current.filter((o) => !gone.has(o.id)), ...added].map((o) => o.id)
  return arrange({ ...plan, objects }, ids, boxes)
}

// Moves objects onto new boxes — `ids[i]` takes `boxes[i]`'s position, size and turn; nothing else changes.
// Places re-home to the section their new centre lands in.
function arrange<S extends string>(plan: SeatPlan<S>, ids: readonly string[], boxes: readonly PlanBox[]): SeatPlan<S> {
  const target = new Map(ids.flatMap((id, i) => (boxes[i] ? [[id, boxOf(boxes[i])] as const] : [])))
  return {
    ...plan,
    objects: plan.objects.map((o) => {
      const box = target.get(o.id)
      if (!box) return o
      const { rotation: _, ...rest } = o
      return rehomed(plan, { ...rest, ...box } as PlanObject<S>)
    }),
  }
}

// Makes objects bookable or not — a whole-booked table's top becomes a place and its seats chairs, or back.
// A fixture becoming a place needs a section (`section`, or the one its centre lies in) and keeps its id when it
// fits PLACE_ID_MAX (otherwise it continues that section's numbering). A place becoming a fixture drops its
// booking fields. null when a place is locked, or a fixture has no section.
function convert<S extends string>(
  plan: SeatPlan<S>,
  ids: readonly string[],
  to: 'place' | 'fixture',
  options: { section?: S; capacity?: number; role?: string } = {},
  locked: ReadonlySet<string> = NONE,
): SeatPlan<S> | null {
  const wanted = new Set(ids)
  let next = plan
  const objects: PlanObject<S>[] = []
  for (const o of plan.objects) {
    if (!wanted.has(o.id) || o.kind === 'label' || o.kind === to) {
      objects.push(o)
      continue
    }
    const box = { ...boxOf(o), ...defined({ group: o.group, role: options.role ?? o.role }) }
    if (o.kind === 'place') {
      if (locked.has(o.id)) return null
      objects.push({ kind: 'fixture', id: o.id, shape: o.shape, ...box })
      continue
    }
    const section = options.section ?? seatPlan.sectionAt(plan, seatPlan.centerOf(o))
    if (section === null) return null
    const id = o.id.length <= PLACE_ID_MAX ? o.id : placeIds(next, section, 1)?.[0]
    if (!id) return null
    objects.push({ kind: 'place', id, section, shape: o.shape, capacity: options.capacity ?? 1, ...box })
    next = { ...next, objects: [...next.objects, objects.at(-1)!] }
  }
  return { ...plan, objects }
}

// Puts objects in a new group (out of any group they were in) and returns its id.
function group<S extends string>(
  plan: SeatPlan<S>,
  ids: readonly string[],
  props: Omit<Group, 'id'> = {},
): { plan: SeatPlan<S>; id: string } | null {
  const members = new Set(ids.flatMap((id) => unitOf(plan, id).map((o) => o.id)))
  if (members.size === 0) return null
  const created = addGroup(plan, props)
  return {
    plan: pruneGroups({
      ...created.plan,
      objects: created.plan.objects.map((o) =>
        members.has(o.id) && o.kind !== 'label' ? { ...o, group: created.id } : o,
      ),
    }),
    id: created.id,
  }
}

// Dissolves a group — its members stay where they are, its labels go.
function ungroup<S extends string>(plan: SeatPlan<S>, groupId: string): SeatPlan<S> {
  return {
    ...plan,
    groups: plan.groups.filter((g) => g.id !== groupId),
    objects: plan.objects.flatMap((o) => {
      if (o.group !== groupId) return [o]
      if (o.kind === 'label') return []
      const { group: _, ...rest } = o
      return [rest as PlanObject<S>]
    }),
  }
}

// Labels places and groups in the given order — a row's seats (pass them in row order), or a set of rows.
function label<S extends string>(plan: SeatPlan<S>, ids: readonly string[], sequence: LabelSequence): SeatPlan<S> {
  const labels = new Map(ids.map((id, i) => [id, sequence(i, ids.length)]))
  const labelled = <T extends { id: string; label?: string }>(item: T): T => {
    const text = labels.get(item.id)
    if (text === undefined) return item
    if (text === '') {
      const { label: _, ...rest } = item
      return rest as T
    }
    return { ...item, label: text }
  }
  return {
    ...plan,
    groups: plan.groups.map(labelled),
    objects: plan.objects.map((o) => (o.kind === 'place' ? labelled(o) : o)),
  }
}

// Sets properties on many objects in one go — a group id stands for its members; labels have none of them. null
// when a value would not save: a capacity that is not a whole number above zero, a blank, padded or overlong role,
// an empty tag, a category the plan does not list. Locked ids do not matter — none of these is what other records
// reference.
function assign<S extends string>(plan: SeatPlan<S>, ids: readonly string[], props: ObjectProps): SeatPlan<S> | null {
  const { capacity, role, category, tags } = props
  if (capacity !== undefined && !(Number.isInteger(capacity) && capacity > 0)) return null
  if (role !== undefined && (role.length === 0 || role.trim() !== role || role.length > OBJECT_ID_MAX)) return null
  if (category !== undefined && !plan.categories.some((c) => c.key === category)) return null
  if (tags?.some((tag) => tag.length === 0)) return null
  const wanted = new Set(ids.flatMap((id) => unitOf(plan, id).map((o) => o.id)))
  return { ...plan, objects: plan.objects.map((o) => (wanted.has(o.id) ? assigned(o, props) : o)) }
}

function assigned<S extends string>(object: PlanObject<S>, props: ObjectProps): PlanObject<S> {
  if (object.kind === 'label') return object
  const next: Record<string, unknown> = { ...object }
  for (const key of object.kind === 'place' ? PLACE_PROPS : FIXTURE_PROPS) {
    if (!(key in props)) continue
    const value = props[key]
    if (value !== undefined) next[key] = value
    else if (key !== 'shape' && key !== 'capacity') delete next[key]
  }
  return next as PlanObject<S>
}

const PLACE_PROPS = ['shape', 'capacity', 'role', 'category', 'tags'] as const
const FIXTURE_PROPS = ['shape', 'role'] as const

// Lines objects (or groups, as a whole) up on one edge or centre line of their combined extent.
function align<S extends string>(plan: SeatPlan<S>, ids: readonly string[], edge: AlignEdge): SeatPlan<S> {
  const units = unitsOf(plan, ids)
  if (units.length < 2) return plan
  const boxes = units.map(extentOfUnit)
  const all = unionBounds(boxes)!
  const right = all.x + all.w
  const bottom = all.y + all.h
  return units.reduce((next, unit, i) => {
    const b = boxes[i]!
    const delta = (() => {
      switch (edge) {
        case 'left':
          return { x: all.x - b.x, y: 0 }
        case 'right':
          return { x: right - (b.x + b.w), y: 0 }
        case 'top':
          return { x: 0, y: all.y - b.y }
        case 'bottom':
          return { x: 0, y: bottom - (b.y + b.h) }
        case 'center-x':
          return { x: all.x + all.w / 2 - (b.x + b.w / 2), y: 0 }
        case 'center-y':
          return { x: 0, y: all.y + all.h / 2 - (b.y + b.h / 2) }
      }
    })()
    return shift(next, unit, { x: Math.round(delta.x), y: Math.round(delta.y) })
  }, plan)
}

// Spreads objects (or groups) so their centres are evenly spaced between the first and the last along the axis.
function distribute<S extends string>(plan: SeatPlan<S>, ids: readonly string[], axis: 'x' | 'y'): SeatPlan<S> {
  const units = unitsOf(plan, ids)
  if (units.length < 3) return plan
  const centerOf = (unit: PlanObject<S>[]) => {
    const b = extentOfUnit(unit)
    return axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2
  }
  const ordered = [...units].sort((a, b) => centerOf(a) - centerOf(b))
  const first = centerOf(ordered[0]!)
  const step = (centerOf(ordered.at(-1)!) - first) / (ordered.length - 1)
  return ordered.reduce((next, unit, i) => {
    const delta = Math.round(first + step * i - centerOf(unit))
    return shift(next, unit, axis === 'x' ? { x: delta, y: 0 } : { x: 0, y: delta })
  }, plan)
}

// Moves objects and groups in the drawing order: `front` above everything, `back` under everything, `forward` and
// `backward` past the next unit above or below. A unit is a group (as one) or an object outside one, and units stand
// in the order of their highest member — a group whose members are drawn apart (a table top under everything, its
// seats on top) stands where its highest one is, the way a layers panel lists it. What moves goes together and keeps
// its own order; the plan comes back as it was when there is nothing to pass.
function reorder<S extends string>(plan: SeatPlan<S>, ids: readonly string[], to: Reorder): SeatPlan<S> {
  const moving = new Set(ids.flatMap((id) => unitOf(plan, id)).map((o) => o.id))
  if (moving.size === 0) return plan
  const moved = plan.objects.filter((o) => moving.has(o.id))
  const kept = plan.objects.filter((o) => !moving.has(o.id))
  if (to === 'front') return { ...plan, objects: [...kept, ...moved] }
  if (to === 'back') return { ...plan, objects: [...moved, ...kept] }
  // How high what moves reaches, and where each unit that stays has its highest member — in the plan's order
  // (`index`) and among what stays (`at`).
  let top = -1
  let staying = 0
  const highest = new Map<string, { at: number; index: number }>()
  plan.objects.forEach((o, index) => {
    if (moving.has(o.id)) top = index
    else highest.set(o.group ?? o.id, { at: staying++, index })
  })
  const passed = [...highest.values()].reduce<{ at: number; index: number } | null>((best, unit) => {
    const beyond = to === 'forward' ? unit.index > top : unit.index < top
    if (!beyond) return best
    const nearer = best === null || (to === 'forward' ? unit.index < best.index : unit.index > best.index)
    return nearer ? unit : best
  }, null)
  if (passed === null) return plan
  // Forward lands just above the unit passed, backward just under its highest member — one place in the listing.
  const at = to === 'forward' ? passed.at + 1 : passed.at
  return { ...plan, objects: [...kept.slice(0, at), ...moved, ...kept.slice(at)] }
}

// Copies objects and groups by `offset` with fresh ids (places continue their section numbering, labels are
// copied; a copied group gets a new id and copies of all its members). Returns the copies' ids, a group copy by
// its group id. A copy whose place ids would be too long is skipped.
function duplicate<S extends string>(
  plan: SeatPlan<S>,
  ids: readonly string[],
  offset: PlanPoint = DUPLICATE_OFFSET,
): { plan: SeatPlan<S>; ids: string[] } {
  let next = plan
  const created: string[] = []
  for (const id of ids) {
    const source = seatPlan.groupById(plan, id)
    const unit = unitOf(plan, id)
    if (unit.length === 0) continue
    let groupId: string | undefined
    if (source) {
      const added = addGroup(next, {
        ...defined({ label: source.label, role: source.role, rotation: source.rotation }),
      })
      next = added.plan
      groupId = added.id
    }
    const copies: PlanObject<S>[] = []
    let scratch = next
    let skipped = false
    for (const o of unit) {
      const moved = seatPlan.translate(o, offset.x, offset.y)
      const regrouped = groupId !== undefined ? { ...moved, group: groupId } : moved
      const fresh =
        o.kind === 'place'
          ? placeIds(scratch, o.section, 1)?.[0]
          : objectIds(scratch, o.kind === 'label' ? 'label' : (o.role ?? 'fixture'), 1)[0]
      if (!fresh) {
        skipped = true
        break
      }
      const copy = { ...regrouped, id: fresh } as PlanObject<S>
      copies.push(copy)
      scratch = { ...scratch, objects: [...scratch.objects, copy] }
    }
    if (skipped) {
      next = groupId !== undefined ? { ...next, groups: next.groups.filter((g) => g.id !== groupId) } : next
      continue
    }
    next = { ...next, objects: [...next.objects, ...copies] }
    created.push(groupId ?? copies[0]!.id)
  }
  return { plan: next, ids: created }
}

// A template of what `ids` hold, the way a selection holds them — a group with all its members and labels, an
// object on its own (out of its group, unless the group comes too). Coordinates become relative to the middle of
// its objects, in whole units; `at` is where that middle is, so inserting the template there puts the copy on the
// original. null when the ids hold nothing.
function templateOf<S extends string>(
  plan: SeatPlan<S>,
  ids: readonly string[],
): { template: PlanTemplate; at: PlanPoint } | null {
  const groups = new Set(ids.filter((id) => seatPlan.groupById(plan, id) !== undefined))
  const wanted = new Set(ids.flatMap((id) => unitOf(plan, id).map((o) => o.id)))
  // A label names its group — it only comes along with it.
  const objects = plan.objects.filter((o) => wanted.has(o.id) && (o.kind !== 'label' || groups.has(o.group)))
  const extent = seatPlan.extentOf(objects.filter((o) => o.kind !== 'label'))
  if (!extent) return null
  const at = { x: Math.round(extent.x + extent.w / 2), y: Math.round(extent.y + extent.h / 2) }
  return {
    at,
    template: {
      version: 3,
      groups: plan.groups.filter((g) => groups.has(g.id)),
      objects: objects.map((o): TemplateObject => {
        const moved = seatPlan.translate(o, -at.x, -at.y)
        if (moved.kind === 'label') return moved
        const { group, ...loose } = moved
        const kept = group !== undefined && groups.has(group) ? moved : loose
        if (kept.kind !== 'place') return kept
        const { section: _, ...rest } = kept
        return rest
      }),
    },
  }
}

// Adds a template's objects centred on `at`, with fresh ids: places continue the numbering of the section they
// land in (`section` when they land in none), fixtures and labels are `<role>-<n>`, and groups get new ids. The
// copy is held inside the plan, drawn on top, and keeps no category the plan does not list. Returns the new ids —
// a group by its group id — or null when a place would land outside every section or its id would not save.
function insertTemplate<S extends string>(
  plan: SeatPlan<S>,
  template: PlanTemplate,
  at: PlanPoint,
  options: { section?: S } = {},
): Added<S> | null {
  // Groups without members (or listed twice), and labels of groups the template does not hold, are left out.
  const groups = template.groups.filter(
    (g, i, all) =>
      all.findIndex((other) => other.id === g.id) === i &&
      template.objects.some((o) => o.kind !== 'label' && o.group === g.id),
  )
  const held = new Set(groups.map((g) => g.id))
  const origin = { x: Math.round(at.x), y: Math.round(at.y) }
  const pieces = template.objects
    .filter((o) => o.kind !== 'label' || held.has(o.group))
    .map((o) => {
      const { rotation: _, ...rest } = o
      return { ...rest, ...boxOf(seatPlan.translate(o, origin.x, origin.y)) } as TemplateObject
    })
  const extent = unionBounds(pieces.flatMap((o) => (o.kind === 'label' ? [] : [boundsOfBox(o, o.shape)])))
  if (!extent) return null
  // Held inside the plan by what it draws — labels may sit in the margin.
  const dx = inward(extent.x, extent.w, plan.width, 1)
  const dy = inward(extent.y, extent.h, plan.height, 1)
  const placed = pieces.map((o) => seatPlan.translate(o, dx, dy))
  const middle = { x: extent.x + dx + extent.w / 2, y: extent.y + dy + extent.h / 2 }
  const fallback = options.section ?? seatPlan.sectionAt(plan, middle)
  const sections = placed.map((o) =>
    o.kind === 'place' ? (seatPlan.sectionAt(plan, centerOfBox(o)) ?? fallback) : null,
  )
  if (placed.some((o, i) => o.kind === 'place' && sections[i] === null)) return null

  let next = plan
  const groupIds = new Map<string, string>()
  for (const { id, ...props } of groups) {
    const made = addGroup(next, props)
    next = made.plan
    groupIds.set(id, made.id)
  }
  // Fresh ids in batches — places by section, the rest by prefix — each batch seeing the ones handed out before.
  const batches: { section: string | null; prefix: string; indices: number[] }[] = []
  placed.forEach((o, i) => {
    const section = sections[i] ?? null
    const prefix = o.kind === 'label' ? 'label' : o.kind === 'fixture' ? (o.role ?? 'fixture') : ''
    const batch = batches.find((b) => b.section === section && b.prefix === prefix)
    if (batch) batch.indices.push(i)
    else batches.push({ section, prefix, indices: [i] })
  })
  const ids: string[] = []
  let scratch: SeatPlan<S> = next
  for (const { section, prefix, indices } of batches) {
    const fresh =
      section === null ? objectIds(scratch, prefix, indices.length) : placeIds(scratch, section, indices.length)
    if (!fresh) return null
    indices.forEach((index, k) => (ids[index] = fresh[k]!))
    scratch = { ...scratch, groups: [...scratch.groups, ...fresh.map((id) => ({ id }))] }
  }

  const categories = new Set(plan.categories.map((c) => c.key))
  const objects = placed.map((o, i): PlanObject<S> => {
    const id = ids[i]!
    if (o.kind === 'label') return { ...o, id, group: groupIds.get(o.group)! }
    const group = o.group === undefined ? undefined : groupIds.get(o.group)
    if (o.kind === 'fixture') {
      const { group: _, ...rest } = o
      return { ...rest, id, ...defined({ group }) }
    }
    const { group: _, category, ...rest } = o
    const known = category !== undefined && categories.has(category) ? category : undefined
    return { ...rest, id, section: sections[i] as S, ...defined({ group, category: known }) }
  })
  const loose = objects.flatMap((o) => (o.kind !== 'label' && o.group === undefined ? [o.id] : []))
  return { plan: { ...next, objects: [...next.objects, ...objects] }, ids: [...groupIds.values(), ...loose] }
}

// Removes objects and groups, skipping any that hold a locked id. Groups left without members go too. Returns
// the plan and the ids it refused to remove.
function remove<S extends string>(
  plan: SeatPlan<S>,
  ids: readonly string[],
  locked: ReadonlySet<string> = NONE,
): { plan: SeatPlan<S>; refused: string[] } {
  const refused = ids.filter((id) => isLocked(plan, id, locked))
  const removed = new Set(
    ids.filter((id) => !refused.includes(id)).flatMap((id) => [id, ...unitOf(plan, id).map((o) => o.id)]),
  )
  return {
    plan: pruneGroups({
      ...plan,
      groups: plan.groups.filter((g) => !removed.has(g.id)),
      objects: plan.objects.filter((o) => !removed.has(o.id)),
    }),
    refused,
  }
}

// Changes an id — an object's or a group's (a group's members follow). For places it is the key other records
// reference. null when the id does not exist, is locked, is taken, or would not save (blank, too long).
function rename<S extends string>(
  plan: SeatPlan<S>,
  id: string,
  nextId: string,
  locked: ReadonlySet<string> = NONE,
): SeatPlan<S> | null {
  const trimmed = nextId.trim()
  if (trimmed !== nextId || trimmed.length === 0 || locked.has(id)) return null
  const ids = seatPlan.idsOf(plan)
  if (!ids.includes(id) || (nextId !== id && ids.includes(nextId))) return null
  const object = seatPlan.objectById(plan, id)
  if (nextId.length > (object?.kind === 'place' ? PLACE_ID_MAX : OBJECT_ID_MAX)) return null
  return {
    ...plan,
    groups: plan.groups.map((g) => (g.id === id ? { ...g, id: nextId } : g)),
    objects: plan.objects.map((o) => {
      if (o.id === id) return { ...o, id: nextId }
      if (object === undefined && o.group === id) return { ...o, group: nextId }
      return o
    }),
  }
}

// Turns objects and groups clockwise by `degrees` — one object about its own centre, one group as one about the
// centre of its frame (the direction it faces turns with it; its labels move but stay level), several together
// about the middle of their centres. Turning back by the same amount puts everything back, to within a unit.
function rotate<S extends string>(plan: SeatPlan<S>, ids: readonly string[], degrees: number): SeatPlan<S> {
  const units = ids.flatMap((id) => {
    const members = unitOf(plan, id)
    const pivot = pivotOf(plan, id)
    return members.length > 0 && pivot ? [{ id, members, pivot }] : []
  })
  if (units.length === 0 || !degrees) return plan
  // Several turn together, about the middle of their centres — the mean does not move as they turn.
  const shared =
    units.length > 1
      ? {
          x: units.reduce((sum, u) => sum + u.pivot.x, 0) / units.length,
          y: units.reduce((sum, u) => sum + u.pivot.y, 0) / units.length,
        }
      : null
  return units.reduce((next, { id, members, pivot }) => {
    const group = seatPlan.groupById(next, id)
    const turned = turnObjects(next, members, shared ?? (group ? pivot : null), degrees)
    return group ? withGroupRotation(turned, id, (group.rotation ?? 0) + degrees) : turned
  }, plan)
}

// Moves objects and groups by `delta` — snapped to half cells, and held inside the plan by what they draw. A
// single object snaps its own position instead, so it lands on the grid.
function move<S extends string>(
  plan: SeatPlan<S>,
  ids: readonly string[],
  delta: PlanPoint,
  snap: Snap | null = null,
): SeatPlan<S> {
  const moving = new Map(ids.flatMap((id) => unitOf(plan, id)).map((o) => [o.id, o]))
  if (moving.size === 0) return plan
  const objects = [...moving.values()]
  const step = snap ? snap.cell / 2 : 1
  const only = objects.length === 1 && ids.length === 1 && seatPlan.groupById(plan, ids[0]!) === undefined
  let d = only
    ? {
        x: roundTo(objects[0]!.x + delta.x, step) - objects[0]!.x,
        y: roundTo(objects[0]!.y + delta.y, step) - objects[0]!.y,
      }
    : { x: roundTo(delta.x, step), y: roundTo(delta.y, step) }
  // Labels may sit in the margin; everything else stays on the plan.
  const held = objects.filter((o) => o.kind !== 'label')
  const extent = unionBounds(held.map((o) => seatPlan.translate(seatPlan.boundsOf(o), d.x, d.y)))
  if (extent)
    d = {
      x: d.x + inward(extent.x, extent.w, plan.width, step),
      y: d.y + inward(extent.y, extent.h, plan.height, step),
    }
  if (d.x === 0 && d.y === 0) return plan
  return {
    ...plan,
    objects: plan.objects.map((o) => (moving.has(o.id) ? rehomed(plan, seatPlan.translate(o, d.x, d.y)) : o)),
  }
}

// Adds a section — its outline in whole units. null when the id is taken or the outline has fewer than three corners.
// Places keep the sections they hold; ones the new outline covers can be moved into it with `arrange` or a drag.
function addSection<S extends string>(plan: SeatPlan<S>, section: Section<S>): SeatPlan<S> | null {
  if (section.points.length < 3 || seatPlan.sectionOf(plan, section.id)) return null
  const points = section.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
  return { ...plan, sections: [...plan.sections, { id: section.id, points }] }
}

// Removes a section with what stands in it: its places, every group holding one (whole — a table's top and chairs go
// with its seats) and the fixtures outside groups whose centre lies in its outline. Nothing goes when any of that
// holds a locked id; `refused` lists what does.
function removeSection<S extends string>(
  plan: SeatPlan<S>,
  id: S,
  locked: ReadonlySet<string> = NONE,
): { plan: SeatPlan<S>; refused: string[] } {
  const section = seatPlan.sectionOf(plan, id)
  if (!section) return { plan, refused: [] }
  const units = new Set<string>()
  for (const o of plan.objects) {
    if (o.kind === 'place' && o.section === id) units.add(o.group ?? o.id)
    else if (o.kind === 'fixture' && o.group === undefined && polygonContains(section.points, seatPlan.centerOf(o)))
      units.add(o.id)
  }
  const refused = [...units].filter((unit) => isLocked(plan, unit, locked))
  if (refused.length > 0) return { plan, refused }
  const { plan: cleared } = remove(plan, [...units])
  return { plan: { ...cleared, sections: cleared.sections.filter((s) => s.id !== id) }, refused: [] }
}

// Moves a section outline by whole cells (whole units without snapping).
function moveSection<S extends string>(
  plan: SeatPlan<S>,
  id: S,
  delta: PlanPoint,
  snap: Snap | null = null,
): SeatPlan<S> {
  const step = snap ? snap.cell : 1
  const dx = roundTo(delta.x, step)
  const dy = roundTo(delta.y, step)
  return {
    ...plan,
    sections: plan.sections.map((s) =>
      s.id === id ? { ...s, points: s.points.map((p) => snapPoint(plan, { x: p.x + dx, y: p.y + dy }, snap)) } : s,
    ),
  }
}

// Replaces a section outline (e.g. after resizing), snapped to cell corners.
function reshapeSection<S extends string>(
  plan: SeatPlan<S>,
  id: S,
  points: readonly PlanPoint[],
  snap: Snap | null = null,
): SeatPlan<S> {
  return {
    ...plan,
    sections: plan.sections.map((s: Section<S>) =>
      s.id === id ? { ...s, points: points.map((p) => snapPoint(plan, p, snap)) } : s,
    ),
  }
}

// The plan with a drag applied — a handle reshapes or turns its owner, a section moves by whole cells, objects by
// the drag total. When the dragged object is part of `selected` (object and group ids), the whole selection
// moves; otherwise the object alone, or its group when it has one. A constrained move keeps to the axis it went
// furthest along; a copying one (Alt) leaves them where they were and moves copies (see `duplicate`).
function applyDrag<S extends string>(
  plan: SeatPlan<S>,
  drag: PlanDrag<S>,
  selected: readonly string[] = [],
  snap: Snap | null = null,
): SeatPlan<S> {
  const { target, constrain = false } = drag
  if (target.kind === 'handle') {
    return planHandles.drag(plan, target.owner, target.name, drag.total, snap, constrain, drag.pixel)
  }
  const total = constrain ? alongAxis(drag.total) : drag.total
  if (target.kind === 'section') return moveSection(plan, target.id, total, snap)
  const object = seatPlan.objectById(plan, target.id)
  if (!object) return plan
  const covered = selected.includes(object.id) || (object.group !== undefined && selected.includes(object.group))
  const ids = covered ? selected : [object.group ?? object.id]
  if (!drag.copy) return move(plan, ids, total, snap)
  const copies = duplicate(plan, ids, ORIGIN)
  return move(copies.plan, copies.ids, total, snap)
}

// Whether an object or group holds an id other records reference — its own, or one of its members'.
function isLocked(plan: Pick<SeatPlan, 'objects' | 'groups'>, id: string, locked: ReadonlySet<string>): boolean {
  if (locked.has(id)) return true
  return unitOf(plan as SeatPlan, id).some((o) => locked.has(o.id))
}

// What an id stands for — a group's members (in drawing order), or the one object.
function unitOf<S extends string>(plan: SeatPlan<S>, id: string): PlanObject<S>[] {
  if (seatPlan.groupById(plan, id)) return seatPlan.membersOf(plan, id)
  const object = seatPlan.objectById(plan, id)
  return object ? [object] : []
}

function unitsOf<S extends string>(plan: SeatPlan<S>, ids: readonly string[]): PlanObject<S>[][] {
  return ids.map((id) => unitOf(plan, id)).filter((unit) => unit.length > 0)
}

function extentOfUnit(unit: readonly PlanObject[]): PlanRect {
  return seatPlan.extentOf(unit) ?? { x: 0, y: 0, w: 0, h: 0 }
}

// A unit moved by an exact delta (no snapping), places re-homed.
function shift<S extends string>(plan: SeatPlan<S>, unit: readonly PlanObject<S>[], d: PlanPoint): SeatPlan<S> {
  if (d.x === 0 && d.y === 0) return plan
  const ids = new Set(unit.map((o) => o.id))
  return {
    ...plan,
    objects: plan.objects.map((o) => (ids.has(o.id) ? rehomed(plan, seatPlan.translate(o, d.x, d.y)) : o)),
  }
}

// A place moves to the section its centre lands in (it keeps its own when it lands outside every section).
function rehomed<S extends string>(plan: SeatPlan<S>, object: PlanObject<S>): PlanObject<S> {
  if (object.kind !== 'place') return object
  const section = seatPlan.sectionAt(plan, seatPlan.centerOf(object)) ?? object.section
  return section === object.section ? object : { ...object, section }
}

// Groups nothing points at any more are dropped, and so are labels of groups without members.
function pruneGroups<S extends string>(plan: SeatPlan<S>): SeatPlan<S> {
  const used = new Set(plan.objects.flatMap((o) => (o.kind !== 'label' && o.group !== undefined ? [o.group] : [])))
  return {
    ...plan,
    groups: plan.groups.filter((g) => used.has(g.id)),
    objects: plan.objects.filter((o) => o.kind !== 'label' || used.has(o.group)),
  }
}

// The shift (in `step`s) that brings [start, start + size] inside [0, extent] (the start wins when it cannot fit).
function inward(start: number, size: number, extent: number, step: number): number {
  if (start < 0) return Math.ceil(-start / step) * step
  const over = start + size - extent
  if (over <= 0) return 0
  return -Math.min(Math.ceil(over / step) * step, Math.floor(start / step) * step)
}

// A section outline point on the nearest cell corner (whole unit without snapping), inside the plan.
function snapPoint(plan: Pick<SeatPlan, 'width' | 'height'>, point: PlanPoint, snap: Snap | null): PlanPoint {
  const step = snap ? snap.cell : 1
  return {
    x: Math.min(Math.floor(plan.width / step) * step, Math.max(0, roundTo(point.x, step))),
    y: Math.min(Math.floor(plan.height / step) * step, Math.max(0, roundTo(point.y, step))),
  }
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

// `count` fresh place ids for a section, continuing its numbering. null when the last would pass PLACE_ID_MAX.
function placeIds(plan: SeatPlan<string>, section: string, count: number): string[] | null {
  const first = seatPlan.nextPlaceId(plan, section)
  const start = Number(first.slice(section.length))
  const ids = Array.from({ length: count }, (_, i) => `${section}${start + i}`)
  return ids.every((id) => id.length <= PLACE_ID_MAX) ? ids : null
}

// `count` fresh `<prefix>-<n>` ids.
function objectIds(plan: SeatPlan<string>, prefix: string, count: number): string[] {
  const ids: string[] = []
  let scratch: Pick<SeatPlan, 'objects' | 'groups'> = plan
  for (let i = 0; i < count; i++) {
    const id = seatPlan.nextObjectId(scratch, prefix)
    ids.push(id)
    scratch = { ...scratch, groups: [...scratch.groups, { id }] }
  }
  return ids
}

// The document form of a box — whole units, and no turn when there is none.
function boxOf(box: PlanBox): PlanBox {
  const rotation = normalizeRotation(box.rotation ?? 0)
  const rect = {
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.max(1, Math.round(box.w)),
    h: Math.max(1, Math.round(box.h)),
  }
  return rotation === 0 ? rect : { ...rect, rotation }
}

// The object without its undefined fields — documents never hold `key: undefined`.
function defined<T extends object>(object: T): Partial<T> {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as Partial<T>
}

const NONE: ReadonlySet<string> = new Set()
// Two cells right and down — a copy lands next to its original, not on it.
const DUPLICATE_OFFSET: PlanPoint = { x: GRID_CELL * 2, y: GRID_CELL * 2 }
const ORIGIN: PlanPoint = { x: 0, y: 0 }
