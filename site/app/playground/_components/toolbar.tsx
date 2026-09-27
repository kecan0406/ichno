'use client'

import type { PlanTemplate } from 'ichno'
import { PRIMITIVE_TOOLS, type ToolDef } from '../_lib/playground-objects'
import { Thumbnail } from './assets'
import { pressKeepingFocus } from './focus'
import { Icon, type IconName } from './icons'
import styles from './toolbar.module.css'

// The floating toolbar — what a press on the plan does: select, pan, or draw one of ichno's primitives (a place, a
// fixture). The playground's own objects are assets; the one being placed shows here until it is put down.

type Props = {
  // `select`, `hand`, or the id of the editor's tool.
  active: string
  // The asset being placed, if one is.
  asset: { name: string; template: PlanTemplate } | null
  assetsOpen: boolean
  snapping: boolean
  keep: boolean
  onSelect(): void
  onHand(): void
  onTool(def: ToolDef): void
  onAssets(): void
  onSnap(): void
  onKeep(): void
}

export function Toolbar({
  active,
  asset,
  assetsOpen,
  snapping,
  keep,
  onSelect,
  onHand,
  onTool,
  onAssets,
  onSnap,
  onKeep,
}: Props) {
  return (
    <div role="toolbar" aria-label="Tools" className={styles.toolbar}>
      <Tool icon="select" label="Select" keys="V" pressed={active === 'select'} onClick={onSelect} />
      <Tool icon="hand" label="Hand — drag to pan" keys="H" pressed={active === 'hand'} onClick={onHand} />
      <span className={styles.divider} />
      {PRIMITIVE_TOOLS.map((def) => (
        <Tool
          key={def.id}
          icon={PRIMITIVE_ICONS[def.id] ?? 'place'}
          label={`${def.name} — ${def.id === 'place' ? 'something to book' : 'anything else'}`}
          keys={def.key}
          pressed={active === def.id}
          onClick={() => onTool(def)}
        />
      ))}
      <span className={styles.divider} />
      {asset && (
        <span className={styles.asset} title={`Placing “${asset.name}” — Esc puts it down`}>
          <Thumbnail template={asset.template} size={{ w: 26, h: 20 }} />
          <span>{asset.name}</span>
          <button type="button" aria-label="Put it down" onMouseDown={pressKeepingFocus} onClick={onSelect}>
            <Icon name="close" size={12} />
          </button>
        </span>
      )}
      <Tool icon="assets" label="Assets" keys="⇧I" pressed={assetsOpen} toggle onClick={onAssets} />
      <span className={styles.divider} />
      <Tool icon="snap" label="Snap to the grid" pressed={snapping} toggle onClick={onSnap} />
      <Tool icon="repeat" label="Keep the tool after placing" keys="Q" pressed={keep} toggle onClick={onKeep} />
    </div>
  )
}

const PRIMITIVE_ICONS: Partial<Record<string, IconName>> = { place: 'place', fixture: 'fixture' }

function Tool({
  icon,
  label,
  keys,
  pressed,
  toggle = false,
  onClick,
}: {
  icon: IconName
  label: string
  keys?: string
  pressed: boolean
  // A setting that stays on (snap, keep), drawn quieter than the tool in use.
  toggle?: boolean
  onClick(): void
}) {
  return (
    <button
      type="button"
      className={styles.tool}
      data-toggle={toggle || undefined}
      aria-pressed={pressed}
      aria-label={label}
      title={keys ? `${label} (${keys})` : label}
      onMouseDown={pressKeepingFocus}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  )
}
