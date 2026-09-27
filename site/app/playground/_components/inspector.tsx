'use client'

import {
  OBJECT_ID_MAX,
  PLACE_ID_MAX,
  labeling,
  seatPlan,
  type Group,
  type PlanBox,
  type PlanObject,
  type SeatPlan,
} from 'ichno'
import { planEdits, type SeatPlanEditor } from 'ichno/editor'
import { describe, makeupOf } from '../../_demo/messages'
import { relayRow, relayTable, rowOf, setWholeTable, tableOf } from '../_lib/build'
import styles from '../playground.module.css'
import { NumberField, Segmented, SliderField, TextField, Toggle } from './fields'
import { SaveObject } from './objects'

type Editor = SeatPlanEditor<string>

type Props = {
  editor: Editor
  sectionNames: Record<string, string>
  booked: readonly string[]
  onNotice(text: string | null): void
  // Keeps the selection as a saved object under this name.
  onSaveObject(name: string): void
}

export function Inspector(props: Props) {
  const { editor } = props
  const [only, ...others] = editor.selection
  if (!only) return <DocumentInspector {...props} />
  if (others.length > 0) return <MultiInspector {...props} />
  if (only.kind === 'section') return <SectionInspector {...props} sectionId={only.id} />
  if (only.kind === 'group') {
    const group = seatPlan.groupById(editor.plan, only.id)
    return group ? <GroupInspector key={group.id} {...props} group={group} /> : null
  }
  const object = seatPlan.objectById(editor.plan, only.id)
  return object ? <ObjectInspector key={object.id} {...props} object={object} /> : null
}

function DocumentInspector({ editor, sectionNames, booked }: Props) {
  const plan = editor.plan
  const places = seatPlan.placesOf(plan)
  const capacity = places.reduce((sum, place) => sum + place.capacity, 0)
  return (
    <div className={styles.inspector}>
      <p className={styles.panelHint}>
        The objects on the left were made in advance for this playground out of ichno’s places, fixtures and groups.
        Pick one and drag on the plan to draw it at any size, or tap to drop it. Tap anything to inspect it — a tap on a
        row, table or desk picks the whole group, a second tap one seat. Press <kbd>?</kbd> for every shortcut.
      </p>
      <dl className={styles.stats}>
        <div>
          <dt>Objects</dt>
          <dd>{plan.objects.length}</dd>
        </div>
        <div>
          <dt>Places</dt>
          <dd>{places.length}</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd>{capacity}</dd>
        </div>
        <div>
          <dt>Booked</dt>
          <dd>{booked.length}</dd>
        </div>
      </dl>
      <section className={styles.group}>
        <h3>Sections</h3>
        <div className={styles.list}>
          {plan.sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={styles.listItem}
              onClick={() => editor.select({ kind: 'section', id: section.id })}
            >
              <span>{sectionNames[section.id] ?? section.id}</span>
              <code>{section.id}</code>
            </button>
          ))}
        </div>
        <p className={styles.panelHint}>The section list is fixed by your app — ichno never adds or removes one.</p>
      </section>
      <section className={styles.group}>
        <h3>Categories</h3>
        {plan.categories.length === 0 ? (
          <p className={styles.panelHint}>This document lists no categories.</p>
        ) : (
          <div className={styles.chips}>
            {plan.categories.map((category) => (
              <span key={category.key} className={styles.chip} data-category={category.key}>
                {category.key}
                {category.accessible ? ' ♿' : ''}
              </span>
            ))}
          </div>
        )}
      </section>
      <p className={styles.panelMeta}>
        {plan.width} × {plan.height} plan units · {plan.groups.length} groups · document version {plan.version}
      </p>
    </div>
  )
}

function SectionInspector({ editor, sectionNames, sectionId }: Props & { sectionId: string }) {
  const section = editor.plan.sections.find((candidate) => candidate.id === sectionId)
  if (!section) return null
  const bounds = seatPlan.sectionBoundsOf(section)
  const places = seatPlan.placesOf(editor.plan).filter((place) => place.section === section.id)
  return (
    <div className={styles.inspector}>
      <header className={styles.inspectorHead}>
        <span className={styles.kind}>Section</span>
        <strong>{sectionNames[section.id] ?? section.id}</strong>
        <code>{section.id}</code>
      </header>
      <p className={styles.panelHint}>
        Drag the floor or use the arrow keys to move the section, drag a corner handle to reshape it. With Snap on,
        outlines keep to the 46-unit cell grid.
      </p>
      <dl className={styles.stats}>
        <div>
          <dt>Places</dt>
          <dd>{places.length}</dd>
        </div>
        <div>
          <dt>Corners</dt>
          <dd>{section.points.length}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>
            {bounds.w} × {bounds.h}
          </dd>
        </div>
      </dl>
    </div>
  )
}

function MultiInspector({ editor, onNotice, onSaveObject }: Props) {
  const count = editor.selection.length
  const placeIds = editor.selectedPlaceIds
  return (
    <div className={styles.inspector}>
      <header className={styles.inspectorHead}>
        <span className={styles.kind}>Selection</span>
        <strong>{count} items</strong>
      </header>
      <section className={styles.group}>
        <h3>Align</h3>
        <div className={styles.buttonGrid}>
          <button type="button" onClick={() => editor.alignSelected('left')}>
            Left
          </button>
          <button type="button" onClick={() => editor.alignSelected('center-x')}>
            Centre
          </button>
          <button type="button" onClick={() => editor.alignSelected('right')}>
            Right
          </button>
          <button type="button" onClick={() => editor.alignSelected('top')}>
            Top
          </button>
          <button type="button" onClick={() => editor.alignSelected('center-y')}>
            Middle
          </button>
          <button type="button" onClick={() => editor.alignSelected('bottom')}>
            Bottom
          </button>
        </div>
      </section>
      <section className={styles.group}>
        <h3>Distribute</h3>
        <div className={styles.buttonGrid} data-columns="2">
          <button type="button" onClick={() => editor.distributeSelected('x')} disabled={count < 3}>
            Horizontally
          </button>
          <button type="button" onClick={() => editor.distributeSelected('y')} disabled={count < 3}>
            Vertically
          </button>
        </div>
      </section>
      <section className={styles.group}>
        <h3>Labels</h3>
        <p className={styles.panelHint}>
          Numbers the selected groups (rows, tables) — or the places, when none is a group.
        </p>
        <div className={styles.buttonGrid} data-columns="2">
          <button type="button" onClick={() => editor.label(labelTargets(editor, placeIds), labeling.numbers())}>
            1, 2, 3…
          </button>
          <button
            type="button"
            onClick={() => editor.label(labelTargets(editor, placeIds), labeling.letters({ skip: ['I', 'O'] }))}
          >
            A, B, C…
          </button>
        </div>
      </section>
      <section className={styles.group}>
        <h3>Group</h3>
        <div className={styles.buttonGrid} data-columns="2">
          <button type="button" onClick={() => editor.groupSelected()} title="⌘G">
            Group
          </button>
        </div>
      </section>
      <Actions editor={editor} onNotice={onNotice} onSaveObject={onSaveObject} />
    </div>
  )
}

function GroupInspector({ editor, booked, onNotice, onSaveObject, group }: Props & { group: Group }) {
  const locked = new Set(booked)
  const members = seatPlan.membersOf(editor.plan, group.id)
  const places = members.filter((o) => o.kind === 'place')
  const row = group.role === 'row' ? rowOf(editor.plan, group.id) : null
  const table = group.role === 'table' ? tableOf(editor.plan, group.id) : null
  const categories = editor.plan.categories
  const extent = seatPlan.extentOf(members.filter((o) => o.kind !== 'label'))

  // Moves the group so the top-left of what it draws lands on the typed position — exactly, not to the grid.
  function moveTo(position: { x?: number; y?: number }) {
    if (!extent) return
    const delta = {
      x: (position.x ?? Math.round(extent.x)) - Math.round(extent.x),
      y: (position.y ?? Math.round(extent.y)) - Math.round(extent.y),
    }
    editor.edit((current) => planEdits.move(current, [group.id], delta))
  }

  function rename(next: string): boolean {
    const ok = editor.renameObject(group.id, next)
    onNotice(ok ? null : `“${next}” can't be used: ids are unique and ${OBJECT_ID_MAX} characters at most.`)
    return ok
  }

  function refused(ok: boolean) {
    onNotice(ok ? null : 'A booked place cannot be removed or turned into furniture.')
    return ok
  }

  return (
    <div className={styles.inspector}>
      <header className={styles.inspectorHead}>
        <span className={styles.kind}>Group</span>
        <strong>{describe(editor.plan, group.id)}</strong>
        {editor.isLocked(group.id) && <span className={styles.badge}>booked</span>}
      </header>
      <StoredAs role={group.role}>{makeupOf(members, 1)}</StoredAs>

      <section className={styles.group}>
        <TextField label="Id" value={group.id} mono onCommit={rename} />
        <TextField
          label="Label"
          value={group.label ?? ''}
          placeholder="None"
          onCommit={(next) =>
            editor.updateGroup(group.id, (current) => {
              const { label: _, ...rest } = current
              return next ? { ...rest, label: next } : rest
            })
          }
        />
        {places.length > 0 && categories.length > 0 && (
          <CategoryField
            value={categoryOf(places)}
            categories={categories}
            onChange={(category) =>
              editor.edit((current) =>
                withCategory(
                  current,
                  places.map((o) => o.id),
                  category,
                ),
              )
            }
          />
        )}
      </section>

      {row && (
        <section className={styles.group}>
          <h3>Playground row</h3>
          <p className={styles.panelHint}>
            The playground reads the row back from its seats and lays it out again — ichno only stores the seats.
          </p>
          <NumberField
            label="Seats"
            value={row.seats.length}
            min={1}
            max={60}
            onCommit={(count) => refused(editor.edit((current) => relayRow(current, group.id, { count }, locked)))}
          />
          <SliderField
            key={`${group.id}-${row.curve}`}
            label="Curve"
            value={row.curve}
            min={-1}
            max={1}
            step={0.05}
            onCommit={(curve) => editor.edit((current) => relayRow(current, group.id, { curve }, locked))}
          />
          <div className={styles.fieldLabel}>Seat labels</div>
          <div className={styles.buttonGrid}>
            <button type="button" onClick={() => editor.label(ids(row.seats), labeling.numbers())}>
              1 → {row.seats.length}
            </button>
            <button type="button" onClick={() => editor.label(ids(row.seats), labeling.numbers({ reverse: true }))}>
              {row.seats.length} → 1
            </button>
            <button type="button" onClick={() => editor.label(ids(row.seats), labeling.numbers({ step: 2 }))}>
              1, 3, 5…
            </button>
          </div>
        </section>
      )}

      {table && (
        <section className={styles.group}>
          <h3>Playground table</h3>
          <p className={styles.panelHint}>
            The playground finds the top by its role and sets the seats around it — ichno only stores the top and the
            seats.
          </p>
          <NumberField
            label="Seats"
            value={table.seats.length}
            min={1}
            max={16}
            onCommit={(count) => refused(editor.edit((current) => relayTable(current, group.id, { count }, locked)))}
          />
          <Segmented
            label="Shape"
            value={table.top.shape}
            options={[
              { value: 'ellipse', label: 'Round' },
              { value: 'rect', label: 'Rectangle' },
            ]}
            onChange={(shape) => editor.edit((current) => relayTable(current, group.id, { shape }, locked))}
          />
          <Toggle
            label="Book the whole table at once"
            checked={table.whole}
            onChange={(whole) => refused(editor.edit((current) => setWholeTable(current, group.id, whole, locked)))}
          />
          {!table.whole && (
            <div className={styles.buttonGrid} data-columns="2">
              <button type="button" onClick={() => editor.label(ids(table.seats), labeling.numbers())}>
                Number seats
              </button>
              <button type="button" onClick={() => editor.label(ids(table.seats), labeling.letters())}>
                Letter seats
              </button>
            </div>
          )}
        </section>
      )}

      <section className={styles.group}>
        {extent && (
          <div className={styles.fieldGrid}>
            <NumberField
              label="X"
              value={Math.round(extent.x)}
              min={-POSITION_MAX}
              max={POSITION_MAX}
              onCommit={(x) => moveTo({ x })}
            />
            <NumberField
              label="Y"
              value={Math.round(extent.y)}
              min={-POSITION_MAX}
              max={POSITION_MAX}
              onCommit={(y) => moveTo({ y })}
            />
          </div>
        )}
        <NumberField
          label="Facing (°)"
          value={Math.round(group.rotation ?? 0)}
          min={-359}
          max={359}
          onCommit={(degrees) => editor.rotateSelected(degrees - (group.rotation ?? 0))}
        />
      </section>

      <p className={styles.panelMeta}>
        {members.length} objects · {places.length} places
        {extent ? ` · ${Math.round(extent.w)} × ${Math.round(extent.h)}` : ''} · drag the knob above it to turn it about
        its centre
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={() => editor.ungroup(group.id)}>
          Ungroup
        </button>
      </div>
      <Actions editor={editor} onNotice={onNotice} onSaveObject={onSaveObject} />
    </div>
  )
}

function ObjectInspector({ editor, onNotice, onSaveObject, object }: Props & { object: PlanObject<string> }) {
  const locked = editor.isLocked(object.id)
  const categories = editor.plan.categories
  const owner = object.group === undefined ? undefined : seatPlan.groupById(editor.plan, object.group)

  function update(next: (current: PlanObject<string>) => PlanObject<string>) {
    editor.updateObject(object.id, next)
  }

  // Puts the object's box where the fields say — exactly, not to the grid; it keeps its turn.
  function place(change: Partial<PlanBox>) {
    const { x, y, w, h, rotation } = object
    editor.arrange([object.id], [{ x, y, w, h, rotation, ...change }])
  }

  function rename(next: string): boolean {
    const ok = editor.renameObject(object.id, next)
    const max = object.kind === 'place' ? PLACE_ID_MAX : OBJECT_ID_MAX
    onNotice(
      ok ? null : `“${next}” can't be used: ids are unique, ${max} characters at most, and booked places keep theirs.`,
    )
    return ok
  }

  return (
    <div className={styles.inspector}>
      <header className={styles.inspectorHead}>
        <span className={styles.kind}>{KIND_NAMES[object.kind]}</span>
        <strong>{describe(editor.plan, object.id)}</strong>
        {locked && <span className={styles.badge}>booked</span>}
      </header>
      <StoredAs role={object.kind === 'label' ? undefined : object.role}>
        {object.kind === 'place'
          ? `a place${object.capacity > 1 ? ` for ${object.capacity}` : ''}`
          : object.kind === 'fixture'
            ? 'a fixture — nothing to book'
            : 'a label, where its group’s name is written'}
      </StoredAs>

      {owner && (
        <button
          type="button"
          className={styles.listItem}
          onClick={() => editor.select({ kind: 'group', id: owner.id })}
        >
          <span>Part of {describe(editor.plan, owner.id)}</span>
          <code>{owner.id}</code>
        </button>
      )}

      <section className={styles.group}>
        <TextField label="Id" value={object.id} mono onCommit={rename} />
        {object.kind === 'place' && (
          <TextField
            label="Label"
            value={object.label ?? ''}
            placeholder={object.id}
            onCommit={(next) =>
              update((current) => {
                if (current.kind !== 'place') return current
                const { label: _, ...rest } = current
                return next ? { ...rest, label: next } : rest
              })
            }
          />
        )}
        {object.kind !== 'label' && (
          <TextField
            label="Role"
            value={object.role ?? ''}
            placeholder="None"
            onCommit={(next) =>
              update((current) => {
                if (current.kind === 'label') return current
                const { role: _, ...rest } = current
                return (next ? { ...rest, role: next } : rest) as PlanObject<string>
              })
            }
          />
        )}
        {object.kind === 'place' && categories.length > 0 && (
          <CategoryField
            value={object.category ?? ''}
            categories={categories}
            onChange={(category) => editor.edit((current) => withCategory(current, [object.id], category))}
          />
        )}
      </section>

      <section className={styles.group}>
        <div className={styles.fieldGrid}>
          <NumberField
            label="X"
            value={object.x}
            min={-POSITION_MAX}
            max={POSITION_MAX}
            onCommit={(x) => place({ x })}
          />
          <NumberField
            label="Y"
            value={object.y}
            min={-POSITION_MAX}
            max={POSITION_MAX}
            onCommit={(y) => place({ y })}
          />
          <NumberField label="Width" value={object.w} min={1} max={POSITION_MAX} onCommit={(w) => place({ w })} />
          <NumberField label="Height" value={object.h} min={1} max={POSITION_MAX} onCommit={(h) => place({ h })} />
        </div>
        {object.kind === 'place' && (
          <NumberField
            label="Capacity"
            value={object.capacity}
            min={1}
            max={5000}
            onCommit={(capacity) =>
              update((current) => (current.kind === 'place' ? { ...current, capacity } : current))
            }
          />
        )}
        {object.kind !== 'label' && (
          <Segmented
            label="Shape"
            value={object.shape}
            options={[
              { value: 'rect', label: 'Rectangle' },
              { value: 'ellipse', label: 'Ellipse' },
            ]}
            onChange={(shape) => update((current) => (current.kind === 'label' ? current : { ...current, shape }))}
          />
        )}
        {object.kind !== 'label' && (
          <NumberField
            label="Turn (°)"
            value={Math.round(object.rotation ?? 0)}
            min={-359}
            max={359}
            onCommit={(degrees) => editor.rotateSelected(degrees - (object.rotation ?? 0))}
          />
        )}
      </section>

      {object.rotation ? (
        <p className={styles.panelMeta}>
          X and Y are the corner of the box before its turn of {object.rotation}° about its centre.
        </p>
      ) : null}
      {locked && (
        <p className={styles.panelHint}>
          {describe(editor.plan, object.id)} is booked — it can be moved and relabelled, but not deleted or renamed.
        </p>
      )}
      <Actions editor={editor} onNotice={onNotice} onSaveObject={onSaveObject} />
    </div>
  )
}

// ichno's own names for what it stores.
const KIND_NAMES = { place: 'Place', fixture: 'Fixture', label: 'Label' } as const

// What ichno stores for the selection, and whose word its role is — the playground's, never ichno's.
function StoredAs({ role, children }: { role: string | undefined; children: string }) {
  return (
    <p className={styles.storedAs}>
      ichno stores {children}
      {role ? (
        <>
          ; <code>{role}</code> is the playground’s name for it.
        </>
      ) : (
        '.'
      )}
    </p>
  )
}

function Actions({
  editor,
  onNotice,
  onSaveObject,
}: {
  editor: Editor
  onNotice(text: string | null): void
  onSaveObject(name: string): void
}) {
  return (
    <div className={styles.actions}>
      <button type="button" className={styles.button} onClick={() => editor.rotateSelected(90)} title="R">
        Turn 90°
      </button>
      <button type="button" className={styles.button} onClick={() => editor.duplicateSelected()} title="⌘D">
        Duplicate
      </button>
      <button
        type="button"
        className={styles.button}
        data-danger=""
        title="Delete"
        onClick={() => {
          const refused = editor.removeSelected()
          onNotice(
            refused.length > 0
              ? `${refused.map((id) => describe(editor.plan, id)).join(', ')} holds a booked place and stays.`
              : null,
          )
        }}
      >
        Delete
      </button>
      <SaveObject onSave={onSaveObject} />
    </div>
  )
}

function CategoryField({
  value,
  categories,
  onChange,
}: {
  value: string
  categories: SeatPlan<string>['categories']
  onChange(category: string | undefined): void
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>Category</span>
      <select
        className={styles.input}
        value={value}
        onChange={(e) => {
          const next = e.currentTarget.value
          if (next !== 'mixed') onChange(next || undefined)
        }}
      >
        <option value="">None</option>
        {value === 'mixed' && <option value="mixed">Mixed</option>}
        {categories.map((category) => (
          <option key={category.key} value={category.key}>
            {category.key}
          </option>
        ))}
      </select>
    </label>
  )
}

// What the label buttons of a mixed selection number — its groups when it holds any, else its places.
function labelTargets(editor: Editor, placeIds: readonly string[]): string[] {
  const groups = editor.selection.flatMap((item) => (item.kind === 'group' ? [item.id] : []))
  return groups.length > 0 ? groups : [...placeIds]
}

function withCategory(plan: SeatPlan<string>, ids: readonly string[], category: string | undefined) {
  const wanted = new Set(ids)
  return {
    ...plan,
    objects: plan.objects.map((o) => {
      if (o.kind !== 'place' || !wanted.has(o.id)) return o
      const { category: _, ...rest } = o
      return category ? { ...rest, category } : rest
    }),
  }
}

// The category the places share — '' for none, 'mixed' when they differ.
function categoryOf(places: readonly PlanObject<string>[]): string {
  const values = places.map((o) => (o.kind === 'place' ? (o.category ?? '') : ''))
  const unique = new Set(values)
  return unique.size > 1 ? 'mixed' : (values[0] ?? '')
}

// Positions typed into the fields stay within reach of any plan.
const POSITION_MAX = 100_000

function ids(objects: readonly { id: string }[]): string[] {
  return objects.map((o) => o.id)
}
