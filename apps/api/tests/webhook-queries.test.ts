import { describe, expect, test } from 'bun:test';
import { openDatabase } from '../src/db/client';
import { readLastPull, readLastSuccessfulPull, readLastSuccessfulWebhook } from '../src/db/queries';
import { pulls } from '../src/db/schema';

function settledRow(source: 'pull' | 'webhook' | null, status: 'ok' | 'error', startedAt: string) {
  return {
    source,
    status,
    startedAt,
    finishedAt: startedAt,
    deliveryId: source === 'webhook' ? `delivery-${startedAt}` : null,
  };
}

describe('pull source queries', () => {
  test('a newer successful webhook does not replace the last successful full pull', () => {
    const { db } = openDatabase(':memory:');
    db.insert(pulls)
      .values([
        settledRow('pull', 'ok', '2026-08-26T10:00:00.000Z'),
        settledRow('webhook', 'ok', '2026-08-26T10:01:00.000Z'),
      ])
      .run();

    expect(readLastSuccessfulPull(db)?.source).toBe('pull');
    expect(readLastSuccessfulWebhook(db)?.source).toBe('webhook');
  });

  test('a newer failed webhook does not become the latest full pull attempt', () => {
    const { db } = openDatabase(':memory:');
    db.insert(pulls)
      .values([
        settledRow('pull', 'ok', '2026-08-26T10:00:00.000Z'),
        settledRow('webhook', 'error', '2026-08-26T10:01:00.000Z'),
      ])
      .run();

    expect(readLastPull(db)).toMatchObject({ source: 'pull', status: 'ok' });
  });

  test('rows written before the source column existed remain full pulls', () => {
    const { db } = openDatabase(':memory:');
    db.insert(pulls)
      .values(settledRow(null, 'ok', '2026-08-26T10:00:00.000Z'))
      .run();

    expect(readLastPull(db)?.source).toBeNull();
    expect(readLastSuccessfulPull(db)?.source).toBeNull();
  });
});
