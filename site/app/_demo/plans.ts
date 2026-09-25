import type { Desk, PlanObject, PlanPoint, SeatChairSide, SeatPlan } from 'ichno'

// Demo documents for the landing page and the playground — plain SeatPlan JSON, exactly what an app would store.
// Coordinates follow the grid rules: sections on 46-unit cell edges, desks 2 units inside their cells, fixtures on
// half cells.

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

const ROW_LETTERS = 'ABCDEFG'

// Seven rows bowing away from the stage, one seat longer each.
function hallRows(): PlanObject<VenueSection>[] {
  return [...ROW_LETTERS].map((letter, i) => {
    const y = 322 + 92 * i
    const half = 230 + 23 * i
    const count = 10 + i
    return {
      kind: 'row',
      id: `row-${letter}`,
      section: 'H',
      label: letter,
      start: { x: 506 - half, y },
      end: { x: 506 + half, y },
      curve: -0.12,
      seatSize: 40,
      seats: Array.from({ length: count }, (_, n) => ({
        id: `${letter}${n + 1}`,
        label: String(n + 1),
        category: i < 2 ? 'premium' : i === 6 && (n < 2 || n >= count - 2) ? 'access' : 'standard',
      })),
    }
  })
}

function roundTable(id: string, center: PlanPoint, wholeBooking = false): PlanObject<VenueSection> {
  return {
    kind: 'table',
    id,
    section: 'L',
    shape: 'round',
    x: center.x - 46,
    y: center.y - 46,
    w: 92,
    h: 92,
    seatSize: 36,
    category: 'premium',
    seats: Array.from({ length: 6 }, (_, n) => ({ id: `${id}-${n + 1}`, label: String(n + 1), category: 'premium' })),
    ...(wholeBooking ? { wholeBooking } : {}),
  }
}

function desk(id: string, cellX: number, cellY: number, chairSide: SeatChairSide): Desk<VenueSection> {
  return {
    kind: 'desk',
    id,
    section: 'S',
    category: 'standard',
    x: cellX * 46 + 2,
    y: cellY * 46 + 2,
    w: 88,
    h: 88,
    chairSide,
  }
}

// Two back-to-back pairs of desk rows.
function studioDesks(): PlanObject<VenueSection>[] {
  const rows: [number, SeatChairSide][] = [
    [13, 'up'],
    [15, 'down'],
    [18, 'up'],
    [20, 'down'],
  ]
  return rows.flatMap(([cellY, side], r) =>
    [25, 27, 29, 31].map((cellX, c) => desk(`S${r * 4 + c + 1}`, cellX, cellY, side)),
  )
}

export const venuePlan: SeatPlan<VenueSection> = {
  version: 2,
  width: 1840,
  height: 1104,
  sections: [
    { id: 'H', points: rect(0, 0, 1012, 1104) },
    { id: 'L', points: rect(1104, 0, 736, 460) },
    { id: 'S', points: rect(1104, 552, 736, 552) },
  ],
  categories: [{ key: 'premium' }, { key: 'standard' }, { key: 'access', accessible: true }],
  objects: [
    { kind: 'fixture', id: 'stage', role: 'stage', x: 299, y: 69, w: 414, h: 115 },
    ...hallRows(),
    {
      kind: 'area',
      id: 'GA',
      section: 'H',
      shape: 'rect',
      x: 253,
      y: 989,
      w: 506,
      h: 69,
      capacity: 60,
      category: 'standard',
    },
    roundTable('T1', { x: 1242, y: 184 }),
    roundTable('T2', { x: 1472, y: 184 }),
    roundTable('T3', { x: 1702, y: 184 }, true),
    { kind: 'fixture', id: 'bar', role: 'bar', x: 1173, y: 345, w: 598, h: 69 },
    ...studioDesks(),
    {
      kind: 'booth',
      id: 'BT1',
      section: 'S',
      label: 'Booth 1',
      category: 'premium',
      x: 1587,
      y: 598,
      w: 184,
      h: 138,
    },
    {
      kind: 'booth',
      id: 'BT2',
      section: 'S',
      label: 'Booth 2',
      category: 'premium',
      x: 1587,
      y: 782,
      w: 184,
      h: 138,
    },
    {
      kind: 'booth',
      id: 'BT3',
      section: 'S',
      label: 'Booth 3',
      category: 'premium',
      x: 1587,
      y: 966,
      w: 184,
      h: 92,
    },
  ],
}

// Status lives outside the document — here, what another booking system would report.
export const venueStatus: Record<string, string> = Object.fromEntries(
  ['A4', 'A5', 'A6', 'B8', 'C2', 'C3', 'D9', 'D10', 'D11', 'E5', 'F12', 'T2-1', 'T2-2', 'T2-3', 'S3', 'S6', 'BT2'].map(
    (id) => [id, 'taken'],
  ),
)

type RoomSection = 'R'

export const roomPlan: SeatPlan<RoomSection> = {
  version: 2,
  width: 1196,
  height: 690,
  sections: [{ id: 'R', points: rect(0, 0, 1196, 690) }],
  categories: [],
  objects: [
    { kind: 'fixture', id: 'screen', role: 'screen', x: 368, y: 46, w: 460, h: 46 },
    {
      kind: 'row',
      id: 'row-1',
      section: 'R',
      label: 'A',
      start: { x: 368, y: 207 },
      end: { x: 828, y: 207 },
      curve: -0.1,
      seatSize: 40,
      seats: Array.from({ length: 9 }, (_, n) => ({ id: `R${n + 1}`, label: String(n + 1) })),
    },
    { kind: 'desk', id: 'R10', label: 'D1', section: 'R', x: 94, y: 416, w: 88, h: 88, chairSide: 'up' },
    { kind: 'desk', id: 'R11', label: 'D2', section: 'R', x: 186, y: 416, w: 88, h: 88, chairSide: 'up' },
    {
      kind: 'table',
      id: 'T1',
      section: 'R',
      shape: 'round',
      x: 874,
      y: 437,
      w: 92,
      h: 92,
      seatSize: 36,
      seats: Array.from({ length: 5 }, (_, n) => ({ id: `T1-${n + 1}`, label: String(n + 1) })),
    },
  ],
}

export const blankPlan: SeatPlan<'A'> = {
  version: 2,
  width: 1380,
  height: 828,
  sections: [{ id: 'A', points: rect(0, 0, 1380, 828) }],
  categories: [{ key: 'premium' }, { key: 'standard' }, { key: 'access', accessible: true }],
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
