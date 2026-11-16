'use client'

import { seatPlan, type SeatPlan, type SelectionIssue } from 'ichno'
import { useState } from 'react'
import { describe, selectionIssueKey, selectionIssueText } from '../../_demo/messages'
import { categoryNameOf } from '../_lib/category-labels'
import styles from './booking.module.css'
import controls from './controls.module.css'
import { NumberField, Section, Segmented, Toggle } from './fields'
import panels from './panels.module.css'

// The preview's side of a booking screen — what is picked, whether it passes the rules, and the button that books
// it — and, folded under it, the playground's own switches for trying the rules out. Beside the plan on a wide
// screen; on a narrow one a sheet at the bottom that shows the total and the button, and opens for the rest.

export type PickRules = { max: number; consecutive: boolean; noOrphans: boolean }

type Props = {
  plan: SeatPlan<string>
  picked: readonly string[]
  booked: readonly string[]
  // What `validateSelection` says of the picks.
  issues: readonly SelectionIssue[]
  rules: PickRules
  onRulesChange(next: PickRules): void
  picking: 'pick' | 'book'
  onPickingChange(next: 'pick' | 'book'): void
  onRemove(id: string): void
  onClear(): void
  // Books the picks: they become taken.
  onBook(): void
  // Frees every booked place.
  onFree(): void
}

export function BookingPanel({
  plan,
  picked,
  booked,
  issues,
  rules,
  onRulesChange,
  picking,
  onPickingChange,
  onRemove,
  onClear,
  onBook,
  onFree,
}: Props) {
  // The sheet, on a narrow screen.
  const [open, setOpen] = useState(false)
  // How many places the last booking took — said until something is picked again.
  const [taken, setTaken] = useState(0)
  const places = new Map(seatPlan.placesOf(plan).map((place) => [place.id, place]))

  const rows = picked.flatMap((id) => {
    const place = places.get(id)

    return place ? [place] : []
  })

  const guests = rows.reduce((sum, place) => sum + place.capacity, 0)
  const blocked = rows.length > 0 && issues.length > 0

  function book() {
    setTaken(rows.length)
    onBook()
  }

  return (
    <div className={styles.panel} data-open={open || undefined}>
      <button
        type="button"
        className={styles.handle}
        aria-expanded={open}
        aria-controls="booking-details"
        onClick={() => setOpen(!open)}
      >
        <span className={styles.grip} aria-hidden />
        <span className={controls.srOnly}>{open ? 'Hide the selection' : 'Show the selection'}</span>
      </button>

      <div id="booking-details" className={styles.body}>
        <div className={styles.scroll}>
          <Section
            title="Your selection"
            actions={
              rows.length > 0 && (
                <button type="button" className={controls.button} onClick={onClear}>
                  Clear
                </button>
              )
            }
          >
            {rows.length === 0 ? (
              <p className={controls.hint}>
                {taken > 0
                  ? `Booked ${counted(taken, 'place')}. ${taken === 1 ? 'It is' : 'They are'} taken now — and locked in the editor, where what holds a booked place cannot be deleted.`
                  : 'Tap a place on the plan to pick it.'}
              </p>
            ) : (
              <ul className={styles.rows}>
                {rows.map((place) => (
                  <li key={place.id}>
                    <span className={styles.rowName}>{describe(plan, place.id)}</span>
                    <span className={styles.rowFacts}>
                      {[
                        place.category === undefined ? null : categoryNameOf(place.category),
                        counted(place.capacity, 'guest'),
                      ]
                        .filter((fact) => fact !== null)
                        .join(' · ')}
                    </span>
                    <button
                      type="button"
                      className={controls.iconButton}
                      aria-label={`Remove ${describe(plan, place.id)}`}
                      title="Remove"
                      onClick={() => onRemove(place.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {blocked && (
              <ul className={panels.checks}>
                {issues.map((issue) => (
                  <li key={selectionIssueKey(issue)} className={panels.check} data-severity="warning">
                    <span className={panels.dot} />
                    {selectionIssueText(plan, issue)}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <details className={styles.settings}>
            <summary>Preview settings</summary>
            <div className={styles.settingsBody}>
              <p className={controls.hint}>
                The plan as your customers would see it. The rules below are <code>validateSelection</code>’s; booked
                places become the editor’s <code>lockedIds</code>.
              </p>
              <p className={controls.hint}>
                The drawing is this playground’s own, made with three.js through ichno’s <code>projection</code> from
                the same document. ichno stores footprints only — heights, which way chairs face and the furniture are
                the playground’s reading of its roles.
              </p>
              <div className={controls.row}>
                <span className={controls.rowLabel}>At most</span>
                <NumberField
                  icon="#"
                  label="At most"
                  value={rules.max}
                  min={1}
                  max={50}
                  onCommit={(max) => onRulesChange({ ...rules, max })}
                />
              </div>
              <Toggle
                label="Seats side by side in one row"
                checked={rules.consecutive}
                onChange={(consecutive) => onRulesChange({ ...rules, consecutive })}
              />
              <Toggle
                label="Leave no seat stranded"
                checked={rules.noOrphans}
                onChange={(noOrphans) => onRulesChange({ ...rules, noOrphans })}
              />
              <Segmented
                label="A tap"
                value={picking}
                options={[
                  { value: 'pick', label: 'Picks it' },
                  { value: 'book', label: 'Books it', title: 'A tap takes a place, or frees a taken one' },
                ]}
                onChange={onPickingChange}
              />
              <div className={styles.bookedRow}>
                <span className={controls.hint}>{booked.length} booked</span>
                {booked.length > 0 && (
                  <button type="button" className={controls.button} onClick={onFree}>
                    Free all
                  </button>
                )}
              </div>
            </div>
          </details>
        </div>
      </div>

      <footer className={styles.footer}>
        <p className={styles.total} aria-live="polite">
          {rows.length === 0 ? (
            'Nothing picked yet'
          ) : (
            <>
              <strong>{counted(rows.length, 'place')}</strong> · {counted(guests, 'guest')}
            </>
          )}
          {blocked && <span className={styles.blocked}>{counted(issues.length, 'rule')} to settle</span>}
        </p>
        <button
          type="button"
          className={controls.button}
          data-primary=""
          data-wide=""
          disabled={rows.length === 0 || blocked}
          onClick={book}
        >
          {rows.length === 0 ? 'Book' : `Book ${counted(rows.length, 'place')}`}
        </button>
      </footer>
    </div>
  )
}

function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}
