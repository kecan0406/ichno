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
  type ScreenPoint,
} from '../../core/gesture'
import { placeNavigation, type NavigationDirection } from '../../core/navigation'
import type { Place, PlanDrag, PlanPoint, PlanRect, PlanStroke, PlanTarget, SeatPlan } from '../../core/types'
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
  // Drag on empty floor (or on anything that does not drag) pans, and so does any drag with Space held or the
  // middle button. Leave off for small panels that compete with page scrolling.
  pannable?: boolean
  // Wheel and pinch zoom.
  zoomable?: boolean
  // What the wheel and two-finger scrolling do: `zoom` (the default, like a map) or `pan` (like a design tool —
  // pinching or ⌘/Ctrl + wheel zooms).
  wheel?: 'zoom' | 'pan'
  // Arrow keys move a focus ring between places and Enter or Space picks the focused one. On by default; an editor
  // turns it off while the arrow keys move its selection.
  navigable?: boolean
  // A tap, Enter or Space on a place.
  onPlaceClick?(place: Place<S>): void
  // Pointer entering and leaving places.
  onPlaceHover?(place: Place<S> | null): void
  // Any tap — a place, a non-place object, a section, or empty floor (null) — with the plan point and whether
  // shift, ⌘ or Ctrl was held (additive selection). The editor selects with it.
  onTap?(target: PlanTarget<S> | null, info: { point: PlanPoint | null; additive: boolean }): void
  // The pointer moving while nothing is pressed — the plan point under it and what it is over; nulls when it
  // leaves. Editors preview their tools and outline what a tap would select with it.
  onHover?(point: PlanPoint | null, target: PlanTarget<S> | null): void
  // Which targets move instead of panning, and what happens while they do (the editor passes both).
  canDrag?(target: PlanTarget<S>): boolean
  onTargetDrag?(drag: PlanDrag<S>): void
  // Rubber-band selection. When given, a drag that does not move its target draws a rectangle instead of panning —
  // on touch only one that starts on a section or with shift, ⌘ or Ctrl held, so a finger on empty space still pans.
  onMarquee?(rect: PlanRect, info: { phase: 'start' | 'move' | 'end'; additive: boolean }): void
  // A creation tool is active: presses draw strokes instead of selecting, moving or panning (Space and the middle
  // button still pan). A tap is a stroke with no length, reported once at `end`. `constrain` (Shift) and
  // `fromCenter` (Alt) are the keys held, reported again when they change mid-stroke; `cancel` ends a stroke that
  // must not create anything — a second finger landed, or the pointer was lost.
  onDraw?(
    stroke: PlanStroke,
    info: { phase: 'start' | 'move' | 'end' | 'cancel'; constrain: boolean; fromCenter: boolean },
  ): void
}

type Press<S extends string> = {
  target: PlanTarget<S> | null
  mode: 'drag' | 'marquee' | 'pan' | 'draw'
  additive: boolean
  // Where a drag, a marquee or a stroke started, in plan units.
  anchor: PlanPoint | null
  // Where the pointer last was (viewport pixels) — reported again, on the view as it is then, when the view moves
  // under it or Shift or Alt changes mid-drag.
  at: ScreenPoint | null
}

// Shift constrains a drag or a stroke, Alt draws from the centre.
type Keys = { constrain: boolean; fromCenter: boolean }

// The interactive plan — an <svg> that pans, zooms (wheel, pinch), reports taps, drags and strokes, and moves a
// focus ring between places with the arrow keys. Children are the same server-safe parts <SeatMap.Root> takes;
// events are delegated by their `data-ichno-*` attributes, so the parts carry no handlers. The svg carries
// `data-pan` — `ready` while Space is held, `active` while panning — for grab cursors. Drags are followed in plan
// units, so what is dragged stays under the pointer while the view moves; held near the edge, a drag, a marquee or a
// stroke scrolls the plan toward it (like tldraw's edge scrolling and React Flow's auto-pan).
// Behaviour comes from the renderer-independent core (gesture, placeNavigation, planView).
export function Viewport<S extends string>({
  plan,
  view,
  defaultView,
  onViewChange,
  pannable = true,
  zoomable = true,
  wheel = 'zoom',
  navigable = true,
  onPlaceClick,
  onPlaceHover,
  onTap,
  onHover,
  canDrag,
  onTargetDrag,
  onMarquee,
  onDraw,
  style,
  children,
  onFocus,
  onBlur,
  onContextMenu,
  ...rest
}: ViewportProps<S>) {
  const svgRef = useRef<SVGSVGElement>(null)
  const gestureRef = useRef<GestureState>(IDLE_GESTURE)
  // What the current press started on, and whether it drags that target, draws a marquee or a stroke, or pans.
  const pressRef = useRef<Press<S>>(IDLE_PRESS)
  const hoverRef = useRef<string | null>(null)
  // Shift and Alt as last seen — they shape drags and strokes.
  const keysRef = useRef<Keys>(NO_KEYS)
  // Fingers on the plan — their pointers pinch, so Safari's gesture events for the same pinch are not zoomed again.
  const touchesRef = useRef(new Set<number>())
  // Whether the pointer is over the viewport — Space then pans instead of scrolling the page.
  const insideRef = useRef(false)
  // Space held — presses pan while it is.
  const spaceRef = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  // A drag, a marquee or a stroke under way — the plan scrolls while it is held near the edge. `since` is when the
  // pointer reached the edge, `last` the previous frame.
  const [edging, setEdging] = useState(false)
  const edgeRef = useRef<{ since: number | null; last: number | null }>({ since: null, last: null })
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
  // The viewport's page position, read once per gesture (and when stale for the wheel and hovering).
  const originRef = useRef<{ left: number; top: number; at: number } | null>(null)
  const [frame, setFrame] = useState<ViewportFrame>(() => ({
    region: planView.region(current, REGION_MARGIN),
    scale: 1,
  }))

  const [activeId, setActiveId] = useState<string | null>(null)
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const places = seatPlan.placesOf(plan)
  const navigation = places.map((place) => ({ id: place.id, center: seatPlan.centerOf(place) }))
  const active = activeId === null ? undefined : places.find((place) => place.id === activeId)

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

  // Reports the drag, marquee or stroke under way where the pointer last was, on the view as it is now — so what is
  // dragged stays under the pointer when the view moves beneath it, and the keys held now shape it.
  function report(phase: 'move' | 'end') {
    const press = pressRef.current
    const to = press.at && toPlan(press.at)
    if (!press.anchor || !to) return
    const keys = keysRef.current
    if (press.mode === 'drag' && press.target) {
      const total = { x: to.x - press.anchor.x, y: to.y - press.anchor.y }
      onTargetDrag?.({ target: press.target, phase, total, constrain: keys.constrain })
    } else if (press.mode === 'marquee') {
      onMarquee?.(rectBetween(press.anchor, to), { phase, additive: press.additive })
    } else if (press.mode === 'draw') {
      onDraw?.({ start: press.anchor, end: to }, { phase, ...keys })
    }
  }

  function changeView(next: PlanView) {
    viewRef.current = next
    if (view === undefined) setOwnView(next)
    onViewChange?.(next)
    // The view moved under a drag (the wheel, edge scrolling) — what is dragged keeps up with the pointer.
    if (gestureRef.current.kind === 'dragging' && pressRef.current.mode !== 'pan') report('move')
  }

  function handle(events: GestureEvent[]) {
    for (const event of events) {
      // Read per event — a marquee or a stroke sets its anchor on dragstart, and the drag in the same batch needs it.
      const press = pressRef.current
      switch (event.type) {
        case 'tap': {
          const point = toPlan(event.point)
          if (press.mode === 'draw') {
            if (point) onDraw?.({ start: point, end: point }, { phase: 'end', ...keysRef.current })
            break
          }
          const target = press.target
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
        case 'dragstart': {
          if (press.mode === 'pan') {
            if (pannable) setPanning(true)
            break
          }
          const anchor = toPlan(event.point)
          pressRef.current = { ...press, anchor, at: event.point }
          if (!anchor) break
          if (press.mode === 'drag' && press.target) {
            onTargetDrag?.({
              target: press.target,
              phase: 'start',
              total: { x: 0, y: 0 },
              constrain: keysRef.current.constrain,
            })
          } else if (press.mode === 'marquee') {
            onMarquee?.({ ...anchor, w: 0, h: 0 }, { phase: 'start', additive: press.additive })
          } else if (press.mode === 'draw') {
            onDraw?.({ start: anchor, end: anchor }, { phase: 'start', ...keysRef.current })
          }
          if (pannable) setEdging(true)
          break
        }
        case 'drag': {
          if (press.mode === 'pan') {
            const scale = unitsPerPixel()
            if (pannable)
              changeView(planView.pan(viewRef.current, { x: -event.delta.x * scale, y: -event.delta.y * scale }))
            break
          }
          pressRef.current = { ...press, at: event.point }
          report('move')
          break
        }
        case 'dragend':
          if (press.mode !== 'pan') {
            pressRef.current = { ...press, at: event.point }
            report('end')
          }
          setPanning(false)
          setEdging(false)
          // After a pinch the remaining finger pans — it never drags the target the gesture began on.
          pressRef.current = IDLE_PRESS
          break
        case 'pinch': {
          const size = sizeRef.current
          if (zoomable && size) changeView(planView.pinch(viewRef.current, size, event, homeView))
          break
        }
      }
    }
  }

  // Drops a stroke in progress — it must not create anything.
  function cancelStroke() {
    const press = pressRef.current
    const end = press.at && toPlan(press.at)
    if (press.mode === 'draw' && press.anchor && end) {
      onDraw?.({ start: press.anchor, end }, { phase: 'cancel', ...keysRef.current })
    }
    pressRef.current = IDLE_PRESS
    setEdging(false)
  }

  // Shift or Alt changed mid-drag — report the drag or the stroke again, shaped by the keys held now.
  function restate() {
    if (gestureRef.current.kind === 'dragging' && pressRef.current.mode !== 'pan') report('move')
  }

  function pointerOf(e: PointerEvent<SVGSVGElement>, refresh = false) {
    const origin = originOf(refresh) ?? { left: 0, top: 0 }
    return { id: e.pointerId, x: e.clientX - origin.left, y: e.clientY - origin.top }
  }

  function handlePointerCancel(e: { pointerId: number }) {
    touchesRef.current.delete(e.pointerId)
    if (pressRef.current.mode === 'draw') cancelStroke()
    const result = gesture.cancel(gestureRef.current)
    gestureRef.current = result.state
    handle(result.events)
  }

  function handlePointerDown(e: PointerEvent<SVGSVGElement>) {
    const middle = e.pointerType === 'mouse' && e.button === 1
    if (e.pointerType === 'mouse' && e.button !== 0 && !middle) return
    if (middle) e.preventDefault() // no autoscroll
    if (e.pointerType === 'touch') touchesRef.current.add(e.pointerId)
    setKeyboardFocus(false)
    keysRef.current = keysOf(e)
    const idle = gestureRef.current.kind === 'idle'
    const pointer = pointerOf(e, idle)
    if (idle) {
      const additive = e.shiftKey || e.metaKey || e.ctrlKey
      const pan = middle || (spaceRef.current && pannable)
      const target = pan ? null : targetOf<S>(e.target)
      const mode: Press<S>['mode'] = pan
        ? 'pan'
        : onDraw
          ? 'draw'
          : target !== null && (canDrag?.(target) ?? false)
            ? 'drag'
            : onMarquee && (additive || target !== null || e.pointerType !== 'touch')
              ? 'marquee'
              : 'pan'
      pressRef.current = { target, mode, additive, anchor: null, at: null }
    } else if (pressRef.current.mode === 'draw') {
      // A second finger turns the press into a pinch — the stroke is dropped, not drawn.
      cancelStroke()
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const result = gesture.down(gestureRef.current, pointer, pressRef.current.target ? 'target' : null)
    gestureRef.current = result.state
    handle(result.events)
    // A second finger turns the press into a pinch, and whatever finger remains afterwards pans — the target the
    // first finger landed on is let go even when no drag had started yet.
    if (result.state.kind === 'pinching') pressRef.current = IDLE_PRESS
  }

  function handlePointerMove(e: PointerEvent<SVGSVGElement>) {
    if (gestureRef.current.kind === 'idle') {
      insideRef.current = true
      const target = targetOf<S>(e.target)
      const place = target?.kind === 'place' ? placeById(target.id) : undefined
      if ((place?.id ?? null) !== hoverRef.current) {
        hoverRef.current = place?.id ?? null
        onPlaceHover?.(place ?? null)
      }
      onHover?.(toPlan(pointerOf(e)), target)
      return
    }
    // A button let go where the release never reached us (a menu opened mid-drag took it) — end the press where it
    // last was, instead of dragging on with nothing held.
    if (e.buttons === 0 && e.pointerType !== 'touch' && holds(gestureRef.current, e.pointerId)) {
      handlePointerCancel(e)
      return
    }
    keysRef.current = keysOf(e)
    const threshold = e.pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : undefined
    const result = gesture.move(gestureRef.current, pointerOf(e), threshold)
    gestureRef.current = result.state
    handle(result.events)
  }

  function handlePointerUp(e: PointerEvent<SVGSVGElement>) {
    touchesRef.current.delete(e.pointerId)
    keysRef.current = keysOf(e)
    const result = gesture.up(gestureRef.current, pointerOf(e))
    gestureRef.current = result.state
    handle(result.events)
  }

  // Capture ends with every release. Lost while a press still follows the pointer, the release is not coming —
  // end the press rather than leave it stuck.
  function handleLostCapture(e: PointerEvent<SVGSVGElement>) {
    if (holds(gestureRef.current, e.pointerId)) handlePointerCancel(e)
  }

  function handlePointerLeave() {
    insideRef.current = false
    onHover?.(null, null)
    if (hoverRef.current === null) return
    hoverRef.current = null
    onPlaceHover?.(null)
  }

  function handleKeyDown(e: KeyboardEvent<SVGSVGElement>) {
    const direction = navigable ? ARROW_KEYS[e.key] : undefined
    if (direction) {
      e.preventDefault()
      setKeyboardFocus(true)
      const next =
        activeId === null
          ? placeNavigation.first(navigation)
          : (placeNavigation.next(navigation, activeId, direction) ?? activeId)
      if (next !== null) {
        setActiveId(next)
        revealPlace(next)
      }
      return
    }
    // Only the place the ring shows is picked — a place tapped earlier is not picked again by a stray key.
    if (navigable && (e.key === 'Enter' || e.key === ' ') && active && keyboardFocus) {
      e.preventDefault()
      onTap?.({ kind: 'place', id: active.id }, { point: seatPlan.centerOf(active), additive: e.shiftKey })
      onPlaceClick?.(active)
      return
    }
    // Space is held to pan — it must not scroll the page.
    if (e.key === ' ' && pannable) e.preventDefault()
  }

  // Keep the focused place on screen — recentre on it when it leaves what the viewport shows.
  function revealPlace(id: string) {
    const place = placeById(id)
    const box = viewRef.current
    if (!place) return
    const shown = sizeRef.current ? planView.visible(box, sizeRef.current) : box
    if (planView.contains(shown, seatPlan.boundsOf(place))) return
    const center = seatPlan.centerOf(place)
    changeView({ ...box, x: center.x - box.w / 2, y: center.y - box.h / 2 })
  }

  // Wheel zoom needs a non-passive listener to stop the page from scrolling; React's wheel handler is passive.
  const onWheel = useEffectEvent((e: WheelEvent) => {
    // A trackpad pinch arrives as a wheel event with Ctrl held; ⌘ or Ctrl with a wheel zooms by hand.
    const zoomKey = e.ctrlKey || e.metaKey
    const dx = wheelPixels(e.deltaX, e.deltaMode)
    const dy = wheelPixels(e.deltaY, e.deltaMode)
    if (wheel === 'pan' && !zoomKey) {
      if (!pannable || (dx === 0 && dy === 0)) return
      e.preventDefault()
      const scale = unitsPerPixel()
      // Shift turns a plain wheel sideways where the browser does not already.
      const delta = e.shiftKey && dx === 0 ? { x: dy, y: 0 } : { x: dx, y: dy }
      changeView(planView.pan(viewRef.current, { x: delta.x * scale, y: delta.y * scale }))
      return
    }
    // Horizontal swipes (deltaY 0) are not zoom — leave them to the page.
    if (!zoomable || dy === 0) return
    e.preventDefault()
    const origin = originOf(false)
    const center = origin ? toPlan({ x: e.clientX - origin.left, y: e.clientY - origin.top }) : null
    if (!center) return
    changeView(planView.zoom(viewRef.current, zoomFactorOf(dy, e.ctrlKey), center, homeView))
  })
  // Safari reports a trackpad pinch as gesture events — the scale since it began — instead of Ctrl + wheel.
  const pinchRef = useRef(1)
  const onGesture = useEffectEvent((e: Event) => {
    if (!zoomable) return
    e.preventDefault() // not the page's zoom
    // On a touch screen Safari sends them too, for the fingers whose pointers already pinch — zooming here as well
    // would zoom twice as far (tldraw and use-gesture listen to one or the other for the same reason).
    if (touchesRef.current.size > 0) return
    const pinch = e as Event & { scale: number; clientX: number; clientY: number }
    if (e.type === 'gesturestart') pinchRef.current = 1
    if (e.type !== 'gesturechange') return
    const factor = pinch.scale / pinchRef.current
    pinchRef.current = pinch.scale
    const origin = originOf(false)
    const center = origin ? toPlan({ x: pinch.clientX - origin.left, y: pinch.clientY - origin.top }) : null
    if (center && factor > 0 && Number.isFinite(factor)) {
      changeView(planView.zoom(viewRef.current, factor, center, homeView))
    }
  })
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const wheelListener = (e: WheelEvent) => onWheel(e)
    const gestureListener = (e: Event) => onGesture(e)
    svg.addEventListener('wheel', wheelListener, { passive: false })
    for (const type of GESTURE_EVENTS) svg.addEventListener(type, gestureListener)
    return () => {
      svg.removeEventListener('wheel', wheelListener)
      for (const type of GESTURE_EVENTS) svg.removeEventListener(type, gestureListener)
    }
  }, [])

  // Space held over the viewport (or with it focused) turns presses into pans; Shift and Alt pressed or let go
  // mid-drag reshape the drag at once.
  const onWindowKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    if (e.key === 'Shift' || e.key === 'Alt') {
      keysRef.current = keysOf(e)
      restate()
      return
    }
    if (e.code !== 'Space' || isTyping(e.target) || inDialog(e.target)) return
    const down = e.type === 'keydown'
    // Over a viewport that pans, Space is ours: it neither scrolls the page nor presses the button that has focus.
    // Letting go always counts, so a key released after panning was turned off is not left held.
    const ours = pannable && (insideRef.current || e.target === svgRef.current)
    if (down && !ours) return
    if (ours) e.preventDefault()
    if (spaceRef.current === down) return
    spaceRef.current = down
    setSpaceHeld(down)
  })
  const onWindowBlur = useEffectEvent(() => {
    spaceRef.current = false
    setSpaceHeld(false)
  })
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => onWindowKey(e)
    const blur = () => onWindowBlur()
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', key)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', key)
      window.removeEventListener('blur', blur)
    }
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const next = { width: entry.contentRect.width, height: entry.contentRect.height }
      sizeRef.current = next
      setSize(next)
      // A panel opening beside the viewport resizes it and moves it — the cached position is stale too.
      originRef.current = null
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

  // Move the frame only when what the viewport shows leaves its region or the zoom crosses a scale step. What it
  // shows, not the view: a viewport of another shape shows plan beyond the view, and that must be drawn too.
  useEffect(() => {
    if (!size) return
    const scale = planView.scaleStep(planView.scaleOf(current, size))
    const shown = planView.visible(current, size)
    if (scale === frame.scale && planView.contains(frame.region, shown)) return
    setFrame({ region: planView.region(shown, REGION_MARGIN), scale })
  }, [current, size, frame])

  // Edge scrolling — every frame while a drag, a marquee or a stroke is held near the edge (after a moment, so
  // passing over the edge does nothing), the plan scrolls toward it, faster the closer the pointer is and at full
  // speed past it, until the drawing's edge comes into view: nothing can be moved or drawn beyond it. Speed is per
  // 60 Hz frame and scaled by the time since the last one, so fast displays scroll alike.
  const onEdgeFrame = useEffectEvent((now: number) => {
    const edge = edgeRef.current
    const at = pressRef.current.at
    const size = sizeRef.current
    const elapsed = edge.last === null ? 0 : Math.min(now - edge.last, EDGE_MAX_STEP_MS)
    edge.last = now
    const push = at && size ? edgePush(at, size) : null
    if (!push || !size) {
      edge.since = null
      return
    }
    if (edge.since === null) edge.since = now
    const held = now - edge.since - EDGE_DELAY_MS
    if (held <= 0) return
    const units = EDGE_SPEED_PX * Math.min(1, held / EDGE_EASE_MS) * (elapsed / FRAME_MS) * unitsPerPixel()
    const shown = planView.visible(viewRef.current, size)
    const dx = towardEdge(push.x * units, shown.x, shown.w, homeView.x, homeView.w)
    const dy = towardEdge(push.y * units, shown.y, shown.h, homeView.y, homeView.h)
    if (dx !== 0 || dy !== 0) changeView(planView.pan(viewRef.current, { x: dx, y: dy }))
  })
  useEffect(() => {
    if (!edging) return
    edgeRef.current = { since: null, last: null }
    return everyFrame((now) => onEdgeFrame(now))
  }, [edging])

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

  const ring = navigable && keyboardFocus && active ? active : null
  const gestures = pannable || zoomable
  const pan = panning ? 'active' : spaceHeld && pannable ? 'ready' : undefined

  return (
    <svg
      ref={svgRef}
      viewBox={`${current.x} ${current.y} ${current.w} ${current.h}`}
      data-ichno-root=""
      data-pan={pan}
      role="listbox"
      tabIndex={0}
      // A presentation attribute, so a consumer's cursor rule still wins.
      cursor={pan === 'active' ? 'grabbing' : pan === 'ready' ? 'grab' : undefined}
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
      onLostPointerCapture={handleLostCapture}
      onPointerLeave={handlePointerLeave}
      onContextMenu={(e) => {
        // A menu opened mid-drag would take the release with it.
        if (gestureRef.current.kind !== 'idle') e.preventDefault()
        onContextMenu?.(e)
      }}
      onKeyDown={handleKeyDown}
      onFocus={(e) => {
        if (e.target === e.currentTarget) {
          if (activeId === null) setActiveId(placeNavigation.first(navigation))
          // Focus from the keyboard shows the ring at once, so Enter picks the place it shows.
          if (e.currentTarget.matches(':focus-visible')) setKeyboardFocus(true)
        }
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
          // Turned with the place, so the ring hugs it.
          transform={
            ring.rotation ? `rotate(${ring.rotation} ${ring.x + ring.w / 2} ${ring.y + ring.h / 2})` : undefined
          }
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

// The handle, place, object or section an element belongs to — the nearest part with an ichno data attribute.
function targetOf<S extends string>(element: EventTarget | null): PlanTarget<S> | null {
  if (!(element instanceof Element)) return null
  const handle = element.closest('[data-ichno-handle]')
  if (handle) {
    const id = handle.getAttribute('data-ichno-owner')!
    const kind = handle.getAttribute('data-ichno-owner-kind')
    const owner =
      kind === 'section'
        ? { kind: 'section' as const, id: id as S }
        : { kind: kind === 'group' ? ('group' as const) : ('object' as const), id }
    return { kind: 'handle', owner, name: handle.getAttribute('data-ichno-handle')! }
  }
  const place = element.closest('[data-ichno-id]')
  if (place) return { kind: 'place', id: place.getAttribute('data-ichno-id')! }
  const object = element.closest('[data-ichno-object]')
  if (object) return { kind: 'object', id: object.getAttribute('data-ichno-object')! }
  const section = element.closest('[data-ichno-section]')
  if (section) return { kind: 'section', id: section.getAttribute('data-ichno-section') as S }
  return null
}

function keysOf(e: { shiftKey: boolean; altKey: boolean }): Keys {
  return { constrain: e.shiftKey, fromCenter: e.altKey }
}

// Calls `frame` on every animation frame until the returned function stops it.
function everyFrame(frame: (now: number) => void): () => void {
  let id = requestAnimationFrame(function tick(now) {
    frame(now)
    id = requestAnimationFrame(tick)
  })
  return () => cancelAnimationFrame(id)
}

// Whether a gesture still follows this pointer.
function holds(state: GestureState, pointerId: number): boolean {
  if (state.kind === 'pressed' || state.kind === 'dragging') return state.pointer.id === pointerId
  if (state.kind === 'pinching') return state.pointers.some((pointer) => pointer.id === pointerId)
  return false
}

// The rectangle between two plan points.
function rectBetween(a: PlanPoint, b: PlanPoint): PlanRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

// How hard a pointer (viewport pixels) pushes toward each edge — 0 clear of the edge band, up to ±1 at the edge and
// beyond it. null when it pushes toward none.
function edgePush(at: ScreenPoint, size: ViewportSize): PlanPoint | null {
  const x = pushAlong(at.x, size.width)
  const y = pushAlong(at.y, size.height)
  return x === 0 && y === 0 ? null : { x, y }
}

function pushAlong(at: number, length: number): number {
  if (at < EDGE_PX) return -Math.min(1, (EDGE_PX - at) / EDGE_PX)
  if (at > length - EDGE_PX) return Math.min(1, (at - (length - EDGE_PX)) / EDGE_PX)
  return 0
}

// A scroll of `delta` plan units along one axis, cut short where what is shown (`start`, `length`) reaches the edge
// of the drawing (`from`, `extent`) — none once it shows that edge already.
function towardEdge(delta: number, start: number, length: number, from: number, extent: number): number {
  if (delta > 0) return Math.max(0, Math.min(delta, from + extent - (start + length)))
  if (delta < 0) return Math.min(0, Math.max(delta, from - start))
  return 0
}

// Keys typed into a field are text, not commands.
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]') !== null
}

// Keys pressed in a dialog belong to it, even while the pointer rests over the viewport behind it.
function inDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('dialog') !== null
}

// Wheel deltas in pixels, whatever unit the browser reports them in.
function wheelPixels(delta: number, mode: number): number {
  return mode === 1 ? delta * WHEEL_LINE_PX : mode === 2 ? delta * WHEEL_PAGE_PX : delta
}

// How much one wheel event zooms — in proportion to how far it scrolled, so a trackpad's many small events zoom as
// smoothly as a mouse's few large ones. A pinch (Ctrl) scrolls in small steps and zooms faster per pixel. Never
// more than ZOOM_STEP per event.
function zoomFactorOf(deltaY: number, pinch: boolean): number {
  const factor = Math.exp(-deltaY * (pinch ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE))
  return Math.min(ZOOM_STEP, Math.max(1 / ZOOM_STEP, factor))
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
// How long a cached viewport position stays trusted for wheel and hover events between gestures.
const ORIGIN_TTL_MS = 1000
// A mouse wheel notch — about 100 pixels, or three lines — zooms by one ZOOM_STEP.
const WHEEL_ZOOM_RATE = Math.log(ZOOM_STEP) / 100
const PINCH_ZOOM_RATE = 0.01
const WHEEL_LINE_PX = 33
const WHEEL_PAGE_PX = 800
const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const
// Edge scrolling: the band along each edge (screen pixels) where a held pointer scrolls, how long it waits there
// before scrolling and how long it takes to reach full speed — at most EDGE_SPEED_PX per 60 Hz frame.
const EDGE_PX = 24
const EDGE_DELAY_MS = 200
const EDGE_EASE_MS = 300
const EDGE_SPEED_PX = 18
const FRAME_MS = 1000 / 60
// A frame late by more than this (a background tab) scrolls as if it were not — no leap on return.
const EDGE_MAX_STEP_MS = 50
const IDLE_PRESS: Press<never> = { target: null, mode: 'pan', additive: false, anchor: null, at: null }
const NO_KEYS: Keys = { constrain: false, fromCenter: false }
