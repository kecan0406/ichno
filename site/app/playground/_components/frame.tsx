'use client'

import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import styles from './workspace.module.css'

// The editor's frame as this browser left it — how wide the side panels are, and whether they show at all (⌘\).

export type PanelSide = 'left' | 'right'

type Widths = Record<PanelSide, number>

const STORAGE_KEY = 'ichno-playground-panels'

const DEFAULT_WIDTHS: Widths = { left: 248, right: 272 }

const MIN_WIDTH = 200

const MAX_WIDTH = 440

export function usePanels() {
  const [widths, setWidths] = useState<Widths>(DEFAULT_WIDTHS)
  const [hidden, setHidden] = useState(false)

  // localStorage is the browser's — read after hydration. Anything unreadable leaves the defaults.
  useEffect(() => {
    const stored = storedWidths()

    if (stored) setWidths({ left: widthOf(stored.left, 'left'), right: widthOf(stored.right, 'right') })
  }, [])

  // `keep` stores the widths — at the end of a drag, not on every step of it.
  function resize(side: PanelSide, width: number, keep = false) {
    setWidths((current) => {
      const next = { ...current, [side]: widthOf(width, side) }

      if (keep) store(next)

      return next
    })
  }

  return {
    widths,
    hidden,
    setHidden,
    toggle: () => setHidden((current) => !current),
    resize,
    keep: () => store(widths),
    reset: (side: PanelSide) => resize(side, DEFAULT_WIDTHS[side], true),
  }
}

function widthOf(width: number, side: PanelSide): number {
  return Number.isFinite(width) ? Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))) : DEFAULT_WIDTHS[side]
}

function store(widths: Widths) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
  } catch {
    // Storage full or blocked — the panels forget their width on reload.
  }
}

// The edge a panel is resized by — drag it, or focus it and use ← →; a double-click puts the width back.
export function Resizer({
  side,
  width,
  label,
  onResize,
  onDone,
  onReset,
}: {
  side: PanelSide
  width: number
  label: string
  onResize(width: number, keep?: boolean): void
  onDone(): void
  onReset(): void
}) {
  const startRef = useRef<{ x: number; width: number } | null>(null)
  const [active, setActive] = useState(false)
  // Which way a pointer or an arrow key moves the edge — the left panel's right edge, the right panel's left one.
  const sign = side === 'left' ? 1 : -1

  function end() {
    if (startRef.current === null) return
    startRef.current = null
    setActive(false)
    onDone()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      className={styles.resizer}
      data-side={side}
      data-active={active || undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        startRef.current = { x: e.clientX, width }
        setActive(true)
      }}
      onPointerMove={(e) => {
        const start = startRef.current

        if (start) onResize(start.width + (e.clientX - start.x) * sign)
      }}
      onPointerUp={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10

        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        // Arrow keys here size the panel — they do not move the selection.
        e.preventDefault()
        onResize(width + (e.key === 'ArrowRight' ? step : -step) * sign, true)
      }}
    />
  )
}

// A kept width that is not a number is the default.
const StoredWidths = z.object({
  left: z.number().catch(DEFAULT_WIDTHS.left),
  right: z.number().catch(DEFAULT_WIDTHS.right),
})

// The widths kept in this browser, or null when there are none or they cannot be read (blocked, garbled).
function storedWidths(): Widths | null {
  try {
    const stored = StoredWidths.safeParse(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null'))

    return stored.success ? stored.data : null
  } catch {
    return null
  }
}
