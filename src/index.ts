export {
  AREA_SHAPES,
  OBJECT_KINDS,
  SEAT_CHAIR_SIDES,
  TABLE_SHAPES,
  type Area,
  type AreaShape,
  type Booth,
  type Category,
  type Desk,
  type Fixture,
  type ObjectKind,
  type Place,
  type PlaceKind,
  type PlanObject,
  type PlanPoint,
  type PlanRect,
  type PlanSize,
  type PlanDrag,
  type PlanTarget,
  type Row,
  type RowSeat,
  type SeatChairSide,
  type SeatPlan,
  type Section,
  type SectionPlan,
  type Table,
  type TableSeat,
  type TableShape,
} from './core/types'
export { upgradeSeatPlan, type SeatPlanV1 } from './core/v1'
export { DEFAULT_SEAT_CELLS, GRID_CELL, HALF_CELL, seatGrid } from './core/grid'
export {
  INNER_WALL_THICKNESS,
  MIN_SEAT_SIZE,
  SECTION_LABEL_BAND,
  SECTION_LABEL_FONT,
  TABLE_SEAT_GAP,
  WALL_THICKNESS,
  seatPlan,
} from './core/geometry'
export {
  DEFAULT_LINT_SEVERITY,
  lintSeatPlan,
  type LintCode,
  type LintIssue,
  type LintResult,
  type LintSeverity,
} from './core/lint'
export { labeling, type LabelSequence } from './core/labeling'
export { validateSelection, type SelectionIssue, type SelectionRules } from './core/selection'
export { ZOOM_STEP, planView, type PlanView } from './core/view'
export { spatialIndex, type SpatialIndex, type SpatialItem } from './core/spatial'
export {
  DRAG_THRESHOLD_PX,
  IDLE_GESTURE,
  TOUCH_DRAG_THRESHOLD_PX,
  gesture,
  type GestureEvent,
  type GesturePointer,
  type GestureResult,
  type GestureState,
  type ScreenPoint,
} from './core/gesture'
export { placeNavigation, type NavigationDirection, type NavigationItem } from './core/navigation'
export { themeVars, type ThemeVar } from './theme/vars'
