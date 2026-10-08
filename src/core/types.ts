// Seat plan document (version 3) — plain JSON, integer coordinates in plan units. It is stored by consumers for
// years, so every change here needs a schema default or an upgrade path (see `./legacy.ts`).
// `S` is the consumer's section id union (fixed per app, see `createSeatPlanSchema`).
//
// The document holds primitives only: what is where, and what can be booked. How a row or a table was laid out
// is not stored — the editor's layouts create the places, and `role` carries the consumer's word for them.

export const OBJECT_KINDS = ['place', 'fixture', 'label'] as const
export type ObjectKind = (typeof OBJECT_KINDS)[number]

export const SHAPES = ['rect', 'ellipse'] as const
export type Shape = (typeof SHAPES)[number]

export type PlanRect = { x: number; y: number; w: number; h: number }
export type PlanPoint = { x: number; y: number }
export type PlanSize = { w: number; h: number }

// A rectangle turned clockwise by `rotation` degrees (0 ≤ rotation < 360) about its centre — `x y w h` are the
// unturned box, as SVG's `rotate(r, cx, cy)` reads them.
export type PlanBox = PlanRect & { rotation?: number }

// A section of the venue (a room, a block of the hall). Its composition is fixed by the consumer; the outline
// is a polygon.
export type Section<S extends string = string> = { id: S; points: PlanPoint[] }

// A class of places (price level, accessible seating, …). Only the key lives in the document — names, colours
// and prices are the consumer's.
export type Category = { key: string; accessible?: boolean }

// A named set of objects — a row of seats, a table with its chairs, a desk with its chair. Objects point at it;
// it moves, rotates and is selected as one. `label` is what people read ("Row A"), `role` the consumer's word.
// `rotation` is the way the group faces (degrees clockwise, 0 ≤ rotation < 360): the group's frame — the box
// around its members, level in that direction — turns with it, so the group keeps one centre however often it
// is turned. It draws nothing itself.
export type Group = { id: string; label?: string; role?: string; rotation?: number }

// Something that can be booked — a seat, a desk, a booth, a standing area, a whole table. `id` is the booking key
// other records reference (1–8 chars, stable); `label` is what people read and may change freely (defaults to
// the id). `capacity` is how many people it holds.
export type Place<S extends string = string> = PlanBox & {
  kind: 'place'
  id: string
  section: S
  shape: Shape
  capacity: number
  label?: string
  group?: string
  role?: string
  category?: string
  tags?: string[]
}

// Something that cannot be booked (a wall, a stage, a table top, a chair) — a reading aid only; never counted as
// capacity. `role` is the consumer's word for it.
export type Fixture = PlanBox & { kind: 'fixture'; id: string; shape: Shape; group?: string; role?: string }

// Where a group's label is written — the text is the group's `label` (or its id), so renaming a row changes every
// label that shows it.
export type GroupLabel = PlanBox & { kind: 'label'; id: string; group: string }

export type PlanObject<S extends string = string> = Place<S> | Fixture | GroupLabel

export type SeatPlan<S extends string = string> = {
  version: 3
  width: number
  height: number
  sections: Section<S>[]
  categories: Category[]
  groups: Group[]
  // Drawing order — later objects are drawn on top.
  objects: PlanObject<S>[]
}

// A plan cropped to one section — the same shape, translated so the crop's bounding box starts at the origin.
export type SectionPlan<S extends string = string> = { id: S; plan: SeatPlan<S> }

// What a pointer or key landed on — a place, another object (fixture, group label), a section outline, or an
// editing handle. Viewports report it; the editor acts on it.
export type PlanTarget<S extends string = string> =
  | { kind: 'place'; id: string }
  | { kind: 'object'; id: string }
  | { kind: 'section'; id: S }
  | { kind: 'handle'; owner: HandleOwner<S>; name: string }

// What an editing handle belongs to — one object, group or section, or the whole selection (the knob that turns
// several items together).
export type HandleOwner<S extends string = string> =
  { kind: 'object'; id: string } | { kind: 'group'; id: string } | { kind: 'section'; id: S } | { kind: 'selection' }

// An editing handle on the plan — a corner to resize, the knob to rotate, a section vertex, or the middle of a
// section's edge (dragging it adds a vertex there). `name` is `nw` `ne` `se` `sw`, `rotate`, `vertex-<index>` or
// `edge-<index>` (the edge from that vertex to the next). `angle` is the direction a corner points from its owner's
// centre (degrees clockwise from +x) — turned with the owner, so renderers can pick a matching resize cursor.
export type PlanHandle<S extends string = string> = {
  owner: HandleOwner<S>
  name: string
  point: PlanPoint
  angle?: number
}

// A drag of a target, reported by viewports while it moves. `total` is the movement since the drag started, in
// plan units. `constrain` is set while Shift is held: a move keeps to one axis, a turn steps by 15°, a corner keeps
// the proportions. `copy` is set while Alt is held: a move leaves what it drags where it was and moves a copy, and
// the middle of a section's edge adds a vertex rather than pushing the edge. `pixel` is how many plan units a screen
// pixel spans as the drag is reported — for tolerances that should feel the same at any zoom (a vertex dropped on its
// neighbour merges with it). `free` is set while ⌘ or Ctrl is held: smart guides let go.
export type PlanDrag<S extends string = string> = {
  target: PlanTarget<S>
  phase: 'start' | 'move' | 'end'
  total: PlanPoint
  constrain?: boolean
  copy?: boolean
  pixel?: number
  free?: boolean
}

// A smart guide an editor draws while something is dragged or drawn (see `planGuides`, ichno/editor). `line`: along `axis` x a vertical line at x = `at` from y `from` to `to` (along y a horizontal
// one) — something lines up there. `gap`: equal gaps along `axis`, each from `from` to `to`, drawn at the cross
// position `at`; `size` is the gap in plan units, to write beside them if you like.
export type PlanGuide =
  | { kind: 'line'; axis: 'x' | 'y'; at: number; from: number; to: number }
  | { kind: 'gap'; axis: 'x' | 'y'; at: number; size: number; gaps: { from: number; to: number }[] }

// A stroke drawn with a creation tool — from where the press started to where the pointer is (or was let go), in
// plan units. A tap is a stroke with no length. A polygon's stroke also lists its corners in order, from `start` to
// `end` — while it is drawn, the pointer is the last.
export type PlanStroke = { start: PlanPoint; end: PlanPoint; points?: PlanPoint[] }

// A reusable piece of a plan — some objects and the groups they form, placed around its own centre (0, 0). The
// editor makes one from a selection and adds it to any plan with fresh ids: a clipboard, or a library of objects
// people saved. Places carry no section; they take the one they land in. Like the document, a stored template
// keeps its `version` so it can be upgraded.
export type PlanTemplate = { version: 3; groups: Group[]; objects: TemplateObject[] }

export type TemplateObject = Omit<Place, 'section'> | Fixture | GroupLabel
