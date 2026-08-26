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

describe('a board with webhook rows only', () => {
  test('reports no pull age at all rather than a webhook time', () => {
    const { db } = openDatabase(':memory:');
    db.insert(pulls)
      .values([
        settledRow('webhook', 'ok', '2026-08-26T10:00:00.000Z'),
        settledRow('webhook', 'ok', '2026-08-26T10:01:00.000Z'),
      ])
      .run();

    expect(readLastPull(db)).toBeNull();
    expect(readLastSuccessfulPull(db)).toBeNull();
    expect(readLastSuccessfulWebhook(db)?.startedAt).toBe('2026-08-26T10:01:00.000Z');
  });

  test('a failed delivery cannot make the board announce a failed pull', () => {
    const { db } = openDatabase(':memory:');
    db.insert(pulls)
      .values(settledRow('webhook', 'error', '2026-08-26T10:00:00.000Z'))
      .run();

    // `lastPull` is what the "Stale · HelpDesk pull failed" banner reads.
    expect(readLastPull(db)).toBeNull();
    expect(readLastSuccessfulWebhook(db)).toBeNull();
  });

  test('a running delivery is neither the latest full pull nor a successful webhook', () => {
    const { db } = openDatabase(':memory:');
    db.insert(pulls)
      .values([
        settledRow('pull', 'ok', '2026-08-26T10:00:00.000Z'),
        {
          source: 'webhook' as const,
          status: 'running' as const,
          startedAt: '2026-08-26T10:02:00.000Z',
          finishedAt: null,
          deliveryId: 'delivery-running',
        },
      ])
      .run();

    expect(readLastPull(db)).toMatchObject({ source: 'pull', status: 'ok' });
    expect(readLastSuccessfulWebhook(db)).toBeNull();
  });

  test('an unfinished full pull is still the latest attempt, so staleness stays truthful', () => {
    const { db } = openDatabase(':memory:');
    db.insert(pulls)
      .values([
        settledRow('pull', 'ok', '2026-08-26T10:00:00.000Z'),
        {
          source: 'pull' as const,
          status: 'running' as const,
          startedAt: '2026-08-26T10:03:00.000Z',
          finishedAt: null,
          deliveryId: null,
        },
        settledRow('webhook', 'ok', '2026-08-26T10:04:00.000Z'),
      ])
      .run();

    expect(readLastPull(db)).toMatchObject({ source: 'pull', status: 'running' });
    expect(readLastSuccessfulPull(db)?.startedAt).toBe('2026-08-26T10:00:00.000Z');
  });
});
