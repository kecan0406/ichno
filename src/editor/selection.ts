// What the editor has selected — an object (a place, a fixture, a group label), a whole group, or a section
// outline. Objects and groups share one id namespace, so an id alone names either.
export type EditorSelection<S extends string = string> =
  { kind: 'object'; id: string } | { kind: 'group'; id: string } | { kind: 'section'; id: S }
