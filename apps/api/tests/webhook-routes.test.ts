import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { assembleBoard } from '../src/board/assemble';
import type { AuthConfig, Config } from '../src/config';
import { openDatabase, type Db } from '../src/db/client';
import { readStatusHistory, readTicket, readTickets } from '../src/db/queries';
import { pulls } from '../src/db/schema';
import { finishPull, startPull, syncPull } from '../src/db/sync';
import type { HelpDeskTicket } from '../src/helpdesk/types';
import { createPullRunner } from '../src/pull-service';
import { createRouter } from '../src/routes';
import { createWebhookHandler } from '../src/webhook-handler';
import {
  createWebhookProcessor,
  type CreatedOnFetcher,
  type WebhookProcessor,
} from '../src/webhook-service';
import { signWebhook } from './webhook-helpers';

const SECRET = 'route-test-secret';
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

function ticket(overrides: Partial<HelpDeskTicket> = {}): HelpDeskTicket {
  return {
    id: 'internal-1',
    ticketId: 'JOY-1',
    ticketNumber: '1234',
    subject: 'Fetched subject',
    tsStatus: 'doing',
    ticketStatus: 'open',
    level: 3,
    appName: 'JOY Loyalty',
    appPlan: 'Pro',
    tasks: [{ id: 'task-1', title: 'Preserve this task', completed: false }],
    createdAt: '2026-08-23T08:00:00.000Z',
    updatedAt: '2026-08-26T08:00:00.000Z',
    ...overrides,
  };
}

function body(ticketFields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ticket: { id: 'internal-1', createdAt: '2026-08-23T08:00:00.000Z', ...ticketFields },
  });
}

function webhookRequest(
  options: {
    rawBody?: string;
    deliveryId?: string;
    timestamp?: string;
    signature?: string;
    event?: string;
    omit?: 'delivery' | 'timestamp' | 'signature';
    contentLength?: string;
  } = {}
): Request {
  const rawBody = options.rawBody ?? body();
  const timestamp = options.timestamp ?? String(Date.now());
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Content-Length': options.contentLength ?? String(Buffer.byteLength(rawBody)),
    'X-Avada-Delivery': options.deliveryId ?? 'delivery-1',
    'X-Avada-Timestamp': timestamp,
    'X-Avada-Signature': options.signature ?? signWebhook(SECRET, timestamp, rawBody),
    'X-Avada-Event': options.event ?? 'ticket.updated',
  });
  if (options.omit === 'delivery') headers.delete('X-Avada-Delivery');
  if (options.omit === 'timestamp') headers.delete('X-Avada-Timestamp');
  if (options.omit === 'signature') headers.delete('X-Avada-Signature');
  return new Request(`http://localhost${PATH}`, { method: 'POST', headers, body: rawBody });
}

function observeBodyRead(request: Request): () => boolean {
  let read = false;
  Object.defineProperty(request, 'text', {
    value: async () => {
      read = true;
      return body();
    },
  });
  return () => read;
}

function router(db: Db, webhooks: WebhookProcessor) {
  const pulls = createPullRunner(db, config, async () => []);
  return createRouter({
    db,
    pulls,
    tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
    auth,
    webhookSecret: SECRET,
    webhooks,
    year: config.year,
  });
}

function trackedProcessor(db: Db, fetcher: CreatedOnFetcher) {
  const pullsRunner = createPullRunner(db, config, async () => []);
  const processor = createWebhookProcessor(db, config, pullsRunner, fetcher);
  let latest: Promise<void> = Promise.resolve();
  const tracked: WebhookProcessor = {
    process(pullId, ticketId, createdAt) {
      latest = processor.process(pullId, ticketId, createdAt);
      return latest;
    },
  };
  return { tracked, settled: () => latest };
}

function seed(db: Db, value: HelpDeskTicket): void {
  const pullId = startPull(db);
  const result = syncPull(db, [value], pullId, '2026-08-25T08:00:00.000Z');
  finishPull(db, pullId, result);
}

describe('Avada webhook route', () => {
  test('accepts a valid ticket.updated signature, reserves its row, and invokes processing', async () => {
    const { db } = openDatabase(':memory:');
    const invoked: unknown[][] = [];
    const handle = router(db, { process: async (...args) => void invoked.push(args) });

    const response = await handle(webhookRequest({ deliveryId: 'delivery-valid' }));

    expect(response.status).toBe(202);
    expect(
      db.select().from(pulls).where(eq(pulls.deliveryId, 'delivery-valid')).get()
    ).toMatchObject({ source: 'webhook', status: 'running' });
    expect(invoked).toEqual([[1, 'internal-1', '2026-08-23T08:00:00.000Z']]);
  });

  test('rejects a wrong signature without reserving or leaking input', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });
    const rawBody = body({ subject: 'must-not-echo' });

    const response = await handle(
      webhookRequest({ rawBody, deliveryId: 'delivery-forged', signature: 'sha256=wrong' })
    );
    const responseBody = await response.text();

    expect(response.status).toBe(401);
    expect(db.select().from(pulls).all()).toEqual([]);
    expect(responseBody).not.toContain('message');
    expect(responseBody).not.toContain('must-not-echo');
  });

  test('rejects a stale timestamp without reading the body or reserving', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });
    const request = webhookRequest({ timestamp: String(Date.now() - 20 * 60 * 1000) });
    const wasRead = observeBodyRead(request);

    const response = await handle(request);

    expect(response.status).toBe(401);
    expect(wasRead()).toBe(false);
    expect(db.select().from(pulls).all()).toEqual([]);
  });

  test('dedupes a successful delivery id with one row and one processor call', async () => {
    const { db } = openDatabase(':memory:');
    let invoked = 0;
    const webhooks = {
      process: async () => {
        invoked += 1;
        const row = db.select().from(pulls).where(eq(pulls.deliveryId, 'delivery-duplicate')).get();
        if (row) finishPull(db, row.id, { pulled: 1, inserted: 0, statusChanges: 0 });
      },
    };
    const handle = router(db, webhooks);

    const first = await handle(webhookRequest({ deliveryId: 'delivery-duplicate' }));
    await Promise.resolve();
    const second = await handle(webhookRequest({ deliveryId: 'delivery-duplicate' }));

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(db.select().from(pulls).all()).toHaveLength(1);
    expect(invoked).toBe(1);
  });

  test('an older payload arriving second cannot flap history or overwrite the fetched state', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket({ tsStatus: 'doing' }));
    const fetched = ticket({ tsStatus: 'done', subject: 'HelpDesk truth' });
    const processing = trackedProcessor(db, async () => [fetched]);
    const handle = router(db, processing.tracked);

    const newer = await handle(
      webhookRequest({ deliveryId: 'delivery-newer', rawBody: body({ tsStatus: 'done' }) })
    );
    await processing.settled();
    const older = await handle(
      webhookRequest({ deliveryId: 'delivery-older', rawBody: body({ tsStatus: 'doing' }) })
    );
    await processing.settled();

    expect(newer.status).toBe(202);
    expect(older.status).toBe(202);
    expect(readTicket(db, 'JOY-1')).toMatchObject({ tsStatus: 'done', subject: 'HelpDesk truth' });
    expect(readStatusHistory(db, 'JOY-1')).toHaveLength(2);
  });

  test('a partial payload cannot erase fields from the complete fetched record', async () => {
    const { db } = openDatabase(':memory:');
    const rich = ticket();
    const processing = trackedProcessor(db, async () => [rich]);
    const handle = router(db, processing.tracked);

    const response = await handle(
      webhookRequest({ deliveryId: 'delivery-partial', rawBody: body() })
    );
    await processing.settled();

    expect(response.status).toBe(202);
    expect(readTicket(db, 'JOY-1')).toMatchObject({
      appPlan: 'Pro',
      level: 3,
      ticketNumber: '1234',
      tasks: [{ id: 'task-1', title: 'Preserve this task', completed: false }],
    });
  });

  test('stores an unknown tsStatus and keeps it visible in otherStatuses', async () => {
    const { db } = openDatabase(':memory:');
    const unknown = ticket({ tsStatus: 'future_status' });
    const processing = trackedProcessor(db, async () => [unknown]);
    const handle = router(db, processing.tracked);

    const response = await handle(webhookRequest({ deliveryId: 'delivery-unknown' }));
    await processing.settled();

    expect(response.status).toBe(202);
    expect(readTicket(db, 'JOY-1')?.tsStatus).toBe('future_status');
    expect(readStatusHistory(db, 'JOY-1')).toHaveLength(1);
    expect(assembleBoard(readTickets(db), new Date().toISOString()).otherStatuses).toContainEqual({
      status: 'future_status',
      count: 1,
    });
  });

  test('accepts ticket.test without reserving or invoking upstream processing', async () => {
    const { db } = openDatabase(':memory:');
    let invoked = 0;
    const handle = router(db, { process: async () => void (invoked += 1) });

    const response = await handle(
      webhookRequest({ deliveryId: 'delivery-test', event: 'ticket.test' })
    );

    expect(response.status).toBe(202);
    expect(db.select().from(pulls).all()).toEqual([]);
    expect(invoked).toBe(0);
  });

  test('rejects each missing required Avada header individually', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });

    for (const omit of ['delivery', 'timestamp', 'signature'] as const) {
      expect(
        (await handle(webhookRequest({ omit, deliveryId: `delivery-missing-${omit}` }))).status
      ).toBe(401);
    }
    expect(db.select().from(pulls).all()).toEqual([]);
  });

  test('rejects an empty delivery id instead of reserving a shared blank value', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });
    const request = webhookRequest();
    request.headers.set('X-Avada-Delivery', '');

    expect((await handle(request)).status).toBe(401);
    expect(db.select().from(pulls).all()).toEqual([]);
  });

  test('answers malformed signed JSON with a fixed 400 instead of a 500', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });

    const response = await handle(
      webhookRequest({ rawBody: '{not-json', deliveryId: 'delivery-malformed' })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
    expect(db.select().from(pulls).all()).toEqual([]);
  });

  test('rejects an oversized Content-Length before reading the body', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });
    const request = webhookRequest({ contentLength: '65537' });
    const wasRead = observeBodyRead(request);

    const response = await handle(request);

    expect(response.status).toBe(400);
    expect(wasRead()).toBe(false);
  });

  test('rejects a non-numeric Content-Length before reading the body', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });
    const request = webhookRequest({ contentLength: 'unknown' });
    const wasRead = observeBodyRead(request);

    const response = await handle(request);

    expect(response.status).toBe(400);
    expect(wasRead()).toBe(false);
  });

  test('rejects a chunked body with no Content-Length before reading it', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });
    const request = webhookRequest();
    request.headers.delete('Content-Length');
    request.headers.set('Transfer-Encoding', 'chunked');
    const wasRead = observeBodyRead(request);

    const response = await handle(request);

    expect(response.status).toBe(400);
    expect(wasRead()).toBe(false);
  });

  test('returns a fixed 500 when reserving throws', async () => {
    const handle = createWebhookHandler({
      secret: SECRET,
      reserveDelivery: () => {
        throw new Error('database is locked');
      },
      webhooks: { process: async () => {} },
    });

    const response = await handle(webhookRequest({ deliveryId: 'delivery-db-error' }));
    const responseBody = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(responseBody).toEqual({ error: 'internal_error' });
    expect(responseBody).not.toHaveProperty('message');
  });
});
