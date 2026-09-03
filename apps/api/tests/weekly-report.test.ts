import { describe, expect, test } from 'bun:test';
import { CATEGORIES, FALLBACK_CATEGORY } from '../src/board/categories';
import {
  aggregateWeeklyReport,
  compareCreated,
  weeklyGrowthDirection,
} from '../src/board/weekly-report';
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
    expect(compareCreated(withCounts(4, 5), start, end, DAY, horizon)).toMatchObject({
      magnitudeLabel: '1',
      percentLabel: null,
    });
    expect(compareCreated(withCounts(5, 7), start, end, DAY, horizon)).toMatchObject({
      magnitudeLabel: '2',
      percentLabel: '+40%',
    });
    expect(compareCreated(withCounts(6, 3), start, end, DAY, horizon)).toMatchObject({
      magnitudeLabel: '3',
      percentLabel: '-50%',
    });
  });

  test('prints no percentage for a zero baseline', () => {
    expect(compareCreated(withCounts(0, 4), start, end, DAY, horizon)).toEqual({
      current: 4,
      previous: 0,
      delta: 4,
      magnitudeLabel: '4',
      percentLabel: null,
    });
  });

  test('sends no false previous count when the earlier period predates the mirror', () => {
    expect(
      compareCreated(withCounts(5, 2), start, end, DAY, { startsAtMs: start - DAY + 1 })
    ).toEqual({
      current: 2,
      previous: null,
      delta: null,
      magnitudeLabel: null,
      percentLabel: null,
    });
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

    expect(result).toMatchObject({
      current: 1,
      previous: 1,
      delta: 0,
      magnitudeLabel: null,
      percentLabel: null,
    });
    expect(result.caption).not.toMatch(/another week/i);
    expect(result.caption).toContain("yesterday's count is at least 5");
    expect(result.unavailableNote).toBeNull();
  });

  test('prints only today with an explanation when the mirror has no earlier day', () => {
    const result = report([
      ticket({ ticketId: 'today', createdAt: '2026-08-25T18:00:00.000Z' }),
    ]).dayComparison;

    expect(result).toMatchObject({
      current: 1,
      previous: null,
      delta: null,
      magnitudeLabel: null,
      percentLabel: null,
    });
    expect(result.unavailableNote).toBe('no earlier day to compare');
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
        magnitudeLabel: null,
        percentLabel: null,
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
    expect(comparison(26, 34).unavailableNote).toBe('no earlier range to compare');
  });
});

describe('week-on-week created change', () => {
  test('compares the running week to the same elapsed span one week earlier', () => {
    const result = report(
      [
        ticket({
          ticketId: 'horizon',
          ticketStatus: 'closed',
          createdAt: '2026-06-01T00:00:00.000Z',
          doneAt: '2026-06-02T00:00:00.000Z',
        }),
        ticket({ ticketId: 'previous-1', createdAt: '2026-08-17T00:00:00.000Z' }),
        ticket({ ticketId: 'previous-2', createdAt: '2026-08-18T00:00:00.000Z' }),
        ticket({ ticketId: 'later-in-previous-week', createdAt: '2026-08-20T00:00:00.000Z' }),
        ...Array.from({ length: 4 }, (_, index) =>
          ticket({ ticketId: `current-${index}`, createdAt: '2026-08-24T00:00:00.000Z' })
        ),
      ],
      4
    );
    const running = weekByKey(result, '2026-W35');

    expect(running.createdComparison).toMatchObject({ current: 4, previous: 2, delta: 2 });
    expect(running.createdDeltaLabel).toBe('+2');
    expect(result.weeklyGrowth.caption).toContain(
      'Monday to now against Monday to the same time one week earlier'
    );
  });

  test('uses an ASCII hyphen-minus for a negative weekly change', () => {
    const result = report([
      ticket({ ticketId: 'horizon', createdAt: '2026-06-01T00:00:00.000Z' }),
      ticket({ ticketId: 'previous-1', createdAt: '2026-08-17T00:00:00.000Z' }),
      ticket({ ticketId: 'previous-2', createdAt: '2026-08-18T00:00:00.000Z' }),
      ticket({ ticketId: 'current', createdAt: '2026-08-24T00:00:00.000Z' }),
    ], 4);

    expect(weekByKey(result, '2026-W35').createdDeltaLabel).toBe('-1');
    expect(weekByKey(result, '2026-W35').createdDeltaLabel).not.toContain('−');
  });

  test('shows the earliest week comparison when its preceding week is inside the mirror', () => {
    const latestWeekStart = weekStartMs(NOW.getTime());
    const firstWeekStart = latestWeekStart - 3 * WEEK;
    const result = report(
      [
        ticket({ ticketId: 'horizon', createdAt: '2026-06-01T00:00:00.000Z' }),
        ticket({
          ticketId: 'before-range',
          createdAt: new Date(firstWeekStart - WEEK + 1).toISOString(),
        }),
        ticket({ ticketId: 'first', createdAt: new Date(firstWeekStart + 1).toISOString() }),
      ],
      4
    );

    expect(result.weeks[0]?.createdComparison.previous).toBe(1);
    expect(result.weeks[0]?.createdDeltaLabel).toBe('0');
  });

  test('prints the current count and explains a horizon-suppressed week', () => {
    const result = report([
      ticket({ ticketId: 'first', createdAt: '2026-08-03T00:00:00.000Z' }),
    ], 4);

    expect(result.weeks[0]?.createdComparison.previous).toBeNull();
    expect(result.weeks[0]?.createdDeltaLabel).toBe('1');
    expect(result.weeklyGrowth.horizonNote).toContain('no comparable earlier period');
  });

  // The row of figures shares a panel with the created and done bars, whose
  // legend names only those two. Without a name of its own nothing on the panel
  // says these figures track created only.
  test('names the row of figures', () => {
    expect(report(weeklyHistory(12), 12).weeklyGrowth.title).toBe('Week-on-week created change');
  });

  test('ships figures through 26 weeks and withholds them at 52', () => {
    const twentySix = report(weeklyHistory(24), 26);
    const fiftyTwo = report(weeklyHistory(48), 52);

    expect(twentySix.weeklyGrowth.unavailableNote).toBeNull();
    expect(twentySix.weeks.every((week) => week.createdDeltaLabel !== null)).toBe(true);
    expect(twentySix.weeklySpeed.unavailableLabel).toBeNull();
    expect(fiftyTwo.weeklyGrowth.unavailableNote).toContain('ranges up to 26 weeks');
    expect(fiftyTwo.weeks.every((week) => week.createdDeltaLabel === null)).toBe(true);
    expect(fiftyTwo.weeklySpeed.unavailableLabel).toContain('ranges up to 26 weeks');
  });

  test('states aggregate movement between the first and last FINISHED weeks', () => {
    const result = report(
      [
        ticket({ ticketId: 'horizon', createdAt: '2026-06-01T00:00:00.000Z' }),
        // One in the first finished week, three in the last finished week.
        ticket({ ticketId: 'first-week', createdAt: '2026-08-04T00:00:00.000Z' }),
        ...Array.from({ length: 3 }, (_, index) =>
          ticket({ ticketId: `last-finished-${index}`, createdAt: '2026-08-18T00:00:00.000Z' })
        ),
        // The running week is week-to-date and must not end the sentence.
        ...Array.from({ length: 9 }, (_, index) =>
          ticket({ ticketId: `running-${index}`, createdAt: '2026-08-24T00:00:00.000Z' })
        ),
      ],
      4
    );
    const finished = result.weeks.filter((week) => !week.inProgress);
    const first = finished[0];
    const last = finished.at(-1);
    const running = result.weeks.at(-1);

    expect(running?.inProgress).toBe(true);
    expect(running?.created).toBe(9);
    expect(result.weeklyGrowth.direction).toContain(`from ${first?.created} in ${first?.label}`);
    expect(result.weeklyGrowth.direction).toContain(`to ${last?.created} in ${last?.label}`);
    expect(result.weeklyGrowth.direction).toContain('(+2)');
    // The sentence says which weeks it covers, and leaves the partial one out.
    expect(result.weeklyGrowth.direction).toContain('finished weeks');
    expect(result.weeklyGrowth.direction).not.toContain(running?.label ?? 'in progress');
  });

  /**
   * The failure the whole panel exists to prevent: the running week's `created`
   * is week-to-date, so ending the sentence on it subtracts a partial week from
   * a whole one and prints a fall out of intake that never moved.
   */
  test('prints no fall when intake is dead flat across the finished weeks', () => {
    const flat = [
      ticket({ ticketId: 'horizon', createdAt: '2026-06-01T00:00:00.000Z' }),
      ...['2026-08-04', '2026-08-11', '2026-08-18'].flatMap((day, week) =>
        Array.from({ length: 2 }, (_, index) =>
          ticket({ ticketId: `w${week}-${index}`, createdAt: `${day}T00:00:00.000Z` })
        )
      ),
      // Tuesday of the running week: one so far, on its way to the same two.
      ticket({ ticketId: 'running', createdAt: '2026-08-24T00:00:00.000Z' }),
    ];
    const result = report(flat, 4);

    expect(result.weeks.filter((week) => !week.inProgress).map((week) => week.created)).toEqual([
      2, 2, 2,
    ]);
    expect(result.weeks.at(-1)?.created).toBe(1);
    expect(result.weeklyGrowth.direction).toContain('(0)');
    expect(result.weeklyGrowth.direction).not.toContain('(-');
  });

  test('says there is no second finished week rather than printing a bare figure', () => {
    const runningOnly = report([
      ticket({ ticketId: 'horizon', createdAt: '2026-06-01T00:00:00.000Z' }),
    ], 4).weeks.filter((week) => week.inProgress);
    const oneFinished = report([
      ticket({ ticketId: 'horizon', createdAt: '2026-06-01T00:00:00.000Z' }),
    ], 4).weeks.slice(-2);

    for (const weeks of [[], runningOnly, oneFinished]) {
      const direction = weeklyGrowthDirection(weeks);
      expect(direction).toContain('two finished weeks');
      expect(direction).not.toMatch(/\d/);
      expect(direction).not.toContain('\u2014');
    }
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
  test('is empty in both readings without tickets', () => {
    const result = report([]).openByPlan;
    const empty = { rows: [], freeNote: null, scopeNote: expect.any(String) };
    expect(result.createdInRange).toEqual(empty);
    expect(result.stillOpen).toEqual(empty);
  });

  test('names a single free row with singular grammar', () => {
    const result = report([
      ticket({ appPlan: 'free', createdAt: '2026-08-18T09:00:00+07:00' }),
    ]).openByPlan;
    expect(result.createdInRange.rows).toEqual([{ key: 'free', label: 'Free', count: 1 }]);
    expect(result.createdInRange.freeNote).toContain(
      '1 of 1 Dev Fixing or Dev Done ticket created in the selected range'
    );
    expect(result.stillOpen.freeNote).toContain(
      '1 of 1 Dev Fixing or Dev Done ticket created in the selected range and still open'
    );
  });

  test('pins the absent plan last even when it is the largest row', () => {
    const result = report([
      ticket({ ticketId: 'paid', appPlan: 'advanced_2026', createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'none-1', appPlan: null, createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'none-2', appPlan: '  ', createdAt: '2026-08-18T09:00:00+07:00' }),
    ]).openByPlan.createdInRange;
    expect(result.rows.map((row) => row.key)).toEqual(['advanced_2026', '(no plan)']);
    expect(result.rows[0]?.label).toBe('Advanced 2026');
  });

  test('does not infer a free group when the literal free value is absent', () => {
    expect(
      report([
        ticket({ appPlan: 'trial', createdAt: '2026-08-18T09:00:00+07:00' }),
      ]).openByPlan.createdInRange.freeNote
    ).toBeNull();
  });
});

describe('open tickets by merchant', () => {
  test('groups one merchant spelled two ways into a single row', () => {
    // Two rows for one merchant push a real merchant out of the top five and
    // lower the concentration figure this panel exists to report.
    const result = report([
      ticket({ ticketId: 'a', store: [{ shopName: 'Hegen' }], createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'b', store: [{ shopName: 'HEGEN' }], createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'c', store: [{ shopName: ' hegen  store ' }], createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'd', store: [{ shopName: 'Hegen Store' }], createdAt: '2026-08-18T09:00:00+07:00' }),
    ]).openByMerchant.createdInRange;

    expect(result.rows).toEqual([
      { key: 'hegen', label: 'Hegen', count: 2 },
      { key: 'hegen store', label: 'hegen  store', count: 2 },
    ]);
    expect(result.concentrationNote).toContain(
      '4 of 4 Dev Fixing or Dev Done tickets created in the selected range (100%)'
    );
  });


  test('words the empty case and keeps no tail in both readings', () => {
    const result = report([]).openByMerchant;
    for (const reading of [result.createdInRange, result.stillOpen]) {
      expect(reading).toEqual({
        rows: [],
        concentrationNote: expect.any(String),
        tailNote: null,
        tailCount: 0,
        scopeNote: expect.any(String),
      });
      expect(reading.concentrationNote.length).toBeGreaterThan(0);
    }
  });

  test('words a single named merchant and no tail', () => {
    const result = report([
      ticket({
        store: [{ shopName: 'Only Shop' }],
        createdAt: '2026-08-18T09:00:00+07:00',
      }),
    ]).openByMerchant.createdInRange;
    expect(result.rows).toEqual([{ key: 'only shop', label: 'Only Shop', count: 1 }]);
    expect(result.concentrationNote).toContain(
      'The busiest merchant holds 1 of 1 Dev Fixing or Dev Done ticket created in the selected range'
    );
    expect(result.tailNote).toBeNull();
  });

  test('appends the absent row after the five ranked merchants', () => {
    const merchants = ['A', 'B', 'C', 'D', 'E', 'F'].map((shopName) =>
      ticket({
        ticketId: shopName,
        store: [{ shopName }],
        createdAt: '2026-08-18T09:00:00+07:00',
      })
    );
    const absent = [1, 2, 3].map((number) =>
      ticket({
        ticketId: `absent-${number}`,
        createdAt: '2026-08-18T09:00:00+07:00',
      })
    );
    const result = report([...merchants, ...absent]).openByMerchant.createdInRange;
    expect(result.rows.map((row) => row.label)).toEqual(['A', 'B', 'C', 'D', 'E', '(no merchant)']);
    expect(result.rows.at(-1)?.count).toBe(3);
    expect(result.concentrationNote).toContain('5 busiest merchants');
    expect(result.tailNote).toContain('1 merchant');
    expect(result.tailCount).toBe(1);
  });

  test('uses the trimmed merchant fallback chain at panel level', () => {
    const result = report([
      ticket({ ticketId: 'shop', store: [{ shopName: ' Shop ' }], createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'domain', store: [{ shopName: ' ', domain: ' domain.test ' }], createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'fallback', storeDomains: [' fallback.test '], createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'absent', createdAt: '2026-08-18T09:00:00+07:00' }),
    ]).openByMerchant.createdInRange;
    expect(result.rows.map((row) => row.label)).toEqual([
      'domain.test',
      'fallback.test',
      'Shop',
      '(no merchant)',
    ]);
  });
});

describe('range-scoped breakdown readings', () => {
  test('keeps both panels on one population under both readings', () => {
    const result = report([
      ticket({ ticketId: 'open-in-range', appPlan: 'free', createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({
        ticketId: 'closed-in-range',
        ticketStatus: 'closed',
        appPlan: 'pro',
        createdAt: '2026-08-18T09:00:00+07:00',
        doneAt: '2026-08-20T09:00:00+07:00',
      }),
      ticket({ ticketId: 'open-before-range', createdAt: '2026-03-01T09:00:00+07:00' }),
      ticket({ ticketId: 'open-undated', createdAt: null, doneAt: '2026-08-20T09:00:00+07:00' }),
    ]);
    const planTotal = (scope: 'createdInRange' | 'stillOpen') =>
      result.openByPlan[scope].rows.reduce((total, row) => total + row.count, 0);
    const merchantTotal = (scope: 'createdInRange' | 'stillOpen') => {
      const reading = result.openByMerchant[scope];
      return reading.rows.reduce((total, row) => total + row.count, 0) + reading.tailCount;
    };

    expect(planTotal('createdInRange')).toBe(merchantTotal('createdInRange'));
    expect(planTotal('stillOpen')).toBe(merchantTotal('stillOpen'));
    expect(planTotal('stillOpen')).toBeLessThanOrEqual(planTotal('createdInRange'));
    expect(result.openByPlan.createdInRange.scopeNote).toContain('selected range');
    expect(result.openByMerchant.stillOpen.scopeNote).toContain('still open');
  });

  test('keeps a ticket created before the range out of both readings of both panels', () => {
    // The real fixture holds no open ticket older than its range, so every
    // identity over that fixture stays true with the range floor deleted. This
    // witness makes the excluded population non-zero, which is what turns the
    // floor into behaviour a test can see.
    const result = report([
      ticket({
        ticketId: 'in-range',
        appPlan: 'free',
        store: [{ shopName: 'In Range' }],
        createdAt: '2026-08-18T09:00:00+07:00',
      }),
      ticket({
        ticketId: 'before-range',
        appPlan: 'pro',
        store: [{ shopName: 'Before Range' }],
        createdAt: '2026-03-01T09:00:00+07:00',
      }),
    ]);

    for (const scope of ['createdInRange', 'stillOpen'] as const) {
      expect(result.openByPlan[scope].rows).toEqual([{ key: 'free', label: 'Free', count: 1 }]);
      expect(result.openByMerchant[scope].rows.map((row) => row.label)).toEqual(['In Range']);
    }

    // Both panels are told the same thing about what they left out.
    expect(result.openByPlan.stillOpen.scopeNote).toContain(
      '1 open ticket created before the range'
    );
    expect(result.openByMerchant.stillOpen.scopeNote).toContain(
      '1 open ticket created before the range'
    );
  });

  test('names an undated ticket as outside the still-open reading', () => {
    const result = report([
      ticket({ ticketId: 'in-range', createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'undated', createdAt: null, doneAt: '2026-08-20T09:00:00+07:00' }),
    ]);

    expect(result.openByPlan.stillOpen.scopeNote).toContain(
      'Tickets outside this reading include 1 with no readable created date.'
    );
    // Asserted as the whole sentence: the singular branch has to read as English,
    // and the sentence has to stay a partial list ("include") rather than claim
    // it names everything the reading leaves out.
    expect(result.openByPlan.createdInRange.scopeNote).toContain(
      'Tickets in no reading include 1 with no readable created date.'
    );
    expect(result.openByPlan.createdInRange.rows.reduce((total, row) => total + row.count, 0)).toBe(
      1
    );
  });

  test('tracks the range denominator rather than the live open count', () => {
    // Separates two numbers the simpler fixtures make equal: a closed ticket
    // created in the range counts for the panels and not for the live backlog,
    // and an open ticket created before it counts for the backlog and not the
    // panels. Both terms have to be non-zero for the assertion to discriminate.
    const result = report([
      ticket({ ticketId: 'in-range-open', createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({
        ticketId: 'in-range-closed',
        ticketStatus: 'closed',
        createdAt: '2026-08-18T09:00:00+07:00',
        doneAt: '2026-08-20T09:00:00+07:00',
      }),
      ticket({
        ticketId: 'in-range-closed-2',
        ticketStatus: 'closed',
        createdAt: '2026-08-19T09:00:00+07:00',
        doneAt: '2026-08-21T09:00:00+07:00',
      }),
      ticket({ ticketId: 'before-range-open', createdAt: '2026-03-01T09:00:00+07:00' }),
    ]);
    const planCreatedInRange = result.openByPlan.createdInRange.rows.reduce(
      (total, row) => total + row.count,
      0
    );

    expect(result.devFixOpenRightNow).not.toBe(result.rangeComparison.current);
    expect(planCreatedInRange).toBe(result.rangeComparison.current);
    expect(planCreatedInRange).not.toBe(result.devFixOpenRightNow);
  });

  test('names each reading on the shared control the way the reading counts', () => {
    const labels = report([]).openBreakdown.scopeLabels;

    expect(labels.createdInRange).toMatch(/created/i);
    expect(labels.stillOpen).toMatch(/open/i);
    expect(labels.createdInRange).not.toBe(labels.stillOpen);
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
    const comparisons = Object.fromEntries(
      result.rows.map((row) => [row.key, row.comparison])
    );

    expect(comparisons.WIDGET).toMatchObject({
      previous: 5,
      current: 10,
      magnitudeLabel: '5',
      percentLabel: '+100%',
    });
    expect(comparisons.POINTS).toMatchObject({
      previous: 2,
      current: 3,
      magnitudeLabel: '1',
      percentLabel: null,
    });
    expect(comparisons['EARNING RULES']).toMatchObject({
      previous: 0,
      current: 4,
      magnitudeLabel: '4',
      percentLabel: null,
    });
    expect(comparisons['EMAIL / NOTIFY']).toMatchObject({
      previous: 9,
      current: 0,
      magnitudeLabel: '9',
      percentLabel: '-100%',
    });
    expect(result.unavailableNote).toBeNull();
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
    expect(result.rows[0]?.comparison).toMatchObject({
      magnitudeLabel: null,
      percentLabel: null,
    });
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
      speedNote: '0 finished tickets in range · no median',
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
    expect(result?.speedNote).toBe('1 finished ticket in range · no median');
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
    expect(result.bugRule).toContain(
      'the resolution clocks in the last band count every dated ticket'
    );
    // The rule is the date, not a list of statuses: `tsStatus` is open-ended, so
    // any enumerated list in this sentence is one release from being untrue.
    expect(result.doneRule).toContain('reached a done state in HelpDesk at any point');
    expect(result.doneRule).not.toContain('Dev Done');
    expect(result.timeToFirstDone.caption).toContain('not time to customer delivery');
    for (const week of result.weeks) {
      expect(week.outstandingCaption).not.toContain('right now');
    }
  });

  test('names the lifetime population exception without extending the live heading', () => {
    const result = report([]);

    expect(result.bugRule).toContain('Weekly, day, range and feature figures');
    expect(result.bugRule).toContain(
      'the resolution clocks in the last band count every dated ticket'
    );
    expect(result.openSectionTitle).not.toContain('below');
  });

  test('keeps each band label and comparison caption scoped to the figures it describes', () => {
    const fourWeeks = report([], 4);
    const twentySixWeeks = report([], 26);

    expect(fourWeeks.dayComparison.caption).not.toMatch(/another week|Dev Fixing/i);
    expect(fourWeeks.rangeComparison.caption).not.toMatch(
      /Dev Fixing|selected range|number of weeks/i
    );
    expect(fourWeeks.trendSectionTitle).toContain(
      `${fourWeeks.range.selectedWeeks} weeks`
    );
    expect(twentySixWeeks.trendSectionTitle).toContain(
      `${twentySixWeeks.range.selectedWeeks} weeks`
    );
    expect(fourWeeks.trendSectionTitle).not.toBe(twentySixWeeks.trendSectionTitle);
    expect(fourWeeks.openSectionTitle).toMatch(/^Today and right now\b/);
    expect(fourWeeks.openSectionTitle).not.toMatch(/^All open tickets/);
    expect(fourWeeks.devFixOpenRightNowLabel).not.toEndWith(':');
    expect(fourWeeks.weeklyGrowth.caption).toContain('week band above');
  });


  test('says what each reworded caption is scoped to, not only what it dropped', () => {
    // The assertions the rewording replaced were all negative: they pin what the
    // captions no longer say. A caption trimmed to nothing satisfies every one of
    // them, so the scope each one still has to carry is pinned here.
    const result = report([]);

    expect(result.dayComparison.caption).toContain('today from midnight to now');
    expect(result.dayComparison.caption).toContain('same hours yesterday');
    expect(result.rangeComparison.caption).toContain('up to now');
    expect(result.rangeComparison.caption).toContain('one range earlier');
    expect(result.devFixOpenRightNowLabel).toContain('Dev Fixing or Dev Done');
    expect(result.devFixOpenRightNowLabel).toContain('right now');
    // A trend click moves every panel in the week band, the category split
    // included. Naming them is what keeps the sentence off the panel titled for
    // today, which sits in the live band and stays where it is.
    const movers = [
      'the whole week band above',
      'week card',
      'three tiles',
      'per-day chart',
      'category split',
    ];
    for (const mover of movers) {
      expect(result.weeklyGrowth.caption).toContain(mover);
    }
    for (const week of result.weeks) {
      expect(week.outstandingCaption).toMatch(/counted from the mirror|created and not yet done/);
    }
  });

  test('names in the trend heading the same span the charts under it are handed', () => {
    // The heading is the only thing on the page naming the range in words. It is
    // built from the requested span, and the columns are built from the resolved
    // one, so it is the heading that goes quietly wrong if those ever diverge.
    for (const weeks of [4, 12, 26]) {
      const result = report([], weeks);

      expect(result.weeks).toHaveLength(weeks);
      expect(result.trendSectionTitle).toContain(`Last ${result.weeks.length} weeks to now`);
    }
  });

  test('gives every withheld preset its own reason, naming its own span', () => {
    // More than one preset is withheld for most of a year: a mirror holding only
    // the current year cannot reach 26 weeks until midsummer. Each reason names
    // the span it belongs to, so no reason can stand in for another.
    const withheld = report(weeklyHistory(6), 12).range.presets.filter(
      (preset) => !preset.available
    );

    expect(withheld.map((preset) => preset.weeks)).toEqual([12, 26, 52]);
    for (const preset of withheld) {
      // The withheld span leads the sentence, which is what makes each button's
      // own description true when three of them are stacked under the control.
      expect(preset.unavailableNote).toStartWith(`${preset.weeks} weeks —`);
      expect(preset.unavailableNote).toContain("the mirror's 6 weeks");
    }
    expect(new Set(withheld.map((preset) => preset.unavailableNote)).size).toBe(withheld.length);
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

  test('accounts for every created-in-range ticket in the plan, merchant and range totals', () => {
    // Both breakdowns sit in the range band, so their default reading reconciles
    // to the range comparison rather than to the live backlog below that band.
    const result = report([
      ticket({ ticketId: 'a', appPlan: 'free', store: [{ shopName: 'A' }], createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'b', appPlan: null, store: [{ shopName: 'B' }], createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'c', appPlan: 'pro', store: [{ shopName: 'C' }], createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'd', appPlan: 'pro', store: [{ shopName: 'D' }], createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'e', appPlan: 'pro', store: [{ shopName: 'E' }], createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'f', appPlan: 'pro', store: [{ shopName: 'F' }], createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'absent', appPlan: 'free', createdAt: '2026-08-18T09:00:00+07:00' }),
    ]);
    expect(
      result.openByPlan.createdInRange.rows.reduce((total, row) => total + row.count, 0)
    ).toBe(result.rangeComparison.current);
    const noMerchant =
      result.openByMerchant.createdInRange.rows.find((row) => row.key === '(no merchant)')?.count ??
      0;
    const topFive = result.openByMerchant.createdInRange.rows
      .filter((row) => row.key !== '(no merchant)')
      .reduce((total, row) => total + row.count, 0);
    expect(topFive + result.openByMerchant.createdInRange.tailCount + noMerchant).toBe(
      result.rangeComparison.current
    );
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
    expect(running[0]?.currentDayLabel).toBe('Wed 26 Aug');
    expect(running[0]?.days.some((day) => day.label === running[0]?.currentDayLabel)).toBe(true);

    for (const week of result.weeks) {
      expect(week.label.includes('in progress')).toBe(week.inProgress);
      expect(week.tileLabels.created.includes('so far')).toBe(week.inProgress);
      expect(week.tileLabels.done.includes('so far')).toBe(week.inProgress);
      expect(week.tileLabels.outstanding.includes('week end')).toBe(!week.inProgress);
      expect(week.outstandingCaption.includes('has not finished')).toBe(week.inProgress);
      expect(week.currentDayLabel === null).toBe(!week.inProgress);
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

  test('keeps that language out of payloads built without the fixture too', () => {
    // The walk above loads the uncommitted fixture, so in any checkout that has
    // not pulled it the whole-payload guard does not run at all — it fails on
    // the missing file before it reads a single string. These payloads are built
    // here, so the rule still holds where the fixture is absent.
    const populated = report([
      ticket({ ticketId: 'open', createdAt: '2026-08-18T09:00:00+07:00', doneAt: null }),
      ticket({
        ticketId: 'done',
        createdAt: '2026-08-17T09:00:00+07:00',
        doneAt: '2026-08-18T09:00:00+07:00',
      }),
    ]);

    // A mirror holding only today reaches the notes that stand in for a
    // comparison, which no fully populated payload carries.
    const shallow = report([ticket({ ticketId: 'today', createdAt: '2026-08-25T18:00:00.000Z' })]);

    for (const payload of [
      report([]),
      populated,
      shallow,
      report(weeklyHistory(6), 12),
      report([], 4),
    ]) {
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
        createdAt: '2026-08-18T09:00:00+07:00',
        store: [{ shopName: 'Breach Co' }],
      }),
    ]);

    // The banned words really did reach the payload, in all six relayed fields:
    // the backlog pair plus merchant label and key in each reading.
    expect(result.openBacklog.oldest[0]?.subject).toBe('this ticket is overdue');
    expect(result.openBacklog.oldest[0]?.merchant).toBe('Breach Co');
    expect(result.openByMerchant.createdInRange.rows[0]?.label).toBe('Breach Co');
    expect(result.openByMerchant.createdInRange.rows[0]?.key).toBe('breach co');
    expect(result.openByMerchant.stillOpen.rows[0]?.label).toBe('Breach Co');
    expect(result.openByMerchant.stillOpen.rows[0]?.key).toBe('breach co');
    expect(payloadStrings(result).filter((value) => FORBIDDEN_LANGUAGE.test(value))).toHaveLength(
      6
    );

    // And the guard walks past all six, because it wrote none of them.
    expect(serverWordedStrings(result).filter((value) => FORBIDDEN_LANGUAGE.test(value))).toEqual(
      []
    );
  });

  test('still catches a banned word in server wording, wherever it sits', () => {
    // The exclusion is a hole cut in the walk, so it has to be exactly the shape
    // of the six relayed fields: server wording one key away from each of them,
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
        createdInRange: {
          ...payload.openByMerchant.createdInRange,
          concentrationNote: 'The busiest merchant missed three deadlines',
        },
        stillOpen: {
          ...payload.openByMerchant.stillOpen,
          concentrationNote: 'The still-open reading missed three deadlines',
        },
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
        'The still-open reading missed three deadlines',
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
          createdAt: '2026-08-18T09:00:00+07:00',
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

  test('lets each reading of each panel carry its own scope', () => {
    // Both panels now sit in the range band and share one scope control. Each
    // server-written caption names the selected reading so the figures remain
    // truthful when the control changes them together.
    const result = report([
      ticket({
        ticketId: 'free',
        appPlan: 'free',
        store: [{ shopName: 'Hegen' }],
        createdAt: '2026-08-18T09:00:00+07:00',
      }),
    ]);

    expect(result.openByPlan.createdInRange.freeNote).toContain('created in the selected range');
    expect(result.openByPlan.createdInRange.freeNote).not.toContain('right now');
    expect(result.openByMerchant.createdInRange.concentrationNote).toContain(
      'created in the selected range'
    );
    expect(result.openByMerchant.createdInRange.concentrationNote).not.toContain('right now');
    expect(result.openByPlan.stillOpen.freeNote).toContain('still open');
    expect(result.openByMerchant.stillOpen.concentrationNote).toContain('still open');
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
    expect(result.openSectionTitle).toMatch(/^Today and right now\b/);
    expect(result.openSectionTitle).toContain(`${result.openRightNow} tickets`);
    expect(result.openSectionTitle).toContain('1 is marked Dev Fixing or Dev Done');
  });

  test('blames the span for a withheld preset, not a gap in the history', () => {
    // A gap is not missing data — the coverage note says so on the same screen,
    // so the reason a preset is withheld cannot be discontinuity.
    const presets = report(weeklyHistory(6), 12).range.presets;

    expect(presets[0]?.unavailableNote).toBeNull();
    expect(presets[1]?.unavailableNote).toBe(
      "12 weeks — needs more history than the mirror's 6 weeks."
    );
    expect(presets[3]?.unavailableNote).toBe(
      "52 weeks — needs more history than the mirror's 6 weeks."
    );
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
  'openByMerchant.createdInRange.rows[].key',
  'openByMerchant.createdInRange.rows[].label',
  'openByMerchant.stillOpen.rows[].key',
  'openByMerchant.stillOpen.rows[].label',
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

describe('the resolution clocks', () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  /** The subset of the blob these tests write. HelpDeskTicket types it as `unknown`. */
  type ResolutionMetricsFixture = {
    ticketResolution?: Record<string, unknown>;
    issueResolution?: Record<string, unknown>;
  };

  const measured = (
    ticketId: string,
    tsStatus: string,
    csDoneMs: number,
    customerOkMs: number
  ): HelpDeskTicket =>
    ticket({
      ticketId,
      ticketStatus: 'closed',
      tsStatus,
      createdAt: '2026-08-10T09:00:00+07:00',
      doneAt: '2026-08-18T09:00:00+07:00',
      resolutionMetrics: {
        ticketResolution: {
          createdAt: 1_786_000_000_000,
          doneAt: 1_786_691_200_000,
          durationMs: 691_200_000,
        },
        issueResolution: {
          customerReportAt: 1_785_998_200_000,
          csDoneReplyAt: 1_785_998_200_000 + csDoneMs,
          durationToCsDoneMs: csDoneMs,
          customerOkAt: 1_785_998_200_000 + customerOkMs,
          durationToCustomerOkMs: customerOkMs,
        } satisfies Record<string, unknown>,
      } satisfies ResolutionMetricsFixture,
    });

  const measuredSet = () => [
    ticket({ ticketId: 'open-old', createdAt: '2026-03-01T09:00:00+07:00' }),
    measured('done-a', 'done', 1 * HOUR, 3 * HOUR),
    measured('done-b', 'done', 4 * HOUR, 9 * HOUR),
    measured('done-c', 'done', 2 * HOUR, HOUR / 2),
  ];

  test('reads numeric durations without deriving them from adjacent timestamps', () => {
    const value = measured('numeric', 'done', 2 * HOUR, 3 * HOUR);
    const metrics = value.resolutionMetrics as ResolutionMetricsFixture;
    metrics.issueResolution = {
      ...metrics.issueResolution,
      customerReportAt: '2026-08-10T08:30:00+07:00',
      csDoneReplyAt: '2026-08-10T08:31:00+07:00',
      customerOkAt: '2026-08-10T08:32:00+07:00',
    };
    const clocks = report([value]).resolutionClocks;

    expect(clocks.csReply.sampleSize).toBe(1);
    expect(clocks.csReply.done.buckets).toEqual([0, 1, 0, 0, 0, 0, 0]);
    expect(clocks.customerOk.sampleSize).toBe(1);
    expect(clocks.customerOk.done.buckets).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });

  test('accepts a non-blank numeric string duration', () => {
    const value = measured('string', 'done', 2 * HOUR, 3 * HOUR);
    const metrics = value.resolutionMetrics as ResolutionMetricsFixture;
    metrics.issueResolution = {
      ...metrics.issueResolution,
      durationToCsDoneMs: '7200000',
    };

    expect(report([value]).resolutionClocks.csReply.done.buckets).toEqual([
      0, 1, 0, 0, 0, 0, 0,
    ]);
  });

  test('treats invalid, blank, non-finite and negative durations as absent', () => {
    const invalid = ['not-a-number', '', '   ', Number.NaN, -1];
    const tickets = invalid.map((duration, index) => {
      const value = measured(`invalid-${index}`, 'done', HOUR, HOUR);
      const metrics = value.resolutionMetrics as ResolutionMetricsFixture;
      metrics.issueResolution = {
        ...metrics.issueResolution,
        durationToCsDoneMs: duration,
      };
      return value;
    });
    const panel = report(tickets).resolutionClocks.csReply;

    expect(panel.sampleSize).toBe(0);
    expect(panel.carriedNote).toContain('0 of 5 dated tickets carry this clock (0%).');
  });

  test('counts each clock independently', () => {
    const value = measured('customer-only', 'done', HOUR, 2 * HOUR);
    const metrics = value.resolutionMetrics as ResolutionMetricsFixture;
    metrics.issueResolution = {
      ...metrics.issueResolution,
      durationToCsDoneMs: null,
    };
    const clocks = report([value]).resolutionClocks;

    expect(clocks.csReply.sampleSize).toBe(0);
    expect(clocks.customerOk.sampleSize).toBe(1);
  });

  test('handles every absent resolution-metrics shape', () => {
    const clocks = report([
      ticket({ ticketId: 'absent' }),
      ticket({ ticketId: 'issue-absent', resolutionMetrics: {} }),
      ticket({ ticketId: 'null', resolutionMetrics: null }),
    ]).resolutionClocks;

    expect(clocks.csReply.sampleSize).toBe(0);
    expect(clocks.customerOk.sampleSize).toBe(0);
    expect(clocks.csReply.carriedNote).toContain('0 of 3 dated tickets');
    expect(clocks.csReply.unmeasuredNote).toContain('3 tickets never reached one');
    expect(clocks.csReply.unmeasuredNote).toContain('0 tickets reached one');
  });

  test('splits done and dev done with sorted medians and exact buckets', () => {
    const tickets = [
      ...measuredSet().slice(1),
      measured('devdone-a', 'dev_done', 40 * HOUR, 12 * HOUR),
      measured('devdone-b', 'dev_done', 100 * HOUR, 6 * HOUR),
      measured('devdone-c', 'dev_done', 9 * HOUR, 60 * HOUR),
    ];
    const clocks = report(tickets).resolutionClocks;

    expect(clocks.csReply.done).toMatchObject({
      sampleSize: 3,
      medianHours: 2,
      buckets: [1, 2, 0, 0, 0, 0, 0],
    });
    expect(clocks.customerOk.done).toMatchObject({
      sampleSize: 3,
      medianHours: 3,
      buckets: [1, 1, 0, 1, 0, 0, 0],
    });
    expect(clocks.csReply.devDone).toMatchObject({
      sampleSize: 3,
      medianHours: 40,
      buckets: [0, 0, 0, 1, 1, 1, 0],
    });
    expect(clocks.customerOk.devDone).toMatchObject({
      sampleSize: 3,
      medianHours: 12,
      buckets: [0, 0, 1, 1, 1, 0, 0],
    });
    expect(clocks.csReply.done.sampleSize + clocks.csReply.devDone.sampleSize).toBe(
      clocks.csReply.sampleSize
    );
    expect(clocks.customerOk.done.sampleSize + clocks.customerOk.devDone.sampleSize).toBe(
      clocks.customerOk.sampleSize
    );
  });

  test('reports a measured ticket outside both named rows', () => {
    const panel = report([
      measured('stray', 'feature_request', HOUR, HOUR),
    ]).resolutionClocks.csReply;

    expect(panel.otherStatusNote).toBe(
      '1 measured ticket carries another HelpDesk status and is in neither row above.'
    );
    expect(panel.done.sampleSize + panel.devDone.sampleSize).toBe(0);
    expect(panel.sampleSize).toBe(1);
  });

  test('suppresses a median below three while keeping the sample visible', () => {
    const two = report([
      measured('two-a', 'done', 4 * HOUR, HOUR),
      measured('two-b', 'done', 2 * HOUR, HOUR),
    ]).resolutionClocks.csReply.done;
    const three = report(measuredSet().slice(1)).resolutionClocks.csReply.done;

    expect(two).toMatchObject({ sampleSize: 2, medianHours: null });
    expect(two.sampleNote).toBe('2 tickets · no median');
    expect(three).toMatchObject({ sampleSize: 3, medianHours: 2 });
    expect(three.sampleNote).toBe('3 tickets · median 2 h');
  });

  test('gives equal shares equal bar widths across very different cohort sizes', () => {
    const panel = report([
      ...Array.from({ length: 60 }, (_, index) =>
        measured(`done-early-${index}`, 'done', HOUR, HOUR)
      ),
      ...Array.from({ length: 20 }, (_, index) =>
        measured(`done-middle-${index}`, 'done', 2 * HOUR, 2 * HOUR)
      ),
      ...Array.from({ length: 20 }, (_, index) =>
        measured(`done-later-${index}`, 'done', 8 * HOUR, 8 * HOUR)
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        measured(`dev-middle-${index}`, 'dev_done', 2 * HOUR, 2 * HOUR)
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        measured(`dev-later-${index}`, 'dev_done', 8 * HOUR, 8 * HOUR)
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        measured(`dev-latest-${index}`, 'dev_done', 24 * HOUR, 24 * HOUR)
      ),
    ]).resolutionClocks.csReply;

    expect(panel.done.sampleSize).toBe(100);
    expect(panel.devDone.sampleSize).toBe(10);
    expect(panel.done.barWidths[1]).toBe(panel.devDone.barWidths[1]);
    expect(Math.max(...panel.done.barWidths)).toBe(100);
    expect(Math.max(...panel.devDone.barWidths)).toBeCloseTo(83.33, 2);

    const fullWidthIndex = panel.done.barWidths.findIndex((width) => width === 100);
    const statedMaximum = panel.scaleNote.match(/is ([\d.]+)%/)?.[1];
    expect(fullWidthIndex).toBeGreaterThanOrEqual(0);
    expect(statedMaximum).toBeDefined();
    expect(Number(statedMaximum)).toBe(
      Math.round(
        ((panel.done.buckets[fullWidthIndex] ?? 0) / panel.done.sampleSize) * 10_000
      ) / 100
    );
  });

  test('draws an empty cohort at zero without dividing by zero', () => {
    const panel = report([
      measured('done-a', 'done', HOUR, HOUR),
      measured('done-b', 'done', HOUR, HOUR),
      measured('done-c', 'done', HOUR, HOUR),
    ]).resolutionClocks.csReply;

    expect(panel.devDone.sampleSize).toBe(0);
    expect(panel.devDone.barWidths).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(panel.devDone.barWidths.every(Number.isFinite)).toBe(true);
    expect(panel.scaleNote).toContain(
      'The largest share across both cohorts is 100% of a cohort; it fills the full track'
    );
  });

  test('cautions only a cohort below the existing five-percent floor', () => {
    const panel = report([
      measured('done-a', 'done', HOUR, HOUR),
      measured('done-b', 'done', 2 * HOUR, 2 * HOUR),
      measured('done-c', 'done', 3 * HOUR, 3 * HOUR),
      measured('thin-dev', 'dev_done', 4 * HOUR, 4 * HOUR),
      ...Array.from({ length: 20 }, (_, index) =>
        ticket({ ticketId: `unmeasured-${index}` })
      ),
    ]).resolutionClocks.csReply;

    expect(panel.done.sampleNote).toBe('3 tickets · median 2 h');
    expect(panel.done.smallSampleNote).toBeNull();
    expect(panel.devDone.sampleNote).toBe('1 ticket · no median');
    expect(panel.devDone.smallSampleNote).toBe(
      ' · small sample within the dated mirror; read this distribution cautiously.'
    );
  });

  test('returns every clock key and safe zero percentages for an empty mirror', () => {
    const emptyGroup = {
      label: 'Done',
      sampleSize: 0,
      medianHours: null,
      sampleNote: '0 tickets · no median',
      smallSampleNote: null,
      buckets: [0, 0, 0, 0, 0, 0, 0],
      barWidths: [0, 0, 0, 0, 0, 0, 0],
    };
    const panel = (caption: string) => ({
      caption,
      sampleSize: 0,
      medianHours: null,
      sampleNote: '0 tickets · no median',
      scaleNote:
        "Each bar shows that bucket's percentage share of its own cohort. Neither cohort contains a ticket, so the largest share is 0% and every track stays empty; ticket counts stay beside the bars.",
      carriedNote: '0 of 0 dated tickets carry this clock (0%).',
      selectionNote:
        'HelpDesk recorded this clock on 0 of the 0 tickets that reached a done state (0%). The ones it did not record are not a random sample of the rest, so read this as the measured population rather than as every finished ticket.',
      unmeasuredNote:
        '0 of the 0 tickets carrying this clock reached a done state in HelpDesk. The tickets without a reading fall in two groups: 0 tickets never reached one — still open, or closed another way — and 0 tickets reached one but HelpDesk recorded no time for this clock.',
      otherStatusNote: null,
      done: emptyGroup,
      devDone: { ...emptyGroup, label: 'Dev Done' },
    });

    expect(report([]).resolutionClocks).toEqual({
      sectionTitle:
        "Over each ticket's whole life — every dated ticket carrying a HelpDesk resolution clock, whatever week it was created in.",
      scopeRule:
        "HelpDesk computes these two clocks over each ticket's whole life, so the range control above does not reach this band and these figures count every dated ticket, not only Dev Fixing and Dev Done. The split below names the same Dev Done status the figures above count.",
      bucketLabels: [
        '≤ 1h',
        '> 1h, ≤ 4h',
        '> 4h, ≤ 8h',
        '> 8h, ≤ 24h',
        '> 24h, ≤ 3 days',
        '> 3 days, ≤ 7 days',
        '> 7 days',
      ],
      clockLabels: { csReply: 'CS reply', customerOk: 'Customer OK' },
      csReply: panel(
        "Measured from the customer's own message to the CS reply HelpDesk marked done. That start is earlier than the ticket's created date, so this clock does not begin where time to first done begins and the two are not comparable."
      ),
      customerOk: panel(
        "Measured from the customer's own message to the customer confirming the issue resolved. Same start as the CS reply clock, and recorded on far fewer tickets — read its sample before its median."
      ),
    });
  });

  test('keeps the clocks lifetime-scoped when the selected range changes', () => {
    const old = {
      ...measured('old', 'done', 2 * HOUR, 3 * HOUR),
      createdAt: '2026-03-01T09:00:00+07:00',
      doneAt: '2026-03-02T09:00:00+07:00',
    };

    expect(report([old], 4).resolutionClocks).toEqual(report([old], 52).resolutionClocks);
    expect(report([old], 4).resolutionClocks.csReply.sampleSize).toBe(1);
  });

  test('uses inclusive upper bounds and visibly exclusive lower-bound labels', () => {
    const durations = [
      HOUR,
      HOUR + 1,
      4 * HOUR,
      4 * HOUR + 1,
      8 * HOUR,
      8 * HOUR + 1,
      24 * HOUR,
      24 * HOUR + 1,
      3 * DAY,
      3 * DAY + 1,
      7 * DAY,
      7 * DAY + 1,
    ];
    const clocks = report(
      durations.map((duration, index) => measured(`edge-${index}`, 'done', duration, duration))
    ).resolutionClocks;

    expect(clocks.bucketLabels).toEqual([
      '≤ 1h',
      '> 1h, ≤ 4h',
      '> 4h, ≤ 8h',
      '> 8h, ≤ 24h',
      '> 24h, ≤ 3 days',
      '> 3 days, ≤ 7 days',
      '> 7 days',
    ]);
    expect(clocks.csReply.done.buckets).toEqual([1, 2, 2, 2, 2, 2, 1]);
  });

  test('prints the measured and finished denominators separately', () => {
    const panel = report([
      ticket({ ticketId: 'open-a' }),
      ticket({ ticketId: 'open-b' }),
      ...measuredSet().slice(1),
    ]).resolutionClocks.csReply;

    expect(panel.carriedNote).toContain('3 of 5 dated tickets carry this clock (60%).');
    expect(panel.selectionNote).toContain('3 of the 3 tickets that reached a done state (100%).');
  });

  test('includes a done-status ticket outside the dev-fix figures', () => {
    const result = report([measured('done-only', 'done', HOUR, HOUR)]);

    expect(result.resolutionClocks.csReply.sampleSize).toBe(1);
    expect(result.timeToFirstDone.sampleSize).toBe(0);
  });

  test('separates never-done tickets from finished tickets with no clock reading', () => {
    const finished = measured('unrecorded', 'done', HOUR, HOUR);
    const metrics = finished.resolutionMetrics as ResolutionMetricsFixture;
    metrics.issueResolution = {
      ...metrics.issueResolution,
      durationToCsDoneMs: null,
    };
    const note = report([ticket({ ticketId: 'open' }), finished]).resolutionClocks.csReply
      .unmeasuredNote;

    expect(note).toContain('1 ticket never reached one');
    expect(note).toContain('1 ticket reached one but HelpDesk recorded no time for this clock');
  });

  describe('the unreliable upstream fields', () => {
    test('reads none of the due dates, the resolution-metrics done date, or its duration', () => {
      const poisoned = measuredSet().map((value) => {
        const metrics = (value.resolutionMetrics ?? {}) as ResolutionMetricsFixture;
        return {
          ...value,
          dueDate: '2020-01-01T00:00:00+07:00',
          dueDateDone: true,
          resolutionMetrics: {
            ...metrics,
            ticketResolution: {
              ...metrics.ticketResolution,
              doneAt: '2026-01-02T00:00:00+07:00',
              durationMs: 1,
            },
          },
        } as HelpDeskTicket;
      });

      expect(report(poisoned)).toEqual(report(measuredSet()));
    });

    test('reads the issue-resolution durations, and every figure moves when they do', () => {
      const base = measuredSet();
      const doubled = base.map((value) => {
        const metrics = value.resolutionMetrics as ResolutionMetricsFixture | undefined;
        if (metrics?.issueResolution === undefined) return value;
        const issue = metrics.issueResolution;
        return {
          ...value,
          resolutionMetrics: {
            ...metrics,
            issueResolution: {
              ...issue,
              durationToCsDoneMs: Number(issue.durationToCsDoneMs) * 2,
              durationToCustomerOkMs: Number(issue.durationToCustomerOkMs) * 2,
            },
          },
        } as HelpDeskTicket;
      });

      expect(report(base).resolutionClocks.csReply.done.medianHours).toBe(2);
      expect(report(doubled).resolutionClocks.csReply.done.medianHours).toBe(4);
      expect(report(base).resolutionClocks.customerOk.done.medianHours).toBe(3);
      expect(report(doubled).resolutionClocks.customerOk.done.medianHours).toBe(6);
      expect(report(base).resolutionClocks.csReply.medianHours).toBe(2);
      expect(report(doubled).resolutionClocks.csReply.medianHours).toBe(4);
      expect(report(base).resolutionClocks.customerOk.medianHours).toBe(3);
      expect(report(doubled).resolutionClocks.customerOk.medianHours).toBe(6);
    });
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
      ticket({ ticketId: 'null-plan', appPlan: null, createdAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'missing-plan', createdAt: '2026-08-18T09:00:00+07:00' }),
    ]).openByPlan.createdInRange;
    expect(result.rows).toEqual([{ key: '(no plan)', label: 'No plan', count: 2 }]);
  });

  test('keeps a closed ticket out of the still-open reading and inside the created-in-range one', () => {
    const result = report([
      ticket({
        ticketId: 'open',
        appPlan: 'free',
        subject: 'widget broken',
        store: [{ shopName: 'Open Shop' }],
        createdAt: '2026-08-18T09:00:00+07:00',
      }),
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

    expect(result.openByPlan.stillOpen.rows).toEqual([{ key: 'free', label: 'Free', count: 1 }]);
    expect(result.openByMerchant.stillOpen.rows.map((row) => row.label)).toEqual(['Open Shop']);
    expect(result.openByPlan.createdInRange.rows.map((row) => row.key)).toEqual([
      'advanced_2026',
      'free',
    ]);
    expect(result.openByMerchant.createdInRange.rows.map((row) => row.label)).toEqual([
      'Closed Shop',
      'Open Shop',
    ]);
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

  /**
   * A feature whose intake fell to nothing has no open ticket and finished
   * nothing inside the range, so it reached neither original seed — and vanished
   * from the panel exactly when its `5 → 0` decline was the thing worth reading.
   */
  test('keeps a row for a feature whose intake is only in the previous span', () => {
    const rows = report(
      [
        ticket({ ticketId: 'horizon', subject: 'widget broken', createdAt: '2026-06-01T00:00:00.000Z' }),
        // Created inside the preceding comparison span, closed and done before
        // the selected range opens: invisible to both original seeds.
        ...Array.from({ length: 5 }, (_, index) =>
          ticket({
            ticketId: `gone-${index}`,
            subject: 'referral link broken',
            ticketStatus: 'closed',
            createdAt: '2026-07-10T00:00:00.000Z',
            doneAt: '2026-07-20T00:00:00.000Z',
          })
        ),
      ],
      4
    ).openByFeature.rows;
    const declined = rows.find((row) => row.key === 'REFERRAL');

    expect(declined?.comparison).toMatchObject({
      current: 0,
      previous: 5,
      delta: -5,
      magnitudeLabel: '5',
      percentLabel: '-100%',
    });
    // Nothing current, so every current-data column falls to a real zero or the
    // em dash — never a zero standing in for a value it does not have.
    expect(declined).toMatchObject({
      open: 0,
      openWithCreatedDate: 0,
      olderThan30: 0,
      doneSample: 0,
      medianDaysToDone: null,
    });
    expect(declined?.speedNote).toBe('0 finished tickets in range · no median');
  });

  test('sorts a previous-span-only row on the same key as every other row', () => {
    const rows = report(
      [
        ticket({ ticketId: 'widget-1', subject: 'widget broken' }),
        ticket({ ticketId: 'widget-2', subject: 'widget layout wrong' }),
        ticket({ ticketId: 'points', subject: 'point balance wrong' }),
        ...Array.from({ length: 3 }, (_, index) =>
          ticket({ ticketId: `other-${index}`, subject: `zzzz no match ${index}` })
        ),
        // Zero open, so it sorts below every open row and above the catch-all.
        ticket({
          ticketId: 'gone',
          subject: 'referral link broken',
          ticketStatus: 'closed',
          createdAt: '2026-07-10T00:00:00.000Z',
          doneAt: '2026-07-20T00:00:00.000Z',
        }),
      ],
      4
    ).openByFeature.rows;

    // Busiest first, the classifier catch-all pinned last however large it is.
    expect(rows.map((row) => row.key)).toEqual(['WIDGET', 'POINTS', 'REFERRAL', FALLBACK_CATEGORY]);
    expect(rows.map((row) => row.open)).toEqual([2, 1, 0, 3]);
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
    expect(row?.speedNote).toBe('2 finished tickets in range · no median');
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

describe('comparison direction declarations', () => {
  test('declares the direction on all four comparison paths', () => {
    const result = aggregateWeeklyReport(loadFixtureTickets(), { weeks: 52, now: NOW, year: YEAR });

    // Four paths, listed rather than walked. A structural walk earns its keep
    // the first time a fifth comparison path is added to this payload — at that
    // moment this list stops being an inventory and starts being a thing someone
    // forgets to extend. Until then it catches the same regression on every site
    // that exists, for four lines.
    expect(result.rangeComparison.valence).toBe('riseIsBad');
    expect(result.dayComparison.valence).toBe('riseIsBad');
    expect(result.weeks.length).toBeGreaterThan(0);
    expect(result.weeks.every((week) => week.createdComparison.valence === 'riseIsBad')).toBe(true);
    expect(result.openByFeature.rows.length).toBeGreaterThan(0);
    expect(result.openByFeature.rows.every((row) => row.comparison.valence === 'riseIsBad')).toBe(
      true
    );
  });
});

describe('the all-open panels over the real fixture', () => {
  test('decomposes every open ticket around the still-open range reading', () => {
    // Derived from the fixture, never hardcoded: `bun run fixture:pull` replaces
    // it with whichever tickets were open that day.
    const fixture = loadFixtureTickets();
    const result = aggregateWeeklyReport(fixture, { weeks: 52, now: NOW, year: YEAR });
    const open = result.devFixOpenRightNow;
    const rangeStartMs = weekStartMs(NOW.getTime()) - 51 * WEEK;
    const timestamp = (value: unknown) => {
      if (typeof value !== 'string' || value.trim() === '') return null;
      return new Date(value).getTime();
    };
    const isOpenDevFix = (ticket: HelpDeskTicket) =>
      ticket.ticketStatus === 'open' &&
      typeof ticket.tsStatus === 'string' &&
      ['dev_fixing', 'dev_done'].includes(ticket.tsStatus.trim());
    const survivesCounted = (ticket: HelpDeskTicket) => {
      if (typeof ticket.deletedAt === 'string' && ticket.deletedAt.trim() !== '') return false;
      const createdMs = timestamp(ticket.createdAt);
      const doneMs = timestamp(ticket.doneAt);
      return !Number.isNaN(createdMs) && !Number.isNaN(doneMs) && !(createdMs === null && doneMs === null);
    };
    const openCreatedBeforeRange = fixture.filter((ticket) => {
      const createdMs = timestamp(ticket.createdAt);
      return (
        isOpenDevFix(ticket) &&
        survivesCounted(ticket) &&
        createdMs !== null &&
        createdMs < rangeStartMs
      );
    }).length;
    const openNoCreatedDate = fixture.filter(
      (ticket) =>
        isOpenDevFix(ticket) &&
        survivesCounted(ticket) &&
        timestamp(ticket.createdAt) === null
    ).length;
    const openDevFixRejectedByCounted = fixture.filter(
      (ticket) => isOpenDevFix(ticket) && !survivesCounted(ticket)
    ).length;
    const planStillOpen = result.openByPlan.stillOpen.rows.reduce(
      (total, row) => total + row.count,
      0
    );
    const planCreatedInRange = result.openByPlan.createdInRange.rows.reduce(
      (total, row) => total + row.count,
      0
    );

    expect(result.openBacklog.total).toBe(open);
    expect(
      result.openBacklog.buckets.reduce((total, bucket) => total + bucket.count, 0) +
        result.openBacklog.noCreatedDate
    ).toBe(open);
    expect(
      planStillOpen + openCreatedBeforeRange + openNoCreatedDate + openDevFixRejectedByCounted
    ).toBe(open);

    const named = result.openByMerchant.stillOpen.rows.filter(
      (row) => row.key !== '(no merchant)'
    );
    const noMerchant = result.openByMerchant.stillOpen.rows.find(
      (row) => row.key === '(no merchant)'
    );
    expect(named.length).toBeLessThanOrEqual(5);
    const merchantStillOpen =
      named.reduce((total, row) => total + row.count, 0) +
      result.openByMerchant.stillOpen.tailCount +
      (noMerchant?.count ?? 0);
    expect(
      merchantStillOpen +
        openCreatedBeforeRange +
        openNoCreatedDate +
        openDevFixRejectedByCounted
    ).toBe(open);
    expect(merchantStillOpen).toBe(planStillOpen);
    expect(planStillOpen).toBeLessThanOrEqual(planCreatedInRange);
    expect(planCreatedInRange).toBeLessThanOrEqual(open);

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

  test('states the timezone exactly and gives the trend heading its range and reset rule', () => {
    // A reworded timezone statement is a silent correctness change: the whole
    // day breakdown means something else if the frame it is read in moves.
    const result = report([]);

    expect(result.timeZoneNote).toBe(
      'Every date on this page is read in Vietnam time (UTC+07:00): a week runs Monday 00:00 to ' +
        'the following Monday 00:00, and a day is midnight to midnight in that same zone.'
    );
    expect(result.trendSectionTitle).toContain(`${result.range.selectedWeeks} weeks`);
    expect(result.trendSectionTitle).toContain('running week');
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

/**
 * A second pass over the resolution clocks, written against the payload rather
 * than the implementation: the shapes production actually holds (a fractional
 * median, an even sample, two cohorts an order of magnitude apart, a duration of
 * zero) and the degenerate populations where a denominator or a note can go
 * wrong without any figure looking obviously false.
 */
describe('the resolution clocks over real-shaped and degenerate populations', () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  /** A ticket carrying both clocks, done, with the mixed encodings HelpDesk sends. */
  const clocked = (
    ticketId: string,
    tsStatus: string,
    csDoneMs: number | null,
    customerOkMs: number | null = csDoneMs,
    overrides: Partial<HelpDeskTicket> = {}
  ): HelpDeskTicket =>
    ticket({
      ticketId,
      ticketStatus: 'closed',
      tsStatus,
      createdAt: '2026-08-10T09:00:00+07:00',
      doneAt: '2026-08-18T09:00:00+07:00',
      resolutionMetrics: {
        ticketResolution: { createdAt: 1_786_000_000_000, doneAt: 1_786_691_200_000 },
        issueResolution: {
          customerReportAt: 1_785_998_200_000,
          durationToCsDoneMs: csDoneMs,
          durationToCustomerOkMs: customerOkMs,
        },
      },
      ...overrides,
    });

  test('averages the middle two of an even sample, in numeric order', () => {
    // Four durations whose numeric order and their millisecond strings'
    // lexicographic order disagree: sorted numerically the middle two are 2h and
    // 10h, so the median is 6h. Ordered as strings they are 100h and 1h, which
    // averages to 50.5h. A four-value sample is also the smallest that proves
    // the middle pair is averaged rather than one of them returned.
    const group = report([
      clocked('even-a', 'done', 1 * HOUR),
      clocked('even-b', 'done', 2 * HOUR),
      clocked('even-c', 'done', 10 * HOUR),
      clocked('even-d', 'done', 100 * HOUR),
    ]).resolutionClocks.csReply.done;

    expect(group.sampleSize).toBe(4);
    expect(group.medianHours).toBe(6);
    expect(group.sampleNote).toBe('4 tickets · median 6 h');
  });

  test('rounds a fractional median to one decimal in the figure and in its note', () => {
    // Production's own medians are 2.44h and 40.18h. Nothing above pins what a
    // median that is not a whole number of hours prints, and the note is built
    // from the rounded figure rather than from the raw one.
    const clocks = report([
      clocked('frac-a', 'done', 1 * HOUR),
      clocked('frac-b', 'done', 2.44 * HOUR),
      clocked('frac-c', 'done', 5 * HOUR),
      clocked('frac-d', 'dev_done', 30 * HOUR),
      clocked('frac-e', 'dev_done', 40.18 * HOUR),
      clocked('frac-f', 'dev_done', 90 * HOUR),
    ]).resolutionClocks.csReply;

    expect(clocks.done.medianHours).toBe(2.4);
    expect(clocks.done.sampleNote).toBe('3 tickets · median 2.4 h');
    expect(clocks.devDone.medianHours).toBe(40.2);
    expect(clocks.devDone.sampleNote).toBe('3 tickets · median 40.2 h');
  });

  test('keeps two cohorts an order of magnitude apart from averaging into one figure', () => {
    // The split is the whole point of the band: production's Done cohort sits at
    // 2.44h and its Dev Done cohort at 40.18h, sixteen times slower. The panel
    // median mixes both, so it has to sit between them and stand for neither.
    const clocks = report([
      clocked('fast-a', 'done', 2 * HOUR),
      clocked('fast-b', 'done', 2.44 * HOUR),
      clocked('fast-c', 'done', 3 * HOUR),
      clocked('slow-a', 'dev_done', 38 * HOUR),
      clocked('slow-b', 'dev_done', 40.18 * HOUR),
      clocked('slow-c', 'dev_done', 44 * HOUR),
    ]).resolutionClocks.csReply;

    expect(clocks.done.medianHours).toBe(2.4);
    expect(clocks.devDone.medianHours).toBe(40.2);
    expect(clocks.medianHours).toBeGreaterThan(clocks.done.medianHours ?? 0);
    expect(clocks.medianHours).toBeLessThan(clocks.devDone.medianHours ?? 0);
    // And they land in different rows of the axis, not in one shared clump.
    expect(clocks.done.buckets).toEqual([0, 3, 0, 0, 0, 0, 0]);
    expect(clocks.devDone.buckets).toEqual([0, 0, 0, 0, 3, 0, 0]);
  });

  test('intersects clock readings with done tickets in every population note', () => {
    const tickets = [
      clocked('open-clock-a', 'done', HOUR, HOUR, {
        ticketStatus: 'open',
        doneAt: null,
      }),
      clocked('open-clock-b', 'done', 2 * HOUR, 2 * HOUR, {
        ticketStatus: 'open',
        doneAt: null,
      }),
      clocked('done-clock', 'done', 3 * HOUR),
      clocked('done-unrecorded', 'done', null),
      ticket({
        ticketId: 'open-unrecorded',
        createdAt: '2026-08-10T09:00:00+07:00',
      }),
    ];
    const panel = report(tickets).resolutionClocks.csReply;
    const carried = panel.carriedNote.match(/^(\d+) of (\d+) dated tickets/);
    const selected = panel.selectionNote.match(/on (\d+) of the (\d+) tickets/);
    const measuredDone = panel.unmeasuredNote.match(/^(\d+) of the (\d+) tickets carrying/);
    const unmeasured = panel.unmeasuredNote.match(
      /groups: (\d+) tickets? never reached one .+ and (\d+) tickets? reached one/
    );

    expect(carried).not.toBeNull();
    expect(selected).not.toBeNull();
    expect(measuredDone).not.toBeNull();
    expect(unmeasured).not.toBeNull();
    if (!carried || !selected || !measuredDone || !unmeasured) {
      throw new Error('population note changed');
    }

    for (const fraction of [carried, selected, measuredDone]) {
      expect(Number(fraction[1])).toBeLessThanOrEqual(Number(fraction[2]));
    }
    expect(Number(selected[1])).toBe(1);
    expect(Number(measuredDone[1])).toBe(1);
    expect(Number(unmeasured[1]) + Number(unmeasured[2])).toBe(tickets.length - panel.sampleSize);
  });

  test('places every measured duration in exactly one bucket, including zero and years', () => {
    // Zero is a legitimate reading, not an absent one, and nothing pins that the
    // buckets account for the whole cohort rather than for the durations that
    // happened to fall inside the axis.
    const durations = [0, 1, HOUR, 8 * HOUR, 3 * DAY, 400 * DAY];
    const clocks = report([
      ...durations.map((duration, index) => clocked(`spread-${index}`, 'done', duration)),
      ...durations.map((duration, index) => clocked(`spread-dev-${index}`, 'dev_done', duration)),
    ]).resolutionClocks;

    for (const panel of [clocks.csReply, clocks.customerOk]) {
      for (const group of [panel.done, panel.devDone]) {
        expect(group.buckets).toHaveLength(clocks.bucketLabels.length);
        expect(group.buckets.reduce((total, count) => total + count, 0)).toBe(group.sampleSize);
      }
      expect(panel.done.sampleSize + panel.devDone.sampleSize).toBe(panel.sampleSize);
    }
    expect(clocks.csReply.done.buckets).toEqual([3, 0, 1, 0, 1, 0, 1]);
  });

  test('prints an empty cohort beside a populated one without borrowing its sample', () => {
    const panel = report([
      clocked('only-done-a', 'done', HOUR),
      clocked('only-done-b', 'done', 2 * HOUR),
      clocked('only-done-c', 'done', 3 * HOUR),
    ]).resolutionClocks.csReply;

    expect(panel.done).toMatchObject({ sampleSize: 3, medianHours: 2 });
    expect(panel.devDone).toMatchObject({
      label: 'Dev Done',
      sampleSize: 0,
      medianHours: null,
      sampleNote: '0 tickets · no median',
      buckets: [0, 0, 0, 0, 0, 0, 0],
    });
    expect(panel.sampleSize).toBe(3);
    expect(panel.otherStatusNote).toBeNull();
  });

  test('holds every figure still across all four range presets', () => {
    // The band is lifetime-scoped, so the range control must not reach it. A
    // population spread either side of the shortest preset is what makes the
    // check bite: with one recent ticket every preset sees the same tickets
    // anyway and the assertion passes without proving anything.
    const tickets = [
      clocked('old-a', 'done', HOUR, HOUR, {
        createdAt: '2026-02-01T09:00:00+07:00',
        doneAt: '2026-02-03T09:00:00+07:00',
      }),
      clocked('old-b', 'dev_done', 40 * HOUR, 60 * HOUR, {
        createdAt: '2026-03-01T09:00:00+07:00',
        doneAt: '2026-03-05T09:00:00+07:00',
      }),
      clocked('mid', 'done', 2 * HOUR, 4 * HOUR, {
        createdAt: '2026-06-01T09:00:00+07:00',
        doneAt: '2026-06-02T09:00:00+07:00',
      }),
      clocked('recent-a', 'done', 3 * HOUR, 5 * HOUR),
      clocked('recent-b', 'dev_done', 50 * HOUR, 70 * HOUR),
    ];
    const runs = [4, 12, 26, 52].map((weeks) => report(tickets, weeks));

    const [shortest, ...rest] = runs;
    if (!shortest) throw new Error('no report for the shortest preset');

    // The presets really do resolve to different ranges over this population.
    expect(new Set(runs.map((run) => run.range.selectedWeeks)).size).toBeGreaterThan(1);
    for (const run of rest) {
      expect(run.resolutionClocks).toEqual(shortest.resolutionClocks);
    }
    expect(shortest.resolutionClocks.csReply.sampleSize).toBe(5);
  });

  test('takes no duration from a missing key, a serialised blob or a nested array', () => {
    // verify-data records `resolutionMetrics` as absent-as-a-key on 599 of 2281
    // tickets and never null, and the durations as `number | null`. These are the
    // remaining shapes a mirror round trip or an upstream change could produce.
    const clocks = report([
      // `issueResolution` present, this clock's key absent rather than null.
      ticket({
        ticketId: 'key-absent',
        ticketStatus: 'closed',
        tsStatus: 'done',
        createdAt: '2026-08-10T09:00:00+07:00',
        doneAt: '2026-08-18T09:00:00+07:00',
        resolutionMetrics: { issueResolution: { customerReportAt: 1_785_998_200_000 } },
      }),
      // The whole blob arriving as its own JSON text rather than as an object.
      ticket({
        ticketId: 'serialised',
        ticketStatus: 'closed',
        tsStatus: 'done',
        createdAt: '2026-08-10T09:00:00+07:00',
        doneAt: '2026-08-18T09:00:00+07:00',
        resolutionMetrics: JSON.stringify({ issueResolution: { durationToCsDoneMs: HOUR } }),
      }),
      ticket({
        ticketId: 'array',
        ticketStatus: 'closed',
        tsStatus: 'done',
        createdAt: '2026-08-10T09:00:00+07:00',
        doneAt: '2026-08-18T09:00:00+07:00',
        resolutionMetrics: { issueResolution: [] },
      }),
      clocked('null-durations', 'done', null, null),
    ]).resolutionClocks;

    expect(clocks.csReply.sampleSize).toBe(0);
    expect(clocks.customerOk.sampleSize).toBe(0);
    expect(clocks.csReply.carriedNote).toContain('0 of 4 dated tickets carry this clock (0%).');
  });

  test('prints no arithmetic accident anywhere in a server-worded string', () => {
    // Every note in this band states a count or a percentage over a population
    // that can be empty. `NaN%`, `Infinity` or a stray `undefined` reaching the
    // page would read as a real figure to anyone skimming it.
    const payloads = [
      report([]),
      report([clocked('one', 'done', HOUR)]),
      report([clocked('stray', 'feature_request', HOUR)]),
      report([ticket({ ticketId: 'unmeasured', createdAt: '2026-08-18T09:00:00+07:00' })]),
      report([clocked('zero', 'done', 0, 0)]),
    ];

    for (const payload of payloads) {
      expect(
        serverWordedStrings(payload).filter((value) => /NaN|Infinity|undefined|null/.test(value))
      ).toEqual([]);
    }
  });

  test('keeps forbidden performance language out of a populated clocks payload', () => {
    // The existing whole-payload guards walk payloads carrying no measured
    // ticket, so the band's only conditional sentence — the one naming tickets
    // under some other HelpDesk status — is never among the strings they read.
    const payload = report([
      clocked('lang-a', 'done', HOUR),
      clocked('lang-b', 'dev_done', 40 * HOUR),
      clocked('lang-c', 'feature_request', 5 * HOUR),
    ]);

    expect(payload.resolutionClocks.csReply.otherStatusNote).not.toBeNull();
    expect(
      serverWordedStrings(payload).filter((value) => FORBIDDEN_LANGUAGE.test(value))
    ).toEqual([]);
  });
});
