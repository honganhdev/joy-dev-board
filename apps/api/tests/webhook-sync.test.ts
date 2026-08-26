import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { openDatabase } from '../src/db/client';
import { pulls } from '../src/db/schema';
import { reserveDelivery, startPull, sweepInterruptedPulls } from '../src/db/sync';

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
