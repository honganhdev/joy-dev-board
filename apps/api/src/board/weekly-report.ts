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
import { WEEK_MS, weekKey, weekLabel, weekShortLabel, weekStartMs } from './weeks';
import type { HelpDeskTicket } from '../helpdesk/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole-week ranges the control offers, smallest first. */
const PRESET_WEEKS = [4, 12, 26, 52];
const DEFAULT_WEEKS = 12;

const NO_PRIORITY = '(no priority)';
const NO_STATUS = '(no status)';

const DONE_RULE =
  'Done = reached a done state in HelpDesk (Done, Dev Done, Done Speed Up), dated by ' +
  "HelpDesk's own done date.";

const OUTSTANDING_CAPTION =
  'Outstanding at week end is historical and counts tickets HelpDesk closed without a done ' +
  "date; open right now is today's live count of tickets whose status is open.";

const TIME_TO_FIRST_DONE_CAPTION =
  "Measured from a ticket's created date to the first time HelpDesk marked it done, which " +
  'includes Dev Done. This is not time to customer delivery.';

/** Upper bound in whole days, and the label the histogram prints. */
const BUCKETS = [
  { label: '≤ 1 day', maxDays: 1 },
  { label: '2–3 days', maxDays: 3 },
  { label: '4–7 days', maxDays: 7 },
  { label: '8–14 days', maxDays: 14 },
  { label: '15–30 days', maxDays: 30 },
  { label: 'over 30 days', maxDays: Infinity },
];

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

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
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
  isClosed: boolean;
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
 * How many whole weeks the mirror can answer for: the pull covers one calendar
 * year, so nothing before the week holding 1 January of that year exists.
 */
function coveredWeeks(year: number, nowMs: number): number {
  const yearStart = weekStartMs(Date.UTC(year, 0, 1) - 7 * 60 * 60 * 1000);
  const latest = weekStartMs(nowMs);
  return Math.max(1, Math.round((latest - yearStart) / WEEK_MS) + 1);
}

/**
 * The range actually served. An unusable `weeks` is not a 400: the response
 * echoes what was used, so an overridden request is visible rather than silent.
 */
function resolveRange(requested: number, year: number, nowMs: number): RangeMeta {
  const available = coveredWeeks(year, nowMs);
  const wanted = Number.isInteger(requested) && requested > 0 ? requested : DEFAULT_WEEKS;
  const usable = PRESET_WEEKS.filter((weeks) => weeks <= wanted && weeks <= available);
  const selectedWeeks = usable[usable.length - 1] ?? PRESET_WEEKS[0] ?? DEFAULT_WEEKS;

  return {
    presets: PRESET_WEEKS.map((weeks) => ({
      weeks,
      label: `${weeks} weeks`,
      available: weeks <= available,
    })),
    selectedWeeks,
    coverageNote:
      `Counts cover HelpDesk tickets created in ${year}. Tickets opened before 1 Jan ${year} ` +
      'are not in the mirror and appear in no week, so backlog is a floor, not a total.',
  };
}

function timeToFirstDone(counted: Counted[], rangeStartMs: number, rangeEndMs: number): TimeToFirstDone {
  const days: number[] = [];
  const bucketCounts = BUCKETS.map((bucket) => ({ label: bucket.label, count: 0 }));
  let unmeasurable = 0;

  for (const ticket of counted) {
    const { doneMs, createdMs } = ticket;
    if (doneMs === null || doneMs < rangeStartMs || doneMs >= rangeEndMs) continue;
    if (createdMs === null) {
      unmeasurable += 1;
      continue;
    }
    const age = wholeDaysBetween(createdMs, doneMs);
    days.push(age);
    const index = BUCKETS.findIndex((bucket) => age <= bucket.maxDays);
    const bucket = bucketCounts[index];
    if (bucket) bucket.count += 1;
  }

  return {
    sampleSize: days.length,
    unmeasurable,
    medianDays: median([...days].sort((a, b) => a - b)),
    buckets: bucketCounts,
    caption: TIME_TO_FIRST_DONE_CAPTION,
  };
}

function ghostAudit(counted: Counted[], latest: WeekSummary | undefined): GhostAudit {
  const count = counted.filter((ticket) => ticket.isGhost).length;
  const closedTotal = counted.filter((ticket) => ticket.isClosed).length;
  const latestOutstanding = latest?.outstanding ?? 0;

  return {
    count,
    closedTotal,
    shareOfClosed: closedTotal === 0 ? 0 : round3(count / closedTotal),
    shareOfOutstandingLatestWeek: latestOutstanding === 0 ? 0 : round3(count / latestOutstanding),
    caveat:
      count === 0
        ? null
        : `${count} finished ${count === 1 ? 'ticket carries' : 'tickets carry'} no done date in ` +
          'HelpDesk. They are counted as outstanding and shown separately; nothing is estimated ' +
          'for them.',
  };
}

/**
 * Builds the whole report.
 *
 * `now` and `year` are injected rather than read from the clock and the
 * environment: the tests need a fixed range without freezing the runner's
 * timezone, and the coverage note must name the window the pull actually used.
 */
export function aggregateWeeklyReport(
  tickets: HelpDeskTicket[],
  options: { weeks: number; now: Date; pulledAt: string; year: number }
): WeeklyReport {
  const nowMs = options.now.getTime();
  const range = resolveRange(options.weeks, options.year, nowMs);

  const latestWeekStart = weekStartMs(nowMs);
  const weekStarts = Array.from(
    { length: range.selectedWeeks },
    (_, index) => latestWeekStart - (range.selectedWeeks - 1 - index) * WEEK_MS
  );

  const excluded = { deleted: 0, unparseableDate: 0 };
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

    const isClosed = ticket.ticketStatus === 'closed';
    counted.push({
      createdMs,
      doneMs,
      isClosed,
      isGhost: isClosed && doneMs === null,
      category: classify(ticket),
      priority: isPresent(ticket.priority) ? ticket.priority.trim() : NO_PRIORITY,
      status: isPresent(ticket.tsStatus) ? ticket.tsStatus.trim() : NO_STATUS,
    });
  }

  const weeks: WeekSummary[] = weekStarts.map((startMs) => {
    const endMs = startMs + WEEK_MS;
    const categories = new Map<string, Pair>();
    const priorities = new Map<string, Pair>();
    const statuses = new Map<string, number>();
    let created = 0;
    let done = 0;
    let outstanding = 0;
    let closedWithoutDoneAt = 0;

    for (const ticket of counted) {
      const { createdMs, doneMs } = ticket;

      if (createdMs !== null && createdMs >= startMs && createdMs < endMs) created += 1;

      if (doneMs !== null && doneMs >= startMs && doneMs < endMs) {
        done += 1;
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
      label: weekLabel(startMs),
      shortLabel: weekShortLabel(startMs),
      created,
      done,
      outstanding,
      outstandingWithDoneDate: outstanding - closedWithoutDoneAt,
      closedWithoutDoneAt,
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
    timeToFirstDone: timeToFirstDone(counted, rangeStartMs, rangeEndMs),
    // Deliberately the same strict test `assembleBoard` uses, over the same
    // whole mirror, so this figure and the board's own open count agree.
    openRightNow: tickets.filter((ticket) => ticket.ticketStatus === 'open').length,
    ghosts: ghostAudit(counted, weeks[weeks.length - 1]),
    excluded,
    doneRule: DONE_RULE,
    outstandingCaption: OUTSTANDING_CAPTION,
    pulledAt: options.pulledAt,
  };
}
