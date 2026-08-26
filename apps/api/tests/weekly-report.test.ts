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
  return aggregateWeeklyReport(tickets, { weeks, now: NOW, year: YEAR });
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
    // The rule is the date, not a list of statuses: `tsStatus` is open-ended, so
    // any enumerated list in this sentence is one release from being untrue.
    expect(result.doneRule).toContain('reached a done state in HelpDesk at any point');
    expect(result.doneRule).not.toContain('Dev Done');
    expect(result.timeToFirstDone.caption).toContain('not time to customer delivery');
    for (const week of result.weeks) expect(week.outstandingCaption).toContain('open right now');
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

    expect(result.excluded).toEqual({ deleted: 1, unparseableDate: 1, undated: 1 });
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

    function strings(value: unknown): string[] {
      if (typeof value === 'string') return [value];
      if (Array.isArray(value)) return value.flatMap(strings);
      if (value !== null && typeof value === 'object') {
        return Object.values(value).flatMap(strings);
      }
      return [];
    }

    for (const payload of [report([]), populated, fixture]) {
      expect(strings(payload).filter((value) => /SLA|overdue|breach|deadline/i.test(value))).toEqual([]);
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

    expect(result.excluded).toEqual({ deleted: 0, unparseableDate: 0, undated: 0 });
    expect(result.excludedNote).toBeNull();
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
