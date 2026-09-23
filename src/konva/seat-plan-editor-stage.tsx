'use client'

import type Konva from 'konva'
import { Group, Layer, Rect, Stage, Text } from 'react-konva'
import { seatPlan } from '../core/geometry'
import { seatGrid } from '../core/grid'
import type { FixtureKind, PlanPoint, Seat, SeatPlan, Zone } from '../core/types'
import { ZOOM_STEP, fitScaleOf, zoomView, type SeatMapView } from '../core/view'
import type { EditorSelection } from '../editor/selection'
import {
  CHAIR_RADIUS,
  DESK_RADIUS,
  FURNITURE_LINE_PX,
  FixtureShape,
  OCCUPANT_LINE_PX,
  PlanGrid,
  SEAT_LABEL_FONT,
  ZoneShape,
  setStageCursor,
} from './shapes'
import { useCanvasTheme, type CanvasTheme } from './theme'

type Props<Z extends string> = {
  plan: SeatPlan<Z>
  width: number // stage pixel size — measured by the parent
  height: number
  view: SeatMapView
  selection: EditorSelection<Z> | null
  occupiedSeatIds?: ReadonlySet<string> // seats in use — filled chairs preview what a delete would release
  onSelect(selection: EditorSelection<Z> | null): void
  onSeatDragEnd(id: string, pos: PlanPoint): void // snapped to cells and clamped to the plan
  onZoneDragEnd(id: Z, pos: PlanPoint): void
  onFixtureDragEnd(id: string, pos: PlanPoint): void // snapped to half cells and clamped to the plan
  onViewChange(view: SeatMapView): void
  zoneLabel?(zone: Zone<Z>): string | null // defaults to the zone id
  fixtureLabel?(kind: FixtureKind): string | null // defaults to none
}

// Seat plan editing canvas — seats, zones and fixtures are draggable. Unlike the viewer it knows only two
// emphases: selection and occupancy. Pair it with `useSeatPlanEditor` (ichno/editor), whose `stageProps`
// supplies plan/selection/handlers. Client only: load it without SSR.
export function SeatPlanEditorStage<Z extends string>({
  plan,
  width,
  height,
  view,
  selection,
  occupiedSeatIds,
  onSelect,
  onSeatDragEnd,
  onZoneDragEnd,
  onFixtureDragEnd,
  onViewChange,
  zoneLabel = zoneIdLabel,
  fixtureLabel,
}: Props<Z>) {
  const theme = useCanvasTheme()
  const fitScale = fitScaleOf(plan, { width, height })

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault()
    const pointer = e.target.getStage()?.getPointerPosition()
    if (!pointer) return
    const factor = e.evt.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP
    onViewChange(zoomView(view, { factor, center: pointer, fitScale }))
  }

  // Common drag end — snap/clamp, move the node back to that spot so what you see matches the state, then commit.
  function snappedDragEnd(
    e: Konva.KonvaEventObject<DragEvent>,
    size: { w: number; h: number },
    place: typeof seatGrid.placeSeat,
  ): PlanPoint {
    const pos = place(plan, size, { x: e.target.x(), y: e.target.y() })
    e.target.position(pos)
    return pos
  }

  return (
    <Stage
      width={width}
      height={height}
      scaleX={view.scale}
      scaleY={view.scale}
      x={view.x}
      y={view.y}
      draggable
      onWheel={handleWheel}
      onDragEnd={(e) => {
        const stage = e.target.getStage()
        if (stage && e.target === stage) onViewChange({ ...view, x: stage.x(), y: stage.y() })
      }}
      // Clicking empty floor clears the selection. Seat/zone clicks are handled by their nodes (only stage
      // targets arrive here, so no need to stop bubbling).
      onClick={(e) => {
        if (e.target === e.target.getStage()) onSelect(null)
      }}
    >
      {/* Zones — drag to move, click to select. The selected room's wall and name switch to the accent. */}
      <Layer>
        {plan.zones.map((zone) => {
          const selected = selection?.kind === 'zone' && selection.id === zone.id
          const select = () => onSelect({ kind: 'zone', id: zone.id })
          return (
            <Group
              key={zone.id}
              x={zone.x}
              y={zone.y}
              draggable
              onClick={select}
              onTap={select}
              onDragStart={select}
              onDragEnd={(e) => onZoneDragEnd(zone.id, snappedDragEnd(e, zone, seatGrid.placeZone))}
              onMouseEnter={(e) => setStageCursor(e, 'move')}
              onMouseLeave={(e) => setStageCursor(e, 'default')}
            >
              <ZoneShape
                zone={zone}
                theme={theme}
                scale={view.scale}
                label={seatPlan.showsZoneLabels(plan) ? zoneLabel(zone) : null}
                ink={selected ? theme.accent : theme.ink}
              />
            </Group>
          )
        })}
      </Layer>

      {/* Grid — above the rooms so it shows inside them. An editing tool, so editor only. */}
      <Layer listening={false}>
        <PlanGrid plan={plan} color={theme.grid} />
      </Layer>

      {/* Fixtures — above the grid, below the seats. Snap to half cells. */}
      <Layer>
        {plan.fixtures.map((fixture) => {
          const selected = selection?.kind === 'fixture' && selection.id === fixture.id
          const select = () => onSelect({ kind: 'fixture', id: fixture.id })
          return (
            <Group
              key={fixture.id}
              x={fixture.x}
              y={fixture.y}
              draggable
              onClick={select}
              onTap={select}
              onDragStart={select}
              onDragEnd={(e) => onFixtureDragEnd(fixture.id, snappedDragEnd(e, fixture, seatGrid.placeFixture))}
              onMouseEnter={(e) => setStageCursor(e, 'move')}
              onMouseLeave={(e) => setStageCursor(e, 'default')}
            >
              {/* Hit area — walls paint only a centre band, so grab the whole half-cell rectangle. */}
              <Rect width={fixture.w} height={fixture.h} fill="transparent" />
              <FixtureShape fixture={fixture} theme={theme} text={fixtureLabel?.(fixture.kind) ?? null} />
              {/* Selection ring — walls/TVs are half a cell thick, so a heavier border would not show. */}
              {selected && (
                <Rect
                  x={-5}
                  y={-5}
                  width={fixture.w + 10}
                  height={fixture.h + 10}
                  cornerRadius={6}
                  stroke={theme.accent}
                  strokeWidth={4}
                />
              )}
            </Group>
          )
        })}
      </Layer>

      <Layer>
        {plan.seats.map((seat) => (
          <EditorSeatNode
            key={seat.id}
            seat={seat}
            theme={theme}
            selected={selection?.kind === 'seat' && selection.id === seat.id}
            occupied={occupiedSeatIds?.has(seat.id) ?? false}
            onSelect={() => onSelect({ kind: 'seat', id: seat.id })}
            onDragEnd={(e) => onSeatDragEnd(seat.id, snappedDragEnd(e, seat, seatGrid.placeSeat))}
          />
        ))}
      </Layer>
    </Stage>
  )
}

// Editing seat — the same desk and chair as the viewer, so the chair side is visible while arranging. Two
// emphases only: occupancy (filled chair) and selection (accent ring).
function EditorSeatNode({
  seat,
  theme,
  selected,
  occupied,
  onSelect,
  onDragEnd,
}: {
  seat: Seat
  theme: CanvasTheme
  selected: boolean
  occupied: boolean
  onSelect(): void
  onDragEnd(e: Konva.KonvaEventObject<DragEvent>): void
}) {
  const { desk, chair } = seatPlan.furnitureOf(seat)
  const line = selected ? OCCUPANT_LINE_PX : FURNITURE_LINE_PX
  return (
    <Group
      x={seat.x}
      y={seat.y}
      draggable
      onClick={onSelect}
      onTap={onSelect}
      onDragStart={onSelect}
      onDragEnd={onDragEnd}
      onMouseEnter={(e) => setStageCursor(e, 'move')}
      onMouseLeave={(e) => setStageCursor(e, 'default')}
    >
      {/* Hit area — the whole seat, including the gap between desk and chair. */}
      <Rect width={seat.w} height={seat.h} fill="transparent" />
      <Rect
        x={desk.x}
        y={desk.y}
        width={desk.w}
        height={desk.h}
        cornerRadius={DESK_RADIUS}
        fill={theme.surface}
        stroke={selected ? theme.accent : theme.label}
        strokeWidth={line}
        strokeScaleEnabled={false}
      />
      <Rect
        x={chair.x}
        y={chair.y}
        width={chair.w}
        height={chair.h}
        cornerRadius={CHAIR_RADIUS}
        fill={occupied ? theme.ink : theme.surface}
        stroke={selected ? theme.accent : occupied ? theme.ink : theme.label}
        strokeWidth={line}
        strokeScaleEnabled={false}
      />
      {selected && (
        <Rect
          x={-6}
          y={-6}
          width={seat.w + 12}
          height={seat.h + 12}
          cornerRadius={10}
          stroke={theme.accent}
          strokeWidth={4}
        />
      )}
      <Text
        x={desk.x}
        y={desk.y}
        width={desk.w}
        height={desk.h}
        align="center"
        verticalAlign="middle"
        text={seat.id}
        fontSize={SEAT_LABEL_FONT}
        fontStyle="600"
        fontFamily={theme.numberFontFamily}
        fill={selected ? theme.accent : theme.label}
      />
    </Group>
  )
}

function zoneIdLabel(zone: { id: string }): string {
  return zone.id
}
