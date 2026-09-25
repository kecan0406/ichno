'use client'

import {
  OBJECT_ID_MAX,
  PLACE_ID_MAX,
  SEAT_CHAIR_SIDES,
  labeling,
  seatPlan,
  type PlanObject,
  type Row,
  type SeatPlan,
} from 'ichno'
import type { SeatPlanEditor } from 'ichno/editor'
import { describe } from '../../_demo/messages'
import styles from '../playground.module.css'
import { NumberField, Segmented, SliderField, TextField, Toggle } from './fields'

type Editor = SeatPlanEditor<string>

type Props = {
  editor: Editor
  sectionNames: Record<string, string>
  booked: readonly string[]
  onNotice(text: string | null): void
}

const KIND_NAMES: Record<PlanObject['kind'], string> = {
  desk: 'Desk',
  row: 'Row',
  table: 'Table',
  booth: 'Booth',
  area: 'Area',
  fixture: 'Fixture',
}

export function Inspector(props: Props) {
  const { editor } = props
  const [only, ...others] = editor.selectedObjects
  if (editor.selectedSection && !only) return <SectionInspector {...props} sectionId={editor.selectedSection.id} />
  if (!only) return <DocumentInspector {...props} />
  if (others.length > 0) return <MultiInspector {...props} />
  return <ObjectInspector key={only.id} {...props} object={only} />
}

function DocumentInspector({ editor, sectionNames, booked }: Props) {
  const plan = editor.plan
  const places = seatPlan.placesOf(plan)
  const capacity = places.reduce((sum, place) => sum + place.capacity, 0)
  return (
    <div className={styles.inspector}>
      <p className={styles.panelHint}>
        Pick a tool on the left and tap the floor, or tap anything on the plan to inspect it. Shift-tap adds to the
        selection; dragging the floor draws a marquee.
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
        {plan.width} × {plan.height} plan units · document version {plan.version}
      </p>
    </div>
  )
}

function SectionInspector({ editor, sectionNames, onNotice, sectionId }: Props & { sectionId: string }) {
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
        Drag the floor to move the section, drag a corner handle to reshape it. Outlines snap to the 46-unit cell grid.
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
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          onClick={() => onNotice(editor.addDesk(section.id) ? null : 'No free 2×2 spot left in this section.')}
        >
          Add a desk here
        </button>
      </div>
    </div>
  )
}

function MultiInspector({ editor, onNotice }: Props) {
  const ids = editor.selectedObjects.map((object) => object.id)
  const hasDesks = editor.selectedObjects.some((object) => object.kind === 'desk')
  return (
    <div className={styles.inspector}>
      <header className={styles.inspectorHead}>
        <span className={styles.kind}>Selection</span>
        <strong>{ids.length} objects</strong>
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
          <button type="button" onClick={() => editor.distributeSelected('x')} disabled={ids.length < 3}>
            Horizontally
          </button>
          <button type="button" onClick={() => editor.distributeSelected('y')} disabled={ids.length < 3}>
            Vertically
          </button>
        </div>
      </section>
      <section className={styles.group}>
        <h3>Labels</h3>
        <div className={styles.buttonGrid} data-columns="2">
          <button type="button" onClick={() => editor.labelObjects(ids, labeling.numbers())}>
            1, 2, 3…
          </button>
          <button type="button" onClick={() => editor.labelObjects(ids, labeling.letters({ skip: ['I', 'O'] }))}>
            A, B, C…
          </button>
        </div>
      </section>
      <Actions editor={editor} onNotice={onNotice} rotate={hasDesks} />
    </div>
  )
}

function ObjectInspector({ editor, booked, onNotice, object }: Props & { object: PlanObject<string> }) {
  const locked = editor.isLocked(object)
  const isPlace = object.kind !== 'row' && object.kind !== 'fixture'
  const categories = editor.plan.categories

  function update(next: (current: PlanObject<string>) => PlanObject<string>) {
    editor.updateObject(object.id, next)
  }

  function rename(next: string): boolean {
    const ok = editor.renameObject(object.id, next)
    onNotice(
      ok
        ? null
        : `“${next}” can't be used: ids are unique, ${isPlace ? PLACE_ID_MAX : OBJECT_ID_MAX} characters at most, and booked places keep theirs.`,
    )
    return ok
  }

  function setSeats(count: number): boolean {
    const ok = editor.setSeatCount(object.id, count)
    onNotice(ok ? null : 'A booked seat cannot be removed.')
    return ok
  }

  return (
    <div className={styles.inspector}>
      <header className={styles.inspectorHead}>
        <span className={styles.kind}>{KIND_NAMES[object.kind]}</span>
        <strong>{object.kind === 'fixture' ? object.role : describe(editor.plan, object.id)}</strong>
        {locked && <span className={styles.badge}>booked</span>}
      </header>

      <section className={styles.group}>
        <TextField label="Id" value={object.id} mono onCommit={rename} />
        {object.kind !== 'fixture' && (
          <TextField
            label="Label"
            value={object.label ?? ''}
            placeholder={object.kind === 'row' ? 'None' : object.id}
            onCommit={(next) => update((current) => withLabel(current, next))}
          />
        )}
        {object.kind === 'fixture' && (
          <TextField
            label="Role"
            value={object.role}
            onCommit={(next) => {
              if (!next) return false
              update((current) => (current.kind === 'fixture' ? { ...current, role: next } : current))
            }}
          />
        )}
        {object.kind !== 'fixture' && categories.length > 0 && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Category</span>
            <select
              className={styles.input}
              value={categoryOf(object)}
              onChange={(e) => update((current) => withCategory(current, e.currentTarget.value || undefined))}
            >
              <option value="">None</option>
              {categoryOf(object) === 'mixed' && <option value="mixed">Mixed</option>}
              {categories.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.key}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {object.kind === 'row' && <RowFields editor={editor} row={object} onSeats={setSeats} />}

      {object.kind === 'table' && (
        <section className={styles.group}>
          <NumberField label="Seats" value={object.seats.length} min={1} max={16} onCommit={setSeats} />
          <Segmented
            label="Shape"
            value={object.shape}
            options={[
              { value: 'round', label: 'Round' },
              { value: 'rect', label: 'Rectangle' },
            ]}
            onChange={(shape) => update((current) => (current.kind === 'table' ? { ...current, shape } : current))}
          />
          <Toggle
            label="Book the whole table at once"
            checked={object.wholeBooking === true}
            onChange={(whole) => update((current) => withWholeBooking(current, whole))}
          />
          <div className={styles.buttonGrid} data-columns="2">
            <button type="button" onClick={() => editor.labelSeats(object.id, labeling.numbers())}>
              Number seats
            </button>
            <button type="button" onClick={() => editor.labelSeats(object.id, labeling.letters())}>
              Letter seats
            </button>
          </div>
        </section>
      )}

      {object.kind === 'desk' && (
        <section className={styles.group}>
          <Segmented
            label="Chair"
            value={object.chairSide}
            options={SEAT_CHAIR_SIDES.map((side) => ({ value: side, label: CHAIR_ARROWS[side] }))}
            onChange={(chairSide) =>
              update((current) => (current.kind === 'desk' ? { ...current, chairSide } : current))
            }
          />
        </section>
      )}

      {object.kind === 'area' && (
        <section className={styles.group}>
          <NumberField
            label="Capacity"
            value={object.capacity}
            min={1}
            max={5000}
            onCommit={(capacity) => update((current) => (current.kind === 'area' ? { ...current, capacity } : current))}
          />
          <Segmented
            label="Shape"
            value={object.shape}
            options={[
              { value: 'rect', label: 'Rectangle' },
              { value: 'ellipse', label: 'Ellipse' },
            ]}
            onChange={(shape) => update((current) => (current.kind === 'area' ? { ...current, shape } : current))}
          />
          <Toggle
            label="Book the whole area at once"
            checked={object.wholeBooking === true}
            onChange={(whole) => update((current) => withWholeBooking(current, whole))}
          />
        </section>
      )}

      <p className={styles.panelMeta}>{geometryOf(object)}</p>
      {locked && (
        <p className={styles.panelHint}>
          {bookedIn(editor.plan, object, booked)} booked — it can be moved and relabelled, but not deleted or renamed.
        </p>
      )}
      <Actions editor={editor} onNotice={onNotice} rotate={object.kind === 'desk'} />
    </div>
  )
}

function RowFields({ editor, row, onSeats }: { editor: Editor; row: Row<string>; onSeats(count: number): boolean }) {
  return (
    <section className={styles.group}>
      <NumberField label="Seats" value={row.seats.length} min={1} max={60} onCommit={onSeats} />
      <SliderField
        key={`${row.id}-${row.curve}`}
        label="Curve"
        value={row.curve}
        min={-1}
        max={1}
        step={0.05}
        onCommit={(curve) =>
          editor.updateObject(row.id, (current) => (current.kind === 'row' ? { ...current, curve } : current))
        }
      />
      <div className={styles.fieldLabel}>Seat labels</div>
      <div className={styles.buttonGrid}>
        <button type="button" onClick={() => editor.labelSeats(row.id, labeling.numbers())}>
          1 → {row.seats.length}
        </button>
        <button type="button" onClick={() => editor.labelSeats(row.id, labeling.numbers({ reverse: true }))}>
          {row.seats.length} → 1
        </button>
        <button type="button" onClick={() => editor.labelSeats(row.id, labeling.numbers({ step: 2 }))}>
          1, 3, 5…
        </button>
      </div>
    </section>
  )
}

function Actions({
  editor,
  onNotice,
  rotate,
}: {
  editor: Editor
  onNotice(text: string | null): void
  rotate: boolean
}) {
  return (
    <div className={styles.actions}>
      {rotate && (
        <button type="button" className={styles.button} onClick={editor.rotateSelected} title="R">
          Turn chair
        </button>
      )}
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
    </div>
  )
}

const CHAIR_ARROWS = { up: '↑', right: '→', down: '↓', left: '←' } as const

function withLabel(object: PlanObject<string>, label: string): PlanObject<string> {
  if (object.kind === 'fixture') return object
  const { label: _previous, ...rest } = object
  return (label ? { ...rest, label } : rest) as PlanObject<string>
}

function withWholeBooking(object: PlanObject<string>, whole: boolean): PlanObject<string> {
  if (object.kind !== 'table' && object.kind !== 'area') return object
  const { wholeBooking: _previous, ...rest } = object
  return (whole ? { ...rest, wholeBooking: true } : rest) as PlanObject<string>
}

function withCategory(object: PlanObject<string>, category: string | undefined): PlanObject<string> {
  if (category === 'mixed') return object
  const set = <T extends { category?: string }>(item: T): T => {
    const { category: _previous, ...rest } = item
    return (category ? { ...rest, category } : rest) as T
  }
  switch (object.kind) {
    case 'fixture':
      return object
    case 'row':
      return { ...object, seats: object.seats.map(set) }
    case 'table':
      return { ...set(object), seats: object.seats.map(set) }
    default:
      return set(object)
  }
}

// The category the object's places share — '' for none, 'mixed' when they differ.
function categoryOf(object: PlanObject<string>): string {
  const values =
    object.kind === 'fixture'
      ? []
      : object.kind === 'row'
        ? object.seats.map((seat) => seat.category ?? '')
        : object.kind === 'table'
          ? [object.category ?? '', ...object.seats.map((seat) => seat.category ?? '')]
          : [object.category ?? '']
  const unique = new Set(values)
  return unique.size > 1 ? 'mixed' : (values[0] ?? '')
}

function geometryOf(object: PlanObject<string>): string {
  if (object.kind === 'row') {
    return `From ${object.start.x}, ${object.start.y} to ${object.end.x}, ${object.end.y} · seats ${object.seatSize} units`
  }
  return `${object.w} × ${object.h} at ${object.x}, ${object.y}`
}

function bookedIn(plan: SeatPlan<string>, object: PlanObject<string>, booked: readonly string[]): string {
  const ids = seatPlan
    .placesOf({ objects: [object] })
    .map((place) => place.id)
    .filter((id) => booked.includes(id))
  return ids.length === 1 ? describe(plan, ids[0] ?? '') + ' is' : `${ids.length} places are`
}
