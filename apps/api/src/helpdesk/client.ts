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
 * Pulls every ticket for `config.appName` in `config.year`.
 *
 * `by-date` returns the whole year in one response (no cursor), which is why
 * this is the only ticket endpoint used. `/tickets/admin` cannot filter by app
 * and would need cursor pagination.
 */
export async function fetchTicketsForYear(config: Config): Promise<HelpDeskTicket[]> {
  const url = new URL(`${config.baseUrl}/tickets/by-date`);
  url.searchParams.set('startDate', `${config.year}-01-01T00:00:00.000Z`);
  url.searchParams.set('endDate', `${config.year}-12-31T23:59:59.999Z`);
  url.searchParams.set('appName', config.appName);

  const body = await get<ByDateResponse>(config, url);
  const tickets = body.data?.tickets;
  if (!Array.isArray(tickets)) {
    throw new HelpDeskError('HelpDesk response has no data.tickets array');
  }

  return tickets;
}

/** Tag directory, used to turn a ticket's opaque `tagIds` into names. */
export async function fetchTags(config: Config): Promise<HelpDeskTag[]> {
  const body = await get<TagsResponse>(config, new URL(`${config.baseUrl}/tags`));
  return Array.isArray(body.data) ? body.data : [];
}
