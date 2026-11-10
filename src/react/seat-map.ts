// The members of `SeatMap` — `SeatMap.Root`, `SeatMap.Content`, … every one of them drawn on the server. Kept as a
// module of their own and re-exported as a namespace (see ./index.ts), so a bundler drops the members an app never
// names. Nothing here may import a client module: the interactive viewport is `ichno/react/client`'s, so that a page
// which only draws a plan sends no script for it.
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
