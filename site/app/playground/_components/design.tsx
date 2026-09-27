'use client'

import {
  OBJECT_ID_MAX,
  PLACE_ID_MAX,
  labeling,
  seatPlan,
  type Group,
  type PlanObject,
  type PlanRect,
  type SeatPlan,
  type Shape,
} from 'ichno'
import { planEdits, type EditorSelection, type SeatPlanEditor } from 'ichno/editor'
import type { ReactNode } from 'react'
import { describe, makeupOf } from '../../_demo/messages'
import { relayRow, relayTable, rowOf, setWholeTable, tableOf } from '../_lib/build'
import controls from './controls.module.css'
import styles from './design.module.css'
import { pressKeepingFocus } from './focus'
import { NumberField, ReadOnly, Section, Segmented, SelectField, SliderField, TextField, Toggle } from './fields'
import { Icon, type IconName } from './icons'

// The Design panel — the properties of what is selected, in the order a design tool lists them: what it is, where it
// is, how big, then what ichno stores for it. A selection of several shows the values they share; the rest read
// "Mixed" until something is typed, and a typed value goes to every item. With nothing selected it shows the
// document.

type Editor = SeatPlanEditor<string>
type Item = EditorSelection<string>

type Props = {
  editor: Editor
  name: string
  sectionNames: Record<string, string>
  booked: readonly string[]
  snapping: boolean
  onSnappingChange(on: boolean): void
  onNotice(text: string | null): void
  // Deleting says what it could not delete, so the workspace does it.
  onRemove(): void
  // Opens the Assets tab's save form for the selection.
  onSaveAsset(): void
}

export function DesignPanel(props: Props) {
  const { selection } = props.editor
  if (selection.length === 0) return <DocumentDesign {...props} />
  const units = selection.filter((item) => item.kind !== 'section')
  if (units.length === 0) {
    const [only] = selection
    return selection.length === 1 && only ? (
      <SectionDesign {...props} sectionId={only.id} />
    ) : (
      <Head chip="Section" name={`${selection.length} sections`} stored="Drag one to move them together." />
    )
  }
  // A new selection starts with fresh fields.
  return <SelectionDesign key={units.map((item) => `${item.kind}:${item.id}`).join()} {...props} units={units} />
}

// ---------- Nothing selected: the document ----------

function DocumentDesign({ editor, name, booked, snapping, onSnappingChange }: Props) {
  const plan = editor.plan
  const places = seatPlan.placesOf(plan)
  const capacity = places.reduce((sum, place) => sum + place.capacity, 0)
  return (
    <>
      <Section title="Document">
        <ReadOnly label="Name">{name}</ReadOnly>
        <ReadOnly label="Size">
          {plan.width} × {plan.height} <span className={styles.unit}>plan units</span>
        </ReadOnly>
        <ReadOnly label="Version">{plan.version}</ReadOnly>
      </Section>
      <Section title="Contents">
        <dl className={styles.stats}>
          <Stat name="Objects" value={plan.objects.length} />
          <Stat name="Groups" value={plan.groups.length} />
          <Stat name="Places" value={places.length} />
          <Stat name="Capacity" value={capacity} />
          <Stat name="Sections" value={plan.sections.length} />
          <Stat name="Booked" value={booked.length} />
        </dl>
      </Section>
      <Section title="Categories">
        {plan.categories.length === 0 ? (
          <p className={controls.hint}>This document lists no categories.</p>
        ) : (
          <div className={styles.chips}>
            {plan.categories.map((category) => (
              <span key={category.key} className={styles.category} data-category={category.key}>
                {category.key}
                {category.accessible ? ' ♿' : ''}
              </span>
            ))}
          </div>
        )}
        <p className={controls.hint}>Keys only — names, colours and prices are your app’s.</p>
      </Section>
      <Section title="Grid">
        <Toggle label="Snap to the grid" checked={snapping} onChange={onSnappingChange} />
        <p className={controls.hint}>Objects land on half cells of 46, sections on whole ones, turns on 15°.</p>
      </Section>
      <p className={styles.tip}>
        Select something on the plan or in Layers to change it — a click on a row or a table picks the group, a second
        click one seat. <kbd className={controls.kbd}>?</kbd> lists every key.
      </p>
    </>
  )
}

function Stat({ name, value }: { name: string; value: number }) {
  return (
    <div>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </div>
  )
}

// ---------- A section ----------

function SectionDesign({ editor, sectionNames, sectionId }: Props & { sectionId: string }) {
  const section = seatPlan.sectionOf(editor.plan, sectionId)
  if (!section) return null
  const bounds = seatPlan.sectionBoundsOf(section)
  const places = seatPlan.placesOf(editor.plan).filter((place) => place.section === section.id)

  // Exactly where it is typed — not to the grid.
  function moveBy(delta: { x: number; y: number }) {
    editor.edit((current) => planEdits.moveSection(current, section!.id, delta, null))
  }

  return (
    <>
      <Head
        chip="Section"
        name={sectionNames[section.id] ?? section.id}
        id={section.id}
        stored={`ichno stores its outline — ${section.points.length} corners. Places name it as their section.`}
      />
      <Section title="Position">
        <div className={controls.pair}>
          <NumberField
            icon="X"
            label="X"
            value={Math.round(bounds.x)}
            min={-POSITION_MAX}
            max={POSITION_MAX}
            onCommit={(x) => moveBy({ x: x - Math.round(bounds.x), y: 0 })}
          />
          <NumberField
            icon="Y"
            label="Y"
            value={Math.round(bounds.y)}
            min={-POSITION_MAX}
            max={POSITION_MAX}
            onCommit={(y) => moveBy({ x: 0, y: y - Math.round(bounds.y) })}
          />
        </div>
        <ReadOnly label="Size">
          {Math.round(bounds.w)} × {Math.round(bounds.h)}
        </ReadOnly>
      </Section>
      <Section title="Section">
        <ReadOnly label="Places">{places.length}</ReadOnly>
        <p className={controls.hint}>
          Drag its corners on the plan to reshape it. Your app fixes which sections there are — ichno never adds or
          removes one.
        </p>
      </Section>
    </>
  )
}

// ---------- Objects and groups, one or many ----------

function SelectionDesign({
  editor,
  sectionNames,
  booked,
  onNotice,
  onRemove,
  onSaveAsset,
  units,
}: Props & { units: Item[] }) {
  const plan = editor.plan
  const locked = new Set(booked)
  const [single] = units.length === 1 ? units : []
  const object = single?.kind === 'object' ? seatPlan.objectById(plan, single.id) : undefined
  const group = single?.kind === 'group' ? seatPlan.groupById(plan, single.id) : undefined
  // Objects picked on their own (not as their group) — what shape and size apply to.
  const direct = units.flatMap((item) => (item.kind === 'object' ? (seatPlan.objectById(plan, item.id) ?? []) : []))
  const onlyObjects = direct.length === units.length
  const places = editor.selectedObjects.flatMap((o) => (o.kind === 'place' ? [o] : []))
  const fixtures = direct.flatMap((o) => (o.kind === 'fixture' ? [o] : []))
  const owner = object?.group === undefined ? undefined : seatPlan.groupById(plan, object.group)
  // What the selected objects draw — what X and Y move (a section in the selection stays put).
  const bounds = unionOf(editor.selectedObjects.map(seatPlan.boundsOf))
  const holdsBooked = units.some((item) => editor.isLocked(item.id))

  function refused(ok: boolean) {
    onNotice(ok ? null : 'A booked place cannot be removed or turned into furniture.')
    return ok
  }

  function rename(id: string, next: string, max: number): boolean {
    const ok = editor.renameObject(id, next)
    onNotice(
      ok ? null : `“${next}” can't be used: ids are unique, ${max} characters at most, and booked places keep theirs.`,
    )
    return ok
  }

  // Moves everything selected so what it draws starts at the typed position — exactly, not to the grid.
  function moveTo(position: { x?: number; y?: number }) {
    if (!bounds) return
    const delta = {
      x: position.x === undefined ? 0 : position.x - Math.round(bounds.x),
      y: position.y === undefined ? 0 : position.y - Math.round(bounds.y),
    }
    editor.edit((current) => planEdits.move(current, editor.selectedIds, delta))
  }

  // One object's box where the fields say — it keeps its turn.
  function placeBox(target: PlanObject<string>, change: { x?: number; y?: number }) {
    const { x, y, w, h, rotation } = target
    editor.arrange([target.id], [{ x, y, w, h, rotation, ...change }])
  }

  // Each selected item turned to face `degrees` — about its own centre.
  function turnTo(degrees: number) {
    editor.edit((current) =>
      units.reduce((next, item) => planEdits.rotate(next, [item.id], degrees - rotationOf(next, item)), current),
    )
  }

  // Each object's width or height — each keeps its corner.
  function resize(change: { w?: number; h?: number }) {
    editor.edit((current) =>
      planEdits.arrange(
        current,
        direct.map((o) => o.id),
        direct.map(({ x, y, w, h, rotation }) => ({ x, y, w, h, rotation, ...change })),
      ),
    )
  }

  const rotations = units.map((item) => rotationOf(plan, item))
  const chip = object ? KIND_NAMES[object.kind] : group ? 'Group' : 'Selection'
  const name = single ? describe(plan, single.id) : `${units.length} items`
  const role = object && object.kind !== 'label' ? object.role : group?.role

  return (
    <>
      <Head
        chip={chip}
        name={name}
        id={single?.id}
        locked={holdsBooked}
        stored={
          <>
            ichno stores{' '}
            {object ? storedObject(object) : makeupOf(editor.selectedObjects, group ? 1 : editor.selectedGroups.length)}
            {role ? (
              <>
                ; <code>{role}</code> is the playground’s word for it.
              </>
            ) : (
              '.'
            )}
          </>
        }
        actions={
          <>
            <Action icon="group" label="Group (⌘G)" onClick={() => editor.groupSelected()} />
            <Action
              icon="ungroup"
              label="Ungroup (⇧⌘G)"
              disabled={editor.selectedGroups.length === 0}
              onClick={editor.ungroupSelected}
            />
            <Action icon="duplicate" label="Duplicate (⌘D)" onClick={() => editor.duplicateSelected()} />
            <Action icon="rotate" label="Turn 90° (R)" onClick={() => editor.rotateSelected(90)} />
            <Action icon="asset" label="Save as asset" onClick={onSaveAsset} />
            <Action icon="trash" label="Delete (⌫)" onClick={onRemove} />
          </>
        }
      >
        {owner && (
          <button
            type="button"
            className={styles.owner}
            title="Select the group (⇧Enter)"
            onClick={() => editor.setSelection([{ kind: 'group', id: owner.id }])}
          >
            <Icon name="group" size={12} />
            In {describe(plan, owner.id)}
          </button>
        )}
      </Head>

      <Section title="Position">
        {units.length > 1 && (
          <div className={styles.align} role="group" aria-label="Align">
            {ALIGN.map(({ edge, icon, label }) => (
              <Action key={edge} icon={icon} label={label} onClick={() => editor.alignSelected(edge)} />
            ))}
            <span className={styles.alignGap} />
            <Action
              icon="distributeX"
              label="Space evenly across"
              disabled={units.length < 3}
              onClick={() => editor.distributeSelected('x')}
            />
            <Action
              icon="distributeY"
              label="Space evenly down"
              disabled={units.length < 3}
              onClick={() => editor.distributeSelected('y')}
            />
          </div>
        )}
        <div className={controls.pair}>
          {object ? (
            <>
              <NumberField
                icon="X"
                label="X"
                title={object.rotation ? 'The corner of the box before its turn' : undefined}
                value={object.x}
                min={-POSITION_MAX}
                max={POSITION_MAX}
                onCommit={(x) => placeBox(object, { x })}
              />
              <NumberField
                icon="Y"
                label="Y"
                title={object.rotation ? 'The corner of the box before its turn' : undefined}
                value={object.y}
                min={-POSITION_MAX}
                max={POSITION_MAX}
                onCommit={(y) => placeBox(object, { y })}
              />
            </>
          ) : (
            bounds && (
              <>
                <NumberField
                  icon="X"
                  label="X"
                  title="Where the selection starts"
                  value={Math.round(bounds.x)}
                  min={-POSITION_MAX}
                  max={POSITION_MAX}
                  onCommit={(x) => moveTo({ x })}
                />
                <NumberField
                  icon="Y"
                  label="Y"
                  title="Where the selection starts"
                  value={Math.round(bounds.y)}
                  min={-POSITION_MAX}
                  max={POSITION_MAX}
                  onCommit={(y) => moveTo({ y })}
                />
              </>
            )
          )}
          {!(object?.kind === 'label') && (
            <NumberField
              icon={<Icon name="rotate" size={12} />}
              label={group ? 'Facing' : 'Turn'}
              title={
                group ? 'The way the group faces — it turns about its centre' : 'Turned clockwise about its centre'
              }
              value={shared(rotations)}
              min={-360}
              max={360}
              unit="°"
              onCommit={turnTo}
            />
          )}
        </div>
      </Section>

      <Section title="Size">
        {onlyObjects && direct.every((o) => o.kind !== 'label') ? (
          <>
            <div className={controls.pair}>
              <NumberField
                icon="W"
                label="Width"
                value={shared(direct.map((o) => o.w))}
                min={1}
                max={POSITION_MAX}
                onCommit={(w) => resize({ w })}
              />
              <NumberField
                icon="H"
                label="Height"
                value={shared(direct.map((o) => o.h))}
                min={1}
                max={POSITION_MAX}
                onCommit={(h) => resize({ h })}
              />
            </div>
            <Segmented
              label="Shape"
              value={shared(direct.map((o) => o.shape))}
              options={[
                { value: 'rect' as Shape, label: <Icon name="rect" size={14} />, title: 'Rectangle' },
                { value: 'ellipse' as Shape, label: <Icon name="ellipse" size={14} />, title: 'Ellipse' },
              ]}
              onChange={(shape) => editor.edit((current) => withShape(current, ids(direct), shape))}
            />
          </>
        ) : (
          bounds && (
            <ReadOnly label="Size">
              {Math.round(bounds.w)} × {Math.round(bounds.h)}
            </ReadOnly>
          )
        )}
      </Section>

      {group && (
        <Section title="Group">
          <TextField label="Id" value={group.id} mono onCommit={(next) => rename(group.id, next, OBJECT_ID_MAX)} />
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
          <ReadOnly label="Role">{group.role ?? '—'}</ReadOnly>
        </Section>
      )}

      {group?.role === 'row' && <RowSection editor={editor} group={group} locked={locked} refused={refused} />}
      {group?.role === 'table' && <TableSection editor={editor} group={group} locked={locked} refused={refused} />}

      {places.length > 0 && (
        <Section title={object?.kind === 'place' ? 'Place' : `Places · ${places.length}`}>
          {object?.kind === 'place' && (
            <>
              <TextField label="Id" value={object.id} mono onCommit={(next) => rename(object.id, next, PLACE_ID_MAX)} />
              <TextField
                label="Label"
                value={object.label ?? ''}
                placeholder={object.id}
                onCommit={(next) =>
                  editor.updateObject(object.id, (current) => {
                    if (current.kind !== 'place') return current
                    const { label: _, ...rest } = current
                    return next ? { ...rest, label: next } : rest
                  })
                }
              />
              <TextField
                label="Role"
                value={object.role ?? ''}
                placeholder="None"
                onCommit={(next) => editor.edit((current) => withRole(current, [object.id], next))}
              />
            </>
          )}
          <div className={controls.row}>
            <span className={controls.rowLabel}>Capacity</span>
            <NumberField
              icon={<Icon name="place" size={12} />}
              label="Capacity"
              title="How many people it holds"
              value={shared(places.map((place) => place.capacity))}
              min={1}
              max={5000}
              onCommit={(capacity) => editor.edit((current) => withCapacity(current, ids(places), capacity))}
            />
          </div>
          {plan.categories.length > 0 && (
            <SelectField
              label="Category"
              value={shared(places.map((place) => place.category ?? ''))}
              options={[
                { value: '', label: 'None' },
                ...plan.categories.map((category) => ({ value: category.key, label: category.key })),
              ]}
              onChange={(category) => editor.edit((current) => withCategory(current, ids(places), category))}
            />
          )}
          {object?.kind === 'place' && (
            <ReadOnly label="Section">
              {sectionNames[object.section] ?? object.section} <code className={styles.code}>{object.section}</code>
            </ReadOnly>
          )}
        </Section>
      )}

      {fixtures.length > 0 && fixtures.length === units.length && (
        <Section title={object ? 'Fixture' : `Fixtures · ${fixtures.length}`}>
          {object && (
            <TextField label="Id" value={object.id} mono onCommit={(next) => rename(object.id, next, OBJECT_ID_MAX)} />
          )}
          <TextField
            label="Role"
            value={shared(fixtures.map((fixture) => fixture.role ?? ''))}
            placeholder="None"
            onCommit={(next) => editor.edit((current) => withRole(current, ids(fixtures), next))}
          />
          <p className={controls.hint}>Nothing to book — a fixture never counts towards capacity.</p>
        </Section>
      )}

      {object?.kind === 'label' && (
        <Section title="Label">
          <TextField label="Id" value={object.id} mono onCommit={(next) => rename(object.id, next, OBJECT_ID_MAX)} />
          <p className={controls.hint}>
            Writes its group’s label — rename the group and every label that shows it follows.
          </p>
        </Section>
      )}

      {units.length > 1 && (
        <Section title="Labels">
          <p className={controls.hint}>Numbers the selected groups — or the places, when none is a group.</p>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={controls.button}
              onClick={() => editor.label(labelTargets(editor, places), labeling.numbers())}
            >
              1, 2, 3…
            </button>
            <button
              type="button"
              className={controls.button}
              onClick={() => editor.label(labelTargets(editor, places), labeling.letters({ skip: ['I', 'O'] }))}
            >
              A, B, C…
            </button>
          </div>
        </Section>
      )}

      {holdsBooked && (
        <p className={styles.tip}>
          <Icon name="lock" size={12} /> Holds a booked place — it can be moved and relabelled, but not deleted, and
          booked places keep their ids.
        </p>
      )}
    </>
  )
}

// ---------- The playground's own groups ----------

type GroupSectionProps = {
  editor: Editor
  group: Group
  locked: ReadonlySet<string>
  refused(ok: boolean): boolean
}

function RowSection({ editor, group, locked, refused }: GroupSectionProps) {
  const row = rowOf(editor.plan, group.id)
  if (!row) return null
  return (
    <Section title="Playground row">
      <p className={controls.hint}>
        The playground reads the row back from its seats and lays it out again — ichno only stores the seats.
      </p>
      <div className={controls.row}>
        <span className={controls.rowLabel}>Seats</span>
        <NumberField
          icon="#"
          label="Seats"
          value={row.seats.length}
          min={1}
          max={60}
          onCommit={(count) => refused(editor.edit((current) => relayRow(current, group.id, { count }, locked)))}
        />
      </div>
      <SliderField
        key={`${group.id}-${row.curve}`}
        label="Curve"
        value={row.curve}
        min={-1}
        max={1}
        step={0.05}
        onCommit={(curve) => editor.edit((current) => relayRow(current, group.id, { curve }, locked))}
      />
      <div className={controls.row}>
        <span className={controls.rowLabel}>Numbering</span>
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={controls.button}
            onClick={() => editor.label(ids(row.seats), labeling.numbers())}
          >
            1 → {row.seats.length}
          </button>
          <button
            type="button"
            className={controls.button}
            onClick={() => editor.label(ids(row.seats), labeling.numbers({ reverse: true }))}
          >
            {row.seats.length} → 1
          </button>
          <button
            type="button"
            className={controls.button}
            onClick={() => editor.label(ids(row.seats), labeling.numbers({ step: 2 }))}
          >
            1, 3, 5
          </button>
        </div>
      </div>
    </Section>
  )
}

function TableSection({ editor, group, locked, refused }: GroupSectionProps) {
  const table = tableOf(editor.plan, group.id)
  if (!table) return null
  return (
    <Section title="Playground table">
      <p className={controls.hint}>
        The playground finds the top by its role and sets the seats around it — ichno only stores the top and the seats.
      </p>
      <div className={controls.row}>
        <span className={controls.rowLabel}>Seats</span>
        <NumberField
          icon="#"
          label="Seats"
          value={table.seats.length}
          min={1}
          max={16}
          onCommit={(count) => refused(editor.edit((current) => relayTable(current, group.id, { count }, locked)))}
        />
      </div>
      <Segmented
        label="Top"
        value={table.top.shape}
        options={[
          { value: 'ellipse' as Shape, label: 'Round' },
          { value: 'rect' as Shape, label: 'Rectangle' },
        ]}
        onChange={(shape) => editor.edit((current) => relayTable(current, group.id, { shape }, locked))}
      />
      <Toggle
        label="Book the whole table at once"
        checked={table.whole}
        onChange={(whole) => refused(editor.edit((current) => setWholeTable(current, group.id, whole, locked)))}
      />
      {!table.whole && (
        <div className={controls.row}>
          <span className={controls.rowLabel}>Numbering</span>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={controls.button}
              onClick={() => editor.label(ids(table.seats), labeling.numbers())}
            >
              1, 2, 3
            </button>
            <button
              type="button"
              className={controls.button}
              onClick={() => editor.label(ids(table.seats), labeling.letters())}
            >
              A, B, C
            </button>
          </div>
        </div>
      )}
    </Section>
  )
}

// ---------- Pieces ----------

// What the selection is, in ichno's words, and what can be done to it.
function Head({
  chip,
  name,
  id,
  locked = false,
  stored,
  actions,
  children,
}: {
  chip: string
  name: string
  id?: string
  locked?: boolean
  stored: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className={styles.head}>
      <div className={styles.title}>
        <span className={controls.chip}>{chip}</span>
        <strong>{name}</strong>
        {id !== undefined && id !== name && <code className={styles.code}>{id}</code>}
        {locked && (
          <span className={styles.locked} title="Holds a booked place">
            <Icon name="lock" size={12} />
          </span>
        )}
      </div>
      <p className={styles.stored}>{stored}</p>
      {children}
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  )
}

function Action({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: IconName
  label: string
  disabled?: boolean
  onClick(): void
}) {
  return (
    <button
      type="button"
      className={controls.iconButton}
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={pressKeepingFocus}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  )
}

// ichno's own names for what it stores.
const KIND_NAMES = { place: 'Place', fixture: 'Fixture', label: 'Label' } as const

function storedObject(object: PlanObject<string>): string {
  if (object.kind === 'place') return `a place${object.capacity > 1 ? ` for ${object.capacity}` : ''}`
  if (object.kind === 'fixture') return 'a fixture — nothing to book'
  return 'a label, where its group’s name is written'
}

const ALIGN = [
  { edge: 'left', icon: 'alignLeft', label: 'Align left' },
  { edge: 'center-x', icon: 'alignCenterX', label: 'Align centres across' },
  { edge: 'right', icon: 'alignRight', label: 'Align right' },
  { edge: 'top', icon: 'alignTop', label: 'Align top' },
  { edge: 'center-y', icon: 'alignCenterY', label: 'Align middles' },
  { edge: 'bottom', icon: 'alignBottom', label: 'Align bottom' },
] as const

// The value every item shares — null when they differ (the field shows "Mixed").
function shared<T>(values: readonly T[]): T | null {
  const [first] = values
  return first !== undefined && values.every((value) => value === first) ? first : null
}

function unionOf(rects: readonly PlanRect[]): PlanRect | null {
  if (rects.length === 0) return null
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.w))
  const bottom = Math.max(...rects.map((r) => r.y + r.h))
  return { x, y, w: right - x, h: bottom - y }
}

// The way an item faces — an object's turn, a group's facing.
function rotationOf(plan: SeatPlan<string>, item: Item): number {
  if (item.kind === 'group') return Math.round(seatPlan.groupById(plan, item.id)?.rotation ?? 0)
  const object = seatPlan.objectById(plan, item.id)
  return Math.round(object && object.kind !== 'label' ? (object.rotation ?? 0) : 0)
}

// What the label buttons of a selection number — its groups when it holds any, else its places.
function labelTargets(editor: Editor, places: readonly { id: string }[]): string[] {
  const groups = editor.selection.flatMap((item) => (item.kind === 'group' ? [item.id] : []))
  return groups.length > 0 ? groups : ids(places)
}

function withCategory(plan: SeatPlan<string>, targets: readonly string[], category: string) {
  const wanted = new Set(targets)
  return {
    ...plan,
    objects: plan.objects.map((o) => {
      if (o.kind !== 'place' || !wanted.has(o.id)) return o
      const { category: _, ...rest } = o
      return category ? { ...rest, category } : rest
    }),
  }
}

function withCapacity(plan: SeatPlan<string>, targets: readonly string[], capacity: number) {
  const wanted = new Set(targets)
  return {
    ...plan,
    objects: plan.objects.map((o) => (o.kind === 'place' && wanted.has(o.id) ? { ...o, capacity } : o)),
  }
}

function withShape(plan: SeatPlan<string>, targets: readonly string[], shape: Shape) {
  const wanted = new Set(targets)
  return {
    ...plan,
    objects: plan.objects.map((o) => (o.kind !== 'label' && wanted.has(o.id) ? { ...o, shape } : o)),
  }
}

function withRole(plan: SeatPlan<string>, targets: readonly string[], role: string): SeatPlan<string> {
  const wanted = new Set(targets)
  return {
    ...plan,
    objects: plan.objects.map((o) => {
      if (o.kind === 'label' || !wanted.has(o.id)) return o
      const { role: _, ...rest } = o
      return (role ? { ...rest, role } : rest) as PlanObject<string>
    }),
  }
}

// Positions typed into the fields stay within reach of any plan.
const POSITION_MAX = 100_000

function ids(objects: readonly { id: string }[]): string[] {
  return objects.map((o) => o.id)
}
