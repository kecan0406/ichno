'use client'

import { useRef, useState } from 'react'
import type Konva from 'konva'
import { Circle, Group, Layer, Rect, Stage, Text } from 'react-konva'
import { seatPlan } from '../core/geometry'
import type { FixtureKind, PlanRect, Seat, Zone, ZoneSeatPlan } from '../core/types'
import { ZOOM_STEP, fitScaleOf, fitView, zoomView, type SeatMapView } from '../core/view'
import {
  CHAIR_RADIUS,
  DESK_RADIUS,
  FURNITURE_LINE_PX,
  FixtureShape,
  OCCUPANT_LINE_PX,
  SEAT_LABEL_FONT,
  ZoneShape,
  boxOf,
  setStageCursor,
  strokeWidthOf,
} from './shapes'
import { useCanvasTheme, type CanvasTheme } from './theme'

// Seat marker — the caller translates its own meaning into drawing vocabulary. A seat without a marker is empty
// (empty chair). Both kinds fill the chair (someone sits there, or cannot); they differ in what the desk wears.
export type SeatMarker =
  // Someone is seated — the desk takes `color` (any CSS colour, e.g. `var(--brand)`), the name sits in the
  // middle, an optional warning dot top-right and a group dot bottom-right (same colour = same group).
  | { kind: 'occupant'; color: string; text: string; warningDot?: boolean; groupColor?: string }
  // Not selectable (already booked, another zone, …) — desk and chair fill with ink.
  | { kind: 'blocked' }

type Props<Z extends string> = {
  plan: ZoneSeatPlan<Z> // a whole plan or a zone crop
  width: number // stage pixel size — measured by the parent
  height: number
  fitPadding: number // padding around the drawing when fitting (px)
  markers: Record<string, SeatMarker> // seat id → marker
  selectedSeatIds?: readonly string[] // empty picked seats fill with the accent; occupied ones get an outer ring
  hoverSeatIds?: readonly string[] // seats highlighted from elsewhere (list rows, …) — same look as hovering
  view?: SeatMapView | null // controlled view — null/omitted keeps the fit view
  onViewChange?(view: SeatMapView): void // enables panning (stage drag) and commits view changes
  gestureZoom?: boolean // wheel/pinch zoom — leave off for small panels that compete with page scroll
  zoneLabel?(zone: Zone<Z>): string | null // name above each room (plans with 2+ zones). Defaults to the zone id
  fixtureLabel?(kind: FixtureKind): string | null // name on TV/counter fixtures. Defaults to none
  onSeatClick?(seat: Seat<Z>): void
  onSeatHover?(seat: Seat<Z> | null): void
}

// Seat plan canvas — a static fit render by default; pass view/onViewChange for panning (plus optional
// wheel/pinch zoom). Client only: load it without SSR (it reads the theme from the live document).
export function SeatMapStage<Z extends string>({
  plan,
  width,
  height,
  fitPadding,
  markers,
  selectedSeatIds,
  hoverSeatIds,
  view: controlledView,
  onViewChange,
  gestureZoom,
  zoneLabel = zoneIdLabel,
  fixtureLabel,
  onSeatClick,
  onSeatHover,
}: Props<Z>) {
  const theme = useCanvasTheme()
  const view = controlledView ?? fitView(plan, { width, height }, fitPadding)

  // Pinch state — the previous two-finger distance, and whether we paused a pan for the pinch.
  const pinchDistance = useRef<number | null>(null)
  const pausedDrag = useRef(false)

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    if (!onViewChange) return
    e.evt.preventDefault()
    const pointer = e.target.getStage()?.getPointerPosition()
    if (!pointer) return
    const factor = e.evt.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP
    onViewChange(zoomView(view, { factor, center: pointer, fitScale: fitScaleOf(plan, { width, height }) }))
  }

  // Two-finger zoom — Konva has no pinch, so touch distance is read directly. It competes with stage panning,
  // so the pan is paused while two fingers are down and resumed when one remains (Konva does not resume by
  // itself after stopDrag).
  function handleTouchMove(e: Konva.KonvaEventObject<TouchEvent>) {
    if (!onViewChange) return
    const stage = e.target.getStage()
    if (!stage) return
    const first = e.evt.touches[0]
    const second = e.evt.touches[1]

    if (first && !second) {
      if (pausedDrag.current && !stage.isDragging()) {
        stage.startDrag()
        pausedDrag.current = false
      }
      return
    }
    if (!first || !second) return

    e.evt.preventDefault()
    if (stage.isDragging()) {
      pausedDrag.current = true
      stage.stopDrag() // also commits the pan (onDragEnd) — the first pinch frame is skipped below
    }

    const box = stage.container().getBoundingClientRect()
    const center = {
      x: (first.clientX + second.clientX) / 2 - box.left,
      y: (first.clientY + second.clientY) / 2 - box.top,
    }
    const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
    const previous = pinchDistance.current
    pinchDistance.current = distance
    // The first frame only records the baseline — zooming starts after the pan committed above lands.
    if (previous === null || previous === 0) return

    onViewChange(zoomView(view, { factor: distance / previous, center, fitScale: fitScaleOf(plan, { width, height }) }))
  }

  function handleTouchEnd(e: Konva.KonvaEventObject<TouchEvent>) {
    // Lifting one finger only drops the pinch baseline — resuming the remaining finger's pan is touchmove's job,
    // so pausedDrag survives until every finger is up (clearing it here would lose the pan for good).
    pinchDistance.current = null
    if (e.evt.touches.length === 0) pausedDrag.current = false
  }

  return (
    <Stage
      width={width}
      height={height}
      scaleX={view.scale}
      scaleY={view.scale}
      x={view.x}
      y={view.y}
      draggable={!!onViewChange}
      onWheel={gestureZoom ? handleWheel : undefined}
      onTouchMove={gestureZoom ? handleTouchMove : undefined}
      onTouchEnd={gestureZoom ? handleTouchEnd : undefined}
      onDragEnd={(e) => {
        // Pan commit — seat nodes are not draggable, so only the stage arrives here.
        const stage = e.target.getStage()
        if (onViewChange && stage && e.target === stage) onViewChange({ ...view, x: stage.x(), y: stage.y() })
      }}
    >
      {/* Floor — rooms, walls, names and fixtures. Display only, so out of hit testing. No grid: cells are an
          editing tool, not part of the drawing. */}
      <Layer listening={false}>
        {plan.zones.map((zone) => (
          <Group key={zone.id} x={zone.x} y={zone.y}>
            <ZoneShape
              zone={zone}
              theme={theme}
              scale={view.scale}
              label={seatPlan.showsZoneLabels(plan) ? zoneLabel(zone) : null}
              ink={theme.ink}
            />
          </Group>
        ))}
        {plan.fixtures.map((fixture) => (
          <Group key={fixture.id} x={fixture.x} y={fixture.y}>
            <FixtureShape fixture={fixture} theme={theme} text={fixtureLabel?.(fixture.kind) ?? null} />
          </Group>
        ))}
      </Layer>

      <Layer>
        {plan.seats.map((seat) => (
          <SeatNode
            key={seat.id}
            seat={seat}
            marker={markers[seat.id]}
            theme={theme}
            scale={view.scale}
            selected={selectedSeatIds?.includes(seat.id) ?? false}
            externalHover={hoverSeatIds?.includes(seat.id) ?? false}
            onClick={onSeatClick}
            onHover={onSeatHover}
          />
        ))}
      </Layer>
    </Stage>
  )
}

// Occupied desks move the number to the top-left and give the centre to the name.
const OCCUPANT_LABEL_FONT = 16
const OCCUPANT_LABEL_BAND = 14
// Name fitting — assumes a glyph is about as wide as the font size (true for Hangul/CJK) and shrinks to the desk
// width. Only names that would fall below the minimum are ellipsized.
const NAME_MAX_FONT = 26
const NAME_MIN_FONT = 15

// One seat — desk and chair. An empty seat has an empty chair; an occupied or blocked seat fills it.
function SeatNode<Z extends string>({
  seat,
  marker,
  theme,
  scale,
  selected,
  externalHover,
  onClick,
  onHover,
}: {
  seat: Seat<Z>
  marker: SeatMarker | undefined
  theme: CanvasTheme
  scale: number // current view scale — sets the on-screen floor of the selection ring
  selected: boolean
  externalHover: boolean // highlighted from outside — same look as hovering, cursor unaffected
  onClick?(seat: Seat<Z>): void
  onHover?(seat: Seat<Z> | null): void
}) {
  const [hovered, setHovered] = useState(false)
  const { desk, chair } = seatPlan.furnitureOf(seat)
  const occupant = marker?.kind === 'occupant' ? marker : null
  const blocked = marker?.kind === 'blocked'
  const toneColor = occupant ? theme.resolve(occupant.color) : null
  // An empty seat that is picked — the desk fills with the accent.
  const picked = selected && !marker
  const clickable = !!onClick && !blocked
  // Hover emphasis only for seats you can press, or when highlighted from outside.
  const showHover = (clickable && hovered) || externalHover
  // Emphasis colour — an occupied seat's own colour, otherwise the accent.
  const accent = toneColor ?? theme.accent
  // A blocked seat fills the whole place with ink — a filled chair alone does not separate it at a glance.
  const deskFill = picked ? theme.accent : blocked ? theme.ink : theme.surface
  const deskStroke = picked ? theme.accent : blocked ? theme.ink : (toneColor ?? (showHover ? accent : theme.label))
  const chairFill = marker ? theme.ink : theme.surface
  const chairStroke = picked ? theme.accent : marker ? theme.ink : theme.label
  const handleClick = clickable ? () => onClick?.(seat) : undefined

  return (
    <Group
      x={seat.x}
      y={seat.y}
      listening={!!onClick}
      onClick={handleClick}
      onTap={handleClick}
      onMouseEnter={(e) => {
        setStageCursor(e, clickable ? 'pointer' : 'default')
        setHovered(true)
        onHover?.(seat)
      }}
      onMouseLeave={(e) => {
        setStageCursor(e, 'default')
        setHovered(false)
        onHover?.(null)
      }}
    >
      {/* Hit area — the whole seat, including the gap between desk and chair. */}
      <Rect width={seat.w} height={seat.h} fill="transparent" />
      <Rect {...boxOf(desk)} cornerRadius={DESK_RADIUS} fill={deskFill} />
      {/* Occupied tint — a separate layer so the face stays light while the border takes the full colour. */}
      {toneColor && (
        <Rect {...boxOf(desk)} cornerRadius={DESK_RADIUS} fill={toneColor} opacity={theme.occupiedTintOpacity} />
      )}
      {showHover && <Rect {...boxOf(desk)} cornerRadius={DESK_RADIUS} fill={accent} opacity={0.18} />}
      <Rect
        {...boxOf(desk)}
        cornerRadius={DESK_RADIUS}
        stroke={deskStroke}
        strokeWidth={toneColor ? OCCUPANT_LINE_PX : FURNITURE_LINE_PX}
        strokeScaleEnabled={false}
      />
      <Rect
        {...boxOf(chair)}
        cornerRadius={CHAIR_RADIUS}
        fill={chairFill}
        stroke={chairStroke}
        strokeWidth={picked ? OCCUPANT_LINE_PX : FURNITURE_LINE_PX}
        strokeScaleEnabled={false}
      />
      {/* Selection ring — an occupied desk already wears its colour, so selection shows as an ink ring outside. */}
      {selected && marker && (
        <Rect
          x={-7}
          y={-7}
          width={seat.w + 14}
          height={seat.h + 14}
          cornerRadius={10}
          stroke={theme.ink}
          strokeWidth={strokeWidthOf(3, scale)}
        />
      )}
      {occupant ? (
        <OccupantLabels seat={seat} desk={desk} occupant={occupant} theme={theme} />
      ) : (
        <Text
          {...boxOf(desk)}
          align="center"
          verticalAlign="middle"
          text={seat.id}
          fontSize={SEAT_LABEL_FONT}
          fontStyle="600"
          fontFamily={theme.numberFontFamily}
          fill={picked ? theme.accentForeground : blocked ? theme.inkForeground : theme.label}
        />
      )}
    </Group>
  )
}

// Occupied desk text and dots — number top-left, name in the middle, warning/group dots on the right corners.
function OccupantLabels({
  seat,
  desk,
  occupant,
  theme,
}: {
  seat: Seat
  desk: PlanRect
  occupant: Extract<SeatMarker, { kind: 'occupant' }>
  theme: CanvasTheme
}) {
  const nameFontSize = nameFontSizeOf(desk.w, occupant.text)
  return (
    <>
      <Text
        x={desk.x + 7}
        y={desk.y + 6}
        text={seat.id}
        fontSize={OCCUPANT_LABEL_FONT}
        fontStyle="600"
        fontFamily={theme.numberFontFamily}
        fill={theme.label}
      />
      <Text
        x={desk.x + 4}
        y={desk.y + OCCUPANT_LABEL_BAND}
        width={desk.w - 8}
        height={desk.h - OCCUPANT_LABEL_BAND}
        align="center"
        verticalAlign="middle"
        text={occupant.text}
        fontSize={nameFontSize}
        fontStyle="600"
        fontFamily={theme.fontFamily}
        fill={theme.ink}
        wrap="none"
        ellipsis
      />
      {occupant.warningDot && <Circle x={desk.x + desk.w - 11} y={desk.y + 11} radius={6} fill={theme.warning} />}
      {occupant.groupColor && (
        <Circle
          x={desk.x + desk.w - 11}
          y={desk.y + desk.h - 11}
          radius={6}
          fill={theme.resolve(occupant.groupColor)}
        />
      )}
    </>
  )
}

function nameFontSizeOf(deskWidth: number, text: string): number {
  return Math.min(Math.max((deskWidth - 12) / text.length, NAME_MIN_FONT), NAME_MAX_FONT)
}

function zoneIdLabel(zone: { id: string }): string {
  return zone.id
}
