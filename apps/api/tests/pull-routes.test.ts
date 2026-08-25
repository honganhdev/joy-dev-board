import { describe, expect, test } from 'bun:test';
import type { AuthConfig, Config } from '../src/config';
import { openDatabase, type Db } from '../src/db/client';
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
