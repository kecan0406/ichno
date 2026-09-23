'use client'

import { useEffect, useState } from 'react'
import { FONT_VAR, NUMBER_FONT_VAR, OCCUPIED_TINT_VAR, cssVar, themeVars, type ThemeVar } from '../theme/vars'

// Canvas theme — Konva cannot take CSS, so the theme variables are resolved to colour strings at runtime.
// Resolution goes through a hidden probe element: assigning `var(...)`/`color-mix(...)`/any CSS colour to its
// `color` and reading the computed value turns every consumer colour (theme variables and marker colours)
// into something the canvas accepts.
export type CanvasTheme = Record<ThemeVar, string> & {
  occupiedTintOpacity: number
  fontFamily: string
  // Seat numbers — the number font only once it has loaded (canvas text never re-draws after a fallback).
  numberFontFamily: string
  // Resolve a consumer-supplied CSS colour (e.g. a marker colour) against the current theme.
  resolve(color: string): string
}

// Subscribes to theme changes — anything that can change resolved colours: class/style/data-theme on <html>
// or <body> and the colour-scheme media query. It re-reads only when one of those actually changed (a
// remove+add pair or an unrelated rewrite is ignored), so Konva nodes and gesture state survive; the new
// theme also drops the colour cache, so marker colours built on the consumer's own variables follow along.
export function useCanvasTheme(): CanvasTheme {
  const [theme, setTheme] = useState(readCanvasTheme)

  useEffect(() => {
    let active = true
    let applied = themeSignature()
    const refresh = () => {
      if (!active) return
      const current = themeSignature()
      if (current === applied) return
      applied = current
      setTheme(readCanvasTheme())
    }

    const observer = new MutationObserver(refresh)
    const attributeFilter = ['class', 'style', 'data-theme']
    observer.observe(document.documentElement, { attributes: true, attributeFilter })
    observer.observe(document.body, { attributes: true, attributeFilter })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', refresh)

    // Canvas text does not load web fonts the DOM has not used, and never re-draws after drawing with a
    // fallback — load the number font, then re-read so the new family re-draws the canvas.
    const numberFont = readNumberFont()
    if (numberFont && !document.fonts.check(fontShorthand(numberFont))) {
      void document.fonts.load(fontShorthand(numberFont)).then(() => {
        if (active) setTheme(readCanvasTheme())
      })
    }

    return () => {
      active = false
      observer.disconnect()
      media.removeEventListener('change', refresh)
    }
  }, [])

  return theme
}

function readCanvasTheme(): CanvasTheme {
  if (typeof document === 'undefined') return FALLBACK_THEME
  const probe = probeElement()
  const computed = getComputedStyle(probe)
  const cache = new Map<string, string>()
  const resolve = (color: string) => {
    const hit = cache.get(color)
    if (hit !== undefined) return hit
    probe.style.color = color
    const value = computed.color
    cache.set(color, value)
    return value
  }

  const colors = Object.fromEntries(
    (Object.keys(themeVars) as ThemeVar[]).map((key) => [key, resolve(cssVar(key))]),
  ) as Record<ThemeVar, string>

  // Unset font variables are invalid at computed-value time, so the probe inherits <body>'s font.
  probe.style.fontFamily = `var(${FONT_VAR})`
  const fontFamily = computed.fontFamily
  const numberFont = readNumberFont()
  probe.style.opacity = `var(${OCCUPIED_TINT_VAR.name}, ${OCCUPIED_TINT_VAR.fallback})`
  const occupiedTintOpacity = Number(computed.opacity)

  return {
    ...colors,
    occupiedTintOpacity: Number.isFinite(occupiedTintOpacity) ? occupiedTintOpacity : 0.15,
    fontFamily,
    numberFontFamily: numberFont && document.fonts.check(fontShorthand(numberFont)) ? numberFont : fontFamily,
    resolve,
  }
}

// The number font family, or null when neither font variable is set (numbers then use the body font).
function readNumberFont(): string | null {
  const probe = probeElement()
  probe.style.fontFamily = `var(${NUMBER_FONT_VAR}, var(${FONT_VAR}))`
  const family = getComputedStyle(probe).fontFamily
  probe.style.fontFamily = ''
  return family === getComputedStyle(document.body).fontFamily ? null : family
}

let probe: HTMLElement | null = null

function probeElement(): HTMLElement {
  if (probe?.isConnected) return probe
  probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.dataset.ichnoThemeProbe = ''
  Object.assign(probe.style, {
    position: 'absolute',
    width: '0',
    height: '0',
    overflow: 'hidden',
    visibility: 'hidden',
  })
  document.body.appendChild(probe)
  return probe
}

function themeSignature(): string {
  const attrs = (el: Element) => ['class', 'style', 'data-theme'].map((name) => el.getAttribute(name)).join('|')
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  return `${attrs(document.documentElement)}#${attrs(document.body)}#${dark}`
}

// The CSS font shorthand for seat numbers — loading/checking targets the same face the canvas draws.
function fontShorthand(family: string): string {
  return `600 20px ${family}`
}

const FALLBACK_THEME: CanvasTheme = {
  ...(Object.fromEntries(Object.entries(themeVars).map(([key, v]) => [key, v.fallback])) as Record<ThemeVar, string>),
  occupiedTintOpacity: Number(OCCUPIED_TINT_VAR.fallback),
  fontFamily: 'sans-serif',
  numberFontFamily: 'sans-serif',
  resolve: (color) => color,
}
