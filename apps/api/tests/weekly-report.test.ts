import { describe, expect, test } from 'bun:test';
import { FALLBACK_CATEGORY } from '../src/board/categories';
import { aggregateWeeklyReport } from '../src/board/weekly-report';
import type { WeeklyReport } from '../src/board/report-types';
import type { HelpDeskTicket } from '../src/helpdesk/types';
import { loadFixtureTickets } from './fixtures';

/**
 * Fixed clock: Wed 26 Aug 2026, inside ISO week 2026-W35. Every date below is
 * written with an explicit offset so no assertion depends on the runner's own
 * timezone.
 */
const NOW = new Date('2026-08-26T03:00:00.000Z');
const PULLED_AT = '2026-08-26T04:00:00.000Z';
const YEAR = 2026;

function ticket(overrides: Partial<HelpDeskTicket>): HelpDeskTicket {
  return {
    id: overrides.ticketId ?? 'id',
    ticketId: 'JOY-260101-aaaaaa',
    subject: 'widget broken',
    ticketStatus: 'open',
    tsStatus: 'doing',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function report(tickets: HelpDeskTicket[], weeks = 12): WeeklyReport {
  return aggregateWeeklyReport(tickets, { weeks, now: NOW, pulledAt: PULLED_AT, year: YEAR });
}

function weekByKey(result: WeeklyReport, key: string) {
  const week = result.weeks.find((candidate) => candidate.key === key);
  if (!week) throw new Error(`no week ${key} in ${result.weeks.map((w) => w.key).join(', ')}`);
  return week;
}

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
      [ticket({ createdAt: '2025-12-01T00:00:00+07:00', doneAt: '2025-12-29T00:00:00+07:00' })],
      { weeks: 52, now: NOW, pulledAt: PULLED_AT, year: 2025 }
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

  test('counts a closed ticket with no done date as outstanding and as a ghost', () => {
    const result = report([
      ticket({
        ticketStatus: 'closed',
        tsStatus: 'done',
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
    expect(withGhosts.ghosts.closedTotal).toBe(3);
    expect(withGhosts.ghosts.shareOfClosed).toBe(0.667);
    // Three tickets are outstanding at the latest week: two ghosts and one open.
    expect(withGhosts.ghosts.shareOfOutstandingLatestWeek).toBe(0.667);
    expect(withGhosts.ghosts.caveat).toContain('2 finished tickets carry no done date');

    const clean = report([ticket({ createdAt: '2026-08-01T00:00:00+07:00', doneAt: null })]);
    expect(clean.ghosts.count).toBe(0);
    expect(clean.ghosts.shareOfClosed).toBe(0);
    expect(clean.ghosts.caveat).toBeNull();
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
      tsStatus: 'done',
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
});

describe('unknown values', () => {
  test('gives an absent priority its own row rather than dropping the ticket', () => {
    const result = report([
      ticket({ createdAt: '2026-08-18T09:00:00+07:00', priority: null, doneAt: null }),
    ]);

    const week = weekByKey(result, '2026-W34');
    expect(week.priorities).toEqual([{ priority: '(no priority)', done: 0, outstanding: 1 }]);
  });

  test('renders a status label in sentence case, known column or not', () => {
    const result = report([
      ticket({ ticketId: 'speed', tsStatus: 'done_speed_up', doneAt: '2026-08-18T09:00:00+07:00' }),
      ticket({ ticketId: 'new', tsStatus: 'some_new_state', doneAt: '2026-08-19T09:00:00+07:00' }),
      ticket({ ticketId: 'known', tsStatus: 'dev_done', doneAt: '2026-08-20T09:00:00+07:00' }),
    ]);

    const week = weekByKey(result, '2026-W34');
    const labels = Object.fromEntries(week.doneByStatus.map((row) => [row.status, row.label]));
    expect(labels.done_speed_up).toBe('Done speed up');
    expect(labels.some_new_state).toBe('Some new state');
    expect(labels.dev_done).toBe('Dev done');
    expect(week.done).toBe(3);
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
  test('buckets a same-day finish as one day or less', () => {
    const result = report([
      ticket({ createdAt: '2026-08-18T09:00:00+07:00', doneAt: '2026-08-18T10:00:00+07:00' }),
    ]);

    expect(result.timeToFirstDone.sampleSize).toBe(1);
    expect(result.timeToFirstDone.buckets[0]).toEqual({ label: '≤ 1 day', count: 1 });
    expect(result.timeToFirstDone.medianDays).toBe(0);
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
    const result = report(
      ages.map((days, index) =>
        ticket({
          ticketId: `age-${index}`,
          createdAt: '2026-08-01T00:00:00+07:00',
          doneAt: new Date(Date.parse('2026-08-01T00:00:00+07:00') + days * 86400000).toISOString(),
        })
      )
    );

    expect(result.timeToFirstDone.sampleSize).toBe(4);
    // Middle two are 2 and 5.
    expect(result.timeToFirstDone.medianDays).toBe(3.5);
    expect(result.timeToFirstDone.buckets.map((bucket) => bucket.count)).toEqual([1, 1, 1, 0, 1, 0]);
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
    expect(result.doneRule).toContain('Done, Dev Done, Done Speed Up');
    expect(result.outstandingCaption).toContain('open right now');
    expect(result.timeToFirstDone.caption).toContain('not time to customer delivery');
    expect(result.pulledAt).toBe(PULLED_AT);
  });

  test('counts open tickets live, over the whole mirror rather than a week', () => {
    const result = report([
      ticket({ ticketId: 'open-1' }),
      ticket({ ticketId: 'open-2' }),
      ticket({ ticketId: 'closed-1', ticketStatus: 'closed', doneAt: '2026-08-18T09:00:00+07:00' }),
    ]);

    expect(result.openRightNow).toBe(2);
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
      pulledAt: PULLED_AT,
      year: YEAR,
    });

    const deleted = fixture.filter((t) => typeof t.deletedAt === 'string' && t.deletedAt.trim() !== '');
    expect(result.excluded.deleted).toBe(deleted.length);
    expect(result.openRightNow).toBe(fixture.filter((t) => t.ticketStatus === 'open').length);

    const inRange = fixture.filter((t) => {
      const created = t.createdAt ? Date.parse(t.createdAt) : Number.NaN;
      return !Number.isNaN(created) && created >= Date.parse('2025-09-01T00:00:00Z');
    });
    // Every in-window ticket reaches a cohort: it was created in some week of the
    // range, so it is counted there and nowhere lost.
    expect(result.weeks.reduce((total, week) => total + week.created, 0)).toBe(
      inRange.length - result.excluded.deleted - result.excluded.unparseableDate
    );

    for (const week of result.weeks) {
      expect(week.key).not.toMatch(/NaN/);
      expect(week.categories.reduce((t, row) => t + row.outstanding, 0)).toBe(week.outstanding);
      expect(week.outstandingWithDoneDate + week.closedWithoutDoneAt).toBe(week.outstanding);
    }
  });
});
