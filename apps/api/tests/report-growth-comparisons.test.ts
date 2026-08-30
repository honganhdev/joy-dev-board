import { describe, expect, test } from 'bun:test';
import { aggregateWeeklyReport, compareCreated } from '../src/board/weekly-report';
import type { WeeklyReport } from '../src/board/report-types';
import { dayStartMs, weekStartMs } from '../src/board/weeks';
import type { HelpDeskTicket } from '../src/helpdesk/types';

/**
 * The comparison windows, proved by cases that tell the two candidate
 * implementations apart.
 *
 * Every window here has a rival: the period-length previous span has an
 * elapsed-length rival, the range comparison anchored on the range start has a
 * rival anchored on `now`, and the running week's partial span has a
 * whole-previous-week rival. A case both would satisfy proves neither, so each
 * fixture below puts tickets in the region where the two disagree.
 *
 * Fixed clock: Wed 26 Aug 2026 10:00 +07:00, ten hours into the day and two
 * days into ISO week 2026-W35.
 */
const NOW = new Date('2026-08-26T03:00:00.000Z');
const YEAR = 2026;
const DAY = 86400000;
const WEEK = 7 * DAY;

function ticket(overrides: Partial<HelpDeskTicket>): HelpDeskTicket {
  return {
    id: overrides.ticketId ?? 'id',
    ticketId: 'JOY-260101-aaaaaa',
    subject: 'widget broken',
    ticketStatus: 'open',
    tsStatus: 'dev_fixing',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function report(tickets: HelpDeskTicket[], weeks = 12): WeeklyReport {
  return aggregateWeeklyReport(tickets, { weeks, now: NOW, year: YEAR });
}

function at(ms: number, overrides: Partial<HelpDeskTicket> = {}): HelpDeskTicket {
  return ticket({ createdAt: new Date(ms).toISOString(), ...overrides });
}

/** A ticket old enough to set the mirror horizon without landing in any window under test. */
const HORIZON = ticket({ ticketId: 'horizon', createdAt: '2026-01-05T00:00:00.000Z' });

describe('the previous span is a period behind, not an elapsed span behind', () => {
  const start = dayStartMs(NOW.getTime());
  const end = NOW.getTime();
  const elapsedMs = end - start;
  const horizon = { startsAtMs: start - 40 * DAY };

  /**
   * The discriminator. `[start - DAY, end - DAY)` is the same clock hours
   * yesterday; `[start - elapsed, end - elapsed)` is the ten hours ending at
   * today's midnight. The two windows do not overlap, so a ticket in each of
   * them gives the two implementations different answers.
   */
  test('counts yesterday at the same hours and ignores the hours before midnight', () => {
    const sameHoursYesterday = [
      { createdMs: start - DAY },
      { createdMs: start - DAY + 3 * 3600000 },
      { createdMs: end - DAY - 1 },
    ];
    const theElapsedRival = [
      { createdMs: start - elapsedMs },
      { createdMs: start - 1 },
    ];

    const result = compareCreated(
      [...sameHoursYesterday, ...theElapsedRival, { createdMs: start + 1 }],
      start,
      end,
      DAY,
      horizon
    );

    expect(result.previous).toBe(3);
    expect(result.current).toBe(1);
  });

  test('reaches the same verdict through the whole payload', () => {
    const result = report([
      HORIZON,
      at(start - DAY, { ticketId: 'yesterday-midnight' }),
      at(start - DAY + 3 * 3600000, { ticketId: 'yesterday-morning' }),
      at(end - DAY - 1, { ticketId: 'yesterday-last-instant' }),
      at(start - elapsedMs, { ticketId: 'elapsed-rival-open' }),
      at(start - 1, { ticketId: 'elapsed-rival-close' }),
      at(start + 1, { ticketId: 'today' }),
    ]).dayComparison;

    expect(result).toMatchObject({ current: 1, previous: 3, delta: -2 });
  });
});

describe('the half-open convention at every edge of both windows', () => {
  const start = dayStartMs(NOW.getTime());
  const end = NOW.getTime();
  const horizon = { startsAtMs: start - 40 * DAY };
  const one = (createdMs: number) => compareCreated([{ createdMs }], start, end, DAY, horizon);

  test('includes the opening instant of the current span and excludes its closing one', () => {
    expect(one(start).current).toBe(1);
    expect(one(start - 1).current).toBe(0);
    expect(one(end - 1).current).toBe(1);
    expect(one(end).current).toBe(0);
  });

  test('includes the opening instant of the previous span and excludes its closing one', () => {
    expect(one(start - DAY).previous).toBe(1);
    expect(one(start - DAY - 1).previous).toBe(0);
    expect(one(end - DAY - 1).previous).toBe(1);
    expect(one(end - DAY).previous).toBe(0);
  });

  test('puts the two minutes either side of a +07:00 midnight in different days', () => {
    // 23:59 and 00:00 local, expressed in UTC on a zone with no DST.
    expect(dayStartMs(Date.parse('2026-08-25T16:59:00.000Z'))).toBe(
      Date.parse('2026-08-24T17:00:00.000Z')
    );
    expect(dayStartMs(Date.parse('2026-08-25T17:00:00.000Z'))).toBe(
      Date.parse('2026-08-25T17:00:00.000Z')
    );
  });

  test('starts the week and its Monday on the same instant', () => {
    const monday = weekStartMs(NOW.getTime());
    expect(dayStartMs(monday)).toBe(monday);
    expect(dayStartMs(monday - 1)).toBe(monday - DAY);
  });
});

describe('the running week compares Monday to now, not Monday to Sunday', () => {
  const monday = weekStartMs(NOW.getTime());

  /**
   * The rival here is a whole-week previous span. Tickets are placed after
   * `now`'s clock time inside last week, which the correct window excludes and
   * a whole-week window would swallow.
   */
  test('stops the previous span at the same instant one week earlier', () => {
    const result = report(
      [
        HORIZON,
        at(monday - WEEK + 3600000, { ticketId: 'last-week-early' }),
        at(NOW.getTime() - WEEK - 1, { ticketId: 'last-week-last-instant' }),
        at(NOW.getTime() - WEEK, { ticketId: 'last-week-at-now' }),
        at(monday - WEEK + 5 * DAY, { ticketId: 'last-week-friday' }),
        at(monday + 3600000, { ticketId: 'this-week' }),
      ],
      4
    );
    const running = result.weeks.at(-1);

    expect(running?.inProgress).toBe(true);
    expect(running?.createdComparison).toMatchObject({ current: 1, previous: 2, delta: -1 });
  });

  test('leaves a ticket created between now and Sunday out of every current span', () => {
    const later = NOW.getTime() + 2 * DAY;
    const result = report([HORIZON, at(monday + 3600000, { ticketId: 'so-far' }), at(later, { ticketId: 'not-yet' })], 4);
    const running = result.weeks.at(-1);

    expect(running?.createdComparison.current).toBe(1);
    expect(result.rangeComparison.current).toBe(1);
    expect(result.dayComparison.current).toBe(0);
    expect(result.openByFeature.rows[0]?.comparison.current).toBe(1);
  });

  test('still compares a finished week whole against whole', () => {
    const lastMonday = monday - WEEK;
    const result = report(
      [
        HORIZON,
        at(lastMonday - WEEK + 60000, { ticketId: 'two-weeks-ago-monday' }),
        at(lastMonday - 60000, { ticketId: 'two-weeks-ago-sunday-night' }),
        at(lastMonday + 60000, { ticketId: 'last-monday' }),
        at(monday - 60000, { ticketId: 'last-sunday-night' }),
      ],
      4
    );
    const finished = result.weeks.find((week) => week.key === '2026-W34');

    expect(finished?.inProgress).toBe(false);
    // Both spans run their whole Monday-to-Monday, so the Sunday-night ticket
    // at each end is inside its own week rather than cut off at `now`'s hour.
    expect(finished?.createdComparison).toMatchObject({ current: 2, previous: 2, delta: 0 });
  });
});

describe('the selected range is anchored on the range start', () => {
  /**
   * The rival anchors the previous span on `now` — `[now - 2N weeks, now - N
   * weeks)`. Because the range starts at a Monday and `now` is a Wednesday
   * morning, the two windows differ by that offset at both ends, and a ticket
   * placed in the gap separates them.
   */
  test('uses the twelve weeks immediately before the range, offset from its Monday', () => {
    const rangeStart = weekStartMs(NOW.getTime()) - 11 * WEEK;
    const previousStart = rangeStart - 12 * WEEK;
    // The rival opens at `now - 24 weeks`, which is four and a half days
    // earlier than the range-anchored window: `only-the-rival-reaches-it` sits
    // in that overhang and must not be counted.
    const rivalStart = NOW.getTime() - 24 * WEEK;

    const result = report([
      ticket({ ticketId: 'horizon', createdAt: new Date(rivalStart - WEEK).toISOString() }),
      at(previousStart - 1, { ticketId: 'only-the-rival-reaches-it' }),
      at(previousStart, { ticketId: 'previous-first-instant' }),
      at(rangeStart, { ticketId: 'current-first-instant' }),
    ]);

    expect(result.range.selectedWeeks).toBe(12);
    expect(rivalStart).toBeLessThan(previousStart);
    expect(result.rangeComparison).toMatchObject({ current: 1, previous: 1, delta: 0 });
  });

  test('gives the feature rows the same window as the range figure', () => {
    const rangeStart = weekStartMs(NOW.getTime()) - 11 * WEEK;
    const previousStart = rangeStart - 12 * WEEK;
    const result = report([
      ticket({ ticketId: 'horizon', createdAt: new Date(previousStart - WEEK).toISOString() }),
      at(previousStart + 1, { ticketId: 'w-prev', subject: 'widget broken' }),
      at(rangeStart + 1, { ticketId: 'w-now', subject: 'widget broken' }),
    ]);
    const widget = result.openByFeature.rows.find((row) => row.key === 'WIDGET');

    expect(widget?.comparison).toMatchObject({ current: 1, previous: 1 });
    expect(result.rangeComparison).toMatchObject({ current: 1, previous: 1 });
  });
});

describe('a suppressed comparison carries no count at all', () => {
  const start = dayStartMs(NOW.getTime());
  const end = NOW.getTime();

  test('keeps the previous span when it opens exactly on the horizon', () => {
    expect(compareCreated([], start, end, DAY, { startsAtMs: start - DAY })).toMatchObject({
      previous: 0,
      delta: 0,
    });
  });

  test('sends null rather than zero one millisecond past the horizon', () => {
    const suppressed = compareCreated(
      [{ createdMs: start + 1 }],
      start,
      end,
      DAY,
      { startsAtMs: start - DAY + 1 }
    );

    expect(suppressed.previous).toBeNull();
    expect(suppressed.delta).toBeNull();
    expect(suppressed.magnitudeLabel).toBeNull();
    expect(suppressed.percentLabel).toBeNull();
  });

  test('suppresses every comparison on the page the same way', () => {
    const result = report([at(NOW.getTime() - 3600000, { ticketId: 'only' })], 4);

    for (const comparison of [result.dayComparison, result.rangeComparison]) {
      expect(comparison.previous).toBeNull();
      expect(comparison.delta).toBeNull();
      expect(comparison.changeLabel).toBeNull();
      expect(comparison.unavailableNote).not.toBeNull();
    }
    expect(result.openByFeature.rows[0]?.comparison.previous).toBeNull();
    expect(result.openByFeature.unavailableNote).not.toBeNull();
  });
});

describe('the four printed shapes stay distinguishable', () => {
  const start = dayStartMs(NOW.getTime());
  const end = NOW.getTime();
  const horizon = { startsAtMs: start - 40 * DAY };
  const shape = (previous: number, current: number) =>
    compareCreated(
      [
        ...Array.from({ length: previous }, (_, index) => ({ createdMs: start - DAY + index })),
        ...Array.from({ length: current }, (_, index) => ({ createdMs: start + index })),
      ],
      start,
      end,
      DAY,
      horizon
    );

  test('lays out the five comparison states as structured labels', () => {
    expect(
      compareCreated([{ createdMs: start }], start, end, DAY, {
        startsAtMs: start - DAY + 1,
      })
    ).toMatchObject({ magnitudeLabel: null, percentLabel: null });
    expect(shape(0, 4)).toMatchObject({ magnitudeLabel: '4', percentLabel: null });
    expect(shape(2, 3)).toMatchObject({ magnitudeLabel: '1', percentLabel: null });
    expect(shape(7, 9)).toMatchObject({ magnitudeLabel: '2', percentLabel: '+29%' });
    expect(shape(7, 7)).toMatchObject({ magnitudeLabel: null, percentLabel: null });
  });

  test('prints a percentage only from a baseline of five upward', () => {
    expect(shape(18, 25)).toMatchObject({ magnitudeLabel: '7', percentLabel: '+39%' });
    expect(shape(5, 6)).toMatchObject({ magnitudeLabel: '1', percentLabel: '+20%' });
    expect(shape(4, 6)).toMatchObject({ magnitudeLabel: '2', percentLabel: null });
    expect(shape(2, 3)).toMatchObject({ magnitudeLabel: '1', percentLabel: null });
  });

  test('prints no percentage at all against a zero baseline', () => {
    expect(shape(0, 4)).toMatchObject({ magnitudeLabel: '4', percentLabel: null });
  });

  test('never divides by a suppressed baseline', () => {
    const comparison = compareCreated([{ createdMs: start }], start, end, DAY, {
      startsAtMs: start - DAY + 1,
    });
    expect(comparison).toMatchObject({
      previous: null,
      magnitudeLabel: null,
      percentLabel: null,
    });
  });
});

describe('the dev-fix narrowing reaches every panel at once', () => {
  /**
   * One open ticket in each bucket, so a panel that forgot the narrowing counts
   * two where every other panel counts one. `openRightNow` is deliberately not
   * the denominator here: it is the all-open figure the page reconciles against
   * in prose, and asserting a panel against it would pass only while every
   * ticket in the fixture happens to be a dev-fix one.
   */
  const tickets = [
    ticket({ ticketId: 'bug', subject: 'widget broken', appPlan: 'free', store: [{ shopName: 'A' }], createdAt: '2026-08-03T00:00:00.000Z' }),
    ticket({ ticketId: 'not-a-bug', tsStatus: 'pending', subject: 'point balance wrong', appPlan: 'pro', store: [{ shopName: 'B' }], createdAt: '2026-08-03T00:00:00.000Z' }),
  ];

  test('gives every open-side panel the same denominator', () => {
    const result = report(tickets);
    const bucketed =
      result.openBacklog.buckets.reduce((total, bucket) => total + bucket.count, 0) +
      result.openBacklog.noCreatedDate;
    const merchants =
      result.openByMerchant.rows.reduce((total, row) => total + row.count, 0) +
      result.openByMerchant.tailCount;

    expect(result.devFixOpenRightNow).toBe(1);
    expect(result.openRightNow).toBe(2);
    expect(result.openBacklog.total).toBe(result.devFixOpenRightNow);
    expect(bucketed).toBe(result.devFixOpenRightNow);
    expect(result.openByPlan.rows.reduce((total, row) => total + row.count, 0)).toBe(
      result.devFixOpenRightNow
    );
    expect(merchants).toBe(result.devFixOpenRightNow);
    expect(result.openByFeature.rows.reduce((total, row) => total + row.open, 0)).toBe(
      result.devFixOpenRightNow
    );
  });

  test('moves no week figure and no comparison when a non-dev ticket arrives', () => {
    const withoutIt = report([tickets[0] as HelpDeskTicket]);
    const withIt = report(tickets);
    const strip = (result: WeeklyReport) =>
      result.weeks.map((week) => ({
        key: week.key,
        created: week.created,
        done: week.done,
        outstanding: week.outstanding,
        comparison: week.createdComparison,
      }));

    expect(strip(withIt)).toEqual(strip(withoutIt));
    expect(withIt.dayComparison).toEqual(withoutIt.dayComparison);
    expect(withIt.rangeComparison).toEqual(withoutIt.rangeComparison);
    expect(withIt.timeToFirstDone).toEqual(withoutIt.timeToFirstDone);
  });

  test('says which total is which rather than printing one over the other', () => {
    const result = report(tickets);

    expect(result.openSectionTitle).toContain('All open tickets right now — 2 tickets');
    expect(result.openSectionTitle).toContain('1 is marked Dev Fixing or Dev Done');
    expect(result.excludedNote).toContain('outside the Dev Fixing and Dev Done figures');
    expect(result.bugRule).toContain('Dev Fixing or Dev Done');
  });

  test('offers only the two accepted statuses to the day split', () => {
    const result = report([
      at(weekStartMs(NOW.getTime()) + 3600000, { ticketId: 'fixing', tsStatus: 'dev_fixing' }),
      at(weekStartMs(NOW.getTime()) + 7200000, { ticketId: 'done-status', tsStatus: 'dev_done' }),
      at(weekStartMs(NOW.getTime()) + 10800000, { ticketId: 'pending', tsStatus: 'pending' }),
      at(weekStartMs(NOW.getTime()) + 14400000, { ticketId: 'done', tsStatus: 'done' }),
    ], 4);

    expect(result.daySplit.statuses.map((entry) => entry.status).sort()).toEqual([
      'dev_done',
      'dev_fixing',
    ]);
    // Two statuses cannot outrun the five named slots, so nothing rolls up.
    expect(result.daySplit.statuses.map((entry) => entry.label)).not.toContain(
      'Remaining statuses'
    );
  });
});

describe('a status that is not counted cannot be described as a bug', () => {
  test('keeps a ticket that left the dev bucket out of every figure', () => {
    // `dev_fixing → feature_request` was observed upstream: membership is a
    // snapshot, so a ticket that left is simply gone from the counts.
    const left = report([HORIZON, at(NOW.getTime() - 3600000, { ticketId: 'left', tsStatus: 'feature_request' })]);
    const stayed = report([HORIZON, at(NOW.getTime() - 3600000, { ticketId: 'stayed', tsStatus: 'dev_fixing' })]);

    expect(left.dayComparison.current).toBe(0);
    expect(stayed.dayComparison.current).toBe(1);
    expect(left.excluded.notDevFix).toBe(1);
  });
});
