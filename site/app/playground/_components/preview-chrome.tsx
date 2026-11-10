import type { Place, SeatPlan } from 'ichno'
import { describe } from '../../_demo/messages'
import { categoryNameOf } from '../_lib/category-labels'
import styles from './preview.module.css'

// What the preview lays over the plan to make it a booking screen: the plan's name and how much of it is free, a
// legend, what the pointer is on, and the zoom. The playground's own, drawn round ichno's parts — ichno ships none of
// it, and an app would write these in its own design system.

// The plan's name, how many of its places are free, and what each paint on the plan means. Only the states the plan
// paints differently are listed — a category is read from its label on the floor, not from a place's colour.
export function PreviewTitle({ name, free, total }: { name: string; free: number; total: number }) {
  return (
    <header className={styles.title}>
      <h2>
        <strong>{name}.</strong> seat preview
      </h2>
      <p>{free === total ? `${total} places, all free` : `${free} of ${total} places free`}</p>
      <ul className={styles.legend} aria-label="Legend">
        <li>
          <span className={styles.swatch} data-tone="available" />
          Available
        </li>
        <li>
          <span className={styles.swatch} data-tone="picked" />
          Picked
        </li>
        <li>
          <span className={styles.swatch} data-tone="taken" />
          Taken
        </li>
      </ul>
    </header>
  )
}

// Where a tip points: a place's top edge in the view's pixels — or its bottom edge (`below`) when there is no room
// above it.
export type TipAt = { x: number; y: number; below?: boolean }

// What the pointer is on — the place as people name it, its category, how many it holds and whether it can be had.
// For the pointer only: the plan's own semantics (an option with a label, selected or disabled) serve the keyboard
// and screen readers.
export function PlaceTip({
  plan,
  place,
  state,
  at,
}: {
  plan: SeatPlan<string>
  place: Place<string>
  state: 'available' | 'picked' | 'taken'
  at: TipAt
}) {
  const facts = [
    place.category === undefined ? null : categoryNameOf(place.category),
    place.capacity > 1 ? `${place.capacity} guests` : null,
    STATES[state],
  ].filter((fact) => fact !== null)

  return (
    <div className={styles.tip} data-side={at.below ? 'bottom' : 'top'} style={{ left: at.x, top: at.y }} aria-hidden>
      <strong>{describe(plan, place.id)}</strong>
      <span data-state={state}>{facts.join(' · ')}</span>
    </div>
  )
}

const STATES = { available: 'Available', picked: 'Picked', taken: 'Taken' }

// The zoom — out, back to the whole plan, in.
export function ZoomButtons({
  onIn,
  onOut,
  onFit,
  canIn = true,
  canOut = true,
  fit = 'Fit',
  fitTitle = 'Back to the whole plan',
}: {
  onIn(): void
  onOut(): void
  onFit(): void
  canIn?: boolean
  canOut?: boolean
  fit?: string
  fitTitle?: string
}) {
  return (
    <div className={styles.zoom} role="group" aria-label="Zoom">
      <button type="button" aria-label="Zoom out" title="Zoom out" disabled={!canOut} onClick={onOut}>
        −
      </button>
      <button type="button" className={styles.zoomFit} title={fitTitle} onClick={onFit}>
        {fit}
      </button>
      <button type="button" aria-label="Zoom in" title="Zoom in" disabled={!canIn} onClick={onIn}>
        +
      </button>
    </div>
  )
}
