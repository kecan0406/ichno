// Theme contract — CSS custom properties the components read. Set them on :root (and override them for dark mode)
// to map the drawing onto your design tokens; unset properties fall back to the neutral defaults below.
// Parts paint with `var(...)` presentation attributes, so theme switches finish in CSS, and any `className` on a
// part overrides them (CSS beats presentation attributes).
export const themeVars = {
  // Section floor, desks and empty seats — the surface everything sits on.
  surface: { name: '--ichno-surface', fallback: '#ffffff' },
  // Fixture faces — one step below the floor.
  fixture: { name: '--ichno-fixture', fallback: '#f4f4f5' },
  // Editor grid lines.
  grid: { name: '--ichno-grid', fallback: '#e4e4e7' },
  // Furniture outlines, seat numbers, fixture names.
  label: { name: '--ichno-label', fallback: '#71717a' },
  // Walls, taken places, focus and selection rings — the darkest ink on the plan.
  ink: { name: '--ichno-ink', fallback: '#18181b' },
  // Labels drawn on ink-filled places.
  inkForeground: { name: '--ichno-ink-foreground', fallback: '#ffffff' },
  // Selected places and editor selection.
  accent: { name: '--ichno-accent', fallback: '#2563eb' },
  // Labels drawn on accent-filled places.
  accentForeground: { name: '--ichno-accent-foreground', fallback: '#ffffff' },
  // Warning marks.
  warning: { name: '--ichno-warning', fallback: '#f59e0b' },
} as const

export type ThemeVar = keyof typeof themeVars

// Font families — unset means the renderer inherits the surrounding font.
export const FONT_VAR = '--ichno-font'
export const NUMBER_FONT_VAR = '--ichno-number-font'

export function cssVar(key: ThemeVar): string {
  const { name, fallback } = themeVars[key]
  return `var(${name}, ${fallback})`
}
