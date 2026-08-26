import { describe, expect, test } from 'bun:test';
import type { AuthConfig, Config } from '../src/config';
import { openDatabase, type Db } from '../src/db/client';
import { readLastPull } from '../src/db/queries';
import { boardColumnSettings, pulls as pullRows } from '../src/db/schema';
import { startPull, sweepInterruptedPulls } from '../src/db/sync';
import type { HelpDeskTicket } from '../src/helpdesk/types';
import { createPullRunner, type PullRunner, type TicketFetcher } from '../src/pull-service';
import { createRouter } from '../src/routes';

const USERNAME = 'boarduser';
const PASSWORD = 'correct horse battery staple';
const PASSWORD_HASH = await Bun.password.hash(PASSWORD, { algorithm: 'argon2id' });

function authConfig(): AuthConfig {
  return {
    username: USERNAME,
    passwordHash: PASSWORD_HASH,
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    cookieSecure: false,
    trustProxy: false,
  };
}

const config: Config = {
  apiKey: 'test-key',
  baseUrl: 'https://helpdesk.test',
  port: 8787,
  cacheTtlMs: 300_000,
  year: 2026,
  appName: 'JOY Loyalty',
  databasePath: ':memory:',
  auth: authConfig(),
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
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function harness(fetchTickets: TicketFetcher): {
  db: Db;
  pulls: PullRunner;
  handle: ReturnType<typeof createRouter>;
} {
  const db = openDatabase(':memory:').db;
  const pulls = createPullRunner(db, config, fetchTickets);
  const handle = createRouter({
    db,
    pulls,
    tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
    auth: authConfig(),
    year: config.year,
  });
  return { db, pulls, handle };
}

function post(path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function put(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { headers });
}

async function login(handle: ReturnType<typeof createRouter>): Promise<string> {
  const response = await handle(post('/api/auth/login', { username: USERNAME, password: PASSWORD }));
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

describe('pull routes', () => {
  test('pull answers immediately and says it is running', async () => {
    const gate = deferred<HelpDeskTicket[]>();
    const { handle, pulls } = harness(() => gate.promise);
    const cookie = await login(handle);

    const response = await handle(post('/api/pull', undefined, { cookie }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: 'running', finishedAt: null });

    const run = pulls.run();
    gate.resolve([]);
    await run;
  });

  test('the status route reports the same pull', async () => {
    const gate = deferred<HelpDeskTicket[]>();
    const { handle, pulls } = harness(() => gate.promise);
    const cookie = await login(handle);

    const started = (await (await handle(post('/api/pull', undefined, { cookie }))).json()) as {
      startedAt: string;
    };
    const status = await handle(get('/api/pull/status', { cookie }));
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ status: 'running', startedAt: started.startedAt });

    const run = pulls.run();
    gate.resolve([]);
    await run;
  });

  test('the status route reports the finished pull with all three counts', async () => {
    const gate = deferred<HelpDeskTicket[]>();
    const { handle, pulls } = harness(() => gate.promise);
    const cookie = await login(handle);
    await handle(post('/api/pull', undefined, { cookie }));

    const run = pulls.run();
    gate.resolve([ticket('JOY-1'), ticket('JOY-2')]);
    await run;

    const response = await handle(get('/api/pull/status', { cookie }));
    expect(await response.json()).toMatchObject({
      status: 'ok',
      ticketCount: 2,
      inserted: 2,
      statusChanges: 2,
    });
  });

  test('the status route reports a failure', async () => {
    const gate = deferred<HelpDeskTicket[]>();
    const { handle, pulls } = harness(() => gate.promise);
    const cookie = await login(handle);
    await handle(post('/api/pull', undefined, { cookie }));

    const run = pulls.run();
    gate.reject(new Error('HelpDesk responded 401 Unauthorized'));
    await expect(run).rejects.toThrow('HelpDesk responded 401 Unauthorized');

    const response = await handle(get('/api/pull/status', { cookie }));
    expect(await response.json()).toMatchObject({
      status: 'error',
      error: 'HelpDesk responded 401 Unauthorized',
    });
  });

  test('a second press joins the first pull', async () => {
    const gate = deferred<HelpDeskTicket[]>();
    let fetches = 0;
    const { handle, pulls } = harness(() => {
      fetches += 1;
      return gate.promise;
    });
    const cookie = await login(handle);

    const first = await handle(post('/api/pull', undefined, { cookie }));
    const second = await handle(post('/api/pull', undefined, { cookie }));
    const firstBody = (await first.json()) as { startedAt: string };
    const secondBody = (await second.json()) as { startedAt: string };
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(secondBody.startedAt).toBe(firstBody.startedAt);
    expect(fetches).toBe(1);

    const run = pulls.run();
    gate.resolve([]);
    await run;
  });

  test('?refresh=1 returns the stored board without waiting', async () => {
    const gate = deferred<HelpDeskTicket[]>();
    let fetches = 0;
    const { handle, pulls } = harness(() => {
      fetches += 1;
      return fetches === 1 ? Promise.resolve([ticket('JOY-1')]) : gate.promise;
    });
    const cookie = await login(handle);
    await pulls.run();

    const response = await handle(get('/api/tickets?refresh=1', { cookie }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ totalTickets: 1 });

    const run = pulls.run();
    gate.resolve([]);
    await run;
  });

  test('the pull response is not the board', async () => {
    const gate = deferred<HelpDeskTicket[]>();
    const { handle, pulls } = harness(() => gate.promise);
    const cookie = await login(handle);

    const response = await handle(post('/api/pull', undefined, { cookie }));
    expect(await response.json()).not.toHaveProperty('columns');

    const run = pulls.run();
    gate.resolve([]);
    await run;
  });
});

describe('board column preference routes', () => {
  test('both preference verbs require a session', async () => {
    const { handle } = harness(async () => []);
    expect((await handle(get('/api/preferences/board-columns'))).status).toBe(401);
    expect((await handle(put('/api/preferences/board-columns', { statuses: [] }))).status).toBe(
      401
    );
  });

  test('rejects a non-array and more than 20 entries', async () => {
    const { handle } = harness(async () => []);
    const cookie = await login(handle);

    expect(
      (await handle(put('/api/preferences/board-columns', { statuses: 'pending' }, { cookie })))
        .status
    ).toBe(400);
    expect(
      (
        await handle(
          put(
            '/api/preferences/board-columns',
            { statuses: Array.from({ length: 21 }, (_, index) => `status_${index}`) },
            { cookie }
          )
        )
      ).status
    ).toBe(400);
  });

  test('PUT replaces the stored set and GET reads it back', async () => {
    const { handle } = harness(async () => []);
    const cookie = await login(handle);

    const written = await handle(
      put('/api/preferences/board-columns', { statuses: ['pending'] }, { cookie })
    );
    expect(written.status).toBe(200);
    expect(await written.json()).toEqual({ statuses: ['pending'] });

    const read = await handle(get('/api/preferences/board-columns', { cookie }));
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ statuses: ['pending'] });
  });

  test('the stored set drives GET /api/tickets without a request parameter', async () => {
    const { handle, pulls } = harness(async () => [
      { ...ticket('JOY-extra'), tsStatus: 'done_for_you' },
    ]);
    const cookie = await login(handle);
    await pulls.run();

    await handle(
      put('/api/preferences/board-columns', { statuses: ['done_for_you'] }, { cookie })
    );
    const response = await handle(get('/api/tickets', { cookie }));
    const board = (await response.json()) as {
      columns: unknown[];
      extraColumns: Array<{ status: string; count: number; groups: unknown[] }>;
      otherStatuses: Array<{ status: string; count: number }>;
    };

    expect(response.status).toBe(200);
    expect(board.columns).toHaveLength(5);
    expect(board.extraColumns).toHaveLength(1);
    expect(board.extraColumns[0]).toMatchObject({ status: 'done_for_you', count: 1 });
    expect(board.otherStatuses.map((entry) => entry.status)).not.toContain('done_for_you');
  });

  test('a missing preference table still serves the default five-column board', async () => {
    const opened = openDatabase(':memory:');
    const pulls = createPullRunner(opened.db, config, async () => [ticket('JOY-default')]);
    const handle = createRouter({
      db: opened.db,
      pulls,
      tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
      auth: authConfig(),
      year: config.year,
    });
    const cookie = await login(handle);
    await pulls.run();
    opened.sqlite.exec('DROP TABLE board_column_settings');

    const response = await handle(get('/api/tickets', { cookie }));
    const board = (await response.json()) as { columns: unknown[]; extraColumns: unknown[] };
    expect(response.status).toBe(200);
    expect(board.columns).toHaveLength(5);
    expect(board.extraColumns).toEqual([]);
  });
});

describe('pull routes: what the caller sees while a pull is in flight', () => {
  test('a cold board answers without waiting for the pull it starts', async () => {
    const gate = deferred<HelpDeskTicket[]>();
    let fetches = 0;
    const { db, handle, pulls } = harness(() => {
      fetches += 1;
      return gate.promise;
    });
    const cookie = await login(handle);

    // The fetcher never settles: if this handler still awaited the pull, the
    // request would hang here and the test would time out rather than fail.
    const response = await handle(get('/api/tickets', { cookie }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ totalTickets: 0 });
    expect(fetches).toBe(1);
    expect(readLastPull(db)).toMatchObject({ status: 'running', finishedAt: null });

    const run = pulls.run();
    gate.resolve([]);
    await run;
  });

  test('the weekly report answers on a cold board without waiting', async () => {
    const gate = deferred<HelpDeskTicket[]>();
    let fetches = 0;
    const { handle, pulls } = harness(() => {
      fetches += 1;
      return gate.promise;
    });
    const cookie = await login(handle);

    const response = await handle(get('/api/report/weekly?weeks=2', { cookie }));

    expect(response.status).toBe(200);
    expect(fetches).toBe(1);

    const run = pulls.run();
    gate.resolve([]);
    await run;
  });

  test('a board that already has tickets starts no pull of its own', async () => {
    let fetches = 0;
    const { handle, pulls } = harness(async () => {
      fetches += 1;
      return [ticket('JOY-1')];
    });
    const cookie = await login(handle);
    await pulls.run();

    const response = await handle(get('/api/tickets', { cookie }));

    expect(await response.json()).toMatchObject({ totalTickets: 1 });
    expect(fetches).toBe(1);
  });

  test('the 202 reports the pull it just started, not the one before it', async () => {
    const gate = deferred<HelpDeskTicket[]>();
    let fetches = 0;
    const { db, handle, pulls } = harness(() => {
      fetches += 1;
      return fetches === 1 ? Promise.resolve([ticket('JOY-1')]) : gate.promise;
    });
    const cookie = await login(handle);
    await pulls.run();
    expect(readLastPull(db)?.status).toBe('ok');

    // Reading the pull row before starting one would answer with the settled
    // row above, so this asserts the order the route does the two things in.
    const response = await handle(post('/api/pull', undefined, { cookie }));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: 'running', finishedAt: null });
    expect(db.select().from(pullRows).all()).toHaveLength(2);

    const run = pulls.run();
    gate.resolve([]);
    await run;
  });

  test('two presses answered while one walk of the year writes one row', async () => {
    const gate = deferred<HelpDeskTicket[]>();
    let fetches = 0;
    const { db, handle, pulls } = harness(() => {
      fetches += 1;
      return gate.promise;
    });
    const cookie = await login(handle);

    const first = await handle(post('/api/pull', undefined, { cookie }));
    const second = await handle(post('/api/pull', undefined, { cookie }));

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(await first.json()).toMatchObject({ status: 'running' });
    expect(await second.json()).toMatchObject({ status: 'running' });
    expect(fetches).toBe(1);
    expect(db.select().from(pullRows).all()).toHaveLength(1);

    const run = pulls.run();
    gate.resolve([]);
    await run;
  });
});

describe('pull routes: rows with no counts recorded', () => {
  test('a row written before these counts existed serialises them as null', async () => {
    const { db, handle } = harness(async () => []);
    const cookie = await login(handle);
    db.insert(pullRows)
      .values({
        startedAt: '2026-08-01T09:00:00.000Z',
        finishedAt: '2026-08-01T09:00:45.000Z',
        ticketCount: 42,
        status: 'ok',
      })
      .run();

    const body = (await (await handle(get('/api/pull/status', { cookie }))).json()) as Record<
      string,
      unknown
    >;

    // Present-and-null, not absent: the toast decides on `!== null`, so a
    // dropped key would read as a number and print "undefined new".
    expect(Object.keys(body)).toContain('inserted');
    expect(Object.keys(body)).toContain('statusChanges');
    expect(body.inserted).toBeNull();
    expect(body.statusChanges).toBeNull();
    expect(body.ticketCount).toBe(42);
  });

  test('the board carries the same nulls on its last pull', async () => {
    const { db, handle } = harness(async () => []);
    const cookie = await login(handle);
    db.insert(pullRows)
      .values({
        startedAt: '2026-08-01T09:00:00.000Z',
        finishedAt: '2026-08-01T09:00:45.000Z',
        ticketCount: 42,
        status: 'ok',
      })
      .run();

    const board = (await (await handle(get('/api/tickets', { cookie }))).json()) as {
      lastPull: Record<string, unknown>;
    };

    expect(Object.keys(board.lastPull)).toContain('inserted');
    expect(board.lastPull.inserted).toBeNull();
    expect(board.lastPull.statusChanges).toBeNull();
  });

  test('a swept pull reads as a failure with no counts', async () => {
    const { db, handle } = harness(async () => []);
    const cookie = await login(handle);
    startPull(db);
    expect(sweepInterruptedPulls(db)).toBe(1);

    const body = (await (await handle(get('/api/pull/status', { cookie }))).json()) as Record<
      string,
      unknown
    >;

    expect(body).toMatchObject({ status: 'error', error: 'server restarted mid-pull' });
    expect(body.inserted).toBeNull();
    expect(body.statusChanges).toBeNull();
    expect(body.ticketCount).toBeNull();
    expect(body.finishedAt).not.toBeNull();
  });
});

describe('board columns: a stored row the writer never saw', () => {
  /** Seeds one open ticket per status and stores `raw` straight into the row. */
  async function boardWithStoredRow(raw: string) {
    const { db, pulls, handle } = harness(async () => [
      { ...ticket('JOY-pending'), tsStatus: 'pending' },
      { ...ticket('JOY-pending-2'), tsStatus: 'pending' },
      { ...ticket('JOY-done'), tsStatus: 'done' },
      { ...ticket('JOY-fixing'), tsStatus: 'dev_fixing' },
    ]);
    const cookie = await login(handle);
    await pulls.run();
    db.insert(boardColumnSettings)
      .values({ id: 1, statuses: raw, updatedAt: new Date().toISOString() })
      .run();

    const response = await handle(get('/api/tickets', { cookie }));
    const board = (await response.json()) as {
      openTickets: number;
      boardTickets: number;
      columns: Array<{ status: string }>;
      extraColumns: Array<{ status: string; count: number }>;
      otherStatuses: Array<{ status: string; count: number }>;
    };
    return { status: response.status, board };
  }

  test('a corrupt value still answers with the five default columns', async () => {
    const { status, board } = await boardWithStoredRow('not json');
    expect(status).toBe(200);
    expect(board.columns).toHaveLength(5);
    expect(board.extraColumns).toEqual([]);
  });

  test('a default, a duplicate and a blank entry cannot reach the board', async () => {
    const { status, board } = await boardWithStoredRow(
      JSON.stringify(['done', 'pending', 'pending', ''])
    );
    expect(status).toBe(200);
    // One bad entry discards the whole row rather than half-applying it.
    expect(board.extraColumns).toEqual([]);
    expect(board.columns).toHaveLength(5);
  });

  test('a duplicated legal entry keeps one column and the ticket-count invariant', async () => {
    const { status, board } = await boardWithStoredRow(JSON.stringify(['pending', 'pending']));
    const keys = [...board.columns, ...board.extraColumns].map((column) => column.status);

    expect(status).toBe(200);
    expect(board.extraColumns).toHaveLength(1);
    expect(board.extraColumns[0]).toMatchObject({ status: 'pending', count: 2 });
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      board.boardTickets + board.otherStatuses.reduce((sum, entry) => sum + entry.count, 0)
    ).toBe(board.openTickets);
  });

  test('a hostile property name never becomes a column', async () => {
    for (const hostile of ['__proto__', 'constructor', 'prototype']) {
      const { status, board } = await boardWithStoredRow(JSON.stringify([hostile]));
      expect(status).toBe(200);
      expect(board.extraColumns).toEqual([]);
    }
  });
});
