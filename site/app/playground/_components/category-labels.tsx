import type { SeatPlan } from 'ichno'
import { CATEGORY_LABEL_SIZE, categoryLabelsOf, categoryNameOf } from '../_lib/category-labels'
import marks from './marks.module.css'

// Lettering smaller than this on screen is left out, as seat numbers are.
const MIN_PX = 7

// The plan's categories named on a plan ichno's parts draw — the landing page's (../_lib/category-labels.ts) — never
// in the way of the pointer. `scale` is the viewport's, where it is known.
export function CategoryLabels({ plan, scale }: { plan: SeatPlan<string>; scale?: number }) {
  const labels = categoryLabelsOf(plan)

  if (labels.length === 0 || (scale !== undefined && CATEGORY_LABEL_SIZE * scale < MIN_PX)) return null

  return (
    <g className={marks.categories} fontSize={CATEGORY_LABEL_SIZE}>
      {labels.map((label) => (
        <text key={`${label.category}:${label.x}:${label.y}`} x={label.x} y={label.y}>
          {categoryNameOf(label.category)}
        </text>
      ))}
    </g>
  )
}
