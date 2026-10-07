'use client'

import { useState, type ReactNode } from 'react'
import styles from './controls.module.css'

// Property fields, the way a design tool's panel has them. A field commits once — on Enter or when it loses focus —
// so typing a value is one undo step, and Escape puts the value back. `null` is a mixed value (a selection whose
// items differ): the field shows "Mixed" until something is typed.

// A titled block of the property panel.
export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  )
}

type NumberFieldProps = {
  // Drawn inside the field, at its left — a letter (X, W) or a glyph.
  icon: ReactNode
  label: string
  value: number | null
  min: number
  max: number
  unit?: string
  title?: string
  // Return false to refuse the value; the field then shows the committed one again.
  onCommit(next: number): boolean | void
}

// A number with its name inside. ↑ and ↓ step by one (Shift: ten) and commit at once.
export function NumberField({ icon, label, value, min, max, unit, title, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)

  function commit(next: number) {
    setDraft(null)
    const clamped = Math.min(max, Math.max(min, Math.round(next)))
    if (Number.isNaN(clamped) || clamped === value) return
    onCommit(clamped)
  }

  return (
    <label className={styles.field} title={title}>
      <span className={styles.fieldIcon} aria-hidden>
        {icon}
      </span>
      <span className={styles.srOnly}>{label}</span>
      <input
        className={styles.fieldInput}
        inputMode="numeric"
        spellCheck={false}
        value={draft ?? (value === null ? '' : String(value))}
        placeholder={value === null ? 'Mixed' : undefined}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => {
          if (draft !== null && draft.trim() !== '') commit(Number(draft.trim()))
          else setDraft(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') cancel(e.currentTarget, setDraft)
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && value !== null) {
            e.preventDefault()
            commit(value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1))
          }
        }}
      />
      {unit && <span className={styles.fieldUnit}>{unit}</span>}
    </label>
  )
}

type TextFieldProps = {
  label: string
  value: string | null
  placeholder?: string
  mono?: boolean
  // Return false to refuse the value; the field then shows the committed one again.
  onCommit(next: string): boolean | void
}

// Text with its name to the left.
export function TextField({ label, value, placeholder, mono, onCommit }: TextFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.field}>
        <input
          className={styles.fieldInput}
          style={{ paddingLeft: 8 }}
          data-mono={mono || undefined}
          spellCheck={false}
          value={draft ?? value ?? ''}
          placeholder={value === null ? 'Mixed' : placeholder}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={() => {
            const next = draft?.trim()
            setDraft(null)
            if (next !== undefined && next !== value) onCommit(next)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') cancel(e.currentTarget, setDraft)
          }}
        />
      </span>
    </label>
  )
}

// A choice from a list, with its name to the left. `null` is mixed.
export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string | null
  options: readonly { value: string; label: string }[]
  onChange(next: string): void
}) {
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <select
        className={styles.select}
        value={value ?? MIXED}
        onChange={(e) => {
          if (e.currentTarget.value !== MIXED) onChange(e.currentTarget.value)
        }}
      >
        {value === null && (
          <option value={MIXED} disabled>
            Mixed
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

const MIXED = '__mixed__'

// Escape — the draft goes, then the field lets go of the focus once it has drawn without it, so leaving commits
// nothing.
function cancel(input: HTMLInputElement, setDraft: (draft: null) => void) {
  setDraft(null)
  requestAnimationFrame(() => input.blur())
}

// One of a few options — text or glyphs. `null` is mixed (none pressed). Without a label it fills its row.
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T | null
  options: readonly { value: T; label: ReactNode; title?: string }[]
  onChange(next: T): void
}) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.segmented} role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            title={option.title}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange(next: boolean): void
}) {
  return (
    <label className={styles.toggle}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  )
}

// A slider that previews locally and commits when released.
export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onPreview,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  // The value while the slider is dragged — null once it is let go.
  onPreview?(next: number | null): void
  onCommit(next: number): void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value
  function change(next: number) {
    setDraft(next)
    onPreview?.(next)
  }
  function commit() {
    if (draft !== null && draft !== value) onCommit(draft)
    else if (draft !== null) onPreview?.(null)
    setDraft(null)
  }
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>
        {label} <output>{shown.toFixed(2)}</output>
      </span>
      <input
        className={styles.range}
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => change(Number(e.currentTarget.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  )
}

// A value that is shown, not edited.
export function ReadOnly({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{children}</span>
    </div>
  )
}
