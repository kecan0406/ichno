'use client'

import type { Fixture, PlanTemplate } from 'ichno'
import { SeatMap } from 'ichno/react'
import { useState } from 'react'
import { partsOf } from '../../_demo/messages'
import { previewOf, type SavedObject } from '../_lib/library'
import { savedObjectTool, type PlaygroundObject, type ToolDef } from '../_lib/playground-objects'
import styles from '../playground.module.css'
import { Icon } from './icons'

// The object panel — what this playground made in advance and what you saved, side by side and drawn the same way,
// because they are the same thing: ichno places, fixtures and groups someone put together.

export function ObjectPanel({
  objects,
  saved,
  activeId,
  keep,
  canSave,
  onPick,
  onToggleKeep,
  onSave,
  onDelete,
}: {
  objects: readonly PlaygroundObject[]
  saved: readonly SavedObject[]
  // The id of the tool in use — null while selecting.
  activeId: string | null
  keep: boolean
  canSave: boolean
  onPick(def: ToolDef | null): void
  onToggleKeep(): void
  onSave(name: string): void
  onDelete(id: string): void
}) {
  const shelf = (name: PlaygroundObject['shelf']) => objects.filter((object) => object.shelf === name)
  return (
    <nav className={styles.objects} aria-label="Objects">
      <div className={styles.modes}>
        <button type="button" aria-pressed={activeId === null} title="Select (V)" onClick={() => onPick(null)}>
          <Icon name="select" />
          Select
        </button>
        <button
          type="button"
          aria-pressed={keep}
          title="Keep the object picked after placing one (Q)"
          onClick={onToggleKeep}
        >
          <Icon name="keep" />
          Keep
        </button>
      </div>

      <section className={styles.shelf} aria-labelledby="playground-objects">
        <h2 id="playground-objects">Playground objects</h2>
        <p className={styles.shelfHint}>
          Made in advance for this playground out of ichno’s places, fixtures and groups — an app makes its own the same
          way.
        </p>
        <h3>Seating</h3>
        <ul className={styles.cards}>
          {shelf('seating').map((object) => (
            <li key={object.id}>
              <ObjectCard
                name={object.name}
                shortcut={object.key}
                template={object.sample}
                active={activeId === object.id}
                onPick={() => onPick(object)}
              />
            </li>
          ))}
        </ul>
        <h3>Fixtures</h3>
        <p className={styles.shelfHint}>Each is one fixture — nothing to book.</p>
        <ul className={styles.cards} data-compact="">
          {shelf('fixtures').map((object) => (
            <li key={object.id}>
              <ObjectCard
                name={object.name}
                template={object.sample}
                compact
                active={activeId === object.id}
                onPick={() => onPick(object)}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.shelf} aria-labelledby="your-objects">
        <h2 id="your-objects">Your objects</h2>
        {saved.length === 0 ? (
          <p className={styles.shelfHint}>
            Select anything on the plan and save it — it shows up here, ready to place again.
          </p>
        ) : (
          <ul className={styles.cards}>
            {saved.map((object) => (
              <li key={object.id}>
                <ObjectCard
                  name={object.name}
                  template={object.template}
                  active={activeId === `saved:${object.id}`}
                  onPick={() => onPick(savedObjectTool(object))}
                  onDelete={() => onDelete(object.id)}
                />
              </li>
            ))}
          </ul>
        )}
        <SaveObject label="Save selection as object…" disabled={!canSave} onSave={onSave} />
      </section>
    </nav>
  )
}

// One object — its thumbnail, its name and what ichno stores for it (left out when `compact`).
function ObjectCard({
  name,
  shortcut,
  template,
  compact = false,
  active,
  onPick,
  onDelete,
}: {
  name: string
  shortcut?: string
  template: PlanTemplate
  compact?: boolean
  active: boolean
  onPick(): void
  onDelete?(): void
}) {
  const parts = partsOf(template.objects, template.groups.length)
  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.cardPick}
        aria-pressed={active}
        title={`${name}${shortcut ? ` (${shortcut})` : ''} — ${parts}`}
        onClick={onPick}
      >
        <Thumbnail template={template} size={compact ? SMALL : THUMB} />
        <span className={styles.cardText}>
          <span className={styles.cardTitle}>
            <span className={styles.cardName}>{name}</span>
            {shortcut && <kbd className={styles.cardKey}>{shortcut}</kbd>}
          </span>
          {!compact && <span className={styles.cardMakeup}>{parts}</span>}
        </span>
      </button>
      {onDelete && (
        <button
          type="button"
          className={styles.cardDelete}
          aria-label={`Delete ${name}`}
          title="Delete"
          onClick={onDelete}
        >
          ×
        </button>
      )}
    </div>
  )
}

const THUMB = { w: 48, h: 34 }
const SMALL = { w: 34, h: 24 }

// An object drawn small — the same parts as the plan, with labels too small to read left out.
function Thumbnail({ template, size }: { template: PlanTemplate; size: { w: number; h: number } }) {
  const { plan, view } = previewOf(template)
  return (
    // A picture only — its places are no options to pick, and their ids are the sample's, not the plan's.
    <SeatMap.Root
      plan={plan}
      view={view}
      style={{ width: size.w, height: size.h }}
      className={styles.thumb}
      aria-hidden
    >
      <SeatMap.Content
        plan={plan}
        scale={Math.min(size.w / view.w, size.h / view.h)}
        fixtureLabel={noLabel}
        fixtureVariant={thumbVariant}
      />
    </SeatMap.Root>
  )
}

function noLabel(): null {
  return null
}

function thumbVariant(fixture: Fixture): 'box' | 'wall' {
  return fixture.role === 'wall' ? 'wall' : 'box'
}

// A button that opens a name field; saving hands the name on and closes it.
export function SaveObject({
  label = 'Save as object…',
  disabled = false,
  onSave,
}: {
  label?: string
  disabled?: boolean
  onSave(name: string): void
}) {
  const [open, setOpen] = useState(false)
  if (!open || disabled) {
    return (
      <button type="button" className={styles.button} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  }
  return (
    <form
      className={styles.saveForm}
      onSubmit={(e) => {
        e.preventDefault()
        const name = String(new FormData(e.currentTarget).get('name') ?? '').trim()
        if (!name) return
        onSave(name)
        setOpen(false)
      }}
    >
      <input
        name="name"
        className={styles.input}
        placeholder="Name it — e.g. Banquet table"
        aria-label="Object name"
        maxLength={40}
        autoFocus
        required
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      <div className={styles.actions}>
        <button type="submit" className={styles.button} data-primary="">
          Save
        </button>
        <button type="button" className={styles.button} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
