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
    'title={report.resolutionClocks.sectionTitle}',
    '<ResolutionClocks',
  ];
  const positions = markers.map((marker) => source.indexOf(marker));

  expect(markers.filter((_, index) => positions[index] < 0)).toEqual([]);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));

  // A single ordered marker would only ever pin the first panel, so the merchant
  // one could slide below the live divider alone and leave the order intact.
  // Both have to sit between the histogram and the divider that opens the live
  // band. The lookahead keeps the `OpenBreakdownScope` type argument, which sits
  // far above in the state hook, from being read as a third panel.
  const panels = ['plan panel', 'merchant panel'];
  const openings = [...source.matchAll(/<OpenBreakdown(?![A-Za-z])/g)].map(
    (match) => match.index ?? -1
  );
  const rangeBandStart = source.indexOf('<DurationHistogram');
  const liveBandStart = source.indexOf('title={report.openSectionTitle}');

  expect(openings).toHaveLength(panels.length);
  expect(
    openings
      .map((position, index) => ({ panel: panels[index] ?? `panel ${index + 1}`, position }))
      .filter(({ position }) => position < rangeBandStart || position > liveBandStart)
      .map(({ panel }) => panel)
  ).toEqual([]);
  expect(source.match(/<RangePicker/g)).toHaveLength(1);
  expect(source).not.toMatch(/<div className="px-1">\s*<RangePicker/);
  expect(source.match(/scope=\{openScope\}/g)).toHaveLength(2);
  expect(source.match(/onScopeChange=\{setOpenScope\}/g)).toHaveLength(2);
});

test('offers both readings on the shared control and reports which one is live', () => {
  // `report-view.tsx` proves the two panels share one state; nothing reached
  // `open-breakdown.tsx` itself, so the control could render one option, drop
  // its pressed state or stop calling back and the suite stayed green. There is
  // no renderer here, so this pins the wiring at the only level that can see it.
  const control = readFileSync(
    new URL('../src/components/report/open-breakdown.tsx', import.meta.url),
    'utf8'
  );

  expect(control).toMatch(/\['createdInRange', 'stillOpen'\] as const\)\.map\(/);
  expect(control).toMatch(/onClick=\{\(\) => onScopeChange\(option\)\}/);
  expect(control).toMatch(/aria-pressed=\{scope === option\}/);
  // The two options are named by the server, never composed in the browser.
  expect(control).toMatch(/\{scopeLabels\[option\]\}/);
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
