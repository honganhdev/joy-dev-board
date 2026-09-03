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

/**
 * There is no renderer here, so the only level that can see whether a note ever
 * reaches the page is the source. The band's whole claim is that every figure
 * states the population it stands on: a panel could lose `carriedNote` or
 * `selectionNote` from the JSX and every server test stay green, because the
 * server would still be building the sentence nobody prints.
 */
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');

/** The string-valued fields declared on one payload type, in declaration order. */
function stringFields(typeName: string): string[] {
  const body = types.match(new RegExp(`export type ${typeName} = \\{([\\s\\S]*?)\\n\\};`))?.[1];
  if (!body) throw new Error(`no ${typeName} declaration in apps/web/src/types.ts`);
  return [...body.matchAll(/^ {2}(\w+): string(?: \| null)?;$/gm)].map((match) => match[1] ?? '');
}

test('prints every note the panel declares', () => {
  const fields = stringFields('ResolutionClockPanel');

  expect(fields).toEqual([
    'caption',
    'sampleNote',
    'carriedNote',
    'selectionNote',
    'unmeasuredNote',
    'otherStatusNote',
  ]);
  expect(fields.filter((field) => !source.includes(`panel.${field}`))).toEqual([]);
});

test('prints every cohort note and every bar count', () => {
  // Each row carries its own count beside its bar, so a reader can check a bar
  // against a number rather than against the shared scale.
  expect(source).toContain('{panel.done.sampleNote}');
  expect(source).toContain('{panel.devDone.sampleNote}');
  expect(source.match(/\{doneCount\}/g)).toHaveLength(1);
  expect(source.match(/\{devDoneCount\}/g)).toHaveLength(1);
});

test('names both clocks and both cohorts in the server words only', () => {
  // The browser composes no label: the axis, the cohort names and the toggle all
  // read out of the payload. A hard-coded '≤ 1h' here would survive the server
  // renaming its own axis.
  expect(source).toContain('data.bucketLabels.map(');
  expect(source).toContain('{data.clockLabels[option]}');
  expect(source).toContain('label: panel.done.label');
  expect(source).toContain('label: panel.devDone.label');
  expect(source).toMatch(/aria-pressed=\{clock === option\}/);
  expect(source).toMatch(/\['csReply', 'customerOk'\] as const\)\.map\(/);
  expect(source).not.toMatch(/'≤|1–4h|Dev Done'/);
});
