import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { SESSION_COOKIE } from '../src/auth/cookie';
import { createSession } from '../src/auth/session-store';
import type { BoardResponse } from '../src/board/types';
import type { AuthConfig, Config } from '../src/config';
import { openDatabase, type Db } from '../src/db/client';
import { pulls as pullRows } from '../src/db/schema';
import { failPull, finishPull, reserveDelivery, startPull, syncPull } from '../src/db/sync';
import type { HelpDeskTicket } from '../src/helpdesk/types';
import { createPullRunner } from '../src/pull-service';
import { createRouter } from '../src/routes';

const auth: AuthConfig = {
  users: [{ username: 'boarduser', passwordHash: 'unused' }],
  sessionTtlMs: 604_800_000,
  cookieSecure: false,
  trustProxy: false,
};

const config = {
  apiKey: 'test-key',
  webhookSecret: 'test-webhook-secret',
  baseUrl: 'https://helpdesk.test',
  port: 8787,
  cacheTtlMs: 300_000,
  year: 2026,
  appName: 'JOY Loyalty',
  databasePath: ':memory:',
  auth,
  webDistPath: null,
} satisfies Config;

function ticket(): HelpDeskTicket {
  return {
    id: 'internal-1',
    ticketId: 'JOY-1',
    appName: 'JOY Loyalty',
    ticketStatus: 'open',
    tsStatus: 'doing',
    createdAt: '2026-08-23T08:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function seedFullPull(db: Db, finishedAt: string, withTicket: boolean): number {
  const pullId = startPull(db);
  const result = syncPull(db, withTicket ? [ticket()] : [], pullId);
  finishPull(db, pullId, result);
  db.update(pullRows).set({ finishedAt }).where(eq(pullRows.id, pullId)).run();
  return pullId;
}

function harness(options: { finishedAt: string; withTicket: boolean }) {
  const { db } = openDatabase(':memory:');
  seedFullPull(db, options.finishedAt, options.withTicket);
  const gate = deferred<HelpDeskTicket[]>();
  let fetches = 0;
  const pulls = createPullRunner(db, config, () => {
    fetches += 1;
    return gate.promise;
  });
  const handle = createRouter({
    db,
    pulls,
    tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
    auth,
    webhookSecret: 'test-webhook-secret',
    webhooks: { process: async () => {} },
    year: config.year,
  });
  const sessionId = createSession(db, auth.users[0]!.username, auth.sessionTtlMs);
  const request = () =>
    new Request('http://localhost/api/tickets', {
      headers: { Cookie: `${SESSION_COOKIE}=${sessionId}` },
    });
  return { db, pulls, gate, handle, request, fetches: () => fetches };
}

async function settle(h: ReturnType<typeof harness>): Promise<void> {
  h.gate.resolve([]);
  await h.pulls.whenIdle();
}

describe('opportunistic full-pull reconciliation', () => {
  test('an older-than-thirty-minutes full pull kicks a detached pull', async () => {
    const h = harness({
      finishedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      withTicket: true,
    });

    const response = await h.handle(h.request());
    const board = (await response.json()) as BoardResponse;

    expect(h.fetches()).toBe(1);
    expect(board.lastPull?.status).toBe('running');
    await settle(h);
  });

  test('a full pull inside thirty minutes does not kick another', async () => {
    const h = harness({ finishedAt: new Date().toISOString(), withTicket: true });

    const response = await h.handle(h.request());
    const board = (await response.json()) as BoardResponse;

    expect(h.fetches()).toBe(0);
    expect(board.lastPull?.status).toBe('ok');
  });

  test('an empty mirror pulls even when its last full pull is recent', async () => {
    const h = harness({ finishedAt: new Date().toISOString(), withTicket: false });

    const response = await h.handle(h.request());
    const board = (await response.json()) as BoardResponse;

    expect(h.fetches()).toBe(1);
    expect(board.lastPull?.status).toBe('running');
    await settle(h);
  });

  test('a recent successful webhook does not suppress a stale full-pull kick', async () => {
    const h = harness({
      finishedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      withTicket: true,
    });
    const webhookId = reserveDelivery(h.db, 'delivery-recent')!;
    finishPull(h.db, webhookId, { pulled: 1, inserted: 0, statusChanges: 0 });

    const response = await h.handle(h.request());
    const board = (await response.json()) as BoardResponse;

    expect(h.fetches()).toBe(1);
    expect(board.lastPull?.status).toBe('running');
    await settle(h);
  });
});

describe('reconciliation boundaries and single-flight', () => {
  test('just inside thirty minutes does not kick; just outside does', async () => {
    const fresh = harness({
      finishedAt: new Date(Date.now() - 29 * 60 * 1000).toISOString(),
      withTicket: true,
    });
    await fresh.handle(fresh.request());
    expect(fresh.fetches()).toBe(0);

    const stale = harness({
      finishedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      withTicket: true,
    });
    await stale.handle(stale.request());
    expect(stale.fetches()).toBe(1);
    await settle(stale);
  });

  test('concurrent board loads on a stale mirror kick exactly one pull', async () => {
    const h = harness({
      finishedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      withTicket: true,
    });

    // Three tabs opening at once must not become three upstream year sweeps.
    await Promise.all([h.handle(h.request()), h.handle(h.request()), h.handle(h.request())]);

    expect(h.fetches()).toBe(1);
    await settle(h);
  });

  test('a stored mirror whose only full pull failed is reconciled on load', async () => {
    const { db } = openDatabase(':memory:');
    const seededId = startPull(db);
    syncPull(db, [ticket()], seededId);
    failPull(db, seededId, 'upstream unavailable');
    const gate = deferred<HelpDeskTicket[]>();
    let fetches = 0;
    const pulls = createPullRunner(db, config, () => {
      fetches += 1;
      return gate.promise;
    });
    const handle = createRouter({
      db,
      pulls,
      tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
      auth,
      webhookSecret: 'test-webhook-secret',
      webhooks: { process: async () => {} },
      year: config.year,
    });
    const sessionId = createSession(db, auth.users[0]!.username, auth.sessionTtlMs);

    await handle(
      new Request('http://localhost/api/tickets', {
        headers: { Cookie: `${SESSION_COOKIE}=${sessionId}` },
      })
    );

    expect(fetches).toBe(1);
    gate.resolve([]);
    await pulls.whenIdle();
  });

  test('a stale mirror kicks a full pull, never a webhook-tagged row', async () => {
    const h = harness({
      finishedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      withTicket: true,
    });

    await h.handle(h.request());
    await settle(h);

    expect(
      h.db.select().from(pullRows).where(eq(pullRows.source, 'webhook')).all()
    ).toEqual([]);
    expect(h.db.select().from(pullRows).all()).toHaveLength(2);
  });
});

describe('a failing upstream and the opportunistic pull', () => {
  function failingHarness() {
    const { db } = openDatabase(':memory:');
    seedFullPull(db, new Date(Date.now() - 31 * 60 * 1000).toISOString(), true);
    let fetches = 0;
    const pulls = createPullRunner(db, config, async () => {
      fetches += 1;
      throw new Error('upstream unavailable');
    });
    const handle = createRouter({
      db,
      pulls,
      tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
      auth,
      webhookSecret: 'test-webhook-secret',
      webhooks: { process: async () => {} },
      year: config.year,
    });
    const sessionId = createSession(db, auth.users[0]!.username, auth.sessionTtlMs);
    const load = async () => {
      await handle(
        new Request('http://localhost/api/tickets', {
          headers: { Cookie: `${SESSION_COOKIE}=${sessionId}` },
        })
      );
      await pulls.whenIdle();
    };
    return { db, handle, sessionId, load, fetches: () => fetches };
  }

  test('is not re-swept on every consecutive board load', async () => {
    const h = failingHarness();

    // Every one of these would otherwise start another 34-window year sweep:
    // staleness is measured from the last *successful* pull, which never moves
    // while HelpDesk is down.
    for (let load = 0; load < 5; load += 1) await h.load();

    expect(h.fetches()).toBe(2);
  });

  test('the manual Pull button still pulls while the board is backing off', async () => {
    const h = failingHarness();
    for (let load = 0; load < 5; load += 1) await h.load();
    expect(h.fetches()).toBe(2);

    await h.handle(
      new Request('http://localhost/api/pull', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE}=${h.sessionId}` },
      })
    );

    expect(h.fetches()).toBe(3);
  });

  test('a single failure is still retried at once — a blip is not an outage', async () => {
    const { db } = openDatabase(':memory:');
    seedFullPull(db, new Date(Date.now() - 31 * 60 * 1000).toISOString(), true);
    const seededId = startPull(db);
    failPull(db, seededId, 'upstream unavailable');
    const gate = deferred<HelpDeskTicket[]>();
    let fetches = 0;
    const pulls = createPullRunner(db, config, () => {
      fetches += 1;
      return gate.promise;
    });
    const handle = createRouter({
      db,
      pulls,
      tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
      auth,
      webhookSecret: 'test-webhook-secret',
      webhooks: { process: async () => {} },
      year: config.year,
    });
    const sessionId = createSession(db, auth.users[0]!.username, auth.sessionTtlMs);

    await handle(
      new Request('http://localhost/api/tickets', {
        headers: { Cookie: `${SESSION_COOKIE}=${sessionId}` },
      })
    );

    expect(fetches).toBe(1);
    gate.resolve([]);
    await pulls.whenIdle();
  });
});
