import type { ComponentProps, CSSProperties } from 'react'
import { WALL_THICKNESS, ZONE_LABEL_BAND, ZONE_LABEL_FONT, seatPlan } from '../core/geometry'
import type { Fixture, FixtureKind, PlanRect, Seat, Zone, ZoneSeatPlan } from '../core/types'
import { FONT_VAR, NUMBER_FONT_VAR, cssVar } from '../theme/vars'

export type SvgZoneLabel = string | { title: string; detail?: string }

type Props<Z extends string> = Omit<ComponentProps<'svg'>, 'children'> & {
  plan: ZoneSeatPlan<Z>
  // Seats shown as in use. Occupancy has a single look here — the viewer never tells people apart.
  occupiedSeatIds: readonly string[]
  // Name written above each room (only when the plan holds more than one zone). `detail` is set smaller after
  // the title, e.g. a free-seat count. Defaults to the zone id.
  zoneLabel?(zone: Zone<Z>, counts: { free: number; total: number }): SvgZoneLabel | null
  // Name drawn on TV/counter fixtures. Walls are never labelled. Defaults to no label.
  fixtureLabel?(kind: FixtureKind): string | null
}

// A read-only seat plan as SVG — renders on the server, so the drawing arrives with the page in one paint
// (no hydration, chunk load or measuring). The viewBox sizes it: it fills the container width and keeps the
// drawing's aspect ratio. Colours come from the theme CSS variables, so dark mode switches in CSS alone.
// The drawing grammar matches the canvas renderers (ichno/konva).
export function SeatMapSvg<Z extends string>({
  plan,
  occupiedSeatIds,
  zoneLabel = zoneIdLabel,
  fixtureLabel,
  style,
  ...rest
}: Props<Z>) {
  // A cropped plan may receive other zones' seat ids — only its own seats are looked up.
  const occupied = new Set(occupiedSeatIds)
  const bounds = seatPlan.drawingBoundsOf(plan)
  const labeled = seatPlan.showsZoneLabels(plan)

  return (
    <svg
      viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
      style={{ display: 'block', width: '100%', height: 'auto', fontFamily: `var(${FONT_VAR})`, ...style }}
      {...rest}
    >
      {/* Floor — room surface, the outer wall outside the room rectangle, and the room name above it. */}
      {plan.zones.map((zone) => {
        const seats = plan.seats.filter((seat) => seat.zone === zone.id)
        const counts = { free: seats.filter((seat) => !occupied.has(seat.id)).length, total: seats.length }
        const label = labeled ? normalizeLabel(zoneLabel(zone, counts)) : null
        return (
          <g key={zone.id}>
            <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} fill={cssVar('surface')} />
            <rect
              x={zone.x - WALL_THICKNESS / 2}
              y={zone.y - WALL_THICKNESS / 2}
              width={zone.w + WALL_THICKNESS}
              height={zone.h + WALL_THICKNESS}
              fill="none"
              stroke={cssVar('ink')}
              strokeWidth={WALL_THICKNESS}
            />
            {label && (
              <text x={zone.x - WALL_THICKNESS} y={ZONE_LABEL_BASELINE} fontSize={ZONE_LABEL_FONT}>
                <tspan fontWeight={700} fill={cssVar('ink')}>
                  {label.title}
                </tspan>
                {label.detail && (
                  <tspan dx={14} fontSize={ZONE_DETAIL_FONT} fontWeight={500} fill={cssVar('label')}>
                    {label.detail}
                  </tspan>
                )}
              </text>
            )}
          </g>
        )
      })}

      {plan.fixtures.map((fixture) => (
        <FixtureSvg key={fixture.id} fixture={fixture} text={fixtureLabel?.(fixture.kind) ?? null} />
      ))}

      {plan.seats.map((seat) => (
        <SeatSvg key={seat.id} seat={seat} taken={occupied.has(seat.id)} />
      ))}
    </svg>
  )
}

// One seat — desk and chair. A free seat is outlined; a taken seat fills desk and chair with ink and inverts
// its number (filling only the chair does not separate it from free seats at a glance).
function SeatSvg({ seat, taken }: { seat: Seat; taken: boolean }) {
  const { desk, chair } = seatPlan.furnitureOf(seat)
  const fill = taken ? cssVar('ink') : cssVar('surface')
  const stroke = taken ? cssVar('ink') : cssVar('label')
  return (
    <g transform={`translate(${seat.x} ${seat.y})`}>
      <rect
        {...rectOf(desk)}
        rx={DESK_RADIUS}
        fill={fill}
        stroke={stroke}
        strokeWidth={LINE_WIDTH}
        vectorEffect="non-scaling-stroke"
      />
      <rect
        {...rectOf(chair)}
        rx={CHAIR_RADIUS}
        fill={fill}
        stroke={stroke}
        strokeWidth={LINE_WIDTH}
        vectorEffect="non-scaling-stroke"
      />
      <text
        x={desk.x + desk.w / 2}
        y={desk.y + desk.h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={SEAT_LABEL_FONT}
        fontWeight={600}
        fill={taken ? cssVar('inkForeground') : cssVar('label')}
        style={NUMBER_FONT_STYLE}
      >
        {seat.id}
      </text>
    </g>
  )
}

// One fixture — walls are an ink centre band like the outer wall; TVs and counters are a sunken face with a name.
function FixtureSvg({ fixture, text }: { fixture: Fixture; text: string | null }) {
  if (fixture.kind === 'wall') {
    const bar = seatPlan.innerWallOf(fixture)
    return <rect {...rectOf({ ...bar, x: fixture.x + bar.x, y: fixture.y + bar.y })} fill={cssVar('ink')} />
  }
  const label = seatPlan.fixtureLabelOf(fixture, text)
  const cx = fixture.w / 2
  const cy = fixture.h / 2
  return (
    <g transform={`translate(${fixture.x} ${fixture.y})`}>
      <rect
        width={fixture.w}
        height={fixture.h}
        rx={FIXTURE_RADIUS[fixture.kind]}
        fill={cssVar('fixture')}
        stroke={fixture.kind === 'tv' ? cssVar('ink') : cssVar('label')}
        strokeWidth={LINE_WIDTH}
        vectorEffect="non-scaling-stroke"
      />
      {label && (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={label.fontSize}
          fontWeight={700}
          fill={cssVar('label')}
          // Tall fixtures read bottom-to-top, rotated about their centre.
          transform={label.vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
        >
          {label.text}
        </text>
      )}
    </g>
  )
}

function normalizeLabel(label: SvgZoneLabel | null): { title: string; detail?: string } | null {
  if (label === null) return null
  return typeof label === 'string' ? { title: label } : label
}

function rectOf(rect: PlanRect) {
  return { x: rect.x, y: rect.y, width: rect.w, height: rect.h }
}

const FIXTURE_RADIUS: Record<Exclude<FixtureKind, 'wall'>, number> = { tv: 2, counter: 10 }
// Seat number font (plan units) — always drawn regardless of scale; a small number beats none.
const SEAT_LABEL_FONT = 20
const DESK_RADIUS = 4
const CHAIR_RADIUS = 7
const LINE_WIDTH = 1.5
// Room name baseline — the same spot as the canvas text box (10 below the band top). The detail continues on
// the same baseline one size smaller.
const ZONE_LABEL_BASELINE = -ZONE_LABEL_BAND + 10 + ZONE_LABEL_FONT * 0.8
const ZONE_DETAIL_FONT = 22
// Unset variables are invalid at computed-value time, so the number font falls back to the inherited font.
const NUMBER_FONT_STYLE: CSSProperties = { fontFamily: `var(${NUMBER_FONT_VAR}, var(${FONT_VAR}))` }

function zoneIdLabel(zone: { id: string }): string {
  return zone.id
}
