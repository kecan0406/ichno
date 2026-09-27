import type { ReactNode } from 'react'

// Interface glyphs, drawn on a 16-unit box in the current text colour. Assets are drawn as themselves instead
// (thumbnails of their ichno parts).

export type IconName = keyof typeof GLYPHS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {GLYPHS[name]}
    </svg>
  )
}

const GLYPHS = {
  // Tools
  select: <path d="M3.5 2.5l9 5.1-4 1-1.8 3.9z" />,
  hand: (
    <path d="M5.5 8.5V4a1 1 0 012 0v3.5m0-4.5a1 1 0 012 0v4.5m0-3.5a1 1 0 012 0V10c0 2.2-1.7 4-3.8 4H8.3c-1.1 0-2-.5-2.7-1.4L3.4 9.8a1 1 0 011.5-1.3l.6.7" />
  ),
  place: <rect x={3} y={3} width={10} height={10} rx={3} />,
  fixture: (
    <>
      <rect x={2.5} y={2.5} width={11} height={11} rx={1} />
      <path d="M2.5 7.5l5-5M2.5 12.5l10-10M7.5 13.5l6-6" opacity={0.55} />
    </>
  ),
  assets: (
    <>
      <path d="M5 2l2.5 2.5L5 7 2.5 4.5z" />
      <path d="M11 2l2.5 2.5L11 7 8.5 4.5z" />
      <path d="M5 9l2.5 2.5L5 14l-2.5-2.5z" />
      <path d="M11 9l2.5 2.5L11 14l-2.5-2.5z" />
    </>
  ),
  snap: (
    <>
      <path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12" opacity={0.45} />
      <circle cx={10.5} cy={5.5} r={1.6} fill="currentColor" stroke="none" />
    </>
  ),
  repeat: (
    <>
      <path d="M2.5 7V6a2 2 0 012-2h8M10.5 2l2 2-2 2" />
      <path d="M13.5 9v1a2 2 0 01-2 2h-8M5.5 14l-2-2 2-2" />
    </>
  ),
  // Layers
  group: <rect x={2.5} y={2.5} width={11} height={11} rx={1.5} strokeDasharray="2.2 1.8" />,
  label: <path d="M3.5 3.5h9M8 3.5v9" />,
  section: <path d="M2.5 5l5.5-2.5L13.5 5v6.5L8 13.5l-5.5-2z" />,
  rect: <rect x={2.5} y={3.5} width={11} height={9} rx={1} />,
  ellipse: <circle cx={8} cy={8} r={5.5} />,
  lock: (
    <>
      <rect x={3.5} y={7} width={9} height={6.5} rx={1.5} />
      <path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" />
    </>
  ),
  // Actions
  undo: <path d="M6 3.5L3 6.5l3 3M3 6.5h6.5a3.5 3.5 0 010 7H7" />,
  redo: <path d="M10 3.5l3 3-3 3M13 6.5H6.5a3.5 3.5 0 000 7H9" />,
  play: <path d="M5 3.3v9.4l7.5-4.7z" fill="currentColor" />,
  edit: <path d="M10.5 2.8l2.7 2.7-7.2 7.2-3.3.6.6-3.3z" />,
  duplicate: (
    <>
      <rect x={5.5} y={5.5} width={8} height={8} rx={1.5} />
      <path d="M10.5 5.5V4a1.5 1.5 0 00-1.5-1.5H4A1.5 1.5 0 002.5 4v5A1.5 1.5 0 004 10.5h1.5" />
    </>
  ),
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9" />,
  ungroup: (
    <>
      <rect x={2.5} y={2.5} width={6} height={6} rx={1} />
      <rect x={7.5} y={7.5} width={6} height={6} rx={1} strokeDasharray="2 1.6" />
    </>
  ),
  rotate: <path d="M12.8 8.5A4.8 4.8 0 118.5 3.2M12.5 2.5v3.3H9.2" />,
  asset: <path d="M8 2.5l5.5 5.5L8 13.5 2.5 8z" />,
  // Alignment
  alignLeft: (
    <>
      <path d="M2.5 2v12" />
      <rect x={4.5} y={4} width={9} height={3} rx={0.8} />
      <rect x={4.5} y={9} width={5} height={3} rx={0.8} />
    </>
  ),
  alignCenterX: (
    <>
      <path d="M8 2v12" />
      <rect x={3} y={4} width={10} height={3} rx={0.8} />
      <rect x={5} y={9} width={6} height={3} rx={0.8} />
    </>
  ),
  alignRight: (
    <>
      <path d="M13.5 2v12" />
      <rect x={2.5} y={4} width={9} height={3} rx={0.8} />
      <rect x={6.5} y={9} width={5} height={3} rx={0.8} />
    </>
  ),
  alignTop: (
    <>
      <path d="M2 2.5h12" />
      <rect x={4} y={4.5} width={3} height={9} rx={0.8} />
      <rect x={9} y={4.5} width={3} height={5} rx={0.8} />
    </>
  ),
  alignCenterY: (
    <>
      <path d="M2 8h12" />
      <rect x={4} y={3} width={3} height={10} rx={0.8} />
      <rect x={9} y={5} width={3} height={6} rx={0.8} />
    </>
  ),
  alignBottom: (
    <>
      <path d="M2 13.5h12" />
      <rect x={4} y={2.5} width={3} height={9} rx={0.8} />
      <rect x={9} y={6.5} width={3} height={5} rx={0.8} />
    </>
  ),
  distributeX: (
    <>
      <path d="M2.5 2v12M13.5 2v12" />
      <rect x={6} y={4.5} width={4} height={7} rx={0.8} />
    </>
  ),
  distributeY: (
    <>
      <path d="M2 2.5h12M2 13.5h12" />
      <rect x={4.5} y={6} width={7} height={4} rx={0.8} />
    </>
  ),
  // Interface
  chevronDown: <path d="M4.5 6.5L8 10l3.5-3.5" />,
  chevronRight: <path d="M6.5 4.5L10 8l-3.5 3.5" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  search: (
    <>
      <circle cx={7} cy={7} r={4.2} />
      <path d="M10.2 10.2l3.3 3.3" />
    </>
  ),
  sidebar: (
    <>
      <rect x={2} y={3} width={12} height={10} rx={1.5} />
      <path d="M6 3v10" />
    </>
  ),
  focus: (
    <>
      <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" />
      <rect x={6} y={6} width={4} height={4} rx={0.8} />
    </>
  ),
  keyboard: (
    <>
      <rect x={1.5} y={4} width={13} height={8} rx={1.5} />
      <path d="M4 6.8h.5M6.5 6.8H7M9 6.8h.5M11.5 6.8h.5M5.5 9.3h5" />
    </>
  ),
} satisfies Record<string, ReactNode>
