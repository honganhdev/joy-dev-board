import { afterEach, expect, test } from 'bun:test';
import type { Config } from '../src/config';
import { fetchTicketsCreatedOn } from '../src/helpdesk/client';

const config = {
  apiKey: 'test-key',
  baseUrl: 'https://helpdesk.example/api/external',
} as Config;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('fetchTicketsCreatedOn GETs the ticket creation day as an inclusive UTC window', async () => {
  let request: Request | null = null;
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    request = new Request(String(input), init);
    return Response.json({ success: true, data: { tickets: [], total: 0 } });
  }) as typeof fetch;

  await fetchTicketsCreatedOn(config, '2026-08-23T18:42:00.000Z');

  const url = new URL(request!.url);
  expect(request!.method).toBe('GET');
  expect(url.searchParams.get('startDate')).toBe('2026-08-23T00:00:00.000Z');
  expect(url.searchParams.get('endDate')).toBe('2026-08-23T23:59:59.999Z');
});

test('a ticket created late in the UTC day still selects that whole day', async () => {
  let url: URL | null = null;
  globalThis.fetch = (async (input: URL | string) => {
    url = new URL(String(input));
    return Response.json({ success: true, data: { tickets: [], total: 0 } });
  }) as typeof fetch;

  await fetchTicketsCreatedOn(config, '2026-08-23T23:59:59.500Z');

  // An exclusive end at midnight would drop exactly the tickets most likely to
  // be the subject of a delivery arriving seconds later.
  expect(url!.searchParams.get('startDate')).toBe('2026-08-23T00:00:00.000Z');
  expect(url!.searchParams.get('endDate')).toBe('2026-08-23T23:59:59.999Z');
});

test('a day truncated at the row cap fails instead of reporting the ticket missing', async () => {
  globalThis.fetch = (async (_input: URL | string) =>
    Response.json({
      success: true,
      data: { tickets: new Array(5000).fill({ id: 'x', ticketId: 'JOY-x' }), total: 5000 },
    })) as typeof fetch;

  // Returning the truncated page would let a delivery conclude the ticket does
  // not exist, which is indistinguishable from a deleted one.
  await expect(fetchTicketsCreatedOn(config, '2026-08-23T08:00:00.000Z')).rejects.toThrow(/cap/);
});

test('an unparseable createdAt throws before any upstream request', async () => {
  let calls = 0;
  globalThis.fetch = (async (_input: URL | string) => {
    calls += 1;
    return Response.json({ success: true, data: { tickets: [], total: 0 } });
  }) as typeof fetch;

  await expect(fetchTicketsCreatedOn(config, 'not-a-date')).rejects.toThrow(/createdAt/);
  expect(calls).toBe(0);
});

test('the day window is returned unfiltered, leaving the app decision to the caller', async () => {
  globalThis.fetch = (async (_input: URL | string) =>
    Response.json({
      success: true,
      data: {
        tickets: [
          { id: 'internal-1', ticketId: 'JOY-1', appName: 'JOY Loyalty' },
          { id: 'internal-2', ticketId: 'SUB-1', appName: 'JOY Subscription' },
        ],
        total: 2,
      },
    })) as typeof fetch;

  const day = await fetchTicketsCreatedOn(config, '2026-08-23T08:00:00.000Z');

  expect(day.map((entry) => entry.id)).toEqual(['internal-1', 'internal-2']);
});
