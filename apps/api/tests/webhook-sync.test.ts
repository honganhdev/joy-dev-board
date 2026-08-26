import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { openDatabase } from '../src/db/client';
import { pulls } from '../src/db/schema';
import {
  failPull,
  finishPull,
  reserveDelivery,
  startPull,
  sweepInterruptedPulls,
} from '../src/db/sync';

describe('webhook delivery rows', () => {
  test('reserves a delivery once and dedupes it while it is running', () => {
    const { db } = openDatabase(':memory:');

    const first = reserveDelivery(db, 'delivery-1');
    const duplicate = reserveDelivery(db, 'delivery-1');

    expect(first).toBeNumber();
    expect(duplicate).toBeNull();
    expect(db.select().from(pulls).all()).toHaveLength(1);
  });

  test('tags a manual pull as a full pull', () => {
    const { db } = openDatabase(':memory:');
    const pullId = startPull(db);

    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()?.source).toBe('pull');
  });

  test('the boot sweep turns an unfinished webhook delivery into an error', () => {
    const { db } = openDatabase(':memory:');
    const pullId = reserveDelivery(db, 'delivery-2');

    expect(sweepInterruptedPulls(db)).toBe(1);
    expect(db.select().from(pulls).where(eq(pulls.id, pullId!)).get()).toMatchObject({
      source: 'webhook',
      status: 'error',
      error: 'server restarted mid-pull',
    });
  });

  test('a boot-swept delivery id can be reserved again for the sender retry', () => {
    const { db } = openDatabase(':memory:');
    const first = reserveDelivery(db, 'delivery-retry', '2026-08-26T10:00:00.000Z');
    sweepInterruptedPulls(db);

    const retried = reserveDelivery(db, 'delivery-retry', '2026-08-26T10:01:00.000Z');

    expect(retried).toBe(first);
    expect(db.select().from(pulls).where(eq(pulls.id, retried!)).get()).toMatchObject({
      status: 'running',
      startedAt: '2026-08-26T10:01:00.000Z',
      finishedAt: null,
      error: null,
    });
  });
});

describe('delivery reservation across restarts and retries', () => {
  test('a settled delivery cannot be re-reserved and keeps its recorded result', () => {
    const { db } = openDatabase(':memory:');
    const pullId = reserveDelivery(db, 'delivery-settled', '2026-08-26T10:00:00.000Z')!;
    finishPull(db, pullId, { pulled: 1, inserted: 0, statusChanges: 1 });
    const settled = db.select().from(pulls).where(eq(pulls.id, pullId)).get();

    const retried = reserveDelivery(db, 'delivery-settled', '2026-08-26T10:05:00.000Z');

    expect(retried).toBeNull();
    // A retry must not reopen a finished delivery: that would erase the counts
    // the board reads and re-run an at-most-once write.
    expect(db.select().from(pulls).where(eq(pulls.id, pullId)).get()).toEqual(settled!);
  });

  test('a delivery that failed on its own can be re-reserved without a restart', () => {
    const { db } = openDatabase(':memory:');
    const first = reserveDelivery(db, 'delivery-failed', '2026-08-26T10:00:00.000Z')!;
    failPull(db, first, 'upstream unavailable');

    const retried = reserveDelivery(db, 'delivery-failed', '2026-08-26T10:01:00.000Z');

    expect(retried).toBe(first);
    expect(db.select().from(pulls).where(eq(pulls.id, first)).get()).toMatchObject({
      status: 'running',
      error: null,
      finishedAt: null,
    });
  });

  test('the unique delivery index does not collapse full pulls, which carry no delivery id', () => {
    const { db } = openDatabase(':memory:');

    const first = startPull(db);
    const second = startPull(db);

    expect(second).not.toBe(first);
    expect(db.select().from(pulls).all()).toHaveLength(2);
  });

  test('a webhook and a full pull started at the same instant stay two rows', () => {
    const { db } = openDatabase(':memory:');
    const at = '2026-08-26T10:00:00.000Z';

    const pullId = startPull(db, at);
    const deliveryId = reserveDelivery(db, 'delivery-simultaneous', at);

    expect(deliveryId).not.toBeNull();
    expect(deliveryId).not.toBe(pullId);
    expect(db.select().from(pulls).all()).toHaveLength(2);
  });
});
