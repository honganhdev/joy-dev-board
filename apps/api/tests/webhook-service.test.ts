import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { Config } from '../src/config';
import { openDatabase, type Db } from '../src/db/client';
import {
  readLastSuccessfulWebhook,
  readStatusHistory,
  readTicket,
  readTickets,
} from '../src/db/queries';
import { pulls, tickets, ticketStatusHistory } from '../src/db/schema';
import {
  finishPull,
  reserveDelivery,
  startPull,
  sweepInterruptedPulls,
  syncPull,
} from '../src/db/sync';
import type { HelpDeskTicket } from '../src/helpdesk/types';
import { createPullRunner, type PullRunner } from '../src/pull-service';
import {
  createWebhookProcessor,
  redriveFailedDeliveries,
  type CreatedOnFetcher,
} from '../src/webhook-service';

const config = {
  apiKey: 'test-key',
  webhookSecret: 'service-test-secret',
  baseUrl: 'https://helpdesk.test',
  port: 8787,
  cacheTtlMs: 300_000,
  year: 2026,
  appName: 'JOY Loyalty',
  databasePath: ':memory:',
  auth: {
    username: 'boarduser',
    passwordHash: 'unused',
    sessionTtlMs: 604_800_000,
    cookieSecure: false,
    trustProxy: false,
  },
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
    ticketNumber: '1234',
    subject: 'Complete fetched record',
    tsStatus: 'doing',
    ticketStatus: 'open',
    level: 2,
    appName: 'JOY Loyalty',
    appPlan: 'Pro',
    tasks: [{ id: 'task-1', title: 'Keep me', completed: false }],
    createdAt: '2026-08-23T08:00:00.000Z',
    updatedAt: '2026-08-26T08:00:00.000Z',
    ...overrides,
  };
}

function seed(db: Db, value: HelpDeskTicket): void {
  const pullId = startPull(db);
  const result = syncPull(db, [value], pullId, '2026-08-25T08:00:00.000Z');
  finishPull(db, pullId, result);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('webhook processing', () => {
  test('writes the complete fetched record and its status history under the delivery row', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket({ tsStatus: 'doing' }));
    const fetched = ticket({ tsStatus: 'done', description: 'also preserved' });
    const pullId = reserveDelivery(db, 'delivery-write')!;
    const processor = createWebhookProcessor(db, config, idlePulls, async () => [fetched]);

    await processor.process(pullId, fetched.id, fetched.createdAt);

    expect(readTicket(db, fetched.ticketId)).toEqual(fetched);
    expect(readStatusHistory(db, fetched.ticketId)).toHaveLength(2);
    expect(
      db.select().from(ticketStatusHistory).orderBy(ticketStatusHistory.id).all().at(-1)
    ).toMatchObject({
      fromStatus: 'doing',
      toStatus: 'done',
      ticketUpdatedAt: fetched.updatedAt,
      pullId,
    });
    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()).toMatchObject({
      status: 'ok',
      ticketCount: 1,
      inserted: 0,
      statusChanges: 1,
    });
  });

  test('a following full pull keeps the webhook transition exactly once', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket({ tsStatus: 'doing' }));
    const done = ticket({ tsStatus: 'done' });
    const deliveryPullId = reserveDelivery(db, 'delivery-history')!;
    const processor = createWebhookProcessor(db, config, idlePulls, async () => [done]);
    await processor.process(deliveryPullId, done.id, done.createdAt);

    const fullPullId = startPull(db);
    const fullPullResult = syncPull(db, [done], fullPullId, '2026-08-26T09:00:00.000Z');
    finishPull(db, fullPullId, fullPullResult);

    expect(fullPullResult.statusChanges).toBe(0);
    expect(readStatusHistory(db, done.ticketId)).toEqual([
      {
        fromStatus: null,
        toStatus: 'doing',
        observedAt: '2026-08-25T08:00:00.000Z',
        ticketUpdatedAt: '2026-08-26T08:00:00.000Z',
      },
      expect.objectContaining({ fromStatus: 'doing', toStatus: 'done' }),
    ]);
    expect(
      db
        .select()
        .from(ticketStatusHistory)
        .where(eq(ticketStatusHistory.pullId, deliveryPullId))
        .all()
    ).toHaveLength(1);
  });

  test('an absent ticket leaves the mirror byte-identical and fails without rejecting', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket());
    const before = db.select().from(tickets).all();
    const pullId = reserveDelivery(db, 'delivery-missing')!;
    const processor = createWebhookProcessor(db, config, idlePulls, async () => []);

    await expect(
      processor.process(pullId, 'internal-1', ticket().createdAt)
    ).resolves.toBeUndefined();

    expect(db.select().from(tickets).all()).toEqual(before);
    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()?.status).toBe('error');
  });

  test('a foreign-app ticket writes nothing and finishes cleanly', async () => {
    const { db } = openDatabase(':memory:');
    const foreign = ticket({ appName: 'JOY Subscription' });
    const pullId = reserveDelivery(db, 'delivery-foreign')!;
    const processor = createWebhookProcessor(db, config, idlePulls, async () => [foreign]);

    await processor.process(pullId, foreign.id, foreign.createdAt);

    expect(readTickets(db)).toEqual([]);
    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()).toMatchObject({
      status: 'ok',
      ticketCount: 0,
    });
  });

  test('a previous-year ticket writes nothing and finishes cleanly', async () => {
    const { db } = openDatabase(':memory:');
    const old = ticket({ createdAt: '2025-12-31T23:00:00.000Z' });
    const pullId = reserveDelivery(db, 'delivery-old')!;
    const processor = createWebhookProcessor(db, config, idlePulls, async () => [old]);

    await processor.process(pullId, old.id, old.createdAt);

    expect(readTickets(db)).toEqual([]);
    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()?.status).toBe('ok');
  });

  test('a failed fetch fails the delivery row and does not reject', async () => {
    const { db } = openDatabase(':memory:');
    const pullId = reserveDelivery(db, 'delivery-fetch-error')!;
    const fetcher: CreatedOnFetcher = async () => {
      throw new Error('upstream unavailable');
    };
    const processor = createWebhookProcessor(db, config, idlePulls, fetcher);

    await expect(
      processor.process(pullId, 'internal-1', ticket().createdAt)
    ).resolves.toBeUndefined();
    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()).toMatchObject({
      status: 'error',
      error: 'upstream unavailable',
    });
  });

  test('a payload without a usable createdAt fails its reserved row without fetching', async () => {
    const { db } = openDatabase(':memory:');
    const pullId = reserveDelivery(db, 'delivery-no-created-at')!;
    let fetches = 0;
    const processor = createWebhookProcessor(db, config, idlePulls, async () => {
      fetches += 1;
      return [];
    });

    await processor.process(pullId, 'internal-1', undefined);

    expect(fetches).toBe(0);
    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()).toMatchObject({
      status: 'error',
      error: 'ticket internal-1 has no usable createdAt timestamp',
    });
  });

  test('serializes two webhook fetches and writes', async () => {
    const { db } = openDatabase(':memory:');
    const firstGate = deferred<HelpDeskTicket[]>();
    const firstStarted = deferred<void>();
    let fetches = 0;
    const processor = createWebhookProcessor(db, config, idlePulls, async () => {
      fetches += 1;
      if (fetches === 1) firstStarted.resolve(undefined);
      return fetches === 1 ? firstGate.promise : [ticket({ tsStatus: 'done' })];
    });
    const firstId = reserveDelivery(db, 'delivery-first')!;
    const secondId = reserveDelivery(db, 'delivery-second')!;

    const first = processor.process(firstId, 'internal-1', ticket().createdAt);
    const second = processor.process(secondId, 'internal-1', ticket().createdAt);
    await firstStarted.promise;
    expect(fetches).toBe(1);

    firstGate.resolve([ticket({ tsStatus: 'doing' })]);
    await first;
    await second;
    expect(fetches).toBe(2);
    expect(readTicket(db, 'JOY-1')?.tsStatus).toBe('done');
  });

  test('waits for an in-flight full pull before fetching and then wins', async () => {
    const { db } = openDatabase(':memory:');
    const pullGate = deferred<HelpDeskTicket[]>();
    const pulls = createPullRunner(db, config, () => pullGate.promise);
    const runningPull = pulls.run();
    let webhookFetches = 0;
    const processor = createWebhookProcessor(db, config, pulls, async () => {
      webhookFetches += 1;
      return [ticket({ tsStatus: 'done' })];
    });
    const deliveryId = reserveDelivery(db, 'delivery-behind-pull')!;

    const processing = processor.process(deliveryId, 'internal-1', ticket().createdAt);
    await Promise.resolve();
    expect(webhookFetches).toBe(0);

    pullGate.resolve([ticket({ tsStatus: 'doing' })]);
    await runningPull;
    await processing;
    expect(webhookFetches).toBe(1);
    expect(readTicket(db, 'JOY-1')?.tsStatus).toBe('done');
  });
});

describe('the mirrored window is judged on the fetched record', () => {
  test('a delivery claiming an in-year createdAt cannot inject an out-of-year ticket', async () => {
    const { db } = openDatabase(':memory:');
    // The notification is attacker- or bug-supplied; only HelpDesk's own answer
    // decides whether the ticket belongs in this mirror.
    const outOfYear = ticket({ createdAt: '2025-11-02T08:00:00.000Z' });
    const pullId = reserveDelivery(db, 'delivery-claimed-year')!;
    const processor = createWebhookProcessor(db, config, idlePulls, async () => [outOfYear]);

    await processor.process(pullId, outOfYear.id, '2026-08-23T08:00:00.000Z');

    expect(readTickets(db)).toEqual([]);
    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()).toMatchObject({
      status: 'ok',
      ticketCount: 0,
      statusChanges: 0,
    });
  });

  test('a next-year ticket is ignored as firmly as a previous-year one', async () => {
    const { db } = openDatabase(':memory:');
    const future = ticket({ createdAt: '2027-01-01T00:30:00.000Z' });
    const pullId = reserveDelivery(db, 'delivery-next-year')!;
    const processor = createWebhookProcessor(db, config, idlePulls, async () => [future]);

    await processor.process(pullId, future.id, future.createdAt);

    expect(readTickets(db)).toEqual([]);
    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()?.status).toBe('ok');
  });

  test('a fetched record with no createdAt of its own is not injected', async () => {
    const { db } = openDatabase(':memory:');
    const undated = ticket({ createdAt: null });
    const pullId = reserveDelivery(db, 'delivery-undated-record')!;
    const processor = createWebhookProcessor(db, config, idlePulls, async () => [undated]);

    await processor.process(pullId, undated.id, '2026-08-23T08:00:00.000Z');

    expect(readTickets(db)).toEqual([]);
    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()?.status).toBe('ok');
  });

  test('a busy day matched by internal id ignores every other ticket in the window', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket({ tsStatus: 'doing' }));
    const neighbours = [
      ticket({ id: 'internal-2', ticketId: 'JOY-2', tsStatus: 'todo' }),
      ticket({ tsStatus: 'done' }),
      ticket({ id: 'internal-3', ticketId: 'JOY-3', tsStatus: 'todo' }),
    ];
    const pullId = reserveDelivery(db, 'delivery-busy-day')!;
    const processor = createWebhookProcessor(db, config, idlePulls, async () => neighbours);

    await processor.process(pullId, 'internal-1', ticket().createdAt);

    // A whole day of tickets came back; only the notified one may be written.
    expect(readTickets(db).map((row) => row.ticketId)).toEqual(['JOY-1']);
    expect(readTicket(db, 'JOY-1')?.tsStatus).toBe('done');
    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()?.ticketCount).toBe(1);
  });

  test('a foreign-app ticket sharing the mirrored year is still not written', async () => {
    const { db } = openDatabase(':memory:');
    const foreign = ticket({ appName: 'JOY Subscription', createdAt: '2026-08-23T08:00:00.000Z' });
    const pullId = reserveDelivery(db, 'delivery-foreign-in-year')!;
    const processor = createWebhookProcessor(db, config, idlePulls, async () => [foreign]);

    await processor.process(pullId, foreign.id, foreign.createdAt);

    expect(readTickets(db)).toEqual([]);
    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()).toMatchObject({
      status: 'ok',
      ticketCount: 0,
    });
  });
});


describe('a full pull that commits while a delivery is fetching', () => {
  test('is not reversed by the delivery\'s older snapshot', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket({ tsStatus: 'doing' }));
    const webhookGate = deferred<HelpDeskTicket[]>();
    const webhookFetchStarted = deferred<void>();
    const pullGate = deferred<HelpDeskTicket[]>();
    const pullRunner = createPullRunner(db, config, () => pullGate.promise);
    const processor = createWebhookProcessor(db, config, pullRunner, async () => {
      webhookFetchStarted.resolve(undefined);
      return webhookGate.promise;
    });
    const deliveryPullId = reserveDelivery(db, 'delivery-stale-snapshot')!;

    // The delivery's day fetch is in flight; its snapshot still says 'doing'.
    const processing = processor.process(deliveryPullId, 'internal-1', ticket().createdAt);
    await webhookFetchStarted.promise;

    // Meanwhile the ticket is bulk-closed upstream, which fires no webhook at
    // all, and a board load kicks the opportunistic pull that reads 'done'.
    const running = pullRunner.run();
    pullGate.resolve([ticket({ tsStatus: 'done', updatedAt: '2026-08-26T09:00:00.000Z' })]);
    await running;

    webhookGate.resolve([ticket({ tsStatus: 'doing' })]);
    await processing;

    expect(readTicket(db, 'JOY-1')?.tsStatus).toBe('done');
    // `ticket_status_history` is the table nothing can repair: a done → doing
    // row written here would be permanent.
    expect(
      readStatusHistory(db, 'JOY-1').map((entry) => [entry.fromStatus, entry.toStatus])
    ).toEqual([
      [null, 'doing'],
      ['doing', 'done'],
    ]);
    expect(db.select().from(pulls).where(eq(pulls.id, deliveryPullId)).get()).toMatchObject({
      status: 'ok',
      ticketCount: 0,
    });
  });
});

describe('a delivery lost after its 202', () => {
  test('is re-driven on the next boot, with no second request from any client', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket({ tsStatus: 'doing' }));
    // Reserved exactly as the route reserves it: with the ticket it named.
    const pullId = reserveDelivery(
      db,
      'delivery-lost',
      undefined,
      'internal-1',
      '2026-08-23T08:00:00.000Z'
    )!;
    const failing = createWebhookProcessor(db, config, idlePulls, async () => {
      throw new Error('upstream unavailable');
    });
    await failing.process(pullId, 'internal-1', '2026-08-23T08:00:00.000Z');
    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()?.status).toBe('error');
    expect(readTicket(db, 'JOY-1')?.tsStatus).toBe('doing');

    // Boot. Avada saw a 2xx and will never send this delivery again.
    sweepInterruptedPulls(db);
    let requests = 0;
    const recovered = createWebhookProcessor(db, config, idlePulls, async () => {
      requests += 1;
      return [ticket({ tsStatus: 'done' })];
    });

    expect(await redriveFailedDeliveries(db, recovered)).toBe(1);

    expect(requests).toBe(1);
    expect(readTicket(db, 'JOY-1')?.tsStatus).toBe('done');
    expect(readStatusHistory(db, 'JOY-1')).toHaveLength(2);
    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()).toMatchObject({
      status: 'ok',
      ticketCount: 1,
    });
  });

  test('a settled delivery is not re-driven a second time', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket({ tsStatus: 'doing' }));
    const pullId = reserveDelivery(
      db,
      'delivery-settled-boot',
      undefined,
      'internal-1',
      '2026-08-23T08:00:00.000Z'
    )!;
    const processor = createWebhookProcessor(db, config, idlePulls, async () => [
      ticket({ tsStatus: 'done' }),
    ]);
    await processor.process(pullId, 'internal-1', '2026-08-23T08:00:00.000Z');

    expect(await redriveFailedDeliveries(db, processor)).toBe(0);
    expect(readStatusHistory(db, 'JOY-1')).toHaveLength(2);
  });
});

describe('freshness a delivery may claim', () => {
  test('an ignored delivery keeps its row but does not advance the webhook time', async () => {
    const { db } = openDatabase(':memory:');
    seed(db, ticket({ tsStatus: 'doing' }));
    const wrote = reserveDelivery(db, 'delivery-wrote')!;
    const writing = createWebhookProcessor(db, config, idlePulls, async () => [
      ticket({ tsStatus: 'done' }),
    ]);
    await writing.process(wrote, 'internal-1', ticket().createdAt);
    const freshAfterWrite = readLastSuccessfulWebhook(db);

    const ignored = reserveDelivery(db, 'delivery-ignored')!;
    const foreign = createWebhookProcessor(db, config, idlePulls, async () => [
      ticket({ id: 'internal-9', ticketId: 'JOY-9', appName: 'JOY Subscription' }),
    ]);
    await foreign.process(ignored, 'internal-9', ticket().createdAt);

    // The row is the dedupe record and the audit trail, so it stays...
    expect(db.select().from(pulls).where(eq(pulls.id, ignored)).get()).toMatchObject({
      source: 'webhook',
      status: 'ok',
      ticketCount: 0,
    });
    // ...but it wrote nothing, so the board must not say "webhook just now".
    expect(readLastSuccessfulWebhook(db)?.id).toBe(freshAfterWrite!.id);
  });
});
