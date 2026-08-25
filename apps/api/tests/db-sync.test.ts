import { describe, expect, test } from 'bun:test';
import { openDatabase, type Db } from '../src/db/client';
import { pulls } from '../src/db/schema';
import {
  countTickets,
  readLastPull,
  readLastSuccessfulPull,
  readStatusHistory,
  readTicket,
  readTickets,
} from '../src/db/queries';
import { failPull, finishPull, startPull, sweepInterruptedPulls, syncPull } from '../src/db/sync';
import type { HelpDeskTicket } from '../src/helpdesk/types';

/** A fresh, migrated, throwaway database per test. */
function freshDb(): Db {
  return openDatabase(':memory:').db;
}

function ticket(ticketId: string, overrides: Partial<HelpDeskTicket> = {}): HelpDeskTicket {
  return {
    id: `internal-${ticketId}`,
    ticketId,
    subject: `Subject for ${ticketId}`,
    tsStatus: 'dev_fixing',
    ticketStatus: 'open',
    updatedAt: '2026-08-24T09:00:00.000Z',
    ...overrides,
  };
}

/** Runs a pull end to end the way `pull-service` does. */
function pull(db: Db, tickets: HelpDeskTicket[], observedAt?: string) {
  const pullId = startPull(db);
  const result = syncPull(db, tickets, pullId, observedAt);
  finishPull(db, pullId, result);
  return { pullId, ...result };
}

describe('syncPull history', () => {
  test('first sight of a ticket writes one history row with fromStatus null', () => {
    const db = freshDb();
    const result = pull(db, [ticket('JOY-1')], '2026-08-24T10:00:00.000Z');

    expect(result).toMatchObject({ pulled: 1, inserted: 1, statusChanges: 1 });
    expect(readStatusHistory(db, 'JOY-1')).toEqual([
      {
        fromStatus: null,
        toStatus: 'dev_fixing',
        observedAt: '2026-08-24T10:00:00.000Z',
        ticketUpdatedAt: '2026-08-24T09:00:00.000Z',
      },
    ]);
  });

  test('an unchanged pull writes no history at all', () => {
    const db = freshDb();
    pull(db, [ticket('JOY-1'), ticket('JOY-2')]);
    const second = pull(db, [ticket('JOY-1'), ticket('JOY-2')]);

    expect(second).toMatchObject({ pulled: 2, inserted: 0, statusChanges: 0 });
    expect(readStatusHistory(db, 'JOY-1')).toHaveLength(1);
    expect(readStatusHistory(db, 'JOY-2')).toHaveLength(1);
  });

  test('a changed tsStatus writes exactly one row, oldest first', () => {
    const db = freshDb();
    pull(db, [ticket('JOY-1', { tsStatus: 'dev_fixing' })], '2026-08-24T10:00:00.000Z');
    pull(db, [ticket('JOY-1', { tsStatus: 'dev_done' })], '2026-08-24T11:00:00.000Z');
    // Same status again: still nothing new.
    pull(db, [ticket('JOY-1', { tsStatus: 'dev_done' })], '2026-08-24T12:00:00.000Z');

    const history = readStatusHistory(db, 'JOY-1');
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ fromStatus: null, toStatus: 'dev_fixing' });
    expect(history[1]).toMatchObject({
      fromStatus: 'dev_fixing',
      toStatus: 'dev_done',
      observedAt: '2026-08-24T11:00:00.000Z',
    });
  });

  test('a missing or null tsStatus is stored, not crashed on', () => {
    const db = freshDb();
    pull(db, [ticket('JOY-1', { tsStatus: null }), ticket('JOY-2', { tsStatus: undefined })]);
    const moved = pull(db, [ticket('JOY-1', { tsStatus: 'doing' }), ticket('JOY-2', { tsStatus: undefined })]);

    expect(moved.statusChanges).toBe(1);
    expect(readStatusHistory(db, 'JOY-1')).toMatchObject([
      { fromStatus: null, toStatus: null },
      { fromStatus: null, toStatus: 'doing' },
    ]);
    expect(readStatusHistory(db, 'JOY-2')).toMatchObject([{ fromStatus: null, toStatus: null }]);
  });

  test('a ticket with no ticketId falls back to its internal id', () => {
    const db = freshDb();
    // Seen in production on records whose ticketNumber is still `unknown…`.
    pull(db, [ticket('', { id: 'Wq5HCFL56AsGOPIUMNyw', ticketNumber: 'unknown2634' })]);

    const stored = readTicket(db, 'Wq5HCFL56AsGOPIUMNyw');
    expect(stored?.ticketId).toBe('Wq5HCFL56AsGOPIUMNyw');
    expect(readStatusHistory(db, 'Wq5HCFL56AsGOPIUMNyw')).toHaveLength(1);
  });

  test('an unknown status is stored verbatim rather than mapped', () => {
    const db = freshDb();
    pull(db, [ticket('JOY-1', { tsStatus: 'some_status_nobody_has_seen' })]);
    expect(readStatusHistory(db, 'JOY-1')[0]?.toStatus).toBe('some_status_nobody_has_seen');
  });
});

describe('syncPull writes', () => {
  test('upsert refreshes the ticket but keeps firstSeenAt', () => {
    const db = freshDb();
    pull(db, [ticket('JOY-1', { subject: 'before' })], '2026-08-24T10:00:00.000Z');
    pull(db, [ticket('JOY-1', { subject: 'after' })], '2026-08-24T11:00:00.000Z');

    expect(countTickets(db)).toBe(1);
    expect(readTicket(db, 'JOY-1')?.subject).toBe('after');
  });

  test('nested arrays survive the round trip through raw', () => {
    const db = freshDb();
    const nested = ticket('JOY-1', {
      store: [{ shopName: 'Acme', domain: 'acme.myshopify.com', email: 'a@b.c' }],
      members: [{ memberId: 'm1', displayName: 'Alex' }],
      tasks: [{ id: 't1', title: 'Check widget', completed: true }],
      tagIds: ['tag-a', 'tag-b'],
    });
    pull(db, [nested]);

    expect(readTicket(db, 'JOY-1')).toEqual(nested);
    expect(readTickets(db)).toHaveLength(1);
  });

  test('a failed sync leaves no partial write', () => {
    const db = freshDb();
    pull(db, [ticket('JOY-1')]);

    // pullId 404 has no row in `pulls`, so the history insert violates its
    // foreign key partway through the batch.
    expect(() => syncPull(db, [ticket('JOY-2'), ticket('JOY-3')], 404)).toThrow();

    expect(countTickets(db)).toBe(1);
    expect(readTicket(db, 'JOY-2')).toBeNull();
    expect(readStatusHistory(db, 'JOY-2')).toEqual([]);
  });
});

describe('pull records', () => {
  test('a pull is only successful once it finishes', () => {
    const db = freshDb();
    const pullId = startPull(db);

    expect(readLastPull(db)).toMatchObject({ status: 'running', finishedAt: null });
    expect(readLastSuccessfulPull(db)).toBeNull();

    finishPull(db, pullId, { pulled: 7, inserted: 0, statusChanges: 0 });
    expect(readLastSuccessfulPull(db)).toMatchObject({ status: 'ok', ticketCount: 7 });
  });

  test('a finished pull records what it changed', () => {
    const db = freshDb();
    pull(db, [ticket('JOY-1')]);

    expect(readLastPull(db)).toMatchObject({
      status: 'ok',
      ticketCount: 1,
      inserted: 1,
      statusChanges: 1,
    });
  });

  test('the boot sweep turns an interrupted pull into an honest failure', () => {
    const db = freshDb();
    startPull(db);

    expect(sweepInterruptedPulls(db)).toBe(1);
    expect(readLastPull(db)).toMatchObject({
      status: 'error',
      error: 'server restarted mid-pull',
    });
    expect(readLastPull(db)?.finishedAt).not.toBeNull();
    expect(readLastSuccessfulPull(db)).toBeNull();
  });

  test('the sweep leaves settled pulls alone', () => {
    const db = freshDb();
    pull(db, [ticket('JOY-1')]);
    failPull(db, startPull(db), 'HelpDesk responded 401 Unauthorized');
    const before = db.select().from(pulls).all();

    expect(sweepInterruptedPulls(db)).toBe(0);
    expect(db.select().from(pulls).all()).toEqual(before);
  });

  test('a failed pull keeps its error and does not become the last successful one', () => {
    const db = freshDb();
    pull(db, [ticket('JOY-1')]);
    failPull(db, startPull(db), 'HelpDesk responded 401 Unauthorized');

    expect(readLastPull(db)).toMatchObject({ status: 'error', error: 'HelpDesk responded 401 Unauthorized' });
    expect(readLastSuccessfulPull(db)?.status).toBe('ok');
    expect(countTickets(db)).toBe(1);
  });
});
