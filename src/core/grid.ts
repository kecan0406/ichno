// The editor's default cell — 50 plan units: half a metre when a unit is a centimetre, the scale ichno's defaults
// assume (plan units have no size of their own). It is not a document rule: the editor snaps to it only when asked
// (`useSeatPlanEditor({ snap: { cell } })`, to half cells — 25 cm), `<SeatMap.Grid>` draws it, and section crops
// step by it so their coordinates stay whole.
export const GRID_CELL = 50
