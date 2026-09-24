// What the editor has selected — an object (desk, row, table, booth, area or fixture) or a section outline.
export type EditorSelection<S extends string = string> = { kind: 'object'; id: string } | { kind: 'section'; id: S }
