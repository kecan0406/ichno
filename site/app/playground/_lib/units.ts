import type { PlanPoint } from 'ichno'

// Plan units have no size. This site draws a seat 36 units wide — 45 cm — so a metre is 80.
export const METRE = 80

// A length in plan units as this site writes it: metres to the centimetre, trailing zeros dropped — "4.6 m".
export function metres(units: number): string {
  return `${trimmed(units / METRE)} m`
}

// An area in plan units² as square metres, to a tenth — "24.5 m²".
export function squareMetres(units: number): string {
  return `${trimmed(units / (METRE * METRE), 1)} m²`
}

// The floor a polygon encloses, in plan units².
export function areaOf(points: readonly PlanPoint[]): number {
  let twice = 0
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length]!
    twice += a.x * b.y - b.x * a.y
  })
  return Math.abs(twice) / 2
}

function trimmed(value: number, digits = 2): string {
  return String(Number(value.toFixed(digits)))
}
