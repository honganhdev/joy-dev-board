import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(name: string): string {
  return readFileSync(new URL(`../src/components/report/${name}`, import.meta.url), 'utf8');
}

test('leaves repeated comparison sites neutral', () => {
  for (const name of ['week-columns.tsx', 'feature-breakdown.tsx']) {
    expect(source(name)).not.toMatch(/valenceTextClass|valencePillClass/);
  }
});

test('keeps the valence palette itself out of the repeated sites', () => {
  // The rule above is a name check, so a hand-written `text-red-700` on the week
  // strip or the feature table walks straight past it. These four tokens are the
  // palette `direction.ts` hands out; the series colour `bg-emerald-500` on the
  // done bar is a different decision and stays legal, which is why each token
  // carries a trailing boundary.
  const palette = [/\btext-red-700\b/, /\btext-emerald-700\b/, /\bbg-red-50\b/, /\bbg-emerald-50\b/];
  for (const name of ['week-columns.tsx', 'feature-breakdown.tsx']) {
    for (const token of palette) expect(source(name)).not.toMatch(token);
  }
});

test('colours the standalone pill from its own declared direction', () => {
  // Without this the colour can be deleted from the site entirely and every
  // other test still passes: `direction.ts` is exercised in isolation, and the
  // rules above only say where colour may not go.
  expect(source('headline-tiles.tsx')).toMatch(
    /valencePillClass\(\s*week\.createdComparison\.delta,\s*week\.createdComparison\.valence\s*\)/
  );
});

test('colours the standalone figure and leaves its percentage tail muted', () => {
  const figure = source('comparison-figure.tsx');

  expect(figure).toMatch(/className=\{`font-semibold \$\{valenceTextClass\(delta, valence\)\}`\}/);
  // One call, on the glyph-and-magnitude span. A second would be the tail.
  expect(figure.match(/valenceTextClass\(/g)).toHaveLength(1);
  expect(figure).toMatch(/<span className="text-muted-foreground"> · \{percentLabel\}<\/span>/);
});
