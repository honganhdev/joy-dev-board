import { describe, expect, test } from 'bun:test';
import { CATEGORIES, FALLBACK_CATEGORY } from '../src/board/categories';
import { aggregateWeeklyReport, compareCreated } from '../src/board/weekly-report';
import type { WeeklyReport } from '../src/board/report-types';
import { dayStartMs, weekStartMs } from '../src/board/weeks';
import type { HelpDeskTicket } from '../src/helpdesk/types';
import { loadFixtureTickets } from './fixtures';

/**
 * Fixed clock: Wed 26 Aug 2026, inside ISO week 2026-W35. Every date below is
 * written with an explicit offset so no assertion depends on the runner's own
 * timezone.
 */
const NOW = new Date('2026-08-26T03:00:00.000Z');
const YEAR = 2026;

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

/**
 * The words the page may never print, matched as whole words and in the
 * inflections ordinary prose reaches for: a caption saying `breaches` or
 * `deadlines` makes exactly the claim a caption saying `breach` makes. A
 * substring match cannot tell server wording from the customer text this
 * payload carries: the standing taxonomy label `TRANSLATION` holds `sla`, and a
 * merchant called `Slate` holds it too — so every alternative keeps its leading
 * word boundary.
 */
const FORBIDDEN_LANGUAGE = /\b(SLAs?|overdue|breach(?:es|ed|ing)?|deadlines?)\b/i;

function report(tickets: HelpDeskTicket[], weeks = 12): WeeklyReport {
  return aggregateWeeklyReport(tickets, { weeks, now: NOW, year: YEAR });
}

function weekByKey(result: WeeklyReport, key: string) {
  const week = result.weeks.find((candidate) => candidate.key === key);
  if (!week) throw new Error(`no week ${key} in ${result.weeks.map((w) => w.key).join(', ')}`);
  return week;
}

describe('comparison arithmetic', () => {
  const DAY = 86400000;
  const start = Date.parse('2026-08-25T17:00:00.000Z');
  const end = start + 10 * 60 * 60 * 1000;
  const horizon = { startsAtMs: start - 10 * DAY };

  function withCounts(previous: number, current: number) {
    return [
      ...Array.from({ length: previous }, (_, index) => ({
        createdMs: start - DAY + 1000 + index,
      })),
      ...Array.from({ length: current }, (_, index) => ({ createdMs: start + 1000 + index })),
    ];
  }

  test('uses the full period to compare the same elapsed hours', () => {
    const bugs = [
      { createdMs: start - DAY + 60 * 60 * 1000 },
      { createdMs: start - 2 * 60 * 60 * 1000 },
      { createdMs: start + 60 * 60 * 1000 },
    ];

    expect(compareCreated(bugs, start, end, DAY, horizon)).toMatchObject({
      current: 1,
      previous: 1,
      delta: 0,
    });
  });

  test('floors percentages below five and prints them from five upward', () => {
    expect(compareCreated(withCounts(4, 5), start, end, DAY, horizon).figure).toBe(
      '4 → 5 · +1 · —'
    );
    expect(compareCreated(withCounts(5, 7), start, end, DAY, horizon).figure).toBe(
      '5 → 7 · +2 (+40%)'
    );
    expect(compareCreated(withCounts(6, 3), start, end, DAY, horizon).figure).toBe(
      '6 → 3 · -3 (-50%)'
    );
  });

  test('prints no percentage for a zero baseline', () => {
    expect(compareCreated(withCounts(0, 4), start, end, DAY, horizon)).toEqual({
      current: 4,
      previous: 0,
      delta: 4,
      figure: '0 → 4 · +4',
    });
  });

  test('sends no false previous count when the earlier period predates the mirror', () => {
    expect(
      compareCreated(withCounts(5, 2), start, end, DAY, { startsAtMs: start - DAY + 1 })
    ).toEqual({ current: 2, previous: null, delta: null, figure: '2' });
  });
});

describe('day starts in Vietnam time', () => {
  test('splits adjacent minutes across local midnight', () => {
    expect(dayStartMs(Date.parse('2026-08-23T16:59:00.000Z'))).toBe(
      Date.parse('2026-08-22T17:00:00.000Z')
    );
    expect(dayStartMs(Date.parse('2026-08-23T17:00:00.000Z'))).toBe(
      Date.parse('2026-08-23T17:00:00.000Z')
    );
  });

  test('keeps a Monday instant anchored to that Monday midnight', () => {
    expect(dayStartMs(Date.parse('2026-08-24T03:00:00.000Z'))).toBe(
      Date.parse('2026-08-23T17:00:00.000Z')
    );
  });
});

describe('today against yesterday', () => {
  test('compares the same hours of the two days, not the elapsed hours before midnight', () => {
    const result = report([
      ticket({ ticketId: 'anchor', createdAt: '2026-08-20T09:00:00.000Z' }),
      ticket({ ticketId: 'previous', createdAt: '2026-08-24T18:00:00.000Z' }),
      ticket({ ticketId: 'wrong-window', createdAt: '2026-08-25T10:00:00.000Z' }),
      ticket({ ticketId: 'current', createdAt: '2026-08-25T18:00:00.000Z' }),
    ]).dayComparison;

    expect(result).toMatchObject({ current: 1, previous: 1, delta: 0, figure: '1 → 1 · 0 · —' });
    expect(result.caption).toContain('This stays on today when another week is selected.');
    expect(result.caption).toContain("yesterday's count is at least 5");
    expect(result.unavailableNote).toBeNull();
  });

  test('prints only today with an explanation when the mirror has no earlier day', () => {
    const result = report([
      ticket({ ticketId: 'today', createdAt: '2026-08-25T18:00:00.000Z' }),
    ]).dayComparison;

    expect(result).toMatchObject({ current: 1, previous: null, delta: null, figure: '1' });
    expect(result.unavailableNote).toContain('no comparable earlier period');
  });
});

describe('the selected range against its preceding range', () => {
  test('uses the selected number of whole weeks at every preset and stops at now', () => {
    const latestWeekStart = weekStartMs(NOW.getTime());

    for (const selectedWeeks of [4, 12, 26, 52]) {
      const periodMs = selectedWeeks * WEEK;
      const rangeStartMs = latestWeekStart - (selectedWeeks - 1) * WEEK;
      const previousStartMs = rangeStartMs - periodMs;
      const result = report(
        [
          ticket({
            ticketId: `horizon-${selectedWeeks}`,
            tsStatus: 'doing',
            createdAt: new Date(previousStartMs).toISOString(),
          }),
          ticket({
            ticketId: `previous-${selectedWeeks}`,
            createdAt: new Date(previousStartMs + 1).toISOString(),
          }),
          ticket({
            ticketId: `current-${selectedWeeks}`,
            createdAt: new Date(rangeStartMs + 1).toISOString(),
          }),
          ticket({
            ticketId: `future-${selectedWeeks}`,
            createdAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
          }),
        ],
        selectedWeeks
      );

      expect(result.range.selectedWeeks).toBe(selectedWeeks);
      expect(result.rangeComparison).toMatchObject({
        current: 1,
        previous: 1,
        delta: 0,
        figure: '1 → 1 · 0 · —',
        unavailableNote: null,
      });
    }
  });

  test('suppresses only when the preceding span starts before the mirror horizon', () => {
    const latestWeekStart = weekStartMs(NOW.getTime());
    const comparison = (selectedWeeks: number, horizonWeeks: number) =>
      report(
        [
          ticket({
            ticketId: `horizon-${selectedWeeks}`,
            tsStatus: 'doing',
            createdAt: new Date(latestWeekStart - (horizonWeeks - 1) * WEEK).toISOString(),
          }),
          ticket({
            ticketId: `current-${selectedWeeks}`,
            createdAt: new Date(
              latestWeekStart - (selectedWeeks - 1) * WEEK + 1
            ).toISOString(),
          }),
        ],
        selectedWeeks
      ).rangeComparison;

    expect(comparison(4, 34).previous).toBe(0);
    expect(comparison(12, 34).previous).toBe(0);
    expect(comparison(26, 34).previous).toBeNull();
    expect(comparison(52, 55).previous).toBeNull();
    expect(comparison(26, 34).unavailableNote).toContain('no comparable earlier period');
  });
});

describe('week boundaries', () => {
  test('splits two adjacent minutes across the Monday boundary in Vietnam time', () => {
    // Sun 23:59 and Mon 00:00 in +07:00 — the whole timezone decision, in two minutes.
    const result = report([
      ticket({ ticketId: 'sunday', doneAt: '2026-08-23T16:59:00Z' }),
      ticket({ ticketId: 'monday', doneAt: '2026-08-23T17:00:00Z' }),
    ]);

    expect(weekByKey(result, '2026-W34').done).toBe(1);
    expect(weekByKey(result, '2026-W35').done).toBe(1);
  });

  test('labels a week by its Monday and Sunday', () => {
    expect(weekByKey(report([]), '2026-W34').label).toBe('Mon 17 Aug – Sun 23 Aug 2026');
    expect(weekByKey(report([]), '2026-W34').shortLabel).toBe('17 Aug');
  });

  test('keys a week by its ISO week-year, not its Monday calendar year', () => {
    // ISO week 1 of 2026 opens on Mon 29 Dec 2025; keying it 2025-W01 would sort
    // it before every 2025 week and print the wrong year.
    const result = aggregateWeeklyReport(
      [
        ticket({ createdAt: '2025-12-01T00:00:00+07:00', doneAt: '2025-12-29T00:00:00+07:00' }),
        // Reaches far enough back that the range on offer holds the New Year.
        ticket({ ticketId: 'anchor', createdAt: '2025-07-01T00:00:00+07:00', doneAt: null }),
      ],
      { weeks: 52, now: NOW, year: 2025 }
    );

    const week = weekByKey(result, '2026-W01');
    expect(week.done).toBe(1);
    expect(week.label).toBe('Mon 29 Dec 2025 – Sun 4 Jan 2026');
  });
});

describe('cohorts', () => {
  test('counts a never-done ticket as outstanding in every week of the range', () => {
    const result = report([ticket({ createdAt: '2026-01-01T00:00:00+07:00', doneAt: null })]);
    for (const week of result.weeks) expect(week.outstanding).toBe(1);
  });

  test('drops a ticket out of outstanding in the week after it was done', () => {
    const result = report([
      ticket({ createdAt: '2026-01-01T00:00:00+07:00', doneAt: '2026-08-19T00:00:00+07:00' }),
    ]);

    expect(weekByKey(result, '2026-W34').done).toBe(1);
    expect(weekByKey(result, '2026-W34').outstanding).toBe(0);
    expect(weekByKey(result, '2026-W33').outstanding).toBe(1);
  });

  test('excludes a deleted ticket from every cohort and counts it', () => {
    const result = report([
      ticket({ createdAt: '2026-08-18T00:00:00+07:00', deletedAt: '2026-08-20T00:00:00+07:00' }),
    ]);

    expect(result.excluded.deleted).toBe(1);
    for (const week of result.weeks) {
      expect(week.created + week.outstanding + week.done).toBe(0);
      expect(week.categories).toEqual([]);
      expect(week.priorities).toEqual([]);
    }
  });

  test('keeps a non-dev ticket out of every figure and names that exclusion', () => {
    const result = report([
      ticket({ ticketId: 'not-dev', tsStatus: 'doing', createdAt: '2026-08-18T09:00:00+07:00' }),
    ]);

    expect(result.openRightNow).toBe(1);
    expect(result.devFixOpenRightNow).toBe(0);
    expect(result.excluded.notDevFix).toBe(1);
    expect(result.openBacklog.total).toBe(0);
    expect(result.weeks.reduce((total, week) => total + week.created + week.done, 0)).toBe(0);
  });

  test('counts a deleted non-dev ticket only as deleted', () => {
    const result = report([
      ticket({
        ticketId: 'deleted-not-dev',
        tsStatus: 'doing',
        deletedAt: '2026-08-20T00:00:00+07:00',
      }),
    ]);

    expect(result.excluded.deleted).toBe(1);
    expect(result.excluded.notDevFix).toBe(0);
  });

  test('counts a closed ticket with no done date as outstanding and as a ghost', () => {
    const result = report([
      ticket({
        ticketStatus: 'closed',
        tsStatus: 'dev_done',
        createdAt: '2026-08-01T00:00:00+07:00',
        doneAt: null,
      }),
    ]);

    for (const week of result.weeks) {
      expect(week.closedWithoutDoneAt).toBeLessThanOrEqual(week.outstanding);
    }
    expect(weekByKey(result, '2026-W34').outstanding).toBe(1);
    expect(weekByKey(result, '2026-W34').closedWithoutDoneAt).toBe(1);
    expect(weekByKey(result, '2026-W34').done).toBe(0);
  });

  test('emits the already-subtracted remainder so a stacked column totals outstanding', () => {
    const result = report([
      ticket({ ticketId: 'ghost', ticketStatus: 'closed', createdAt: '2026-07-01T00:00:00+07:00', doneAt: null }),
      ticket({ ticketId: 'live', createdAt: '2026-07-01T00:00:00+07:00', doneAt: null }),
      ticket({ ticketId: 'finished', createdAt: '2026-07-01T00:00:00+07:00', doneAt: '2026-08-05T00:00:00+07:00' }),
    ]);

    for (const week of result.weeks) {
      expect(week.outstandingWithDoneDate + week.closedWithoutDoneAt).toBe(week.outstanding);
    }
    expect(weekByKey(result, '2026-W34').outstandingWithDoneDate).toBe(1);
  });

  test('excludes a ticket whose date is present but unparseable, and names no NaN week', () => {
    const result = report([
      ticket({ ticketId: 'bad-created', createdAt: 'yesterday' }),
      ticket({ ticketId: 'bad-done', createdAt: '2026-08-01T00:00:00+07:00', doneAt: '0000-00-00' }),
      ticket({ ticketId: 'good', createdAt: '2026-08-18T00:00:00+07:00', doneAt: null }),
    ]);

    expect(result.excluded.unparseableDate).toBe(2);
    for (const week of result.weeks) {
      expect(week.key).not.toMatch(/NaN/);
      expect(week.outstanding).toBeLessThanOrEqual(1);
    }
    // Only the parseable ticket reaches a week; the other two reach none at all.
    expect(result.weeks.reduce((total, week) => total + week.created, 0)).toBe(1);
    expect(weekByKey(result, '2026-W34').created).toBe(1);
    expect(weekByKey(result, '2026-W34').outstanding).toBe(1);
  });

  test('reports the ghost population both ways and stays silent when there are none', () => {
    const withGhosts = report([
      ticket({ ticketId: 'g1', ticketStatus: 'closed', createdAt: '2026-08-01T00:00:00+07:00', doneAt: null }),
      ticket({ ticketId: 'g2', ticketStatus: 'closed', createdAt: '2026-08-01T00:00:00+07:00', doneAt: null }),
      ticket({
        ticketId: 'c1',
        ticketStatus: 'closed',
        createdAt: '2026-08-01T00:00:00+07:00',
        doneAt: '2026-08-10T00:00:00+07:00',
      }),
      ticket({ ticketId: 'o1', createdAt: '2026-08-01T00:00:00+07:00', doneAt: null }),
    ]);

    expect(withGhosts.ghosts.count).toBe(2);
    expect(withGhosts.ghosts.caveat).toContain('2 finished tickets carry no done date');
    // Both ghosts are outstanding at the latest week, and reported again there.
    expect(withGhosts.weeks[withGhosts.weeks.length - 1]?.closedWithoutDoneAt).toBe(2);

    // One ghost reads as a sentence, not as `1 finished tickets carry`.
    const single = report([
      ticket({ ticketId: 'g1', ticketStatus: 'closed', createdAt: '2026-08-01T00:00:00+07:00', doneAt: null }),
    ]);
    expect(single.ghosts.caveat).toContain('1 finished ticket carries no done date');

    const clean = report([ticket({ createdAt: '2026-08-01T00:00:00+07:00', doneAt: null })]);
    expect(clean.ghosts.count).toBe(0);
    expect(clean.ghosts.caveat).toBeNull();
  });

  test('words the residue as the addend the tile prints, week by week', () => {
    const result = report([
      ticket({ ticketId: 'g1', ticketStatus: 'closed', createdAt: '2026-08-17T09:00:00+07:00', doneAt: null }),
      ticket({ ticketId: 'g2', ticketStatus: 'closed', createdAt: '2026-08-24T09:00:00+07:00', doneAt: null }),
    ]);

    // The tile shows one week at a time, so its caveat counts that week's own
    // residue: one ghost had not been created yet in the week before.
    expect(weekByKey(result, '2026-W34').outstandingCaveat).toBe(
      '+1 ticket closed with no done date'
    );
    expect(weekByKey(result, '2026-W35').outstandingCaveat).toBe(
      '+2 tickets closed with no done date'
    );

    // The line is an addend, so it must add up: headline plus residue is the
    // total the tile no longer prints.
    const week = weekByKey(result, '2026-W35');
    expect(week.outstandingWithDoneDate + week.closedWithoutDoneAt).toBe(week.outstanding);
  });

  test('leaves a week with no residue a single figure and no addend', () => {
    const result = report([
      ticket({ ticketId: 'a', ticketStatus: 'open', createdAt: '2026-08-17T09:00:00+07:00', doneAt: null }),
    ]);

    const week = weekByKey(result, '2026-W34');
    expect(week.closedWithoutDoneAt).toBe(0);
    expect(week.outstandingCaveat).toBeNull();
    expect(week.outstandingWithDoneDate).toBe(week.outstanding);
  });
});

describe('accounting identities', () => {
  const tickets = [
    ticket({ ticketId: 'a', subject: 'point balance wrong', createdAt: '2026-08-17T09:00:00+07:00', priority: 'high' }),
    ticket({
      ticketId: 'b',
      subject: 'widget css broken',
      createdAt: '2026-08-10T09:00:00+07:00',
      doneAt: '2026-08-18T09:00:00+07:00',
      tsStatus: 'dev_done',
      priority: 'low',
    }),
    ticket({
      ticketId: 'c',
      subject: 'klaviyo sync failing',
      createdAt: '2026-06-01T09:00:00+07:00',
      doneAt: '2026-08-20T09:00:00+07:00',
      tsStatus: 'dev_done',
      priority: null,
    }),
    ticket({ ticketId: 'd', subject: 'nothing matches here', createdAt: '2026-08-19T09:00:00+07:00' }),
    ticket({
      ticketId: 'e',
      ticketStatus: 'closed',
      subject: 'coupon code rejected',
      createdAt: '2026-05-05T09:00:00+07:00',
      doneAt: null,
    }),
  ];
  const result = report(tickets);

  test('every breakdown sums to the week total it splits', () => {
    for (const week of result.weeks) {
      const sum = (rows: Array<{ done: number; outstanding: number }>, field: 'done' | 'outstanding') =>
        rows.reduce((total, row) => total + row[field], 0);

      expect(sum(week.categories, 'done')).toBe(week.done);
      expect(sum(week.categories, 'outstanding')).toBe(week.outstanding);
      expect(sum(week.priorities, 'done')).toBe(week.done);
      expect(sum(week.priorities, 'outstanding')).toBe(week.outstanding);
      expect(week.doneByStatus.reduce((total, row) => total + row.count, 0)).toBe(week.done);
      expect(week.outstandingWithDoneDate + week.closedWithoutDoneAt).toBe(week.outstanding);
    }
  });

  test('a ticket done inside the range lands in exactly one week', () => {
    for (const source of tickets) {
      if (!source.doneAt) continue;
      const holding = result.weeks.filter((week) =>
        week.doneByStatus.some((row) => row.status === source.tsStatus)
      );
      expect(holding.length).toBe(1);
    }
    expect(result.weeks.reduce((total, week) => total + week.done, 0)).toBe(2);
  });

  test('the seven day rows sum to the week they split', () => {
    for (const week of result.weeks) {
      expect(week.days.reduce((total, day) => total + (day.created ?? 0), 0)).toBe(week.created);
      expect(week.days.reduce((total, day) => total + (day.done ?? 0), 0)).toBe(week.done);
    }
  });
});

describe('unknown values', () => {
  test('gives an absent priority its own row rather than dropping the ticket', () => {
    const result = report([
      ticket({ createdAt: '2026-08-18T09:00:00+07:00', priority: null, doneAt: null }),
    ]);

    const week = weekByKey(result, '2026-W34');
    expect(week.priorities).toEqual([
      { priority: '(no priority)', label: 'No priority', done: 0, outstanding: 1 },
    ]);
  });

  test('labels a priority in sentence case', () => {
    const result = report([
      ticket({ createdAt: '2026-08-18T09:00:00+07:00', priority: 'high', doneAt: null }),
    ]);

    const week = weekByKey(result, '2026-W34');
    expect(week.priorities).toEqual([
      { priority: 'high', label: 'High', done: 0, outstanding: 1 },
    ]);
  });

  test('renders the two dev-fix status labels in sentence case', () => {
    const result = report([
      ticket({ ticketId: 'fixing', tsStatus: 'dev_fixing', doneAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'done', tsStatus: 'dev_done', doneAt: '2026-08-20T09:00:00+07:00' }),
    ]);

    const week = weekByKey(result, '2026-W34');
    const labels = Object.fromEntries(week.doneByStatus.map((row) => [row.status, row.label]));
    expect(labels.dev_fixing).toBe('Dev fixing');
    expect(labels.dev_done).toBe('Dev done');
    expect(week.done).toBe(2);
  });

  test('gives every classified ticket a category row carrying a printable label', () => {
    // Deliberately no assertion on which category names exist or how many there
    // are: the classifier owns both, and both change without this test's help.
    const result = report([
      ticket({ ticketId: 'one', subject: 'point balance wrong', createdAt: '2026-08-18T09:00:00+07:00', doneAt: null }),
      ticket({ ticketId: 'two', subject: 'zzzz nothing matches this', createdAt: '2026-08-19T09:00:00+07:00', doneAt: null }),
    ]);

    const week = weekByKey(result, '2026-W34');
    expect(week.categories.reduce((total, row) => total + row.outstanding, 0)).toBe(2);
    for (const row of week.categories) {
      expect(row.category.length).toBeGreaterThan(0);
      expect(row.label.length).toBeGreaterThan(0);
    }
  });

  test('pins the catch-all category last however many categories there are', () => {
    const result = report([
      ticket({ ticketId: 'unmatched-1', subject: 'zzzz nothing matches this', createdAt: '2026-08-18T09:00:00+07:00', doneAt: null }),
      ticket({ ticketId: 'unmatched-2', subject: 'qqqq nor does this', createdAt: '2026-08-18T09:00:00+07:00', doneAt: null }),
      ticket({ ticketId: 'matched', subject: 'point balance wrong', createdAt: '2026-08-18T09:00:00+07:00', doneAt: null }),
    ]);

    const rows = weekByKey(result, '2026-W34').categories.map((row) => row.category);
    // The catch-all outweighs the matched row 2:1 and is still last, which is
    // the whole point — it never leads a panel.
    expect(rows.indexOf(FALLBACK_CATEGORY)).toBe(rows.length - 1);
  });
});

describe('time to first done', () => {
  test('keeps the percentage absent for an empty sample while retaining its explanation', () => {
    const result = report([]);
    expect(result.timeToFirstDone.withinTwoDaysNote).toBeNull();
    expect(result.timeToFirstDone.caption).toContain('48 hours');
    expect(result.timeToFirstDone.caption).toContain('automatic');
  });

  test('buckets a same-day finish as one day or less', () => {
    const result = report([
      ticket({ createdAt: '2026-08-18T09:00:00+07:00', doneAt: '2026-08-18T10:00:00+07:00' }),
    ]);

    expect(result.timeToFirstDone.sampleSize).toBe(1);
    expect(result.timeToFirstDone.buckets[0]).toEqual({ label: '≤ 1 day', count: 1 });
    expect(result.timeToFirstDone.medianDays).toBe(0);
    expect(result.timeToFirstDone.withinTwoDaysNote).toContain('1 of 1 finished ticket (100%)');
  });

  test('clamps a done date before its created date to zero instead of dropping it', () => {
    const result = report([
      ticket({ createdAt: '2026-08-18T09:00:00+07:00', doneAt: '2026-08-17T09:00:00+07:00' }),
    ]);

    expect(result.timeToFirstDone.sampleSize).toBe(1);
    expect(result.timeToFirstDone.buckets[0]?.count).toBe(1);
    expect(result.timeToFirstDone.medianDays).toBe(0);
  });

  test('counts a done ticket with no created date as unmeasurable', () => {
    const result = report([
      ticket({ createdAt: null, doneAt: '2026-08-18T09:00:00+07:00' }),
    ]);

    expect(result.timeToFirstDone.unmeasurable).toBe(1);
    expect(result.timeToFirstDone.sampleSize).toBe(0);
    expect(result.timeToFirstDone.medianDays).toBeNull();
  });

  test('takes the midpoint of an even-sized sample', () => {
    const ages = [0, 2, 5, 20];
    const opened = '2026-08-03T00:00:00+07:00';
    const result = report(
      ages.map((days, index) =>
        ticket({
          ticketId: `age-${index}`,
          createdAt: opened,
          doneAt: new Date(Date.parse(opened) + days * 86400000).toISOString(),
        })
      )
    );

    expect(result.timeToFirstDone.sampleSize).toBe(4);
    // Middle two are 2 and 5.
    expect(result.timeToFirstDone.medianDays).toBe(3.5);
    expect(result.timeToFirstDone.buckets.map((bucket) => bucket.count)).toEqual([1, 1, 1, 0, 1, 0]);
  });

  test('includes exactly 48 hours and excludes one millisecond beyond it', () => {
    const createdAt = Date.parse('2026-08-17T09:00:00+07:00');
    const result = report([
      ticket({
        ticketId: 'boundary',
        createdAt: new Date(createdAt).toISOString(),
        doneAt: new Date(createdAt + 48 * 60 * 60 * 1000).toISOString(),
      }),
      ticket({
        ticketId: 'outside',
        createdAt: new Date(createdAt).toISOString(),
        doneAt: new Date(createdAt + 48 * 60 * 60 * 1000 + 1).toISOString(),
      }),
    ]);

    expect(result.timeToFirstDone.withinTwoDaysNote).toContain(
      '1 of 2 finished tickets (50%)'
    );
  });
});

describe('resolution speed per week', () => {
  test('keeps empty weeks as empty samples and words the empty range', () => {
    const result = report([]);

    expect(result.weeks).toHaveLength(12);
    for (const week of result.weeks) {
      expect(week.medianDaysToDone).toBeNull();
      expect(week.doneSample).toBe(0);
    }
    expect(result.weeklySpeed.caption.length).toBeGreaterThan(0);
    expect(result.weeklySpeed.emptyWeeksNote).toContain('12 of the 12 weeks');
  });

  test('puts a single finish in its done week and nowhere else', () => {
    const result = report([
      ticket({ ticketId: 'history-anchor', createdAt: '2026-05-01T09:00:00+07:00', doneAt: null }),
      ticket({
        ticketId: 'finished',
        createdAt: '2026-08-17T09:00:00+07:00',
        doneAt: '2026-08-19T09:00:00+07:00',
      }),
    ]);

    const finished = weekByKey(result, '2026-W34');
    expect(finished.medianDaysToDone).toBe(2);
    expect(finished.doneSample).toBe(1);
    expect(result.weeks.filter((week) => week.key !== '2026-W34').every(
      (week) => week.medianDaysToDone === null && week.doneSample === 0
    )).toBe(true);
    expect(result.weeklySpeed.emptyWeeksNote).toContain('11 of the 12 weeks');
  });

  test('cohorts speed by done week, never created week', () => {
    const result = report([
      ticket({ ticketId: 'history-anchor', createdAt: '2026-05-01T09:00:00+07:00', doneAt: null }),
      ticket({
        ticketId: 'finished',
        createdAt: '2026-07-20T09:00:00+07:00',
        doneAt: '2026-08-18T09:00:00+07:00',
      }),
    ]);

    expect(weekByKey(result, '2026-W30').doneSample).toBe(0);
    expect(weekByKey(result, '2026-W30').medianDaysToDone).toBeNull();
    expect(weekByKey(result, '2026-W34').doneSample).toBe(1);
    expect(weekByKey(result, '2026-W34').medianDaysToDone).toBe(29);
  });

  test('averages the middle two ages for an even sample', () => {
    const doneAt = Date.parse('2026-08-19T09:00:00+07:00');
    const result = report([
      ticket({ ticketId: 'one', createdAt: new Date(doneAt - 86400000).toISOString(), doneAt: new Date(doneAt).toISOString() }),
      ticket({ ticketId: 'four', createdAt: new Date(doneAt - 4 * 86400000).toISOString(), doneAt: new Date(doneAt).toISOString() }),
    ]);

    expect(weekByKey(result, '2026-W34').medianDaysToDone).toBe(2.5);
    expect(weekByKey(result, '2026-W34').doneSample).toBe(2);
  });

  test('leaves tickets with no done date out of every weekly speed sample', () => {
    const result = report([ticket({ createdAt: '2026-08-18T09:00:00+07:00', doneAt: null })]);
    expect(result.weeks.every((week) => week.doneSample === 0)).toBe(true);
  });

  test('clamps a done date before creation to zero', () => {
    const result = report([
      ticket({ createdAt: '2026-08-19T09:00:00+07:00', doneAt: '2026-08-18T09:00:00+07:00' }),
    ]);
    expect(weekByKey(result, '2026-W34').medianDaysToDone).toBe(0);
  });
});

describe('the weekly speed sample', () => {
  test('words the sample every week stands on, including none and one', () => {
    const result = report([
      ticket({
        ticketId: 'one',
        ticketStatus: 'closed',
        createdAt: '2026-08-17T09:00:00+07:00',
        doneAt: '2026-08-18T09:00:00+07:00',
      }),
    ]);

    expect(weekByKey(result, '2026-W34').doneSampleLabel).toBe('n=1');
    expect(weekByKey(result, '2026-W33').doneSampleLabel).toBe('n=0');
  });

  test('keeps the sample label agreeing with the sample it names', () => {
    const doneAt = '2026-08-18T09:00:00+07:00';
    const result = weekByKey(
      report(
        [1, 2].map((days) =>
          ticket({
            ticketId: `done-${days}`,
            ticketStatus: 'closed',
            createdAt: new Date(Date.parse(doneAt) - days * 86400000).toISOString(),
            doneAt,
          })
        )
      ),
      '2026-W34'
    );

    expect(result.doneSample).toBe(2);
    expect(result.doneSampleLabel).toBe('n=2');
  });

  test('says what n counts, since the strip prints it under every week', () => {
    expect(report([]).weeklySpeed.caption).toContain(
      "Each week's n is how many finished tickets its median is measured over."
    );
  });
});

describe('the open backlog', () => {
  test('keeps every structural row in an empty report', () => {
    const result = report([]).openBacklog;
    expect(result.total).toBe(0);
    expect(result.agingHeadline).toBeNull();
    expect(result.buckets).toEqual([
      { label: '< 7 days', count: 0 },
      { label: '7–30 days', count: 0 },
      { label: '31–90 days', count: 0 },
      { label: 'over 90 days', count: 0 },
    ]);
    expect(result.oldest).toEqual([]);
    expect(result.noCreatedDate).toBe(0);
  });

  test('words and buckets a single old ticket', () => {
    const result = report([
      ticket({ ticketId: 'old', createdAt: new Date(NOW.getTime() - 200 * 86400000).toISOString() }),
    ]).openBacklog;
    expect(result.total).toBe(1);
    expect(result.buckets.map((bucket) => bucket.count)).toEqual([0, 0, 0, 1]);
    expect(result.oldest).toHaveLength(1);
    expect(result.oldest[0]).toMatchObject({ ageDays: 200, ageLabel: '200 days' });
    expect(result.agingHeadline).toContain(
      '100% of the 1 open Dev Fixing or Dev Done ticket with a readable created date is older than 30 days.'
    );
  });

  test('labels the age buckets disjointly, so no ticket reads as being in two', () => {
    // A 30-day-old ticket is counted once. The labels have to say where.
    const result = report(
      [30, 31].map((days) =>
        ticket({
          ticketId: `age-${days}`,
          createdAt: new Date(NOW.getTime() - days * 86400000).toISOString(),
        })
      )
    ).openBacklog;

    expect(result.buckets).toEqual([
      { label: '< 7 days', count: 0 },
      { label: '7–30 days', count: 1 },
      { label: '31–90 days', count: 1 },
      { label: 'over 90 days', count: 0 },
    ]);
  });

  test('uses inclusive upper bounds for the four age buckets', () => {
    const result = report(
      [6, 7, 30, 90].map((days) =>
        ticket({
          ticketId: `age-${days}`,
          createdAt: new Date(NOW.getTime() - days * 86400000).toISOString(),
        })
      )
    ).openBacklog;
    expect(result.buckets.map((bucket) => bucket.count)).toEqual([1, 2, 1, 0]);
  });

  test('keeps undated tickets out of the age share instead of counting them as young', () => {
    // One known-old ticket and one with no date is not "50% older than 30 days":
    // the undated one is unmeasured, not measured as young.
    const result = report([
      ticket({
        ticketId: 'old',
        createdAt: new Date(NOW.getTime() - 60 * 86400000).toISOString(),
      }),
      ticket({ ticketId: 'undated', createdAt: null }),
    ]).openBacklog;

    expect(result.agingHeadline).toBe(
      '100% of the 1 open Dev Fixing or Dev Done ticket with a readable created date is older than 30 days. ' +
        '1 more has no readable created date.'
    );
    expect(result.total).toBe(2);
  });

  test('says so when no open ticket has a readable created date at all', () => {
    const result = report([
      ticket({ ticketId: 'absent', createdAt: null }),
      ticket({ ticketId: 'unreadable', createdAt: 'not a date' }),
    ]).openBacklog;

    expect(result.agingHeadline).toBe(
      'No open Dev Fixing or Dev Done ticket has a readable created date, so no age share can be measured.'
    );
  });

  test('names absent and unreadable created dates without putting them in a bucket', () => {
    const result = report([
      ticket({ ticketId: 'absent', createdAt: null }),
      ticket({ ticketId: 'unreadable', createdAt: 'not a date' }),
    ]).openBacklog;
    expect(result.noCreatedDate).toBe(2);
    expect(result.buckets.every((bucket) => bucket.count === 0)).toBe(true);
    expect(result.oldest).toEqual([]);
  });

  test('uses the panel merchant fallback chain and trims blank values', () => {
    const result = report([
      ticket({ ticketId: 'shop', createdAt: '2026-01-01T00:00:00Z', store: [{ shopName: ' Shop ' }] }),
      ticket({ ticketId: 'domain', createdAt: '2026-01-02T00:00:00Z', store: [{ shopName: '  ', domain: ' domain.test ' }] }),
      ticket({ ticketId: 'store-domain', createdAt: '2026-01-03T00:00:00Z', storeDomains: [' fallback.test '] }),
      ticket({ ticketId: 'absent', createdAt: '2026-01-04T00:00:00Z' }),
    ]).openBacklog;
    expect(result.oldest.map((row) => row.merchant)).toEqual([
      'Shop',
      'domain.test',
      'fallback.test',
      '(no merchant)',
    ]);
  });

  test('keeps a closed ghost out of the all-open backlog', () => {
    const result = report([
      ticket({ ticketId: 'ghost', ticketStatus: 'closed', createdAt: '2026-01-01T00:00:00Z', doneAt: null }),
    ]);
    expect(result.ghosts.count).toBe(1);
    expect(result.openBacklog.total).toBe(0);
  });
});

describe('open tickets by plan', () => {
  test('is empty without open tickets', () => {
    expect(report([]).openByPlan).toEqual({ rows: [], freeNote: null });
  });

  test('names a single free row with singular grammar', () => {
    const result = report([ticket({ appPlan: 'free' })]).openByPlan;
    expect(result.rows).toEqual([{ key: 'free', label: 'Free', count: 1 }]);
    expect(result.freeNote).toContain('1 of 1 open Dev Fixing or Dev Done ticket');
  });

  test('pins the absent plan last even when it is the largest row', () => {
    const result = report([
      ticket({ ticketId: 'paid', appPlan: 'advanced_2026' }),
      ticket({ ticketId: 'none-1', appPlan: null }),
      ticket({ ticketId: 'none-2', appPlan: '  ' }),
    ]).openByPlan;
    expect(result.rows.map((row) => row.key)).toEqual(['advanced_2026', '(no plan)']);
    expect(result.rows[0]?.label).toBe('Advanced 2026');
  });

  test('does not infer a free group when the literal free value is absent', () => {
    expect(report([ticket({ appPlan: 'trial' })]).openByPlan.freeNote).toBeNull();
  });
});

describe('open tickets by merchant', () => {
  test('groups one merchant spelled two ways into a single row', () => {
    // Two rows for one merchant push a real merchant out of the top five and
    // lower the concentration figure this panel exists to report.
    const result = report([
      ticket({ ticketId: 'a', store: [{ shopName: 'Hegen' }] }),
      ticket({ ticketId: 'b', store: [{ shopName: 'HEGEN' }] }),
      ticket({ ticketId: 'c', store: [{ shopName: ' hegen  store ' }] }),
      ticket({ ticketId: 'd', store: [{ shopName: 'Hegen Store' }] }),
    ]).openByMerchant;

    expect(result.rows).toEqual([
      { key: 'hegen', label: 'Hegen', count: 2 },
      { key: 'hegen store', label: 'hegen  store', count: 2 },
    ]);
    expect(result.concentrationNote).toContain(
      '4 of 4 open Dev Fixing or Dev Done tickets right now (100%)'
    );
  });


  test('words the empty case and keeps no tail', () => {
    const result = report([]).openByMerchant;
    expect(result.rows).toEqual([]);
    expect(result.concentrationNote.length).toBeGreaterThan(0);
    expect(result.tailNote).toBeNull();
    expect(result.tailCount).toBe(0);
  });

  test('words a single named merchant and no tail', () => {
    const result = report([ticket({ store: [{ shopName: 'Only Shop' }] })]).openByMerchant;
    expect(result.rows).toEqual([{ key: 'only shop', label: 'Only Shop', count: 1 }]);
    expect(result.concentrationNote).toContain(
      'The busiest merchant holds 1 of 1 open Dev Fixing or Dev Done ticket'
    );
    expect(result.tailNote).toBeNull();
  });

  test('appends the absent row after the five ranked merchants', () => {
    const merchants = ['A', 'B', 'C', 'D', 'E', 'F'].map((shopName) =>
      ticket({ ticketId: shopName, store: [{ shopName }] })
    );
    const absent = [1, 2, 3].map((number) => ticket({ ticketId: `absent-${number}` }));
    const result = report([...merchants, ...absent]).openByMerchant;
    expect(result.rows.map((row) => row.label)).toEqual(['A', 'B', 'C', 'D', 'E', '(no merchant)']);
    expect(result.rows.at(-1)?.count).toBe(3);
    expect(result.concentrationNote).toContain('5 busiest merchants');
    expect(result.tailNote).toContain('1 merchant');
    expect(result.tailCount).toBe(1);
  });

  test('uses the trimmed merchant fallback chain at panel level', () => {
    const result = report([
      ticket({ ticketId: 'shop', store: [{ shopName: ' Shop ' }] }),
      ticket({ ticketId: 'domain', store: [{ shopName: ' ', domain: ' domain.test ' }] }),
      ticket({ ticketId: 'fallback', storeDomains: [' fallback.test '] }),
      ticket({ ticketId: 'absent' }),
    ]).openByMerchant;
    expect(result.rows.map((row) => row.label)).toEqual([
      'domain.test',
      'fallback.test',
      'Shop',
      '(no merchant)',
    ]);
  });
});

describe('open tickets by feature', () => {
  test('is empty but keeps its server-worded caption', () => {
    const result = report([]).openByFeature;
    expect(result.rows).toEqual([]);
    expect(result.caption.length).toBeGreaterThan(0);
  });

  test('compares each existing row with its own preceding-range count', () => {
    const copies = (count: number, prefix: string, subject: string, createdAt: string) =>
      Array.from({ length: count }, (_, index) =>
        ticket({ ticketId: `${prefix}-${index}`, subject, createdAt })
      );
    const result = report(
      [
        ticket({
          ticketId: 'horizon',
          ticketStatus: 'closed',
          subject: 'nothing matches',
          createdAt: '2026-06-01T00:00:00.000Z',
          doneAt: '2026-06-02T00:00:00.000Z',
        }),
        ...copies(5, 'widget-before', 'widget broken', '2026-07-06T00:00:00.000Z'),
        ...copies(10, 'widget-now', 'widget broken', '2026-08-03T00:00:00.000Z'),
        ...copies(2, 'points-before', 'point balance wrong', '2026-07-06T00:00:00.000Z'),
        ...copies(3, 'points-now', 'point balance wrong', '2026-08-03T00:00:00.000Z'),
        ...copies(4, 'earning-now', 'birthday earning', '2026-08-03T00:00:00.000Z'),
        ...copies(9, 'email-before', 'email notification', '2026-07-06T00:00:00.000Z'),
      ],
      4
    ).openByFeature;
    const figures = Object.fromEntries(
      result.rows.map((row) => [row.key, row.comparison.figure])
    );

    expect(figures.WIDGET).toBe('5 → 10 · +5 (+100%)');
    expect(figures.POINTS).toBe('2 → 3 · +1 · —');
    expect(figures['EARNING RULES']).toBe('0 → 4 · +4');
    expect(figures['EMAIL / NOTIFY']).toBe('9 → 0 · -9 (-100%)');
    expect(result.unavailableNote).toBeNull();
    expect(result.caption).toContain('earlier count is at least 5');
  });

  test('keeps the existing open-backlog sort instead of sorting by current intake', () => {
    const result = report(
      [
        ...Array.from({ length: 10 }, (_, index) =>
          ticket({
            ticketId: `widget-${index}`,
            subject: 'widget broken',
            createdAt: '2026-07-06T00:00:00.000Z',
          })
        ),
        ...Array.from({ length: 5 }, (_, index) =>
          ticket({
            ticketId: `points-${index}`,
            subject: 'point balance wrong',
            createdAt: '2026-08-03T00:00:00.000Z',
          })
        ),
      ],
      4
    ).openByFeature;

    expect(result.rows.map((row) => row.key).slice(0, 2)).toEqual(['WIDGET', 'POINTS']);
    expect(result.rows[0]?.comparison.current).toBe(0);
    expect(result.rows[1]?.comparison.current).toBe(5);
  });

  test('explains when every feature lacks a comparable earlier period', () => {
    const result = report([
      ticket({ ticketId: 'current', subject: 'widget broken', createdAt: '2026-08-03T00:00:00.000Z' }),
    ], 4).openByFeature;

    expect(result.rows[0]?.comparison.previous).toBeNull();
    expect(result.rows[0]?.comparison.figure).toBe('1');
    expect(result.unavailableNote).toContain('no comparable earlier period');
  });

  test('shows one old open ticket with no speed sample', () => {
    const result = report([
      ticket({ createdAt: new Date(NOW.getTime() - 60 * 86400000).toISOString() }),
    ]).openByFeature;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      open: 1,
      olderThan30: 1,
      medianDaysToDone: null,
      doneSample: 0,
      speedNote: '0 finished tickets in range · median —',
    });
  });

  test('suppresses a one-ticket median and prints the sample before it', () => {
    const open = Array.from({ length: 5 }, (_, index) =>
      ticket({ ticketId: `open-${index}`, subject: 'widget broken', doneAt: null })
    );
    const result = report([
      ...open,
      ticket({
        ticketId: 'done',
        ticketStatus: 'closed',
        subject: 'widget broken',
        createdAt: '2026-06-18T09:00:00+07:00',
        doneAt: '2026-08-18T09:00:00+07:00',
      }),
    ]).openByFeature.rows[0];
    expect(result).toMatchObject({ open: 5, doneSample: 1, medianDaysToDone: null });
    expect(result?.speedNote).toBe('1 finished ticket in range · median —');
  });

  test('shows the median once the sample reaches three tickets', () => {
    const doneAt = Date.parse('2026-08-18T09:00:00+07:00');
    const result = report(
      [1, 2, 4].map((days) =>
        ticket({
          ticketId: `done-${days}`,
          ticketStatus: 'closed',
          subject: 'widget broken',
          createdAt: new Date(doneAt - days * 86400000).toISOString(),
          doneAt: new Date(doneAt).toISOString(),
        })
      )
    ).openByFeature.rows[0];
    expect(result).toMatchObject({ doneSample: 3, medianDaysToDone: 2 });
    expect(result?.speedNote).toBe('3 finished tickets in range · median 2 d');
  });

  test('ages a feature over its dated open tickets and names the rest', () => {
    const result = report([
      ticket({
        ticketId: 'old',
        subject: 'widget broken',
        createdAt: new Date(NOW.getTime() - 60 * 86400000).toISOString(),
      }),
      ticket({ ticketId: 'undated', subject: 'widget broken', createdAt: null }),
    ]).openByFeature;

    expect(result.rows[0]).toMatchObject({
      open: 2,
      openWithCreatedDate: 1,
      olderThan30: 1,
    });
    expect(result.caption).toContain('1 open ticket has no readable created date');
  });

  test('includes a feature present only in the done cohort', () => {
    const result = report([
      ticket({
        ticketStatus: 'closed',
        subject: 'point balance wrong',
        createdAt: '2026-08-15T09:00:00+07:00',
        doneAt: '2026-08-18T09:00:00+07:00',
      }),
    ]).openByFeature.rows[0];
    expect(result).toMatchObject({ open: 0, doneSample: 1, medianDaysToDone: null });
  });

  test('pins the classifier catch-all last even when it is the largest', () => {
    const result = report([
      ticket({ ticketId: 'other-1', subject: 'zzzz no match' }),
      ticket({ ticketId: 'other-2', subject: 'qqqq no match' }),
      ticket({ ticketId: 'points', subject: 'point balance wrong' }),
    ]).openByFeature.rows;
    expect(result.at(-1)?.key).toBe(FALLBACK_CATEGORY);
  });

  test('uses a strict older-than-30-days boundary', () => {
    const result = report([
      ticket({ ticketId: 'thirty', createdAt: new Date(NOW.getTime() - 30 * 86400000).toISOString() }),
      ticket({ ticketId: 'thirty-one', createdAt: new Date(NOW.getTime() - 31 * 86400000).toISOString() }),
    ]).openByFeature.rows[0];
    expect(result).toMatchObject({ open: 2, olderThan30: 1 });
  });

  test('uses the same selected-range boundary as time to first done', () => {
    const result = report([
      ticket({ ticketId: 'open', subject: 'widget broken', doneAt: null }),
      ticket({
        ticketId: 'just-outside',
        ticketStatus: 'closed',
        subject: 'widget broken',
        createdAt: '2026-05-01T09:00:00+07:00',
        doneAt: '2026-06-07T16:59:59.999Z',
      }),
    ]);
    const feature = result.openByFeature.rows.find((row) => row.open === 1);
    expect(feature?.doneSample).toBe(0);
    expect(result.timeToFirstDone.sampleSize).toBe(0);
  });
});

const WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * `weeks` tickets, one per week, ending in the week `NOW` falls in — an unbroken
 * run of weeks the mirror holds tickets for. Each is created and done in the
 * same instant so the run measures coverage without also moving any cohort.
 */
function weeklyHistory(weeks: number): HelpDeskTicket[] {
  return Array.from({ length: weeks }, (_, index) => {
    const created = new Date(NOW.getTime() - index * WEEK).toISOString();
    return ticket({ ticketId: `history-${index}`, createdAt: created, doneAt: created });
  });
}

describe('the horizon the mirror can answer for', () => {
  test('keeps preset availability independent of dev-fix membership', () => {
    const old = '2026-01-05T09:00:00+07:00';
    const devFix = report([ticket({ ticketId: 'anchor', createdAt: old })]).range;
    const notDevFix = report([
      ticket({ ticketId: 'anchor', tsStatus: 'doing', createdAt: old }),
    ]).range;

    expect(notDevFix.presets).toEqual(devFix.presets);
    expect(notDevFix.selectedWeeks).toBe(devFix.selectedWeeks);
    expect(notDevFix.coverageNote).toBe(devFix.coverageNote);
  });

  test('withholds a preset the history cannot nearly fill, and keeps one it can', () => {
    // 24 weeks of unbroken history: 26 weeks is three columns short and fills
    // itself within a month, 52 weeks is half empty and never would.
    const presets = report(weeklyHistory(24), 12).range.presets;

    expect(presets.map((preset) => preset.weeks)).toEqual([4, 12, 26, 52]);
    expect(presets.map((preset) => preset.available)).toEqual([true, true, true, false]);

    // Six weeks of history leaves only the shortest preset with something to draw.
    const short = report(weeklyHistory(6), 12).range.presets;
    expect(short.map((preset) => preset.available)).toEqual([true, false, false, false]);
  });

  test('offers the longest preset once the history reaches it', () => {
    const presets = report(weeklyHistory(48), 12).range.presets;
    expect(presets.map((preset) => preset.available)).toEqual([true, true, true, true]);
  });

  test('clamps a request to the longest range the history can answer', () => {
    expect(report(weeklyHistory(24), 52).range.selectedWeeks).toBe(26);
    expect(report(weeklyHistory(48), 52).range.selectedWeeks).toBe(52);
  });

  test('measures the horizon from a done date when that is the only date a ticket has', () => {
    // A ticket with a done date and no created date is deliberately counted: it
    // lands in the done cohort of the week its done date falls in. A horizon
    // read from created dates alone left that week outside every range on
    // offer, so the completion showed up in no week, in no exclusion count, and
    // the note called the one surviving created date the mirror's earliest.
    const result = aggregateWeeklyReport(
      [
        ticket({ ticketId: 'done-only', createdAt: null, doneAt: '2026-04-01T00:00:00+07:00' }),
        ticket({ ticketId: 'open-only', createdAt: '2026-08-18T09:00:00+07:00', doneAt: null }),
      ],
      { weeks: 52, now: NOW, year: YEAR }
    );

    expect(result.weeks[0]?.key).toBe('2026-W10');
    expect(weekByKey(result, '2026-W14').done).toBe(1);
    expect(result.weeks.reduce((total, week) => total + week.done, 0)).toBe(1);
    expect(result.range.coverageNote).toContain('1 Apr 2026');
  });

  test('does not call the earliest date a creation date when it came from a done date', () => {
    const result = report([
      ticket({ ticketId: 'done-only', createdAt: null, doneAt: '2026-04-01T00:00:00+07:00' }),
    ]);

    expect(result.range.coverageNote).toContain('1 Apr 2026');
    expect(result.range.coverageNote).not.toContain('created');
  });

  test('names the date the mirror\'s history starts', () => {
    // NOW is Wed 26 Aug 2026; 23 weeks before it is Wed 18 Mar 2026.
    expect(report(weeklyHistory(24), 12).range.coverageNote).toContain(
      'The mirror reaches back to 18 Mar 2026'
    );
  });

  test('a week with nothing in it does not cut the history short', () => {
    // 30 weeks of history with one silent week in the middle. A week in which
    // nobody opened a ticket is an answer, and cannot be told apart from an
    // unfetched week by counting tickets — so counting it as absence used to
    // truncate coverage at the gap and withhold ranges the mirror can answer.
    const withGap = weeklyHistory(30).filter((_, index) => index !== 10);
    const quiet = report(withGap, 52);

    expect(quiet.range.selectedWeeks).toBe(26);
    expect(quiet.range.presets.map((preset) => preset.available)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(quiet.range.coverageNote).toContain('quiet week, not missing data');

    // The same history with no gap answers identically: the gap changes nothing.
    expect(report(weeklyHistory(30), 52).range.selectedWeeks).toBe(26);
  });

  test('measures back to the oldest ticket it holds, however alone that ticket is', () => {
    const outlier = ticket({
      ticketId: 'outlier',
      createdAt: new Date(NOW.getTime() - 40 * WEEK).toISOString(),
      doneAt: null,
    });
    const result = report([outlier, ...weeklyHistory(24)], 52);

    // The mirror does hold that week, so the note says so and the span reaches
    // it. 41 weeks is still short of 52, which stays withheld.
    expect(result.range.coverageNote).toContain('19 Nov 2025');
    expect(result.range.selectedWeeks).toBe(26);
    expect(result.range.presets.map((preset) => preset.available)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    for (const week of result.weeks) expect(week.outstanding).toBeGreaterThanOrEqual(1);
  });

  test('names the pull window only when there is no ticket at all to measure from', () => {
    // One ticket from January and nothing since is not an unmeasurable mirror:
    // it covers January onward, and those weeks are empty rather than unknown.
    const january = report([ticket({ createdAt: '2026-01-05T00:00:00+07:00' })], 12);
    expect(january.range.coverageNote).toContain('5 Jan 2026');
    expect(january.range.selectedWeeks).toBe(12);

    // An empty mirror has nothing to measure, so the note says what was asked for.
    expect(report([], 12).range.coverageNote).toContain('created in 2026');
  });
});

describe('range and fixed strings', () => {
  test('clamps the requested weeks to a preset and echoes what it used', () => {
    expect(report([], 12).range.selectedWeeks).toBe(12);
    expect(report([], 7).range.selectedWeeks).toBe(4);
    // 52 weeks reach back past 1 Jan 2026, which the mirror cannot answer for.
    expect(report([], 999).range.selectedWeeks).toBe(26);
    expect(report([], Number.NaN).range.selectedWeeks).toBe(12);
    expect(report([], 12).weeks.length).toBe(12);
  });

  test('marks a preset unavailable when the pull window is shorter than it', () => {
    // The mirror holds 2026 only, and the clock is in week 35 of it.
    const presets = report([]).range.presets;
    expect(presets.map((preset) => preset.weeks)).toEqual([4, 12, 26, 52]);
    expect(presets.map((preset) => preset.available)).toEqual([true, true, true, false]);
  });

  test('names the pull window the coverage note was built from', () => {
    expect(report([]).range.coverageNote).toContain('created in 2026');
    expect(report([]).range.coverageNote).toContain('before 1 Jan 2026');
  });

  test('carries the rules and captions the page renders verbatim', () => {
    const result = report([]);
    expect(result.bugRule).toContain('Dev Fixing or Dev Done');
    expect(result.bugRule).toContain('Weekly, day, range and feature figures');
    // The rule is the date, not a list of statuses: `tsStatus` is open-ended, so
    // any enumerated list in this sentence is one release from being untrue.
    expect(result.doneRule).toContain('reached a done state in HelpDesk at any point');
    expect(result.doneRule).not.toContain('Dev Done');
    expect(result.timeToFirstDone.caption).toContain('not time to customer delivery');
    for (const week of result.weeks) {
      expect(week.outstandingCaption).toContain('open Dev Fixing or Dev Done right now');
    }
  });

  test('counts open tickets live, over the whole mirror rather than a week', () => {
    const result = report([
      ticket({ ticketId: 'open-1' }),
      ticket({ ticketId: 'open-2' }),
      ticket({ ticketId: 'closed-1', ticketStatus: 'closed', doneAt: '2026-08-18T09:00:00+07:00' }),
    ]);

    expect(result.openRightNow).toBe(2);
    expect(result.devFixOpenRightNow).toBe(2);
  });
});

describe('the fixture', () => {
  test('accounts for every ticket it holds', () => {
    const fixture = loadFixtureTickets();
    // The fixture is a real pull, so expectations are derived from it rather than
    // hardcoded — `bun run fixture:pull` fetches whichever tickets are open then.
    const result = aggregateWeeklyReport(fixture, {
      weeks: 52,
      now: NOW,
      year: YEAR,
    });

    const deleted = fixture.filter((t) => typeof t.deletedAt === 'string' && t.deletedAt.trim() !== '');
    expect(result.excluded.deleted).toBe(deleted.length);
    expect(result.openRightNow).toBe(fixture.filter((t) => t.ticketStatus === 'open').length);
    expect(result.devFixOpenRightNow).toBe(
      fixture.filter(
        (t) =>
          t.ticketStatus === 'open' &&
          typeof t.tsStatus === 'string' &&
          ['dev_fixing', 'dev_done'].includes(t.tsStatus.trim())
      ).length
    );

    const inRange = fixture.filter((t) => {
      const created = t.createdAt ? Date.parse(t.createdAt) : Number.NaN;
      return (
        !Number.isNaN(created) &&
        created >= Date.parse('2025-09-01T00:00:00Z') &&
        typeof t.tsStatus === 'string' &&
        ['dev_fixing', 'dev_done'].includes(t.tsStatus.trim())
      );
    });
    // Every in-window ticket reaches a cohort: it was created in some week of the
    // range, so it is counted there and nowhere lost.
    expect(result.weeks.reduce((total, week) => total + week.created, 0)).toBe(
      inRange.length
    );

    for (const week of result.weeks) {
      expect(week.key).not.toMatch(/NaN/);
      expect(week.categories.reduce((t, row) => t + row.outstanding, 0)).toBe(week.outstanding);
      expect(week.outstandingWithDoneDate + week.closedWithoutDoneAt).toBe(week.outstanding);
    }
  });
});

describe('boundary instants', () => {
  test('counts a ticket created on the boundary instant in exactly one week', () => {
    // Mon 00:00 +07:00 is the instant a week opens and the instant the week
    // before it closes. A half-open window counts it once; an inclusive upper
    // bound would count the same ticket as created in both weeks, and the
    // created column would out-total the tickets that exist.
    const result = report([ticket({ ticketId: 'edge', createdAt: '2026-08-23T17:00:00.000Z' })]);

    expect(result.weeks.reduce((total, week) => total + week.created, 0)).toBe(1);
    expect(weekByKey(result, '2026-W35').created).toBe(1);
    expect(weekByKey(result, '2026-W34').created).toBe(0);
  });

  test('counts a ticket done on the boundary instant in exactly one week', () => {
    const result = report([
      ticket({ ticketId: 'edge', createdAt: '2026-08-01T00:00:00+07:00', doneAt: '2026-08-23T17:00:00.000Z' }),
    ]);

    expect(result.weeks.reduce((total, week) => total + week.done, 0)).toBe(1);
    expect(weekByKey(result, '2026-W35').done).toBe(1);
    // Still outstanding at the end of the week before it was finished.
    expect(weekByKey(result, '2026-W34').outstanding).toBe(1);
  });
});

describe('week keys across a year boundary', () => {
  test('gives every week in a year-long range a key of its own', () => {
    // A repeated key would collide as a React key, and `find(key)` would focus
    // the wrong week's numbers under another week's label.
    const result = report(weeklyHistory(52), 52);
    const keys = result.weeks.map((week) => week.key);

    expect(result.range.selectedWeeks).toBe(52);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe('2025-W36');
    expect(keys.at(-1)).toBe('2026-W35');
  });

  test('numbers the 53rd week of a 53-week ISO year rather than restarting at 1', () => {
    // 2026 is a 53-week ISO year. Rolling over to `2027-W01` a week early would
    // put two different weeks under one key inside a single range.
    const now = new Date('2027-01-06T03:00:00.000Z');
    const result = aggregateWeeklyReport(weeklyHistoryEndingAt(6, now), {
      weeks: 4,
      now,
      year: 2026,
    });

    expect(result.weeks.map((week) => week.key)).toEqual([
      '2026-W51',
      '2026-W52',
      '2026-W53',
      '2027-W01',
    ]);
    expect(result.weeks[2]?.label).toBe('Mon 28 Dec 2026 – Sun 3 Jan 2027');
  });
});

describe('the panels agree with each other', () => {
  /**
   * The backlog stock and the created/done flows are drawn as two panels on one
   * x-axis, so they have to be two readings of the same movement: whatever a
   * week created and did not finish is exactly what its backlog gained. An
   * off-by-one in any of the three windows breaks this and nothing else.
   *
   * It holds for any ticket whose done date is not before its created date;
   * `wholeDaysBetween` clamps that case for the histogram, but a ticket finished
   * before it existed belongs to no coherent flow and is left out here.
   */
  test('moves the backlog by exactly the week its created minus its done', () => {
    const result = report([
      ticket({ ticketId: 'spans', createdAt: '2026-06-10T09:00:00+07:00', doneAt: '2026-07-02T09:00:00+07:00' }),
      ticket({ ticketId: 'same-week', createdAt: '2026-07-02T09:00:00+07:00', doneAt: '2026-07-02T18:00:00+07:00' }),
      ticket({ ticketId: 'never-done', createdAt: '2026-08-01T09:00:00+07:00', doneAt: null }),
      ticket({ ticketId: 'ghost', ticketStatus: 'closed', createdAt: '2026-06-20T09:00:00+07:00', doneAt: null }),
      ticket({ ticketId: 'latest', createdAt: '2026-08-24T00:00:00+07:00', doneAt: '2026-08-25T09:00:00+07:00' }),
    ]);

    for (const [index, week] of result.weeks.entries()) {
      if (index === 0) continue;
      const previous = result.weeks[index - 1];
      expect({
        key: week.key,
        movement: week.outstanding - (previous?.outstanding ?? 0),
      }).toEqual({ key: week.key, movement: week.created - week.done });
    }
  });

  test('accounts for every open ticket in the age panel and the live tile', () => {
    const result = report([
      ticket({ ticketId: 'young', createdAt: '2026-08-24T09:00:00+07:00' }),
      ticket({ ticketId: 'old', createdAt: '2026-03-01T09:00:00+07:00' }),
      ticket({ ticketId: 'undated', createdAt: null, doneAt: '2026-08-20T09:00:00+07:00' }),
      ticket({ ticketId: 'unreadable', createdAt: 'not a date' }),
      ticket({ ticketId: 'deleted', createdAt: '2026-05-01T09:00:00+07:00', deletedAt: '2026-06-01T09:00:00+07:00' }),
      ticket({ ticketId: 'closed', ticketStatus: 'closed', createdAt: '2026-04-01T09:00:00+07:00', doneAt: '2026-04-03T09:00:00+07:00' }),
    ]);
    const summed = result.openBacklog.buckets.reduce((total, bucket) => total + bucket.count, 0);
    expect(summed + result.openBacklog.noCreatedDate).toBe(result.openRightNow);
    expect(result.openBacklog.total).toBe(result.openRightNow);
  });

  test('accounts for every open ticket in the plan and merchant rows', () => {
    const result = report([
      ticket({ ticketId: 'a', appPlan: 'free', store: [{ shopName: 'A' }] }),
      ticket({ ticketId: 'b', appPlan: null, store: [{ shopName: 'B' }] }),
      ticket({ ticketId: 'c', appPlan: 'pro', store: [{ shopName: 'C' }] }),
      ticket({ ticketId: 'd', appPlan: 'pro', store: [{ shopName: 'D' }] }),
      ticket({ ticketId: 'e', appPlan: 'pro', store: [{ shopName: 'E' }] }),
      ticket({ ticketId: 'f', appPlan: 'pro', store: [{ shopName: 'F' }] }),
      ticket({ ticketId: 'absent', appPlan: 'free' }),
    ]);
    expect(result.openByPlan.rows.reduce((total, row) => total + row.count, 0)).toBe(
      result.openBacklog.total
    );
    const noMerchant = result.openByMerchant.rows.find((row) => row.key === '(no merchant)')?.count ?? 0;
    const topFive = result.openByMerchant.rows
      .filter((row) => row.key !== '(no merchant)')
      .reduce((total, row) => total + row.count, 0);
    expect(topFive + result.openByMerchant.tailCount + noMerchant).toBe(result.openBacklog.total);
  });

  test('accounts for every open ticket in the feature rows', () => {
    const result = report([
      ticket({ ticketId: 'widget', subject: 'widget broken' }),
      ticket({ ticketId: 'points', subject: 'point balance wrong' }),
      ticket({ ticketId: 'other', subject: 'zzzz no match' }),
    ]);
    expect(result.openByFeature.rows.reduce((total, row) => total + row.open, 0)).toBe(
      result.openBacklog.total
    );
  });
});

describe('bucket boundaries', () => {
  test('puts an age exactly on a bucket bound inside that bucket, not the next one', () => {
    // Every label names an inclusive upper bound, so `≤ 1 day` has to hold a
    // one-day-old ticket. An exclusive test would shift five ages one bucket
    // right and still produce a plausible-looking histogram.
    const opened = Date.parse('2026-07-06T09:00:00+07:00');
    const onBound: Array<[number, string]> = [
      [0, '≤ 1 day'],
      [1, '≤ 1 day'],
      [3, '2–3 days'],
      [7, '4–7 days'],
      [14, '8–14 days'],
      [30, '15–30 days'],
      [31, 'over 30 days'],
    ];

    for (const [days, label] of onBound) {
      const result = report(
        [
          ticket({
            createdAt: new Date(opened).toISOString(),
            doneAt: new Date(opened + days * 86400000).toISOString(),
          }),
        ],
        26
      );

      expect(result.timeToFirstDone.sampleSize).toBe(1);
      expect(result.timeToFirstDone.medianDays).toBe(days);
      expect(result.timeToFirstDone.buckets.filter((bucket) => bucket.count > 0)).toEqual([
        { label, count: 1 },
      ]);
    }
  });

  test('leaves a ticket finished after the range out of the sample entirely', () => {
    // A done date past the current week — clock skew, or a date typed by hand —
    // has no column to sit in, and must not silently widen the histogram either.
    const result = report([
      ticket({ createdAt: '2026-08-01T00:00:00+07:00', doneAt: '2026-09-10T00:00:00+07:00' }),
    ]);

    expect(result.timeToFirstDone.sampleSize).toBe(0);
    expect(result.timeToFirstDone.unmeasurable).toBe(0);
    expect(result.timeToFirstDone.buckets.every((bucket) => bucket.count === 0)).toBe(true);
  });
});

describe('the week that has not finished yet', () => {
  test('words the running week differently from the ones behind it', () => {
    const result = report([]);
    const current = result.weeks[result.weeks.length - 1];
    const previous = result.weeks[result.weeks.length - 2];
    if (!current || !previous) throw new Error('the range must hold at least two weeks');

    // Its Sunday has not happened, so no figure on it can be an end-of-week one.
    expect(current.tileLabels.outstanding).not.toContain('week end');
    expect(current.outstandingCaption).not.toContain('historical');
    expect(current.label).toContain('in progress');
    expect(current.inProgress).toBe(true);

    // Every finished week keeps the end-of-week wording.
    expect(previous.tileLabels.outstanding).toContain('week end');
    expect(previous.outstandingCaption).toContain('historical');
    expect(previous.label).not.toContain('in progress');
    expect(previous.inProgress).toBe(false);
  });

  test('says week-to-date on the created and done tiles of the running week', () => {
    const result = report([]);
    const current = result.weeks[result.weeks.length - 1];
    const previous = result.weeks[result.weeks.length - 2];
    if (!current || !previous) throw new Error('the range must hold at least two weeks');

    expect(current.tileLabels.created).toContain('so far');
    expect(current.tileLabels.done).toContain('so far');
    expect(previous.tileLabels.created).not.toContain('so far');
    expect(previous.tileLabels.done).not.toContain('so far');
  });

  test('flags exactly one week, the last, and agrees with the wording on it', () => {
    // The page picks which week to land on from this boolean and prints these
    // strings beside the figures. Nothing keeps the two in step but this test:
    // if they part, the report either lands on a partial week or titles a
    // finished one "so far". Landing also assumes the running week is the last
    // one in the array, which is asserted here rather than in the browser.
    const result = report([], 26);
    const running = result.weeks.filter((week) => week.inProgress);

    expect(running).toHaveLength(1);
    expect(running[0]).toBe(result.weeks[result.weeks.length - 1]);

    for (const week of result.weeks) {
      expect(week.label.includes('in progress')).toBe(week.inProgress);
      expect(week.tileLabels.created.includes('so far')).toBe(week.inProgress);
      expect(week.tileLabels.done.includes('so far')).toBe(week.inProgress);
      expect(week.tileLabels.outstanding.includes('week end')).toBe(!week.inProgress);
      expect(week.outstandingCaption.includes('has not finished')).toBe(week.inProgress);
    }
  });
});

describe('a ticket that belongs to no week', () => {
  test('names a ticket with neither a created nor a done date instead of losing it', () => {
    // It can be placed in no week, so it reaches no total, no category row and
    // no priority row — while still being counted in the live open figure. If
    // nothing names it, the page shows an outstanding count of 0 beside an open
    // count of 1 and a caption explaining a difference that is not the cause.
    const result = report([
      ticket({ ticketId: 'undated', createdAt: null, doneAt: null, ticketStatus: 'open' }),
    ]);

    expect(result.excluded.undated).toBe(1);
    expect(result.openRightNow).toBe(1);
    for (const week of result.weeks) {
      expect(week.created).toBe(0);
      expect(week.done).toBe(0);
      expect(week.outstanding).toBe(0);
      expect(week.categories).toHaveLength(0);
      expect(week.priorities).toHaveLength(0);
    }
  });

  test('keeps the three exclusion reasons apart', () => {
    const result = report([
      ticket({ ticketId: 'gone', deletedAt: '2026-08-01T00:00:00+07:00' }),
      ticket({ ticketId: 'garbled', createdAt: 'not a date' }),
      ticket({ ticketId: 'undated', createdAt: null, doneAt: null }),
      ticket({ ticketId: 'fine', createdAt: '2026-08-18T09:00:00+07:00' }),
    ]);

    expect(result.excluded).toEqual({
      deleted: 1,
      unparseableDate: 1,
      undated: 1,
      notDevFix: 0,
    });
    // A ticket with a done date but no created date still belongs to a week.
    const dated = report([
      ticket({ ticketId: 'done-only', createdAt: null, doneAt: '2026-08-18T09:00:00+07:00' }),
    ]);
    expect(dated.excluded.undated).toBe(0);
    expect(weekByKey(dated, '2026-W34').done).toBe(1);
  });
});

describe('the strings the page prints', () => {
  test('keeps forbidden performance language out of the whole payload', () => {
    const populated = report([
      ticket({ ticketId: 'open', createdAt: '2026-08-18T09:00:00+07:00', doneAt: null }),
      ticket({
        ticketId: 'done',
        createdAt: '2026-08-17T09:00:00+07:00',
        doneAt: '2026-08-18T09:00:00+07:00',
      }),
    ]);
    const fixture = aggregateWeeklyReport(loadFixtureTickets(), {
      weeks: 52,
      now: NOW,
      year: YEAR,
    });

    for (const payload of [report([]), populated, fixture]) {
      expect(
        serverWordedStrings(payload).filter((value) => FORBIDDEN_LANGUAGE.test(value))
      ).toEqual([]);
    }
  });

  test('reads whole words, so customer text holding a banned substring passes', () => {
    // The payload carries customer text: a ticket subject and a merchant name.
    // A substring guard reads `Slate` as an SLA claim and fails with an
    // assertion naming no cause — whose obvious repair is to delete the guard.
    const values = payloadStrings(
      report([
        ticket({
          ticketId: 'slate',
          subject: 'Slate translation request',
          store: [{ shopName: 'Slate' }],
        }),
      ])
    );

    expect(values).toContain('Slate translation request');
    expect(values).toContain('Slate');
    expect(values.filter((value) => FORBIDDEN_LANGUAGE.test(value))).toEqual([]);

    // And it still catches the real thing, standing on its own.
    expect(
      ['SLA', 'we are overdue', 'a breach of the agreement', 'missed the deadline'].filter(
        (value) => FORBIDDEN_LANGUAGE.test(value)
      )
    ).toHaveLength(4);
  });

  test('lets a merchant write a banned word into a subject or a store name', () => {
    // The payload relays two fields verbatim: the subject of each of the five
    // oldest open tickets, and the merchant names on the concentration rows.
    // The five oldest are exactly the tickets most likely to have been chased
    // with the word `overdue`, and nothing stops a store calling itself
    // `Breach Co`. Neither is this codebase making a performance claim.
    const result = report([
      ticket({
        ticketId: 'chased',
        subject: 'this ticket is overdue',
        createdAt: '2026-03-04T09:00:00+07:00',
        store: [{ shopName: 'Breach Co' }],
      }),
    ]);

    // The banned words really did reach the payload, in all four relayed fields.
    expect(result.openBacklog.oldest[0]?.subject).toBe('this ticket is overdue');
    expect(result.openBacklog.oldest[0]?.merchant).toBe('Breach Co');
    expect(result.openByMerchant.rows[0]?.label).toBe('Breach Co');
    expect(result.openByMerchant.rows[0]?.key).toBe('breach co');
    expect(payloadStrings(result).filter((value) => FORBIDDEN_LANGUAGE.test(value))).toHaveLength(
      4
    );

    // And the guard walks past all four, because it wrote none of them.
    expect(serverWordedStrings(result).filter((value) => FORBIDDEN_LANGUAGE.test(value))).toEqual(
      []
    );
  });

  test('still catches a banned word in server wording, wherever it sits', () => {
    // The exclusion is a hole cut in the walk, so it has to be exactly the shape
    // of the four relayed fields: server wording one key away from each of them,
    // at every depth the payload has, is still caught.
    const payload = report([
      ticket({
        ticketId: 'open',
        createdAt: '2026-08-18T09:00:00+07:00',
        store: [{ shopName: 'Hegen' }],
      }),
    ]);
    const planted: WeeklyReport = {
      ...payload,
      doneRule: 'Done means the SLAs were met',
      weeklySpeed: { ...payload.weeklySpeed, caption: 'Two breaches this week' },
      openByMerchant: {
        ...payload.openByMerchant,
        concentrationNote: 'The busiest merchant missed three deadlines',
      },
      openBacklog: {
        ...payload.openBacklog,
        oldestCaption: 'The five oldest, most overdue first',
        buckets: payload.openBacklog.buckets.map((bucket, index) =>
          index === 0 ? { ...bucket, label: `${bucket.label}, breached` } : bucket
        ),
      },
    };

    expect(
      serverWordedStrings(planted)
        .filter((value) => FORBIDDEN_LANGUAGE.test(value))
        .sort()
    ).toEqual(
      [
        'Done means the SLAs were met',
        'Two breaches this week',
        'The busiest merchant missed three deadlines',
        'The five oldest, most overdue first',
        `${payload.openBacklog.buckets[0]?.label}, breached`,
      ].sort()
    );

    // The inflections plain prose reaches for, still read as whole words.
    expect(
      ['SLAs', 'deadlines', 'breaches', 'breached', 'breaching'].filter((value) =>
        FORBIDDEN_LANGUAGE.test(value)
      )
    ).toHaveLength(5);
    expect(
      ['TRANSLATION', 'Slate', 'Slates', 'breachable'].filter((value) =>
        FORBIDDEN_LANGUAGE.test(value)
      )
    ).toEqual([]);
  });

  test('excludes only paths the payload actually carries', () => {
    // An excluded path that no longer resolves is a hole the guard holds open
    // over a field that has since been renamed or moved — silently, and forever.
    const paths = payloadEntries(
      report([
        ticket({
          ticketId: 'one',
          createdAt: '2026-03-04T09:00:00+07:00',
          store: [{ shopName: 'Hegen' }],
        }),
      ])
    ).map(([path]) => path);

    for (const excluded of CUSTOMER_TEXT_PATHS) {
      expect(paths).toContain(excluded);
    }
  });

  test('names the running week in the backlog heading instead of promising a week end', () => {
    // The range always reaches the week holding `now`, whose Sunday has not
    // happened. A heading saying "at each week end" over a Tuesday value
    // contradicts the column label sitting right beneath it.
    const result = report([ticket({ createdAt: '2026-08-18T09:00:00+07:00' })]);

    expect(result.weeks[result.weeks.length - 1]?.label).toContain('in progress');
    expect(result.backlogTitle).toBe('Backlog at each week end, and so far this week');
  });

  test('lets each all-open panel carry its own scope rather than the divider', () => {
    // The divider no longer claims the range does not reach this section, so a
    // panel below it that is all-open has to say so in its own words.
    const result = report([
      ticket({ ticketId: 'free', appPlan: 'free', store: [{ shopName: 'Hegen' }] }),
    ]);

    expect(result.openByPlan.freeNote).toContain('right now');
    expect(result.openByMerchant.concentrationNote).toContain('right now');
  });

  test('names the all-open scope, its count and the mirror reach-back date', () => {
    const empty = report([]);
    expect(empty.openSectionTitle).toContain('0 tickets');
    expect(empty.openSectionTitle).toContain('0 are marked Dev Fixing or Dev Done');
    expect(empty.openSectionTitle).toContain('1 Jan 2026');

    const single = report([
      ticket({ ticketId: 'one', createdAt: '2026-03-04T09:00:00+07:00' }),
    ]);
    expect(single.openSectionTitle).toContain('1 ticket');
    expect(single.openSectionTitle).not.toContain('1 tickets');
    expect(single.openSectionTitle).toContain('1 is marked Dev Fixing or Dev Done');
    expect(single.openSectionTitle).toContain('4 Mar 2026');
    // The divider heads a section holding a range-scoped speed column, so it
    // claims nothing about the range; each panel below carries its own scope.
    expect(single.openSectionTitle).not.toContain('Not affected by');
    expect(single.openSectionTitle).not.toContain('range');
  });

  test('words the exclusion footnote, and does not call an undated open ticket uncounted', () => {
    const result = report([
      ticket({ ticketId: 'gone', deletedAt: '2026-08-01T00:00:00+07:00', ticketStatus: 'closed' }),
      ticket({ ticketId: 'garbled', createdAt: 'not a date', ticketStatus: 'closed' }),
      ticket({ ticketId: 'undated', createdAt: null, doneAt: null, ticketStatus: 'open' }),
    ]);

    expect(result.excludedNote).toContain('1 deleted ticket');
    expect(result.excludedNote).toContain('1 ticket with an unreadable date');
    expect(result.excludedNote).toContain('1 ticket with neither a created nor a done date');
    // It reaches no week, but it is in the live open figure printed above it,
    // so the page must not say it was not counted.
    expect(result.excludedNote).toContain('open right now');
    expect(result.excludedNote).not.toContain('Not counted');
    expect(result.openRightNow).toBe(1);
  });

  test('has no exclusion footnote at all when nothing was excluded', () => {
    const result = report([ticket({ createdAt: '2026-08-18T09:00:00+07:00' })]);

    expect(result.excluded).toEqual({
      deleted: 0,
      unparseableDate: 0,
      undated: 0,
      notDevFix: 0,
    });
    expect(result.excludedNote).toBeNull();
  });

  test('names tickets outside the dev-fix figures and keeps both open totals visible', () => {
    const result = report([
      ticket({ ticketId: 'dev', tsStatus: 'dev_fixing' }),
      ticket({ ticketId: 'other', tsStatus: 'doing' }),
    ]);

    expect(result.openRightNow).toBe(2);
    expect(result.devFixOpenRightNow).toBe(1);
    expect(result.excludedNote).toContain(
      '1 dated ticket has another HelpDesk status and sits outside the Dev Fixing and Dev Done figures.'
    );
    expect(result.openSectionTitle).toContain('All open tickets right now — 2 tickets.');
    expect(result.openSectionTitle).toContain('1 is marked Dev Fixing or Dev Done');
  });

  test('blames the span for a withheld preset, not a gap in the history', () => {
    // A gap is not missing data — the coverage note says so on the same screen,
    // so the reason a preset is withheld cannot be discontinuity.
    const presets = report(weeklyHistory(6), 12).range.presets;

    expect(presets[0]?.unavailableNote).toBeNull();
    expect(presets[1]?.unavailableNote).toBe(
      'The mirror spans 6 weeks, which is not enough for a range of 12 weeks: most of it would be empty.'
    );
    expect(presets[3]?.unavailableNote).toContain('range of 52 weeks');
    for (const preset of presets) {
      expect(preset.unavailableNote ?? '').not.toContain('continuous');
    }
  });
});

describe('what counts as history, and what counts as open', () => {
  test('measures history from the oldest ticket however stale the newest one is', () => {
    // The mirror is pulled on demand, so the newest ticket sitting in last week
    // is ordinary. Treating that as "no history" swapped the measured note for
    // the pull-window one on any quiet week.
    const lastWeek = report([
      ticket({ createdAt: new Date(NOW.getTime() - WEEK).toISOString(), doneAt: null }),
    ]);
    expect(lastWeek.range.coverageNote).toContain('19 Aug 2026');

    // Two weeks stale is just as measurable: how recently the mirror was pulled
    // is not what decides which weeks it can answer for.
    const older = report([
      ticket({ createdAt: new Date(NOW.getTime() - 2 * WEEK).toISOString(), doneAt: null }),
    ]);
    expect(older.range.coverageNote).toContain('12 Aug 2026');
  });

  test('counts a ticket as open only when it says open, not merely when it is not closed', () => {
    // `ticketStatus` is not a closed enum either. An unseen third value must not
    // be counted as open, or the live figure drifts away from the board's.
    const result = report([
      ticket({ ticketId: 'open-1', ticketStatus: 'open' }),
      ticket({ ticketId: 'other', ticketStatus: 'pending' }),
      ticket({ ticketId: 'closed-1', ticketStatus: 'closed', doneAt: '2026-08-18T09:00:00+07:00' }),
    ]);

    expect(result.openRightNow).toBe(1);
    // The closed ticket carries a done date, so it is not part of the residue.
    expect(result.ghosts.count).toBe(0);
  });

  test('serves the default range when the query names no weeks at all', () => {
    // The route reads `Number(searchParams.get('weeks'))`, which is 0 when the
    // parameter is absent — not NaN. Both have to land on the default.
    expect(report([], 0).range.selectedWeeks).toBe(DEFAULT_REQUEST_WEEKS);
    expect(report([], -4).range.selectedWeeks).toBe(DEFAULT_REQUEST_WEEKS);
  });
});

/** What the aggregation falls back to when the request names no usable range. */
const DEFAULT_REQUEST_WEEKS = 12;

/** `weeklyHistory`, but for a clock other than `NOW`. */
function weeklyHistoryEndingAt(weeks: number, now: Date): HelpDeskTicket[] {
  return Array.from({ length: weeks }, (_, index) => {
    const created = new Date(now.getTime() - index * WEEK).toISOString();
    return ticket({ ticketId: `history-${index}`, createdAt: created, doneAt: created });
  });
}

/**
 * The payload paths holding text a merchant wrote, which this codebase relays
 * verbatim and does not word: ticket subjects and merchant names. A merchant who
 * chases a ticket with the word `overdue` in its subject, or a store named
 * `Breach Co`, must not turn the performance-language guard red — that failure
 * names no cause, looks like a fixture problem, and its obvious repair under
 * time pressure is to weaken the guard the whole rule rests on.
 *
 * Excluded by path rather than by value: skipping any string that happens to
 * equal a subject would also excuse a server caption that happened to match one.
 */
const CUSTOMER_TEXT_PATHS = new Set([
  'openBacklog.oldest[].subject',
  'openBacklog.oldest[].merchant',
  'openByMerchant.rows[].key',
  'openByMerchant.rows[].label',
]);

/**
 * Every string in a payload paired with the path it sits at. Array indices
 * collapse to `[]`, so one path names every row of a list.
 */
function payloadEntries(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item) => payloadEntries(item, `${path}[]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      payloadEntries(item, path ? `${path}.${key}` : key)
    );
  }
  return [];
}

/** Every string in a payload that this codebase words, rather than relays. */
function serverWordedStrings(value: unknown): string[] {
  return payloadEntries(value)
    .filter(([path]) => !CUSTOMER_TEXT_PATHS.has(path))
    .map(([, text]) => text);
}

/** Every string anywhere in a payload, so a guard can walk it structurally. */
function payloadStrings(value: unknown): string[] {
  return payloadEntries(value).map(([, text]) => text);
}

describe('the unreliable upstream fields', () => {
  test('reads none of the due or resolution-metric dates', () => {
    // `dueDate` is always `createdAt + 48h`, `dueDateDone` disagrees with the
    // done dates more often than it agrees, and the resolution-metrics done date
    // contradicts the authoritative one. Poisoning all three has to change
    // nothing: if any figure moved, something is reading them.
    const tickets = () => [
      ticket({ ticketId: 'open-old', createdAt: '2026-03-01T09:00:00+07:00' }),
      ticket({
        ticketId: 'finished',
        ticketStatus: 'closed',
        createdAt: '2026-08-10T09:00:00+07:00',
        doneAt: '2026-08-18T09:00:00+07:00',
      }),
    ];

    const poisoned = tickets().map(
      (value) =>
        ({
          ...value,
          dueDate: '2020-01-01T00:00:00+07:00',
          dueDateDone: true,
          resolutionMetrics: { ticketResolution: { doneAt: '2026-01-02T00:00:00+07:00' } },
        }) as HelpDeskTicket
    );

    expect(report(poisoned)).toEqual(report(tickets()));
  });
});

describe('the all-open panels at their edges', () => {
  test('puts a ticket opened hours ago in the youngest age bucket', () => {
    const result = report([
      ticket({ createdAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString() }),
    ]).openBacklog;
    expect(result.buckets.map((bucket) => bucket.count)).toEqual([1, 0, 0, 0]);
    expect(result.oldest[0]?.ageLabel).toBe('0 days');
  });

  test('moves the day after ninety into the last age bucket', () => {
    const result = report(
      [90, 91].map((days) =>
        ticket({
          ticketId: `age-${days}`,
          createdAt: new Date(NOW.getTime() - days * 86400000).toISOString(),
        })
      )
    ).openBacklog;
    expect(result.buckets.map((bucket) => bucket.count)).toEqual([0, 0, 1, 1]);
  });

  test('lists only the five oldest open tickets, oldest first', () => {
    const result = report(
      Array.from({ length: 7 }, (_, index) =>
        ticket({
          ticketId: `age-${index}`,
          createdAt: new Date(NOW.getTime() - (100 - index) * 86400000).toISOString(),
        })
      )
    ).openBacklog;

    expect(result.oldest.map((row) => row.ticketId)).toEqual([
      'age-0',
      'age-1',
      'age-2',
      'age-3',
      'age-4',
    ]);
    expect(result.oldest.map((row) => row.ageDays)).toEqual([100, 99, 98, 97, 96]);
  });

  test('names the five-oldest cap, and what it holds when there are fewer', () => {
    const seven = report(
      Array.from({ length: 7 }, (_, index) =>
        ticket({
          ticketId: `age-${index}`,
          createdAt: new Date(NOW.getTime() - (100 - index) * 86400000).toISOString(),
        })
      )
    ).openBacklog;
    expect(seven.oldest).toHaveLength(5);
    expect(seven.oldestCaption).toBe(
      'The 5 oldest of 7 open Dev Fixing or Dev Done tickets with a readable created date, oldest first.'
    );

    const two = report(
      [10, 20].map((days) =>
        ticket({
          ticketId: `age-${days}`,
          createdAt: new Date(NOW.getTime() - days * 86400000).toISOString(),
        })
      )
    ).openBacklog;
    expect(two.oldestCaption).toBe(
      'All 2 open Dev Fixing or Dev Done tickets with a readable created date are listed below, oldest first.'
    );

    expect(report([ticket({ ticketId: 'one' })]).openBacklog.oldestCaption).toBe(
      'The 1 open Dev Fixing or Dev Done ticket with a readable created date is listed below.'
    );
    expect(report([]).openBacklog.oldestCaption).toBe(
      'No open Dev Fixing or Dev Done ticket has a readable created date, so none is listed here.'
    );
    expect(report([ticket({ ticketId: 'undated', createdAt: null })]).openBacklog.oldestCaption).toBe(
      'No open Dev Fixing or Dev Done ticket has a readable created date, so none is listed here.'
    );
  });

  test('labels the absent plan row without inventing a plan name', () => {
    const result = report([
      ticket({ ticketId: 'null-plan', appPlan: null }),
      ticket({ ticketId: 'missing-plan' }),
    ]).openByPlan;
    expect(result.rows).toEqual([{ key: '(no plan)', label: 'No plan', count: 2 }]);
  });

  test('keeps a closed ticket out of every all-open panel', () => {
    const result = report([
      ticket({ ticketId: 'open', appPlan: 'free', subject: 'widget broken', store: [{ shopName: 'Open Shop' }] }),
      ticket({
        ticketId: 'closed',
        ticketStatus: 'closed',
        appPlan: 'advanced_2026',
        subject: 'point balance wrong',
        store: [{ shopName: 'Closed Shop' }],
        createdAt: '2026-08-10T09:00:00+07:00',
        doneAt: '2026-08-18T09:00:00+07:00',
      }),
    ]);

    expect(result.openByPlan.rows).toEqual([{ key: 'free', label: 'Free', count: 1 }]);
    expect(result.openByMerchant.rows.map((row) => row.label)).toEqual(['Open Shop']);
    expect(result.openByFeature.rows.reduce((total, row) => total + row.open, 0)).toBe(1);
  });
});

describe('the feature rows at their edges', () => {
  test('derives its rows from the tickets rather than from the whole taxonomy', () => {
    const rows = report([
      ticket({ ticketId: 'widget', subject: 'widget broken' }),
      ticket({ ticketId: 'points', subject: 'point balance wrong' }),
    ]).openByFeature.rows;

    // A hardcoded label list would print every category with a zero row.
    expect(rows).toHaveLength(2);
    expect(rows.length).toBeLessThan(CATEGORIES.length);
    for (const row of rows) expect(CATEGORIES).toContain(row.key as (typeof CATEGORIES)[number]);
  });

  test('keeps the median hidden one ticket short of the minimum sample', () => {
    const doneAt = Date.parse('2026-08-18T09:00:00+07:00');
    const row = report(
      [1, 3].map((days) =>
        ticket({
          ticketId: `done-${days}`,
          ticketStatus: 'closed',
          subject: 'widget broken',
          createdAt: new Date(doneAt - days * 86400000).toISOString(),
          doneAt: new Date(doneAt).toISOString(),
        })
      )
    ).openByFeature.rows[0];

    expect(row).toMatchObject({ doneSample: 2, medianDaysToDone: null });
    expect(row?.speedNote).toBe('2 finished tickets in range · median —');
  });
});

describe('what the weekly speed sample leaves out', () => {
  test('counts a done ticket with no created date in the week but in no median', () => {
    const result = report([
      ticket({ ticketId: 'history-anchor', createdAt: '2026-05-01T09:00:00+07:00', doneAt: null }),
      ticket({
        ticketId: 'no-created',
        ticketStatus: 'closed',
        createdAt: null,
        doneAt: '2026-08-18T09:00:00+07:00',
      }),
    ]);

    const week = weekByKey(result, '2026-W34');
    expect(week.done).toBe(1);
    expect(week.doneSample).toBe(0);
    expect(week.medianDaysToDone).toBeNull();
    expect(result.timeToFirstDone.unmeasurable).toBe(1);
  });
});

describe('the all-open panels over the real fixture', () => {
  test('accounts for every open ticket in every panel', () => {
    // Derived from the fixture, never hardcoded: `bun run fixture:pull` replaces
    // it with whichever tickets were open that day.
    const result = aggregateWeeklyReport(loadFixtureTickets(), { weeks: 52, now: NOW, year: YEAR });
    const open = result.devFixOpenRightNow;

    expect(result.openBacklog.total).toBe(open);
    expect(
      result.openBacklog.buckets.reduce((total, bucket) => total + bucket.count, 0) +
        result.openBacklog.noCreatedDate
    ).toBe(open);
    expect(result.openByPlan.rows.reduce((total, row) => total + row.count, 0)).toBe(open);

    const named = result.openByMerchant.rows.filter((row) => row.key !== '(no merchant)');
    const noMerchant = result.openByMerchant.rows.find((row) => row.key === '(no merchant)');
    expect(named.length).toBeLessThanOrEqual(5);
    expect(
      named.reduce((total, row) => total + row.count, 0) +
        result.openByMerchant.tailCount +
        (noMerchant?.count ?? 0)
    ).toBe(open);

    expect(result.openByFeature.rows.reduce((total, row) => total + row.open, 0)).toBe(open);
    expect(result.openBacklog.oldest.length).toBeLessThanOrEqual(5);
  });
});

describe('a feature label that reads like forbidden language', () => {
  test('names the translation feature without tripping the performance-word guard', () => {
    // `TRANSLATION` carries the letters `sla`. The guard has to read words, not
    // substrings, or a standing taxonomy label reads as an SLA claim.
    const values = payloadStrings(report([ticket({ subject: 'translate the widget text' })]));

    expect(values).toContain('TRANSLATION');
    expect(values.filter((value) => FORBIDDEN_LANGUAGE.test(value))).toEqual([]);
  });
});

describe('the day breakdown inside a week', () => {
  /**
   * Every fixture here is hand-built. `loadFixtureTickets()` is deliberately not
   * used: it is gitignored real customer data, so a single forward-dated ticket
   * in it would decide the null assertions below from a file that is not in git.
   */
  const MON_17 = '2026-08-17T09:00:00+07:00';
  const TUE_18 = '2026-08-18T09:00:00+07:00';
  const WED_19 = '2026-08-19T09:00:00+07:00';
  const THU_20 = '2026-08-20T09:00:00+07:00';
  const FRI_21 = '2026-08-21T09:00:00+07:00';
  // A week before the one being asserted, so a `doneAt` fixture adds no `created`
  // to the week under test.
  const PRIOR_WEEK = '2026-08-10T09:00:00+07:00';

  function created(id: string, at: string): HelpDeskTicket {
    return ticket({ ticketId: id, createdAt: at, doneAt: null });
  }

  function cleared(id: string, at: string): HelpDeskTicket {
    return ticket({ ticketId: id, createdAt: PRIOR_WEEK, doneAt: at, tsStatus: 'dev_done' });
  }

  test('names the seven days Monday first, in Vietnam time', () => {
    // The one assertion that pins weekday ordering. `localParts` uses 0 = Monday
    // while every JS date API uses 0 = Sunday, so a weekday array written in the
    // conventional order shifts every tick and every weekday word on the page by
    // one day while leaving the counts, the sums and the null rule correct. The
    // array is a literal on purpose: mapping the label helper over the same days
    // is self-referential and passes either way.
    expect(weekByKey(report([]), '2026-W34').days.map((day) => day.label)).toEqual([
      'Mon 17 Aug',
      'Tue 18 Aug',
      'Wed 19 Aug',
      'Thu 20 Aug',
      'Fri 21 Aug',
      'Sat 22 Aug',
      'Sun 23 Aug',
    ]);
  });

  test('gives every week seven day rows with labels unique inside the week', () => {
    // The label is the React key for the day panel's slots.
    for (const week of report([], 26).weeks) {
      expect(week.days).toHaveLength(7);
      expect(new Set(week.days.map((day) => day.label)).size).toBe(7);
    }
  });

  test('keeps range-wide split vocabularies stable and every positional count accounted for', () => {
    const result = report([
      ticket({ ticketId: 'widget', subject: 'widget', tsStatus: 'dev_fixing', createdAt: MON_17, doneAt: TUE_18 }),
      ticket({ ticketId: 'reward', subject: 'reward', tsStatus: 'dev_done', createdAt: MON_17, doneAt: WED_19 }),
      ticket({ ticketId: 'points', subject: 'points', tsStatus: 'dev_fixing', createdAt: TUE_18, doneAt: THU_20 }),
      ticket({ ticketId: 'earning', subject: 'birthday earning', tsStatus: 'dev_done', createdAt: WED_19, doneAt: FRI_21 }),
      ticket({ ticketId: 'tiers', subject: 'vip tier', tsStatus: 'dev_fixing', createdAt: THU_20, doneAt: FRI_21 }),
      ticket({ ticketId: 'integration', subject: 'integration', tsStatus: 'dev_done', createdAt: FRI_21, doneAt: FRI_21 }),
      ticket({ ticketId: 'email', subject: 'email', tsStatus: 'dev_fixing', createdAt: FRI_21, doneAt: FRI_21 }),
      ticket({
        ticketId: 'ghost',
        subject: 'coupon',
        ticketStatus: 'closed',
        tsStatus: 'dev_done',
        createdAt: FRI_21,
        doneAt: null,
      }),
    ]);

    expect(result.daySplit.categories.length).toBeLessThanOrEqual(6);
    expect(result.daySplit.statuses.length).toBeLessThanOrEqual(6);
    expect(result.daySplit.categories.at(-1)?.category).toBe('(remaining areas)');
    expect(result.daySplit.statuses.map((row) => row.status).sort()).toEqual([
      'dev_done',
      'dev_fixing',
    ]);
    expect(new Set(result.daySplit.categories.map((row) => row.category)).size).toBe(
      result.daySplit.categories.length
    );
    expect(new Set(result.daySplit.categories.map((row) => row.label)).size).toBe(
      result.daySplit.categories.length
    );
    expect(new Set(result.daySplit.statuses.map((row) => row.status)).size).toBe(
      result.daySplit.statuses.length
    );
    expect(new Set(result.daySplit.statuses.map((row) => row.label)).size).toBe(
      result.daySplit.statuses.length
    );

    const drawnStatuses = new Set(result.daySplit.statuses.map((row) => row.status));
    for (const week of result.weeks) {
      let statusCreated = 0;
      for (const day of week.days) {
        expect(day.createdSplit === null).toBe(day.created === null);
        expect(day.doneSplit === null).toBe(day.done === null);
        if (day.createdSplit && day.created !== null) {
          expect(day.createdSplit.category).toHaveLength(result.daySplit.categories.length);
          expect(day.createdSplit.status).toHaveLength(result.daySplit.statuses.length);
          expect(day.createdSplit.category.reduce((sum, count) => sum + count, 0)).toBe(day.created);
          statusCreated += day.createdSplit.status.reduce((sum, count) => sum + count, 0);
        }
        if (day.doneSplit && day.done !== null) {
          expect(day.doneSplit.category).toHaveLength(result.daySplit.categories.length);
          expect(day.doneSplit.status).toHaveLength(result.daySplit.statuses.length);
          expect(day.doneSplit.category.reduce((sum, count) => sum + count, 0)).toBe(day.done);
          expect(day.doneSplit.status.reduce((sum, count) => sum + count, 0)).toBe(day.done);
        }
      }

      expect(statusCreated + week.createdClosedWithoutDoneAt).toBe(week.created);
      // This is deliberately only a loose sanity bound: `closedWithoutDoneAt`
      // is cumulative over tickets created in this and every earlier week.
      expect(week.createdClosedWithoutDoneAt).toBeLessThanOrEqual(week.closedWithoutDoneAt);

      for (const dimension of ['category', 'status'] as const) {
        for (const cohort of ['created', 'done'] as const) {
          const totals = week.daySplitTotals[dimension][cohort];
          const fromDays = totals.map((_, slot) =>
            week.days.reduce(
              (sum, day) => sum + (day[`${cohort}Split`]?.[dimension][slot] ?? 0),
              0
            )
          );
          expect(totals).toEqual(fromDays);
        }
      }

      const statusTotals = new Map(week.doneByStatus.map((row) => [row.status, row.count]));
      const splitDone = week.daySplitTotals.status.done;
      result.daySplit.statuses.forEach((row, index) => {
        expect(splitDone[index]).toBe(statusTotals.get(row.status) ?? 0);
      });
      expect(
        week.doneByStatus
          .filter((row) => !drawnStatuses.has(row.status))
          .reduce((sum, row) => sum + row.count, 0)
      ).toBe(0);
    }
  });

  test('keeps the two accepted statuses distinct in the split', () => {
    const result = report([
      ticket({ ticketId: 'fixing', tsStatus: 'dev_fixing', createdAt: MON_17, doneAt: TUE_18 }),
      ticket({ ticketId: 'done', tsStatus: 'dev_done', createdAt: MON_17, doneAt: TUE_18 }),
    ]);
    const week = weekByKey(result, '2026-W34');

    expect(result.daySplit.statuses).toEqual([
      { status: 'dev_done', label: 'Dev done' },
      { status: 'dev_fixing', label: 'Dev fixing' },
    ]);
    expect(week.daySplitTotals.status.created).toEqual([1, 1]);
    expect(week.daySplitTotals.status.done).toEqual([1, 1]);
  });

  test('carries the server-owned split wording and names the created-bar gap', () => {
    const plural = report([
      ticket({ ticketId: 'ghost-1', ticketStatus: 'closed', createdAt: MON_17, doneAt: null }),
      ticket({ ticketId: 'ghost-2', ticketStatus: 'closed', createdAt: TUE_18, doneAt: null }),
    ]);
    const singular = report([
      ticket({ ticketId: 'ghost-1', ticketStatus: 'closed', createdAt: MON_17, doneAt: null }),
    ]);

    expect(plural.daySplit.modeLabels.off).toBe('Off');
    expect(plural.daySplit.modeLabels.category).toBe('By category');
    expect(plural.daySplit.modeLabels.status).toBe('By status today');
    expect(plural.daySplit.cohortLabels).toEqual({ created: 'created', done: 'done' });
    expect(plural.daySplit.excludedLabel).toBe('not counted');
    expect(plural.daySplit.unavailableNotes.category).toBe(
      'The category split cannot be drawn for this week.'
    );
    expect(plural.daySplit.unavailableNotes.status).toBe(
      'The status split cannot be drawn for this week.'
    );
    // Two categories, so nothing rolls up and the caption promises no remainder.
    expect(plural.daySplit.captions.category).toBe(
      'Each bar is split by the feature area the ticket was classified into. Every area in this range is named.'
    );
    expect(plural.daySplit.captions.category).not.toMatch(/\b(today|currently|right now)\b/i);
    expect(plural.daySplit.captions.status).toContain(
      'Tickets created here that were closed without a done date are left out of the created bar'
    );
    expect(plural.daySplit.asOfLabel).toBe('Read at 26 Aug 2026');
    expect(weekByKey(plural, '2026-W34').createdClosedWithoutDoneAtNote).toBe(
      '2 tickets created this week were closed without a done date and are drawn as a hatched slice rather than counted in the created bars.'
    );
    expect(weekByKey(singular, '2026-W34').createdClosedWithoutDoneAtNote).toBe(
      '1 ticket created this week was closed without a done date and is drawn as a hatched slice rather than counted in the created bars.'
    );
    for (const week of report([]).weeks) {
      expect(week.createdClosedWithoutDoneAtNote).toBeNull();
    }
  });

  test('ranks the split vocabulary over the whole range, so a slot means the same in every week', () => {
    // WIDGET is busiest across the range but appears in no week except the
    // first. Ranked week by week it would never be named at all; ranked over
    // the range it leads, and slot 0 keeps meaning WIDGET while the reader
    // pages to a week that holds none. Six categories against five named slots
    // also puts VIP TIERS — the quietest — into the remainder.
    const AUG_3 = '2026-08-03T09:00:00+07:00';
    const AUG_4 = '2026-08-04T09:00:00+07:00';
    const result = report([
      ...[0, 1, 2, 3].map((index) =>
        ticket({ ticketId: `early-${index}`, subject: 'widget', createdAt: AUG_3, doneAt: AUG_4 })
      ),
      ticket({ ticketId: 'late-points', subject: 'points', createdAt: MON_17, doneAt: TUE_18 }),
      ticket({ ticketId: 'late-coupon', subject: 'coupon', createdAt: MON_17, doneAt: TUE_18 }),
      ticket({ ticketId: 'late-email', subject: 'email', createdAt: MON_17, doneAt: TUE_18 }),
      ticket({ ticketId: 'late-link', subject: 'integration', createdAt: MON_17, doneAt: TUE_18 }),
      ticket({ ticketId: 'late-vip', subject: 'vip tier', createdAt: MON_17, doneAt: TUE_18 }),
    ]);
    const early = weekByKey(result, '2026-W32');
    const late = weekByKey(result, '2026-W34');
    const labels = result.daySplit.categories.map((row) => row.label);

    expect(labels).toHaveLength(6);
    expect(labels[0]).toBe('WIDGET');
    expect(labels).not.toContain('VIP TIERS');
    expect(labels.at(-1)).toBe('REMAINING AREAS');
    // The caption counts the named slots off the vocabulary it just built, so a
    // change to the cap moves the sentence with it.
    expect(result.daySplit.captions.category).toBe(
      'Each bar is split by the feature area the ticket was classified into. The five busiest areas in this range are named; every other area is grouped into the last segment.'
    );

    // Slot 0 is WIDGET in both directions: it carries the early week's four and
    // nothing in the week that has none of them.
    expect(early.daySplitTotals.category.created[0]).toBe(4);
    expect(early.daySplitTotals.category.created.slice(1).every((count) => count === 0)).toBe(true);
    expect(late.daySplitTotals.category.created[0]).toBe(0);
    // The one category outside the named five is counted in the remainder, not dropped.
    expect(late.daySplitTotals.category.created.at(-1)).toBe(1);
    expect(late.daySplitTotals.category.created.reduce((sum, count) => sum + count, 0)).toBe(
      late.created
    );
  });

  test('keeps tickets closed with no done date out of the status ranking, not just its counts', () => {
    // Eight Dev Done ghosts — enough to top that status outright if they were
    // counted. They are left out of the created split because such
    // a ticket can appear in no done bar in any week, and the exclusion has to
    // happen before the vocabulary is ranked: a named slot for a status no bar
    // can ever draw is a legend entry that is permanently zero.
    const result = report([
      ...Array.from({ length: 8 }, (_, index) =>
        ticket({
          ticketId: `vanished-${index}`,
          ticketStatus: 'closed',
          tsStatus: 'dev_done',
          createdAt: MON_17,
          doneAt: null,
        })
      ),
      ticket({ ticketId: 'real-done', tsStatus: 'dev_done', createdAt: MON_17, doneAt: TUE_18 }),
      ticket({ ticketId: 'real-doing', tsStatus: 'dev_fixing', createdAt: TUE_18, doneAt: WED_19 }),
    ]);
    const week = weekByKey(result, '2026-W34');

    const doneIndex = result.daySplit.statuses.findIndex((row) => row.status === 'dev_done');
    expect(week.daySplitTotals.status.created[doneIndex]).toBe(1);
    // Nothing was quietly swept into a remainder either: the eight are absent
    // from the created split entirely, which is what the week note explains.
    expect(week.daySplitTotals.status.created.reduce((sum, count) => sum + count, 0)).toBe(
      week.created - week.createdClosedWithoutDoneAt
    );
    expect(week.createdClosedWithoutDoneAt).toBe(8);
  });

  test('reports the excluded created cohort per day, not only per week', () => {
    // The panel draws the gap between the status stack and the figure above it,
    // so it needs to know which column is short. A week figure cannot say.
    const week = weekByKey(
      report([
        ticket({ ticketId: 'mon', ticketStatus: 'closed', createdAt: MON_17, doneAt: null }),
        ticket({ ticketId: 'wed-a', ticketStatus: 'closed', createdAt: WED_19, doneAt: null }),
        ticket({ ticketId: 'wed-b', ticketStatus: 'closed', createdAt: WED_19, doneAt: null }),
        ticket({ ticketId: 'real', tsStatus: 'dev_done', createdAt: WED_19, doneAt: THU_20 }),
      ]),
      '2026-W34'
    );

    expect(week.days.map((day) => day.createdClosedWithoutDoneAt)).toEqual([1, 0, 2, 0, 0, 0, 0]);
    expect(
      week.days.reduce((sum, day) => sum + (day.createdClosedWithoutDoneAt ?? 0), 0)
    ).toBe(week.createdClosedWithoutDoneAt);
    // A day that reports no figures reports no excluded count either.
    for (const day of weekByKey(report([]), '2026-W35').days) {
      expect(day.createdClosedWithoutDoneAt === null).toBe(day.created === null);
    }
  });

  test('splits two adjacent minutes across a midnight inside the week', () => {
    // Tue 23:59 and Wed 00:00 in +07:00 — the same decision the week boundary
    // makes, one level down.
    const week = weekByKey(
      report([
        ticket({ ticketId: 'tuesday', createdAt: PRIOR_WEEK, doneAt: '2026-08-18T16:59:00Z' }),
        ticket({ ticketId: 'wednesday', createdAt: PRIOR_WEEK, doneAt: '2026-08-18T17:00:00Z' }),
      ]),
      '2026-W34'
    );

    expect(week.days[1]?.done).toBe(1);
    expect(week.days[2]?.done).toBe(1);
  });

  test('puts the first instant of the week in Monday, not in the week before', () => {
    // Mon 17 Aug 00:00 +07:00.
    const result = report([created('first', '2026-08-16T17:00:00Z')]);

    expect(weekByKey(result, '2026-W34').days[0]?.created).toBe(1);
    expect(weekByKey(result, '2026-W33').days[6]?.created).toBe(0);
  });

  test('puts the last instant of the week in Sunday, and the next one in the next Monday', () => {
    const result = report([
      created('last', '2026-08-23T16:59:59Z'),
      created('next', '2026-08-23T17:00:00Z'),
    ]);

    expect(weekByKey(result, '2026-W34').days[6]?.created).toBe(1);
    expect(weekByKey(result, '2026-W35').days[0]?.created).toBe(1);
  });

  test('reports a real zero on a day of a finished week that received nothing', () => {
    const week = weekByKey(report([created('one', TUE_18)]), '2026-W34');

    // A finished day that received nothing is measured, not missing: `toBe` is
    // `Object.is`, so a regression to `null` fails these two on its own.
    expect(week.days[4]?.created).toBe(0);
    expect(week.days[4]?.done).toBe(0);
    expect(week.daysNote).toBeNull();
  });

  test('nulls the days of the running week that have not started', () => {
    const result = report([]);

    const running = weekByKey(result, '2026-W35');
    // NOW is Wed 26 Aug 10:00 +07:00, so Mon–Wed have started and Thu–Sun have not.
    for (const index of [0, 1, 2]) {
      expect(running.days[index]?.created).toBe(0);
      expect(running.days[index]?.done).toBe(0);
      expect(running.days[index]?.createdSplit).not.toBeNull();
      expect(running.days[index]?.doneSplit).not.toBeNull();
    }
    for (const index of [3, 4, 5, 6]) {
      expect(running.days[index]?.created).toBeNull();
      expect(running.days[index]?.done).toBeNull();
      expect(running.days[index]?.createdSplit).toBeNull();
      expect(running.days[index]?.doneSplit).toBeNull();
    }
    expect(running.daysNote).not.toBeNull();

    const finished = weekByKey(result, '2026-W34');
    for (const day of finished.days) {
      expect(day.created).not.toBeNull();
      expect(day.done).not.toBeNull();
    }
    expect(finished.daysNote).toBeNull();
  });

  test('still reports numbers on a future day that received a ticket', () => {
    // The guarded null rule: a day is only blank when it has not started AND
    // received nothing. A forward-dated ticket has to be counted, or the seven
    // rows stop summing to the week.
    const running = weekByKey(report([created('forward', '2026-08-28T09:00:00+07:00')]), '2026-W35');

    expect(running.days[4]?.created).toBe(1);
    expect(running.days[4]?.done).toBe(0);
    expect(running.days.reduce((total, day) => total + (day.created ?? 0), 0)).toBe(running.created);
    expect(running.days.reduce((total, day) => total + (day.done ?? 0), 0)).toBe(running.done);
  });

  test('names the nulled days of the running week as a set, not as a range', () => {
    // Friday holds a forward-dated ticket, so the days without figures are
    // Thursday, Saturday and Sunday — not a contiguous run. A range sentence
    // would name Friday as having no figures directly above Friday's own figure.
    const running = weekByKey(report([created('forward', '2026-08-28T09:00:00+07:00')]), '2026-W35');

    expect(running.daysNote).toBe(
      'Thursday, Saturday and Sunday have not happened yet, so they have no figures. ' +
        'Wednesday is still running, so its figures are day-to-date.'
    );
  });

  test('words the note in the singular when one day is left', () => {
    const running = weekByKey(
      report([
        created('thu', '2026-08-27T09:00:00+07:00'),
        created('fri', '2026-08-28T09:00:00+07:00'),
        created('sat', '2026-08-29T09:00:00+07:00'),
      ]),
      '2026-W35'
    );

    expect(running.daysNote).toBe(
      'Sunday has not happened yet, so it has no figures. ' +
        'Wednesday is still running, so its figures are day-to-date.'
    );
  });

  test('describes the shape of both cohorts in a finished week', () => {
    // Hardcoded rather than built by calling the wording helpers: an expectation
    // computed by the code under test agrees with whatever that code does.
    const week = weekByKey(
      report([
        created('c1', TUE_18),
        created('c2', TUE_18),
        created('c3', WED_19),
        cleared('d1', THU_20),
        cleared('d2', THU_20),
        cleared('d3', MON_17),
      ]),
      '2026-W34'
    );

    expect(week.daysHighlight).toBe(
      'Creation ran heaviest early in the week; clearing ran heaviest midweek. ' +
        'Both fell away at the weekend.'
    );
  });

  test('says a shape both cohorts share once, not twice', () => {
    // The common live week: neither cohort favours a part of the working week
    // and both thin out at the weekend. Saying that twice in one sentence is
    // what the semicolon form would do.
    const week = weekByKey(
      report([
        created('c1', MON_17),
        created('c2', TUE_18),
        created('c3', WED_19),
        created('c4', THU_20),
        created('c5', FRI_21),
        cleared('d1', MON_17),
        cleared('d2', TUE_18),
        cleared('d3', WED_19),
        cleared('d4', THU_20),
        cleared('d5', FRI_21),
      ]),
      '2026-W34'
    );

    expect(week.daysHighlight).toBe(
      'Creation and clearing were both spread evenly across the working week and fell away at ' +
        'the weekend.'
    );
  });

  test('calls an evenly spread cohort even rather than crowning a day', () => {
    // Creation is level across Tuesday and Thursday. Naming either of them the
    // busiest day is a coin toss decided by a single ticket, which is what this
    // wording exists to stop.
    const week = weekByKey(
      report([
        created('c1', TUE_18),
        created('c2', TUE_18),
        created('c3', THU_20),
        created('c4', THU_20),
        cleared('d1', WED_19),
        cleared('d2', FRI_21),
      ]),
      '2026-W34'
    );

    expect(week.daysHighlight).toBe(
      'Creation was spread evenly across the working week; clearing ran heaviest at the end ' +
        'of the week. Both fell away at the weekend.'
    );
  });

  test('says nothing about clearing in a finished week that cleared nothing', () => {
    // The defect this wording replaces: an empty done column still has a
    // largest day, so the page crowned Monday the most-cleared day of a week
    // that cleared no ticket at all.
    const week = weekByKey(report([created('one', TUE_18)]), '2026-W34');

    expect(week.done).toBe(0);
    expect(week.daysHighlight).toBe(
      'Creation ran heaviest early in the week and fell away at the weekend.'
    );
  });

  test('says nothing about creation in a finished week that created nothing', () => {
    // The same defect the other way round.
    const week = weekByKey(report([cleared('d1', THU_20)]), '2026-W34');

    expect(week.created).toBe(0);
    expect(week.daysHighlight).toBe(
      'Clearing ran heaviest midweek and fell away at the weekend.'
    );
  });

  test('holds no highlight for the running week, even when it has tickets', () => {
    // On a Monday the running week would otherwise crown Monday busiest and
    // most-cleared out of a single part-elapsed day. The week here carries a
    // ticket on purpose: a running week with nothing in either cohort is
    // suppressed by the empty-week rule and proves nothing about `inProgress`.
    const running = weekByKey(
      report([
        ticket({
          ticketId: 'monday',
          createdAt: '2026-08-24T09:00:00+07:00',
          doneAt: '2026-08-25T09:00:00+07:00',
          tsStatus: 'dev_done',
        }),
      ]),
      '2026-W35'
    );

    expect(running.created).toBe(1);
    expect(running.done).toBe(1);
    expect(running.daysHighlight).toBeNull();
  });

  test('holds no highlight for a week with nothing in either cohort', () => {
    expect(weekByKey(report([created('one', TUE_18)]), '2026-W33').daysHighlight).toBeNull();
  });

  test('states the timezone and the trend heading in the approved words', () => {
    // A reworded timezone statement is a silent correctness change: the whole
    // day breakdown means something else if the frame it is read in moves.
    const result = report([]);

    expect(result.timeZoneNote).toBe(
      'Every date on this page is read in Vietnam time (UTC+07:00): a week runs Monday 00:00 to ' +
        'the following Monday 00:00, and a day is midnight to midnight in that same zone.'
    );
    expect(result.trendSectionTitle).toBe('Every week in the range, for context.');
  });

  test('scopes the trend heading to what the charts under it are handed', () => {
    // Those charts receive the whole `weeks` array — the focused week and the
    // week still running included — so the heading cannot scope them to the
    // weeks before the focused one. It names a range, never an ordering, and
    // this fails structurally if an ordering claim comes back.
    const result = report([], 4);

    expect(result.weeks).toHaveLength(4);
    expect(result.weeks.at(-1)?.inProgress).toBe(true);
    expect(result.trendSectionTitle).not.toMatch(/before|earlier|previous|preceding/i);
  });
});
