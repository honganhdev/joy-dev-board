import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { AuthConfig, Config } from '../src/config';
import { openDatabase, type Db } from '../src/db/client';
import { readStatusHistory, readTicket } from '../src/db/queries';
import { pulls, ticketStatusHistory } from '../src/db/schema';
import { finishPull, reserveDelivery, startPull, syncPull } from '../src/db/sync';
import type { HelpDeskTicket } from '../src/helpdesk/types';
import { createPullRunner, type PullRunner } from '../src/pull-service';
import { createRouter } from '../src/routes';
import { createWebhookProcessor, type WebhookProcessor } from '../src/webhook-service';
import { signWebhook } from './webhook-helpers';

const SECRET = 'concurrency-test-secret';
const PATH = '/api/webhooks/avada-ticket';

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

const idlePulls: PullRunner = {
  run: async () => ({ pulled: 0, inserted: 0, statusChanges: 0 }),
  whenIdle: async () => {},
};

function ticket(overrides: Partial<HelpDeskTicket> = {}): HelpDeskTicket {
  return {
    id: 'internal-1',
    ticketId: 'JOY-1',
    subject: 'Concurrent delivery',
    tsStatus: 'doing',
    ticketStatus: 'open',
    appName: 'JOY Loyalty',
    createdAt: '2026-08-23T08:00:00.000Z',
    updatedAt: '2026-08-26T08:00:00.000Z',
    ...overrides,
  };
}

function seed(db: Db, value: HelpDeskTicket): void {
  const pullId = startPull(db);
  finishPull(db, pullId, syncPull(db, [value], pullId, '2026-08-25T08:00:00.000Z'));
}

/** Keeps every processing promise, not only the latest, so both can be awaited. */
function collectingProcessor(db: Db, fetcher: () => Promise<HelpDeskTicket[]>) {
  const processor = createWebhookProcessor(db, config, idlePulls, fetcher);
  const started: Promise<void>[] = [];
  const tracked: WebhookProcessor = {
    process(pullId, ticketId, createdAt) {
      const work = processor.process(pullId, ticketId, createdAt);
      started.push(work);
      return work;
    },
  };
  return { tracked, settled: () => Promise.all(started) };
}

function webhookRequest(deliveryId: string, tsStatus: string): Request {
  const rawBody = JSON.stringify({
    ticket: { id: 'internal-1', createdAt: '2026-08-23T08:00:00.000Z', tsStatus },
  });
  const timestamp = String(Date.now());
  return new Request(`http://localhost${PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(rawBody)),
      'X-Avada-Delivery': deliveryId,
      'X-Avada-Timestamp': timestamp,
      'X-Avada-Signature': signWebhook(SECRET, timestamp, rawBody),
      'X-Avada-Event': 'ticket.updated',
    },
    body: rawBody,
  });
}

describe('two deliveries for the same ticket', () => {
  test('both observing the same upstream status append exactly one history row', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket({ tsStatus: 'doing' }));
    // Both deliveries re-fetch and both see the one real transition. Writing the
    // notification payloads instead would append a row per delivery.
    const current = ticket({ tsStatus: 'done' });
    const processor = createWebhookProcessor(db, config, idlePulls, async () => [current]);
    const firstId = reserveDelivery(db, 'delivery-pair-a')!;
    const secondId = reserveDelivery(db, 'delivery-pair-b')!;

    await Promise.all([
      processor.process(firstId, current.id, current.createdAt),
      processor.process(secondId, current.id, current.createdAt),
    ]);

    expect(readStatusHistory(db, 'JOY-1')).toEqual([
      {
        fromStatus: null,
        toStatus: 'doing',
        observedAt: '2026-08-25T08:00:00.000Z',
        ticketUpdatedAt: '2026-08-26T08:00:00.000Z',
      },
      expect.objectContaining({ fromStatus: 'doing', toStatus: 'done' }),
    ]);
    expect(db.select().from(pulls).where(eq(pulls.id, secondId)).get()).toMatchObject({
      status: 'ok',
      statusChanges: 0,
    });
  });

  test('arriving together at the route cannot fabricate a transition that never happened', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket({ tsStatus: 'done' }));
    // Two notifications carrying conflicting statuses. HelpDesk's own record is
    // unchanged, so the mirror must record no movement at all.
    const current = ticket({ tsStatus: 'done' });
    const processing = collectingProcessor(db, async () => [current]);
    const handle = createRouter({
      db,
      pulls: createPullRunner(db, config, async () => []),
      tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
      auth,
      webhookSecret: SECRET,
      webhooks: processing.tracked,
      year: config.year,
    });

    const [first, second] = await Promise.all([
      handle(webhookRequest('delivery-race-a', 'doing')),
      handle(webhookRequest('delivery-race-b', 'done')),
    ]);
    await processing.settled();

    expect([first.status, second.status]).toEqual([202, 202]);
    expect(readTicket(db, 'JOY-1')?.tsStatus).toBe('done');
    expect(db.select().from(ticketStatusHistory).all()).toHaveLength(1);
    expect(db.select().from(pulls).where(eq(pulls.source, 'webhook')).all()).toMatchObject([
      { status: 'ok', statusChanges: 0 },
      { status: 'ok', statusChanges: 0 },
    ]);
  });
});
