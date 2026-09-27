import { Fragment, type ReactNode } from 'react'
import { seatPlan } from '../core/geometry'
import type { Fixture, Group, Place, PlanRect, SeatPlan, Section } from '../core/types'
import {
  FixturePart,
  LabelPart,
  PlacePart,
  SectionPart,
  groupLabelFont,
  placeLabelFont,
  type PlaceProps,
} from './parts'

type ContentProps<S extends string> = {
  plan: SeatPlan<S>
  // Place id → the consumer's status word. Exposed as data-status.
  status?: Readonly<Record<string, string>>
  selected?: readonly string[]
  highlighted?: readonly string[]
  dimmed?: readonly string[]
  // Place ids in conflict (the editor's `conflictIds`) — marked.
  invalid?: readonly string[]
  // Places that cannot be picked. Defaults to every place with a status.
  isDisabled?(place: Place<S>, status: string | undefined): boolean
  // Name above each section. Defaults to the section id on plans with more than one section, none otherwise.
  sectionLabel?(section: Section<S>): ReactNode
  // What a group's labels say. Defaults to the group's label, or its id.
  groupLabel?(group: Group): ReactNode
  fixtureLabel?(fixture: Fixture): string | null
  // Defaults to `box` for every fixture.
  fixtureVariant?(fixture: Fixture): 'box' | 'wall'
  // Draw a place yourself — receives the props the default <SeatMap.Place> would get.
  renderPlace?(place: Place<S>, props: PlaceProps): ReactNode
  // Large plans: pass the viewport frame. Objects outside `region` are not drawn, and labels whose text would be
  // smaller than `minLabelPx` screen pixels at `scale` are left out (SVG text is the costliest thing to paint).
  region?: PlanRect
  scale?: number
  minLabelPx?: number
}

// The whole plan in drawing order — sections, then every object in document order. A convenience over the parts;
// compose them yourself when you need something else.
export function Content<S extends string>({
  plan,
  status,
  selected,
  highlighted,
  dimmed,
  invalid,
  isDisabled = hasStatus,
  sectionLabel,
  groupLabel = defaultGroupLabel,
  fixtureLabel,
  fixtureVariant,
  renderPlace = defaultRenderPlace,
  region,
  scale,
  minLabelPx = MIN_LABEL_PX,
}: ContentProps<S>) {
  const readable = (fontSize: number) => scale === undefined || fontSize * scale >= minLabelPx
  const selectedSet = new Set(selected)
  const highlightedSet = new Set(highlighted)
  const dimmedSet = new Set(dimmed)
  const invalidSet = new Set(invalid)
  const groups = new Map(plan.groups.map((group) => [group.id, group]))
  const labeled = seatPlan.showsSectionLabels(plan)

  return (
    <>
      {plan.sections.map((section) => (
        <SectionPart
          key={section.id}
          section={section}
          label={sectionLabel ? sectionLabel(section) : labeled ? section.id : null}
        />
      ))}
      {plan.objects.map((object) => {
        if (region && !intersects(seatPlan.boundsOf(object), region)) return null
        switch (object.kind) {
          case 'place': {
            const placeStatus = status?.[object.id]
            return (
              <Fragment key={object.id}>
                {renderPlace(object, {
                  place: object,
                  status: placeStatus,
                  selected: selectedSet.has(object.id),
                  disabled: isDisabled(object, placeStatus),
                  highlighted: highlightedSet.has(object.id),
                  dimmed: dimmedSet.has(object.id),
                  invalid: invalidSet.has(object.id),
                  ...(readable(placeLabelFont(object)) ? {} : { label: null }),
                })}
              </Fragment>
            )
          }
          case 'fixture':
            return (
              <FixturePart
                key={object.id}
                fixture={object}
                variant={fixtureVariant?.(object) ?? 'box'}
                label={readable(Math.min(object.w, object.h) * 0.6) ? (fixtureLabel?.(object) ?? null) : null}
              />
            )
          case 'label': {
            const group = groups.get(object.group)
            const text = group ? groupLabel(group) : null
            if (text == null || text === false || text === '' || !readable(groupLabelFont(object))) return null
            return (
              <LabelPart key={object.id} label={object}>
                {text}
              </LabelPart>
            )
          }
        }
      })}
    </>
  )
}

function intersects(a: PlanRect, b: PlanRect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

function hasStatus(_place: Place, status: string | undefined): boolean {
  return status !== undefined
}

function defaultGroupLabel(group: Group): ReactNode {
  return group.label ?? group.id
}

function defaultRenderPlace(_place: Place, props: PlaceProps): ReactNode {
  return <PlacePart {...props} />
}

// Below this on-screen size a label is noise, not text.
const MIN_LABEL_PX = 9
