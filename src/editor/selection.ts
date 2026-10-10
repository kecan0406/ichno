// What the editor has selected — an object (a place, a fixture, a group label), a whole group, a wall, or a section
// outline. Objects, groups and walls share one id namespace, so an id alone names any of them.
export type EditorSelection<S extends string = string> =
  | { kind: 'object'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'wall'; id: string }
  | { kind: 'section'; id: S }
