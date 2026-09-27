import { describe, expect, it } from 'vitest'
import { seatPlan } from '../core/geometry'
import { labeling } from '../core/labeling'
import { layout } from '../core/layout'
import type { Place, PlanObject, PlanTemplate, SeatPlan } from '../core/types'
import { planEdits } from './operations'

type S = 'A' | 'B'

function planOf(objects: PlanObject<S>[] = [], groups: SeatPlan<S>['groups'] = []): SeatPlan<S> {
  return {
    version: 3,
    width: 1012,
    height: 828,
    sections: [
      { id: 'A', points: rect(0, 0, 506, 828) },
      { id: 'B', points: rect(506, 0, 506, 828) },
    ],
    categories: [],
    groups,
    objects,
  }
}

function rect(x: number, y: number, w: number, h: number) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

function desk(id: string, x: number, y: number, extra: Partial<Place<S>> = {}): Place<S> {
  return { kind: 'place', id, section: 'A', x, y, w: 88, h: 88, shape: 'rect', capacity: 1, ...extra }
}

// A four-seat row in group `row-1`, seats A1–A4 from x 46 to 460.
function withRow(base: SeatPlan<S> = planOf()) {
  const { plan: grouped, id } = planEdits.addGroup(base, { role: 'row' })
  const boxes = layout.line({ start: { x: 46, y: 400 }, end: { x: 460, y: 400 }, count: 4, size: 40 })
  return { plan: planEdits.addPlaces(grouped, 'A', boxes, { group: id })!.plan, id }
}

const idsOf = (plan: SeatPlan<S>) => plan.objects.map((o) => o.id)
const xs = (plan: SeatPlan<S>) => plan.objects.map((o) => o.x)

describe('labeling', () => {
  it('numbers from a start, with a step and in reverse', () => {
    const labels = (seq: (i: number, n: number) => string, n: number) => Array.from({ length: n }, (_, i) => seq(i, n))
    expect(labels(labeling.numbers(), 3)).toEqual(['1', '2', '3'])
    expect(labels(labeling.numbers({ start: 1, step: 2 }), 3)).toEqual(['1', '3', '5'])
    expect(labels(labeling.numbers({ reverse: true }), 3)).toEqual(['3', '2', '1'])
  })

  it('letters skip the ones asked for and continue past Z like spreadsheet columns', () => {
    const letter = labeling.letters({ skip: ['I'] })
    expect([letter(7, 30), letter(8, 30)]).toEqual(['H', 'J'])
    expect(labeling.letters()(25, 30)).toBe('Z')
    expect(labeling.letters()(26, 30)).toBe('AA')
    expect(labeling.letters({ prefix: 'Row ', lower: true })(0, 1)).toBe('Row a')
  })
})

describe('planEdits — creating', () => {
  it('continues the section numbering for new places, never reusing a number', () => {
    const { plan, id } = withRow(planOf([desk('A1', 2, 2), desk('A4', 94, 2)]))
    expect(id).toBe('row-1')
    expect(seatPlan.membersOf(plan, id).map((o) => o.id)).toEqual(['A5', 'A6', 'A7', 'A8'])
  })

  it('refuses places whose ids would pass the 8-character limit, and shortens fixture ids to fit', () => {
    const long = { ...planOf(), sections: [{ id: 'balcony' as S, points: rect(0, 0, 1012, 828) }] }
    const boxes = (n: number) => layout.line({ start: { x: 46, y: 400 }, end: { x: 900, y: 400 }, count: n, size: 40 })
    expect(planEdits.addPlaces(long, 'balcony' as S, boxes(9))).not.toBeNull()
    expect(planEdits.addPlaces(long, 'balcony' as S, boxes(10))).toBeNull()
    const [id] = planEdits.addFixtures(planOf(), [{ x: 0, y: 0, w: 46, h: 23 }], { role: 'emergency-exit1' }).ids
    expect(id!.length).toBeLessThanOrEqual(16)
  })

  it('draws new fixtures under everything and new places on top', () => {
    const plan = planEdits.addFixtures(planOf([desk('A1', 2, 2)]), [{ x: 0, y: 600, w: 400, h: 92 }], {
      role: 'stage',
    }).plan
    expect(idsOf(plan)).toEqual(['stage-1', 'A1'])
  })
})

describe('planEdits — laying a group out', () => {
  const { plan, id } = withRow()
  const line = (n: number, end = 460) =>
    layout.line({ start: { x: 46, y: 400 }, end: { x: end, y: 400 }, count: n, size: 40 })

  it('grows a row with new seats continuing the numbering, and shrinks it from the end', () => {
    const more = planEdits.layoutGroup(plan, id, line(6))!
    expect(seatPlan.membersOf(more, id).map((o) => o.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'])
    expect(seatPlan.conflictsOf(more)).toEqual([])
    const fewer = planEdits.layoutGroup(plan, id, line(2))!
    expect(seatPlan.membersOf(fewer, id).map((o) => o.id)).toEqual(['A1', 'A2'])
  })

  it('bends a row by moving its seats — ids, labels and order stay', () => {
    const labelled = planEdits.label(plan, ['A1', 'A2', 'A3', 'A4'], labeling.numbers())
    const bent = planEdits.layoutGroup(
      labelled,
      id,
      layout.arc({ start: { x: 66, y: 420 }, end: { x: 440, y: 420 }, curve: 0.4, count: 4, size: 40 }),
    )!
    const seats = seatPlan.membersOf(bent, id) as Place<S>[]
    expect(seats.map((s) => [s.id, s.label])).toEqual([
      ['A1', '1'],
      ['A2', '2'],
      ['A3', '3'],
      ['A4', '4'],
    ])
    expect(seats[1]!.y).toBeLessThan(seats[0]!.y)
  })

  it('refuses to drop a locked seat', () => {
    expect(planEdits.layoutGroup(plan, id, line(2), undefined, new Set(['A4']))).toBeNull()
    expect(planEdits.layoutGroup(plan, id, line(3), undefined, new Set(['A1']))).not.toBeNull()
  })
})

describe('planEdits — groups, removing and renaming', () => {
  it('refuses to remove what holds a locked id, removes the rest and drops groups left empty', () => {
    const { plan } = withRow(planOf([desk('D1', 600, 2), desk('D2', 700, 2)]))
    const labelled = planEdits.addLabels(plan, 'row-1', [{ x: 0, y: 380, w: 40, h: 40 }]).plan
    const kept = planEdits.remove(labelled, ['D1', 'row-1', 'D2'], new Set(['D2']))
    expect(kept.refused).toEqual(['D2'])
    expect(idsOf(kept.plan)).toEqual(['D2'])
    expect(kept.plan.groups).toEqual([])
    expect(planEdits.remove(labelled, ['row-1'], new Set(['A3'])).refused).toEqual(['row-1'])
  })

  it('renames a group and its members follow; refuses locked, taken and unsavable ids', () => {
    const { plan } = withRow(planOf([desk('D1', 600, 2)]))
    const renamed = planEdits.rename(plan, 'row-1', 'front')!
    expect(renamed.groups[0]!.id).toBe('front')
    expect(seatPlan.membersOf(renamed, 'front')).toHaveLength(4)
    expect(planEdits.rename(plan, 'D1', 'A9', new Set(['D1']))).toBeNull()
    expect(planEdits.rename(plan, 'D1', 'A2')).toBeNull()
    expect(planEdits.rename(plan, 'D1', 'row-1')).toBeNull()
    expect(planEdits.rename(plan, 'A1', 'toolong123')).toBeNull()
    expect(planEdits.rename(plan, 'row-1', 'a-longer-row-name')).toBeNull()
    expect(planEdits.rename(plan, 'D1', ' ')).toBeNull()
    expect(planEdits.rename(plan, 'nope', 'A9')).toBeNull()
  })

  it('groups objects, taking them out of their old group, and ungroups dropping the labels', () => {
    const { plan } = withRow(planOf([desk('D1', 600, 2)]))
    const regrouped = planEdits.group(plan, ['A1', 'A2', 'D1'], { role: 'block' })!
    expect(seatPlan.membersOf(regrouped.plan, regrouped.id).map((o) => o.id)).toEqual(['D1', 'A1', 'A2'])
    const labelled = planEdits.addLabels(plan, 'row-1', [{ x: 0, y: 380, w: 40, h: 40 }]).plan
    const loose = planEdits.ungroup(labelled, 'row-1')
    expect(loose.groups).toEqual([])
    expect(loose.objects.every((o) => o.kind === 'place' && o.group === undefined)).toBe(true)
  })

  it('makes a whole-booked table — the top becomes a place, the seats chairs — and refuses locked seats', () => {
    const table = planOf([
      { kind: 'fixture', id: 'T1', shape: 'ellipse', x: 200, y: 200, w: 92, h: 92, group: 'g', role: 'table' },
      desk('A1', 200, 120, { w: 36, h: 36, group: 'g' }),
    ])
    const whole = planEdits.convert(planEdits.convert(table, ['A1'], 'fixture', { role: 'chair' })!, ['T1'], 'place', {
      capacity: 1,
    })!
    expect(whole.objects.map((o) => [o.kind, o.id, o.kind === 'label' ? undefined : o.role])).toEqual([
      ['place', 'T1', 'table'],
      ['fixture', 'A1', 'chair'],
    ])
    expect(seatPlan.objectById(whole, 'T1')).toMatchObject({ section: 'A', capacity: 1 })
    expect(planEdits.convert(table, ['A1'], 'fixture', {}, new Set(['A1']))).toBeNull()
  })

  it('labels places and groups in the order given', () => {
    const { plan } = withRow(planOf([desk('D1', 600, 2)]))
    const named = planEdits.label(plan, ['A4', 'A3', 'row-1'], labeling.letters())
    expect((seatPlan.objectById(named, 'A4') as Place<S>).label).toBe('A')
    expect((seatPlan.objectById(named, 'A3') as Place<S>).label).toBe('B')
    expect(named.groups[0]!.label).toBe('C')
  })
})

describe('planEdits — arranging', () => {
  const plan = planOf([desk('A1', 2, 2), desk('A2', 186, 94), desk('A3', 370, 186)])
  const ys = (p: SeatPlan<S>) => p.objects.map((o) => o.y)

  it('aligns on an edge and spaces centres evenly', () => {
    expect(ys(planEdits.align(plan, ['A1', 'A2', 'A3'], 'top'))).toEqual([2, 2, 2])
    expect(xs(planEdits.align(plan, ['A1', 'A2', 'A3'], 'right'))).toEqual([370, 370, 370])
    const uneven = planOf([desk('A1', 2, 2), desk('A2', 94, 2), desk('A3', 370, 2)])
    expect(xs(planEdits.distribute(uneven, ['A1', 'A2', 'A3'], 'x'))).toEqual([2, 186, 370])
  })

  it('aligns a group as one — its seats keep their spacing', () => {
    const { plan: rowed } = withRow(planOf([desk('D1', 600, 200)]))
    const aligned = planEdits.align(rowed, ['D1', 'row-1'], 'top')
    const seats = seatPlan.membersOf(aligned, 'row-1')
    expect(seats.map((s) => s.y)).toEqual([200, 200, 200, 200])
    expect(seats.map((s) => s.x)).toEqual(seatPlan.membersOf(rowed, 'row-1').map((s) => s.x))
  })

  it('duplicates objects with fresh ids next to the original, and groups as a new group', () => {
    const copied = planEdits.duplicate(plan, ['A1'])
    expect(copied.ids).toEqual(['A4'])
    expect(seatPlan.objectById(copied.plan, 'A4')).toMatchObject({ x: 94, y: 94 })
    const { plan: rowed } = withRow()
    const copy = planEdits.duplicate(rowed, ['row-1'], { x: 0, y: 92 })
    expect(copy.ids).toEqual(['row-2'])
    expect(seatPlan.membersOf(copy.plan, 'row-2').map((o) => o.id)).toEqual(['A5', 'A6', 'A7', 'A8'])
  })

  it('keeps a constrained (Shift) move to the axis it went furthest along', () => {
    const drag = { target: { kind: 'place' as const, id: 'A1' }, phase: 'end' as const, total: { x: 92, y: 30 } }
    expect(seatPlan.objectById(planEdits.applyDrag(plan, { ...drag, constrain: true }), 'A1')).toMatchObject({
      x: 94,
      y: 2,
    })
  })

  it('moves the whole selection when a selected object is dragged, the object (or its group) otherwise', () => {
    const drag = { target: { kind: 'place' as const, id: 'A1' }, phase: 'end' as const, total: { x: 92, y: 0 } }
    expect(xs(planEdits.applyDrag(plan, drag, ['A1', 'A2']))).toEqual([94, 278, 370])
    expect(xs(planEdits.applyDrag(plan, drag, ['A3']))).toEqual([94, 186, 370])
    const { plan: rowed } = withRow()
    const seatDrag = { ...drag, target: { kind: 'place' as const, id: 'A2' } }
    expect(xs(planEdits.applyDrag(rowed, seatDrag, []))).toEqual(xs(rowed).map((x) => x + 92))
  })

  it('snaps a lone object to the half-cell grid and a group by whole half cells', () => {
    const snap = { cell: 46 }
    expect(planEdits.move(plan, ['A1'], { x: 30, y: 5 }, snap).objects[0]).toMatchObject({ x: 23, y: 0 })
    const { plan: rowed } = withRow()
    const moved = planEdits.move(rowed, ['row-1'], { x: 30, y: 10 }, snap)
    expect(xs(moved)).toEqual(xs(rowed).map((x) => x + 23))
  })

  it('keeps what moves inside the plan, and re-homes places to the section they land in', () => {
    const moved = planEdits.move(plan, ['A3'], { x: 900, y: 0 })
    const bounds = seatPlan.boundsOf(seatPlan.objectById(moved, 'A3')!)
    expect(bounds.x + bounds.w).toBeLessThanOrEqual(moved.width)
    expect(seatPlan.objectById(moved, 'A3')).toMatchObject({ section: 'B' })
  })

  it('turns an object about its centre and a group about the centre of its frame', () => {
    expect(planEdits.rotate(plan, ['A1'], 90).objects[0]).toMatchObject({ x: 2, y: 2, rotation: 90 })
    const { plan: rowed } = withRow()
    const turned = planEdits.rotate(rowed, ['row-1'], 90)
    const seats = seatPlan.membersOf(turned, 'row-1')
    // The row stood level; a quarter turn stands it upright on the same centre, and the group faces 90°.
    expect(new Set(seats.map((s) => s.x)).size).toBe(1)
    expect(seats.every((s) => s.rotation === 90)).toBe(true)
    expect(turned.groups[0]!.rotation).toBe(90)
    const extent = (p: SeatPlan<S>) => seatPlan.extentOf(seatPlan.membersOf(p, 'row-1'))!
    expect(extent(turned).x + extent(turned).w / 2).toBeCloseTo(extent(rowed).x + extent(rowed).w / 2, 0)
    expect(planEdits.rotate(rowed, ['row-1'], -90).objects.every((o) => o.rotation === 270)).toBe(true)
  })

  it('brings a curved group back where it was after turning it all the way round in quarters', () => {
    const { plan: grouped, id } = planEdits.addGroup(planOf(), { role: 'row' })
    const boxes = layout.arc({ start: { x: 100, y: 400 }, end: { x: 460, y: 400 }, curve: 0.5, count: 7, size: 40 })
    const rowed = planEdits.addPlaces(grouped, 'A', boxes, { group: id })!.plan
    let turned = rowed
    for (let i = 0; i < 4; i++) turned = planEdits.rotate(turned, [id], 90)
    turned.objects.forEach((o, i) => {
      expect(Math.abs(o.x - rowed.objects[i]!.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(o.y - rowed.objects[i]!.y)).toBeLessThanOrEqual(1)
    })
    expect(turned.groups[0]!.rotation).toBeUndefined()
  })

  it('turns several items together about the middle of their centres', () => {
    const swapped = planEdits.rotate(plan, ['A1', 'A3'], 180)
    // A1 and A3 sit symmetrically about their middle — half a turn swaps their places.
    expect(seatPlan.objectById(swapped, 'A1')).toMatchObject({ x: 370, y: 186, rotation: 180 })
    expect(seatPlan.objectById(swapped, 'A3')).toMatchObject({ x: 2, y: 2, rotation: 180 })
    expect(seatPlan.objectById(swapped, 'A2')).toMatchObject({ x: 186, y: 94 })
  })
})

describe('planEdits — drawing order', () => {
  // Bottom to top: a table's top, a stage, A1, the table's seats B1 and B2, A2. Listed by their highest member, top
  // first: A2, the table, A1, the stage.
  const fixture = (id: string, group?: string): PlanObject<S> => ({
    kind: 'fixture',
    id,
    shape: 'rect',
    x: 600,
    y: 600,
    w: 92,
    h: 92,
    ...(group ? { group } : {}),
  })
  const plan = planOf(
    [
      fixture('top', 'table-1'),
      fixture('stage'),
      desk('A1', 2, 2),
      desk('B1', 600, 2, { section: 'B', group: 'table-1' }),
      desk('B2', 600, 94, { section: 'B', group: 'table-1' }),
      desk('A2', 94, 2),
    ],
    [{ id: 'table-1', role: 'table' }],
  )

  it('moves a group to the front or back as one, keeping the order of what moves', () => {
    expect(idsOf(planEdits.reorder(plan, ['table-1'], 'front'))).toEqual(['stage', 'A1', 'A2', 'top', 'B1', 'B2'])
    expect(idsOf(planEdits.reorder(plan, ['A2', 'stage'], 'back'))).toEqual(['stage', 'A2', 'top', 'A1', 'B1', 'B2'])
  })

  it('steps past one unit, a group standing where its highest member is drawn', () => {
    expect(idsOf(planEdits.reorder(plan, ['A1'], 'forward'))).toEqual(['top', 'stage', 'B1', 'B2', 'A1', 'A2'])
    expect(idsOf(planEdits.reorder(plan, ['A2'], 'backward'))).toEqual(['top', 'stage', 'A1', 'B1', 'A2', 'B2'])
    expect(idsOf(planEdits.reorder(plan, ['table-1'], 'backward'))).toEqual(['stage', 'top', 'B1', 'B2', 'A1', 'A2'])
  })

  it('leaves the plan as it is with nothing to pass', () => {
    expect(planEdits.reorder(plan, ['A2'], 'forward')).toBe(plan)
    // The stage is drawn over the table's top, but the table is listed above it — it is already the lowest.
    expect(planEdits.reorder(plan, ['stage'], 'backward')).toBe(plan)
    expect(planEdits.reorder(plan, ['missing'], 'front')).toBe(plan)
  })
})

describe('planEdits — templates', () => {
  // Row `row-1` (A1–A4, centres 46 to 460 on y 400) with its label beyond the last seat.
  const { plan: rowed } = withRow(planOf([desk('D1', 600, 2)]))
  const plan = planEdits.addLabels(rowed, 'row-1', [{ x: 480, y: 380, w: 40, h: 40 }]).plan

  it('holds what a selection holds, around its middle — a group with its labels, an object out of its group', () => {
    const made = planEdits.templateOf(plan, ['row-1'])!
    expect(made.at).toEqual({ x: 253, y: 400 })
    expect(made.template.groups.map((g) => g.id)).toEqual(['row-1'])
    expect(made.template.objects.map((o) => [o.kind, o.x, o.y])).toEqual([
      ['place', -227, -20],
      ['place', -89, -20],
      ['place', 49, -20],
      ['place', 187, -20],
      ['label', 227, -20],
    ])
    expect(made.template.objects.some((o) => 'section' in o)).toBe(false)
    // A seat picked alone leaves its row; a label never comes without its group.
    expect(planEdits.templateOf(plan, ['A2', 'label-1'])!.template).toEqual({
      version: 3,
      groups: [],
      objects: [{ kind: 'place', id: 'A2', x: -20, y: -20, w: 40, h: 40, shape: 'ellipse', capacity: 1 }],
    })
  })

  it('inserts with fresh ids — places take the numbering of the section they land in', () => {
    const { template, at } = planEdits.templateOf(plan, ['row-1'])!
    const again = planEdits.insertTemplate(plan, template, at)!
    expect(again.ids).toEqual(['row-2'])
    const copy = seatPlan.membersOf(again.plan, 'row-2')
    expect(copy.map((o) => o.id)).toEqual(['A5', 'A6', 'A7', 'A8', 'label-2'])
    // Inserted where it came from, the copy lies exactly on the original.
    expect(copy.map((o) => [o.x, o.y])).toEqual(seatPlan.membersOf(plan, 'row-1').map((o) => [o.x, o.y]))
    const inB = planEdits.insertTemplate(plan, template, { x: 759, y: 200 })!
    expect(
      seatPlan.membersOf(inB.plan, 'row-2').flatMap((o) => (o.kind === 'place' ? [`${o.id} ${o.section}`] : [])),
    ).toEqual(['B1 B', 'B2 B', 'B3 B', 'B4 B'])
  })

  it('holds the copy inside the plan, drops categories the plan lacks, and needs a section for places', () => {
    const seat: PlanTemplate = {
      version: 3,
      groups: [],
      objects: [
        { kind: 'place', id: 'x', x: -20, y: -20, w: 40, h: 40, shape: 'ellipse', capacity: 1, category: 'vip' },
      ],
    }
    const corner = planEdits.insertTemplate(planOf(), seat, { x: 0, y: 0 })!
    expect(seatPlan.objectById(corner.plan, 'A1')).toEqual({
      kind: 'place',
      id: 'A1',
      section: 'A',
      x: 0,
      y: 0,
      w: 40,
      h: 40,
      shape: 'ellipse',
      capacity: 1,
    })
    const small = { ...planOf(), sections: [{ id: 'A' as S, points: rect(0, 0, 200, 200) }] }
    expect(planEdits.insertTemplate(small, seat, { x: 600, y: 600 })).toBeNull()
    expect(planEdits.insertTemplate(small, seat, { x: 600, y: 600 }, { section: 'A' })!.ids).toEqual(['A1'])
  })
})
