'use client'

import type Konva from 'konva'
import { Group, Line, Rect, Text } from 'react-konva'
import { WALL_THICKNESS, ZONE_LABEL_BAND, ZONE_LABEL_FONT, seatPlan } from '../core/geometry'
import { GRID_CELL } from '../core/grid'
import type { Fixture, FixtureKind, PlanRect, SeatPlan, Zone } from '../core/types'
import type { CanvasTheme } from './theme'

// Shapes shared by the viewer canvas and the editor canvas. Each draws at its local origin; the enclosing Group
// positions it. The SVG renderer (ichno/svg) draws the same grammar — keep the colour roles in step.

// Minimum on-screen stroke — at small scales a plan-unit width drops below 1px and the line vanishes, so the
// thicker of the plan width and the screen floor wins (zooming in lets the plan width take over).
const MIN_STROKE_PX = 1.5
// Furniture outlines stay a fixed screen width while walls scale with the plan — walls read above furniture.
export const FURNITURE_LINE_PX = 1.5
export const OCCUPANT_LINE_PX = 2
export const DESK_RADIUS = 4
export const CHAIR_RADIUS = 7
// Seat number font (plan units) — always drawn regardless of scale; a small number beats none.
export const SEAT_LABEL_FONT = 20
const FIXTURE_RADIUS: Record<Exclude<FixtureKind, 'wall'>, number> = { tv: 2, counter: 10 }

// One room — floor, the outer wall outside the room rectangle and, when given, the name above the wall.
export function ZoneShape({
  zone,
  theme,
  scale,
  label,
  ink,
}: {
  zone: Zone
  theme: CanvasTheme
  scale: number // current view scale — sets the on-screen floor of the wall width
  label: string | null
  ink: string // wall and name colour (the editor passes the accent for a selected room)
}) {
  const wall = strokeWidthOf(WALL_THICKNESS, scale)
  return (
    <>
      <Rect width={zone.w} height={zone.h} fill={theme.surface} />
      <Rect x={-wall / 2} y={-wall / 2} width={zone.w + wall} height={zone.h + wall} stroke={ink} strokeWidth={wall} />
      {label && (
        <Text
          x={-WALL_THICKNESS}
          y={-ZONE_LABEL_BAND + 10}
          text={label}
          fontSize={ZONE_LABEL_FONT}
          fontStyle="bold"
          fontFamily={theme.fontFamily}
          fill={ink}
        />
      )}
    </>
  )
}

// One fixture — walls are an ink centre band like the outer wall; TVs and counters are a sunken face with a
// name (TV with an ink outline, counter with a furniture outline). The accent is never used here (it belongs to
// seat occupancy and selection).
export function FixtureShape({ fixture, theme, text }: { fixture: Fixture; theme: CanvasTheme; text: string | null }) {
  if (fixture.kind === 'wall') {
    return <Rect {...boxOf(seatPlan.innerWallOf(fixture))} fill={theme.ink} />
  }
  const label = seatPlan.fixtureLabelOf(fixture, text)
  return (
    <>
      <Rect
        width={fixture.w}
        height={fixture.h}
        cornerRadius={FIXTURE_RADIUS[fixture.kind]}
        fill={theme.fixture}
        stroke={fixture.kind === 'tv' ? theme.ink : theme.label}
        strokeWidth={FURNITURE_LINE_PX}
        strokeScaleEnabled={false}
      />
      {label && (
        <Text
          // Tall fixtures lay the text box down and rotate it -90° to read bottom-to-top (bottom-left pivot).
          x={0}
          y={label.vertical ? fixture.h : 0}
          width={label.vertical ? fixture.h : fixture.w}
          height={label.vertical ? fixture.w : fixture.h}
          rotation={label.vertical ? -90 : 0}
          align="center"
          verticalAlign="middle"
          text={label.text}
          fontSize={label.fontSize}
          fontStyle="bold"
          fontFamily={theme.fontFamily}
          fill={theme.label}
        />
      )}
    </>
  )
}

// Cell grid — cell edges plus the plan outline. Editor only (placement tool, not part of the drawing).
// 1px on screen (strokeScaleEnabled=false) regardless of zoom.
export function PlanGrid({ plan, color }: { plan: Pick<SeatPlan, 'width' | 'height'>; color: string }) {
  return (
    <Group listening={false}>
      {gridLines(plan).map((points, i) => (
        <Line key={i} points={points} stroke={color} strokeWidth={1} strokeScaleEnabled={false} opacity={0.7} />
      ))}
      <Rect width={plan.width} height={plan.height} stroke={color} strokeWidth={1} strokeScaleEnabled={false} />
    </Group>
  )
}

export function strokeWidthOf(planUnits: number, scale: number): number {
  return Math.max(planUnits, MIN_STROKE_PX / scale)
}

export function boxOf(rect: PlanRect) {
  return { x: rect.x, y: rect.y, width: rect.w, height: rect.h }
}

export function setStageCursor(e: Konva.KonvaEventObject<MouseEvent>, cursor: string) {
  const stage = e.target.getStage()
  if (stage) stage.container().style.cursor = cursor
}

// Inner cell lines — vertical then horizontal (the outline is a separate Rect).
function gridLines(plan: Pick<SeatPlan, 'width' | 'height'>): number[][] {
  const lines: number[][] = []
  for (let x = GRID_CELL; x < plan.width; x += GRID_CELL) lines.push([x, 0, x, plan.height])
  for (let y = GRID_CELL; y < plan.height; y += GRID_CELL) lines.push([0, y, plan.width, y])
  return lines
}
