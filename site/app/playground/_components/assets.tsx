'use client'

import type { Fixture, PlanTemplate } from 'ichno'
import { SeatMap } from 'ichno/react'
import { useState } from 'react'
import { partsOf } from '../../_demo/messages'
import { previewOf, type SavedObject } from '../_lib/library'
import { savedObjectTool, type PlaygroundObject, type ToolDef } from '../_lib/playground-objects'
import controls from './controls.module.css'
import { Icon } from './icons'
import styles from './assets.module.css'

// The assets panel — this playground's own objects (one place or fixture each) and what you saved, drawn the same
// way, because they are the same thing: ichno objects someone put together (like components in a design tool).
// Picking one places it on the plan.

type Props = {
  objects: readonly PlaygroundObject[]
  saved: readonly SavedObject[]
  // The id of the tool in use — null while selecting.
  activeId: string | null
  canSave: boolean
  // The save form is open — also from the plan's menu.
  saving: boolean
  onSavingChange(open: boolean): void
  onPick(def: ToolDef): void
  onSave(name: string): void
  onDelete(id: string): void
}

export function AssetsPanel({
  objects,
  saved,
  activeId,
  canSave,
  saving,
  onSavingChange,
  onPick,
  onSave,
  onDelete,
}: Props) {
  const [query, setQuery] = useState('')
  const matches = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase())
  const shelf = (name: PlaygroundObject['shelf']) =>
    objects.filter((object) => object.shelf === name && matches(object.name))
  const places = shelf('places')
  const fixtures = shelf('fixtures')
  const structure = shelf('structure')
  const yours = saved.filter((object) => matches(object.name))

  return (
    <div className={styles.panel}>
      <label className={styles.search}>
        <Icon name="search" size={14} />
        <input
          type="search"
          placeholder="Search assets"
          aria-label="Search assets"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
      </label>

      <section className={styles.shelf} aria-labelledby="playground-objects">
        <h2 id="playground-objects" className={styles.heading}>
          Playground objects
        </h2>
        <p className={styles.note}>
          One ichno place, fixture or wall each, with a role this playground gave it — an app makes its own the same
          way. Group them into rows and tables yourself (⌘G).
        </p>
        {places.length > 0 && (
          <>
            <h3 className={styles.subheading}>Places</h3>
            <ul className={styles.cards}>
              {places.map((object) => (
                <li key={object.id}>
                  <AssetCard
                    name={object.name}
                    shortcut={object.key}
                    template={object.sample}
                    active={activeId === object.id}
                    onPick={() => onPick(object)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        {fixtures.length > 0 && (
          <>
            <h3 className={styles.subheading}>Fixtures</h3>
            <ul className={styles.cards} data-compact="">
              {fixtures.map((object) => (
                <li key={object.id}>
                  <AssetCard
                    name={object.name}
                    template={object.sample}
                    compact
                    active={activeId === object.id}
                    onPick={() => onPick(object)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        {structure.length > 0 && (
          <>
            <h3 className={styles.subheading}>Structure</h3>
            <ul className={styles.cards} data-compact="">
              {structure.map((object) => (
                <li key={object.id}>
                  <AssetCard
                    name={object.name}
                    template={object.sample}
                    compact
                    active={activeId === object.id}
                    onPick={() => onPick(object)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        {places.length + fixtures.length + structure.length === 0 && (
          <p className={styles.note}>No playground object matches.</p>
        )}
      </section>
      <section className={styles.shelf} aria-labelledby="your-objects">
        <h2 id="your-objects" className={styles.heading}>
          Your objects <span>{saved.length}</span>
        </h2>
        {saved.length === 0 && !saving && (
          <p className={styles.note}>Select anything on the plan and save it — it lands here, ready to place again.</p>
        )}
        {yours.length > 0 && (
          <ul className={styles.cards}>
            {yours.map((object) => (
              <li key={object.id}>
                <AssetCard
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
        <SaveForm open={saving} disabled={!canSave} onOpenChange={onSavingChange} onSave={onSave} />
      </section>
    </div>
  )
}

// One asset — its thumbnail, its name and what ichno stores for it (left out when `compact`).
function AssetCard({
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
        className={styles.pick}
        aria-pressed={active}
        title={`${name}${shortcut ? ` (${shortcut})` : ''} — ${parts}`}
        onClick={onPick}
      >
        <Thumbnail template={template} size={compact ? SMALL : THUMB} />
        <span className={styles.text}>
          <span className={styles.title}>
            <span className={styles.name}>{name}</span>
            {shortcut && <kbd className={controls.kbd}>{shortcut}</kbd>}
          </span>
          {!compact && <span className={styles.parts}>{parts}</span>}
        </span>
      </button>
      {onDelete && (
        <button
          type="button"
          className={`${controls.iconButton} ${styles.delete}`}
          aria-label={`Delete ${name}`}
          title="Delete"
          onClick={onDelete}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  )
}

const THUMB = { w: 44, h: 32 }
const SMALL = { w: 30, h: 22 }

// An asset drawn small — the same parts as the plan, without text.
export function Thumbnail({ template, size }: { template: PlanTemplate; size: { w: number; h: number } }) {
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
        minLabelPx={Infinity}
        fixtureVariant={thumbVariant}
      />
    </SeatMap.Root>
  )
}

function thumbVariant(fixture: Fixture): 'box' | 'wall' {
  return fixture.role === 'wall' ? 'wall' : 'box'
}

// Saving the selection as an asset: a button that opens a name field.
function SaveForm({
  open,
  disabled,
  onOpenChange,
  onSave,
}: {
  open: boolean
  disabled: boolean
  onOpenChange(open: boolean): void
  onSave(name: string): void
}) {
  if (!open || disabled) {
    return (
      <button
        type="button"
        className={controls.button}
        data-wide=""
        disabled={disabled}
        title={disabled ? 'Select something on the plan first' : undefined}
        onClick={() => onOpenChange(true)}
      >
        <Icon name="plus" size={14} />
        Save selection as asset
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
        onOpenChange(false)
      }}
    >
      <input
        name="name"
        className={styles.nameInput}
        placeholder="Name it — e.g. Banquet table"
        aria-label="Asset name"
        maxLength={40}
        autoFocus
        required
        onKeyDown={(e) => {
          if (e.key === 'Escape') onOpenChange(false)
        }}
      />
      <div className={controls.buttons}>
        <button type="submit" className={controls.button} data-primary="">
          Save
        </button>
        <button type="button" className={controls.button} onClick={() => onOpenChange(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
