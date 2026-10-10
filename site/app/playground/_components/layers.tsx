'use client'

import type { PlanObject, SeatPlan } from 'ichno'
import type { EditorSelection } from 'ichno/editor'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { describe } from '../../_demo/messages'
import { keyOf, layersOf } from '../_lib/layers'
import { pressKeepingFocus } from './focus'
import { Icon, type IconName } from './icons'
import styles from './layers.module.css'

// The layers panel — the document as ichno holds it: its walls, then its groups and the objects outside them, top of
// the drawing first. A row picks exactly what it shows (a seat of a row, not the row), shift or ⌘ adds to the
// selection, hovering outlines it on the plan, and a double-click (or F2) renames what people read. Tab brings the
// keyboard in: arrows move between rows and open groups, Enter or Space selects, Enter again steps into a group.
// The lock and the eye beside a row freeze and hide it on the plan — ichno's `frozenIds` and `hiddenIds`.

type Item = EditorSelection<string>

type Row = {
  key: string
  item: Item
  level: 1 | 2
  icon: IconName
  name: string
  // Beside the name — the playground's word for a group, a booking id that differs from its label, a capacity.
  meta?: { text: string; mono?: boolean }
  // Groups only — whether its members show, whether it holds the selection, and its members.
  open?: boolean
  holds?: boolean
  children?: Item[]
  // A member's group row.
  parent?: string
  // What a rename changes — the label people read; null when the row has none to change.
  label: string | null
}

type Props = {
  plan: SeatPlan<string>
  selection: readonly Item[]
  isLocked(id: string): boolean
  onSelect(items: Item[]): void
  onHover(item: Item | null): void
  // A group's or a place's new label — empty clears it.
  onRename(item: Item, label: string): void
  frozen: ReadonlySet<string>
  hidden: ReadonlySet<string>
  onFreeze(id: string, on: boolean): void
  onHide(id: string, on: boolean): void
}

// What the lock and the eye show and change — objects and groups only.
type Toggles = Pick<Props, 'frozen' | 'hidden' | 'onFreeze' | 'onHide'>

export function LayersPanel({ plan, selection, isLocked, onSelect, onHover, onRename, ...toggles }: Props) {
  const selected = new Set(selection.map(keyOf))
  // Groups opened or closed by hand; the rest are open while they hold the selection.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})

  const walls: Row[] = plan.walls.map((wall) => ({
    key: keyOf({ kind: 'wall', id: wall.id }),
    item: { kind: 'wall', id: wall.id },
    level: 1,
    icon: 'wall',
    name: wall.closed ? 'Room walls' : 'Wall',
    meta: { text: wall.id, mono: true },
    label: null,
  }))

  const layers: Row[] = []
  for (const layer of layersOf(plan)) {
    if (layer.kind === 'object') {
      layers.push(objectRow(plan, layer.object, 1))
      continue
    }
    const { group, members } = layer
    const key = keyOf({ kind: 'group', id: group.id })
    const holds = members.some((o) => selected.has(keyOf({ kind: 'object', id: o.id })))
    const open = toggled[group.id] ?? holds
    layers.push({
      key,
      item: { kind: 'group', id: group.id },
      level: 1,
      icon: 'group',
      name: describe(plan, group.id),
      meta: group.role ? { text: group.role } : undefined,
      open,
      holds,
      children: members.map((o) => ({ kind: 'object', id: o.id })),
      label: group.label ?? '',
    })
    if (open) for (const member of members) layers.push({ ...objectRow(plan, member, 2), parent: key })
  }

  // Opens or closes a group's row — the other way from how it is, without `open`.
  function toggle(row: Row, open?: boolean) {
    setToggled((current) => ({ ...current, [row.item.id]: open ?? !row.open }))
  }

  return (
    <div className={styles.panel} onPointerLeave={() => onHover(null)}>
      <h2 className={styles.heading}>
        Walls <span>{walls.length}</span>
      </h2>
      {walls.length === 0 ? (
        <p className={styles.empty}>No walls yet — put some up with the Wall tool (W), or drag a Room from Assets.</p>
      ) : (
        <Tree
          label="Walls"
          rows={walls}
          selected={selected}
          selection={selection}
          isLocked={() => false}
          toggles={toggles}
          onSelect={onSelect}
          onHover={onHover}
          onToggle={toggle}
          onRename={onRename}
        />
      )}
      <h2 className={styles.heading}>
        Layers <span>{plan.objects.length}</span>
      </h2>
      {layers.length === 0 ? (
        <p className={styles.empty}>Nothing on the plan yet — draw a place or pick an asset.</p>
      ) : (
        <Tree
          label="Layers"
          rows={layers}
          selected={selected}
          selection={selection}
          isLocked={isLocked}
          toggles={toggles}
          onSelect={onSelect}
          onHover={onHover}
          onToggle={toggle}
          onRename={onRename}
        />
      )}
    </div>
  )
}

function Tree({
  label,
  rows,
  selected,
  selection,
  isLocked,
  toggles,
  onSelect,
  onHover,
  onToggle,
  onRename,
}: {
  label: string
  rows: Row[]
  selected: ReadonlySet<string>
  selection: readonly Item[]
  isLocked(id: string): boolean
  toggles?: Toggles
  onSelect(items: Item[]): void
  onHover(item: Item | null): void
  onToggle(row: Row, open?: boolean): void
  onRename(item: Item, label: string): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // The one row Tab lands on — the focused one, else the first selected, else the first.
  const active = rows.find((row) => row.key === focused) ?? rows.find((row) => selected.has(row.key)) ?? rows[0]

  // Keep what was just selected in view — on the plan or here.
  const shown = rows.filter((row) => selected.has(row.key)).map((row) => row.key)
  const first = shown[0]
  useEffect(() => {
    if (first === undefined) return
    ref.current?.querySelector(`[data-key="${CSS.escape(first)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [first])

  function pick(row: Row, e: MouseEvent | KeyboardEvent) {
    if (!(e.shiftKey || e.metaKey || e.ctrlKey)) return onSelect([row.item])
    onSelect(selected.has(row.key) ? selection.filter((item) => keyOf(item) !== row.key) : [...selection, row.item])
  }

  function focusRow(row: Row | undefined) {
    if (row) ref.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(row.key)}"]`)?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target
    if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'treeitem') return
    const index = rows.findIndex((row) => row.key === target.dataset.key)
    const row = rows[index]
    if (!row) return
    if (e.key === 'ArrowDown') focusRow(rows[index + 1])
    else if (e.key === 'ArrowUp') focusRow(rows[index - 1])
    else if (e.key === 'Home') focusRow(rows[0])
    else if (e.key === 'End') focusRow(rows.at(-1))
    else if (e.key === 'ArrowRight' && row.open === false) onToggle(row, true)
    else if (e.key === 'ArrowRight' && row.open) focusRow(rows[index + 1])
    else if (e.key === 'ArrowLeft' && row.open) onToggle(row, false)
    else if (e.key === 'ArrowLeft' && row.parent) focusRow(rows.find((other) => other.key === row.parent))
    // Enter on a selected group selects its members, ⇧Enter on a member its group — the editor's keys, here.
    else if (e.key === 'Enter' && e.shiftKey && row.parent) {
      const parent = rows.find((other) => other.key === row.parent)
      if (parent) onSelect([parent.item])
      focusRow(parent)
    } else if (e.key === 'Enter' && row.children && selected.has(row.key)) {
      onToggle(row, true)
      onSelect(row.children)
    } else if (e.key === 'Enter' || e.key === ' ') pick(row, e)
    else if (e.key === 'F2' && row.label !== null) setEditing(row.key)
    // Everything else — Delete, R, ⌘D… — is the editor's.
    else return
    e.preventDefault()
  }

  return (
    <div ref={ref} role="tree" aria-label={label} aria-multiselectable className={styles.tree} onKeyDown={onKeyDown}>
      {rows.map((row) => {
        const id = row.item.id
        // A member of a frozen or hidden group is too — its own toggle shows it, greyed.
        const parent = row.parent === undefined ? undefined : rows.find((other) => other.key === row.parent)?.item.id
        const frozen = toggles?.frozen.has(id) ?? false
        const hidden = toggles?.hidden.has(id) ?? false
        const byGroup = {
          frozen: parent !== undefined && (toggles?.frozen.has(parent) ?? false),
          hidden: parent !== undefined && (toggles?.hidden.has(parent) ?? false),
        }
        return (
          <div
            key={row.key}
            role="treeitem"
            aria-level={row.level}
            aria-selected={selected.has(row.key)}
            aria-expanded={row.open}
            tabIndex={row === active ? 0 : -1}
            data-key={row.key}
            data-holds={row.holds || undefined}
            data-hidden={hidden || byGroup.hidden || undefined}
            data-level={row.level}
            className={styles.row}
            onMouseDown={pressKeepingFocus}
            onClick={(e) => pick(row, e)}
            onDoubleClick={() => row.label !== null && setEditing(row.key)}
            onPointerEnter={() => onHover(row.item)}
            onFocus={(e) => {
              if (e.target === e.currentTarget) setFocused(row.key)
            }}
          >
            <span
              className={styles.caret}
              aria-hidden
              onClick={(e) => {
                if (row.open === undefined) return
                e.stopPropagation()
                onToggle(row)
              }}
            >
              {row.open !== undefined && <Icon name={row.open ? 'chevronDown' : 'chevronRight'} size={12} />}
            </span>
            <span className={styles.icon} aria-hidden>
              <Icon name={row.icon} size={14} />
            </span>
            {editing === row.key && row.label !== null ? (
              <input
                className={styles.rename}
                aria-label="Label"
                defaultValue={row.label}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  if (editing !== row.key) return
                  setEditing(null)
                  if (e.currentTarget.value.trim() !== row.label) onRename(row.item, e.currentTarget.value.trim())
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') {
                    e.currentTarget.value = row.label ?? ''
                    e.currentTarget.blur()
                  }
                }}
              />
            ) : (
              <span className={styles.name}>{row.name}</span>
            )}
            {row.meta && (
              <span className={styles.meta} data-mono={row.meta.mono || undefined}>
                {row.meta.text}
              </span>
            )}
            {(row.item.kind === 'object' || row.item.kind === 'group') && isLocked(row.item.id) && (
              <span className={styles.lock} title="Holds a booked place">
                <Icon name="booked" size={12} />
              </span>
            )}
            {toggles && (
              <>
                <ToggleButton
                  icon="lock"
                  label={frozen ? 'Unlock' : 'Lock'}
                  on={frozen}
                  inherited={byGroup.frozen}
                  onClick={() => toggles.onFreeze(id, !frozen)}
                />
                <ToggleButton
                  icon={hidden ? 'eyeOff' : 'eye'}
                  label={hidden ? 'Show' : 'Hide'}
                  on={hidden}
                  inherited={byGroup.hidden}
                  onClick={() => toggles.onHide(id, !hidden)}
                />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

// The lock or the eye of a row — shown while the row is hovered, and always once it is on. Left out of the tab order:
// the tree keeps the keyboard, and the plan's menu is the way there without a pointer.
function ToggleButton({
  icon,
  label,
  on,
  inherited,
  onClick,
}: {
  icon: IconName
  label: string
  on: boolean
  inherited: boolean
  onClick(): void
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={styles.toggle}
      aria-label={label}
      aria-pressed={on}
      title={inherited && !on ? `${label} — its group already is` : label}
      data-on={on || undefined}
      data-inherited={(inherited && !on) || undefined}
      onMouseDown={pressKeepingFocus}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <Icon name={icon} size={12} />
    </button>
  )
}

// An object's row — named the way people read it, with what ichno stores beside it.
function objectRow(plan: SeatPlan<string>, object: PlanObject<string>, level: 1 | 2): Row {
  const key = keyOf({ kind: 'object', id: object.id })
  const item: Item = { kind: 'object', id: object.id }
  if (object.kind === 'label') {
    const group = plan.groups.find((g) => g.id === object.group)
    return {
      key,
      item,
      level,
      icon: 'label',
      name: 'Label',
      meta: { text: group?.label ?? object.group },
      label: null,
    }
  }
  if (object.kind === 'fixture') {
    return { key, item, level, icon: 'fixture', name: object.role ?? object.id, label: null }
  }
  const meta =
    object.capacity > 1
      ? { text: `×${object.capacity}` }
      : level === 2 && object.label !== undefined && object.label !== object.id
        ? { text: object.id, mono: true }
        : level === 1 && object.role
          ? { text: object.role }
          : undefined
  return {
    key,
    item,
    level,
    icon: object.shape === 'ellipse' ? 'ellipse' : 'place',
    name: object.label ?? object.id,
    meta,
    label: object.label ?? '',
  }
}
