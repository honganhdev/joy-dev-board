import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { assembleBoard } from '../src/board/assemble';
import type { AuthConfig, Config } from '../src/config';
import { openDatabase, type Db } from '../src/db/client';
import { readStatusHistory, readTicket, readTickets } from '../src/db/queries';
import { pulls } from '../src/db/schema';
import {
  finishPull,
  reserveDelivery,
  startPull,
  sweepInterruptedPulls,
  syncPull,
} from '../src/db/sync';
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
  users: [{ username: 'boarduser', passwordHash: 'unused' }],
  sessionTtlMs: 604_800_000,
  cookieSecure: false,
  trustProxy: false,
};

const config = {
  apiKey: 'test-key',
  webhookSecret: SECRET,
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

// The spec's payload carries the delivery id inside the signed body, and that
// is what dedupe keys on; the header is only logged.
function body(ticketFields: Record<string, unknown> = {}, deliveryId?: string): string {
  return JSON.stringify({
    ...(deliveryId ? { deliveryId } : {}),
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
  const deliveryId = options.deliveryId ?? 'delivery-1';
  const rawBody = options.rawBody ?? body({}, deliveryId);
  const timestamp = options.timestamp ?? String(Date.now());
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Content-Length': options.contentLength ?? String(Buffer.byteLength(rawBody)),
    'X-Avada-Delivery': deliveryId,
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

  test('one captured request replayed under a second delivery header is processed once', async () => {
    const { db } = openDatabase(':memory:');
    let invoked = 0;
    const handle = router(db, { process: async () => void (invoked += 1) });
    // One capture, replayed verbatim: the signature covers the timestamp and
    // the body, and neither changes. Only the unsigned header does.
    const timestamp = String(Date.now());
    const rawBody = body({}, 'signed-delivery-id');

    const first = await handle(webhookRequest({ rawBody, timestamp, deliveryId: 'header-a' }));
    const replay = await handle(webhookRequest({ rawBody, timestamp, deliveryId: 'header-b' }));

    expect([first.status, replay.status]).toEqual([202, 200]);
    expect(invoked).toBe(1);
    expect(db.select().from(pulls).all()).toHaveLength(1);
  });

  test('a replayed body carrying no deliveryId of its own is deduped on its bytes', async () => {
    const { db } = openDatabase(':memory:');
    let invoked = 0;
    const handle = router(db, { process: async () => void (invoked += 1) });
    const timestamp = String(Date.now());
    const rawBody = body();

    const first = await handle(webhookRequest({ rawBody, timestamp, deliveryId: 'header-c' }));
    const replay = await handle(webhookRequest({ rawBody, timestamp, deliveryId: 'header-d' }));

    expect([first.status, replay.status]).toEqual([202, 200]);
    expect(invoked).toBe(1);
    expect(db.select().from(pulls).all()).toHaveLength(1);
  });

  test('records the ticket a delivery named, so a delivery lost after the 202 can be repeated', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });

    await handle(webhookRequest({ deliveryId: 'delivery-recorded' }));

    expect(
      db.select().from(pulls).where(eq(pulls.deliveryId, 'delivery-recorded')).get()
    ).toMatchObject({
      deliveryTicketId: 'internal-1',
      deliveryTicketCreatedAt: '2026-08-23T08:00:00.000Z',
    });
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

  test('accepts a signed chunked body that declares no Content-Length', async () => {
    const { db } = openDatabase(':memory:');
    const invoked: unknown[][] = [];
    const handle = router(db, { process: async (...args) => void invoked.push(args) });
    // A chunked or HTTP/2 sender declares no length. Refusing it would lose
    // every delivery it makes, and all 8 retries with it — and the refusal
    // would happen before the signature is even checked.
    const request = webhookRequest({ deliveryId: 'delivery-chunked' });
    request.headers.delete('Content-Length');
    request.headers.set('Transfer-Encoding', 'chunked');

    const response = await handle(request);

    expect(response.status).toBe(202);
    expect(invoked).toHaveLength(1);
    expect(
      db.select().from(pulls).where(eq(pulls.deliveryId, 'delivery-chunked')).get()
    ).toMatchObject({ source: 'webhook', status: 'running' });
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

describe('Avada webhook signature and body guards at the route', () => {
  test('rejects a correct-length signature made with a different secret', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });
    const rawBody = body();
    const timestamp = String(Date.now());

    // Same shape and length as a real header, so the constant-time comparison
    // itself has to reject it — not the cheap length guard in front of it.
    const forged = signWebhook('another-tenants-secret', timestamp, rawBody);
    expect(forged).toHaveLength(signWebhook(SECRET, timestamp, rawBody).length);

    const response = await handle(
      webhookRequest({ rawBody, timestamp, signature: forged, deliveryId: 'delivery-other-secret' })
    );

    expect(response.status).toBe(401);
    expect(db.select().from(pulls).all()).toEqual([]);
  });

  test('rejects a body re-spaced after signing, proving the raw bytes are verified', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });
    const signed = body();
    const timestamp = String(Date.now());
    // Parses to exactly the same object; only the bytes differ.
    const tampered = JSON.stringify(JSON.parse(signed), null, 1);
    expect(JSON.parse(tampered)).toEqual(JSON.parse(signed));

    const response = await handle(
      webhookRequest({
        rawBody: tampered,
        timestamp,
        signature: signWebhook(SECRET, timestamp, signed),
        deliveryId: 'delivery-respaced',
      })
    );

    expect(response.status).toBe(401);
    expect(db.select().from(pulls).all()).toEqual([]);
  });

  test('rejects a timestamp far in the future, not only a stale one', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });

    const response = await handle(
      webhookRequest({
        timestamp: String(Date.now() + 20 * 60 * 1000),
        deliveryId: 'delivery-future',
      })
    );

    expect(response.status).toBe(401);
    expect(db.select().from(pulls).all()).toEqual([]);
  });

  test('rejects an oversized body whose Content-Length understated it', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });
    // A sender that lies downward passes the header check; the read itself has
    // to be bounded too, or the header is the only limit there is.
    const rawBody = JSON.stringify({
      ticket: { id: 'internal-1', createdAt: '2026-08-23T08:00:00.000Z', subject: 'x'.repeat(70_000) },
    });

    const response = await handle(
      webhookRequest({ rawBody, contentLength: '120', deliveryId: 'delivery-understated' })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
    expect(db.select().from(pulls).all()).toEqual([]);
  });

  test('rejects a signed body carrying no ticket id without reserving a row', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });

    const response = await handle(
      webhookRequest({
        rawBody: JSON.stringify({ event: 'ticket.updated', ticket: { ticketId: 'JOY-1' } }),
        deliveryId: 'delivery-no-id',
      })
    );

    expect(response.status).toBe(400);
    expect(db.select().from(pulls).all()).toEqual([]);
  });

  test('a GET on the webhook path is not the unauthenticated surface', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });

    const response = await handle(new Request(`http://localhost${PATH}`, { method: 'GET' }));

    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty('accepted');
  });
});

describe('the notification payload never reaches storage', () => {
  test('a spec-shaped subset cannot erase the report fields already stored', async () => {
    const { db } = openDatabase(':memory:');
    const stored = ticket({
      tsStatus: 'doing',
      appPlan: 'Pro',
      level: 3,
      attachments: [{ id: 'file-1', name: 'log.txt' }],
      resolutionMetrics: { firstResponseMs: 1_200 },
    });
    seed(db, stored);
    // HelpDesk answers the re-fetch with the whole record, exactly as it would
    // for a full pull. The delivery only says which ticket to go and read.
    const fetched = { ...stored, tsStatus: 'done', updatedAt: '2026-08-26T12:00:00.000Z' };
    const processing = trackedProcessor(db, async () => [fetched]);
    const handle = router(db, processing.tracked);

    // Every field the spec says a delivery carries, and nothing more.
    const payload = JSON.stringify({
      event: 'ticket.updated',
      changedFields: ['tsStatus', 'doneAt'],
      ticket: {
        id: 'internal-1',
        ticketId: 'JOY-1',
        shortUrl: 'https://helpdesk.test/t/1',
        subject: 'Subject from the notification',
        description: 'body from the notification',
        appName: 'JOY Loyalty',
        type: 'bug',
        tsStatus: 'done',
        ticketStatus: 'open',
        priority: 'high',
        store: [],
        members: [],
        tagIds: [],
        chatLink: null,
        slackLink: null,
        dueDate: null,
        createdAt: '2026-08-23T08:00:00.000Z',
        updatedAt: '2026-08-26T12:00:00.000Z',
        doneAt: '2026-08-26T12:00:00.000Z',
      },
    });

    const response = await handle(
      webhookRequest({ rawBody: payload, deliveryId: 'delivery-subset' })
    );
    await processing.settled();

    expect(response.status).toBe(202);
    const row = readTicket(db, 'JOY-1');
    expect(row).toMatchObject({
      tsStatus: 'done',
      appPlan: 'Pro',
      level: 3,
      ticketNumber: '1234',
      subject: 'Fetched subject',
      tasks: [{ id: 'task-1', title: 'Preserve this task', completed: false }],
      attachments: [{ id: 'file-1', name: 'log.txt' }],
      resolutionMetrics: { firstResponseMs: 1_200 },
    });
    // The report page reads these two; a merged payload would have blanked them.
    expect(row).not.toHaveProperty('doneAt');
    expect(row).not.toHaveProperty('changedFields');
  });

  test('a payload claiming another ticket id updates only the ticket it names', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket({ id: 'internal-1', ticketId: 'JOY-1', tsStatus: 'doing' }));
    seed(db, ticket({ id: 'internal-2', ticketId: 'JOY-2', tsStatus: 'doing' }));
    const processing = trackedProcessor(db, async () => [
      ticket({ id: 'internal-2', ticketId: 'JOY-2', tsStatus: 'done' }),
    ]);
    const handle = router(db, processing.tracked);

    await handle(
      webhookRequest({
        rawBody: body({ id: 'internal-2', tsStatus: 'done' }),
        deliveryId: 'delivery-other-ticket',
      })
    );
    await processing.settled();

    expect(readTicket(db, 'JOY-2')?.tsStatus).toBe('done');
    expect(readTicket(db, 'JOY-1')?.tsStatus).toBe('doing');
    expect(readStatusHistory(db, 'JOY-1')).toHaveLength(1);
  });
});

describe('retry after an interruption, end to end', () => {
  test('a delivery swept by a restart is reprocessed when the sender retries', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket({ tsStatus: 'doing' }));
    const processing = trackedProcessor(db, async () => [ticket({ tsStatus: 'done' })]);
    const handle = router(db, processing.tracked);

    // First attempt reserves the row, then the process dies before it finishes.
    const reserved = reserveDelivery(db, 'delivery-interrupted')!;
    expect(sweepInterruptedPulls(db)).toBe(1);

    const retry = await handle(webhookRequest({ deliveryId: 'delivery-interrupted' }));
    await processing.settled();

    expect(retry.status).toBe(202);
    expect(db.select().from(pulls).where(eq(pulls.id, reserved)).get()).toMatchObject({
      status: 'ok',
      statusChanges: 1,
    });
    expect(readTicket(db, 'JOY-1')?.tsStatus).toBe('done');
    expect(db.select().from(pulls).all()).toHaveLength(2);
  });

  test('a completed delivery replayed later writes nothing a second time', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket({ tsStatus: 'doing' }));
    let fetches = 0;
    const processing = trackedProcessor(db, async () => {
      fetches += 1;
      return [ticket({ tsStatus: 'done' })];
    });
    const handle = router(db, processing.tracked);

    await handle(webhookRequest({ deliveryId: 'delivery-replayed' }));
    await processing.settled();
    const settledRow = db.select().from(pulls).where(eq(pulls.deliveryId, 'delivery-replayed')).get();
    const historyAfterFirst = readStatusHistory(db, 'JOY-1');

    const replay = await handle(webhookRequest({ deliveryId: 'delivery-replayed' }));
    await processing.settled();

    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ duplicate: true });
    expect(fetches).toBe(1);
    expect(readStatusHistory(db, 'JOY-1')).toEqual(historyAfterFirst);
    expect(
      db.select().from(pulls).where(eq(pulls.deliveryId, 'delivery-replayed')).get()
    ).toEqual(settledRow!);
  });

  test('a delivery that failed upstream is reprocessed on the sender retry', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket({ tsStatus: 'doing' }));
    let attempts = 0;
    const processing = trackedProcessor(db, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('upstream unavailable');
      return [ticket({ tsStatus: 'done' })];
    });
    const handle = router(db, processing.tracked);

    const first = await handle(webhookRequest({ deliveryId: 'delivery-transient' }));
    await processing.settled();
    expect(first.status).toBe(202);
    expect(readTicket(db, 'JOY-1')?.tsStatus).toBe('doing');

    const retry = await handle(webhookRequest({ deliveryId: 'delivery-transient' }));
    await processing.settled();

    expect(retry.status).toBe(202);
    expect(readTicket(db, 'JOY-1')?.tsStatus).toBe('done');
    expect(db.select().from(pulls).where(eq(pulls.source, 'webhook')).all()).toHaveLength(1);
  });
});

describe('what an unauthenticated caller can learn from a rejection', () => {
  const leaks = [/\/Users\//, /apps\/api/, /\.ts:/, /at [A-Za-z]+ \(/, /"message"/, /stack/i];

  test('no rejection body carries a path, a stack frame or a message key', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, {
      process: async () => {
        throw new Error('should never surface');
      },
    });
    const throwing = createWebhookHandler({
      secret: SECRET,
      reserveDelivery: () => {
        throw new Error('/Users/someone/issue-board/apps/api/src/db/sync.ts: database is locked');
      },
      webhooks: { process: async () => {} },
    });

    const responses = await Promise.all([
      handle(webhookRequest({ signature: 'sha256=wrong', deliveryId: 'leak-signature' })),
      handle(webhookRequest({ rawBody: '{not-json', deliveryId: 'leak-json' })),
      handle(webhookRequest({ contentLength: 'unknown', deliveryId: 'leak-length' })),
      handle(webhookRequest({ timestamp: '0', deliveryId: 'leak-stale' })),
      throwing(webhookRequest({ deliveryId: 'leak-internal' })),
    ]);

    for (const response of responses) {
      const text = await response.text();
      expect(response.status).toBeGreaterThanOrEqual(400);
      for (const leak of leaks) expect(text).not.toMatch(leak);
      expect(JSON.parse(text)).toEqual(
        response.status === 500
          ? { error: 'internal_error' }
          : { error: response.status === 401 ? 'unauthorized' : 'invalid_request' }
      );
    }
  });
});

describe('what a rejection writes to the log', () => {
  function captureConsole(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    const record =
      (...prefix: unknown[]) =>
      (...args: unknown[]) =>
        void lines.push([...prefix, ...args].map(String).join(' '));
    console.log = record();
    console.warn = record();
    console.error = record();
    return {
      lines,
      restore: () => {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
      },
    };
  }

  test('an attacker cannot grow the log or plant control bytes with the delivery header', async () => {
    const { db } = openDatabase(':memory:');
    const handle = router(db, { process: async () => {} });
    // `Headers` refuses a literal newline, so the forged separator here is a
    // tab; the length is what an anonymous caller can push without limit.
    const request = webhookRequest({ signature: 'sha256=wrong' });
    request.headers.set('X-Avada-Delivery', `real\t${'x'.repeat(5000)}`);
    const captured = captureConsole();

    try {
      await handle(request);
    } finally {
      captured.restore();
    }

    expect(captured.lines).toHaveLength(1);
    expect(captured.lines[0]).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(captured.lines[0]!.length).toBeLessThan(200);
  });

  test('the 500 path logs the cause it keeps out of the response', async () => {
    const throwing = createWebhookHandler({
      secret: SECRET,
      reserveDelivery: () => {
        throw new Error('database is locked');
      },
      webhooks: { process: async () => {} },
    });
    const captured = captureConsole();

    let response: Response;
    try {
      response = await throwing(webhookRequest({ deliveryId: 'delivery-logged-cause' }));
    } finally {
      captured.restore();
    }

    expect(response!.status).toBe(500);
    expect(await response!.json()).toEqual({ error: 'internal_error' });
    expect(captured.lines.join(' ')).toContain('database is locked');
  });
});
