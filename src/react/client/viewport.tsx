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
import { placeNavigation, type NavigationDirection } from '../../core/navigation'
import {
  IDLE_EDGE_SCROLL,
  IDLE_PRESS,
  edgeScroll,
  press,
  type EdgeScrollState,
  type PressEnv,
  type PressEvent,
  type PressPointer,
  type PressResult,
  type PressState,
} from '../../core/press'
import type { Place, PlanDrag, PlanPoint, PlanRect, PlanStroke, PlanTarget, SeatPlan } from '../../core/types'
import { ZOOM_STEP, planView, type PlanView, type ViewportSize } from '../../core/view'
import { FONT_VAR, cssVar } from '../../theme/vars'
import { planTargetOf } from '../target'

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
  // The widest view — where the view starts and what zooming out stops at. The whole drawing by default
  // (`planView.home(plan)`); pass one with a margin to keep the drawing off the edges.
  home?: PlanView
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
  // A tap, Enter or Space on a place that is not `disabled`.
  onPlaceClick?(place: Place<S>): void
  // Places that cannot be picked — the list <SeatMap.Content> draws as `disabled`. A tap, Enter or Space on one
  // calls no `onPlaceClick`; the focus ring still reaches it and `onTap` still reports it.
  disabled?: readonly string[]
  // Pointer entering and leaving places.
  onPlaceHover?(place: Place<S> | null): void
  // Any tap — a place, a non-place object, a wall, a section, or empty floor (null) — with the plan point and whether
  // shift, ⌘ or Ctrl was held (additive selection). The editor selects with it.
  onTap?(target: PlanTarget<S> | null, info: { point: PlanPoint | null; additive: boolean }): void
  // The pointer moving while nothing is pressed — the plan point under it and what it is over; nulls when it
  // leaves. Editors preview their tools and outline what a tap would select with it. `pixel` is how many plan units
  // a screen pixel spans.
  onHover?(point: PlanPoint | null, target: PlanTarget<S> | null, info?: { pixel: number }): void
  // Which targets move instead of panning, and what happens while they do (the editor passes both).
  canDrag?(target: PlanTarget<S>): boolean
  onTargetDrag?(drag: PlanDrag<S>): void
  // Rubber-band selection. When given, a drag that does not move its target draws a rectangle instead of panning —
  // on touch only one that starts on a section or with shift, ⌘ or Ctrl held, so a finger on empty space still pans.
  onMarquee?(rect: PlanRect, info: { phase: 'start' | 'move' | 'end'; additive: boolean }): void
  // A creation tool is active: presses draw strokes instead of selecting, moving or panning (Space and the middle
  // button still pan). A tap is a stroke with no length, reported once at `end`. `constrain` (Shift) and
  // `fromCenter` (Alt) are the keys held, reported again when they change mid-stroke; `cancel` ends a stroke that
  // must not create anything — a second finger landed, or the pointer was lost. `free` is ⌘ or Ctrl (smart guides
  // let go); `pixel` is how many plan units a screen pixel spans.
  onDraw?(
    stroke: PlanStroke,
    info: {
      phase: 'start' | 'move' | 'end' | 'cancel'
      constrain: boolean
      fromCenter: boolean
      free?: boolean
      pixel?: number
    },
  ): void
}

// The interactive plan — an <svg> that pans, zooms (wheel, pinch), reports taps, drags and strokes, and moves a
// focus ring between places with the arrow keys. Children are the same server-safe parts <SeatMap.Root> takes;
// events are delegated by their `data-ichno-*` attributes, so the parts carry no handlers. The svg carries
// `data-pan` — `ready` while Space is held, `active` while panning — for grab cursors. Drags are followed in plan
// units, so what is dragged stays under the pointer while the view moves; held near the edge, a drag, a marquee or a
// stroke scrolls the plan toward it (like tldraw's edge scrolling and React Flow's auto-pan).
// Behaviour comes from the renderer-independent core (press, placeNavigation, planView).
export function Viewport<S extends string>({
  plan,
  view,
  defaultView,
  onViewChange,
  home,
  pannable = true,
  zoomable = true,
  wheel = 'zoom',
  navigable = true,
  onPlaceClick,
  disabled,
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
  const disabledSet = new Set(disabled)
  const svgRef = useRef<SVGSVGElement>(null)
  // The press under way — what it started on and whether it drags that, draws a marquee or a stroke, or pans.
  const pressRef = useRef<PressState<S>>(IDLE_PRESS)
  const hoverRef = useRef<string | null>(null)
  // Whether the pointer is over the viewport — Space then pans instead of scrolling the page.
  const insideRef = useRef(false)
  // Space held — presses pan while it is.
  const spaceRef = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  // A drag, a marquee or a stroke under way — the plan scrolls while it is held near the edge. `since` is when the
  // pointer reached the edge, `last` the previous frame.
  const [edging, setEdging] = useState(false)
  const edgeRef = useRef<EdgeScrollState>(IDLE_EDGE_SCROLL)
  const idPrefix = useId()

  const homeView = home ?? planView.home(plan)
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

  // What a press means here, as the view is now (core `press`).
  function envOf(): PressEnv<S> {
    return {
      toPlan,
      pixel: unitsPerPixel(),
      draws: onDraw !== undefined,
      marquees: onMarquee !== undefined,
      pans: pannable,
      grabs: spaceRef.current && pannable,
      canDrag: (target) => canDrag?.(target) ?? false,
    }
  }

  // Hands a drag, a marquee or a stroke on to whoever follows it.
  function report(event: PressEvent<S>) {
    if (event.type === 'drag') onTargetDrag?.(event.drag)
    else if (event.type === 'marquee' && event.rect)
      onMarquee?.(event.rect, { phase: event.phase, additive: event.additive })
    else if (event.type === 'draw') onDraw?.(event.stroke, { phase: event.phase, ...event.keys, pixel: event.pixel })
  }

  function changeView(next: PlanView) {
    viewRef.current = next

    if (view === undefined) setOwnView(next)
    onViewChange?.(next)

    // The view moved under a drag (the wheel, edge scrolling) — what is dragged keeps up with the pointer.
    for (const event of press.restate(pressRef.current, envOf())) report(event)
  }

  // Takes a step of the press and acts on what it means — taps, drags, marquees and strokes go to the handlers, a
  // pan and a pinch move the view.
  function act(result: PressResult<S>) {
    pressRef.current = result.state

    for (const event of result.events) {
      switch (event.type) {
        case 'tap': {
          onTap?.(event.target, { point: event.point, additive: event.additive })
          const place = event.target?.kind === 'place' ? placeById(event.target.id) : undefined

          if (place) {
            setActiveId(place.id)

            if (!disabledSet.has(place.id)) onPlaceClick?.(place)
          }

          break
        }

        case 'pan': {
          setPanning(event.phase !== 'end')

          if (event.phase !== 'move') break
          const scale = unitsPerPixel()
          changeView(planView.pan(viewRef.current, { x: -event.delta.x * scale, y: -event.delta.y * scale }))
          break
        }

        case 'pinch': {
          const viewport = sizeRef.current

          if (zoomable && viewport) changeView(planView.pinch(viewRef.current, viewport, event, homeView))
          break
        }

        case 'hold':
          setEdging(event.held && pannable)
          break
        default:
          report(event)
      }
    }
  }

  function pointerOf(e: PointerEvent<SVGSVGElement>, refresh = false): PressPointer {
    const origin = originOf(refresh) ?? { left: 0, top: 0 }

    return {
      id: e.pointerId,
      x: e.clientX - origin.left,
      y: e.clientY - origin.top,
      type: e.pointerType,
      button: e.button,
      buttons: e.buttons,
    }
  }

  function handlePointerCancel(e: { pointerId: number }) {
    act(press.cancel(pressRef.current, { id: e.pointerId }, envOf()))
  }

  function handlePointerDown(e: PointerEvent<SVGSVGElement>) {
    const middle = e.pointerType === 'mouse' && e.button === 1

    if (e.pointerType === 'mouse' && e.button !== 0 && !middle) return

    if (middle) e.preventDefault() // no autoscroll
    setKeyboardFocus(false)
    // The viewport's place on the page is read once per gesture.
    const pointer = pointerOf(e, pressRef.current.gesture.kind === 'idle')
    e.currentTarget.setPointerCapture(e.pointerId)
    act(press.down(pressRef.current, pointer, planTargetOf<S>(e.target), press.keysOf(e), envOf()))
  }

  function handlePointerMove(e: PointerEvent<SVGSVGElement>) {
    if (pressRef.current.gesture.kind !== 'idle') {
      act(press.move(pressRef.current, pointerOf(e), press.keysOf(e), envOf()))

      return
    }

    insideRef.current = true
    const target = planTargetOf<S>(e.target)
    const place = target?.kind === 'place' ? placeById(target.id) : undefined

    if ((place?.id ?? null) !== hoverRef.current) {
      hoverRef.current = place?.id ?? null
      onPlaceHover?.(place ?? null)
    }

    onHover?.(toPlan(pointerOf(e)), target, { pixel: unitsPerPixel() })
  }

  function handlePointerUp(e: PointerEvent<SVGSVGElement>) {
    act(press.up(pressRef.current, pointerOf(e), press.keysOf(e), envOf()))
  }

  // Capture ends with every release. Lost while a press still follows the pointer, the release is not coming —
  // end the press rather than leave it stuck.
  function handleLostCapture(e: PointerEvent<SVGSVGElement>) {
    if (press.holds(pressRef.current, e.pointerId)) handlePointerCancel(e)
  }

  function handlePointerLeave() {
    insideRef.current = false
    onHover?.(null, null)

    if (hoverRef.current === null) return
    hoverRef.current = null
    onPlaceHover?.(null)
  }

  function handleKeyDown(e: KeyboardEvent<SVGSVGElement>) {
    const direction = navigable ? ARROW_KEYS.get(e.key) : undefined

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

      if (!disabledSet.has(active.id)) onPlaceClick?.(active)

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
    if (pressRef.current.touches.length > 0) return
    // SAFETY: only GESTURE_EVENTS reach this, and Safari sends them as GestureEvents (lib.dom has no type for them),
    // which carry the scale and the pointer's client position.
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

  // Space held over the viewport (or with it focused) turns presses into pans; Shift, Alt, ⌘ and Ctrl pressed or let
  // go mid-drag reshape the drag at once.
  const onWindowKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Control') {
      act(press.keys(pressRef.current, press.keysOf(e), envOf()))

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
    const size = sizeRef.current
    const stepped = edgeScroll.step(edgeRef.current, pressRef.current.at, size, now)
    edgeRef.current = stepped.state

    if (!stepped.scroll || !size) return
    const scale = unitsPerPixel()
    const shown = planView.visible(viewRef.current, size)
    const dx = towardEdge(stepped.scroll.x * scale, shown.x, shown.w, homeView.x, homeView.w)
    const dy = towardEdge(stepped.scroll.y * scale, shown.y, shown.h, homeView.y, homeView.h)

    if (dx !== 0 || dy !== 0) changeView(planView.pan(viewRef.current, { x: dx, y: dy }))
  })

  useEffect(() => {
    if (!edging) return
    edgeRef.current = IDLE_EDGE_SCROLL

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
        if (pressRef.current.gesture.kind !== 'idle') e.preventDefault()
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
      {isRenderProp(children) ? children(frame) : children}
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

// Children given as a function of the frame rather than drawn already.
function isRenderProp(children: ViewportProps<string>['children']): children is (frame: ViewportFrame) => ReactNode {
  return typeof children === 'function'
}

// Calls `frame` on every animation frame until the returned function stops it.
function everyFrame(frame: (now: number) => void): () => void {
  let id = requestAnimationFrame(function tick(now) {
    frame(now)
    id = requestAnimationFrame(tick)
  })

  return () => cancelAnimationFrame(id)
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

const ARROW_KEYS = new Map<string, NavigationDirection>([
  ['ArrowUp', 'up'],
  ['ArrowDown', 'down'],
  ['ArrowLeft', 'left'],
  ['ArrowRight', 'right'],
])

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
