import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

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

test('prints the withheld preset reason on screen and points the control at it', () => {
  // A disabled button takes no focus and shows no tooltip, so the reason has to
  // be text on the page rather than a `title` nobody can reach.
  expect(source).toContain('<span id={WITHHELD_NOTE_ID}>{withheldNote}</span>');
  expect(source).toContain('describedById={withheldNote ? WITHHELD_NOTE_ID : undefined}');

  const picker = readFileSync(
    new URL('../src/components/report/range-picker.tsx', import.meta.url),
    'utf8'
  );
  expect(picker).not.toContain('title={preset.unavailableNote');
  expect(picker).toContain('aria-describedby');
});
