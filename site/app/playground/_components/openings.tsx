import { WALL_THICKNESS, type SeatPlan } from 'ichno'
import { openingsOf, pointOn } from '../_lib/walls'
import styles from './marks.module.css'

// The gaps doors leave in the walls they stand in, painted in the page colour over a section's dashed outline (ichno
// strokes it half a wall outside the edge). A door across a wall fixture covers the band itself — it is drawn in
// front, filled (globals.css).
export function Openings({ plan, scale }: { plan: SeatPlan<string>; scale: number }) {
  const gaps = openingsOf(plan).filter((opening) => opening.wall.kind === 'room')
  if (gaps.length === 0) return null
  // Past the hairline, however thick a screen pixel is at this zoom; the door's own outline stays.
  const reach = WALL_THICKNESS / 2 + Math.max(1.5, 1.5 / scale)
  return (
    <g className={styles.openings} aria-hidden>
      {gaps.map(({ wall, from, to }, i) => (
        <polygon
          key={i}
          points={[
            pointOn(wall, from, -0.5),
            pointOn(wall, to, -0.5),
            pointOn(wall, to, -reach),
            pointOn(wall, from, -reach),
          ]
            .map((p) => `${p.x},${p.y}`)
            .join(' ')}
        />
      ))}
    </g>
  )
}
