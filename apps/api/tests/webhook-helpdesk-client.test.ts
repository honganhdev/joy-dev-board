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
