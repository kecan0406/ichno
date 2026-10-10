'use client'

import type { LintCode, LintSeverity, SeatPlan, SelectionIssue } from 'ichno'
import { useRef, useState } from 'react'
import { selectionIssueKey, selectionIssueText } from '../../_demo/messages'
import { copyDocument, downloadDocument, jsonOf, parseDocument, type Check } from '../_lib/documents'
import controls from './controls.module.css'
import { NumberField, Section, Segmented, Toggle } from './fields'
import styles from './panels.module.css'

// The right-hand panels besides Design — what the schema and the lint rules say (Checks), the stored document
// (JSON), the customer preview's settings — and the import dialog.

// The section rules are left out: the playground's section is the whole plan, which it never shows.
const LINT_RULES: { code: LintCode; name: string }[] = [
  { code: 'duplicate_label', name: 'Duplicate labels' },
  { code: 'missing_category', name: 'Places without a category' },
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
  // Selects what a check points at and brings it into view.
  onFocus(ids: string[]): void
}) {
  const errors = checks.filter((check) => check.severity === 'error').length

  return (
    <>
      <Section title="Checks">
        <p className={styles.verdict} data-state={errors > 0 ? 'error' : checks.length > 0 ? 'warning' : 'ok'}>
          {errors > 0
            ? `The schema would refuse this document — ${errors} ${errors === 1 ? 'error' : 'errors'}.`
            : checks.length > 0
              ? 'The schema accepts it — safe to store. Some lint rules flag it.'
              : 'The schema accepts it — safe to store. No problems found.'}
        </p>
        {checks.length > 0 && (
          <ul className={styles.checks}>
            {checks.map((check) => (
              <li key={check.key}>
                <button
                  type="button"
                  className={styles.check}
                  data-severity={check.severity}
                  onClick={() => onFocus(check.ids)}
                  disabled={check.ids.length === 0}
                  title={check.ids.length > 0 ? 'Select it on the plan' : undefined}
                >
                  <span className={styles.dot} />
                  {check.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Lint rules">
        <p className={controls.hint}>
          Soft rules never block a save; each app picks how loud they are — <code>lintSeatPlan</code>’s severities.
        </p>
        {LINT_RULES.map((rule) => (
          <div key={rule.code} className={styles.rule}>
            <span>{rule.name}</span>
            <div className={controls.segmented} role="radiogroup" aria-label={rule.name}>
              {SEVERITIES.map((severity) => (
                <button
                  key={severity.value}
                  type="button"
                  role="radio"
                  aria-checked={lint[rule.code] === severity.value}
                  onClick={() => onLintChange({ ...lint, [rule.code]: severity.value })}
                >
                  {severity.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Section>
    </>
  )
}

const SEVERITIES: { value: LintSeverity; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'warning', label: 'Warn' },
  { value: 'error', label: 'Error' },
]

export function JsonPanel({ plan, name, onImport }: { plan: SeatPlan<string>; name: string; onImport(): void }) {
  const [copied, setCopied] = useState(false)
  const json = jsonOf(plan)

  async function copy() {
    if (!(await copyDocument(plan))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={styles.json}>
      <div className={controls.buttons}>
        <button type="button" className={controls.button} onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className={controls.button} onClick={() => downloadDocument(plan, name)}>
          Download
        </button>
        <button type="button" className={controls.button} onClick={onImport}>
          Import…
        </button>
      </div>
      <p className={controls.hint}>{new Blob([json]).size.toLocaleString('en')} bytes — what your app stores.</p>
      <pre className={styles.code}>
        <code>{json}</code>
      </pre>
    </div>
  )
}

export type PickRules = { max: number; consecutive: boolean; noOrphans: boolean }

export function PreviewPanel({
  plan,
  threeD,
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
  threeD: boolean
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
    <>
      <Section title="Preview">
        <p className={controls.hint}>
          The plan as your customers would see it. Booked places stay booked in the editor too — they become its{' '}
          <code>lockedIds</code>, so what holds them cannot be deleted.
        </p>
        {threeD && (
          <p className={controls.hint}>
            The 3D view is this playground’s own, built with three.js from the same document. ichno stores footprints
            only — heights, which way chairs face and the furniture are the playground’s reading of its roles.
          </p>
        )}
        <Segmented
          label="A tap"
          value={picking}
          options={[
            { value: 'pick', label: 'Picks it' },
            { value: 'book', label: 'Books it' },
          ]}
          onChange={onPickingChange}
        />
      </Section>
      <Section title="Selection rules">
        <div className={controls.row}>
          <span className={controls.rowLabel}>At most</span>
          <NumberField
            icon="#"
            label="At most"
            value={rules.max}
            min={1}
            max={50}
            onCommit={(max) => onRulesChange({ ...rules, max })}
          />
        </div>
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
      </Section>
      <Section
        title="Picked"
        actions={
          picked.length > 0 && (
            <button type="button" className={controls.button} onClick={onClear}>
              Clear
            </button>
          )
        }
      >
        {picked.length === 0 ? (
          <p className={controls.hint}>Nothing picked yet — tap a place.</p>
        ) : (
          <>
            <p className={styles.summary}>
              {picked.length} {picked.length === 1 ? 'place' : 'places'} · {guests} {guests === 1 ? 'guest' : 'guests'}
            </p>
            {issues.length === 0 ? (
              <p className={styles.verdict} data-state="ok">
                This selection passes every rule.
              </p>
            ) : (
              <ul className={styles.checks}>
                {issues.map((issue) => (
                  <li key={selectionIssueKey(issue)} className={styles.check} data-severity="warning">
                    <span className={styles.dot} />
                    {selectionIssueText(plan, issue)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className={controls.hint}>{booked.length} booked</p>
      </Section>
    </>
  )
}

export function ImportDialog({ onLoad }: { onLoad(plan: SeatPlan<string>): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [errors, setErrors] = useState<string[]>([])

  return (
    <dialog
      ref={dialogRef}
      id="import-dialog"
      className={controls.dialog}
      onClose={() => setErrors([])}
      // Keys pressed here are for the dialog, not the editor behind it.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <form
        method="dialog"
        className={controls.dialogBody}
        onSubmit={(e) => {
          const result = parseDocument(textRef.current?.value ?? '')

          if ('errors' in result) {
            e.preventDefault()
            setErrors(result.errors)

            return
          }

          onLoad(result.plan)
        }}
      >
        <h2>Import a document</h2>
        <p className={controls.hint}>
          Paste a SeatPlan document. It is checked with <code>createSeatPlanSchema</code> using its own section ids;
          documents from ichno 0.1 and 0.2 are upgraded on the way in.
        </p>
        <textarea ref={textRef} name="json" className={controls.textarea} rows={12} spellCheck={false} required />
        {errors.length > 0 && (
          <ul className={styles.checks}>
            {errors.slice(0, 8).map((error, i) => (
              <li key={i} className={styles.check} data-severity="error">
                <span className={styles.dot} />
                {error}
              </li>
            ))}
          </ul>
        )}
        <div className={controls.dialogActions}>
          <button type="button" className={controls.button} onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button type="submit" className={controls.button} data-primary="">
            Load
          </button>
        </div>
      </form>
    </dialog>
  )
}
