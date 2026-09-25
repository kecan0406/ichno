'use client'

import { useState, type ReactNode } from 'react'
import styles from '../playground.module.css'

// Inputs that commit once — on Enter or blur — so typing a word is one undo step, not one per key.
// Escape puts the value back. Remounted (key) whenever the committed value changes elsewhere.

type TextFieldProps = {
  label: string
  value: string
  placeholder?: string
  mono?: boolean
  // Return false to refuse the value; the field then shows the committed one again.
  onCommit(next: string): boolean | void
}

export function TextField({ label, value, placeholder, mono, onCommit }: TextFieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        key={value}
        className={styles.input}
        data-mono={mono || undefined}
        defaultValue={value}
        placeholder={placeholder}
        spellCheck={false}
        onBlur={(e) => {
          const next = e.currentTarget.value.trim()
          if (next !== value && onCommit(next) === false) e.currentTarget.value = value
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            e.currentTarget.value = value
            e.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

type NumberFieldProps = {
  label: string
  value: number
  min: number
  max: number
  onCommit(next: number): boolean | void
}

export function NumberField({ label, value, min, max, onCommit }: NumberFieldProps) {
  function commit(input: HTMLInputElement, next: number) {
    const clamped = Math.min(max, Math.max(min, Math.round(next)))
    if (Number.isNaN(clamped) || clamped === value || onCommit(clamped) === false) input.value = String(value)
  }
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.stepper}>
        <button type="button" onClick={() => onCommit(Math.max(min, value - 1))} disabled={value <= min}>
          −
        </button>
        <input
          key={value}
          className={styles.input}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          defaultValue={value}
          onBlur={(e) => commit(e.currentTarget, Number(e.currentTarget.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        <button type="button" onClick={() => onCommit(Math.min(max, value + 1))} disabled={value >= max}>
          +
        </button>
      </span>
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
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onCommit(next: number): void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value
  function commit() {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        <output className={styles.fieldValue}>{shown.toFixed(2)}</output>
      </span>
      <input
        className={styles.range}
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => setDraft(Number(e.currentTarget.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T | null
  options: readonly { value: T; label: ReactNode }[]
  onChange(next: T): void
}) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.segmented} role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
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
