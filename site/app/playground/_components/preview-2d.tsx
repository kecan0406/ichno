'use client'

import { planView, seatPlan, type Place, type PlanRect, type PlanView, type SeatPlan, type ViewportSize } from 'ichno'
import { SeatMap } from 'ichno/react'
import { SeatMapViewport, type SeatMapView } from 'ichno/react/client'
import { useEffect, useRef, useState } from 'react'
import { fixtureLabel, fixtureVariant } from '../_lib/fixtures'
import { CategoryLabels } from './category-labels'
import { PlaceTip, ZoomButtons, type TipAt } from './preview-chrome'
import styles from './preview.module.css'

// The 2D preview: the plan as ichno draws it, to pick places on — with what the pointer is on written above it and
// the zoom in a corner.

type Props = {
  plan: SeatPlan<string>
  // The view, shared with the editor — previewing keeps where you were looking.
  map: SeatMapView
  status: Record<string, string>
  picked: readonly string[]
  // Booked places can be tapped too — a tap frees them (the playground's way to set what is taken).
  bookable: boolean
  onPlaceTap(place: Place<string>): void
}

export function Preview2D({ plan, map, status, picked, bookable, onPlaceTap }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<ViewportSize | null>(null)
  const [pointed, setPointed] = useState<string | null>(null)
  const place = pointed === null ? undefined : seatPlan.placesOf(plan).find((candidate) => candidate.id === pointed)

  useEffect(() => {
    const host = hostRef.current

    if (!host) return

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })

    observer.observe(host)

    return () => observer.disconnect()
  }, [])

  return (
    <div ref={hostRef} className={styles.plan}>
      <SeatMapViewport
        plan={plan}
        {...map.viewProps}
        onPlaceClick={onPlaceTap}
        onPlaceHover={(over) => setPointed(over?.id ?? null)}
        className={styles.viewport}
        aria-label="Seat plan preview"
        aria-multiselectable
      >
        <SeatMap.Content
          plan={plan}
          status={status}
          selected={picked}
          isDisabled={bookable ? never : undefined}
          fixtureLabel={fixtureLabel}
          fixtureVariant={fixtureVariant}
        />
        <CategoryLabels plan={plan} />
      </SeatMapViewport>
      {place && size && (
        <PlaceTip
          plan={plan}
          place={place}
          state={status[place.id] !== undefined ? 'taken' : picked.includes(place.id) ? 'picked' : 'available'}
          at={tipAt(map.view, size, seatPlan.boundsOf(place))}
        />
      )}
      <ZoomButtons
        onIn={map.zoomIn}
        onOut={map.zoomOut}
        onFit={map.fit}
        canIn={map.canZoomIn}
        canOut={map.canZoomOut}
      />
    </div>
  )
}

// Where the tip for a place goes: over the middle of its top edge — or under its bottom edge when it stands too near
// the top of the view. `planView.toScreen` follows the view, so the tip stays on the place while the plan zooms.
function tipAt(view: PlanView, size: ViewportSize, bounds: PlanRect): TipAt {
  const top = planView.toScreen(view, size, { x: bounds.x + bounds.w / 2, y: bounds.y })

  if (top.y >= TIP_ROOM_PX) return top
  const bottom = planView.toScreen(view, size, { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h })

  return { ...bottom, below: true }
}

// The room a tip needs above a place, in screen pixels.
const TIP_ROOM_PX = 64

function never(): boolean {
  return false
}
