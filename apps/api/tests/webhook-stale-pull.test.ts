import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { SESSION_COOKIE } from '../src/auth/cookie';
import { createSession } from '../src/auth/session-store';
import type { BoardResponse } from '../src/board/types';
import type { AuthConfig, Config } from '../src/config';
import { openDatabase, type Db } from '../src/db/client';
import { pulls as pullRows } from '../src/db/schema';
import { finishPull, reserveDelivery, startPull, syncPull } from '../src/db/sync';
import type { HelpDeskTicket } from '../src/helpdesk/types';
import { createPullRunner } from '../src/pull-service';
import { createRouter } from '../src/routes';

const auth: AuthConfig = {
  username: 'boarduser',
  passwordHash: 'unused',
  sessionTtlMs: 604_800_000,
  cookieSecure: false,
  trustProxy: false,
};

const config = {
  apiKey: 'test-key',
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
  const sessionId = createSession(db, auth.username, auth.sessionTtlMs);
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
