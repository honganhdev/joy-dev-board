import { afterEach, describe, expect, test } from 'bun:test';
import { ApiRequestError, fetchWeeklyReport, setUnauthorizedHandler } from '../src/lib/api';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  setUnauthorizedHandler(null);
});

/** Answers one request with `body` at `status`, and records what was asked for. */
function stub(status: number, body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

describe('fetchWeeklyReport', () => {
  test('asks for the range it was given, with the session cookie attached', async () => {
    const calls = stub(200, { weeks: [] });

    await fetchWeeklyReport(26);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/report/weekly?weeks=26');
    // The route is behind the session gate; a request without the cookie is a 401.
    expect(calls[0]?.init?.credentials).toBe('same-origin');
  });

  test('returns the body untouched, deriving nothing from it', async () => {
    const payload = { weeks: [{ key: '2026-W34', created: 3 }], openRightNow: 7 };
    stub(200, payload);

    expect(await fetchWeeklyReport(12)).toEqual(payload);
  });
});

describe('when the report cannot be loaded', () => {
  test('drops the tab back to the login screen when the session has gone', async () => {
    // The report is the one view a signed-out viewer can sit on for a long time
    // — no polling, no board refresh. Without this the panel would show an
    // "unauthorized" error next to a perfectly normal-looking page.
    let bounced = 0;
    setUnauthorizedHandler(() => {
      bounced += 1;
    });
    stub(401, { error: 'unauthorized', message: 'Sign in to use the board.' });

    await expect(fetchWeeklyReport(12)).rejects.toThrow(ApiRequestError);
    expect(bounced).toBe(1);
  });

  test('surfaces the API message so the panel names the real cause', async () => {
    // The pull fails loudly now when HelpDesk truncates a window. That message
    // is the only thing that says which window, so it has to reach the screen.
    stub(500, { error: 'helpdesk', message: 'HelpDesk truncated 2026-03-05 .. 2026-03-11' });

    await expect(fetchWeeklyReport(12)).rejects.toThrow(/2026-03-05 \.\. 2026-03-11/);
  });

  test('falls back to the status when the error body carries no message', async () => {
    stub(503, {});

    await expect(fetchWeeklyReport(12)).rejects.toThrow('Request failed with 503');
  });

  test('says the API is unreachable rather than reporting a parse failure', async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;

    await expect(fetchWeeklyReport(12)).rejects.toThrow(/Cannot reach the board API/);
  });
});
