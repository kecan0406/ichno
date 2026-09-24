import { Viewport } from './client/viewport'
import { Content } from './content'
import {
  FixturePart,
  GridPart,
  HandlesPart,
  MarqueePart,
  PlacePart,
  Root,
  RowLabelPart,
  SectionPart,
  TablePart,
} from './parts'

// Headless seat map components. Every part but `Viewport` renders as a React Server Component.
export const SeatMap = {
  Root,
  Viewport,
  Content,
  Section: SectionPart,
  Place: PlacePart,
  Fixture: FixturePart,
  Table: TablePart,
  RowLabel: RowLabelPart,
  Grid: GridPart,
  Handles: HandlesPart,
  Marquee: MarqueePart,
}

export type { PlaceProps } from './parts'
export type { ViewportFrame } from './client/viewport'
