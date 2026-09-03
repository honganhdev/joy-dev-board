export type DocsBlock =
  | { kind: 'h2' | 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'table'; headers: readonly string[]; rows: readonly (readonly string[])[] };
