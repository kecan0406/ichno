import { Viewport } from './client/viewport'
import { Content } from './content'
import { FixturePart, GridPart, HandlesPart, LabelPart, MarqueePart, PlacePart, Root, SectionPart } from './parts'

// Headless seat map components. Every part but `Viewport` renders as a React Server Component.
export const SeatMap = {
  Root,
  Viewport,
  Content,
  Section: SectionPart,
  Place: PlacePart,
  Fixture: FixturePart,
  Label: LabelPart,
  Grid: GridPart,
  Handles: HandlesPart,
  Marquee: MarqueePart,
}

export type { PlaceProps } from './parts'
export type { ViewportFrame } from './client/viewport'
