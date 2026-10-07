import { layout, type Group, type PlanBox, type PlanObject, type PlanPoint, type SeatPlan, type Shape } from 'ichno'

// Demo documents for the landing page and the playground — plain SeatPlan JSON, exactly what an app would store.
// ichno stores primitives only: places, fixtures and group labels. Rows, tables and desks are this site's words
// (`role`), laid out here with ichno's `layout` helpers. Sections run on 46-unit cell edges.

// Section ids are short on purpose: places added later continue the section's numbering (S17, H1, …).
export type VenueSection = 'H' | 'L' | 'S'

export const venueSectionIds = ['H', 'L', 'S'] as const

export const venueSectionNames: Record<VenueSection, string> = {
  H: 'Main hall',
  L: 'Lounge',
  S: 'Studio',
}

export const fixtureNames: Record<string, string> = {
  stage: 'Stage',
  bar: 'Bar',
  screen: 'Screen',
  wall: 'Wall',
  door: 'Door',
  pillar: 'Pillar',
}

type Built<S extends string> = { groups: Group[]; objects: PlanObject<S>[] }

const ROW_LETTERS = 'ABCDEFG'

// A labelled row of seats between two points — a group, one place per seat and the row's name at both ends. Seats
// are 40-unit circles unless `size` and `shape` say otherwise.
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
  const { size = 40, shape = 'ellipse' } = options
  const boxes = layout.arc({ ...options, count: options.seats.length, size })
  const ends = [
    { x: options.start.x - 46, y: options.start.y },
    { x: options.end.x + 46, y: options.end.y },
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
  const top = { x: center.x - 46, y: center.y - 46, w: 92, h: 92 }
  const seats = layout.around({ table: top, shape: 'ellipse', count: options.seats ?? 6, size: 36 })
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

// A desk in a 2×2-cell spot: the top is the place, the chair a fixture on the side people sit.
export function desk<S extends string>(
  id: string,
  section: S,
  origin: PlanPoint,
  chair: 'up' | 'down',
  extra: { label?: string; category?: string } = {},
): Built<S> {
  const group = `${id}-desk`
  const top: PlanBox = { x: origin.x, y: chair === 'up' ? origin.y + 28 : origin.y, w: 88, h: 60 }
  const seat: PlanBox = { x: origin.x + 25, y: chair === 'up' ? origin.y + 4 : origin.y + 66, w: 38, h: 18 }
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
    const y = 322 + 92 * i
    const half = 230 + 23 * i
    const count = 10 + i
    return row<VenueSection>({
      id: `row-${letter}`,
      label: letter,
      section: 'H',
      start: { x: 506 - half, y },
      end: { x: 506 + half, y },
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
      desk<VenueSection>(`S${r * 4 + c + 1}`, 'S', { x: cellX * 46 + 2, y: cellY * 46 + 2 }, side, {
        category: 'standard',
      }),
    ),
  )
}

// One document from its pieces, in drawing order.
function assemble<S extends string>(
  base: Omit<SeatPlan<S>, 'version' | 'groups' | 'objects'>,
  pieces: (Built<S> | PlanObject<S>)[],
): SeatPlan<S> {
  const built = pieces.map((piece) => ('kind' in piece ? { groups: [], objects: [piece] } : piece))
  return {
    version: 3,
    ...base,
    groups: built.flatMap((piece) => piece.groups),
    objects: built.flatMap((piece) => piece.objects),
  }
}

export const venuePlan: SeatPlan<VenueSection> = assemble(
  {
    width: 1840,
    height: 1104,
    sections: [
      { id: 'H', points: rect(0, 0, 1012, 1104) },
      { id: 'L', points: rect(1104, 0, 736, 460) },
      { id: 'S', points: rect(1104, 552, 736, 552) },
    ],
    categories: [{ key: 'premium' }, { key: 'standard' }, { key: 'access', accessible: true }],
  },
  [
    { kind: 'fixture', id: 'stage', shape: 'rect', role: 'stage', x: 299, y: 69, w: 414, h: 115 },
    ...hallRows(),
    {
      kind: 'place',
      id: 'GA',
      section: 'H',
      role: 'area',
      shape: 'rect',
      x: 253,
      y: 989,
      w: 506,
      h: 69,
      capacity: 60,
      category: 'standard',
    },
    roundTable(1, 'L', { x: 1242, y: 184 }, { category: 'premium' }),
    roundTable(2, 'L', { x: 1472, y: 184 }, { category: 'premium' }),
    roundTable(3, 'L', { x: 1702, y: 184 }, { category: 'premium', whole: true }),
    { kind: 'fixture', id: 'bar', shape: 'rect', role: 'bar', x: 1173, y: 345, w: 598, h: 69 },
    ...studioDesks(),
    ...[
      { id: 'BT1', y: 598, h: 138 },
      { id: 'BT2', y: 782, h: 138 },
      { id: 'BT3', y: 966, h: 92 },
    ].map(({ id, y, h }, i): PlanObject<VenueSection> => ({
      kind: 'place',
      id,
      section: 'S',
      label: `Booth ${i + 1}`,
      role: 'booth',
      category: 'premium',
      shape: 'rect',
      capacity: 1,
      x: 1587,
      y,
      w: 184,
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
  { width: 1196, height: 690, sections: [{ id: 'R', points: rect(0, 0, 1196, 690) }], categories: [] },
  [
    { kind: 'fixture', id: 'screen', shape: 'rect', role: 'screen', x: 368, y: 46, w: 460, h: 46 },
    row<RoomSection>({
      id: 'row-1',
      label: 'A',
      section: 'R',
      start: { x: 368, y: 207 },
      end: { x: 828, y: 207 },
      curve: -0.1,
      seats: Array.from({ length: 9 }, (_, n) => ({ id: `R${n + 1}`, label: String(n + 1) })),
    }),
    desk<RoomSection>('R10', 'R', { x: 94, y: 416 }, 'up', { label: 'D1' }),
    desk<RoomSection>('R11', 'R', { x: 186, y: 416 }, 'up', { label: 'D2' }),
    roundTable<RoomSection>(1, 'R', { x: 920, y: 483 }, { seats: 5 }),
  ],
)

type HallSection = 'H'

// The playground's first document: a stage, six straight rows of fourteen facing it, a round table for six on
// either side and a bar at the back. Every place is standard, so nothing is tinted until a category is assigned.
export const hallPlan: SeatPlan<HallSection> = assemble<HallSection>(
  {
    width: 1400,
    height: 1000,
    sections: [{ id: 'H', points: rect(0, 0, 1400, 1000) }],
    categories: [{ key: 'premium' }, { key: 'standard' }, { key: 'access', accessible: true }],
  },
  [
    { kind: 'fixture', id: 'stage', shape: 'rect', role: 'stage', x: 450, y: 40, w: 500, h: 140 },
    ...[...ROW_LETTERS.slice(0, 6)].map((letter, i) =>
      row<HallSection>({
        id: `row-${letter}`,
        label: letter,
        section: 'H',
        start: { x: 349, y: 278 + 66 * i },
        end: { x: 1051, y: 278 + 66 * i },
        curve: 0,
        size: 36,
        shape: 'rect',
        seats: Array.from({ length: 14 }, (_, n) => ({
          id: `${letter}${n + 1}`,
          label: String(n + 1),
          category: 'standard',
        })),
      }),
    ),
    roundTable(1, 'H', { x: 190, y: 820 }, { category: 'standard' }),
    roundTable(2, 'H', { x: 1210, y: 820 }, { category: 'standard' }),
    { kind: 'fixture', id: 'bar', shape: 'rect', role: 'bar', x: 540, y: 900, w: 320, h: 50 },
  ],
)

export const blankPlan: SeatPlan<'A'> = {
  version: 3,
  width: 1380,
  height: 828,
  sections: [{ id: 'A', points: rect(0, 0, 1380, 828) }],
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
