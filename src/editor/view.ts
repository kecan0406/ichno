import { seatPlan } from '../core/geometry'
import type { PlanDrag, PlanHandle, PlanPoint, PlanRect, PlanStroke, PlanTarget, SeatPlan } from '../core/types'
import { planGuides } from './guides'
import { planHandles, type EditorHandles } from './handles'
import { KEY_SEPARATOR, changedKey, idsKey, onlyIds, overlapsOf, overlapsWith, withoutIds } from './moving'
import { planEdits, type Snap } from './operations'
import type { EditorSelection } from './selection'
import {
  NONE,
  NO_GUIDES,
  addedPart,
  cached,
  dragged,
  isCornered,
  movingOf,
  polygonStroke,
  rectangleOf,
  sameSelection,
  selectedOf,
  withoutHidden,
  type DragContext,
  type DrawInfo,
  type Edit,
  type EditorConfig,
  type EditorState,
} from './state'
import type { EditorTool } from './tools'

// What the editor hands out to draw with, worked out from its state and its options. Every piece remembers its last
// answer (`cached`), so what a change does not reach keeps its identity: the still part of the plan stays the same
// object through a drag, the selection's lists through a hover — and whatever draws them is not drawn again.

// What a viewport calls as the plan is pressed — the editor's side of <SeatMap.Viewport>'s props.
export type ViewportHandlers<S extends string> = {
  onTap(target: PlanTarget<S> | null, info: { additive: boolean }): void
  canDrag(target: PlanTarget<S>): boolean
  onTargetDrag(drag: PlanDrag<S>): void
  onMarquee(rect: PlanRect, info: { phase: 'start' | 'move' | 'end'; additive: boolean }): void
  onHover(point: PlanPoint | null, target: PlanTarget<S> | null, info?: { pixel: number }): void
  onDraw(stroke: PlanStroke, info: DrawInfo): void
}

export type EditorView<S extends string> = ReturnType<ReturnType<typeof createView<S>>>['view']

// What the editor's own commands read besides the view — the selection as the operations take it, the plan a drag is
// applied to, and what the drag is worked out against.
export type EditorWorking<S extends string> = ReturnType<ReturnType<typeof createView<S>>>['working']

const NO_FRAMES: PlanPoint[][] = []

const NO_HANDLES: PlanHandle<never>[] = []

const NO_IDS: string[] = []

// One editor's view: call it with the state and the config as they are, and it answers with the same objects for
// whatever did not change since the last call.
export function createView<S extends string>(handlers: ViewportHandlers<S>) {
  const selected = cached((plan: SeatPlan<S>, chosen: readonly EditorSelection<S>[]) => selectedOf(plan, chosen))

  // What the selection covers — objects by their turned bounds, walls by their band's, sections by their outline's
  // box.
  const boundsOf = cached((plan: SeatPlan<S>, picked: ReturnType<typeof selected>): PlanRect[] => [
    ...picked.selectedObjects.map(seatPlan.boundsOf),
    ...picked.selectedWallIds.flatMap((id) => {
      const wall = seatPlan.wallOf(plan, id)

      return wall ? [seatPlan.wallBoundsOf(wall)] : []
    }),
    ...picked.selectedSectionIds.flatMap((id) => {
      const section = seatPlan.sectionOf(plan, id)

      return section ? [seatPlan.sectionBoundsOf(section)] : []
    }),
  ])

  // The plan with the edit being previewed.
  const shownOf = cached((plan: SeatPlan<S>, previewing: Edit<S> | null) =>
    previewing === null ? plan : (previewing(plan) ?? plan),
  )

  // A plan without what is hidden — one memory for each plan it is asked of.
  const visibly = () =>
    cached((plan: SeatPlan<S>, hidden: ReadonlySet<string>) => (hidden.size === 0 ? plan : withoutHidden(plan, hidden)))

  const guideSourceOf = visibly()
  const displayOf = visibly()
  const stillShownOf = visibly()
  const movingShownOf = visibly()

  // What a drag, a corner or a tool's stroke lines up with — every unit, section and wall in sight but what the press
  // moves; for a wall being drawn, the corners of the other walls alone, so walls stay on the grid rather than lining
  // up with furniture or another wall's faces. Gathered once a drag starts or a tool is picked, not on every move.
  const targetsOf = cached(
    (
      active: boolean,
      path: boolean,
      source: SeatPlan<S>,
      shown: SeatPlan<S>,
      target: PlanTarget<S> | null,
      picked: ReturnType<typeof selected>,
    ) => {
      if (!active) return null

      return path
        ? planGuides.wallTargetsOf(source, NONE)
        : planGuides.targetsOf(source, movingOf(shown, target, picked))
    },
  )

  const contextOf = cached(
    (
      targets: readonly PlanRect[] | null,
      grid: Snap | null,
      handleSets: readonly EditorHandles<S>[],
      picked: ReturnType<typeof selected>,
    ): DragContext<S> => ({
      targets,
      grid,
      handleSets,
      selectedIds: picked.selectedIds,
      selectedWallIds: picked.selectedWallIds,
      movableIds: picked.movableIds,
    }),
  )

  const draggedOf = cached((shown: SeatPlan<S>, drag: PlanDrag<S> | null, context: DragContext<S>) =>
    drag === null ? null : dragged(shown, drag, context),
  )

  const changedOf = cached((plan: SeatPlan<S>, moved: SeatPlan<S>) => changedKey(plan, moved))

  // The plan without the objects that move (keyed by their ids), and its places' overlaps with an index to check the
  // moving ones against. Nulls while nothing moves, or when sections do (`key` null).
  const stillOf = cached((plan: SeatPlan<S>, key: string | null) => {
    const part = key ? withoutIds(plan, key) : null

    return { part, overlaps: part === null ? null : overlapsOf(part) }
  })

  const movingOnly = cached((moved: SeatPlan<S>, key: string | null) => (key ? onlyIds(moved, key) : null))

  // What the tool would make a thing of — while a stroke is drawn, or for a tap under the pointer. A polygon or path
  // tool's stroke is a rectangle while one is dragged out.
  const toolStrokeOf = cached(
    (
      tool: EditorTool<S> | null,
      stroke: PlanStroke | null,
      corners: PlanPoint[] | null,
      pointer: PlanPoint | null,
    ): PlanStroke | null => {
      if (tool === null) return null

      if (isCornered(tool)) return stroke === null ? polygonStroke(corners, pointer) : rectangleOf(stroke)

      return stroke ?? (pointer === null ? null : { start: pointer, end: pointer })
    },
  )

  // The stroke as drawn over the plan — a dragged rectangle closed.
  const drawnStrokeOf = cached(
    (tool: EditorTool<S> | null, stroke: PlanStroke | null, toolStroke: PlanStroke | null): PlanStroke | null => {
      if (tool === null || !isCornered(tool)) return stroke

      return toolStroke && stroke !== null
        ? { ...toolStroke, points: [...(toolStroke.points ?? []), toolStroke.start] }
        : toolStroke
    },
  )

  const createdOf = cached((tool: EditorTool<S> | null, toolStroke: PlanStroke | null, plan: SeatPlan<S>) =>
    tool === null || toolStroke === null ? null : tool.create(plan, toolStroke),
  )

  // Only the new objects (and the groups they belong to), as a plan without sections.
  const draftOf = cached((plan: SeatPlan<S>, created: SeatPlan<S> | null) =>
    created === null ? null : addedPart(plan, created),
  )

  // The guides through where a tool would draw — what the pointer or the stroke's end lines up with.
  const strokeGuidesOf = cached((targets: readonly PlanRect[] | null, end: PlanPoint | null) =>
    targets !== null && end !== null ? planGuides.snapPoint(end, targets, 0).guides : NO_GUIDES,
  )

  // Places that overlap on the plan as drawn, the draft included, as one key. While objects move, the still ones'
  // overlaps are found once and only the moving ones are checked each frame.
  const conflictKeyOf = cached(
    (
      created: SeatPlan<S> | null,
      still: ReturnType<typeof stillOf>,
      movingPart: SeatPlan<S> | null,
      moved: SeatPlan<S>,
    ) => {
      if (created !== null) return idsKey(seatPlan.conflictsOf(created).flat())

      if (still.overlaps === null || movingPart === null) return idsKey(seatPlan.conflictsOf(moved).flat())

      return idsKey([...still.overlaps.ids, ...overlapsWith(movingPart, still.overlaps)])
    },
  )

  // Ids from a key as a list that keeps its identity while the key says the same.
  const idsOf = cached((key: string) => (key === '' ? NO_IDS : key.split(KEY_SEPARATOR)))

  // While the selection's knob turns several items, the box and the knob turn with the pointer rather than being
  // drawn round what they turned.
  const turningOf = cached(
    (shown: SeatPlan<S>, selection: readonly EditorSelection<S>[], drag: PlanDrag<S> | null, grid: Snap | null) =>
      drag !== null && drag.target.kind === 'handle' && drag.target.owner.kind === 'selection'
        ? planHandles.selectionTurn(shown, selection, drag.total, grid !== null || drag.constrain === true)
        : null,
  )

  // Handles for a single selected item (or the knob for several), placed on the plan as drawn so they follow a
  // drag. None while a tool is active — every press draws then.
  const handlesOf = cached(
    (
      drawing: boolean,
      on: SeatPlan<S>,
      display: SeatPlan<S>,
      selection: readonly EditorSelection<S>[],
      turning: number | null,
      handleSets: readonly EditorHandles<S>[],
    ): PlanHandle<S>[] =>
      drawing
        ? NO_HANDLES
        : [...planHandles.of(on, selection, turning ?? 0), ...ownHandlesOf(handleSets, display, selection)],
  )

  // The outline those handles belong to (the box around several items).
  const frameOf = cached(
    (drawing: boolean, on: SeatPlan<S>, selection: readonly EditorSelection<S>[], turning: number | null) =>
      drawing ? null : planHandles.frame(on, selection, turning ?? 0),
  )

  // The outline of every selected object and group.
  const framesOf = cached((display: SeatPlan<S>, selection: readonly EditorSelection<S>[]) =>
    planHandles.frames(display, selection),
  )

  // The outline of what a tap would select under the pointer — none while dragging, drawing, or over the selection.
  const hoverFrameOf = cached(
    (
      idle: boolean,
      hovered: EditorSelection<S> | null,
      selection: readonly EditorSelection<S>[],
      display: SeatPlan<S>,
    ) =>
      idle && hovered !== null && !selection.some((item) => sameSelection(item, hovered))
        ? planHandles.frame(display, [hovered])
        : null,
  )

  const lockedOf = cached(
    (plan: SeatPlan<S>, locked: ReadonlySet<string>) => (id: string) => planEdits.isLocked(plan, id, locked),
  )

  // Spread into <SeatMap.Viewport> (ichno/react).
  const viewportPropsOf = cached((display: SeatPlan<S>, drawing: boolean, navigable: boolean) => ({
    plan: display,
    onTap: handlers.onTap,
    canDrag: handlers.canDrag,
    onTargetDrag: handlers.onTargetDrag,
    onMarquee: handlers.onMarquee,
    onHover: handlers.onHover,
    onDraw: drawing ? handlers.onDraw : undefined,
    // With something selected the arrow keys move it (useSeatPlanEditorShortcuts); otherwise they move the focus.
    navigable,
  }))

  // Spread into <SeatMap.EditorOverlay> (ichno/react), drawn over the plan: the outlines of a selection of several
  // items (a single one shows its frame with the handles), what a tap would select, the handles, the marquee, and
  // the stroke a tool is drawing.
  const overlayPropsOf = cached(
    (
      frames: PlanPoint[][],
      hoverFrame: PlanPoint[] | null,
      handles: PlanHandle<S>[],
      frame: PlanPoint[] | null,
      marquee: PlanRect | null,
      stroke: PlanStroke | null,
      draw: EditorTool<S>['draw'] | undefined,
      guides: ReturnType<typeof strokeGuidesOf>,
    ) => ({ frames, hoverFrame, handles, frame, marquee, stroke, draw, guides }),
  )

  return cached((state: EditorState<S>, config: EditorConfig<S>) => {
    const { history, chosen, drag, tool, stroke, pointer, corners, hovered, previewing, marquee } = state
    const { grid, hidden, handleSets } = config
    const plan = history.present
    const picked = selected(plan, chosen)
    const { selection, selectedIds, selectedSectionIds, selectedWallIds } = picked

    // The plan as drawn — the edit being previewed, the drag in progress with the snapping it will commit with, and
    // without what is hidden.
    const shown = shownOf(plan, previewing)

    const targets = targetsOf(
      config.guides && (drag !== null || tool !== null),
      tool?.draw === 'path',
      guideSourceOf(shown, hidden),
      shown,
      drag?.target ?? null,
      picked,
    )

    const context = contextOf(targets, grid, handleSets, picked)
    const dragResult = draggedOf(shown, drag, context)
    const moved = dragResult?.plan ?? shown
    const displayPlan = displayOf(moved, hidden)

    // What a drag or a preview changes, apart from what it leaves alone: `stillPlan` is the plan without the objects
    // it changes and `movingPlan` only them, without sections (null while nothing moves). The still part is keyed by
    // the ids that move, so it keeps its identity for the whole drag and a memoized layer drawing it
    // (`SeatMap.Content`) draws it once per drag, not per frame. A drag that moves a section, or more than half the
    // objects, is drawn as one: `stillPlan` is then `displayPlan` — two layers would hand everything from one to the
    // other on letting go.
    const changed = changedOf(plan, moved)
    const movingKey = changed && changed.split(KEY_SEPARATOR).length * 2 > plan.objects.length ? null : changed
    const still = stillOf(plan, movingKey)
    const stillPlan = stillShownOf(still.part ?? moved, hidden)
    const movingPart = movingOnly(moved, movingKey)
    const movingPlan = movingPart === null ? null : movingShownOf(movingPart, hidden)

    const toolStroke = toolStrokeOf(tool, stroke, corners, pointer)
    const drawnStroke = drawnStrokeOf(tool, stroke, toolStroke)
    const created = createdOf(tool, toolStroke, plan)
    const strokeGuides = strokeGuidesOf(targets, tool === null ? null : (toolStroke?.end ?? null))
    const conflictIds = idsOf(conflictKeyOf(created, still, movingPart, moved))

    const turning = turningOf(shown, selection, drag, grid)
    const on = turning === null ? displayPlan : shown
    const handles = handlesOf(tool !== null, on, displayPlan, selection, turning, handleSets)
    const frame = frameOf(tool !== null, on, selection, turning)
    const frames = framesOf(displayPlan, selection)
    const hoverFrame = hoverFrameOf(tool === null && drag === null, hovered, selection, displayPlan)

    const view = {
      plan,
      displayPlan,
      stillPlan,
      movingPlan,
      dirty: history.dirty,
      selection,
      selectedIds,
      selectedObjects: picked.selectedObjects,
      selectedGroups: picked.selectedGroups,
      selectedSection:
        selectedSectionIds[0] === undefined ? undefined : seatPlan.sectionOf(plan, selectedSectionIds[0]),
      // The selected walls' ids, and the first of them.
      selectedWallIds,
      selectedWall: selectedWallIds[0] === undefined ? undefined : seatPlan.wallOf(plan, selectedWallIds[0]),
      selectedPlaceIds: picked.selectedPlaceIds,
      // What the selection covers. Frame it with a view's zoomTo (useSeatMapView, ichno/react).
      selectionBounds: boundsOf(plan, picked),
      handles,
      // The outline those handles belong to — pass it to <SeatMap.Handles frame>.
      frame,
      // The outline of every selected object and group — draw them (<SeatMap.Outline>) when more than one item is
      // selected, so fixtures and groups show they are in the selection too.
      frames,
      hoverFrame,
      // The rubber band being dragged, in plan units — draw it with <SeatMap.Marquee>.
      marquee,
      // Places that overlap on the plan as drawn, the draft included. The schema refuses to save them; pass them to
      // <SeatMap.Content invalid> to mark them while arranging.
      conflictIds,
      snap: grid,
      isLocked: lockedOf(plan, config.locked),
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,

      // The creation tool in use (see `EditorTool`) — null while selecting.
      tool,
      // The stroke being drawn, snapped and constrained — draw it as a guide if you like; a polygon's corners with the
      // pointer, or the rectangle being dragged out (closed). null between strokes.
      stroke: drawnStroke,
      // What the tool would make — draw it over the plan, e.g. half transparent. null when it would make nothing.
      draft: draftOf(plan, created),
      // Where a tap would draw while a tool is active, or null when the pointer is off the plan. With `draft` null
      // it says the tool can make nothing there — tell people why.
      pointer,
      // A polygon or path tool's corners so far.
      corners,
      // The clipboard — a template of what was copied (save it to a library of objects if you like), or null.
      clipboard: state.clipboard === null ? null : state.clipboard.template,

      viewportProps: viewportPropsOf(displayPlan, tool !== null, selection.length === 0 && tool === null),
      overlayProps: overlayPropsOf(
        selection.length > 1 ? frames : NO_FRAMES,
        hoverFrame,
        handles,
        frame,
        marquee,
        drawnStroke,
        tool?.draw,
        dragResult?.guides ?? strokeGuides,
      ),
    }

    return { view, working: { picked, shown, context } }
  })
}

// Your handles for the one selected item, named `<set>:<name>`.
function ownHandlesOf<S extends string>(
  handleSets: readonly EditorHandles<S>[],
  current: SeatPlan<S>,
  items: readonly EditorSelection<S>[],
): PlanHandle<S>[] {
  const [item] = items

  if (items.length !== 1 || item === undefined) return []

  return handleSets.flatMap((set) =>
    set.of(current, item).map((handle) => ({ ...handle, owner: item, name: `${set.id}:${handle.name}` })),
  )
}
