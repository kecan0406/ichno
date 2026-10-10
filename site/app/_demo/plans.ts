import { layout, type Group, type PlanBox, type PlanObject, type PlanPoint, type SeatPlan, type Shape } from 'ichno'

// Demo documents for the landing page and the playground — plain SeatPlan JSON, exactly what an app would store.
// ichno stores primitives only: places, fixtures, group labels and walls. Rows, tables and desks are this site's words
// (`role`), laid out here with ichno's `layout` helpers. A unit is a centimetre; sections and walls run on the 50-unit
// (half-metre) cell edges.

// Section ids are short on purpose: places added later continue the section's numbering (S17, H1, …).
export type VenueSection = 'H' | 'L' | 'S'

export const venueSectionIds = ['H', 'L', 'S'] as const

export const venueSectionNames: Record<VenueSection, string> = {
  H: 'Main hall',
  L: 'Lounge',
  S: 'Studio',
}

export const fixtureNames = new Map<string, string>([
  ['stage', 'Stage'],
  ['bar', 'Bar'],
  ['screen', 'Screen'],
  ['wall', 'Wall'],
  ['door', 'Door'],
  ['pillar', 'Pillar'],
])

type Built<S extends string> = { groups: Group[]; objects: PlanObject<S>[] }

const ROW_LETTERS = 'ABCDEFG'

// A labelled row of seats between two points — a group, one place per seat and the row's name at both ends. Seats
// are 45 cm circles unless `size` and `shape` say otherwise.
export function row<S extends string>(options: {
  id: string
  label: string
  section: S
  start: PlanPoint
  end: PlanPoint
  curve: number
  size?: number
  shape?: Shape
  seats: { id: string; label?: string; category?: string }[]
}): Built<S> {
  const { size = 45, shape = 'ellipse' } = options
  const boxes = layout.arc({ ...options, count: options.seats.length, size })

  const ends = [
    { x: options.start.x - 50, y: options.start.y },
    { x: options.end.x + 50, y: options.end.y },
  ]

  return {
    groups: [{ id: options.id, label: options.label, role: 'row' }],
    objects: [
      ...options.seats.map((seat, i): PlanObject<S> => ({
        kind: 'place',
        ...seat,
        section: options.section,
        ...boxes[i]!,
        shape,
        capacity: 1,
        group: options.id,
        role: 'seat',
      })),
      ...ends.map((point, i): PlanObject<S> => ({
        kind: 'label',
        id: `${options.id}-l${i + 1}`,
        group: options.id,
        x: point.x - 20,
        y: point.y - 20,
        w: 40,
        h: 40,
      })),
    ],
  }
}

// A round table for six. Booked seat by seat, the top is a fixture and the seats are places; booked whole, the top
// is the place and the seats are chairs.
function roundTable<S extends string>(
  n: number,
  section: S,
  center: PlanPoint,
  options: { seats?: number; category?: string; whole?: boolean } = {},
): Built<S> {
  const group = `table-${n}`
  const id = `T${n}`
  const top = { x: center.x - 60, y: center.y - 60, w: 120, h: 120 }
  const seats = layout.around({ table: top, shape: 'ellipse', count: options.seats ?? 6, size: 45 })
  const category = options.category === undefined ? {} : { category: options.category }

  if (options.whole) {
    return {
      groups: [{ id: group, role: 'table' }],
      objects: [
        ...seats.map((box, k): PlanObject<S> => ({
          kind: 'fixture',
          id: `${id}-${k + 1}`,
          ...box,
          shape: 'ellipse',
          group,
          role: 'chair',
        })),
        {
          kind: 'place',
          id,
          section,
          ...top,
          shape: 'ellipse',
          capacity: seats.length,
          group,
          role: 'table',
          ...category,
        },
      ],
    }
  }

  return {
    groups: [{ id: group, label: id, role: 'table' }],
    objects: [
      { kind: 'fixture', id, ...top, shape: 'ellipse', group, role: 'table' },
      ...seats.map((box, k): PlanObject<S> => ({
        kind: 'place',
        id: `${id}-${k + 1}`,
        label: String(k + 1),
        section,
        ...box,
        shape: 'ellipse',
        capacity: 1,
        group,
        role: 'seat',
        ...category,
      })),
    ],
  }
}

// A desk in a 2×2-cell spot, a metre square from `origin`: the top is the place, the chair a fixture on the side
// people sit.
export function desk<S extends string>(
  id: string,
  section: S,
  origin: PlanPoint,
  chair: 'up' | 'down',
  extra: { label?: string; category?: string } = {},
): Built<S> {
  const group = `${id}-desk`
  const top: PlanBox = { x: origin.x + 2, y: chair === 'up' ? origin.y + 43 : origin.y + 2, w: 96, h: 55 }
  const seat: PlanBox = { x: origin.x + 28, y: chair === 'up' ? origin.y + 2 : origin.y + 58, w: 44, h: 40 }

  return {
    groups: [{ id: group, role: 'desk' }],
    objects: [
      { kind: 'place', id, section, ...top, shape: 'rect', capacity: 1, group, role: 'desk', ...extra },
      { kind: 'fixture', id: `${id}-chair`, ...seat, shape: 'rect', group, role: 'chair' },
    ],
  }
}

// Seven rows bowing away from the stage, one seat longer each.
function hallRows(): Built<VenueSection>[] {
  return [...ROW_LETTERS].map((letter, i) => {
    const y = 350 + 100 * i
    const half = 250 + 25 * i
    const count = 10 + i

    return row<VenueSection>({
      id: `row-${letter}`,
      label: letter,
      section: 'H',
      start: { x: 550 - half, y },
      end: { x: 550 + half, y },
      curve: -0.12,
      seats: Array.from({ length: count }, (_, n) => ({
        id: `${letter}${n + 1}`,
        label: String(n + 1),
        category: i < 2 ? 'premium' : i === 6 && (n < 2 || n >= count - 2) ? 'access' : 'standard',
      })),
    })
  })
}

// Two back-to-back pairs of desk rows.
function studioDesks(): Built<VenueSection>[] {
  const rows: [number, 'up' | 'down'][] = [
    [13, 'up'],
    [15, 'down'],
    [18, 'up'],
    [20, 'down'],
  ]

  return rows.flatMap(([cellY, side], r) =>
    [25, 27, 29, 31].map((cellX, c) =>
      desk<VenueSection>(`S${r * 4 + c + 1}`, 'S', { x: cellX * 50, y: cellY * 50 }, side, {
        category: 'standard',
      }),
    ),
  )
}

// One document from its pieces, in drawing order.
function assemble<S extends string>(
  base: Omit<SeatPlan<S>, 'version' | 'groups' | 'objects' | 'walls'> & Partial<Pick<SeatPlan<S>, 'walls'>>,
  pieces: (Built<S> | PlanObject<S>)[],
): SeatPlan<S> {
  const built = pieces.map((piece) => ('kind' in piece ? { groups: [], objects: [piece] } : piece))

  return {
    version: 3,
    walls: [],
    ...base,
    groups: built.flatMap((piece) => piece.groups),
    objects: built.flatMap((piece) => piece.objects),
  }
}

export const venuePlan: SeatPlan<VenueSection> = assemble(
  {
    width: 2000,
    height: 1200,
    sections: [
      { id: 'H', points: rect(0, 0, 1100, 1200) },
      { id: 'L', points: rect(1200, 0, 800, 500) },
      { id: 'S', points: rect(1200, 600, 800, 600) },
    ],
    categories: [{ key: 'premium' }, { key: 'standard' }, { key: 'access', accessible: true }],
  },
  [
    { kind: 'fixture', id: 'stage', shape: 'rect', role: 'stage', x: 325, y: 75, w: 450, h: 125 },
    ...hallRows(),
    {
      kind: 'place',
      id: 'GA',
      section: 'H',
      role: 'area',
      shape: 'rect',
      x: 275,
      y: 1050,
      w: 550,
      h: 100,
      capacity: 11,
      category: 'standard',
    },
    roundTable(1, 'L', { x: 1325, y: 200 }, { category: 'premium' }),
    roundTable(2, 'L', { x: 1600, y: 200 }, { category: 'premium' }),
    roundTable(3, 'L', { x: 1875, y: 200 }, { category: 'premium', whole: true }),
    { kind: 'fixture', id: 'bar', shape: 'rect', role: 'bar', x: 1275, y: 375, w: 650, h: 75 },
    ...studioDesks(),
    ...[
      { id: 'BT1', y: 650, h: 150 },
      { id: 'BT2', y: 850, h: 150 },
      { id: 'BT3', y: 1050, h: 100 },
    ].map(({ id, y, h }, i): PlanObject<VenueSection> => ({
      kind: 'place',
      id,
      section: 'S',
      label: `Booth ${i + 1}`,
      role: 'booth',
      category: 'premium',
      shape: 'rect',
      capacity: 1,
      x: 1725,
      y,
      w: 200,
      h,
    })),
  ],
)

// Status lives outside the document — here, what another booking system would report.
export const venueStatus: Record<string, string> = Object.fromEntries(
  ['A4', 'A5', 'A6', 'B8', 'C2', 'C3', 'D9', 'D10', 'D11', 'E5', 'F12', 'T2-1', 'T2-2', 'T2-3', 'S3', 'S6', 'BT2'].map(
    (id) => [id, 'taken'],
  ),
)

type RoomSection = 'R'

export const roomPlan: SeatPlan<RoomSection> = assemble<RoomSection>(
  { width: 1300, height: 750, sections: [{ id: 'R', points: rect(0, 0, 1300, 750) }], categories: [] },
  [
    { kind: 'fixture', id: 'screen', shape: 'rect', role: 'screen', x: 400, y: 50, w: 500, h: 20 },
    row<RoomSection>({
      id: 'row-1',
      label: 'A',
      section: 'R',
      start: { x: 450, y: 225 },
      end: { x: 850, y: 225 },
      curve: -0.1,
      seats: Array.from({ length: 9 }, (_, n) => ({ id: `R${n + 1}`, label: String(n + 1) })),
    }),
    desk<RoomSection>('R10', 'R', { x: 100, y: 450 }, 'up', { label: 'D1' }),
    desk<RoomSection>('R11', 'R', { x: 200, y: 450 }, 'up', { label: 'D2' }),
    roundTable<RoomSection>(1, 'R', { x: 1000, y: 525 }, { seats: 5 }),
  ],
)

type HallSection = 'H'

// The playground's first document: an 18 × 13 m hall walled round with a door at the back, a stage, six straight rows
// of fourteen facing it (45 cm seats, 50 cm apart, rows 90 cm apart), a round table for six on either side and a bar
// against the back wall. Its one section is the whole plan — the playground never shows it. Every place is standard,
// so nothing is tinted until a category is assigned.
export const hallPlan: SeatPlan<HallSection> = assemble<HallSection>(
  {
    width: 1800,
    height: 1300,
    sections: [{ id: 'H', points: rect(0, 0, 1800, 1300) }],
    walls: [
      {
        id: 'hall',
        points: rect(0, 0, 1800, 1300),
        thickness: 15,
        closed: true,
        openings: [{ edge: 2, at: 360, width: 90, role: 'door' }],
      },
    ],
    categories: [{ key: 'premium' }, { key: 'standard' }, { key: 'access', accessible: true }],
  },
  [
    { kind: 'fixture', id: 'stage', shape: 'rect', role: 'stage', x: 600, y: 50, w: 600, h: 300 },
    ...Array.from(ROW_LETTERS.slice(0, 6)).map((letter, i) =>
      row<HallSection>({
        id: `row-${letter}`,
        label: letter,
        section: 'H',
        start: { x: 575, y: 500 + 90 * i },
        end: { x: 1225, y: 500 + 90 * i },
        curve: 0,
        size: 45,
        shape: 'rect',
        seats: Array.from({ length: 14 }, (_, n) => ({
          id: `${letter}${n + 1}`,
          label: String(n + 1),
          category: 'standard',
        })),
      }),
    ),
    roundTable(1, 'H', { x: 250, y: 700 }, { category: 'standard' }),
    roundTable(2, 'H', { x: 1550, y: 700 }, { category: 'standard' }),
    { kind: 'fixture', id: 'bar', shape: 'rect', role: 'bar', x: 700, y: 1230, w: 400, h: 60 },
  ],
)

// The playground's empty document: nothing on it yet — walls are built first, and places go anywhere on the plan.
// Its one section is the whole plan, which the playground never shows. The categories are listed because the
// playground has no way to add one.
export const emptyPlan: SeatPlan<string> = {
  version: 3,
  width: 2000,
  height: 1200,
  sections: [{ id: 'P', points: rect(0, 0, 2000, 1200) }],
  walls: [],
  categories: [{ key: 'premium' }, { key: 'standard' }, { key: 'access', accessible: true }],
  groups: [],
  objects: [],
}

function rect(x: number, y: number, w: number, h: number): PlanPoint[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}
