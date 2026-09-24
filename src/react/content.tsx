import { Fragment, type ReactNode } from 'react'
import { seatPlan } from '../core/geometry'
import type { Fixture, Place, PlanRect, SeatPlan, Section } from '../core/types'
import {
  FixturePart,
  PlacePart,
  RowLabelPart,
  SectionPart,
  TablePart,
  placeLabelFont,
  rowLabelFont,
  type PlaceProps,
} from './parts'

type ContentProps<S extends string> = {
  plan: SeatPlan<S>
  // Place id → the consumer's status word. Exposed as data-status.
  status?: Readonly<Record<string, string>>
  selected?: readonly string[]
  highlighted?: readonly string[]
  dimmed?: readonly string[]
  // Places that cannot be picked. Defaults to every place with a status.
  isDisabled?(place: Place<S>, status: string | undefined): boolean
  // Name above each section. Defaults to the section id on plans with more than one section, none otherwise.
  sectionLabel?(section: Section<S>): ReactNode
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

// The whole plan in drawing order — sections, then every object in document order (fixtures, table furniture,
// places, row labels). A convenience over the parts; compose them yourself when you need something else.
export function Content<S extends string>({
  plan,
  status,
  selected,
  highlighted,
  dimmed,
  isDisabled = hasStatus,
  sectionLabel,
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
  const labeled = seatPlan.showsSectionLabels(plan)

  const placesByObject = new Map<string, Place<S>[]>()
  for (const place of seatPlan.placesOf(plan)) {
    const objectId = place.parent?.id ?? place.id
    placesByObject.set(objectId, [...(placesByObject.get(objectId) ?? []), place])
  }

  const placeElement = (place: Place<S>) => {
    const placeStatus = status?.[place.id]
    return (
      <Fragment key={place.id}>
        {renderPlace(place, {
          place,
          status: placeStatus,
          selected: selectedSet.has(place.id),
          disabled: isDisabled(place, placeStatus),
          highlighted: highlightedSet.has(place.id),
          dimmed: dimmedSet.has(place.id),
          ...(readable(placeLabelFont(place)) ? {} : { label: null }),
        })}
      </Fragment>
    )
  }

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
        if (object.kind === 'fixture') {
          return (
            <FixturePart
              key={object.id}
              fixture={object}
              variant={fixtureVariant?.(object) ?? 'box'}
              label={readable(Math.min(object.w, object.h) * 0.6) ? (fixtureLabel?.(object) ?? null) : null}
            />
          )
        }
        const places = (placesByObject.get(object.id) ?? []).map(placeElement)
        if (object.kind === 'row' && object.label && readable(rowLabelFont(object))) {
          return (
            <g key={object.id}>
              {places}
              <RowLabelPart row={object} />
            </g>
          )
        }
        if (object.kind === 'table') {
          return (
            <g key={object.id}>
              <TablePart table={object} />
              {places}
            </g>
          )
        }
        return places.length === 1 ? places[0] : <g key={object.id}>{places}</g>
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

function defaultRenderPlace(_place: Place, props: PlaceProps): ReactNode {
  return <PlacePart {...props} />
}

// Below this on-screen size a label is noise, not text.
const MIN_LABEL_PX = 9
