export function directionGlyph(delta: number | null): '▲' | '▼' | '=' | null {
  if (delta === null) return null;
  if (delta > 0) return '▲';
  if (delta < 0) return '▼';
  return '=';
}
