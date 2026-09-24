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
  type ReactNode,
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
import type { Place, PlanDrag, PlanPoint, PlanRect, PlanTarget, SeatPlan } from '../../core/types'
import { ZOOM_STEP, planView, type PlanView, type ViewportSize } from '../../core/view'
import { FONT_VAR, cssVar } from '../../theme/vars'

// What a render-function child gets to draw with: the area worth drawing (the view plus a margin — cull what lies
// outside it) and the screen scale in quarter-octave steps (drop detail that would be too small to read). Both
// change only when a pan leaves the area or the zoom crosses a step, so the children redraw rarely.
export type ViewportFrame = { region: PlanRect; scale: number }

type ViewportProps<S extends string> = Omit<
  ComponentProps<'svg'>,
  'viewBox' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onKeyDown' | 'children'
> & {
  plan: SeatPlan<S>
  // The parts to draw, or a function of the frame for large plans (pass it on to <SeatMap.Content>).
  children?: ReactNode | ((frame: ViewportFrame) => ReactNode)
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
  // Any tap — a place, a non-place object, a section, or empty floor (null) — with the plan point and whether
  // shift, ⌘ or Ctrl was held (additive selection). The editor selects with it; tools place things at `point`.
  onTap?(target: PlanTarget<S> | null, info: { point: PlanPoint | null; additive: boolean }): void
  // Which targets move instead of panning, and what happens while they do (the editor passes both).
  canDrag?(target: PlanTarget<S>): boolean
  onTargetDrag?(drag: PlanDrag<S>): void
  // Rubber-band selection. When given, a drag that starts on something that does not move (or with shift, ⌘ or
  // Ctrl held) draws a rectangle instead of panning; empty space outside every section and the middle mouse
  // button still pan.
  onMarquee?(rect: PlanRect, info: { phase: 'start' | 'move' | 'end'; additive: boolean }): void
}

type Press<S extends string> = {
  target: PlanTarget<S> | null
  mode: 'drag' | 'marquee' | 'pan'
  additive: boolean
  // Marquee anchor in plan units, set when the marquee starts.
  anchor: PlanPoint | null
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
  onMarquee,
  style,
  children,
  onFocus,
  onBlur,
  ...rest
}: ViewportProps<S>) {
  const svgRef = useRef<SVGSVGElement>(null)
  const gestureRef = useRef<GestureState>(IDLE_GESTURE)
  // What the current press started on, and whether it drags that target, draws a marquee or pans.
  const pressRef = useRef<Press<S>>(IDLE_PRESS)
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

  // The viewport size, kept by a ResizeObserver — gesture math uses it instead of reading layout, which would
  // force the browser to lay out every node of the plan.
  const [size, setSize] = useState<ViewportSize | null>(null)
  const sizeRef = useRef<ViewportSize | null>(null)
  // The viewport's page position, read once per gesture (and when stale for the wheel).
  const originRef = useRef<{ left: number; top: number; at: number } | null>(null)
  const [frame, setFrame] = useState<ViewportFrame>(() => ({
    region: planView.region(current, REGION_MARGIN),
    scale: 1,
  }))

  const [activeId, setActiveId] = useState<string | null>(null)
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const places = seatPlan.placesOf(plan)
  const active = activeId === null ? undefined : places.find((place) => place.id === activeId)

  function changeView(next: PlanView) {
    viewRef.current = next
    if (view === undefined) setOwnView(next)
    onViewChange?.(next)
  }

  // The viewport's top-left on the page. Reading it forces a layout, so it is cached for the length of a gesture.
  function originOf(refresh: boolean): { left: number; top: number } | null {
    const svg = svgRef.current
    if (!svg) return null
    const cached = originRef.current
    if (!refresh && cached && performance.now() - cached.at < ORIGIN_TTL_MS) return cached
    const box = svg.getBoundingClientRect()
    originRef.current = { left: box.left, top: box.top, at: performance.now() }
    return originRef.current
  }

  // The plan point under a viewport point (CSS pixels from its top-left).
  function toPlan(point: { x: number; y: number }): PlanPoint | null {
    const viewport = sizeRef.current
    return viewport ? planView.toPlan(viewRef.current, viewport, point) : null
  }

  // Plan units per screen pixel.
  function unitsPerPixel(): number {
    const viewport = sizeRef.current
    return viewport ? 1 / planView.scaleOf(viewRef.current, viewport) : 1
  }

  function placeById(id: string) {
    return places.find((place) => place.id === id)
  }

  function handle(events: GestureEvent[]) {
    for (const event of events) {
      // Read per event — a marquee sets its anchor on dragstart, and the drag in the same batch needs it.
      const press = pressRef.current
      switch (event.type) {
        case 'tap': {
          const target = press.target
          const point = toPlan(event.point)
          onTap?.(target, { point, additive: press.additive })
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
          if (press.mode === 'drag' && press.target) {
            onTargetDrag?.({ target: press.target, phase: 'start', total: { x: 0, y: 0 } })
          } else if (press.mode === 'marquee') {
            const anchor = toPlan(event.point)
            pressRef.current = { ...press, anchor }
            if (anchor) onMarquee?.({ ...anchor, w: 0, h: 0 }, { phase: 'start', additive: press.additive })
          }
          break
        case 'drag': {
          const scale = unitsPerPixel()
          if (press.mode === 'drag' && press.target) {
            const total = { x: event.total.x * scale, y: event.total.y * scale }
            onTargetDrag?.({ target: press.target, phase: 'move', total })
          } else if (press.mode === 'marquee') {
            const rect = marqueeRect(press.anchor, event.point)
            if (rect) onMarquee?.(rect, { phase: 'move', additive: press.additive })
          } else if (pannable) {
            changeView(planView.pan(viewRef.current, { x: -event.delta.x * scale, y: -event.delta.y * scale }))
          }
          break
        }
        case 'dragend':
          if (press.mode === 'drag' && press.target) {
            const scale = unitsPerPixel()
            onTargetDrag?.({
              target: press.target,
              phase: 'end',
              total: { x: event.total.x * scale, y: event.total.y * scale },
            })
          } else if (press.mode === 'marquee') {
            const rect = marqueeRect(press.anchor, event.point)
            if (rect) onMarquee?.(rect, { phase: 'end', additive: press.additive })
          }
          // After a pinch the remaining finger pans — it never drags the target the gesture began on.
          pressRef.current = IDLE_PRESS
          break
        case 'pinch': {
          if (!zoomable) break
          const center = toPlan(event.center)
          if (!center) break
          const scale = unitsPerPixel()
          const panned = planView.pan(viewRef.current, { x: -event.delta.x * scale, y: -event.delta.y * scale })
          changeView(planView.zoom(panned, event.factor, center, homeView))
          break
        }
      }
    }
  }

  // The rectangle between the marquee anchor and the pointer (screen point relative to the viewport box).
  function marqueeRect(anchor: PlanPoint | null, point: { x: number; y: number }) {
    if (!anchor) return null
    const to = toPlan(point)
    if (!to) return null
    return {
      x: Math.min(anchor.x, to.x),
      y: Math.min(anchor.y, to.y),
      w: Math.abs(to.x - anchor.x),
      h: Math.abs(to.y - anchor.y),
    }
  }

  function pointerOf(e: PointerEvent<SVGSVGElement>, refresh = false) {
    const origin = originOf(refresh) ?? { left: 0, top: 0 }
    return { id: e.pointerId, x: e.clientX - origin.left, y: e.clientY - origin.top }
  }

  function handlePointerDown(e: PointerEvent<SVGSVGElement>) {
    const middle = e.pointerType === 'mouse' && e.button === 1
    if (e.pointerType === 'mouse' && e.button !== 0 && !middle) return
    if (middle) e.preventDefault() // no autoscroll
    setKeyboardFocus(false)
    const pointer = pointerOf(e, gestureRef.current.kind === 'idle')
    if (gestureRef.current.kind === 'idle') {
      const target = middle ? null : targetOf<S>(e.target)
      const additive = e.shiftKey || e.metaKey || e.ctrlKey
      const mode =
        target !== null && (canDrag?.(target) ?? false)
          ? 'drag'
          : onMarquee && !middle && (additive || target !== null)
            ? 'marquee'
            : 'pan'
      pressRef.current = { target, mode, additive, anchor: null }
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const result = gesture.down(gestureRef.current, pointer, pressRef.current.target ? 'target' : null)
    gestureRef.current = result.state
    handle(result.events)
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
    const threshold = e.pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : undefined
    const result = gesture.move(gestureRef.current, pointerOf(e), threshold)
    gestureRef.current = result.state
    handle(result.events)
  }

  function handlePointerUp(e: PointerEvent<SVGSVGElement>) {
    const result = gesture.up(gestureRef.current, pointerOf(e))
    gestureRef.current = result.state
    handle(result.events)
  }

  function handlePointerCancel() {
    const result = gesture.cancel(gestureRef.current)
    gestureRef.current = result.state
    handle(result.events)
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
      onTap?.(
        { kind: 'place', id: active.id, objectId: active.parent?.id ?? active.id },
        { point: active.center, additive: e.shiftKey },
      )
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
    const origin = originOf(false)
    const center = origin ? toPlan({ x: e.clientX - origin.left, y: e.clientY - origin.top }) : null
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

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const next = { width: entry.contentRect.width, height: entry.contentRect.height }
      sizeRef.current = next
      setSize(next)
    })
    observer.observe(svg)
    // A scrolled page moves the viewport — the cached position is stale from then on.
    const forget = () => {
      originRef.current = null
    }
    window.addEventListener('scroll', forget, { capture: true, passive: true })
    window.addEventListener('resize', forget)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', forget, { capture: true })
      window.removeEventListener('resize', forget)
    }
  }, [])

  // Move the frame only when the view leaves its region or the zoom crosses a scale step.
  useEffect(() => {
    if (!size) return
    const scale = planView.scaleStep(planView.scaleOf(current, size))
    if (scale === frame.scale && planView.contains(frame.region, current)) return
    setFrame({ region: planView.region(current, REGION_MARGIN), scale })
  }, [current, size, frame])

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
      {typeof children === 'function' ? children(frame) : children}
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
  const handle = element.closest('[data-ichno-handle]')
  if (handle) {
    const id = handle.getAttribute('data-ichno-owner')!
    const owner =
      handle.getAttribute('data-ichno-owner-kind') === 'section'
        ? { kind: 'section' as const, id: id as S }
        : { kind: 'object' as const, id }
    return { kind: 'handle', owner, name: handle.getAttribute('data-ichno-handle')! }
  }
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
// How far beyond the view the frame region reaches, as a share of the view size on each side.
const REGION_MARGIN = 0.5
// How long a cached viewport position stays trusted for wheel events between gestures.
const ORIGIN_TTL_MS = 1000
const IDLE_PRESS: Press<never> = { target: null, mode: 'pan', additive: false, anchor: null }
