// Theme contract — CSS custom properties the renderers read. Set them on :root (and override them for dark mode)
// to map the drawing onto your design tokens; unset properties fall back to the neutral defaults below.
// The SVG paints with `var(...)` directly, so theme switches finish in CSS. The canvas resolves the same
// properties at runtime and re-reads them when the document's theme changes.
export const themeVars = {
  // Room floor, desks and empty chairs — the surface everything sits on.
  surface: { name: '--ichno-surface', fallback: '#ffffff' },
  // TV and counter faces — one step below the floor.
  fixture: { name: '--ichno-fixture', fallback: '#f4f4f5' },
  // Editor grid lines.
  grid: { name: '--ichno-grid', fallback: '#e4e4e7' },
  // Furniture outlines, seat numbers, fixture names.
  label: { name: '--ichno-label', fallback: '#71717a' },
  // Walls, occupied chairs, unavailable seats, occupant names, selection rings — the darkest ink on the plan.
  ink: { name: '--ichno-ink', fallback: '#18181b' },
  // Seat numbers drawn on ink-filled seats.
  inkForeground: { name: '--ichno-ink-foreground', fallback: '#ffffff' },
  // Picked seats and editor selection.
  accent: { name: '--ichno-accent', fallback: '#2563eb' },
  // Seat numbers drawn on accent-filled seats.
  accentForeground: { name: '--ichno-accent-foreground', fallback: '#ffffff' },
  // The occupant warning dot.
  warning: { name: '--ichno-warning', fallback: '#f59e0b' },
} as const

export type ThemeVar = keyof typeof themeVars

// Occupied desk tint opacity (a number, e.g. raise it in dark mode where a light tint vanishes on the surface).
export const OCCUPIED_TINT_VAR = { name: '--ichno-occupied-tint', fallback: '0.15' } as const
// Font families — unset means the renderer inherits the surrounding font.
export const FONT_VAR = '--ichno-font'
export const NUMBER_FONT_VAR = '--ichno-number-font'

export function cssVar(key: ThemeVar): string {
  const { name, fallback } = themeVars[key]
  return `var(${name}, ${fallback})`
}
