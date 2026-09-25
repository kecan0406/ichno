import type { ReactNode } from 'react'

// Tool glyphs, drawn on a 20-unit box in the current text colour.

export type IconName = 'select' | 'row' | 'table' | 'booth' | 'area' | 'desk' | 'fixture'

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      {GLYPHS[name]}
    </svg>
  )
}

const GLYPHS: Record<IconName, ReactNode> = {
  select: <path d="M5 3l10 6.5-4.5 1L8.5 15z" strokeLinejoin="round" />,
  row: (
    <>
      {[3, 7.3, 11.6, 16].map((x, i) => (
        <circle key={x} cx={x} cy={i === 0 || i === 3 ? 8 : 10} r={1.9} />
      ))}
      <path d="M3 14.5c4 2 10 2 14 0" strokeLinecap="round" opacity={0.5} />
    </>
  ),
  table: (
    <>
      <circle cx={10} cy={10} r={3.6} />
      {[0, 72, 144, 216, 288].map((angle) => (
        <circle
          key={angle}
          // Rounded: trigonometry's last digits differ between the server's engine and the browser's.
          cx={(10 + 6.8 * Math.sin((angle * Math.PI) / 180)).toFixed(2)}
          cy={(10 - 6.8 * Math.cos((angle * Math.PI) / 180)).toFixed(2)}
          r={1.5}
        />
      ))}
    </>
  ),
  booth: <rect x={3} y={5} width={14} height={10} rx={2} />,
  area: <rect x={3} y={5} width={14} height={10} rx={5} strokeDasharray="2.5 2" />,
  desk: (
    <>
      <rect x={4} y={3} width={12} height={9} rx={1.5} />
      <rect x={6.5} y={14} width={7} height={3} rx={1.5} />
    </>
  ),
  fixture: <rect x={2.5} y={7.5} width={15} height={5} rx={1} fill="currentColor" fillOpacity={0.25} />,
}
