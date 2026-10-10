import type { ComponentProps } from 'react'
import type { PlanGuide, PlanHandle, PlanPoint, PlanRect, PlanStroke } from '../core/types'
import { cssVar } from '../theme/vars'
import { HandlesPart, MarqueePart, OutlinePart } from './parts'

// `stroke` is the editor's stroke, not the <g>'s paint.
export type EditorOverlayProps = Omit<ComponentProps<'g'>, 'children' | 'stroke'> & {
  // Each selected item's outline — pass them when more than one is selected; a single item shows its `frame` with
  // its handles.
  frames?: readonly (readonly PlanPoint[])[]
  // What a tap would select.
  hoverFrame?: readonly PlanPoint[] | null
  handles?: readonly PlanHandle[]
  frame?: readonly PlanPoint[] | null
  marquee?: PlanRect | null
  // The stroke a creation tool is drawing, and how the tool draws: a box is outlined, a line drawn along, a polygon
  // drawn corner to corner (back to its first one, which is marked to close it on), a path the same without the way
  // back, a point left to the draft.
  stroke?: PlanStroke | null
  draw?: 'box' | 'line' | 'point' | 'polygon' | 'path'
  // Smart guides — the lines and equal gaps what is dragged or drawn lines up on.
  guides?: readonly PlanGuide[]
}

// Everything an editor draws over the plan, layered the way it reads: the selection's outlines, what a tap would
// select, the smart guides, the handles with the frame they belong to, the marquee, and the stroke a creation tool is
// drawing. The editor's `overlayProps` (ichno/editor) are these props. Pieces are named for styling — `data-part`
// `selection`, `hover`, `guides` (each a `guide` line or a `gap`) and `stroke`, beside the `handles`, `outline` and
// `marquee` of the parts it draws with.
export function EditorOverlay({
  frames = NO_FRAMES,
  hoverFrame = null,
  handles = NO_HANDLES,
  frame = null,
  marquee = null,
  stroke = null,
  draw,
  guides = NO_GUIDES,
  ...rest
}: EditorOverlayProps) {
  const guide = stroke && draw !== 'point' ? stroke : null
  return (
    <g data-part="editor-overlay" {...rest}>
      {frames.length > 0 && (
        <g data-part="selection">
          {frames.map((points, i) => (
            <OutlinePart key={i} points={points} />
          ))}
        </g>
      )}
      {hoverFrame && (
        // Fainter than the selection — a suggestion, not a choice.
        <g data-part="hover" opacity={HOVER_OPACITY}>
          <OutlinePart points={hoverFrame} />
        </g>
      )}
      {guides.length > 0 && (
        <g data-part="guides" pointerEvents="none">
          {guides.map((guide, i) => (
            <Guide key={i} guide={guide} />
          ))}
        </g>
      )}
      <HandlesPart handles={handles} frame={frame} />
      <MarqueePart rect={marquee} />
      {guide && (
        <g data-part="stroke" pointerEvents="none">
          {draw === 'polygon' || draw === 'path' ? (
            <PolygonGuide points={guide.points ?? [guide.start, guide.end]} closing={draw === 'polygon'} />
          ) : draw === 'line' ? (
            <line
              x1={round(guide.start.x)}
              y1={round(guide.start.y)}
              x2={round(guide.end.x)}
              y2={round(guide.end.y)}
              {...GUIDE}
            />
          ) : (
            <rect
              x={round(Math.min(guide.start.x, guide.end.x))}
              y={round(Math.min(guide.start.y, guide.end.y))}
              width={round(Math.abs(guide.end.x - guide.start.x))}
              height={round(Math.abs(guide.end.y - guide.start.y))}
              {...GUIDE}
            />
          )}
        </g>
      )}
    </g>
  )
}

// A guide line, or equal gaps marked end to end with a dot at each end — 1px lines and 4px dots at any zoom.
function Guide({ guide }: { guide: PlanGuide }) {
  const point = (along: number, across: number) =>
    guide.axis === 'x' ? { x: along, y: across } : { x: across, y: along }
  if (guide.kind === 'line') {
    const a = guide.axis === 'x' ? { x: guide.at, y: guide.from } : { x: guide.from, y: guide.at }
    const b = guide.axis === 'x' ? { x: guide.at, y: guide.to } : { x: guide.to, y: guide.at }
    return <line data-part="guide" x1={round(a.x)} y1={round(a.y)} x2={round(b.x)} y2={round(b.y)} {...GUIDE_LINE} />
  }
  return (
    <g data-part="gap">
      {guide.gaps.map((gap, i) => {
        const a = point(gap.from, guide.at)
        const b = point(gap.to, guide.at)
        return (
          <g key={i}>
            <line x1={round(a.x)} y1={round(a.y)} x2={round(b.x)} y2={round(b.y)} {...GUIDE_LINE} />
            <path
              d={`M${round(a.x)} ${round(a.y)}h0M${round(b.x)} ${round(b.y)}h0`}
              stroke={cssVar('guide')}
              strokeWidth={4}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      })}
    </g>
  )
}

// A polygon or path being drawn — its edges so far, a fainter one back to the first corner for a polygon (`closing`),
// and that corner marked: tapping it closes the shape.
function PolygonGuide({ points, closing }: { points: readonly PlanPoint[]; closing: boolean }) {
  const [first] = points
  if (!first) return null
  const last = points.at(-1)!
  return (
    <>
      <polyline points={points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')} {...GUIDE} />
      {closing && points.length > 2 && (
        <line
          x1={round(last.x)}
          y1={round(last.y)}
          x2={round(first.x)}
          y2={round(first.y)}
          {...GUIDE}
          opacity={HOVER_OPACITY}
        />
      )}
      <path
        data-part="stroke-start"
        d={`M${round(first.x)} ${round(first.y)}h0`}
        stroke={cssVar('accent')}
        strokeWidth={CORNER_PX}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </>
  )
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

const NO_FRAMES: readonly (readonly PlanPoint[])[] = []
const NO_HANDLES: readonly PlanHandle[] = []
const NO_GUIDES: readonly PlanGuide[] = []
const GUIDE_LINE = {
  stroke: cssVar('guide'),
  strokeWidth: 1,
  vectorEffect: 'non-scaling-stroke' as const,
}
const HOVER_OPACITY = 0.6
// The first corner of a polygon being drawn, in screen pixels.
const CORNER_PX = 8
// A stroke guide is a dashed accent line, 1px on screen at any zoom (vector-effect is not inherited — it goes on the
// shape itself).
const GUIDE = {
  fill: 'none',
  stroke: cssVar('accent'),
  strokeWidth: 1,
  strokeDasharray: '4 3',
  vectorEffect: 'non-scaling-stroke' as const,
}
