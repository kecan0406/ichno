// Headless seat map components — `SeatMap.Root`, `SeatMap.Viewport`, `SeatMap.Content` and the parts. Every one but
// `Viewport` renders as a React Server Component. A namespace of a module rather than an object, so what an app does
// not name is left out of its bundle.
export * as SeatMap from './seat-map.js'

export { useSeatMapView, type SeatMapView } from './client/use-seat-map-view'

export { planTargetOf } from './target'

export type { PlaceProps } from './parts'

export type { EditorOverlayProps } from './overlay'

export type { ViewportFrame } from './client/viewport'
