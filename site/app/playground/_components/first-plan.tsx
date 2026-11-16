import { planView, type SeatPlan } from 'ichno'
import { SeatMap } from 'ichno/react'
import { fixtureLabel, fixtureVariant } from '../_lib/fixtures'
import { VIEW_MARGIN } from './use-canvas-view'
import styles from './workspace.module.css'

// The plan as ichno's own parts draw it — on the server, with no script — which is what shows until three.js is
// there. The canvas comes in straight above it at the same scale, then moves into its own view.
export function FirstPlan({ plan, status }: { plan: SeatPlan<string>; status: Record<string, string> }) {
  return (
    <SeatMap.Root
      plan={plan}
      view={planView.home(plan, VIEW_MARGIN)}
      className={styles.first}
      style={{ height: '100%' }}
      aria-hidden
    >
      <SeatMap.Content plan={plan} status={status} fixtureLabel={fixtureLabel} fixtureVariant={fixtureVariant} />
    </SeatMap.Root>
  )
}
