'use client'

import Link from 'next/link'
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Icon } from './icons'
import styles from './menu.module.css'

// Menus in the top layer (the Popover API). A menu opens under the button that owns it (`MenuButton`) or at a point
// (`at`, a right-click); a pick, a press elsewhere or Escape closes it, and it keeps inside the window.

export type MenuPoint = { x: number; y: number }

type MenuProps = {
  id?: string
  label: string
  // Opens it at this point, null closes it — for a menu no button owns. It then closes only through
  // `onOpenChange(false)`: a right-click's press would dismiss a browser-managed popover as it opens.
  at?: MenuPoint | null
  // The button that opens it (with `popoverTarget`) — it opens under it, at its start or end edge.
  anchor?: RefObject<HTMLElement | null>
  align?: 'start' | 'end'
  onOpenChange?(open: boolean): void
  children: ReactNode
}

export function Menu({ id, label, at, anchor, align = 'start', onOpenChange, children }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const pointed = at !== undefined
  const dismiss = useEffectEvent(() => onOpenChange?.(false))

  useEffect(() => {
    const menu = ref.current
    if (!menu || at === undefined) return
    if (at === null) {
      if (menu.matches(':popover-open')) menu.hidePopover()
      return
    }
    placeAt(menu, { left: at.x, top: at.y })
    if (!menu.matches(':popover-open')) menu.showPopover()
    keepInside(menu)
    firstItem(menu)?.focus()
    // A press or a scroll anywhere else closes it.
    function away(e: Event) {
      if (!(e.target instanceof Node && menu!.contains(e.target))) dismiss()
    }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('wheel', away, { capture: true, passive: true })
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('wheel', away, true)
    }
  }, [at])

  function close(menu: HTMLDivElement) {
    if (pointed) dismiss()
    else menu.hidePopover()
  }

  return (
    <div
      ref={ref}
      id={id}
      popover={pointed ? 'manual' : 'auto'}
      role="menu"
      aria-label={label}
      className={styles.menu}
      onBeforeToggle={(e) => {
        const button = anchor?.current
        if (e.newState !== 'open' || !button) return
        const r = button.getBoundingClientRect()
        placeAt(
          e.currentTarget,
          align === 'end'
            ? { right: window.innerWidth - r.right, top: r.bottom + 4 }
            : { left: r.left, top: r.bottom + 4 },
        )
      }}
      onToggle={(e) => {
        if (pointed) return
        const open = e.newState === 'open'
        if (open) {
          keepInside(e.currentTarget)
          firstItem(e.currentTarget)?.focus()
        }
        onOpenChange?.(open)
      }}
      onClick={(e) => {
        if (e.target instanceof Element && e.target.closest('[role^="menuitem"]:not(:disabled)')) close(e.currentTarget)
      }}
      // Keys pressed in a menu are the menu's — not the editor's shortcuts behind it.
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          close(e.currentTarget)
          return
        }
        const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')]
        const at = items.findIndex((item) => item === document.activeElement)
        const next =
          e.key === 'ArrowDown'
            ? items[(at + 1) % items.length]
            : e.key === 'ArrowUp'
              ? items[(at - 1 + items.length) % items.length]
              : e.key === 'Home'
                ? items[0]
                : e.key === 'End'
                  ? items.at(-1)
                  : undefined
        if (next) {
          e.preventDefault()
          next.focus()
        }
      }}
    >
      {children}
    </div>
  )
}

// A button with a menu under it.
export function MenuButton({
  label,
  title,
  className,
  align,
  button,
  children,
}: {
  label: string
  title?: string
  className?: string
  align?: 'start' | 'end'
  // What the button shows.
  button: ReactNode
  // The menu's items.
  children: ReactNode
}) {
  const id = useId()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={className}
        popoverTarget={id}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={title}
      >
        {button}
      </button>
      <Menu id={id} label={label} anchor={ref} align={align} onOpenChange={setOpen}>
        {children}
      </Menu>
    </>
  )
}

export function MenuItem({
  children,
  keys,
  disabled,
  checked,
  onSelect,
}: {
  children: ReactNode
  keys?: string
  disabled?: boolean
  // Given, the item is a check box (shown with a tick when on).
  checked?: boolean
  onSelect(): void
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      disabled={disabled}
      className={styles.item}
      onClick={onSelect}
    >
      <span className={styles.tick} aria-hidden>
        {checked && <Icon name="check" size={14} />}
      </span>
      <span className={styles.label}>{children}</span>
      {keys && <span className={styles.keys}>{keys}</span>}
    </button>
  )
}

export function MenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} role="menuitem" className={styles.item}>
      <span className={styles.tick} aria-hidden />
      <span className={styles.label}>{children}</span>
    </Link>
  )
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className={styles.heading}>
      {children}
    </div>
  )
}

export function MenuSeparator() {
  return <div role="separator" className={styles.separator} />
}

function placeAt(menu: HTMLElement, at: { left?: number; right?: number; top: number }) {
  menu.style.left = at.left === undefined ? 'auto' : `${at.left}px`
  menu.style.right = at.right === undefined ? 'auto' : `${at.right}px`
  menu.style.top = `${at.top}px`
}

// Pulls an open menu back inside the window.
function keepInside(menu: HTMLElement) {
  const r = menu.getBoundingClientRect()
  if (r.right > window.innerWidth - MARGIN) placeAt(menu, { right: MARGIN, top: r.top })
  else if (r.left < MARGIN) placeAt(menu, { left: MARGIN, top: r.top })
  if (r.bottom > window.innerHeight - MARGIN) {
    menu.style.top = `${Math.max(MARGIN, window.innerHeight - MARGIN - r.height)}px`
  }
}

function firstItem(menu: HTMLElement): HTMLElement | null {
  return menu.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')
}

const MARGIN = 8
