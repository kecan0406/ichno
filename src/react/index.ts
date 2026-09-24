import { Viewport } from './client/viewport'
import { Content } from './content'
import { FixturePart, GridPart, PlacePart, Root, SectionPart, TablePart } from './parts'

// Headless seat map components. Every part but `Viewport` renders as a React Server Component.
export const SeatMap = {
  Root,
  Viewport,
  Content,
  Section: SectionPart,
  Place: PlacePart,
  Fixture: FixturePart,
  Table: TablePart,
  Grid: GridPart,
}

export type { PlaceProps } from './parts'
