import { Fragment, memo, type ReactNode } from 'react'
import { groupLabelFont, seatPlan } from '../core/geometry'
import type { Fixture, Group, Place, PlanRect, SeatPlan, Section } from '../core/types'
import {
  FixturePart,
  LabelPart,
  PlacePart,
  RoomPart,
  SectionPart,
  WallPart,
  placeLabelFont,
  type PlaceProps,
} from './parts'

type ContentProps<S extends string> = {
  plan: SeatPlan<S>
  // Place id → the consumer's status word. Exposed as data-status, never read — what a status means for picking is
  // yours to say with `disabled`.
  status?: Readonly<Record<string, string>>
  // Places and walls drawn selected.
  selected?: readonly string[]
  // Places that cannot be picked — drawn filled with ink.
  disabled?: readonly string[]
  highlighted?: readonly string[]
  dimmed?: readonly string[]
  // Place ids in conflict (the editor's `conflictIds`) — marked.
  invalid?: readonly string[]
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

// The whole plan in drawing order — sections, the floors of the rooms the walls close, the walls, then every object
// in document order. A convenience over the parts;
// compose them yourself when you need something else. It skips redrawing when its props are the ones it last drew
// with (parts are not compiled, so this is the one `memo`): an editor's `stillPlan` keeps its identity through a
// drag, and the layer drawing it stays put while only the moving part redraws.
// SAFETY: memo renders ContentOf with exactly the props it is given — only memo's type loses the `S` parameter.
export const Content = memo(ContentOf) as typeof ContentOf

function ContentOf<S extends string>({
  plan,
  status,
  selected,
  highlighted,
  dimmed,
  invalid,
  disabled,
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
  const disabledSet = new Set(disabled)
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
      {seatPlan.roomsOf(plan).map((room, i) => (
        <RoomPart key={i} room={room} />
      ))}
      {plan.walls.map((wall) =>
        region && !intersects(seatPlan.wallBoundsOf(wall), region) ? null : (
          <WallPart key={wall.id} wall={wall} selected={selectedSet.has(wall.id)} />
        ),
      )}
      {plan.objects.map((object) => {
        if (region && !intersects(seatPlan.boundsOf(object), region)) return null

        switch (object.kind) {
          case 'place': {
            const props: PlaceProps = {
              place: object,
              status: status?.[object.id],
              selected: selectedSet.has(object.id),
              disabled: disabledSet.has(object.id),
              highlighted: highlightedSet.has(object.id),
              dimmed: dimmedSet.has(object.id),
              invalid: invalidSet.has(object.id),
            }

            if (!readable(placeLabelFont(object))) props.label = null

            return <Fragment key={object.id}>{renderPlace(object, props)}</Fragment>
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

function defaultGroupLabel(group: Group): ReactNode {
  return group.label ?? group.id
}

function defaultRenderPlace(_place: Place, props: PlaceProps): ReactNode {
  return <PlacePart {...props} />
}

// Below this on-screen size a label is noise, not text.
const MIN_LABEL_PX = 9
