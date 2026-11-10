import { seatPlan } from '../core/geometry'
import { GRID_CELL } from '../core/grid'
import type { LabelSequence } from '../core/labeling'
import type {
  Group,
  PlanBox,
  PlanDrag,
  PlanObject,
  PlanPoint,
  PlanRect,
  PlanStroke,
  PlanTarget,
  PlanTemplate,
  SeatPlan,
  Section,
  Shape,
  Wall,
  WallOpening,
} from '../core/types'
import { planGuides } from './guides'
import {
  moveSections,
  planEdits,
  sectionContents,
  type AlignEdge,
  type GroupMembers,
  type ObjectProps,
  type Reorder,
} from './operations'
import type { EditorSelection } from './selection'
import {
  GUIDE_PX,
  addedSelection,
  centerOfIds,
  configOf,
  covers,
  dragged,
  initialState,
  isCornered,
  isGroupId,
  keyOf,
  rectangleOf,
  sameIds,
  samePoint,
  sameSelection,
  selectionOf,
  unitsOf,
  type DrawInfo,
  type Edit,
  type EditorState,
  type GroupChoice,
  type History,
  type Press,
  type SeatPlanEditorOptions,
} from './state'
import { strokeOf, type EditorTool } from './tools'
import { createView } from './view'
import { onWalls, wallStepOf } from './walls'

// The editor outside React: its state, what is drawn from it, and every command — a store you can read, subscribe to
// and drive from anywhere. `useSeatPlanEditor` (./use-seat-plan-editor.ts) is this bound to a component; a test, or an
// app that keeps the editor in a context and has each panel subscribe to its own slice, uses it as it is.
//
// `getState`, `getInitialState` and `subscribe` are the shape zustand's `useStore(store, selector)` takes, so an app
// on zustand binds to it without a line of glue; with React alone, `useSyncExternalStore` does the same.

export type SeatPlanEditorStore<S extends string> = ReturnType<typeof createSeatPlanEditor<S>>

// The plan to add into and the group what is added joins — `made` when that group is new.
type Grouped<S extends string> = { plan: SeatPlan<S>; group: string | undefined; made?: string }

// How close (screen pixels) a tap comes to a polygon's first or last corner to close it — a little past the marker
// on the first one.
const CLOSE_PX = 10

// Undo depth — plenty for an editing session, bounded so a long one does not hold every version.
const HISTORY_LIMIT = 100

// How far each paste lands from what was copied when the pointer is not over the plan — two cells, like duplicate.
const PASTE_STEP = GRID_CELL * 2

const NO_KEYS = {}

// A headless seat plan editor — document state, selection, creation tools, clipboard, undo history and every edit
// operation; no UI and no React. Edits stay local until you save `getState().plan`; `markSaved` then makes what you
// saved the baseline `dirty` compares against. To open another document, make another editor.
//
// Tapping an object in a group selects the group; tapping it again (with the group selected) selects the object
// alone. Operations that take ids accept object and group ids alike — a group acts as one.
export function createSeatPlanEditor<S extends string>({ initialPlan, ...options }: SeatPlanEditorOptions<S>) {
  let state: EditorState<S> = initialState(initialPlan)
  let config = configOf(options, null)
  // What `dirty` compares against and `reset` goes back to — the plan as opened, or as last saved (`markSaved`).
  let saved = { plan: initialPlan, json: JSON.stringify(initialPlan) }
  // The press under way, and whether Escape dropped it.
  let press: Press | null = null
  // The plan point under the pointer, whatever the tool — pasting lands there. Null when it is off the plan.
  let under: PlanPoint | null = null
  // The last duplicate — where what it copied stood and the copies' ids — so duplicating the copies repeats the step.
  let duplicated: { from: PlanPoint; ids: string[] } | null = null

  const listeners = new Set<() => void>()
  // Commands under way, and whether any of them changed something — whoever listens hears once per command.
  let depth = 0
  let changed = false

  const viewOf = createView<S>({
    onTap: (target, info) => run(() => handleTap(target, info)),
    canDrag,
    onTargetDrag: (drag) => run(() => handleDrag(drag)),
    onMarquee: (rect, info) => run(() => handleMarquee(rect, info)),
    onHover: (point, target, info) => run(() => handleHover(point, target, info)),
    onDraw: (stroke, info) => run(() => handleDraw(stroke, info)),
  })

  const initialView = viewOf(state, config).view

  function view() {
    return viewOf(state, config).view
  }

  function working() {
    return viewOf(state, config).working
  }

  function present(): SeatPlan<S> {
    return state.history.present
  }

  function set(patch: Partial<EditorState<S>>) {
    state = { ...state, ...patch }
    changed = true
  }

  function flush() {
    if (depth > 0 || !changed) return
    changed = false

    for (const listener of listeners) listener()
  }

  // Runs a command; however much it changes, the listeners hear of it once, when it is done.
  function run<T>(command: () => T): T {
    depth += 1

    try {
      return command()
    } finally {
      depth -= 1
      flush()
    }
  }

  function commit(next: Omit<History<S>, 'dirty'>) {
    set({ history: { ...next, dirty: JSON.stringify(next.present) !== saved.json } })
  }

  // Every change goes through here: one undo step each, and the redo branch is dropped. An edit that changes
  // nothing (removing an empty selection, a drag that snaps back) leaves history — and the redo branch — alone.
  // Returns whether anything changed.
  function apply(update: Edit<S>): boolean {
    if (state.previewing !== null) set({ previewing: null })
    const h = state.history
    const next = update(h.present)

    if (next === null || next === h.present || JSON.stringify(next) === JSON.stringify(h.present)) return false
    commit({ past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] })

    return true
  }

  function undo() {
    const h = state.history
    const previous = h.past.at(-1)

    if (previous) commit({ past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] })
  }

  function redo() {
    const h = state.history
    const [next, ...future] = h.future

    if (next) commit({ past: [...h.past, h.present], present: next, future })
  }

  function choose(next: readonly EditorSelection<S>[]) {
    set({ chosen: next })
  }

  // Selects what a target points at. `additive` toggles it in the selection (shift/⌘-click); otherwise it
  // replaces the selection. null clears it.
  function select(target: PlanTarget<S> | EditorSelection<S> | null, additive?: boolean) {
    const item = target === null ? null : selectionOf(present(), target, working().picked.selection)

    if (!additive) {
      choose(item ? [item] : [])

      return
    }

    if (!item) return
    const current = state.chosen
    choose(
      current.some((other) => sameSelection(other, item))
        ? current.filter((other) => !sameSelection(other, item))
        : [...current, item],
    )
  }

  // The selection of these walls, but the frozen and hidden ones.
  function wallsOf(ids: readonly string[]): EditorSelection<S>[] {
    return ids.flatMap((id) => (config.unpickable.has(id) ? [] : [{ kind: 'wall' as const, id }]))
  }

  // Selects every object — grouped ones as their group — and every wall, but what is frozen or hidden.
  function selectAll() {
    const current = present()
    choose([...unitsOf(current.objects.filter(pickable)), ...wallsOf(current.walls.map((w) => w.id))])
  }

  // Whether an object can be picked on the plan — neither it nor its group frozen or hidden.
  function pickable(object: PlanObject<S>): boolean {
    const { unpickable } = config

    return !unpickable.has(object.id) && (object.group === undefined || !unpickable.has(object.group))
  }

  // A target on the plan, or null when it points at something that cannot be picked there.
  function pickableTarget<T extends PlanTarget<S>>(target: T | null): T | null {
    if (target?.kind === 'wall') return config.unpickable.has(target.id) ? null : target

    if (target === null || (target.kind !== 'place' && target.kind !== 'object')) return target
    const object = seatPlan.objectById(present(), target.id)

    return object && !pickable(object) ? null : target
  }

  // Selects exactly these items — what a layers panel or a list of problems points at, where a tap would pick a
  // grouped object's group first. An object whose group is among them is left to the group.
  function setSelection(items: readonly EditorSelection<S>[]) {
    const current = present()
    const groups = new Set(items.flatMap((item) => (item.kind === 'group' ? [item.id] : [])))
    const seen = new Set<string>()
    choose(
      items.filter((item) => {
        if (seen.has(keyOf(item))) return false
        seen.add(keyOf(item))
        const group = item.kind === 'object' ? seatPlan.objectById(current, item.id)?.group : undefined

        return group === undefined || !groups.has(group)
      }),
    )
  }

  // Selects exactly these object, group and wall ids — what a list of problems or a search points at.
  function selectIds(ids: readonly string[]) {
    const current = present()
    setSelection(
      ids.flatMap((id): EditorSelection<S>[] =>
        seatPlan.groupById(current, id)
          ? [{ kind: 'group', id }]
          : seatPlan.objectById(current, id)
            ? [{ kind: 'object', id }]
            : seatPlan.wallOf(current, id)
              ? [{ kind: 'wall', id }]
              : [],
      ),
    )
  }

  // Selects the members of the selected groups, the rest staying selected (Enter). false when no group is selected.
  function selectMembers(): boolean {
    const { selection } = working().picked

    if (!selection.some((item) => item.kind === 'group')) return false
    const current = present()
    setSelection(
      selection.flatMap((item) =>
        item.kind === 'group'
          ? seatPlan.membersOf(current, item.id).map((o) => ({ kind: 'object' as const, id: o.id }))
          : [item],
      ),
    )

    return true
  }

  // Selects the groups of the selected objects, the rest staying selected (⇧Enter). false when no selected object
  // is in a group.
  function selectGroups(): boolean {
    const { selection } = working().picked
    const current = present()

    const groupOf = (item: EditorSelection<S>) =>
      item.kind === 'object' ? seatPlan.objectById(current, item.id)?.group : undefined

    if (!selection.some((item) => groupOf(item) !== undefined)) return false
    setSelection(
      selection.map((item) => {
        const group = groupOf(item)

        return group === undefined ? item : { kind: 'group' as const, id: group }
      }),
    )

    return true
  }

  // A tap on something frozen or hidden taps the floor; one on a handle leaves the selection as it is.
  function handleTap(target: PlanTarget<S> | null, info: { additive: boolean }) {
    if (target?.kind === 'handle') return
    select(pickableTarget(target), info.additive)
  }

  // A section moves only once it is selected; before that a drag on its floor draws a marquee — as a drag on
  // something frozen does.
  function canDrag(target: PlanTarget<S>): boolean {
    if (target.kind !== 'section') return pickableTarget(target) !== null

    return working().picked.selection.some((item) => item.kind === 'section' && item.id === target.id)
  }

  // Follows a press through its phases — true while its events should be acted on, false once Escape dropped it
  // (until it is let go).
  function pressing(kind: Press['kind'], phase: 'start' | 'move' | 'end'): boolean {
    if (phase === 'start') press = { kind, cancelled: false }
    const current = press

    if (phase === 'end') press = null

    return current === null || !current.cancelled
  }

  // Marquee selection — everything whose shape the rubber band touches, grouped objects as their group, walls by their
  // band. `additive` adds to the selection.
  function handleMarquee(rect: PlanRect, info: { phase: 'start' | 'move' | 'end'; additive: boolean }) {
    if (!pressing('marquee', info.phase)) return

    if (info.phase !== 'end') {
      set({ marquee: rect })

      return
    }

    set({ marquee: null })
    const current = present()
    const inside = new Set(seatPlan.objectsInRect(current, rect))

    const picked = [
      ...unitsOf(current.objects.filter((object) => inside.has(object.id) && pickable(object))),
      ...wallsOf(seatPlan.wallsInRect(current, rect)),
    ]

    if (!info.additive) {
      choose(picked)

      return
    }

    const held = new Set(state.chosen.map(keyOf))
    choose([...state.chosen, ...picked.filter((item) => !held.has(keyOf(item)))])
  }

  function handleDrag(next: PlanDrag<S>) {
    if (!pressing('drag', next.phase)) return

    if (next.phase === 'start' && next.target.kind !== 'handle') {
      const { selection } = working().picked
      const item = selectionOf(present(), next.target, selection)

      // Dragging something outside the selection selects it alone; dragging a selected object moves the group.
      if (item && !covers(present(), selection, item)) choose([item])
    }

    if (next.phase !== 'end') {
      set({ drag: next })

      return
    }

    // What the drag lined up with while it moved — read before it is let go of, and committed with.
    const { context } = working()
    set({ drag: null })
    const before = present()

    if (!apply((current) => dragged(current, next, context).plan)) return

    // A copying drag selects the copies, as a duplicate does.
    if (next.copy && next.target.kind !== 'handle' && next.target.kind !== 'section') {
      choose(addedSelection(before, present()))
    }
  }

  // The step a tool's strokes snap to — a path (a wall) keeps to the walls' step, a tool that places what it makes
  // itself to whole units.
  function stepOf(tool: EditorTool<S> | null): number | undefined {
    if (tool?.snap === false) return 1

    return tool?.draw === 'path' && config.grid !== null ? wallStepOf(config.grid) : undefined
  }

  // A point a tool draws to, lined up by the guides within GUIDE_PX — unless ⌘ or Ctrl is held. A path tool's corner
  // lands on a wall within GUIDE_PX of its band first, so the wall it draws meets that one; its guides are the other
  // walls' corners.
  function guided(point: PlanPoint, pixel: number | undefined, free = false): PlanPoint {
    const { tool } = state

    if (free || tool?.snap === false) return point

    if (tool?.draw === 'path') {
      const onWall = onWalls(present(), point, GUIDE_PX * (pixel ?? 1))

      if (onWall) return onWall
    }

    const { targets } = working().context

    if (targets === null) return point

    return planGuides.snapPoint(point, targets, GUIDE_PX * (pixel ?? 1)).point
  }

  // The pointer over the plan — the tool previews a tap there; otherwise it outlines what a tap would select.
  function handleHover(point: PlanPoint | null, target: PlanTarget<S> | null, info?: { pixel: number }) {
    under = point
    const { tool } = state

    if (tool !== null) {
      const at =
        point === null
          ? null
          : guided(strokeOf(tool.draw, point, point, NO_KEYS, config.grid, stepOf(tool)).end, info?.pixel)

      if (!samePoint(state.pointer, at)) set({ pointer: at })

      return
    }

    const on = pickableTarget(target)

    const item =
      on === null || on.kind === 'handle' || on.kind === 'section'
        ? null
        : selectionOf(present(), on, working().picked.selection)

    const current = state.hovered

    if (current === item || (current && item && sameSelection(current, item))) return
    set({ hovered: item })
  }

  // Where a polygon's or a path's next corner goes for the pointer at `point` — snapped, and with Shift held on a 15°
  // step from the last corner.
  function cornerAt(point: PlanPoint, constrain: boolean): PlanPoint {
    const last = state.corners?.at(-1)

    return last && constrain
      ? strokeOf('line', last, point, { constrain }, config.grid, stepOf(state.tool)).end
      : strokeOf('polygon', point, point, NO_KEYS, config.grid, stepOf(state.tool)).end
  }

  // Makes the polygon or path being drawn — the tool's `create` gets its corners, and whether a path came back to its
  // first one. false when there are too few corners for it.
  function finishShape(closed: boolean): boolean {
    const { tool, corners: placed } = state

    if (tool === null || !isCornered(tool) || placed === null || placed.length < (closed ? 3 : 2)) return false
    set({ corners: null, pointer: null })
    const before = present()
    const shape = { start: placed[0]!, end: placed.at(-1)!, points: placed }
    const next = tool.create(before, tool.draw === 'path' ? { ...shape, closed } : shape)

    if (next !== null && apply(() => next)) {
      choose(addedSelection(before, next))

      if (!tool.keep) set({ tool: null })
    }

    return true
  }

  // Makes the polygon being drawn, or ends the path being drawn where it is (Enter). false when there are too few
  // corners for it yet.
  function closePolygon(): boolean {
    return finishShape(false)
  }

  // A tap of a polygon or path tool — a corner at `at`, or the shape made when it lands on the first corner or the
  // last one again: the tap itself (`tapped`, before snapping moves it a cell away) within CLOSE_PX on screen, or
  // snapped right onto it. A path closes on its first corner and ends open on its last.
  function addCorner(at: PlanPoint, tapped: PlanPoint, pixel: number) {
    const placed = state.corners ?? []

    const near = (corner: PlanPoint | undefined) =>
      corner !== undefined &&
      (samePoint(corner, at) || Math.hypot(corner.x - tapped.x, corner.y - tapped.y) <= CLOSE_PX * pixel)

    if (placed.length >= 3 && near(placed[0])) {
      finishShape(true)

      return
    }

    if (placed.length >= (state.tool?.draw === 'path' ? 2 : 3) && near(placed.at(-1))) {
      finishShape(false)

      return
    }

    if (samePoint(placed.at(-1) ?? null, at)) return
    set({ corners: [...placed, at] })
  }

  // Takes back the last corner of the polygon being drawn (Backspace). false when there is none.
  function removePoint(): boolean {
    const placed = state.corners

    if (placed === null || placed.length === 0) return false
    set({ corners: placed.length > 1 ? placed.slice(0, -1) : null })

    return true
  }

  // Places the next corner of the polygon or path being drawn exactly at `point` — one typed in rather than tapped —
  // making it when that is its first corner (or the last one again). false when no polygon or path tool is active.
  function addPoint(point: PlanPoint): boolean {
    if (state.tool === null || !isCornered(state.tool)) return false
    addCorner(point, point, 0)

    return true
  }

  // A stroke drawn with the tool — previewed while it moves, made when it is let go (a tap makes one too). With a
  // polygon or path tool every stroke places a corner where it is let go, except a drag before the first corner: that
  // draws a rectangle (Shift: a square), made with its four corners (a path closed).
  function handleDraw(raw: PlanStroke, info: DrawInfo) {
    const { tool } = state

    if (tool === null) return

    if (info.phase === 'cancel') {
      press = null
      set({ stroke: null })

      return
    }

    // A tap is a stroke with no `start` — only its end is reported — so a press that started is a drag.
    const rectangle = isCornered(tool) && state.corners === null && (info.phase === 'start' || press?.kind === 'stroke')

    if (!pressing('stroke', info.phase)) return

    if (isCornered(tool) && !rectangle) {
      const corner = cornerAt(raw.end, info.constrain)
      const at = info.constrain ? corner : guided(corner, info.pixel, info.free)

      if (info.phase === 'end') addCorner(at, raw.end, info.pixel ?? 0)
      else set({ pointer: at })

      return
    }

    // Unconstrained ends line up with the guides; a box or line drawn from its centre keeps its start where it is.
    const drawn = strokeOf(rectangle ? 'box' : tool.draw, raw.start, raw.end, info, config.grid, stepOf(tool))
    const unguided = info.constrain || working().context.targets === null || info.free || tool.snap === false

    const shaped = unguided
      ? drawn
      : {
          start: info.fromCenter ? drawn.start : guided(drawn.start, info.pixel),
          end: guided(drawn.end, info.pixel),
        }

    if (info.phase !== 'end') {
      set({ stroke: shaped })

      return
    }

    // The pointer is still where the tap was — no preview of the next one on top of what was just made.
    set({ stroke: null, pointer: null })

    // A rectangle with no width or height is a corner where it was let go, as a tap places one.
    if (rectangle && (shaped.start.x === shaped.end.x || shaped.start.y === shaped.end.y)) {
      addCorner(info.constrain ? shaped.end : guided(shaped.end, info.pixel, info.free), raw.end, info.pixel ?? 0)

      return
    }

    const before = present()
    const next = tool.create(before, rectangle ? rectangleOf(shaped, tool.draw === 'path') : shaped)

    if (next === null || !apply(() => next)) return
    choose(addedSelection(before, next))

    if (!tool.keep) set({ tool: null })
  }

  // Picks a creation tool, or goes back to selecting with null. A stroke or a polygon being drawn is dropped — with
  // another tool its end is ignored when it comes; with none, it never comes (the viewport stops drawing).
  function setTool(next: EditorTool<S> | null) {
    if (press?.kind === 'stroke') press = next === null ? null : { ...press, cancelled: true }
    const point = under

    set({
      corners: null,
      stroke: null,
      tool: next,
      hovered: null,
      pointer:
        next === null || point === null
          ? null
          : strokeOf('point', point, point, NO_KEYS, config.grid, stepOf(next)).end,
    })
  }

  // Drops the press under way (Escape) — a stroke makes nothing, a drag puts back what it moved, a marquee selects
  // nothing; letting go then changes nothing — and the polygon being drawn. false when nothing was under way.
  function cancel(): boolean {
    const pressed = press !== null && !press.cancelled
    const drawing = state.corners !== null

    if (!pressed && !drawing) return false

    if (press !== null && pressed) press = { ...press, cancelled: true }
    set({ corners: null, stroke: null, drag: null, marquee: null })

    return true
  }

  // Runs an operation that adds objects, commits it and selects what it made.
  function added(result: { plan: SeatPlan<S>; ids: string[] } | null, pick: EditorSelection<S>[]): string[] {
    if (!result || result.ids.length === 0) return []
    apply(() => result.plan)
    choose(pick)

    return result.ids
  }

  // The group to add into — an existing id, or a new group made in the same step.
  function withGroup(current: SeatPlan<S>, choice: GroupChoice | undefined): Grouped<S> {
    if (choice === undefined || isGroupId(choice)) return { plan: current, group: choice }
    const made = planEdits.addGroup(current, choice)

    return { plan: made.plan, group: made.id, made: made.id }
  }

  // Places on the given boxes (see `layout`) — selected afterwards, as their new group when one was made.
  function addPlaces(
    section: S,
    boxes: readonly PlanBox[],
    choices: { shape?: Shape; capacity?: number; role?: string; category?: string; group?: GroupChoice } = {},
  ): string[] {
    const { plan: base, group, made } = withGroup(present(), choices.group)
    const result = planEdits.addPlaces(base, section, boxes, { ...choices, group })

    const pick: EditorSelection<S>[] = made
      ? [{ kind: 'group', id: made }]
      : (result?.ids ?? []).map((id) => ({ kind: 'object' as const, id }))

    return added(result, pick)
  }

  // Fixtures on the given boxes, under everything else — selected afterwards like `addPlaces`.
  function addFixtures(
    boxes: readonly PlanBox[],
    choices: { shape?: Shape; role?: string; group?: GroupChoice } = {},
  ): string[] {
    const { plan: base, group, made } = withGroup(present(), choices.group)
    const result = planEdits.addFixtures(base, boxes, { ...choices, group })

    const pick: EditorSelection<S>[] = made
      ? [{ kind: 'group', id: made }]
      : result.ids.map((id) => ({ kind: 'object' as const, id }))

    return added(result, pick)
  }

  // Adds a template centred on `at` (see `planEdits.insertTemplate`) and selects what it made. Returns the new ids.
  function insert(template: PlanTemplate, at: PlanPoint, where: { section?: S } = {}): string[] {
    const before = present()
    const result = planEdits.insertTemplate(before, template, at, where)

    if (!result || !apply(() => result.plan)) return []
    choose(addedSelection(before, result.plan))

    return result.ids
  }

  // Removes objects and groups; returns the ids refused because they hold a locked id.
  function removeObjects(ids: readonly string[]): string[] {
    const { plan: next, refused } = planEdits.remove(present(), ids, config.locked)
    apply(() => next)
    choose(state.chosen.filter((item) => item.kind === 'section' || refused.includes(item.id)))

    return refused
  }

  // Removes the selection in one step — objects, groups, walls, and sections with what stands in them (see
  // `planEdits.removeSection`). Returns the ids refused because they are locked; a section holding one stays whole.
  function removeSelected(): string[] {
    const { movableIds, selectedSectionIds } = working().picked
    const objects = planEdits.remove(present(), movableIds, config.locked)
    const refused = [...objects.refused]

    const next = selectedSectionIds.reduce((current, id) => {
      const section = planEdits.removeSection(current, id, config.locked)
      refused.push(...section.refused)

      return section.plan
    }, objects.plan)

    apply(() => next)

    return refused
  }

  // Changes an id — an object's or a group's. false when it is locked, taken, missing or would not save.
  function renameObject(id: string, nextId: string): boolean {
    const next = planEdits.rename(present(), id, nextId, config.locked)

    if (!next) return false
    apply(() => next)
    choose(state.chosen.map((item) => (item.kind !== 'section' && item.id === id ? { ...item, id: nextId } : item)))

    return true
  }

  // Copies the selection to the editor's clipboard, as a template. null when nothing is selected.
  function copySelected(): PlanTemplate | null {
    const made = planEdits.templateOf(present(), working().picked.selectedIds)

    if (!made) return null
    set({ clipboard: { template: made.template, at: made.at, pastes: 0 } })

    return made.template
  }

  // Copies the selection, then removes it. Returns the ids refused because they are locked — those stay.
  function cutSelected(): string[] {
    const { selectedIds } = working().picked

    if (copySelected() === null) return []

    return removeObjects(selectedIds)
  }

  // Pastes the clipboard centred on `at` — by default under the pointer when it is over the plan, otherwise beside
  // what was copied (a step further each time). Returns the new ids and selects them.
  function paste(at?: PlanPoint): string[] {
    const { clipboard } = state

    if (clipboard === null) return []
    const step = PASTE_STEP * (clipboard.pastes + 1)
    const pointed = under

    const target =
      at ??
      (pointed === null
        ? { x: clipboard.at.x + step, y: clipboard.at.y + step }
        : strokeOf('point', pointed, pointed, NO_KEYS, config.grid).end)

    const ids = insert(clipboard.template, target)

    if (ids.length > 0 && at === undefined && pointed === null) {
      set({ clipboard: { ...clipboard, pastes: clipboard.pastes + 1 } })
    }

    return ids
  }

  // Copies the selection next to itself and selects the copies. Duplicating the copies again repeats where they went:
  // duplicate, move the copy, duplicate again — and the next copy lands as far on.
  function duplicateSelected(): string[] {
    const { movableIds } = working().picked
    const current = present()
    const here = centerOfIds(current, movableIds)
    const last = duplicated
    const again = last !== null && here !== null && sameIds(last.ids, movableIds)
    const offset = again ? { x: here.x - last.from.x, y: here.y - last.from.y } : undefined
    const result = planEdits.duplicate(current, movableIds, offset)

    if (result.ids.length === 0) return []
    apply(() => result.plan)
    choose(
      result.ids.map((id) =>
        seatPlan.groupById(result.plan, id)
          ? { kind: 'group' as const, id }
          : seatPlan.wallOf(result.plan, id)
            ? { kind: 'wall' as const, id }
            : { kind: 'object' as const, id },
      ),
    )
    duplicated = here === null ? null : { from: here, ids: result.ids }

    return result.ids
  }

  // Puts the selection in a new group and selects it.
  function groupSelected(props: Omit<Group, 'id'> = {}): string | null {
    const result = planEdits.group(present(), working().picked.selectedIds, props)

    if (!result) return null
    apply(() => result.plan)
    choose([{ kind: 'group', id: result.id }])

    return result.id
  }

  function ungroup(id: string) {
    const members = seatPlan.membersOf(present(), id).filter((o) => o.kind !== 'label')
    apply((current) => planEdits.ungroup(current, id))
    choose(members.map((o) => ({ kind: 'object' as const, id: o.id })))
  }

  // Dissolves every selected group in one step; their members take their place in the selection.
  function ungroupSelected() {
    const { selection } = working().picked
    const groups = selection.flatMap((item) => (item.kind === 'group' ? [item.id] : []))

    if (groups.length === 0) return
    const current = present()
    const members = groups.flatMap((id) => seatPlan.membersOf(current, id).filter((o) => o.kind !== 'label'))
    apply((plan) => groups.reduce((next, id) => planEdits.ungroup(next, id), plan))
    choose([
      ...selection.filter((item) => item.kind !== 'group'),
      ...members.map((o) => ({ kind: 'object' as const, id: o.id })),
    ])
  }

  // Back to the plan as opened, or as last saved — without history.
  function reset() {
    commit({ past: [], present: saved.plan, future: [] })
    choose([])
  }

  // Makes `stored` — the plan you stored, by default the one being edited — the baseline `dirty` compares against and
  // `reset` goes back to. History and selection stay; edits made while a save was under way stay dirty.
  function markSaved(stored?: SeatPlan<S>) {
    const h = state.history
    const plan = stored ?? h.present
    saved = { plan, json: JSON.stringify(plan) }
    commit({ past: h.past, present: h.present, future: h.future })
  }

  // Moves the selection — objects, groups, walls, and sections with what stands in them — by `delta`, snapped like
  // a drag. What a selected section carries moves once, with it.
  function moveSelected(delta: PlanPoint): boolean {
    const { movableIds, selectedSectionIds } = working().picked

    return apply((current) => {
      const carried = new Set(selectedSectionIds.flatMap((id) => sectionContents(current, id)))

      const own = movableIds.filter(
        (id) => !carried.has(id) && !carried.has(seatPlan.objectById(current, id)?.group ?? ''),
      )

      return planEdits.move(moveSections(current, selectedSectionIds, delta, config.grid), own, delta, config.grid)
    })
  }

  // Adds a section and selects it. false when its id is taken or it has fewer than three corners.
  function addSection(section: Section<S>): boolean {
    if (!apply((current) => planEdits.addSection(current, section))) return false
    choose([{ kind: 'section', id: section.id }])

    return true
  }

  // Adds a wall (see `planEdits.addWall`) and selects it. Returns its id, or null when it has too few points.
  function addWall(wall: Omit<Wall, 'id'>): string | null {
    const result = planEdits.addWall(present(), wall)

    if (!result || !apply(() => result.plan)) return null
    choose([{ kind: 'wall', id: result.ids[0]! }])

    return result.ids[0]!
  }

  function removeSection(id: S): string[] {
    const { plan: next, refused } = planEdits.removeSection(present(), id, config.locked)
    apply(() => next)

    return refused
  }

  // A command as the editor hands it out: run as one change, however many steps it takes.
  function command<A extends readonly unknown[], R>(step: (...args: A) => R): (...args: A) => R {
    return (...args) => run(() => step(...args))
  }

  const selectedIds = () => working().picked.selectedIds

  const commands = {
    select: command(select),
    selectAll: command(selectAll),
    setSelection: command(setSelection),
    selectIds: command(selectIds),
    selectMembers: command(selectMembers),
    selectGroups: command(selectGroups),
    undo: command(undo),
    redo: command(redo),
    reset: command(reset),
    markSaved: command(markSaved),

    // Creation tools — pick one with `setTool`; presses on the plan then draw with it (see `EditorTool`).
    setTool: command(setTool),
    // Drops the stroke, drag or marquee under way, and the polygon being drawn (Escape); false when there is none.
    cancel: command(cancel),
    // A polygon or path tool's corners — Enter makes it (`closePolygon`; a path stays open), Backspace takes one back
    // (`removePoint`), `addPoint` places one exactly where you say.
    closePolygon: command(closePolygon),
    removePoint: command(removePoint),
    addPoint: command(addPoint),

    // Creating — each returns the new ids and selects what it made (an empty list when nothing could be added).
    addPlaces: command(addPlaces),
    addFixtures: command(addFixtures),
    addLabels: command((groupId: string, boxes: readonly PlanBox[]) =>
      added(planEdits.addLabels(present(), groupId, boxes), [{ kind: 'group', id: groupId }]),
    ),
    insert: command(insert),
    duplicateSelected: command(duplicateSelected),
    groupSelected: command(groupSelected),

    copySelected: command(copySelected),
    cutSelected: command(cutSelected),
    paste: command(paste),

    // Changing.
    // Any plan → plan change as one undo step — compose `planEdits` and `layout` into a single edit (a row with
    // its labels, a table with its chairs). false when it changed nothing or returned null.
    edit: command((update: Edit<S>) => apply(update)),
    // Shows an edit without committing it — while a slider is dragged or a value typed. It is applied to the plan as
    // it is (undo and edits made meanwhile show through) and ends with the next edit, or `preview(null)`; `edit` the
    // final value when the slider is let go. `displayPlan`, `conflictIds` and the outlines show it.
    preview: command((update: Edit<S> | null) => set({ previewing: update })),
    updateObject: command((id: string, update: (object: PlanObject<S>) => PlanObject<S>) =>
      apply((current) => ({ ...current, objects: current.objects.map((o) => (o.id === id ? update(o) : o)) })),
    ),
    updateGroup: command((id: string, update: (group: Group) => Group) =>
      apply((current) => ({ ...current, groups: current.groups.map((g) => (g.id === id ? update(g) : g)) })),
    ),
    // Lays a group's places (or fixtures of a role) out on new boxes — how a row grows, shrinks or bends. false
    // when a member to remove is locked.
    layoutGroup: command((groupId: string, boxes: readonly PlanBox[], members?: GroupMembers) =>
      apply((current) => planEdits.layoutGroup(current, groupId, boxes, members, config.locked)),
    ),
    arrange: command((ids: readonly string[], boxes: readonly PlanBox[]) =>
      apply((current) => planEdits.arrange(current, ids, boxes)),
    ),
    convert: command(
      (ids: readonly string[], to: 'place' | 'fixture', as?: { section?: S; capacity?: number; role?: string }) =>
        apply((current) => planEdits.convert(current, ids, to, as, config.locked)),
    ),
    ungroup: command(ungroup),
    ungroupSelected: command(ungroupSelected),
    label: command((ids: readonly string[], sequence: LabelSequence) =>
      apply((current) => planEdits.label(current, ids, sequence)),
    ),
    // Sets shape, capacity, role, category or tags on objects and groups' members in one step (undefined clears an
    // optional one). false when it changed nothing or a value would not save (see `planEdits.assign`).
    assign: command((ids: readonly string[], props: ObjectProps) =>
      apply((current) => planEdits.assign(current, ids, props)),
    ),
    assignSelected: command((props: ObjectProps) => {
      const ids = selectedIds()

      return apply((current) => planEdits.assign(current, ids, props))
    }),
    alignSelected: command((edge: AlignEdge) => {
      const ids = selectedIds()

      return apply((current) => planEdits.align(current, ids, edge))
    }),
    distributeSelected: command((axis: 'x' | 'y') => {
      const ids = selectedIds()

      return apply((current) => planEdits.distribute(current, ids, axis))
    }),
    rotateSelected: command((degrees: number) => {
      const ids = selectedIds()

      return apply((current) => planEdits.rotate(current, ids, degrees))
    }),
    // Moves the selection in the drawing order — to the front or back, or a step forward or backward.
    reorderSelected: command((to: Reorder) => {
      const ids = selectedIds()

      return apply((current) => planEdits.reorder(current, ids, to))
    }),
    moveSelected: command(moveSelected),
    moveSection: command((id: S, delta: PlanPoint) =>
      apply((current) => planEdits.moveSection(current, id, delta, config.grid)),
    ),
    addSection: command(addSection),
    reshapeSection: command((id: S, points: PlanPoint[]) =>
      apply((current) => planEdits.reshapeSection(current, id, points, config.grid)),
    ),
    addWall: command(addWall),
    // Changes a wall — its thickness, whether it is closed, its openings. Its id stays.
    updateWall: command((id: string, update: (wall: Wall) => Wall) =>
      apply((current) => ({
        ...current,
        walls: current.walls.map((w) => (w.id === id ? { ...update(w), id } : w)),
      })),
    ),
    reshapeWall: command((id: string, points: PlanPoint[]) =>
      apply((current) => planEdits.reshapeWall(current, id, points, config.grid)),
    ),
    // Puts an opening in a wall (`seatPlan.openingAt` finds where one goes). false when it does not fit there.
    addOpening: command((wallId: string, opening: WallOpening) =>
      apply((current) => planEdits.addOpening(current, wallId, opening)),
    ),
    removeOpening: command((wallId: string, index: number) =>
      apply((current) => planEdits.removeOpening(current, wallId, index)),
    ),
    renameObject: command(renameObject),

    // Removing — returns the ids refused because they are locked.
    removeObjects: command(removeObjects),
    removeSelected: command(removeSelected),
    removeSection: command(removeSection),
  }

  return {
    // What the editor hands out to draw with, as it stands — the same object until something changes.
    getState: view,
    // The same for the plan as opened: what a server render shows.
    getInitialState: () => initialView,
    // Calls `listener` after every command that changed something. Returns the way to stop.
    subscribe(listener: () => void): () => void {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    // Takes the options as they are now (`lockedIds`, `snap`, `frozenIds`, `hiddenIds`, `handles`, `guides`) — the
    // hook hands them over after every render. Options that say what they said change nothing.
    configure(next: Omit<SeatPlanEditorOptions<S>, 'initialPlan'>) {
      const taken = configOf(next, config)

      if (taken === config) return
      config = taken
      changed = true
      flush()
    },
    commands,
  }
}
