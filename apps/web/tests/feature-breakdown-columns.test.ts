import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { columnHeads } from '../src/components/report/feature-breakdown';

const source = readFileSync(
  new URL('../src/components/report/feature-breakdown.tsx', import.meta.url),
  'utf8'
);

const WIDTH_TOKEN = /^(size-2|w-\d+|flex-1)$/;

/**
 * The width each column of a block claims, in the order the columns are laid
 * out. There is no renderer here, so a header that drifts out of alignment with
 * the rows under it has nothing else to catch it.
 */
function columnWidths(block: string): string[] {
  return [...block.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
    .map((match) => match[1] ?? match[2] ?? '')
    .map((value) => value.split(/\s+/).find((token) => WIDTH_TOKEN.test(token)))
    .filter((token): token is string => Boolean(token));
}

function block(open: string, close: string): string {
  const start = source.indexOf(open);
  const end = source.indexOf(close, start);
  if (start === -1 || end === -1) throw new Error(`no block from ${open}`);
  return source.slice(start, end);
}

test('lines the feature column headings up with the rows they head', () => {
  const header = block('aria-hidden="true"', '</div>');
  const row = block('<li key={row.key}', '</li>');

  expect(columnWidths(header)).toEqual(columnWidths(row));
  expect(columnWidths(row)).not.toHaveLength(0);
});

test('names in the two range-scoped column heads the span they answer to', () => {
  // The band divider above this panel names today and right now. These two
  // columns answer to the selected range instead, and "in range" on its own
  // never says which range that is.
  expect(columnHeads(12)).toMatchObject({
    aged: 'Aged now',
    speed: 'Speed in the last 12 weeks',
    change: 'Change vs the preceding 12 weeks',
  });
  expect(columnHeads(52).speed).toContain('52 weeks');
  expect(columnHeads(52).change).toContain('52 weeks');
});

test('says the same column scope to a reader who cannot see the heading strip', () => {
  // The strip is the only on-screen thing telling the live columns from the
  // range-scoped ones, and it is aria-hidden. Each row voices the same words
  // the strip prints, from the one place both take them.
  const header = block('aria-hidden="true"', '</div>');
  const row = block('<li key={row.key}', '</li>');

  for (const head of ['heads.aged', 'heads.speed', 'heads.change']) {
    expect(header).toContain(`{${head}}`);
    expect(row).toContain(`<span className="sr-only">{${head}}: </span>`);
  }
});
