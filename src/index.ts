export {
  OBJECT_KINDS,
  SHAPES,
  type Category,
  type Fixture,
  type Group,
  type GroupLabel,
  type HandleOwner,
  type ObjectKind,
  type Place,
  type PlanBox,
  type PlanDrag,
  type PlanGuide,
  type PlanHandle,
  type PlanObject,
  type PlanPoint,
  type PlanRect,
  type PlanSize,
  type PlanStroke,
  type PlanTarget,
  type PlanTemplate,
  type Room,
  type SeatPlan,
  type Section,
  type SectionPlan,
  type Shape,
  type TemplateObject,
  type Wall,
  type WallOpening,
} from './core/types'

export type { OpeningShape, WallEdge } from './core/walls'

export { upgradeSeatPlan, type PlanObjectV2, type SeatPlanV1, type SeatPlanV2 } from './core/legacy'

export { GRID_CELL } from './core/grid'

export {
  INNER_WALL_THICKNESS,
  OBJECT_ID_MAX,
  OVERLAP_TOLERANCE,
  PLACE_ID_MAX,
  SECTION_LABEL_BAND,
  SECTION_LABEL_FONT,
  WALL_THICKNESS,
  seatPlan,
} from './core/geometry'

export { TABLE_SEAT_GAP, layout } from './core/layout'

export {
  DEFAULT_LINT_SEVERITY,
  issueIdsOf,
  lintSeatPlan,
  type LintCode,
  type LintIssue,
  type LintResult,
  type LintSeverity,
} from './core/lint'

export { labeling, type LabelSequence } from './core/labeling'

export { validateSelection, type SelectionIssue, type SelectionRules } from './core/selection'

export { ZOOM_STEP, planView, type PlanView, type ViewportSize } from './core/view'

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
