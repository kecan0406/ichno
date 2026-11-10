// The members of `SeatMap` — `SeatMap.Root`, `SeatMap.Viewport`, … Kept as a module of their own and re-exported as a
// namespace (see ./index.ts), so a bundler drops the members an app never names: a read-only plan made of
// `SeatMap.Root` and `SeatMap.Content` ships without the viewport and the editor's overlay.
export { Viewport } from './client/viewport'

export { Content } from './content'

export { EditorOverlay } from './overlay'

export {
  FixturePart as Fixture,
  GridPart as Grid,
  HandlesPart as Handles,
  LabelPart as Label,
  MarqueePart as Marquee,
  OutlinePart as Outline,
  PlacePart as Place,
  Root,
  RoomPart as Room,
  SectionPart as Section,
  WallPart as Wall,
} from './parts'
