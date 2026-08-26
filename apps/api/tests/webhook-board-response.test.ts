import { expect, test } from 'bun:test';
import { SESSION_COOKIE } from '../src/auth/cookie';
import { createSession } from '../src/auth/session-store';
import type { BoardResponse } from '../src/board/types';
import type { AuthConfig, Config } from '../src/config';
import { openDatabase } from '../src/db/client';
import { readLastSuccessfulWebhook } from '../src/db/queries';
import { failPull, finishPull, reserveDelivery, startPull, syncPull } from '../src/db/sync';
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

test('the board reports the latest successful webhook separately from full-pull freshness', async () => {
  const { db } = openDatabase(':memory:');
  const value: HelpDeskTicket = {
    id: 'internal-1',
    ticketId: 'JOY-1',
    appName: 'JOY Loyalty',
    ticketStatus: 'open',
    tsStatus: 'doing',
    createdAt: '2026-08-23T08:00:00.000Z',
  };
  const fullPullId = startPull(db);
  const result = syncPull(db, [value], fullPullId, '2026-08-26T08:00:00.000Z');
  finishPull(db, fullPullId, result);
  const pulls = createPullRunner(db, config, async () => []);
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
  const boardRequest = () =>
    new Request('http://localhost/api/tickets', {
      headers: { Cookie: `${SESSION_COOKIE}=${sessionId}` },
    });

  const before = (await (await handle(boardRequest())).json()) as BoardResponse;
  expect(before.webhookAt).toBeNull();

  const failedWebhookId = reserveDelivery(db, 'delivery-failed')!;
  failPull(db, failedWebhookId, 'upstream unavailable');
  const afterFailure = (await (await handle(boardRequest())).json()) as BoardResponse;
  expect(afterFailure.lastPull).toMatchObject({ status: 'ok', error: null });
  expect(afterFailure.webhookAt).toBeNull();

  const webhookId = reserveDelivery(db, 'delivery-freshness')!;
  finishPull(db, webhookId, { pulled: 1, inserted: 0, statusChanges: 0 });
  const webhookFinishedAt = readLastSuccessfulWebhook(db)?.finishedAt ?? null;
  const after = (await (await handle(boardRequest())).json()) as BoardResponse;

  expect(after.webhookAt).toBe(webhookFinishedAt);
  expect(after.pulledAt).toBe(before.pulledAt);
});
