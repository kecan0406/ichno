// Headless seat map components — `SeatMap.Root`, `SeatMap.Content` and the parts, each of which renders as a React
// Server Component. A namespace of a module rather than an object, so what an app does not name is left out of its
// bundle. The interactive viewport and its view hook are `ichno/react/client`'s — nothing here runs in the browser.
export * as SeatMap from './seat-map.js'

export { planTargetOf } from './target'

export type { PlaceProps } from './parts'

export type { EditorOverlayProps } from './overlay'
