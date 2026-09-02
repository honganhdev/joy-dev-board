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
  Comparison,
  GhostAudit,
  RangeMeta,
  TimeToFirstDone,
  WeeklyReport,
  WeekSummary,
} from './report-types';
import {
  WEEK_MS,
  dayLabel,
  dayStartMs,
  dayTickLabel,
  weekKey,
  weekLabel,
  weekShortLabel,
  weekStartMs,
  weekdayName,
} from './weeks';
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
const PERCENT_BASELINE_FLOOR = 5;
const GROWTH_SERIES_MAX_WEEKS = 26;

const DEV_FIX_STATUSES = new Set(['dev_fixing', 'dev_done']);

const NO_PRIORITY = '(no priority)';
const NO_STATUS = '(no status)';
const NO_MERCHANT = '(no merchant)';
const NO_PLAN = '(no plan)';

/**
 * `tsStatus` is not a closed enum, so naming the done statuses here could only
 * ever be a snapshot of the ones that existed when the sentence was written.
 * The rule the code runs is the date, not the status: any ticket HelpDesk has
 * stamped with a done date counts in the week that date falls in.
 */
const DONE_RULE =
  'Done = reached a done state in HelpDesk at any point, dated by HelpDesk\'s own done date.';
const NO_MEDIAN_LABEL = 'no median';

const BUG_RULE =
  'Counted here: tickets whose HelpDesk status is Dev Fixing or Dev Done. Weekly, day, range and feature figures use only those tickets.';

const TIME_ZONE_NOTE =
  'Every date on this page is read in Vietnam time (UTC+07:00): a week runs Monday 00:00 to the following Monday 00:00, and a day is midnight to midnight in that same zone.';

function trendSectionTitle(weeks: number): string {
  return `Last ${weekSpan(weeks)} to now. A new range resets the week above to the running week.`;
}
const DAY_COMPARISON_TITLE = 'Today against yesterday';
const DAY_COMPARISON_CAPTION =
  'Created today from midnight to now, against the same hours yesterday. ' +
  `A percentage is shown only when yesterday's count is at least ${PERCENT_BASELINE_FLOOR}.`;
const DAY_COMPARISON_UNAVAILABLE = 'no earlier day to compare';
const RANGE_COMPARISON_TITLE = 'Selected range against the preceding range';
const RANGE_COMPARISON_CAPTION =
  'Created up to now, against the same elapsed span one range earlier.';
const RANGE_COMPARISON_UNAVAILABLE = 'no earlier range to compare';
const WEEKLY_GROWTH_TITLE = 'Week-on-week created change';
const WEEKLY_GROWTH_CAPTION =
  'Each figure compares created Dev Fixing or Dev Done tickets with the same span one week earlier. A finished week uses the whole week; the running week uses Monday to now against Monday to the same time one week earlier. Choosing a week here moves the whole week band above: the week card, the three tiles, the per-day chart and the category split.';
const WEEKLY_GROWTH_HORIZON_NOTE =
  'A week with no comparable earlier period shows its created count instead of a change.';

const DAY_SPLIT_NAMED_SLOTS = 5;
/**
 * The rolled-up slot. Named `remaining` rather than `other` because `OTHER` is
 * itself a category the classifier emits: the two can sit side by side in the
 * readout, and two near-identical names meaning different things is the kind of
 * plausible-looking label this page exists to avoid.
 */
const REMAINING_CATEGORIES = '(remaining areas)';
const REMAINING_STATUSES = '(remaining statuses)';
const REMAINING_CATEGORIES_LABEL = 'REMAINING AREAS';
const REMAINING_STATUSES_LABEL = 'Remaining statuses';
const DAY_SPLIT_MODE_LABELS = {
  off: 'Off',
  category: 'By category',
  status: 'By status today',
};
/** The two cohorts, named once here so the browser composes neither word. */
const DAY_SPLIT_COHORT_LABELS = { created: 'created', done: 'done' };
/** The hatched region under the status split, named for the key beside it. */
const DAY_SPLIT_EXCLUDED_LABEL = 'not counted';
/**
 * Why a split button is dead. Deliberately says what the panel cannot do rather
 * than why: the split is withheld both when the payload is missing counts and
 * when the vocabulary outruns the colours the panel owns, and a message naming
 * only the first would be false in the second.
 */
const DAY_SPLIT_UNAVAILABLE_NOTES = {
  category: 'The category split cannot be drawn for this week.',
  status: 'The status split cannot be drawn for this week.',
};
const DAY_SPLIT_STATUS_CAPTION =
  'Each bar is split by where its tickets stand right now, not by where they stood on the day. Tickets created here that were closed without a done date are left out of the created bar, and are drawn as a hatched region up to the figure above it.';

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

/**
 * The category caption, counted from the vocabulary that was actually built
 * rather than from the constant beside it — a range with fewer areas than named
 * slots rolls nothing up, and the sentence has to stop promising a remainder.
 */
function categoryCaption(vocabulary: SplitVocabularyRow[]): string {
  const lead = 'Each bar is split by the feature area the ticket was classified into.';
  const rolled = vocabulary.at(-1)?.key === REMAINING_CATEGORIES;
  const named = rolled ? vocabulary.length - 1 : vocabulary.length;
  if (!rolled) return `${lead} Every area in this range is named.`;
  return `${lead} The ${countWord(named)} busiest areas in this range are named; every other area is grouped into the last segment.`;
}

const OUTSTANDING_CAPTION =
  'Outstanding at week end is historical, counted from the mirror.';

/**
 * The same caption for the week that is still running. Its Sunday has not
 * happened, so nothing about it can be described as an end-of-week figure.
 */
const IN_PROGRESS_OUTSTANDING_CAPTION =
  'This week has not finished, so every figure here is week-to-date rather than final. ' +
  'Outstanding counts tickets created and not yet done.';

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
/**
 * The title of the live open panel, which stands on its own in the today-and-
 * right-now band. It names the cohort because the number under it counts only
 * the dev-fix tickets, while `openRightNow` on the same payload counts every
 * open ticket: a bare `open right now` would read as the larger of the two.
 */
const DEV_FIX_OPEN_RIGHT_NOW_LABEL = 'Open Dev Fixing or Dev Done right now';

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
    'Tickets finished with no done date are in no week\'s median. Done dates include Dev Done. ' +
    "Each week's n is how many finished tickets its median is measured over.";
  if (medians.length === 0) return `${scope} No week shown has a measurable median.`;

  const minimum = Math.min(...medians);
  const maximum = Math.max(...medians);
  return `${scope} Measurable weekly medians range from ${minimum} to ${maximum} days.`;
}

/**
 * Movement across the range, stated between two *whole* weeks.
 *
 * The running week is excluded rather than included: its `created` is
 * week-to-date, so subtracting the first week's whole-week count from it prints
 * a fall whenever intake is merely flat — the exact misreading this panel
 * exists to prevent. The running week is not mentioned here because it already
 * carries its own like-for-like figure in the same panel.
 */
export function weeklyGrowthDirection(weeks: WeekSummary[]): string {
  const finished = weeks.filter((week) => !week.inProgress);
  const first = finished[0];
  const last = finished.at(-1);
  if (!first || !last || first === last) {
    return 'The selected range does not yet hold two finished weeks, so no change across finished weeks is shown.';
  }
  return (
    `Across the finished weeks in the selected range, created intake moved from ${first.created} ` +
    `in ${first.label} to ${last.created} in ${last.label} (${signed(last.created - first.created)}).`
  );
}

/**
 * The sample the weekly median stands on, printed beneath it. Kept to `n=…`
 * rather than `… tickets` because a 52-week strip gives each week about 20px:
 * a longer string truncates to an ellipsis and hides the very figure it adds.
 * The caption says what `n` counts.
 */
function doneSampleLabel(sample: number): string {
  return `n=${sample}`;
}

function emptyWeeksNote(weeks: WeekSummary[]): string | null {
  const empty = weeks.filter((week) => week.doneSample === 0).length;
  if (empty === 0) return null;
  if (empty === 1) return `1 of the ${weeks.length} weeks shown finished no measurable ticket, so it has no median.`;
  return `${empty} of the ${weeks.length} weeks shown finished no measurable ticket, so they have no median.`;
}

function listWeekdays(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/**
 * The shapes a cohort's week can be described as having, in the two forms the
 * sentence needs: one cohort on its own, and both cohorts sharing a shape.
 */
type DayShape = 'even' | 'early' | 'midweek' | 'late' | 'weekend';

const SHAPE_PHRASES: Record<DayShape, { one: string; both: string }> = {
  even: {
    one: 'was spread evenly across the working week',
    both: 'were both spread evenly across the working week',
  },
  early: { one: 'ran heaviest early in the week', both: 'both ran heaviest early in the week' },
  midweek: { one: 'ran heaviest midweek', both: 'both ran heaviest midweek' },
  late: {
    one: 'ran heaviest at the end of the week',
    both: 'both ran heaviest at the end of the week',
  },
  weekend: { one: 'happened only at the weekend', both: 'both happened only at the weekend' },
};

const WEEKEND_TAIL = ' and fell away at the weekend';

/**
 * Where one cohort's week sat. A weekday bucket holds about a dozen tickets, so
 * naming the single largest day renames it week to week on a one-ticket margin:
 * over 26 weeks of this board it lands on Wednesday, Thursday and Tuesday
 * almost equally often, off a corpus-wide spread of 425 / 412 / 415. The parts
 * of the working week are compared per day, because Friday alone against two
 * days of Monday and Tuesday is not a comparison, and one is named only when it
 * is half again the next.
 */
function workingWeekShape(counts: number[]): DayShape {
  const at = (day: number) => counts[day] ?? 0;
  if (at(0) + at(1) + at(2) + at(3) + at(4) === 0) return 'weekend';

  const parts = [
    { shape: 'early' as const, perDay: (at(0) + at(1)) / 2 },
    { shape: 'midweek' as const, perDay: (at(2) + at(3)) / 2 },
    { shape: 'late' as const, perDay: at(4) },
  ].sort((left, right) => right.perDay - left.perDay);

  const leader = parts[0];
  const runnerUp = parts[1];
  if (leader === undefined || runnerUp === undefined) return 'even';
  return leader.perDay >= runnerUp.perDay * 1.5 ? leader.shape : 'even';
}

/**
 * The one split on this panel that is a threefold effect rather than a
 * one-ticket margin: about a dozen tickets land on a weekday against three or
 * four on a weekend day. Per day, and only when the weekday rate is at least
 * double, so a week that merely dipped is not described as collapsing.
 */
function fallsAwayAtWeekend(counts: number[]): boolean {
  const at = (day: number) => counts[day] ?? 0;
  const weekdayPerDay = (at(0) + at(1) + at(2) + at(3) + at(4)) / 5;
  const weekendPerDay = (at(5) + at(6)) / 2;
  return weekdayPerDay > 0 && weekdayPerDay >= weekendPerDay * 2;
}

/**
 * The finished week's shape in one or two sentences — never a single winning
 * day. Each cohort is described only when it has something to describe: a week
 * that cleared nothing gets no clause about clearing, which is exactly what
 * naming the largest done column got wrong, since an empty column still has
 * one. When both cohorts say the same thing they say it once.
 */
function describeDays(
  days: Array<{ created: number | null; done: number | null }>,
  created: number,
  done: number
): string | null {
  const describe = (subject: string, counts: number[]) => ({
    subject,
    shape: workingWeekShape(counts),
    quiet: fallsAwayAtWeekend(counts),
  });
  const creation =
    created === 0 ? null : describe('creation', days.map((day) => day.created ?? 0));
  const clearing = done === 0 ? null : describe('clearing', days.map((day) => day.done ?? 0));

  if (
    creation !== null &&
    clearing !== null &&
    creation.shape === clearing.shape &&
    creation.quiet === clearing.quiet
  ) {
    const both = `creation and clearing ${SHAPE_PHRASES[creation.shape].both}`;
    return sentence(creation.quiet ? `${both}${WEEKEND_TAIL}` : both);
  }

  const cohorts = [creation, clearing].filter((cohort) => cohort !== null);
  if (cohorts.length === 0) return null;

  // With one cohort left to describe, or both falling away together, the
  // weekend belongs in the same breath; two separate collapses do not fit in
  // one clause without saying it twice.
  const shared = cohorts.every((cohort) => cohort.quiet);
  const clauses = cohorts
    .map(
      (cohort) =>
        `${cohort.subject} ${SHAPE_PHRASES[cohort.shape].one}${!shared && cohort.quiet ? WEEKEND_TAIL : ''}`
    )
    .join('; ');
  if (!shared) return sentence(clauses);
  return sentence(
    cohorts.length === 1 ? `${clauses}${WEEKEND_TAIL}` : `${clauses}. Both fell away at the weekend`
  );
}

/** Capitalises the opening word and closes the sentence. */
function sentence(body: string): string {
  return `${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
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

/** How many of the oldest open tickets the backlog panel lists. Named on screen. */
const OLDEST_ROWS = 5;

/**
 * Inclusive upper bounds for the all-open backlog age rows. The labels are
 * disjoint and match the bounds: a 30-day-old ticket is counted once, in
 * `7–30 days`, and no other label reads as containing it.
 */
const AGE_BUCKETS = [
  { label: '< 7 days', maxDays: 6 },
  { label: '7–30 days', maxDays: 30 },
  { label: '31–90 days', maxDays: 90 },
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

/**
 * Grouping key for a merchant row: case-folded, with surrounding and repeated
 * whitespace collapsed. `Hegen` and `HEGEN ` are one merchant, so they cannot
 * split into two rows and understate the concentration this panel measures.
 * The row keeps a real spelling from the data as its label — see `openByMerchant`.
 */
function merchantKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
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

type SplitVocabularyRow = { key: string; label: string };

/**
 * Folds keys that print the same label before ranking, then pins one remainder
 * slot last — but only when something actually rolls into it. The
 * lexicographically first raw key survives a label fold so the wire identity
 * does not depend on input order.
 */
function splitVocabulary(
  counts: Map<string, number>,
  labelFor: (key: string) => string,
  remainderKey: string,
  remainderLabel: string
): SplitVocabularyRow[] {
  const folded = new Map<string, { keys: string[]; count: number }>();
  for (const [key, count] of counts) {
    const label = labelFor(key);
    const entry = folded.get(label);
    if (entry) {
      entry.keys.push(key);
      entry.count += count;
    } else {
      folded.set(label, { keys: [key], count });
    }
  }

  const named = [...folded.entries()]
    .filter(([label]) => label !== remainderLabel)
    .map(([label, entry]) => ({
      key: [...entry.keys].sort((a, b) => a.localeCompare(b))[0] ?? remainderKey,
      label,
      count: entry.count,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, DAY_SPLIT_NAMED_SLOTS)
    .map(({ key, label }) => ({ key, label }));

  // Everything folded that did not get named rolls up: the labels beyond the cap
  // and any label colliding with the remainder's own. A range with fewer areas
  // than slots rolls up nothing, and a permanently-zero last slot printing
  // `REMAINING AREAS 0` under a caption promising a remainder is a claim the
  // data does not make.
  const rolled = folded.size - named.length;
  return rolled > 0 ? [...named, { key: remainderKey, label: remainderLabel }] : named;
}

function splitSlot(
  key: string,
  vocabulary: SplitVocabularyRow[],
  labelFor: (key: string) => string,
  remainderKey: string
): number {
  const label = labelFor(key);
  const named = vocabulary.findIndex((row) => row.key !== remainderKey && row.label === label);
  if (named !== -1) return named;
  // Unreachable with no remainder slot: the vocabulary only omits one when every
  // label it saw is named.
  return vocabulary.findIndex((row) => row.key === remainderKey);
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function emptyDaySplits(days: number, slots: number): number[][] {
  return Array.from({ length: days }, () => Array<number>(slots).fill(0));
}

function splitTotals(days: number[][], slots: number): number[] {
  return Array.from({ length: slots }, (_, slot) =>
    days.reduce((total, counts) => total + (counts[slot] ?? 0), 0)
  );
}

/** `high` → `High`. The absent-priority key is named rather than printed with its brackets. */
function priorityLabel(priority: string): string {
  if (priority === NO_PRIORITY) return 'No priority';
  return sentenceCase(priority) || priority;
}

function planLabel(plan: string): string {
  if (plan === NO_PLAN) return 'No plan';
  return sentenceCase(plan) || plan;
}

function isPresent(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isDevFix(ticket: HelpDeskTicket): boolean {
  return isPresent(ticket.tsStatus) && DEV_FIX_STATUSES.has(ticket.tsStatus.trim());
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

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function changePhrase(delta: number | null, noun: string): string | null {
  if (delta === null) return null;
  if (delta > 0) return `more than ${noun}`;
  if (delta < 0) return `fewer than ${noun}`;
  return `same as ${noun}`;
}

/** A ticket that survived exclusion, with everything the week loop needs precomputed. */
type Counted = {
  createdMs: number | null;
  doneMs: number | null;
  isGhost: boolean;
  isDevFix: boolean;
  category: string;
  priority: string;
  status: string;
};

/**
 * Compares created-ticket counts in two matching slices of adjacent periods.
 * `periodMs`, rather than elapsed time, keeps a partial day or week anchored to
 * the same clock span in the prior period.
 */
export function compareCreated(
  bugs: Array<Pick<Counted, 'createdMs'>>,
  startMs: number,
  endMs: number,
  periodMs: number,
  horizon: Pick<Horizon, 'startsAtMs'>
): Comparison {
  const current = bugs.filter(
    (ticket) => ticket.createdMs !== null && ticket.createdMs >= startMs && ticket.createdMs < endMs
  ).length;
  const previousStartMs = startMs - periodMs;

  if (horizon.startsAtMs !== null && previousStartMs < horizon.startsAtMs) {
    return {
      current,
      previous: null,
      delta: null,
      magnitudeLabel: null,
      percentLabel: null,
    };
  }

  const previousEndMs = endMs - periodMs;
  const previous = bugs.filter(
    (ticket) =>
      ticket.createdMs !== null &&
      ticket.createdMs >= previousStartMs &&
      ticket.createdMs < previousEndMs
  ).length;
  const delta = current - previous;
  const magnitudeLabel = delta === 0 ? null : String(Math.abs(delta));
  const percentLabel =
    delta === 0 || previous < PERCENT_BASELINE_FLOOR
      ? null
      : `${signed(Math.round((delta / previous) * 100))}%`;
  return { current, previous, delta, magnitudeLabel, percentLabel };
}

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
 *
 * Three presets are withheld at once for most of a year, and each keeps its own
 * sentence because each disabled button points at its own. So the withheld span
 * leads and the half they share is as short as it can be: three stacked lines
 * differing only in a number is what the long wording read as.
 */
function unavailableNote(preset: number, horizon: Horizon): string {
  return `${weekSpan(preset)} — needs more history than the mirror's ${weekSpan(horizon.weeks)}.`;
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
    noMedianLabel: NO_MEDIAN_LABEL,
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

function createdClosedWithoutDoneAtNote(count: number): string | null {
  if (count === 0) return null;
  return `${count} ${count === 1 ? 'ticket' : 'tickets'} created this week ${count === 1 ? 'was' : 'were'} closed without a done date and ${count === 1 ? 'is' : 'are'} drawn as a hatched slice rather than counted in the created bars.`;
}

/**
 * The footnote naming what reached no week or report figure, worded here like every other string
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
  const sentences: string[] = [];
  if (parts.length > 0) sentences.push(`In no week on this page: ${parts.join(' · ')}.`);
  if (excluded.undated > 0) {
    sentences.push(
      'A ticket with neither date is in no weekly figure, but is still counted in open right now while its status is open.'
    );
  }
  if (excluded.notDevFix > 0) {
    const subject =
      excluded.notDevFix === 1
        ? '1 dated ticket has another HelpDesk status and sits'
        : `${excluded.notDevFix} dated tickets have another HelpDesk status and sit`;
    sentences.push(
      `${subject} outside the Dev Fixing and Dev Done figures.`
    );
  }
  return sentences.length === 0 ? null : sentences.join(' ');
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
  const oldest = dated
    .sort((a, b) => a.createdMs - b.createdMs)
    .slice(0, OLDEST_ROWS)
    .map(({ ticket, ageDays }) => ({
      ticketId: ticket.ticketId,
      subject: ticket.subject?.trim() || '(no subject)',
      merchant: merchantName(ticket),
      ageDays,
      ageLabel: ageDays === 1 ? '1 day' : `${ageDays} days`,
    }));

  return {
    total,
    agingHeadline: total === 0 ? null : agingHeadline(olderThan30, dated.length, noCreatedDate),
    buckets: bucketCounts,
    noCreatedDate,
    noCreatedDateLabel: 'No readable created date',
    oldest,
    oldestCaption: oldestCaption(dated.length),
  };
}

/**
 * The share of the backlog older than 30 days, over the tickets whose age can
 * actually be read. Counting an undated ticket in the denominator would count
 * it as *not* old, which turns a lower bound into an exact-looking proportion.
 * The tickets left out are named rather than absorbed.
 */
function agingHeadline(olderThan30: number, dated: number, noCreatedDate: number): string {
  const excluded =
    noCreatedDate === 0
      ? ''
      : noCreatedDate === 1
        ? ' 1 more has no readable created date.'
        : ` ${noCreatedDate} more have no readable created date.`;

  if (dated === 0) {
    return 'No open Dev Fixing or Dev Done ticket has a readable created date, so no age share can be measured.';
  }

  const percentage = Math.round((olderThan30 / dated) * 100);
  return dated === 1
    ? `${percentage}% of the 1 open Dev Fixing or Dev Done ticket with a readable created date is older than 30 days.${excluded}`
    : `${percentage}% of the ${dated} open Dev Fixing or Dev Done tickets with a readable created date are older than 30 days.${excluded}`;
}

/**
 * Names the cap on the oldest list. The panel prints a fixed number of rows, so
 * without this a reader has no way to tell a capped list from the whole tail.
 */
function oldestCaption(dated: number): string {
  if (dated === 0) {
    return 'No open Dev Fixing or Dev Done ticket has a readable created date, so none is listed here.';
  }
  if (dated === 1) {
    return 'The 1 open Dev Fixing or Dev Done ticket with a readable created date is listed below.';
  }
  if (dated <= OLDEST_ROWS) {
    return `All ${dated} open Dev Fixing or Dev Done tickets with a readable created date are listed below, oldest first.`;
  }
  return `The ${OLDEST_ROWS} oldest of ${dated} open Dev Fixing or Dev Done tickets with a readable created date, oldest first.`;
}

/**
 * The divider names both scopes represented in this band: tickets created
 * today and the live open-ticket figures. The feature panel still names its
 * range-scoped columns separately, so the divider makes no claim about range.
 */
function openSectionTitle(
  total: number,
  devFixTotal: number,
  horizon: Horizon,
  year: number
): string {
  const count = total === 1 ? '1 ticket' : `${total} tickets`;
  const devFixCount = devFixTotal === 1 ? '1 is' : `${devFixTotal} are`;
  const reach =
    horizon.startsAtMs === null
      ? `The mirror covers tickets created since 1 Jan ${year}.`
      : `The mirror reaches back to ${dayLabel(horizon.startsAtMs)}.`;
  return (
    `Today and right now — all open tickets, ${count}. ${devFixCount} marked Dev Fixing or Dev Done, and ` +
    `only those are counted in the report figures below. ${reach}`
  );
}

function openByPlan(open: HelpDeskTicket[]): WeeklyReport['openByPlan'] {
  const counts = new Map<string, number>();
  for (const ticket of open) {
    const key = isPresent(ticket.appPlan) ? ticket.appPlan.trim() : NO_PLAN;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const rows = [...counts.entries()]
    .sort((a, b) => {
      if (a[0] === NO_PLAN) return 1;
      if (b[0] === NO_PLAN) return -1;
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .map(([key, count]) => ({ key, label: planLabel(key), count }));
  const free = rows.find((row) => row.key === 'free');

  return {
    rows,
    freeNote: free
      ? `Free accounts hold ${free.count} of ${open.length} open Dev Fixing or Dev Done ${open.length === 1 ? 'ticket' : 'tickets'} right now.`
      : null,
  };
}

function openByMerchant(open: HelpDeskTicket[]): WeeklyReport['openByMerchant'] {
  const groups = new Map<string, { label: string; count: number }>();
  for (const ticket of open) {
    const name = merchantName(ticket);
    const group = groups.get(merchantKey(name));
    // The label is the first spelling seen, so the row shows a spelling that
    // exists in the data rather than a folded key nobody writes.
    if (group) group.count += 1;
    else groups.set(merchantKey(name), { label: name, count: 1 });
  }

  const noMerchantKey = merchantKey(NO_MERCHANT);
  const noMerchant = groups.get(noMerchantKey)?.count ?? 0;
  const named = [...groups.entries()]
    .filter(([key]) => key !== noMerchantKey)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  const busiest = named.slice(0, 5);
  const tail = named.slice(5);
  const busiestCount = busiest.reduce((total, [, group]) => total + group.count, 0);
  const tailCount = tail.reduce((total, [, group]) => total + group.count, 0);
  const percentage = open.length === 0 ? 0 : Math.round((busiestCount / open.length) * 100);
  const rows = busiest.map(([key, group]) => ({ key, label: group.label, count: group.count }));
  if (noMerchant > 0) rows.push({ key: NO_MERCHANT, label: NO_MERCHANT, count: noMerchant });

  let concentrationNote: string;
  if (busiest.length === 0) {
    concentrationNote = 'No named merchant holds an open Dev Fixing or Dev Done ticket right now.';
  } else if (busiest.length === 1) {
    concentrationNote = `The busiest merchant holds ${busiestCount} of ${open.length} open Dev Fixing or Dev Done ${open.length === 1 ? 'ticket' : 'tickets'} right now (${percentage}%).`;
  } else {
    concentrationNote = `The ${busiest.length} busiest merchants hold ${busiestCount} of ${open.length} open Dev Fixing or Dev Done tickets right now (${percentage}%).`;
  }

  return {
    rows,
    concentrationNote,
    tailNote:
      tail.length === 0
        ? null
        : `The rest are spread across ${tail.length} ${tail.length === 1 ? 'merchant' : 'merchants'}.`,
    tailCount,
  };
}

type FeatureMetric = {
  open: number;
  /** Open tickets whose age can be read; the denominator of `olderThan30`. */
  openWithCreatedDate: number;
  olderThan30: number;
  daysToDone: number[];
};

function featureMetric(metrics: Map<string, FeatureMetric>, key: string): FeatureMetric {
  const existing = metrics.get(key);
  if (existing) return existing;
  const created = { open: 0, openWithCreatedDate: 0, olderThan30: 0, daysToDone: [] };
  metrics.set(key, created);
  return created;
}

/** What a feature row's intake is compared against, in the words the row reads out. */
const FEATURE_COMPARISON_NOUN = 'the preceding range';

function openByFeature(
  open: HelpDeskTicket[],
  counted: Counted[],
  nowMs: number,
  rangeStartMs: number,
  rangeEndMs: number,
  comparisonEndMs: number,
  comparisonPeriodMs: number,
  horizon: Horizon
): WeeklyReport['openByFeature'] {
  const metrics = new Map<string, FeatureMetric>();

  let noCreatedDate = 0;
  for (const ticket of open) {
    const metric = featureMetric(metrics, classify(ticket));
    metric.open += 1;
    const createdMs = timestamp(ticket.createdAt);
    if (createdMs === null || Number.isNaN(createdMs)) {
      noCreatedDate += 1;
      continue;
    }
    // Same rule as the backlog headline: an unreadable date is left out of the
    // age denominator rather than counted as a ticket that is not old.
    metric.openWithCreatedDate += 1;
    if (wholeDaysBetween(createdMs, nowMs) > 30) metric.olderThan30 += 1;
  }

  for (const ticket of counted) {
    if (
      ticket.doneMs === null ||
      ticket.createdMs === null ||
      ticket.doneMs < rangeStartMs ||
      ticket.doneMs >= rangeEndMs
    ) {
      continue;
    }
    featureMetric(metrics, ticket.category).daysToDone.push(
      wholeDaysBetween(ticket.createdMs, ticket.doneMs)
    );
  }

  // A feature whose intake fell to nothing has no open ticket and nothing
  // finished inside the range, so neither seed above reaches it — and its row
  // would vanish exactly when its decline is the thing worth reading. Seeding
  // from both comparison spans keeps `5 → 0` on the page. The row carries no
  // current data, so every other column falls to its own no-value wording.
  const comparisonStartMs = rangeStartMs - comparisonPeriodMs;
  for (const ticket of counted) {
    const { createdMs } = ticket;
    if (createdMs === null || createdMs < comparisonStartMs || createdMs >= comparisonEndMs) {
      continue;
    }
    featureMetric(metrics, ticket.category);
  }

  const rows = [...metrics.entries()]
    .sort((a, b) => {
      if (a[0] === FALLBACK_CATEGORY) return 1;
      if (b[0] === FALLBACK_CATEGORY) return -1;
      return b[1].open - a[1].open || a[0].localeCompare(b[0]);
    })
    .map(([key, metric]) => {
      const doneSample = metric.daysToDone.length;
      const medianDaysToDone =
        doneSample < 3 ? null : median(metric.daysToDone.sort((a, b) => a - b));
      const comparison = compareCreated(
        counted.filter((ticket) => ticket.category === key),
        rangeStartMs,
        comparisonEndMs,
        comparisonPeriodMs,
        horizon
      );
      return {
        key,
        label: key,
        open: metric.open,
        openWithCreatedDate: metric.openWithCreatedDate,
        olderThan30: metric.olderThan30,
        medianDaysToDone,
        doneSample,
        speedNote:
          `${doneSample} ${doneSample === 1 ? 'finished ticket' : 'finished tickets'} in range · ` +
          (medianDaysToDone === null ? NO_MEDIAN_LABEL : `median ${medianDaysToDone} d`),
        comparison,
        // The row prints its direction as a glyph, which carries no text. This
        // is the same direction in words, for a reader who is not looking at it.
        changeLabel: changePhrase(comparison.delta, FEATURE_COMPARISON_NOUN),
      };
    });

  const undated =
    noCreatedDate === 0
      ? ''
      : ` ${noCreatedDate} open ${noCreatedDate === 1 ? 'ticket has' : 'tickets have'} no readable ` +
        'created date and sit outside the age figures.';

  return {
    rows,
    unavailableNote:
      compareCreated([], rangeStartMs, comparisonEndMs, comparisonPeriodMs, horizon).previous ===
      null
        ? 'The mirror has no comparable earlier period for the feature comparisons.'
        : null,
    caption:
      'Open and older-than-30-day figures use open Dev Fixing or Dev Done tickets right now, aged over those with a ' +
      'readable created date. Speed uses tickets finished in the selected range with both dates. ' +
      'Medians are shown only with at least 3 finished tickets; the sample appears first and is ' +
      'not a rate. Intake change compares the selected range up to now with the same span immediately ' +
      `before it.${undated}`,
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
  const openBugs = open.filter(isDevFix);
  const excluded = { deleted: 0, unparseableDate: 0, undated: 0, notDevFix: 0 };
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
      isDevFix: isDevFix(ticket),
      category: classify(ticket),
      priority: isPresent(ticket.priority) ? ticket.priority.trim() : NO_PRIORITY,
      status: isPresent(ticket.tsStatus) ? ticket.tsStatus.trim() : NO_STATUS,
    });
  }

  // The range is resolved from the counted tickets, not before them: what the
  // mirror can answer for is a property of the mirror.
  const horizon = historyHorizon(counted, nowMs, options.year);
  const range = resolveRange(options.weeks, horizon, options.year);
  const bugs = counted.filter((ticket) => ticket.isDevFix);
  excluded.notDevFix = counted.length - bugs.length;

  const latestWeekStart = weekStartMs(nowMs);
  const weekStarts = Array.from(
    { length: range.selectedWeeks },
    (_, index) => latestWeekStart - (range.selectedWeeks - 1 - index) * WEEK_MS
  );

  const rangeStartMs = weekStarts[0] ?? latestWeekStart;
  // `rangeEndMs` is next Monday, while the range comparison ends at `nowMs`.
  // They agree only while this page has no future-dated events and will diverge
  // if it ever does.
  const rangeEndMs = latestWeekStart + WEEK_MS;
  const dayComparison = compareCreated(
    bugs,
    dayStartMs(nowMs),
    nowMs,
    DAY_MS,
    horizon
  );
  const rangeComparison = compareCreated(
    bugs,
    rangeStartMs,
    nowMs,
    range.selectedWeeks * WEEK_MS,
    horizon
  );
  const categoryCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  for (const ticket of bugs) {
    if (ticket.createdMs !== null && ticket.createdMs >= rangeStartMs && ticket.createdMs < rangeEndMs) {
      increment(categoryCounts, ticket.category);
      if (!ticket.isGhost) increment(statusCounts, ticket.status);
    }
    if (ticket.doneMs !== null && ticket.doneMs >= rangeStartMs && ticket.doneMs < rangeEndMs) {
      increment(categoryCounts, ticket.category);
      increment(statusCounts, ticket.status);
    }
  }
  const categoryVocabulary = splitVocabulary(
    categoryCounts,
    (category) => category,
    REMAINING_CATEGORIES,
    REMAINING_CATEGORIES_LABEL
  );
  const statusVocabulary = splitVocabulary(
    statusCounts,
    statusLabel,
    REMAINING_STATUSES,
    REMAINING_STATUSES_LABEL
  );
  const showWeeklyGrowth = range.selectedWeeks <= GROWTH_SERIES_MAX_WEEKS;

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
    const createdByDay = Array<number>(7).fill(0);
    const doneByDay = Array<number>(7).fill(0);
    const createdGhostByDay = Array<number>(7).fill(0);
    const createdCategoryByDay = emptyDaySplits(7, categoryVocabulary.length);
    const createdStatusByDay = emptyDaySplits(7, statusVocabulary.length);
    const doneCategoryByDay = emptyDaySplits(7, categoryVocabulary.length);
    const doneStatusByDay = emptyDaySplits(7, statusVocabulary.length);
    const daysToDone: number[] = [];
    let outstanding = 0;
    let closedWithoutDoneAt = 0;
    let createdClosedWithoutDoneAt = 0;

    for (const ticket of bugs) {
      const { createdMs, doneMs } = ticket;

      if (createdMs !== null && createdMs >= startMs && createdMs < endMs) {
        created += 1;
        const day = Math.floor((createdMs - startMs) / DAY_MS);
        createdByDay[day] = (createdByDay[day] ?? 0) + 1;
        const categorySlot = splitSlot(
          ticket.category,
          categoryVocabulary,
          (category) => category,
          REMAINING_CATEGORIES
        );
        const createdCategories = createdCategoryByDay[day];
        if (createdCategories) createdCategories[categorySlot] = (createdCategories[categorySlot] ?? 0) + 1;
        if (ticket.isGhost) {
          createdClosedWithoutDoneAt += 1;
          createdGhostByDay[day] = (createdGhostByDay[day] ?? 0) + 1;
        } else {
          const statusSlot = splitSlot(ticket.status, statusVocabulary, statusLabel, REMAINING_STATUSES);
          const createdStatuses = createdStatusByDay[day];
          if (createdStatuses) createdStatuses[statusSlot] = (createdStatuses[statusSlot] ?? 0) + 1;
        }
      }

      if (doneMs !== null && doneMs >= startMs && doneMs < endMs) {
        done += 1;
        const day = Math.floor((doneMs - startMs) / DAY_MS);
        doneByDay[day] = (doneByDay[day] ?? 0) + 1;
        const categorySlot = splitSlot(
          ticket.category,
          categoryVocabulary,
          (category) => category,
          REMAINING_CATEGORIES
        );
        const doneCategories = doneCategoryByDay[day];
        if (doneCategories) doneCategories[categorySlot] = (doneCategories[categorySlot] ?? 0) + 1;
        const statusSlot = splitSlot(ticket.status, statusVocabulary, statusLabel, REMAINING_STATUSES);
        const doneStatuses = doneStatusByDay[day];
        if (doneStatuses) doneStatuses[statusSlot] = (doneStatuses[statusSlot] ?? 0) + 1;
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

    const days = Array.from({ length: 7 }, (_, day) => {
      const dayStart = startMs + day * DAY_MS;
      const createdCount = createdByDay[day] ?? 0;
      const doneCount = doneByDay[day] ?? 0;
      const received = createdCount > 0 || doneCount > 0;
      const future = dayStart > nowMs && !received;
      return {
        label: dayTickLabel(dayStart),
        created: future ? null : createdCount,
        done: future ? null : doneCount,
        createdClosedWithoutDoneAt: future ? null : (createdGhostByDay[day] ?? 0),
        createdSplit: future
          ? null
          : {
              category: createdCategoryByDay[day] ?? [],
              status: createdStatusByDay[day] ?? [],
            },
        doneSplit: future
          ? null
          : {
              category: doneCategoryByDay[day] ?? [],
              status: doneStatusByDay[day] ?? [],
            },
      };
    });
    const daysHighlight = inProgress ? null : describeDays(days, created, done);
    const elapsedDay = inProgress ? Math.min(6, Math.floor((nowMs - startMs) / DAY_MS)) : null;
    const createdComparison = compareCreated(
      bugs,
      startMs,
      Math.min(endMs, nowMs),
      WEEK_MS,
      horizon
    );
    const daysNote = (() => {
      if (!inProgress) return null;

      const futureDays = days.flatMap((day, index) =>
        day.created === null ? [weekdayName(startMs + index * DAY_MS)] : []
      );
      const futureSentence =
        futureDays.length === 0
          ? ''
          : futureDays.length === 1
            ? `${futureDays[0] ?? ''} has not happened yet, so it has no figures. `
            : `${listWeekdays(futureDays)} have not happened yet, so they have no figures. `;
      return `${futureSentence}${weekdayName(startMs + (elapsedDay ?? 0) * DAY_MS)} is still running, so its figures are day-to-date.`;
    })();

    return {
      key: weekKey(startMs),
      label: inProgress ? `${weekLabel(startMs)} · in progress` : weekLabel(startMs),
      shortLabel: weekShortLabel(startMs),
      inProgress,
      currentDayLabel: elapsedDay === null ? null : (days[elapsedDay]?.label ?? null),
      tileLabels: inProgress ? IN_PROGRESS_TILE_LABELS : FINISHED_TILE_LABELS,
      outstandingCaption: inProgress ? IN_PROGRESS_OUTSTANDING_CAPTION : OUTSTANDING_CAPTION,
      created,
      createdComparison,
      createdDeltaLabel: showWeeklyGrowth
        ? createdComparison.previous === null
          ? String(createdComparison.current)
          : signed(createdComparison.delta ?? 0)
        : null,
      createdChangeLabel: changePhrase(
        createdComparison.delta,
        inProgress ? 'the same span last week' : 'last week'
      ),
      done,
      medianDaysToDone: median(daysToDone.sort((a, b) => a - b)),
      doneSample: daysToDone.length,
      doneSampleLabel: doneSampleLabel(daysToDone.length),
      outstanding,
      outstandingWithDoneDate: outstanding - closedWithoutDoneAt,
      closedWithoutDoneAt,
      outstandingCaveat: outstandingCaveat(closedWithoutDoneAt),
      daySplitTotals: {
        category: {
          created: splitTotals(createdCategoryByDay, categoryVocabulary.length),
          done: splitTotals(doneCategoryByDay, categoryVocabulary.length),
        },
        status: {
          created: splitTotals(createdStatusByDay, statusVocabulary.length),
          done: splitTotals(doneStatusByDay, statusVocabulary.length),
        },
      },
      createdClosedWithoutDoneAt,
      createdClosedWithoutDoneAtNote: createdClosedWithoutDoneAtNote(createdClosedWithoutDoneAt),
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
      days,
      daysHighlight,
      daysNote,
    };
  });

  return {
    weeks,
    range,
    backlogTitle: weeks.some((week) => week.key === weekKey(latestWeekStart))
      ? IN_PROGRESS_BACKLOG_TITLE
      : BACKLOG_TITLE,
    weeklySpeed: {
      caption: weeklySpeedCaption(weeks),
      emptyWeeksNote: emptyWeeksNote(weeks),
      // Shares GROWTH_SERIES_MAX_WEEKS with the growth row: the same slot width
      // that cannot hold a signed figure cannot hold a median either.
      unavailableLabel: showWeeklyGrowth
        ? null
        : `A range of ${range.selectedWeeks} weeks leaves each week too narrow to print a figure, so the weekly median is shown for ranges up to ${GROWTH_SERIES_MAX_WEEKS} weeks.`,
    },
    weeklyGrowth: {
      title: WEEKLY_GROWTH_TITLE,
      caption: WEEKLY_GROWTH_CAPTION,
      direction: weeklyGrowthDirection(weeks),
      horizonNote:
        showWeeklyGrowth && weeks.some((week) => week.createdComparison.previous === null)
          ? WEEKLY_GROWTH_HORIZON_NOTE
          : null,
      unavailableNote:
        showWeeklyGrowth
          ? null
          : `A range of ${range.selectedWeeks} weeks leaves each week too narrow to print a figure, so the week-on-week change is shown for ranges up to ${GROWTH_SERIES_MAX_WEEKS} weeks.`,
    },
    timeToFirstDone: timeToFirstDone(bugs, rangeStartMs, rangeEndMs),
    dayComparison: {
      ...dayComparison,
      title: DAY_COMPARISON_TITLE,
      caption: DAY_COMPARISON_CAPTION,
      currentLabel: 'created today',
      changeLabel: changePhrase(dayComparison.delta, 'yesterday'),
      unavailableNote:
        dayComparison.previous === null ? DAY_COMPARISON_UNAVAILABLE : null,
    },
    rangeComparison: {
      ...rangeComparison,
      title: RANGE_COMPARISON_TITLE,
      caption: RANGE_COMPARISON_CAPTION,
      currentLabel: 'created in this range',
      changeLabel: changePhrase(
        rangeComparison.delta,
        `the preceding ${range.selectedWeeks} weeks`
      ),
      unavailableNote:
        rangeComparison.previous === null ? RANGE_COMPARISON_UNAVAILABLE : null,
    },
    daySplit: {
      categories: categoryVocabulary.map(({ key: category, label }) => ({ category, label })),
      statuses: statusVocabulary.map(({ key: status, label }) => ({ status, label })),
      modeLabels: DAY_SPLIT_MODE_LABELS,
      cohortLabels: DAY_SPLIT_COHORT_LABELS,
      excludedLabel: DAY_SPLIT_EXCLUDED_LABEL,
      captions: {
        category: categoryCaption(categoryVocabulary),
        status: DAY_SPLIT_STATUS_CAPTION,
      },
      unavailableNotes: DAY_SPLIT_UNAVAILABLE_NOTES,
      asOfLabel: `Read at ${dayLabel(nowMs)}`,
    },
    openBacklog: openBacklog(openBugs, nowMs),
    openSectionTitle: openSectionTitle(open.length, openBugs.length, horizon, options.year),
    openByPlan: openByPlan(openBugs),
    openByMerchant: openByMerchant(openBugs),
    openByFeature: openByFeature(
      openBugs,
      bugs,
      nowMs,
      rangeStartMs,
      rangeEndMs,
      nowMs,
      range.selectedWeeks * WEEK_MS,
      horizon
    ),
    // Deliberately the same strict test `assembleBoard` uses, over the same whole
    // mirror, so this figure and the board's own open count keep agreeing.
    openRightNow: open.length,
    devFixOpenRightNow: openBugs.length,
    devFixOpenRightNowLabel: DEV_FIX_OPEN_RIGHT_NOW_LABEL,
    ghosts: ghostAudit(bugs),
    excluded,
    excludedNote: excludedNote(excluded),
    bugRule: BUG_RULE,
    doneRule: DONE_RULE,
    timeZoneNote: TIME_ZONE_NOTE,
    trendSectionTitle: trendSectionTitle(range.selectedWeeks),
  };
}
