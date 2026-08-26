/**
 * The weekly report, aggregated from the ticket mirror.
 *
 * Pure: it takes the tickets, the clock and the pull window as arguments and
 * returns the whole payload, so every product rule on the page — the done rule,
 * the outstanding cohort, the ghost residue, the week boundary — is decided and
 * tested here rather than in a route or a browser.
 *
 * Cohorts are computed over the *whole* ticket array, never over the tickets
 * created inside the range: "outstanding at the end of week N" counts tickets
 * created long before the range began. Only the output is limited to the range.
 */
import { FALLBACK_CATEGORY } from './categories';
import { classify } from './classify';
import { BOARD_COLUMNS } from './types';
import type {
  GhostAudit,
  RangeMeta,
  TimeToFirstDone,
  WeeklyReport,
  WeekSummary,
} from './report-types';
import { WEEK_MS, dayLabel, weekKey, weekLabel, weekShortLabel, weekStartMs } from './weeks';
import type { HelpDeskTicket } from '../helpdesk/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole-week ranges the control offers, smallest first. */
const PRESET_WEEKS = [4, 12, 26, 52];
const DEFAULT_WEEKS = 12;

/**
 * How far past the mirror's history a preset may reach and still be offered.
 * The covered range grows by one week every week, so a preset within a month of
 * being full fills itself within a month; one that is half empty never does.
 */
const PRESET_GRACE_WEEKS = 4;

const NO_PRIORITY = '(no priority)';
const NO_STATUS = '(no status)';
const NO_MERCHANT = '(no merchant)';

/**
 * `tsStatus` is not a closed enum, so naming the done statuses here could only
 * ever be a snapshot of the ones that existed when the sentence was written.
 * The rule the code runs is the date, not the status: any ticket HelpDesk has
 * stamped with a done date counts in the week that date falls in.
 */
const DONE_RULE =
  'Done = reached a done state in HelpDesk at any point, dated by HelpDesk\'s own done date.';

const OUTSTANDING_CAPTION =
  'Outstanding at week end is historical, counted from the mirror; open right now is ' +
  "today's live count of tickets whose status is open.";

/**
 * The same caption for the week that is still running. Its Sunday has not
 * happened, so nothing about it can be described as an end-of-week figure.
 */
const IN_PROGRESS_OUTSTANDING_CAPTION =
  'This week has not finished, so every figure here is week-to-date rather than final. ' +
  'Outstanding counts tickets created and not yet done; open right now is ' +
  "today's live count of tickets whose status is open.";

/**
 * The backlog panel's heading. Every column but the last is an end-of-week
 * figure; the last is the running week, whose Sunday has not happened. A
 * heading promising Sunday over a Tuesday value contradicts the column label
 * right beneath it, so the running week is named in the heading too.
 */
const BACKLOG_TITLE = 'Backlog at each week end';
const IN_PROGRESS_BACKLOG_TITLE = 'Backlog at each week end, and so far this week';

/**
 * Titles for the three headline tiles, worded per week rather than fixed in the
 * renderer: a week still in progress cannot be titled with a week-end figure,
 * and only the server knows which week that is.
 */
const FINISHED_TILE_LABELS = {
  created: 'New this week',
  done: 'Done this week',
  outstanding: 'Outstanding at week end',
};

const IN_PROGRESS_TILE_LABELS = {
  created: 'New so far this week',
  done: 'Done so far this week',
  outstanding: 'Outstanding so far',
};

const TIME_TO_FIRST_DONE_CAPTION =
  "Measured from a ticket's created date to the first time HelpDesk marked it done, which " +
  'includes Dev Done. This is not time to customer delivery. 48 hours is HelpDesk\'s automatic ' +
  'due offset on every ticket — the same offset on all of them — not a target agreed per ticket.';

function weeklySpeedCaption(weeks: WeekSummary[]): string {
  const medians = weeks.flatMap((week) =>
    week.medianDaysToDone === null ? [] : [week.medianDaysToDone]
  );
  const scope =
    'Tickets finished with no done date are in no week\'s median. Done dates include Dev Done.';
  if (medians.length === 0) return `${scope} No week shown has a measurable median.`;

  const minimum = Math.min(...medians);
  const maximum = Math.max(...medians);
  return `${scope} Measurable weekly medians range from ${minimum} to ${maximum} days.`;
}

function emptyWeeksNote(weeks: WeekSummary[]): string | null {
  const empty = weeks.filter((week) => week.doneSample === 0).length;
  if (empty === 0) return null;
  if (empty === 1) return `1 of the ${weeks.length} weeks shown finished no measurable ticket, so it has no median.`;
  return `${empty} of the ${weeks.length} weeks shown finished no measurable ticket, so they have no median.`;
}

/** Upper bound in whole days, and the label the histogram prints. */
const BUCKETS = [
  { label: '≤ 1 day', maxDays: 1 },
  { label: '2–3 days', maxDays: 3 },
  { label: '4–7 days', maxDays: 7 },
  { label: '8–14 days', maxDays: 14 },
  { label: '15–30 days', maxDays: 30 },
  { label: 'over 30 days', maxDays: Infinity },
];

/** Inclusive upper bounds for the all-open backlog age rows. */
const AGE_BUCKETS = [
  { label: '< 7 days', maxDays: 6 },
  { label: '7–30 days', maxDays: 30 },
  { label: '30–90 days', maxDays: 90 },
  { label: 'over 90 days', maxDays: Infinity },
];

/**
 * New identity rule for the stakeholder panel: merchant identity is the first
 * non-blank display string, not a stable upstream key. Mixed naming can split
 * one merchant across rows and therefore understate concentration.
 */
function merchantName(ticket: HelpDeskTicket): string {
  return (
    ticket.store?.[0]?.shopName?.trim() ||
    ticket.store?.[0]?.domain?.trim() ||
    ticket.storeDomains?.[0]?.trim() ||
    NO_MERCHANT
  );
}

const COLUMN_LABELS = new Map<string, string>(
  BOARD_COLUMNS.map((column) => [column.status as string, column.label as string])
);

/** `done_speed_up` → `Done speed up`. Empty stays empty for the caller to name. */
function sentenceCase(raw: string): string {
  const words = raw.replace(/[_-]+/g, ' ').trim().replace(/\s+/g, ' ');
  if (!words) return '';
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/**
 * A status renders as something readable whether or not it has a board column.
 * The board's own naming wins where it has one, so a column and a report row can
 * never name the same status differently.
 */
function statusLabel(status: string): string {
  if (status === NO_STATUS) return 'No status';
  return sentenceCase(COLUMN_LABELS.get(status) ?? status) || status;
}

/** `high` → `High`. The absent-priority key is named rather than printed with its brackets. */
function priorityLabel(priority: string): string {
  if (priority === NO_PRIORITY) return 'No priority';
  return sentenceCase(priority) || priority;
}

function isPresent(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * `null` when absent, `NaN` when present and unparseable. The two are different
 * outcomes: an absent `doneAt` means "not done", a present one that will not
 * parse means the ticket cannot be placed in any week at all.
 */
function timestamp(value: unknown): number | null {
  if (!isPresent(value)) return null;
  return new Date(value).getTime();
}

/** Days between two instants, floored at 0 — a done date before a created date is 0, not negative. */
function wholeDaysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor((toMs - fromMs) / DAY_MS));
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** A ticket that survived exclusion, with everything the week loop needs precomputed. */
type Counted = {
  createdMs: number | null;
  doneMs: number | null;
  isGhost: boolean;
  category: string;
  priority: string;
  status: string;
};

type Pair = { done: number; outstanding: number };

function bump(counts: Map<string, Pair>, key: string, field: keyof Pair): void {
  const pair = counts.get(key);
  if (pair) pair[field] += 1;
  else counts.set(key, { done: field === 'done' ? 1 : 0, outstanding: field === 'outstanding' ? 1 : 0 });
}

/** Busiest first; the catch-all row is pinned last so it never leads a panel. */
function byWeightThenKey(last: string) {
  return (a: [string, Pair], b: [string, Pair]): number => {
    if (a[0] === last) return 1;
    if (b[0] === last) return -1;
    const weight = b[1].done + b[1].outstanding - (a[1].done + a[1].outstanding);
    return weight || a[0].localeCompare(b[0]);
  };
}

/**
 * How many whole weeks the pull window itself spans: it covers one calendar
 * year, so nothing before the week holding 1 January of that year was ever
 * fetched. This is what an empty mirror reports: with no ticket to measure a
 * span from, the honest answer is what the pull asked for.
 */
function pullWindowWeeks(year: number, nowMs: number): number {
  const yearStart = weekStartMs(Date.UTC(year, 0, 1) - 7 * 60 * 60 * 1000);
  const latest = weekStartMs(nowMs);
  return Math.max(1, Math.round((latest - yearStart) / WEEK_MS) + 1);
}

/**
 * What the mirror can actually answer for, measured from the tickets in it.
 *
 * Coverage is the span from the earliest ticket the mirror holds to the current
 * week. Interior weeks with nothing in them are inside that span, not outside
 * it: a week in which nobody opened a ticket is an answer — zero — and cannot be
 * told apart from a week the pull never reached by looking at ticket counts
 * alone. Treating a quiet week as absence used to truncate coverage at the first
 * one and withhold ranges the mirror could answer perfectly well.
 */
type Horizon = {
  /** Whole weeks from the current week back to the week holding the earliest ticket. */
  weeks: number;
  /** Earliest date on any counted ticket, or `null` when the mirror holds none. */
  startsAtMs: number | null;
};

/**
 * The earliest date that places a ticket anywhere on this page — its created
 * date, or its done date when it has none.
 *
 * A ticket with a done date and no created date is deliberately counted: it
 * lands in the done cohort of the week its done date falls in. Measuring the
 * horizon from created dates alone made that ticket invisible to the range, so
 * the week holding its completion could fall outside every range on offer and
 * the ticket appeared in no figure and in no exclusion count either.
 */
function earliestDateOf(ticket: Counted): number | null {
  const dates = [ticket.createdMs, ticket.doneMs].filter(
    // `Number.isFinite` rejects a NaN date as well as a null one. The upstream
    // exclusion already keeps unparseable dates out of `counted`, so this is
    // belt and braces — but a NaN reaching the arithmetic below would silently
    // produce a NaN week count and a report with no weeks in it at all.
    (value): value is number => value !== null && Number.isFinite(value)
  );
  if (dates.length === 0) return null;
  return Math.min(...dates);
}

function historyHorizon(counted: Counted[], nowMs: number, year: number): Horizon {
  const latestWeekStart = weekStartMs(nowMs);

  let earliestMs: number | null = null;
  for (const ticket of counted) {
    const earliest = earliestDateOf(ticket);
    if (earliest === null) continue;
    if (earliestMs === null || earliest < earliestMs) earliestMs = earliest;
  }

  // Nothing to measure: say what the pull asked for rather than inventing a run.
  if (earliestMs === null) {
    return { weeks: pullWindowWeeks(year, nowMs), startsAtMs: null };
  }

  const firstWeekStart = weekStartMs(earliestMs);
  return {
    weeks: Math.max(1, Math.round((latestWeekStart - firstWeekStart) / WEEK_MS) + 1),
    startsAtMs: earliestMs,
  };
}

/**
 * The note under the backlog panel, built from the mirror rather than written
 * down, so it cannot go on describing a horizon the data no longer has.
 */
function coverageNote(horizon: Horizon, year: number): string {
  if (horizon.startsAtMs === null) {
    return (
      `Counts cover HelpDesk tickets created in ${year}. Tickets opened before 1 Jan ${year} ` +
      'are not in the mirror and appear in no week, so backlog is a floor, not a total.'
    );
  }

  // Not "created": the earliest date may be a done date, on a ticket HelpDesk
  // never gave a created one. Naming it a creation date would state something
  // untrue of exactly the ticket that set the horizon.
  return (
    `The mirror reaches back to ${dayLabel(horizon.startsAtMs)}, the earliest date on any ticket ` +
    'it holds; nothing older than that is in it, so backlog is a floor, not a total. A week ' +
    'inside that span with no tickets is a quiet week, not missing data.'
  );
}

/** `1 week`, `12 weeks` — so no caller has to pick the plural. */
function weekSpan(weeks: number): string {
  return weeks === 1 ? '1 week' : `${weeks} weeks`;
}

/**
 * Why a preset is withheld, in words, for the control to render verbatim.
 *
 * The reason is the span, and only the span: a gap inside the history is not
 * missing data — the coverage note says so on the same screen — so a sentence
 * blaming discontinuity would contradict it.
 */
function unavailableNote(preset: number, horizon: Horizon): string {
  return (
    `The mirror spans ${weekSpan(horizon.weeks)}, which is not enough for a range of ` +
    `${weekSpan(preset)}: most of it would be empty.`
  );
}

/**
 * The range actually served. An unusable `weeks` is not a 400: the response
 * echoes what was used, so an overridden request is visible rather than silent.
 *
 * A preset is offered when the mirror's own history reaches all but the last
 * few of its columns, and withheld — labelled, disabled, never relabelled —
 * when it does not.
 */
function resolveRange(requested: number, horizon: Horizon, year: number): RangeMeta {
  const reach = horizon.weeks + PRESET_GRACE_WEEKS;
  const wanted = Number.isInteger(requested) && requested > 0 ? requested : DEFAULT_WEEKS;
  const offered = PRESET_WEEKS.filter((weeks) => weeks <= reach);
  const usable = offered.filter((weeks) => weeks <= wanted);
  const selectedWeeks =
    usable[usable.length - 1] ?? offered[0] ?? PRESET_WEEKS[0] ?? DEFAULT_WEEKS;

  return {
    presets: PRESET_WEEKS.map((weeks) => ({
      weeks,
      label: `${weeks} weeks`,
      available: weeks <= reach,
      unavailableNote: weeks <= reach ? null : unavailableNote(weeks, horizon),
    })),
    selectedWeeks,
    coverageNote: coverageNote(horizon, year),
  };
}

function timeToFirstDone(counted: Counted[], rangeStartMs: number, rangeEndMs: number): TimeToFirstDone {
  const days: number[] = [];
  const bucketCounts = BUCKETS.map((bucket) => ({ label: bucket.label, count: 0 }));
  let unmeasurable = 0;
  let withinTwoDays = 0;

  for (const ticket of counted) {
    const { doneMs, createdMs } = ticket;
    if (doneMs === null || doneMs < rangeStartMs || doneMs >= rangeEndMs) continue;
    if (createdMs === null) {
      unmeasurable += 1;
      continue;
    }
    const age = wholeDaysBetween(createdMs, doneMs);
    days.push(age);
    if (doneMs - createdMs <= 48 * 60 * 60 * 1000) withinTwoDays += 1;
    const index = BUCKETS.findIndex((bucket) => age <= bucket.maxDays);
    const bucket = bucketCounts[index];
    if (bucket) bucket.count += 1;
  }

  return {
    sampleSize: days.length,
    unmeasurable,
    medianDays: median([...days].sort((a, b) => a - b)),
    withinTwoDaysNote:
      days.length === 0
        ? null
        : `${withinTwoDays} of ${days.length} finished ${days.length === 1 ? 'ticket' : 'tickets'} ` +
          `(${Math.round((withinTwoDays / days.length) * 100)}%) reached done within 48 hours of being created.`,
    buckets: bucketCounts,
    caption: TIME_TO_FIRST_DONE_CAPTION,
  };
}

/**
 * The residue as the tile's second figure: the tile prints
 * `outstandingWithDoneDate` on its own, and this line adds back the rest. It
 * opens with `+N` because it is an addend, not a footnote about the number
 * above it. The count is the week's own residue, not the mirror's, so the line
 * stays true as the focus moves; `null` when the week has none, which is what
 * keeps a `+0` line off the tile.
 */
function outstandingCaveat(closedWithoutDoneAt: number): string | null {
  if (closedWithoutDoneAt === 0) return null;
  return closedWithoutDoneAt === 1
    ? '+1 ticket closed with no done date'
    : `+${closedWithoutDoneAt} tickets closed with no done date`;
}

/**
 * The footnote naming what reached no week, worded here like every other string
 * on the page so the browser composes no prose and picks no plural.
 *
 * "Not counted" is the wrong claim for the undated bucket: a ticket with
 * neither date is in no *weekly* cohort, but an open one is still in the live
 * open figure this page prints beside them. The sentence says which.
 */
function excludedNote(excluded: WeeklyReport['excluded']): string | null {
  const parts: string[] = [];
  if (excluded.deleted > 0) {
    parts.push(`${excluded.deleted} deleted ${excluded.deleted === 1 ? 'ticket' : 'tickets'}`);
  }
  if (excluded.unparseableDate > 0) {
    const noun = excluded.unparseableDate === 1 ? 'ticket' : 'tickets';
    parts.push(`${excluded.unparseableDate} ${noun} with an unreadable date`);
  }
  if (excluded.undated > 0) {
    const noun = excluded.undated === 1 ? 'ticket' : 'tickets';
    parts.push(`${excluded.undated} ${noun} with neither a created nor a done date`);
  }
  if (parts.length === 0) return null;

  const sentence = `In no week on this page: ${parts.join(' · ')}.`;
  if (excluded.undated === 0) return sentence;
  return (
    `${sentence} A ticket with neither date is in no weekly figure, but is still counted in ` +
    'open right now while its status is open.'
  );
}

function ghostAudit(counted: Counted[]): GhostAudit {
  const count = counted.filter((ticket) => ticket.isGhost).length;

  return {
    count,
    caveat:
      count === 0
        ? null
        : `${count} finished ${count === 1 ? 'ticket carries' : 'tickets carry'} no done date in ` +
          'HelpDesk. They are counted as outstanding and shown separately; nothing is estimated ' +
          'for them.',
  };
}

function openBacklog(open: HelpDeskTicket[], nowMs: number): WeeklyReport['openBacklog'] {
  const bucketCounts = AGE_BUCKETS.map((bucket) => ({ label: bucket.label, count: 0 }));
  const dated: Array<{ ticket: HelpDeskTicket; createdMs: number; ageDays: number }> = [];
  let noCreatedDate = 0;
  let olderThan30 = 0;

  for (const ticket of open) {
    const createdMs = timestamp(ticket.createdAt);
    if (createdMs === null || Number.isNaN(createdMs)) {
      noCreatedDate += 1;
      continue;
    }

    const ageDays = wholeDaysBetween(createdMs, nowMs);
    if (ageDays > 30) olderThan30 += 1;
    const bucket = bucketCounts[AGE_BUCKETS.findIndex((candidate) => ageDays <= candidate.maxDays)];
    if (bucket) bucket.count += 1;
    dated.push({ ticket, createdMs, ageDays });
  }

  const total = open.length;
  return {
    total,
    agingHeadline:
      total === 0
        ? null
        : total === 1
          ? `${Math.round((olderThan30 / total) * 100)}% of the 1 open ticket is older than 30 days.`
          : `${Math.round((olderThan30 / total) * 100)}% of open tickets are older than 30 days.`,
    buckets: bucketCounts,
    noCreatedDate,
    noCreatedDateLabel: 'No readable created date',
    oldest: dated
      .sort((a, b) => a.createdMs - b.createdMs)
      .slice(0, 5)
      .map(({ ticket, ageDays }) => ({
        ticketId: ticket.ticketId,
        subject: ticket.subject?.trim() || '(no subject)',
        merchant: merchantName(ticket),
        ageDays,
        ageLabel: ageDays === 1 ? '1 day' : `${ageDays} days`,
      })),
  };
}

/**
 * Builds the whole report.
 *
 * `now` and `year` are injected rather than read from the clock and the
 * environment: the tests need a fixed range without freezing the runner's
 * timezone, and a mirror with no history to measure still has to say which
 * window the pull asked for.
 */
export function aggregateWeeklyReport(
  tickets: HelpDeskTicket[],
  options: { weeks: number; now: Date; year: number }
): WeeklyReport {
  const nowMs = options.now.getTime();
  const open = tickets.filter((ticket) => ticket.ticketStatus === 'open');
  const excluded = { deleted: 0, unparseableDate: 0, undated: 0 };
  const counted: Counted[] = [];

  for (const ticket of tickets) {
    if (isPresent(ticket.deletedAt)) {
      excluded.deleted += 1;
      continue;
    }

    const createdMs = timestamp(ticket.createdAt);
    const doneMs = timestamp(ticket.doneAt);
    // A present-but-unparseable date would otherwise produce a `NaN-WNaN` week:
    // a phantom column that satisfies every accounting identity while naming a
    // week that does not exist.
    if (Number.isNaN(createdMs) || Number.isNaN(doneMs)) {
      excluded.unparseableDate += 1;
      continue;
    }

    // Neither date: it belongs to no week, so it can be in no created, done or
    // outstanding cohort and in no category or priority row. Counting it here is
    // what keeps it from disappearing between the totals and the footnote.
    if (createdMs === null && doneMs === null) {
      excluded.undated += 1;
      continue;
    }

    const isClosed = ticket.ticketStatus === 'closed';
    counted.push({
      createdMs,
      doneMs,
      isGhost: isClosed && doneMs === null,
      category: classify(ticket),
      priority: isPresent(ticket.priority) ? ticket.priority.trim() : NO_PRIORITY,
      status: isPresent(ticket.tsStatus) ? ticket.tsStatus.trim() : NO_STATUS,
    });
  }

  // The range is resolved from the counted tickets, not before them: what the
  // mirror can answer for is a property of the mirror.
  const range = resolveRange(options.weeks, historyHorizon(counted, nowMs, options.year), options.year);

  const latestWeekStart = weekStartMs(nowMs);
  const weekStarts = Array.from(
    { length: range.selectedWeeks },
    (_, index) => latestWeekStart - (range.selectedWeeks - 1 - index) * WEEK_MS
  );

  const weeks: WeekSummary[] = weekStarts.map((startMs) => {
    const endMs = startMs + WEEK_MS;
    // The range always reaches the week holding `now`, because the question the
    // page answers is about this week. That week's Sunday has not happened, so
    // its figures are week-to-date and every string naming it has to say so.
    const inProgress = startMs === latestWeekStart;
    const categories = new Map<string, Pair>();
    const priorities = new Map<string, Pair>();
    const statuses = new Map<string, number>();
    let created = 0;
    let done = 0;
    const daysToDone: number[] = [];
    let outstanding = 0;
    let closedWithoutDoneAt = 0;

    for (const ticket of counted) {
      const { createdMs, doneMs } = ticket;

      if (createdMs !== null && createdMs >= startMs && createdMs < endMs) created += 1;

      if (doneMs !== null && doneMs >= startMs && doneMs < endMs) {
        done += 1;
        if (createdMs !== null) daysToDone.push(wholeDaysBetween(createdMs, doneMs));
        statuses.set(ticket.status, (statuses.get(ticket.status) ?? 0) + 1);
        bump(categories, ticket.category, 'done');
        bump(priorities, ticket.priority, 'done');
      }

      // Created by the week's end and not yet done at it. Ghosts have no done
      // date, so they stay outstanding for every week after they were created —
      // counted here and reported again on their own, as a subset.
      if (createdMs !== null && createdMs < endMs && (doneMs === null || doneMs >= endMs)) {
        outstanding += 1;
        if (ticket.isGhost) closedWithoutDoneAt += 1;
        bump(categories, ticket.category, 'outstanding');
        bump(priorities, ticket.priority, 'outstanding');
      }
    }

    return {
      key: weekKey(startMs),
      label: inProgress ? `${weekLabel(startMs)} · in progress` : weekLabel(startMs),
      shortLabel: weekShortLabel(startMs),
      inProgress,
      tileLabels: inProgress ? IN_PROGRESS_TILE_LABELS : FINISHED_TILE_LABELS,
      outstandingCaption: inProgress ? IN_PROGRESS_OUTSTANDING_CAPTION : OUTSTANDING_CAPTION,
      created,
      done,
      medianDaysToDone: median(daysToDone.sort((a, b) => a - b)),
      doneSample: daysToDone.length,
      outstanding,
      outstandingWithDoneDate: outstanding - closedWithoutDoneAt,
      closedWithoutDoneAt,
      outstandingCaveat: outstandingCaveat(closedWithoutDoneAt),
      doneByStatus: [...statuses.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([status, count]) => ({ status, label: statusLabel(status), count })),
      categories: [...categories.entries()]
        .sort(byWeightThenKey(FALLBACK_CATEGORY))
        // The label is the category's own name until the classifier owns a
        // display-casing source: casing it by rule here would be a second
        // naming authority, and would mangle any name that is not a word.
        .map(([category, pair]) => ({ category, label: category, ...pair })),
      priorities: [...priorities.entries()]
        .sort(byWeightThenKey(NO_PRIORITY))
        .map(([priority, pair]) => ({ priority, label: priorityLabel(priority), ...pair })),
    };
  });

  const rangeStartMs = weekStarts[0] ?? latestWeekStart;
  const rangeEndMs = latestWeekStart + WEEK_MS;

  return {
    weeks,
    range,
    backlogTitle: weeks.some((week) => week.key === weekKey(latestWeekStart))
      ? IN_PROGRESS_BACKLOG_TITLE
      : BACKLOG_TITLE,
    weeklySpeed: {
      caption: weeklySpeedCaption(weeks),
      emptyWeeksNote: emptyWeeksNote(weeks),
    },
    timeToFirstDone: timeToFirstDone(counted, rangeStartMs, rangeEndMs),
    openBacklog: openBacklog(open, nowMs),
    // Deliberately the same strict test `assembleBoard` uses, over the same
    // whole mirror, so this figure and the board's own open count agree.
    openRightNow: open.length,
    ghosts: ghostAudit(counted),
    excluded,
    excludedNote: excludedNote(excluded),
    doneRule: DONE_RULE,
  };
}
