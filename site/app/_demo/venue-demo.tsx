'use client'

import { seatPlan, validateSelection, type Place } from 'ichno'
import { SeatMap, useSeatMapView } from 'ichno/react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { CategoryLabels } from '../playground/_components/category-labels'
import styles from './demo.module.css'
import { selectionIssueKey, selectionIssueText } from './messages'
import { fixtureNames, venuePlan, venueSectionNames, venueStatus, type VenueSection } from './plans'

const places = seatPlan.placesOf(venuePlan)

const placeById = new Map(places.map((place) => [place.id, place]))

const unavailable = Object.keys(venueStatus)

const MAX_PICK = 8

// The first is the playground's look — every place painted alike, its category read from a label on the plan — and
// the rest paint the categories, each in its own colours: the same document under different CSS.
const PALETTES = [
  { id: 'charcoal', name: 'Charcoal' },
  { id: 'site', name: 'Site' },
  { id: 'forest', name: 'Forest' },
  { id: 'ember', name: 'Ember' },
  { id: 'mono', name: 'Mono' },
] as const

type Palette = (typeof PALETTES)[number]['id']

export function VenueDemo() {
  const [selected, setSelected] = useState<string[]>([])
  const map = useSeatMapView(venuePlan)
  const [palette, setPalette] = useState<Palette>('charcoal')

  const issues = validateSelection(venuePlan, { selected, unavailable }, { max: MAX_PICK, noOrphans: true })
  const guests = selected.reduce((sum, id) => sum + (placeById.get(id)?.capacity ?? 0), 0)
  // Zoomed in past the whole plan — it pans then, and can go back.
  const zoomed = map.canZoomOut

  function toggle(place: Place<VenueSection>) {
    setSelected((current) =>
      current.includes(place.id) ? current.filter((id) => id !== place.id) : [...current, place.id],
    )
  }

  function showSelection() {
    const rects = selected.flatMap((id) => {
      const place = placeById.get(id)

      return place ? [seatPlan.boundsOf(place)] : []
    })

    map.zoomTo(rects, 160)
  }

  return (
    <div className={styles.demo} data-palette={palette}>
      <div className={styles.toolbar}>
        <div className={styles.legend} aria-hidden>
          {palette === 'charcoal' ? (
            <>
              <span className={styles.swatch} data-tone="standard" />
              Available
            </>
          ) : (
            <>
              <span className={styles.swatch} data-tone="premium" />
              Premium
              <span className={styles.swatch} data-tone="standard" />
              Standard
              <span className={styles.swatch} data-tone="access" />
              Accessible
            </>
          )}
          <span className={styles.swatch} data-tone="taken" />
          Taken
        </div>
        <div className={styles.palettes} role="radiogroup" aria-label="Theme">
          {PALETTES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={palette === option.id}
              className={styles.palette}
              data-palette-chip={option.id}
              onClick={() => setPalette(option.id)}
            >
              <span className={styles.paletteDot} />
              {option.name}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.stage} data-zoomed={zoomed || undefined}>
        <SeatMap.Viewport
          plan={venuePlan}
          {...map.viewProps}
          pannable={zoomed}
          zoomable={false}
          onPlaceClick={toggle}
          className={styles.viewport}
          aria-label="Demo venue — pick places"
          aria-multiselectable
        >
          {(frame) => (
            <>
              <SeatMap.Content
                plan={venuePlan}
                status={venueStatus}
                selected={selected}
                sectionLabel={(section) => venueSectionNames[section.id]}
                fixtureLabel={(fixture) => fixtureNames.get(fixture.role ?? '') ?? null}
                region={frame.region}
                scale={frame.scale}
              />
              {palette === 'charcoal' && <CategoryLabels plan={venuePlan} scale={frame.scale} />}
            </>
          )}
        </SeatMap.Viewport>
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryText} aria-live="polite">
          {selected.length === 0 ? (
            <span className={styles.hint}>Tap seats, tables, desks or booths to pick them.</span>
          ) : (
            <>
              <strong>
                {selected.length} {selected.length === 1 ? 'place' : 'places'} · {guests}{' '}
                {guests === 1 ? 'guest' : 'guests'}
              </strong>
              <AnimatePresence initial={false}>
                {issues.map((issue) => (
                  <motion.span
                    key={selectionIssueKey(issue)}
                    className={styles.issue}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    {selectionIssueText(venuePlan, issue)}
                  </motion.span>
                ))}
              </AnimatePresence>
            </>
          )}
        </div>
        <div className={styles.summaryActions}>
          <div className={styles.zoom} role="group" aria-label="Zoom">
            <button type="button" onClick={map.zoomIn} aria-label="Zoom in" disabled={!map.canZoomIn}>
              +
            </button>
            <button type="button" onClick={map.zoomOut} aria-label="Zoom out" disabled={!map.canZoomOut}>
              −
            </button>
            <button type="button" onClick={map.fit} aria-label="Show the whole plan" disabled={!zoomed}>
              ⤢
            </button>
          </div>
          <button type="button" onClick={showSelection} disabled={selected.length === 0}>
            Zoom to picks
          </button>
          <button type="button" onClick={() => setSelected([])} disabled={selected.length === 0}>
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}
