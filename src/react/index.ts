import { Viewport } from './client/viewport'
import { Content } from './content'
import { EditorOverlay } from './overlay'
import {
  FixturePart,
  GridPart,
  HandlesPart,
  LabelPart,
  MarqueePart,
  OutlinePart,
  PlacePart,
  Root,
  RoomPart,
  SectionPart,
  WallPart,
} from './parts'

// Headless seat map components. Every part but `Viewport` renders as a React Server Component.
export const SeatMap = {
  Root,
  Viewport,
  Content,
  Section: SectionPart,
  Room: RoomPart,
  Wall: WallPart,
  Place: PlacePart,
  Fixture: FixturePart,
  Label: LabelPart,
  Grid: GridPart,
  Handles: HandlesPart,
  Outline: OutlinePart,
  Marquee: MarqueePart,
  EditorOverlay,
}

export { useSeatMapView, type SeatMapView } from './client/use-seat-map-view'
export type { PlaceProps } from './parts'
export type { EditorOverlayProps } from './overlay'
export type { ViewportFrame } from './client/viewport'
