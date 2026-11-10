import type { HandleOwner, PlanTarget } from '../core/types'

// The handle, place, object, wall or section an element belongs to — the nearest part with an ichno data attribute,
// or null. <SeatMapViewport> delegates its events by it; a context menu or a view of your own drawing the parts can
// read the same way.
export function planTargetOf<S extends string = string>(element: EventTarget | null): PlanTarget<S> | null {
  if (!(element instanceof Element)) return null
  const handle = element.closest('[data-ichno-handle]')

  if (handle) {
    const id = handle.getAttribute('data-ichno-owner') ?? ''
    const kind = handle.getAttribute('data-ichno-owner-kind')

    // SAFETY: a section handle belongs to one of the plan's sections, whose ids are `S`; HandlesPart writes that id.
    const owner: HandleOwner<S> =
      kind === 'selection'
        ? { kind: 'selection' }
        : kind === 'section'
          ? { kind: 'section', id: id as S }
          : { kind: kind === 'group' ? 'group' : kind === 'wall' ? 'wall' : 'object', id }

    return { kind: 'handle', owner, name: handle.getAttribute('data-ichno-handle')! }
  }

  const place = element.closest('[data-ichno-id]')

  if (place) return { kind: 'place', id: place.getAttribute('data-ichno-id')! }
  const object = element.closest('[data-ichno-object]')

  if (object) return { kind: 'object', id: object.getAttribute('data-ichno-object')! }
  const wall = element.closest('[data-ichno-wall]')

  if (wall) return { kind: 'wall', id: wall.getAttribute('data-ichno-wall')! }
  const section = element.closest('[data-ichno-section]')

  if (section) {
    // SAFETY: the element matched `[data-ichno-section]`, so the attribute is there, and SectionPart writes it from
    // one of the plan's section ids, which are `S`.
    return { kind: 'section', id: section.getAttribute('data-ichno-section') as S }
  }

  return null
}
