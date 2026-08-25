import { afterEach, describe, expect, test } from 'bun:test';
import {
  ApiRequestError,
  pullFromHelpDesk,
  setUnauthorizedHandler,
} from '../src/lib/api';
import { followPull } from '../src/lib/pull-poll';
import type { PullSummary } from '../src/types';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  setUnauthorizedHandler(null);
});

function summary(status: PullSummary['status'], overrides: Partial<PullSummary> = {}): PullSummary {
  return {
    startedAt: '2026-08-25T10:00:00.000Z',
    finishedAt: status === 'running' ? null : '2026-08-25T10:00:45.000Z',
    ticketCount: status === 'ok' ? 2 : null,
    inserted: status === 'ok' ? 1 : null,
    statusChanges: status === 'ok' ? 1 : null,
    status,
    error: status === 'error' ? 'HelpDesk responded 401 Unauthorized' : null,
    ...overrides,
  };
}

type ScriptedResponse = { status: number; body: unknown } | Error;

function stub(...script: ScriptedResponse[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let index = 0;
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = script[Math.min(index, script.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next?.body ?? null), {
      status: next?.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

describe('followPull', () => {
  test('stops on the first finished poll', async () => {
    const finished = summary('ok');
    const calls = stub({ status: 200, body: finished });

    expect(await followPull()).toEqual(finished);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/pull/status');
    expect(calls[0]?.init?.credentials).toBe('same-origin');
  });

  test('keeps polling at the requested interval while it is running', async () => {
    const calls = stub(
      { status: 200, body: summary('running') },
      { status: 200, body: summary('running') },
      { status: 200, body: summary('ok') }
    );
    const startedAt = performance.now();

    expect(await followPull({ intervalMs: 30 })).toMatchObject({ status: 'ok' });
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(60);
    expect(calls).toHaveLength(3);
  });

  test('uses a two-second interval by default', async () => {
    const calls = stub(
      { status: 200, body: summary('running') },
      { status: 200, body: summary('ok') }
    );
    const startedAt = performance.now();

    expect(await followPull()).toMatchObject({ status: 'ok' });
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(2000);
    expect(calls).toHaveLength(2);
  });

  test('stops on a failure status', async () => {
    const calls = stub(
      { status: 200, body: summary('running') },
      { status: 200, body: summary('error') }
    );

    expect(await followPull({ intervalMs: 1 })).toMatchObject({
      status: 'error',
      error: 'HelpDesk responded 401 Unauthorized',
    });
    expect(calls).toHaveLength(2);
  });

  test('gives up at the cap without failing', async () => {
    stub({ status: 200, body: summary('running') });

    expect(await followPull({ intervalMs: 1, timeoutMs: 20 })).toMatchObject({ status: 'running' });
  });

  test('a 401 propagates without polling again', async () => {
    const calls = stub({
      status: 401,
      body: { error: 'unauthorized', message: 'Sign in to use the board.' },
    });

    await expect(followPull()).rejects.toThrow(ApiRequestError);
    expect(calls).toHaveLength(1);
  });

  test('a transient request failure is a skipped tick', async () => {
    const calls = stub(
      new TypeError('fetch failed'),
      { status: 200, body: summary('running') },
      { status: 200, body: summary('ok') }
    );

    expect(await followPull({ intervalMs: 1 })).toMatchObject({ status: 'ok' });
    expect(calls).toHaveLength(3);
  });

  test('three consecutive request failures propagate the last one', async () => {
    const calls = stub(
      { status: 500, body: { message: 'first' } },
      { status: 502, body: { message: 'second' } },
      { status: 503, body: { message: 'third' } }
    );

    await expect(followPull({ intervalMs: 1 })).rejects.toThrow('third');
    expect(calls).toHaveLength(3);
  });

  test('a successful tick resets the consecutive failure count', async () => {
    const calls = stub(
      new TypeError('fetch failed'),
      { status: 200, body: summary('running') },
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      { status: 200, body: summary('ok') }
    );

    expect(await followPull({ intervalMs: 1 })).toMatchObject({ status: 'ok' });
    expect(calls).toHaveLength(5);
  });

  test('a null summary stops the loop', async () => {
    const calls = stub({ status: 200, body: null });

    expect(await followPull()).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

test('pullFromHelpDesk posts to /api/pull and accepts a 202', async () => {
  const running = summary('running');
  const calls = stub({ status: 202, body: running });

  expect(await pullFromHelpDesk()).toEqual(running);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe('/api/pull');
  expect(calls[0]?.init?.method).toBe('POST');
});

describe('followPull failure handling', () => {
  test('a 401 partway through a follow stops it at once', async () => {
    const calls = stub(
      { status: 200, body: summary('running') },
      { status: 200, body: summary('running') },
      { status: 401, body: { message: 'Sign in to use the board.' } },
      { status: 200, body: summary('ok') }
    );

    await expect(followPull({ intervalMs: 1 })).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(3);
  });

  test('a 401 sends the app back to the login screen', async () => {
    let unauthorized = 0;
    setUnauthorizedHandler(() => {
      unauthorized += 1;
    });
    stub({ status: 401, body: { message: 'Sign in to use the board.' } });

    await expect(followPull({ intervalMs: 1 })).rejects.toThrow(ApiRequestError);
    expect(unauthorized).toBe(1);
  });

  test('a server error never sends the app back to the login screen', async () => {
    let unauthorized = 0;
    setUnauthorizedHandler(() => {
      unauthorized += 1;
    });
    stub({ status: 500, body: { message: 'boom' } });

    await expect(followPull({ intervalMs: 1 })).rejects.toThrow('boom');
    expect(unauthorized).toBe(0);
  });

  test('a 401 is not absorbed by the transient-failure budget', async () => {
    const calls = stub(
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      { status: 401, body: { message: 'Sign in to use the board.' } }
    );

    // Two blips already banked: the third tick still has to be read as a 401
    // and end the follow, not counted as the third blip and reported as one.
    await expect(followPull({ intervalMs: 1 })).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(3);
  });

  test('waits out the interval between failed ticks too', async () => {
    const calls = stub(
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      { status: 200, body: summary('ok') }
    );
    const startedAt = performance.now();

    expect(await followPull({ intervalMs: 40 })).toMatchObject({ status: 'ok' });
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(80);
    expect(calls).toHaveLength(3);
  });

  test('polls repeatedly before giving up, and gives up quietly', async () => {
    const calls = stub({ status: 200, body: summary('running') });

    const settled = await followPull({ intervalMs: 5, timeoutMs: 120 });

    expect(settled).toMatchObject({ status: 'running' });
    expect(settled?.error).toBeNull();
    expect(calls.length).toBeGreaterThan(1);
  });
});

describe('followPull request deadline', () => {
  /** A connection that establishes and then never answers — a stalled proxy. */
  function hangs() {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = ((input: URL | string, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        );
      });
    }) as unknown as typeof fetch;
    return calls;
  }

  test('a hung request cannot park the loop past its cap', async () => {
    hangs();
    const startedAt = performance.now();

    expect(await followPull({ intervalMs: 1, timeoutMs: 40 })).toBeNull();
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });

  test('three hung requests in a row propagate like any other failure', async () => {
    const calls = hangs();

    await expect(followPull({ intervalMs: 1, requestTimeoutMs: 10 })).rejects.toThrow(
      'took too long'
    );
    expect(calls).toHaveLength(3);
  });

  test('every status request carries a deadline of its own, cap or no cap', async () => {
    const calls = stub(
      { status: 200, body: summary('running') },
      { status: 200, body: summary('ok') }
    );

    await followPull({ intervalMs: 1 });

    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.init?.signal).toBeInstanceOf(AbortSignal);
  });
});
