import { afterEach, describe, expect, test } from 'bun:test';
import type { Config } from '../src/config';
import { chunkYear, fetchTicketsForYear, HelpDeskError } from '../src/helpdesk/client';
import type { HelpDeskTicket } from '../src/helpdesk/types';

const config = {
  apiKey: 'test-key',
  baseUrl: 'https://helpdesk.example/api/external',
  year: 2025,
  appName: 'JOY Loyalty',
} as Config;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function ticket(id: string, appName: string): HelpDeskTicket {
  return { id, ticketId: id, appName };
}

/**
 * Answers every `by-date` call from `byWindow`, keyed on `startDate`, and
 * records the URLs asked for. Nothing here touches the network.
 */
function stubHelpDesk(byWindow: (startDate: string) => HelpDeskTicket[]): URL[] {
  const asked: URL[] = [];
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(String(input));
    asked.push(url);
    const tickets = byWindow(url.searchParams.get('startDate') ?? '');
    return new Response(JSON.stringify({ success: true, data: { tickets, total: tickets.length } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return asked;
}

describe('chunkYear', () => {
  const windows = chunkYear(2025, new Date('2026-06-01T00:00:00.000Z'));

  test('covers the whole year in seven-day windows', () => {
    expect(windows).toHaveLength(53);
    expect(windows[0]).toEqual({
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2025-01-07T23:59:59.999Z',
    });
    expect(windows.at(-1)).toEqual({
      startDate: '2025-12-31T00:00:00.000Z',
      endDate: '2025-12-31T23:59:59.999Z',
    });
  });

  test('leaves no gap and no overlap between windows', () => {
    for (const [index, window] of windows.entries()) {
      expect(Date.parse(window.endDate)).toBeGreaterThan(Date.parse(window.startDate));
      const next = windows[index + 1];
      if (next) expect(Date.parse(next.startDate) - Date.parse(window.endDate)).toBe(1);
    }
  });

  test('every window is short enough to stay clear of the row cap', () => {
    // 5,000 rows at the observed ~150 tickets/day across all apps is ~33 days.
    for (const window of windows) {
      const days = (Date.parse(window.endDate) - Date.parse(window.startDate)) / 86_400_000;
      expect(days).toBeLessThan(8);
    }
  });

  test('stops at the window holding now instead of asking for the future', () => {
    const partial = chunkYear(2025, new Date('2025-02-01T12:00:00.000Z'));
    expect(partial).toHaveLength(5);
    expect(partial.at(-1)?.endDate).toBe('2025-02-04T23:59:59.999Z');
  });
});

describe('fetchTicketsForYear', () => {
  test('walks the year in windows and concatenates every one of them', async () => {
    const asked = stubHelpDesk((startDate) => [ticket(`t-${startDate.slice(0, 10)}`, 'JOY Loyalty')]);

    const tickets = await fetchTicketsForYear(config);

    expect(asked).toHaveLength(53);
    expect(tickets).toHaveLength(53);
    expect(asked[0]?.searchParams.get('startDate')).toBe('2025-01-01T00:00:00.000Z');
    expect(asked[0]?.searchParams.get('endDate')).toBe('2025-01-07T23:59:59.999Z');
    // The whole-year window is what the cap swallowed; it must never be asked for.
    expect(asked.some((url) => url.searchParams.get('endDate') === '2025-12-31T23:59:59.999Z' &&
      url.searchParams.get('startDate') === '2025-01-01T00:00:00.000Z')).toBe(false);
  });

  test('asks for every app and matches appName here, since the cap is applied first', async () => {
    const asked = stubHelpDesk(() => [
      ticket('joy', 'JOY Loyalty'),
      ticket('other', 'JOY Subscription'),
    ]);

    const tickets = await fetchTicketsForYear(config);

    expect(asked.every((url) => url.searchParams.has('appName'))).toBe(false);
    expect(tickets).toHaveLength(53);
    expect(tickets.every((found) => found.appName === 'JOY Loyalty')).toBe(true);
  });

  test('fails, naming the window, when one comes back at the row cap', async () => {
    stubHelpDesk((startDate) =>
      startDate === '2025-03-05T00:00:00.000Z'
        ? Array.from({ length: 5000 }, (_, index) => ticket(`t${index}`, 'JOY Loyalty'))
        : [ticket(`t-${startDate}`, 'JOY Loyalty')]
    );

    const failure = fetchTicketsForYear(config);

    await expect(failure).rejects.toThrow(HelpDeskError);
    await expect(failure).rejects.toThrow(/2025-03-05T00:00:00.000Z .. 2025-03-11T23:59:59.999Z/);
  });

  test('a window one row under the cap is not treated as truncated', async () => {
    stubHelpDesk(() => Array.from({ length: 4999 }, (_, index) => ticket(`t${index}`, 'JOY Loyalty')));

    await expect(fetchTicketsForYear(config)).resolves.toHaveLength(53 * 4999);
  });
});
