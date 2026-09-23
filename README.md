# ichno

Seat floor plans for React — one JSON document, drawn two ways.

- **`ichno`** — zod-free core: document types, grid snapping, geometry (desk/chair layout, zone crops), view math
- **`ichno/schema`** — `createSeatPlanSchema({ zoneIds })`: zod validation with structured issue codes
- **`ichno/svg`** — `SeatMapSvg`: a read-only plan that renders on the server
- **`ichno/konva`** — `SeatMapStage` (pan/zoom/pick viewer) and `SeatPlanEditorStage` (drag-to-arrange editor)
- **`ichno/editor`** — `useSeatPlanEditor`: headless editor state and operations; you build the panels

The library ships **no copy**. Zone names, fixture names and validation messages come from you.

```sh
pnpm add ichno zod                 # core + schema
pnpm add konva react-konva         # only for ichno/konva
```

Peer dependencies: `react ^19.2`, `zod ^4` (schema), `konva ^10` + `react-konva ^19` (canvases). Client components
are shipped already compiled with React Compiler.

## The document

```ts
type SeatPlan<Z extends string> = {
  width: number
  height: number
  zones: { id: Z; x: number; y: number; w: number; h: number }[] // rooms — composition fixed by you
  seats: {
    id: string
    zone: Z
    x: number
    y: number
    w: number
    h: number
    chairSide: 'up' | 'right' | 'down' | 'left'
  }[]
  fixtures: { id: string; kind: 'wall' | 'tv' | 'counter'; x: number; y: number; w: number; h: number }[]
}
```

Coordinates are integer plan units. Seats snap to a 46-unit cell grid (a standard seat is 2×2 cells = 88 units with
a 4-unit gap); fixtures snap to half cells. A seat's `id` is also its drawn label and the key your other records
(bookings, sessions) point at — keep it stable.

## Validate

```ts
import { createSeatPlanSchema, seatPlanIssueOf } from 'ichno/schema'

export const { SeatPlan } = createSeatPlanSchema({ zoneIds: ['A', 'B'] as const })

const result = SeatPlan.safeParse(input)
if (!result.success) {
  for (const issue of result.error.issues) {
    const planIssue = seatPlanIssueOf(issue) // null for ordinary zod issues (types, sizes)
    // { code: 'seat_overlap', seatIds: ['A1', 'A2'] } → your message
  }
}
```

Plan-level issue codes: `duplicate_zone`, `duplicate_seat_id`, `seat_out_of_bounds`, `seat_overlap`,
`duplicate_fixture_id`, `fixture_out_of_bounds`, `fixture_seat_overlap`.

## Draw

```tsx
import { SeatMapSvg } from 'ichno/svg'

;<SeatMapSvg
  plan={plan}
  occupiedSeatIds={['A1', 'B4']}
  zoneLabel={(zone, { free, total }) => ({ title: zone.id, detail: `${free} / ${total} free` })}
  fixtureLabel={(kind) => (kind === 'tv' ? 'TV' : kind === 'counter' ? 'Counter' : null)}
/>
```

```tsx
'use client'
import { SeatMapStage, type SeatMarker } from 'ichno/konva' // load without SSR (e.g. next/dynamic ssr:false)

const markers: Record<string, SeatMarker> = {
  A1: { kind: 'occupant', color: 'var(--brand)', text: 'Kim', warningDot: true, groupColor: 'var(--chart-2)' },
  A2: { kind: 'blocked' },
}

<SeatMapStage plan={plan} width={w} height={h} fitPadding={12} markers={markers}
  selectedSeatIds={picked} onSeatClick={(seat) => toggle(seat.id)} />
```

Pass `view` + `onViewChange` to enable panning, and `gestureZoom` for wheel/pinch zoom. `fitView`, `zoomView` and
`centerZoom` from `ichno` drive your own zoom buttons.

For narrow screens, `seatPlan.zonePlansOf(plan)` returns one crop per zone at a shared scale — stack them.

## Edit

```tsx
'use client'
import { useSeatPlanEditor, useSeatPlanEditorShortcuts } from 'ichno/editor'
import { SeatPlanEditorStage } from 'ichno/konva'

const editor = useSeatPlanEditor({ initialPlan })
useSeatPlanEditorShortcuts(editor) // Delete/Backspace removes, R turns the chair

<button onClick={() => editor.addSeat('A') ?? alert('No free 2×2 spot')}>Add seat</button>
<SeatPlanEditorStage {...editor.stageProps} width={w} height={h} view={view} onViewChange={setView} />
<button disabled={!editor.dirty} onClick={() => save(editor.plan)}>Save</button>
```

The hook exposes `plan`, `dirty`, `selection`, `selectedSeat/Zone/Fixture`, `addSeat`, `addFixture`, `update*`,
`remove*`, `renameSeat`, `rotateSeat` and `reset`. The plan is grid-normalized on open. To adopt a new baseline
after saving, remount the editor (key it by the saved version).

## Theme

Renderers read CSS custom properties; set them on `:root` (and again for dark mode). Unset ones fall back to neutral
defaults. The SVG paints with `var(...)` directly; the canvas resolves the same variables and re-reads them when
`class`, `style` or `data-theme` on `<html>`/`<body>` or the colour scheme changes. Marker colours accept any CSS
colour, including your own variables.

| Variable                    | Role                                                    |
| --------------------------- | ------------------------------------------------------- |
| `--ichno-surface`           | room floor, desks, empty chairs                         |
| `--ichno-fixture`           | TV/counter faces                                        |
| `--ichno-grid`              | editor grid                                             |
| `--ichno-label`             | furniture outlines, seat numbers, fixture names         |
| `--ichno-ink`               | walls, occupied chairs, unavailable seats, names, rings |
| `--ichno-ink-foreground`    | numbers on ink-filled seats                             |
| `--ichno-accent`            | picked seats, editor selection                          |
| `--ichno-accent-foreground` | numbers on accent-filled seats                          |
| `--ichno-warning`           | occupant warning dot                                    |
| `--ichno-occupied-tint`     | occupied desk tint opacity (number, default `0.15`)     |
| `--ichno-font`              | text font (inherits when unset)                         |
| `--ichno-number-font`       | seat number font (falls back to `--ichno-font`)         |

```css
:root {
  --ichno-surface: var(--card);
  --ichno-ink: var(--foreground);
  --ichno-accent: var(--primary);
}
.dark {
  --ichno-occupied-tint: 0.22;
}
```

## License

MIT
