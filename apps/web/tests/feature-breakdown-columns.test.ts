import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

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

test('heads the two range-scoped columns with their scope', () => {
  // The band divider above this panel names today and right now. These two
  // columns answer to the selected range instead, so the heading is the only
  // thing on screen saying which stretch of time they cover.
  const header = block('aria-hidden="true"', '</div>');

  expect(header).toContain('Speed in range');
  expect(header).toContain('Change vs preceding range');
  expect(header).toContain('Aged now');
});
