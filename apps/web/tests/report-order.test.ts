import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { withheldNoteId } from '../src/components/report/range-picker';

const source = readFileSync(
  new URL('../src/components/report/report-view.tsx', import.meta.url),
  'utf8'
);

test('keeps report panels inside their approved time-scope bands', () => {
  const markers = [
    '<HeadlineTiles',
    '<DayColumns',
    'title={report.trendSectionTitle}',
    'title={report.rangeComparison.title}',
    '<WeekColumns',
    '<DurationHistogram',
    'title={report.openSectionTitle}',
    'title={report.dayComparison.title}',
    'title={report.devFixOpenRightNowLabel}',
    '<BacklogAge',
  ];
  const positions = markers.map((marker) => source.indexOf(marker));

  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(source.match(/<RangePicker/g)).toHaveLength(1);
  expect(source).not.toMatch(/<div className="px-1">\s*<RangePicker/);
});

test('returns the focused week to the running week when the range changes', () => {
  // The trend heading says so in the server's words. Nothing else resets the
  // focus, so without this a week picked from the old range stays selected
  // under a heading that now names a different span.
  const picker = source.match(/<RangePicker[\s\S]*?\/>/)?.[0] ?? '';

  expect(picker).toContain('setFocusedKey(null)');
  expect(picker).toContain('setWeeks(');
});

test('gives the range comparison its band alone and pairs the day card with the live one', () => {
  // The two comparisons read as comparable magnitudes while they share a row at
  // the same width. They are separated by band above; this pins the widths that
  // stop them looking like a pair inside one.
  expect(source).toContain('<Panel title={report.rangeComparison.title}>');
  expect(source).toMatch(/<Panel title=\{report\.dayComparison\.title\} className="min-w-0 flex-1">/);
  expect(source).toMatch(
    /<Panel title=\{report\.devFixOpenRightNowLabel\} className="min-w-0 flex-1">/
  );
});

test('prints every withheld preset its own reason and points its own button at it', () => {
  // A disabled button takes no focus and shows no tooltip, so the reason has to
  // be text on the page rather than a `title` nobody can reach. Three presets
  // are withheld at once for most of a year and the server words each for its
  // own span, so one sentence cannot stand in for the rest.
  expect(source).toContain('report.range.presets.filter');
  expect(source).toContain('withheldPresets.map((preset) => (');
  expect(source).toContain('id={withheldNoteId(preset.weeks)}');

  const picker = readFileSync(
    new URL('../src/components/report/range-picker.tsx', import.meta.url),
    'utf8'
  );
  expect(picker).not.toContain('title={preset.unavailableNote');
  expect(picker).toContain('preset.unavailableNote ? withheldNoteId(preset.weeks) : undefined');
});

test('gives each withheld preset an id of its own', () => {
  // The button and the sentence are composed in different files; the ids only
  // meet at run time, where nothing checks them. Distinctness is the property
  // that makes the notes above reachable one button at a time.
  const ids = [4, 12, 26, 52].map(withheldNoteId);

  expect(new Set(ids).size).toBe(ids.length);
  expect(withheldNoteId(52)).toContain('52');
});

test('puts the reader back where they were after a range click', () => {
  // The skeleton is shorter than the report, so the container clamps scrollTop
  // while it is up. The picker sits below the whole week band: without this the
  // click lands the reader two screens above the band they just re-ranged.
  const picker = source.match(/<RangePicker[\s\S]*?\/>/)?.[0] ?? '';

  expect(picker).toContain('scrollTopBeforeRerange.current = scrollRef.current?.scrollTop');
  expect(source).toContain('scrollRef.current?.scrollTo({ top: scrollTopBeforeRerange.current })');
});
