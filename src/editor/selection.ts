export type EditorSelection<Z extends string = string> =
  { kind: 'seat'; id: string } | { kind: 'zone'; id: Z } | { kind: 'fixture'; id: string }
