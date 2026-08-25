import type { Config } from '../config';
import type { ByDateResponse, HelpDeskTag, HelpDeskTicket, TagsResponse } from './types';

/** Raised when HelpDesk is unreachable, slow, or answers with a non-2xx. */
export class HelpDeskError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'HelpDeskError';
  }
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * `by-date` silently truncates any window to this many rows, keeping the newest
 * by `createdAt` and reporting the truncated count in `data.total` as though it
 * were the real one. There is no cursor: `limit` and `page` are ignored.
 *
 * The cut also happens *before* `appName` is applied, so a response filtered by
 * app can never reveal it — a whole-year query for one app came back with 384
 * rows and `total: 384` while having dropped four months of them. That is why
 * this pull asks for whole windows and matches `appName` here instead: only an
 * unfiltered response can be checked against the cap.
 */
const BY_DATE_ROW_CAP = 5000;

/**
 * Days per request. All apps together create ~150 tickets a day, so a week runs
 * ~1,050 rows — about a fifth of the cap. A month is not safe: the busiest
 * observed month reached 4,417, inside 12% of the ceiling. A year is hopeless;
 * it returns the most recent ~34 days and discards the rest.
 */
const CHUNK_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One `by-date` request window, as the API wants its bounds: inclusive ISO. */
export type DateWindow = { startDate: string; endDate: string };

/**
 * Splits `year` into consecutive request windows, each ending one millisecond
 * before the next begins so no ticket can land in two of them.
 *
 * Windows that start after `now` are not generated: tickets cannot be created
 * in the future, and asking for them costs a round trip each. The window
 * holding `now` is still requested in full, which leaves a week of slack for
 * clock skew between here and HelpDesk.
 */
export function chunkYear(year: number, now: Date = new Date()): DateWindow[] {
  const yearEnd = Date.UTC(year + 1, 0, 1) - 1;
  const windows: DateWindow[] = [];

  for (let start = Date.UTC(year, 0, 1); start <= yearEnd; start += CHUNK_DAYS * DAY_MS) {
    const end = Math.min(start + CHUNK_DAYS * DAY_MS - 1, yearEnd);
    windows.push({
      startDate: new Date(start).toISOString(),
      endDate: new Date(end).toISOString(),
    });
    if (end >= now.getTime()) break;
  }

  return windows;
}

/** Every call is a GET — v1 never writes back to HelpDesk. */
async function get<T>(config: Config, url: URL): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-Key': config.apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new HelpDeskError(`HelpDesk request to ${url.pathname} failed: ${reason}`);
  }

  if (!response.ok) {
    throw new HelpDeskError(
      `HelpDesk responded ${response.status} ${response.statusText} for ${url.pathname}`,
      response.status
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new HelpDeskError(`HelpDesk returned a non-JSON body for ${url.pathname}`);
  }
}

/**
 * Pulls every ticket for `config.appName` in `config.year`, one week at a time.
 *
 * A single whole-year request loses most of the year to `BY_DATE_ROW_CAP`, so
 * the year is walked in `CHUNK_DAYS` windows and the results concatenated.
 * `/tickets/admin` is not used instead: it cannot filter by app and would need
 * cursor pagination.
 */
export async function fetchTicketsForYear(config: Config): Promise<HelpDeskTicket[]> {
  const tickets: HelpDeskTicket[] = [];

  for (const window of chunkYear(config.year)) {
    for (const ticket of await fetchWindow(config, window)) {
      if (ticket.appName === config.appName) tickets.push(ticket);
    }
  }

  return tickets;
}

/**
 * One window's tickets, for every app.
 *
 * A window that comes back at the cap has dropped its oldest tickets, and the
 * pull fails rather than writing a knowingly incomplete year: a partial pull
 * that recorded itself as a success is what hid this for months, and nothing is
 * deleted by a failed pull, so the mirror keeps what it already had.
 */
async function fetchWindow(config: Config, window: DateWindow): Promise<HelpDeskTicket[]> {
  const url = new URL(`${config.baseUrl}/tickets/by-date`);
  url.searchParams.set('startDate', window.startDate);
  url.searchParams.set('endDate', window.endDate);

  const body = await get<ByDateResponse>(config, url);
  const tickets = body.data?.tickets;
  if (!Array.isArray(tickets)) {
    throw new HelpDeskError('HelpDesk response has no data.tickets array');
  }

  if (tickets.length >= BY_DATE_ROW_CAP) {
    const message =
      `HelpDesk truncated ${window.startDate} .. ${window.endDate} at its ${BY_DATE_ROW_CAP}-row cap, ` +
      `dropping the tickets created earliest in that window. Lower CHUNK_DAYS (currently ${CHUNK_DAYS}) and pull again.`;
    console.error(`[helpdesk] ${message}`);
    throw new HelpDeskError(message);
  }

  return tickets;
}

/** Tag directory, used to turn a ticket's opaque `tagIds` into names. */
export async function fetchTags(config: Config): Promise<HelpDeskTag[]> {
  const body = await get<TagsResponse>(config, new URL(`${config.baseUrl}/tags`));
  return Array.isArray(body.data) ? body.data : [];
}
