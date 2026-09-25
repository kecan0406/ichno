'use client'

import { planView, seatPlan, validateSelection, type Place, type PlanView } from 'ichno'
import { SeatMap } from 'ichno/react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import styles from './demo.module.css'
import { selectionIssueKey, selectionIssueText } from './messages'
import { fixtureNames, venuePlan, venueSectionNames, venueStatus, type VenueSection } from './plans'

const places = seatPlan.placesOf(venuePlan)
const placeById = new Map(places.map((place) => [place.id, place]))
const unavailable = Object.keys(venueStatus)
const HOME = planView.home(venuePlan)
const MAX_PICK = 8

const PALETTES = [
  { id: 'site', name: 'Site' },
  { id: 'forest', name: 'Forest' },
  { id: 'ember', name: 'Ember' },
  { id: 'mono', name: 'Mono' },
] as const

type Palette = (typeof PALETTES)[number]['id']

export function VenueDemo() {
  const [selected, setSelected] = useState<string[]>([])
  const [view, setView] = useState<PlanView>(HOME)
  const [palette, setPalette] = useState<Palette>('site')

  const issues = validateSelection(venuePlan, { selected, unavailable }, { max: MAX_PICK, noOrphans: true })
  const guests = selected.reduce((sum, id) => sum + (placeById.get(id)?.capacity ?? 0), 0)
  const zoomed = view.w < HOME.w - 1

  function toggle(place: Place<VenueSection>) {
    setSelected((current) =>
      current.includes(place.id) ? current.filter((id) => id !== place.id) : [...current, place.id],
    )
  }

  function zoomBy(factor: number) {
    setView((current) =>
      planView.zoom(current, factor, { x: current.x + current.w / 2, y: current.y + current.h / 2 }, HOME),
    )
  }

  function showSelection() {
    const rects = selected.flatMap((id) => placeById.get(id)?.bounds ?? [])
    const next = planView.fitTo(rects, 160, HOME)
    if (next) setView(next)
  }

  return (
    <div className={styles.demo} data-palette={palette}>
      <div className={styles.toolbar}>
        <div className={styles.legend} aria-hidden>
          <span className={styles.swatch} data-tone="premium" />
          Premium
          <span className={styles.swatch} data-tone="standard" />
          Standard
          <span className={styles.swatch} data-tone="access" />
          Accessible
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
          view={view}
          onViewChange={setView}
          pannable={zoomed}
          zoomable={false}
          onPlaceClick={toggle}
          className={styles.viewport}
          aria-label="Demo venue — pick places"
          aria-multiselectable
        >
          {(frame) => (
            <SeatMap.Content
              plan={venuePlan}
              status={venueStatus}
              selected={selected}
              sectionLabel={(section) => venueSectionNames[section.id]}
              fixtureLabel={(fixture) => fixtureNames[fixture.role] ?? null}
              region={frame.region}
              scale={frame.scale}
            />
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
            <button type="button" onClick={() => zoomBy(1.5)} aria-label="Zoom in">
              +
            </button>
            <button type="button" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out" disabled={!zoomed}>
              −
            </button>
            <button type="button" onClick={() => setView(HOME)} aria-label="Show the whole plan" disabled={!zoomed}>
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
