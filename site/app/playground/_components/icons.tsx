import type { ReactNode } from 'react'

// Interface glyphs, drawn on a 20-unit box in the current text colour. Objects are drawn as themselves instead
// (thumbnails of their ichno parts).

export type IconName = 'select' | 'keep' | 'snap' | 'focus' | 'keyboard'

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      {GLYPHS[name]}
    </svg>
  )
}

const GLYPHS: Record<IconName, ReactNode> = {
  select: <path d="M5 3l10 6.5-4.5 1L8.5 15z" strokeLinejoin="round" />,
  keep: (
    <>
      <rect x={4.5} y={9} width={11} height={8} rx={1.5} />
      <path d="M7 9V6.5a3 3 0 016 0V9" />
    </>
  ),
  snap: (
    <>
      <path d="M3 7h14M3 13h14M7 3v14M13 3v14" opacity={0.45} />
      <circle cx={13} cy={7} r={2} fill="currentColor" stroke="none" />
    </>
  ),
  focus: (
    <>
      <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x={7.5} y={7.5} width={5} height={5} rx={1} />
    </>
  ),
  keyboard: (
    <>
      <rect x={2} y={5} width={16} height={10} rx={2} />
      <path d="M5 8.5h1M8 8.5h1M11 8.5h1M14 8.5h1M6.5 11.5h7" strokeLinecap="round" />
    </>
  ),
}
