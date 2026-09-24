'use client'

import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { seatPlan } from '../../core/geometry'
import {
  IDLE_GESTURE,
  TOUCH_DRAG_THRESHOLD_PX,
  gesture,
  type GestureEvent,
  type GestureState,
} from '../../core/gesture'
import { placeNavigation, type NavigationDirection } from '../../core/navigation'
import type { Place, PlanDrag, PlanPoint, PlanTarget, SeatPlan } from '../../core/types'
import { ZOOM_STEP, planView, type PlanView } from '../../core/view'
import { FONT_VAR, cssVar } from '../../theme/vars'

type ViewportProps<S extends string> = Omit<
  ComponentProps<'svg'>,
  'viewBox' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onKeyDown'
> & {
  plan: SeatPlan<S>
  // Controlled view (plan units). Omit it to let the viewport keep its own, starting at `defaultView`.
  view?: PlanView
  defaultView?: PlanView
  onViewChange?(view: PlanView): void
  // Drag on empty floor (or on anything that does not drag) pans. Leave off for small panels that compete
  // with page scrolling.
  pannable?: boolean
  // Wheel and pinch zoom.
  zoomable?: boolean
  // A tap, Enter or Space on a place.
  onPlaceClick?(place: Place<S>): void
  // Pointer entering and leaving places.
  onPlaceHover?(place: Place<S> | null): void
  // Any tap — a place, a non-place object, a section, or empty floor (null). The editor selects with it.
  onTap?(target: PlanTarget<S> | null): void
  // Which targets move instead of panning, and what happens while they do (the editor passes both).
  canDrag?(target: PlanTarget<S>): boolean
  onTargetDrag?(drag: PlanDrag<S>): void
}

// The interactive plan — an <svg> that pans, zooms (wheel, pinch), reports taps and drags, and moves a focus
// ring between places with the arrow keys. Children are the same server-safe parts <SeatMap.Root> takes; events
// are delegated by their `data-ichno-*` attributes, so the parts carry no handlers.
// Behaviour comes from the renderer-independent core (gesture, placeNavigation, planView).
export function Viewport<S extends string>({
  plan,
  view,
  defaultView,
  onViewChange,
  pannable = true,
  zoomable = true,
  onPlaceClick,
  onPlaceHover,
  onTap,
  canDrag,
  onTargetDrag,
  style,
  children,
  onFocus,
  onBlur,
  ...rest
}: ViewportProps<S>) {
  const svgRef = useRef<SVGSVGElement>(null)
  const gestureRef = useRef<GestureState>(IDLE_GESTURE)
  // What the current press started on, and whether it drags that target or pans.
  const pressRef = useRef<{ target: PlanTarget<S> | null; drags: boolean }>({ target: null, drags: false })
  const hoverRef = useRef<string | null>(null)
  const idPrefix = useId()

  const homeView = planView.home(plan)
  const [ownView, setOwnView] = useState<PlanView>(defaultView ?? homeView)
  const current = view ?? ownView
  // Gestures fire several events between renders — each builds on the latest view, not the rendered one.
  const viewRef = useRef(current)
  useEffect(() => {
    viewRef.current = current
  })

  const [activeId, setActiveId] = useState<string | null>(null)
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const places = seatPlan.placesOf(plan)
  const active = activeId === null ? undefined : places.find((place) => place.id === activeId)

  function changeView(next: PlanView) {
    viewRef.current = next
    if (view === undefined) setOwnView(next)
    onViewChange?.(next)
  }

  function toPlan(clientX: number, clientY: number): PlanPoint | null {
    const matrix = svgRef.current?.getScreenCTM()
    if (!matrix) return null
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
    return { x: point.x, y: point.y }
  }

  // Plan units per screen pixel — the viewBox scales uniformly (preserveAspectRatio meet).
  function unitsPerPixel(): number {
    const matrix = svgRef.current?.getScreenCTM()
    return matrix && matrix.a !== 0 ? 1 / matrix.a : 1
  }

  function placeById(id: string) {
    return places.find((place) => place.id === id)
  }

  function handle(events: GestureEvent[], clientOrigin: DOMRect | undefined) {
    const press = pressRef.current
    for (const event of events) {
      switch (event.type) {
        case 'tap': {
          const target = press.target
          onTap?.(target)
          if (target?.kind === 'place') {
            const place = placeById(target.id)
            if (place) {
              setActiveId(place.id)
              onPlaceClick?.(place)
            }
          }
          break
        }
        case 'dragstart':
          if (press.drags && press.target)
            onTargetDrag?.({ target: press.target, phase: 'start', total: { x: 0, y: 0 } })
          break
        case 'drag': {
          const scale = unitsPerPixel()
          if (press.drags && press.target) {
            const total = { x: event.total.x * scale, y: event.total.y * scale }
            onTargetDrag?.({ target: press.target, phase: 'move', total })
          } else if (pannable) {
            changeView(planView.pan(viewRef.current, { x: -event.delta.x * scale, y: -event.delta.y * scale }))
          }
          break
        }
        case 'dragend':
          if (press.drags && press.target) {
            const scale = unitsPerPixel()
            onTargetDrag?.({
              target: press.target,
              phase: 'end',
              total: { x: event.total.x * scale, y: event.total.y * scale },
            })
          }
          // After a pinch the remaining finger pans — it never drags the target the gesture began on.
          pressRef.current = { target: null, drags: false }
          break
        case 'pinch': {
          if (!zoomable || !clientOrigin) break
          const center = toPlan(clientOrigin.left + event.center.x, clientOrigin.top + event.center.y)
          if (!center) break
          const scale = unitsPerPixel()
          const panned = planView.pan(viewRef.current, { x: -event.delta.x * scale, y: -event.delta.y * scale })
          changeView(planView.zoom(panned, event.factor, center, homeView))
          break
        }
      }
    }
  }

  function pointerOf(e: PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    return { pointer: { id: e.pointerId, x: e.clientX - box.left, y: e.clientY - box.top }, box }
  }

  function handlePointerDown(e: PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    setKeyboardFocus(false)
    const { pointer, box } = pointerOf(e)
    if (gestureRef.current.kind === 'idle') {
      const target = targetOf<S>(e.target)
      pressRef.current = { target, drags: target !== null && (canDrag?.(target) ?? false) }
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const result = gesture.down(gestureRef.current, pointer, pressRef.current.target ? 'target' : null)
    gestureRef.current = result.state
    handle(result.events, box)
  }

  function handlePointerMove(e: PointerEvent<SVGSVGElement>) {
    if (gestureRef.current.kind === 'idle') {
      const place = hoveredPlace(e.target)
      if ((place?.id ?? null) !== hoverRef.current) {
        hoverRef.current = place?.id ?? null
        onPlaceHover?.(place ?? null)
      }
      return
    }
    const { pointer, box } = pointerOf(e)
    const threshold = e.pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : undefined
    const result = gesture.move(gestureRef.current, pointer, threshold)
    gestureRef.current = result.state
    handle(result.events, box)
  }

  function handlePointerUp(e: PointerEvent<SVGSVGElement>) {
    const { pointer, box } = pointerOf(e)
    const result = gesture.up(gestureRef.current, pointer)
    gestureRef.current = result.state
    handle(result.events, box)
  }

  function handlePointerCancel() {
    const result = gesture.cancel(gestureRef.current)
    gestureRef.current = result.state
    handle(result.events, undefined)
  }

  function handlePointerLeave() {
    if (hoverRef.current === null) return
    hoverRef.current = null
    onPlaceHover?.(null)
  }

  function hoveredPlace(element: EventTarget | null) {
    const target = targetOf<S>(element)
    return target?.kind === 'place' ? placeById(target.id) : undefined
  }

  function handleKeyDown(e: KeyboardEvent<SVGSVGElement>) {
    const direction = ARROW_KEYS[e.key]
    if (direction) {
      e.preventDefault()
      setKeyboardFocus(true)
      const next =
        activeId === null
          ? placeNavigation.first(places)
          : (placeNavigation.next(places, activeId, direction) ?? activeId)
      if (next !== null) {
        setActiveId(next)
        revealPlace(next)
      }
      return
    }
    if ((e.key === 'Enter' || e.key === ' ') && active) {
      e.preventDefault()
      onTap?.({ kind: 'place', id: active.id, objectId: active.parent?.id ?? active.id })
      onPlaceClick?.(active)
    }
  }

  // Keep the focused place on screen — recentre on it when it leaves the view.
  function revealPlace(id: string) {
    const place = placeById(id)
    const box = viewRef.current
    if (!place) return
    const b = place.bounds
    if (b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h) return
    changeView({ ...box, x: place.center.x - box.w / 2, y: place.center.y - box.h / 2 })
  }

  // Wheel zoom needs a non-passive listener to stop the page from scrolling; React's wheel handler is passive.
  const onWheel = useEffectEvent((e: WheelEvent) => {
    if (!zoomable) return
    e.preventDefault()
    const center = toPlan(e.clientX, e.clientY)
    if (!center) return
    changeView(planView.zoom(viewRef.current, e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP, center, homeView))
  })
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const listener = (e: WheelEvent) => onWheel(e)
    svg.addEventListener('wheel', listener, { passive: false })
    return () => svg.removeEventListener('wheel', listener)
  }, [])

  // Screen readers follow the focused place through aria-activedescendant, which needs an element id. Parts are
  // server-safe and carry none, so the viewport names the active one.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const element = activeId === null ? null : svg.querySelector(`[data-ichno-id="${CSS.escape(activeId)}"]`)
    if (!element) {
      svg.removeAttribute('aria-activedescendant')
      return
    }
    if (!element.id) element.id = `${idPrefix}${activeId}`
    svg.setAttribute('aria-activedescendant', element.id)
  }, [activeId, idPrefix])

  const ring = active && keyboardFocus ? active.bounds : null
  const gestures = pannable || zoomable

  return (
    <svg
      ref={svgRef}
      viewBox={`${current.x} ${current.y} ${current.w} ${current.h}`}
      data-ichno-root=""
      role="listbox"
      tabIndex={0}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        fontFamily: `var(${FONT_VAR})`,
        touchAction: gestures ? 'none' : undefined,
        userSelect: 'none',
        outline: 'none',
        ...style,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
      onFocus={(e) => {
        if (activeId === null && e.target === e.currentTarget) setActiveId(placeNavigation.first(places))
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setKeyboardFocus(false)
        onBlur?.(e)
      }}
      {...rest}
    >
      {children}
      {ring && (
        <rect
          data-part="focus-ring"
          x={ring.x - FOCUS_RING_GAP}
          y={ring.y - FOCUS_RING_GAP}
          width={ring.w + FOCUS_RING_GAP * 2}
          height={ring.h + FOCUS_RING_GAP * 2}
          rx={FOCUS_RING_GAP * 2}
          fill="none"
          stroke={cssVar('ink')}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
    </svg>
  )
}

// The place, object or section an element belongs to — the nearest part with an ichno data attribute.
function targetOf<S extends string>(element: EventTarget | null): PlanTarget<S> | null {
  if (!(element instanceof Element)) return null
  const place = element.closest('[data-ichno-id]')
  if (place) {
    const id = place.getAttribute('data-ichno-id')!
    return { kind: 'place', id, objectId: place.getAttribute('data-ichno-object') ?? id }
  }
  const object = element.closest('[data-ichno-object]')
  if (object) return { kind: 'object', id: object.getAttribute('data-ichno-object')! }
  const section = element.closest('[data-ichno-section]')
  if (section) return { kind: 'section', id: section.getAttribute('data-ichno-section') as S }
  return null
}

const ARROW_KEYS: Partial<Record<string, NavigationDirection>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

const FOCUS_RING_GAP = 6
