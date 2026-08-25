/**
 * Week arithmetic for the weekly report, fixed to Vietnam time (+07:00).
 *
 * Vietnam has no DST, so the offset is exact and a week
 * `[Mon 00:00 +07:00, next Mon 00:00 +07:00)` is `[Sun 17:00Z, next Sun 17:00Z)`.
 * Everything here works in that shifted frame: an instant is moved by the offset
 * and then read with UTC getters, which is what makes the result independent of
 * the machine's own timezone.
 *
 * Keys are ISO week keys (`2026-W01`), so the year in a key is the ISO week-year
 * and not the calendar year of the week's Monday — ISO week 1 of 2026 starts on
 * Mon 29 Dec 2025, and keying that week `2025-W01` would sort it before every
 * 2025 week and label it with the wrong year.
 */

const OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const WEEK_MS = 7 * DAY_MS;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type LocalParts = { year: number; month: number; day: number; weekday: number };

/** Calendar fields of an instant, read in +07:00. */
function localParts(ms: number): LocalParts {
  const shifted = new Date(ms + OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    // 0 = Monday, so a day's distance from its Monday is the weekday itself.
    weekday: (shifted.getUTCDay() + 6) % 7,
  };
}

/** Midnight of a local day, as an offset-free number for week arithmetic. */
function localMidnight({ year, month, day }: LocalParts): number {
  return Date.UTC(year, month, day);
}

function dayAndMonth({ day, month }: LocalParts): string {
  return `${day} ${MONTHS[month] ?? ''}`;
}

/** UTC instant of the Monday 00:00 +07:00 that opens the week containing `ms`. */
export function weekStartMs(ms: number): number {
  const parts = localParts(ms);
  return localMidnight(parts) - parts.weekday * DAY_MS - OFFSET_MS;
}

/** ISO week key (`2026-W34`) of the week that starts at `startMs`. */
export function weekKey(startMs: number): string {
  // A week's Thursday always falls in that week's ISO week-year, which is what
  // makes a week straddling New Year resolve to one year rather than two.
  const isoYear = localParts(startMs + 3 * DAY_MS).year;
  // ISO week 1 is the week containing 4 January.
  const jan4 = Date.UTC(isoYear, 0, 4);
  const jan4Weekday = (new Date(jan4).getUTCDay() + 6) % 7;
  const firstWeekStart = jan4 - jan4Weekday * DAY_MS;
  const weekNumber = Math.round((localMidnight(localParts(startMs)) - firstWeekStart) / WEEK_MS) + 1;
  return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * `Mon 17 Aug – Sun 23 Aug 2026`. The opening year is printed only when the week
 * straddles a year boundary, where leaving it out would read as the wrong year.
 */
export function weekLabel(startMs: number): string {
  const start = localParts(startMs);
  const end = localParts(startMs + WEEK_MS - DAY_MS);
  const startYear = start.year === end.year ? '' : ` ${start.year}`;
  return `Mon ${dayAndMonth(start)}${startYear} – Sun ${dayAndMonth(end)} ${end.year}`;
}

/** `17 Aug` — the column tick under a week. */
export function weekShortLabel(startMs: number): string {
  return dayAndMonth(localParts(startMs));
}
