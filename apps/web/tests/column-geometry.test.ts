import { describe, expect, test } from 'bun:test';
import { COLUMN_GEOMETRY, SLOT_STYLE, barHeight } from '../src/components/report/column-geometry';

const { plotHeight } = COLUMN_GEOMETRY;

describe('barHeight', () => {
  test('draws nothing for zero and the full plot for the tallest value', () => {
    expect(barHeight(0, 40)).toBe(0);
    expect(barHeight(40, 40)).toBe(plotHeight);
    expect(barHeight(20, 40)).toBe(plotHeight / 2);
  });

  test('stays a number when the whole range is empty', () => {
    // A panel scales itself to its own tallest value, so a max of 0 means every
    // week is 0 too. The floor is there for the divide: `0 / 0` would put `NaN`
    // pixels on every column in a quiet range, which is a broken panel rather
    // than a flat one. It does not clamp — a value above `max` cannot arise.
    expect(barHeight(0, 0)).toBe(0);
    expect(Number.isFinite(barHeight(0, 0))).toBe(true);
  });

  test('never draws past the plot for any value the panel scaled itself to', () => {
    const weeks = [0, 1, 7, 12, 40];
    const max = Math.max(...weeks);
    for (const value of weeks) expect(barHeight(value, max)).toBeLessThanOrEqual(plotHeight);
  });
});

describe('the stacked backlog column', () => {
  /**
   * `BacklogColumns` draws two segments and scales both against the tallest
   * `outstanding` in the range. The wire promises the two segments add up to
   * `outstanding`, so the stack must land exactly on the height a single
   * `outstanding` bar would — scaling either segment against a different figure
   * would overtop the plot on the busiest week, which is the one being read.
   */
  test('adds up to exactly the height of the week it splits', () => {
    const weeks = [
      { outstandingWithDoneDate: 9, closedWithoutDoneAt: 3 },
      { outstandingWithDoneDate: 0, closedWithoutDoneAt: 0 },
      { outstandingWithDoneDate: 41, closedWithoutDoneAt: 0 },
      { outstandingWithDoneDate: 0, closedWithoutDoneAt: 6 },
    ].map((week) => ({ ...week, outstanding: week.outstandingWithDoneDate + week.closedWithoutDoneAt }));

    const max = weeks.reduce((tallest, week) => Math.max(tallest, week.outstanding), 0);

    for (const week of weeks) {
      const stack =
        barHeight(week.closedWithoutDoneAt, max) + barHeight(week.outstandingWithDoneDate, max);
      expect(stack).toBeCloseTo(barHeight(week.outstanding, max), 10);
      expect(stack).toBeLessThanOrEqual(plotHeight);
    }
  });
});

describe('the shared x-axis', () => {
  test('gives both column panels one slot width, so their weeks line up', () => {
    // `CREATED VS DONE PER WEEK` and `BACKLOG AT EACH WEEK END` are read as one
    // pair. They align because they lay out from these numbers and nothing else,
    // so a second source of width here is the whole failure mode.
    expect(SLOT_STYLE.maxWidth).toBe(COLUMN_GEOMETRY.slotMaxWidth);
    expect(SLOT_STYLE.flex).toBe('1 1 0');
    expect(SLOT_STYLE.minWidth).toBeGreaterThan(0);
  });

  test('keeps every geometry value a plain number, never a class name', () => {
    // These reach the DOM through `style`. A Tailwind class built at runtime
    // (`w-[${n}px]`) matches nothing in source and would silently zero every
    // column in both panels at once.
    for (const value of [COLUMN_GEOMETRY.slotMaxWidth, COLUMN_GEOMETRY.gap, plotHeight]) {
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThan(0);
    }
  });
});
