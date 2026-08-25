import { describe, expect, test } from 'bun:test';
import { bootstrap } from '../src/bootstrap';
import type { Config } from '../src/config';
import { openDatabase } from '../src/db/client';
import { readLastPull, readLastSuccessfulPull } from '../src/db/queries';
import { pulls } from '../src/db/schema';
import { sweepInterruptedPulls } from '../src/db/sync';
import type { HelpDeskTicket } from '../src/helpdesk/types';
import { createPullRunner } from '../src/pull-service';

const config: Config = {
  apiKey: 'test-key',
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
};

function ticket(ticketId: string): HelpDeskTicket {
  return {
    id: `internal-${ticketId}`,
    ticketId,
    subject: `Subject for ${ticketId}`,
    tsStatus: 'dev_fixing',
    ticketStatus: 'open',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('createPullRunner', () => {
  test('records a running row before the fetcher settles', async () => {
    const { db } = openDatabase(':memory:');
    const gate = deferred<HelpDeskTicket[]>();
    const run = createPullRunner(db, config, () => gate.promise).run();

    expect(readLastPull(db)).toMatchObject({ status: 'running', finishedAt: null });

    gate.resolve([]);
    await run;
  });

  test('records a finished pull with all three counts', async () => {
    const { db } = openDatabase(':memory:');
    const runner = createPullRunner(db, config, async () => [ticket('JOY-1'), ticket('JOY-2')]);

    expect(await runner.run()).toEqual({ pulled: 2, inserted: 2, statusChanges: 2 });
    expect(readLastPull(db)).toMatchObject({
      status: 'ok',
      ticketCount: 2,
      inserted: 2,
      statusChanges: 2,
    });
  });

  test('records a failed pull, rejects, and clears the flight for a retry', async () => {
    const { db } = openDatabase(':memory:');
    let attempts = 0;
    const runner = createPullRunner(db, config, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('HelpDesk responded 401 Unauthorized');
      return [];
    });

    await expect(runner.run()).rejects.toThrow('HelpDesk responded 401 Unauthorized');
    expect(readLastPull(db)).toMatchObject({
      status: 'error',
      error: 'HelpDesk responded 401 Unauthorized',
    });
    expect(readLastPull(db)?.finishedAt).not.toBeNull();
    expect(readLastSuccessfulPull(db)).toBeNull();

    await expect(runner.run()).resolves.toEqual({ pulled: 0, inserted: 0, statusChanges: 0 });
    expect(attempts).toBe(2);
  });

  test('a boot sweep settles a pull interrupted while fetching', async () => {
    const { db } = openDatabase(':memory:');
    const gate = deferred<HelpDeskTicket[]>();
    const run = createPullRunner(db, config, () => gate.promise).run();
    expect(readLastPull(db)?.status).toBe('running');

    expect(sweepInterruptedPulls(db)).toBe(1);
    expect(readLastPull(db)).toMatchObject({
      status: 'error',
      error: 'server restarted mid-pull',
    });
    expect(readLastPull(db)?.finishedAt).not.toBeNull();

    gate.resolve([]);
    await run;
  });

  test('two concurrent runs share one fetch and a later run starts another', async () => {
    const { db } = openDatabase(':memory:');
    const firstGate = deferred<HelpDeskTicket[]>();
    let fetches = 0;
    const runner = createPullRunner(db, config, async () => {
      fetches += 1;
      if (fetches === 1) return firstGate.promise;
      return [ticket('JOY-2')];
    });

    const first = runner.run();
    const second = runner.run();
    expect(fetches).toBe(1);
    expect(db.select().from(pulls).all()).toHaveLength(1);

    firstGate.resolve([ticket('JOY-1')]);
    expect(await first).toEqual(await second);
    expect(await runner.run()).toEqual({ pulled: 1, inserted: 1, statusChanges: 1 });
    expect(fetches).toBe(2);
    expect(db.select().from(pulls).all()).toHaveLength(2);
  });
});

test('bootstrap sweeps interrupted pulls before the server starts', async () => {
  const { db } = openDatabase(':memory:');
  const gate = deferred<HelpDeskTicket[]>();
  const run = createPullRunner(db, config, () => gate.promise).run();

  expect(bootstrap(db)).toBe(1);
  expect(readLastPull(db)).toMatchObject({
    status: 'error',
    error: 'server restarted mid-pull',
  });

  gate.resolve([]);
  await run;
});
