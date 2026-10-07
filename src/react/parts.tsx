import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { SECTION_LABEL_BAND, SECTION_LABEL_FONT, WALL_THICKNESS, groupLabelFont, seatPlan } from '../core/geometry'
import { GRID_CELL } from '../core/grid'
import type {
  Fixture,
  GroupLabel,
  Place,
  PlanBox,
  PlanHandle,
  PlanPoint,
  PlanRect,
  SeatPlan,
  Section,
} from '../core/types'
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
  // In conflict — overlapping another place (the editor's `conflictIds`).
  invalid?: boolean
  // What to write on the place. Defaults to its label (or id); null draws none.
  label?: ReactNode
  // Extra drawing in the place's local coordinates (origin at its top-left, turned with it).
  children?: ReactNode
}

// One bookable place — a seat, a desk, a booth, an area, a whole table. The outer <g> carries the state as data
// attributes and listbox-option semantics for the viewport. The label stays upright when the place is turned.
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
  const { w, h } = place
  const tone = selected ? TONES.selected : disabled ? TONES.disabled : TONES.idle
  const stroke = invalid ? cssVar('warning') : highlighted && !selected ? cssVar('accent') : tone.stroke
  const text = label === undefined ? (place.label ?? place.id) : label
  const shapeProps = {
    'data-part': 'shape',
    fill: tone.fill,
    stroke,
    strokeWidth: LINE_WIDTH,
    vectorEffect: 'non-scaling-stroke' as const,
  }
  return (
    <g
      transform={transformOf(place)}
      data-ichno-id={place.id}
      data-kind="place"
      data-shape={place.shape}
      data-role={place.role}
      data-group={place.group}
      data-status={status}
      data-category={place.category}
      data-selected={selected ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
      data-highlighted={highlighted ? '' : undefined}
      data-dimmed={dimmed ? '' : undefined}
      data-invalid={invalid ? '' : undefined}
      role="option"
      aria-selected={selected ?? false}
      aria-disabled={disabled || undefined}
      aria-label={place.label ?? place.id}
      opacity={dimmed ? DIMMED_OPACITY : undefined}
      {...rest}
    >
      {place.shape === 'ellipse' ? (
        <ellipse {...shapeProps} cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} />
      ) : (
        <rect {...shapeProps} width={w} height={h} rx={RECT_RADIUS} />
      )}
      {text != null && text !== false && (
        <text
          data-part="label"
          x={w / 2}
          y={h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={placeLabelFont(place)}
          fontWeight={600}
          fill={tone.label}
          transform={uprightOf(place)}
          style={NUMBER_FONT_STYLE}
        >
          {text}
        </text>
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
}

// A non-bookable element (wall, stage, table top, chair, …) — its role is exposed as data-role.
export function FixturePart({ fixture, variant = 'box', label, ...rest }: FixtureProps) {
  const layout = variant === 'box' ? seatPlan.fixtureLabelOf(fixture, label) : null
  const cx = fixture.w / 2
  const cy = fixture.h / 2
  const face = {
    'data-part': 'shape',
    fill: cssVar('fixture'),
    stroke: cssVar('label'),
    strokeWidth: LINE_WIDTH,
    vectorEffect: 'non-scaling-stroke' as const,
  }
  return (
    <g
      transform={transformOf(fixture)}
      data-ichno-object={fixture.id}
      data-kind="fixture"
      data-shape={fixture.shape}
      data-role={fixture.role}
      data-group={fixture.group}
      {...rest}
    >
      {variant === 'wall' ? (
        <>
          {/* The wall paints only a band — the whole rectangle stays grabbable. */}
          <rect data-part="hit" width={fixture.w} height={fixture.h} fill="transparent" />
          <rect data-part="shape" {...rectOf(seatPlan.innerWallOf(fixture))} fill={cssVar('ink')} />
        </>
      ) : fixture.shape === 'ellipse' ? (
        <ellipse {...face} cx={cx} cy={cy} rx={cx} ry={cy} />
      ) : (
        <rect {...face} width={fixture.w} height={fixture.h} rx={2} />
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

type LabelProps = GProps & {
  label: GroupLabel
  // The text — the group's label, or its id.
  children: ReactNode
}

// A group's name written where the document puts it (beside a row's end seats) — tapping it selects the group.
// The text stays upright.
export function LabelPart({ label, children, ...rest }: LabelProps) {
  const { w, h } = label
  return (
    <g
      transform={`translate(${label.x} ${label.y})`}
      data-ichno-object={label.id}
      data-kind="label"
      data-group={label.group}
      {...rest}
    >
      <rect data-part="hit" width={w} height={h} fill="transparent" />
      <text
        data-part="label"
        x={w / 2}
        y={h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={groupLabelFont(label)}
        fontWeight={700}
        fill={cssVar('label')}
      >
        {children}
      </text>
    </g>
  )
}

// The editor's cell grid — cell edges plus the plan outline, 1px on screen at any zoom. Not part of the drawing.
export function GridPart({
  plan,
  cell = GRID_CELL,
  ...rest
}: GProps & { plan: Pick<SeatPlan, 'width' | 'height'>; cell?: number }) {
  let d = ''
  for (let x = cell; x < plan.width; x += cell) d += `M${x} 0V${plan.height}`
  for (let y = cell; y < plan.height; y += cell) d += `M0 ${y}H${plan.width}`
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

// Editing handles — squares for corners and vertices, a dot for the rotation knob, a smaller dot in the middle of a
// section's edge (dragging it adds a vertex). They keep a fixed screen size at
// any zoom (a zero-length stroke that does not scale), and carry the attributes the viewport reads to drag them.
// `frame` (the editor's) outlines what the handles belong to — a turned object, or the frame a group turns about —
// with a stem up to the knob. Corner cursors follow the corner's turned direction.
export function HandlesPart({
  handles,
  frame,
  ...rest
}: GProps & { handles: readonly PlanHandle[]; frame?: readonly PlanPoint[] | null }) {
  const knob = handles.find((handle) => handle.name === 'rotate')
  const [nw, ne] = frame ?? []
  const line = { stroke: cssVar('accent'), strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const, fill: 'none' }
  return (
    <g data-part="handles" {...rest}>
      {frame && frame.length > 2 && (
        <g data-part="frame" pointerEvents="none">
          <polygon points={pointsOf(frame)} strokeDasharray="4 3" {...line} />
          {knob && nw && ne && (
            <path
              d={`M${round((nw.x + ne.x) / 2)} ${round((nw.y + ne.y) / 2)}L${round(knob.point.x)} ${round(knob.point.y)}`}
              {...line}
            />
          )}
        </g>
      )}
      {handles.map((handle) => {
        const d = `M${round(handle.point.x)} ${round(handle.point.y)}h0`
        const edge = handle.name.startsWith('edge-')
        const cap = handle.name === 'rotate' || edge ? 'round' : 'square'
        const size = edge ? EDGE_HANDLE_PX : HANDLE_PX
        return (
          <g
            key={`${handle.owner.kind}:${'id' in handle.owner ? handle.owner.id : ''}:${handle.name}`}
            data-part="handle"
            data-ichno-handle={handle.name}
            data-ichno-owner={'id' in handle.owner ? handle.owner.id : undefined}
            data-ichno-owner-kind={handle.owner.kind}
            style={{ cursor: cursorOf(handle) }}
          >
            <path
              d={d}
              stroke={cssVar('accent')}
              strokeWidth={size}
              strokeLinecap={cap}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={d}
              stroke={cssVar('surface')}
              strokeWidth={size - 4}
              strokeLinecap={cap}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      })}
    </g>
  )
}

// A thin outline around something on the plan — the editor's `frames` (each selected item) and `hoverFrame` (what a
// tap would select). A fixed 1px on screen at any zoom; it never takes the pointer.
export function OutlinePart({ points, ...rest }: Omit<GProps, 'points'> & { points: readonly PlanPoint[] | null }) {
  if (!points || points.length < 2) return null
  return (
    <g data-part="outline" pointerEvents="none" {...rest}>
      <polygon
        points={pointsOf(points)}
        fill="none"
        stroke={cssVar('accent')}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
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

// A place label's font size in plan units — small seats get a smaller number.
export function placeLabelFont(place: Pick<Place, 'w' | 'h'>): number {
  return Math.min(SEAT_LABEL_FONT, Math.max(8, Math.min(place.w, place.h) * 0.42))
}

// Where a box is drawn — moved to its origin and turned about its centre.
function transformOf(box: PlanBox): string {
  const move = `translate(${box.x} ${box.y})`
  return box.rotation ? `${move} rotate(${box.rotation} ${box.w / 2} ${box.h / 2})` : move
}

// Turns a turned box's text back, so labels read level.
function uprightOf(box: PlanBox): string | undefined {
  return box.rotation ? `rotate(${-box.rotation} ${box.w / 2} ${box.h / 2})` : undefined
}

type Tone = { fill: string; stroke: string; label: string }

// Default looks per state — presentation attributes, so consumer CSS wins over all of them.
const TONES = {
  idle: { fill: cssVar('surface'), stroke: cssVar('label'), label: cssVar('label') },
  selected: { fill: cssVar('accent'), stroke: cssVar('accent'), label: cssVar('accentForeground') },
  disabled: { fill: cssVar('ink'), stroke: cssVar('ink'), label: cssVar('inkForeground') },
} satisfies Record<string, Tone>

// Printed coordinates — rounded to hundredths. Wall outlines and handle positions come from trigonometry, whose
// last bits differ between JavaScript engines; unrounded, a server-rendered plan would not match the browser's
// and fail hydration.
function pointsOf(points: readonly PlanPoint[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function rectOf(rect: PlanRect) {
  return { x: rect.x, y: rect.y, width: rect.w, height: rect.h }
}

// Seat number font (plan units) — always drawn regardless of scale; a small number beats none.
const SEAT_LABEL_FONT = 20
const RECT_RADIUS = 4
const LINE_WIDTH = 1.5
const DIMMED_OPACITY = 0.35
// Handle size in screen pixels — an edge's middle smaller, so the corners stand out.
const HANDLE_PX = 12
const EDGE_HANDLE_PX = 9
// Resize cursors by the direction a corner points, in 45° sectors from +x.
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const

function cursorOf(handle: PlanHandle): string {
  if (handle.name === 'rotate') return 'grab'
  if (handle.name.startsWith('edge-')) return 'copy'
  if (handle.angle === undefined) return 'move'
  const sector = Math.round((((handle.angle % 180) + 180) % 180) / 45) % 4
  return RESIZE_CURSORS[sector]!
}
// Unset variables are invalid at computed-value time, so the number font falls back to the inherited font.
const NUMBER_FONT_STYLE: CSSProperties = { fontFamily: `var(${NUMBER_FONT_VAR}, var(${FONT_VAR}))` }
