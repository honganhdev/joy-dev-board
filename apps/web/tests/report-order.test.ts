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
