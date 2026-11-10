import type { Fixture } from 'ichno'
import { fixtureNames } from '../../_demo/plans'

// How the playground's canvases write and draw fixtures — its reading of its own roles.

// Loose fixtures are named; the furniture in a group (chairs, table tops) goes unlabelled.
export function fixtureLabel(fixture: Fixture): string | null {
  if (fixture.group !== undefined || fixture.role === undefined) return null

  return fixtureNames.get(fixture.role) ?? fixture.role
}

export function fixtureVariant(fixture: Fixture): 'box' | 'wall' {
  return fixture.role === 'wall' ? 'wall' : 'box'
}
