export function directionGlyph(delta: number | null): '▲' | '▼' | '=' | null {
  if (delta === null) return null;
  if (delta > 0) return '▲';
  if (delta < 0) return '▼';
  return '=';
}

function valenceOf(
  delta: number | null,
  valence?: 'riseIsBad' | 'riseIsGood'
): 'good' | 'bad' | null {
  if (delta === null || delta === 0 || valence === undefined) return null;
  const rose = delta > 0;
  if (valence === 'riseIsBad') return rose ? 'bad' : 'good';
  return rose ? 'good' : 'bad';
}

export function valenceTextClass(
  delta: number | null,
  valence?: 'riseIsBad' | 'riseIsGood'
): string {
  const reading = valenceOf(delta, valence);
  if (reading === 'bad') return 'text-red-700';
  if (reading === 'good') return 'text-emerald-700';
  return '';
}

export function valencePillClass(
  delta: number | null,
  valence?: 'riseIsBad' | 'riseIsGood'
): string {
  const reading = valenceOf(delta, valence);
  if (reading === 'bad') return 'bg-red-50 text-red-700';
  if (reading === 'good') return 'bg-emerald-50 text-emerald-700';
  return 'bg-stone-100 text-stone-700';
}
