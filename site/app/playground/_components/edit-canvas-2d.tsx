'use client'

import type { PlanPoint, PlanTarget, SeatPlan } from 'ichno'
import type { SeatPlanEditor } from 'ichno/editor'
import { SeatMap } from 'ichno/react'
import { SeatMapViewport, type SeatMapView } from 'ichno/react/client'
import type { MouseEvent } from 'react'
import { fixtureLabel, fixtureVariant } from '../_lib/fixtures'
import { CategoryLabels } from './category-labels'
import { Dimensions, type Measured } from './dimensions'
import marks from './marks.module.css'
import { Gliding } from './settling'
import styles from './workspace.module.css'

// The 2D editing canvas — ichno's viewport with the editor's presses, and the layers drawn in it: the grid, the plan
// in two layers (what a drag leaves alone, and what it moves), the categories' names, what the tool would make, what
// it cannot, the lengths and the editor's overlay.

type Props = {
  editor: SeatPlanEditor<string>
  // The view, shared with the preview.
  map: SeatMapView
  // The Hand: every drag pans — the viewport gets nothing to tap or drag.
  hand: boolean
  snapping: boolean
  // Places and walls drawn selected, and the places marked — overlapping, or outside their section — in each layer.
  selected: readonly string[]
  stillInvalid: readonly string[]
  movingInvalid: readonly string[]
  status: Record<string, string>
  // What the tool in use would have dropped where it can make nothing.
  refused: SeatPlan<string> | null
  measured: Measured
  // What a tap would select, or the layers row under the pointer.
  hoverFrame: readonly PlanPoint[] | null
  onTap(target: PlanTarget<string> | null, info: { point: PlanPoint | null; additive: boolean }): void
  onHover(point: PlanPoint | null, target: PlanTarget<string> | null, info?: { pixel: number }): void
  onContextMenu(e: MouseEvent<SVGSVGElement>): void
}

// Seat numbers drawn smaller than this on screen are left out (`SeatMap.Content` defaults to 9).
const LABEL_MIN_PX = 6

export function EditCanvas2D({
  editor,
  map,
  hand,
  snapping,
  selected,
  stillInvalid,
  movingInvalid,
  status,
  refused,
  measured,
  hoverFrame,
  onTap,
  onHover,
  onContextMenu,
}: Props) {
  const { onTap: _tap, onHover: _hover, ...viewportProps } = editor.viewportProps

  return (
    <SeatMapViewport
      {...(hand ? { plan: editor.displayPlan } : viewportProps)}
      {...map.viewProps}
      onTap={hand ? undefined : onTap}
      onHover={onHover}
      onContextMenu={onContextMenu}
      wheel="pan"
      className={styles.viewport}
      aria-label="Seat plan editor"
    >
      {(frame) => (
        // What an edit moved glides to where it goes (./settling.ts) — a drag is drawn as the hand moves it.
        <Gliding plan={editor.stillPlan} committed={editor.plan}>
          {(still, gliding) => (
            <>
              {/* The grid only reads the plan's size — the saved plan's does not change mid-drag. */}
              {snapping && <SeatMap.Grid plan={editor.plan} />}
              {/* What a drag leaves alone keeps its identity, so this layer is drawn once per drag. Numbers smaller
                  than 6 screen pixels are left out — unreadable anyway, and SVG text is what large plans pay for. */}
              <SeatMap.Content
                plan={still}
                selected={selected}
                invalid={stillInvalid}
                status={status}
                isDisabled={never}
                fixtureLabel={fixtureLabel}
                fixtureVariant={fixtureVariant}
                region={frame.region}
                scale={frame.scale}
                minLabelPx={LABEL_MIN_PX}
              />
              {editor.movingPlan && (
                <SeatMap.Content
                  plan={editor.movingPlan}
                  selected={selected}
                  invalid={movingInvalid}
                  status={status}
                  isDisabled={never}
                  fixtureLabel={fixtureLabel}
                  fixtureVariant={fixtureVariant}
                  scale={frame.scale}
                  minLabelPx={LABEL_MIN_PX}
                />
              )}
              <CategoryLabels plan={editor.plan} scale={frame.scale} />
              {editor.draft && (
                <g className={styles.draft}>
                  <SeatMap.Content
                    plan={editor.draft}
                    invalid={editor.conflictIds}
                    fixtureLabel={fixtureLabel}
                    fixtureVariant={fixtureVariant}
                  />
                </g>
              )}
              {refused && (
                <g className={marks.refused} data-refused="">
                  <SeatMap.Content plan={refused} fixtureVariant={fixtureVariant} minLabelPx={Infinity} />
                </g>
              )}
              {/* Outlines and lengths are drawn where the edit ends — they wait for what they go round. */}
              {!gliding && (
                <>
                  <Dimensions {...measured} scale={frame.scale} />
                  <SeatMap.EditorOverlay {...editor.overlayProps} hoverFrame={hoverFrame} />
                </>
              )}
            </>
          )}
        </Gliding>
      )}
    </SeatMapViewport>
  )
}

function never(): boolean {
  return false
}
