import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('leaves repeated comparison sites neutral', () => {
  for (const name of ['week-columns.tsx', 'feature-breakdown.tsx']) {
    const source = readFileSync(new URL(`../src/components/report/${name}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/valenceTextClass|valencePillClass/);
  }
});
