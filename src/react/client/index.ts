'use client'

// The interactive half of ichno's components — everything here runs in the browser. It is an entry of its own,
// `ichno/react/client`, apart from `ichno/react`, whose parts are drawn on the server: a page that only draws a plan
// imports nothing from here, so no script is sent for it.
export { Viewport as SeatMapViewport, type ViewportFrame } from './viewport'

export { useSeatMapView, type SeatMapView } from './use-seat-map-view'
