'use client'

import type { LintCode, LintSeverity, SeatPlan, SelectionIssue } from 'ichno'
import { useRef, useState } from 'react'
import { selectionIssueKey, selectionIssueText } from '../../_demo/messages'
import { parseDocument, type Check } from '../_lib/documents'
import styles from '../playground.module.css'
import { NumberField, Segmented, Toggle } from './fields'

const LINT_RULES: { code: LintCode; name: string }[] = [
  { code: 'duplicate_label', name: 'Duplicate labels' },
  { code: 'outside_section', name: 'Places outside their section' },
  { code: 'missing_category', name: 'Places without a category' },
  { code: 'empty_section', name: 'Empty sections' },
]

export function ChecksPanel({
  checks,
  lint,
  onLintChange,
  onFocus,
}: {
  checks: Check[]
  lint: Record<LintCode, LintSeverity>
  onLintChange(next: Record<LintCode, LintSeverity>): void
  onFocus(ids: string[]): void
}) {
  const errors = checks.filter((check) => check.severity === 'error').length
  return (
    <div className={styles.inspector}>
      <p className={styles.panelHint}>
        {errors > 0
          ? `The schema would refuse to save this document (${errors} ${errors === 1 ? 'error' : 'errors'}).`
          : 'The schema accepts this document — it is safe to store.'}
      </p>
      {checks.length === 0 ? (
        <p className={styles.allClear}>No problems found.</p>
      ) : (
        <ul className={styles.checks}>
          {checks.map((check) => (
            <li key={check.key}>
              <button
                type="button"
                className={styles.check}
                data-severity={check.severity}
                onClick={() => onFocus(check.ids)}
                disabled={check.ids.length === 0}
              >
                <span className={styles.checkDot} />
                {check.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      <section className={styles.group}>
        <h3>Lint rules</h3>
        <p className={styles.panelHint}>
          Soft rules never block a save. Each app picks how loud they are — this is <code>lintSeatPlan</code>’s severity
          map.
        </p>
        {LINT_RULES.map((rule) => (
          <Segmented
            key={rule.code}
            label={rule.name}
            value={lint[rule.code]}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'warning', label: 'Warn' },
              { value: 'error', label: 'Error' },
            ]}
            onChange={(severity) => onLintChange({ ...lint, [rule.code]: severity })}
          />
        ))}
      </section>
    </div>
  )
}

export function JsonPanel({ plan, onImport }: { plan: SeatPlan<string>; onImport(): void }) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(plan, null, 2)

  async function copy() {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked — the text below stays selectable.
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'seat-plan.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={styles.jsonPanel}>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className={styles.button} onClick={download}>
          Download
        </button>
        <button type="button" className={styles.button} onClick={onImport}>
          Import…
        </button>
      </div>
      <p className={styles.panelMeta}>{new Blob([json]).size.toLocaleString('en')} bytes · what your app stores</p>
      <pre className={styles.json}>
        <code>{json}</code>
      </pre>
    </div>
  )
}

export type PickRules = { max: number; consecutive: boolean; noOrphans: boolean }

export function PreviewPanel({
  plan,
  picking,
  onPickingChange,
  rules,
  onRulesChange,
  picked,
  guests,
  issues,
  booked,
  onClear,
}: {
  plan: SeatPlan<string>
  picking: 'pick' | 'book'
  onPickingChange(next: 'pick' | 'book'): void
  rules: PickRules
  onRulesChange(next: PickRules): void
  picked: readonly string[]
  guests: number
  issues: SelectionIssue[]
  booked: readonly string[]
  onClear(): void
}) {
  return (
    <div className={styles.inspector}>
      <p className={styles.panelHint}>
        This is the plan as your customers would see it. Booked places stay booked in the editor too — they become its
        <code>lockedIds</code>, so what they hold cannot be deleted.
      </p>
      <Segmented
        label="Tapping a place"
        value={picking}
        options={[
          { value: 'pick', label: 'Picks it' },
          { value: 'book', label: 'Books it' },
        ]}
        onChange={onPickingChange}
      />
      <section className={styles.group}>
        <h3>Selection rules</h3>
        <NumberField
          label="At most"
          value={rules.max}
          min={1}
          max={50}
          onCommit={(max) => onRulesChange({ ...rules, max })}
        />
        <Toggle
          label="Seats side by side in one row"
          checked={rules.consecutive}
          onChange={(consecutive) => onRulesChange({ ...rules, consecutive })}
        />
        <Toggle
          label="Leave no seat stranded"
          checked={rules.noOrphans}
          onChange={(noOrphans) => onRulesChange({ ...rules, noOrphans })}
        />
      </section>
      <section className={styles.group}>
        <h3>Selection</h3>
        {picked.length === 0 ? (
          <p className={styles.panelHint}>Nothing picked yet.</p>
        ) : (
          <>
            <p className={styles.summaryLine}>
              {picked.length} {picked.length === 1 ? 'place' : 'places'} · {guests} {guests === 1 ? 'guest' : 'guests'}
            </p>
            {issues.length === 0 ? (
              <p className={styles.allClear}>This selection passes every rule.</p>
            ) : (
              <ul className={styles.checks}>
                {issues.map((issue) => (
                  <li key={selectionIssueKey(issue)} className={styles.check} data-severity="warning">
                    <span className={styles.checkDot} />
                    {selectionIssueText(plan, issue)}
                  </li>
                ))}
              </ul>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.button} onClick={onClear}>
                Clear selection
              </button>
            </div>
          </>
        )}
      </section>
      <p className={styles.panelMeta}>{booked.length} booked</p>
    </div>
  )
}

export function ImportDialog({ onLoad }: { onLoad(plan: SeatPlan<string>): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [errors, setErrors] = useState<string[]>([])

  return (
    <dialog ref={dialogRef} id="import-dialog" className={styles.dialog} onClose={() => setErrors([])}>
      <form
        method="dialog"
        className={styles.dialogBody}
        onSubmit={(e) => {
          const text = new FormData(e.currentTarget).get('json')
          const result = parseDocument(typeof text === 'string' ? text : '')
          if ('errors' in result) {
            e.preventDefault()
            setErrors(result.errors)
            return
          }
          onLoad(result.plan)
        }}
      >
        <h2>Import a document</h2>
        <p className={styles.panelHint}>
          Paste a SeatPlan document. It is checked with <code>createSeatPlanSchema</code> using its own section ids;
          documents from ichno 0.1 are upgraded on the way in.
        </p>
        <textarea name="json" className={styles.textarea} rows={12} spellCheck={false} required />
        {errors.length > 0 && (
          <ul className={styles.checks}>
            {errors.slice(0, 8).map((error, i) => (
              <li key={i} className={styles.check} data-severity="error">
                <span className={styles.checkDot} />
                {error}
              </li>
            ))}
          </ul>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button type="submit" className={styles.button} data-primary="">
            Load
          </button>
        </div>
      </form>
    </dialog>
  )
}
