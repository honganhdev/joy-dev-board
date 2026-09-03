import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/components/report/resolution-clocks.tsx', import.meta.url),
  'utf8'
);

test('builds no Tailwind class name at runtime', () => {
  expect(source).not.toMatch(/-\[[^\]]*\$\{/);
  expect(source).not.toMatch(/[a-z]-\$\{/);
});

test('draws both cohorts off one shared scale', () => {
  expect(source.match(/const scale =/g)).toHaveLength(1);
  const widths = source.match(/style=\{\{ width: `\$\{[^`]*\}%` \}\}/g) ?? [];
  expect(widths).toHaveLength(2);
  expect(widths.every((width) => width.includes('/ scale'))).toBe(true);
});

test('scores nothing', () => {
  expect(source).not.toMatch(/valence|direction/);
});
