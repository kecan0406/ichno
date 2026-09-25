import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { SECTION_LABEL_BAND, SECTION_LABEL_FONT, WALL_THICKNESS, seatPlan } from '../core/geometry'
import { GRID_CELL } from '../core/grid'
import type { Fixture, Place, PlanHandle, PlanPoint, PlanRect, Row, SeatPlan, Section, Table } from '../core/types'
import { planView, type PlanView } from '../core/view'
import { FONT_VAR, NUMBER_FONT_VAR, cssVar } from '../theme/vars'

// Headless SVG parts — each renders plain SVG with `data-*` state and `data-part` names, painted with
// presentation attributes that read the theme variables. Any `className` (Tailwind, CSS modules) overrides those
// attributes, so an unstyled plan looks right and a styled one needs no escape hatches.
// No hooks and no event handlers: every part renders as a React Server Component. Interaction lives in
// `SeatMap.Viewport`, which delegates events by `data-ichno-*` attributes.

type GProps = Omit<ComponentProps<'g'>, 'children'>

type RootProps = Omit<ComponentProps<'svg'>, 'viewBox'> & {
  plan: Pick<SeatPlan, 'width' | 'height' | 'sections'>
  // The part of the plan to show (plan units). Defaults to the whole drawing.
  view?: PlanView
}

// A read-only plan — an <svg> whose viewBox frames the drawing. It fills the container width and keeps the
// drawing's aspect ratio.
export function Root({ plan, view, style, children, ...rest }: RootProps) {
  const box = view ?? planView.home(plan)
  return (
    <svg
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      data-ichno-root=""
      style={{ display: 'block', width: '100%', height: 'auto', fontFamily: `var(${FONT_VAR})`, ...style }}
      {...rest}
    >
      {children}
    </svg>
  )
}

type SectionProps = GProps & {
  section: Section
  // Written above the section's wall — plain text or <tspan>s (e.g. a name and a free-seat count).
  label?: ReactNode
}

// One section — its floor, the outer wall just outside the outline, and an optional name above it.
export function SectionPart({ section, label, ...rest }: SectionProps) {
  const bounds = seatPlan.sectionBoundsOf(section)
  return (
    <g data-ichno-section={section.id} {...rest}>
      <polygon data-part="floor" points={pointsOf(section.points)} fill={cssVar('surface')} />
      <polygon
        data-part="wall"
        points={pointsOf(seatPlan.sectionWallOf(section))}
        fill="none"
        stroke={cssVar('ink')}
        strokeWidth={WALL_THICKNESS}
      />
      {label != null && label !== false && (
        <text
          data-part="label"
          x={bounds.x - WALL_THICKNESS}
          y={bounds.y - SECTION_LABEL_BAND + 10 + SECTION_LABEL_FONT * 0.8}
          fontSize={SECTION_LABEL_FONT}
          fontWeight={700}
          fill={cssVar('ink')}
        >
          {label}
        </text>
      )}
    </g>
  )
}

export type PlaceProps = GProps & {
  place: Place
  // The consumer's status word (e.g. 'booked', 'held') — exposed as data-status, never interpreted.
  status?: string
  selected?: boolean
  // Cannot be picked — drawn filled with ink (booked, blocked, another zone's place).
  disabled?: boolean
  // Emphasised from elsewhere (a list row under the pointer) — drawn like a hover.
  highlighted?: boolean
  // Pushed back (filtered out, spotlight elsewhere).
  dimmed?: boolean
  // In conflict — overlapping another object (the editor's `conflictIds`).
  invalid?: boolean
  // What to write on the place. Defaults to its label; null draws none.
  label?: ReactNode
  // Extra drawing in the place's local coordinates (origin at the top-left of `place.bounds`).
  children?: ReactNode
}

// One bookable place — a desk with its chair, a seat, a booth, an area or a whole table. The outer <g> carries
// the state as data attributes and listbox-option semantics for the viewport.
export function PlacePart({
  place,
  status,
  selected,
  disabled,
  highlighted,
  dimmed,
  invalid,
  label,
  children,
  ...rest
}: PlaceProps) {
  const { w, h } = place.bounds
  const tone = selected ? TONES.selected : disabled ? TONES.disabled : TONES.idle
  const stroke = invalid ? cssVar('warning') : highlighted && !selected ? cssVar('accent') : tone.stroke
  const text = label === undefined ? place.label : label
  const shapeProps = {
    'data-part': 'shape',
    fill: tone.fill,
    stroke,
    strokeWidth: LINE_WIDTH,
    vectorEffect: 'non-scaling-stroke' as const,
  }
  return (
    <g
      transform={`translate(${round(place.bounds.x)} ${round(place.bounds.y)})`}
      data-ichno-id={place.id}
      data-ichno-object={place.parent?.id ?? place.id}
      data-kind={place.kind}
      data-status={status}
      data-category={place.category}
      data-chair-side={place.chairSide}
      data-selected={selected ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
      data-highlighted={highlighted ? '' : undefined}
      data-dimmed={dimmed ? '' : undefined}
      data-invalid={invalid ? '' : undefined}
      role="option"
      aria-selected={selected ?? false}
      aria-disabled={disabled || undefined}
      aria-label={place.label}
      opacity={dimmed ? DIMMED_OPACITY : undefined}
      {...rest}
    >
      {place.kind === 'desk' && place.chairSide ? (
        <DeskShape w={w} h={h} chairSide={place.chairSide} tone={tone} stroke={stroke} />
      ) : place.shape === 'circle' ? (
        <circle {...shapeProps} cx={w / 2} cy={h / 2} r={w / 2} />
      ) : place.shape === 'ellipse' ? (
        <ellipse {...shapeProps} cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} />
      ) : (
        <rect {...shapeProps} width={w} height={h} rx={RECT_RADIUS} />
      )}
      {text != null && text !== false && (
        <PlaceLabel place={place} fill={tone.label}>
          {text}
        </PlaceLabel>
      )}
      {children}
    </g>
  )
}

type FixtureProps = GProps & {
  fixture: Fixture
  // `wall` paints an ink band along the long edge; `box` a sunken face with an optional name.
  variant?: 'box' | 'wall'
  // Name written along the long edge (box only) — dropped when it does not fit.
  label?: string | null
  // In conflict — standing on a place (the editor's `conflictIds`).
  invalid?: boolean
}

// A non-bookable element (wall, TV, counter, stage, …) — its role is exposed as data-role.
export function FixturePart({ fixture, variant = 'box', label, invalid, ...rest }: FixtureProps) {
  const layout = variant === 'box' ? seatPlan.fixtureLabelOf(fixture, label) : null
  const cx = fixture.w / 2
  const cy = fixture.h / 2
  return (
    <g
      transform={`translate(${fixture.x} ${fixture.y})`}
      data-ichno-object={fixture.id}
      data-kind="fixture"
      data-role={fixture.role}
      data-invalid={invalid ? '' : undefined}
      {...rest}
    >
      {variant === 'wall' ? (
        <>
          {/* The wall paints only a band — the whole rectangle stays grabbable. */}
          <rect data-part="hit" width={fixture.w} height={fixture.h} fill="transparent" />
          <rect
            data-part="shape"
            {...rectOf(seatPlan.innerWallOf(fixture))}
            fill={invalid ? cssVar('warning') : cssVar('ink')}
          />
        </>
      ) : (
        <rect
          data-part="shape"
          width={fixture.w}
          height={fixture.h}
          rx={2}
          fill={cssVar('fixture')}
          stroke={invalid ? cssVar('warning') : cssVar('label')}
          strokeWidth={LINE_WIDTH}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {layout && (
        <text
          data-part="label"
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={layout.fontSize}
          fontWeight={700}
          fill={cssVar('label')}
          // Tall fixtures read bottom-to-top, rotated about their centre.
          transform={layout.vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
        >
          {layout.text}
        </text>
      )}
    </g>
  )
}

// A table's furniture — the top when its seats are booked one by one (the seats are places), or the chairs when
// the whole table is one place (the top is the place).
export function TablePart({ table, ...rest }: GProps & { table: Table }) {
  const shape = { fill: cssVar('surface'), stroke: cssVar('label'), strokeWidth: LINE_WIDTH }
  return (
    <g data-ichno-object={table.id} data-kind="table" {...rest}>
      {table.wholeBooking ? (
        seatPlan
          .tableSeatsOf(table)
          .map(({ seat, center }) => (
            <circle
              key={seat.id}
              data-part="chair"
              cx={round(center.x)}
              cy={round(center.y)}
              r={table.seatSize / 2}
              {...shape}
              vectorEffect="non-scaling-stroke"
            />
          ))
      ) : table.shape === 'round' ? (
        <ellipse
          data-part="top"
          cx={table.x + table.w / 2}
          cy={table.y + table.h / 2}
          rx={table.w / 2}
          ry={table.h / 2}
          {...shape}
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <rect data-part="top" {...rectOf(table)} rx={RECT_RADIUS} {...shape} vectorEffect="non-scaling-stroke" />
      )}
    </g>
  )
}

// The editor's cell grid — cell edges plus the plan outline, 1px on screen at any zoom. Not part of the drawing.
export function GridPart({ plan, ...rest }: GProps & { plan: Pick<SeatPlan, 'width' | 'height'> }) {
  let d = ''
  for (let x = GRID_CELL; x < plan.width; x += GRID_CELL) d += `M${x} 0V${plan.height}`
  for (let y = GRID_CELL; y < plan.height; y += GRID_CELL) d += `M0 ${y}H${plan.width}`
  return (
    <g data-part="grid" pointerEvents="none" {...rest}>
      <path d={d} stroke={cssVar('grid')} strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
      <rect
        width={plan.width}
        height={plan.height}
        stroke={cssVar('grid')}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        fill="none"
      />
    </g>
  )
}

type RowLabelProps = GProps & {
  row: Row
  // Defaults to the row's label; nothing is drawn without one.
  label?: ReactNode
  // Which ends of the row carry the label.
  ends?: 'both' | 'start' | 'end'
}

// A row's label beside its first and last seat — tapping it selects the row.
export function RowLabelPart({ row, label, ends = 'both', ...rest }: RowLabelProps) {
  const text = label === undefined ? row.label : label
  if (text == null || text === false || text === '') return null
  const anchors = seatPlan.rowLabelAnchorsOf(row)
  const points = ends === 'both' ? [anchors.start, anchors.end] : [anchors[ends]]
  const fontSize = rowLabelFont(row)
  return (
    <g data-ichno-object={row.id} data-kind="row" data-part="row-label" {...rest}>
      {points.map((point, i) => (
        <text
          key={i}
          x={round(point.x)}
          y={round(point.y)}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fontWeight={700}
          fill={cssVar('label')}
        >
          {text}
        </text>
      ))}
    </g>
  )
}

// Editing handles — squares for corners and row ends, a dot for a row's curve. They keep a fixed screen size at
// any zoom (a zero-length stroke that does not scale), and carry the attributes the viewport reads to drag them.
export function HandlesPart({ handles, ...rest }: GProps & { handles: readonly PlanHandle[] }) {
  return (
    <g data-part="handles" {...rest}>
      {handles.map((handle) => {
        const d = `M${round(handle.point.x)} ${round(handle.point.y)}h0`
        const cap = handle.name === 'curve' ? 'round' : 'square'
        return (
          <g
            key={`${handle.owner.kind}:${handle.owner.id}:${handle.name}`}
            data-part="handle"
            data-ichno-handle={handle.name}
            data-ichno-owner={handle.owner.id}
            data-ichno-owner-kind={handle.owner.kind}
            style={{ cursor: HANDLE_CURSORS[handle.name] ?? 'move' }}
          >
            <path
              d={d}
              stroke={cssVar('accent')}
              strokeWidth={HANDLE_PX}
              strokeLinecap={cap}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={d}
              stroke={cssVar('surface')}
              strokeWidth={HANDLE_PX - 4}
              strokeLinecap={cap}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      })}
    </g>
  )
}

// The rubber band of a marquee selection.
export function MarqueePart({ rect, ...rest }: GProps & { rect: PlanRect | null }) {
  if (!rect) return null
  return (
    <g data-part="marquee" pointerEvents="none" {...rest}>
      <rect
        {...rectOf(rect)}
        fill={cssVar('accent')}
        fillOpacity={0.08}
        stroke={cssVar('accent')}
        strokeWidth={1}
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  )
}

function DeskShape({
  w,
  h,
  chairSide,
  tone,
  stroke,
}: {
  w: number
  h: number
  chairSide: NonNullable<Place['chairSide']>
  tone: Tone
  stroke: string
}) {
  const { desk, chair } = seatPlan.furnitureOf({ w, h, chairSide })
  const line = { strokeWidth: LINE_WIDTH, vectorEffect: 'non-scaling-stroke' as const }
  return (
    <>
      <rect data-part="shape" {...rectOf(desk)} rx={RECT_RADIUS} fill={tone.fill} stroke={stroke} {...line} />
      <rect data-part="chair" {...rectOf(chair)} rx={CHAIR_RADIUS} fill={tone.chair} stroke={tone.stroke} {...line} />
    </>
  )
}

// Labels sit in the middle of the desk top (not the chair) or of the shape, sized to fit small seats.
function PlaceLabel({ place, fill, children }: { place: Place; fill: string; children: ReactNode }) {
  const { w, h } = place.bounds
  const center: PlanPoint =
    place.kind === 'desk' && place.chairSide
      ? centerOf(seatPlan.furnitureOf({ w, h, chairSide: place.chairSide }).desk)
      : { x: w / 2, y: h / 2 }
  const fontSize = placeLabelFont(place)
  return (
    <text
      data-part="label"
      x={center.x}
      y={center.y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={fontSize}
      fontWeight={600}
      fill={fill}
      style={NUMBER_FONT_STYLE}
    >
      {children}
    </text>
  )
}

// A place label's font size in plan units — small seats get a smaller number.
export function placeLabelFont(place: Pick<Place, 'shape' | 'bounds'>): number {
  return place.shape === 'circle' ? Math.min(SEAT_LABEL_FONT, Math.max(8, place.bounds.w * 0.42)) : SEAT_LABEL_FONT
}

// A row label's font size in plan units.
export function rowLabelFont(row: Pick<Row, 'seatSize'>): number {
  return Math.min(SEAT_LABEL_FONT, Math.max(10, row.seatSize * 0.5))
}

type Tone = { fill: string; chair: string; stroke: string; label: string }

// Default looks per state — presentation attributes, so consumer CSS wins over all of them.
const TONES = {
  idle: { fill: cssVar('surface'), chair: cssVar('surface'), stroke: cssVar('label'), label: cssVar('label') },
  selected: {
    fill: cssVar('accent'),
    chair: cssVar('surface'),
    stroke: cssVar('accent'),
    label: cssVar('accentForeground'),
  },
  disabled: { fill: cssVar('ink'), chair: cssVar('ink'), stroke: cssVar('ink'), label: cssVar('inkForeground') },
} satisfies Record<string, Tone>

// Printed coordinates — rounded to hundredths. Row and table seats come from trigonometry, whose last bits differ
// between JavaScript engines; unrounded, a server-rendered plan would not match the browser's and fail hydration.
function pointsOf(points: readonly PlanPoint[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function rectOf(rect: PlanRect) {
  return { x: rect.x, y: rect.y, width: rect.w, height: rect.h }
}

function centerOf(rect: PlanRect): PlanPoint {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

// Seat number font (plan units) — always drawn regardless of scale; a small number beats none.
const SEAT_LABEL_FONT = 20
const RECT_RADIUS = 4
const CHAIR_RADIUS = 7
const LINE_WIDTH = 1.5
const DIMMED_OPACITY = 0.35
// Handle size in screen pixels.
const HANDLE_PX = 12
const HANDLE_CURSORS: Partial<Record<string, string>> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  curve: 'grab',
  start: 'grab',
  end: 'grab',
}
// Unset variables are invalid at computed-value time, so the number font falls back to the inherited font.
const NUMBER_FONT_STYLE: CSSProperties = { fontFamily: `var(${NUMBER_FONT_VAR}, var(${FONT_VAR}))` }
