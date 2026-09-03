import { describe, expect, test } from 'bun:test';
import type { AuthConfig } from '../src/config';
import { openDatabase, type Db } from '../src/db/client';
import { sessions } from '../src/db/schema';
import { createRouter } from '../src/routes';
import { readSessionCookie, SESSION_COOKIE } from '../src/auth/cookie';
import { clientIp, selectVerificationTarget } from '../src/auth/handlers';
import { createSession, touchSession } from '../src/auth/session-store';
import { eq } from 'drizzle-orm';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const USERNAME = 'boarduser';
const PASSWORD = 'correct horse battery staple';
const SECOND_USERNAME = 'teammate';
const SECOND_PASSWORD = 'another correct battery staple';

/**
 * Hashed once for the whole file: argon2id is deliberately slow, and every test
 * here logs in at least once.
 */
const PASSWORD_HASH = await Bun.password.hash(PASSWORD, { algorithm: 'argon2id' });
const SECOND_PASSWORD_HASH = await Bun.password.hash(SECOND_PASSWORD, { algorithm: 'argon2id' });

function authConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    users: [{ username: USERNAME, passwordHash: PASSWORD_HASH }],
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    cookieSecure: true,
    trustProxy: false,
    ...overrides,
  };
}

/** A router over a throwaway database. HelpDesk is never reached. */
function harness(options: { auth?: Partial<AuthConfig>; maxFailures?: number } = {}) {
  const db: Db = openDatabase(':memory:').db;
  const handle = createRouter({
    db,
    // A pull would talk to HelpDesk; every test here stops at the 401 before it.
    pulls: { run: async () => ({ pulled: 0, inserted: 0, statusChanges: 0 }), whenIdle: async () => {} },
    tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
    auth: authConfig(options.auth),
    webhookSecret: 'test-webhook-secret', webhooks: { process: async () => {} },
    year: 2026,
    throttle: { maxFailures: options.maxFailures ?? 5 },
  });
  return { db, handle };
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

function cookieHeader(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  const value = setCookie.split(';')[0] ?? '';
  return value;
}

async function login(handle: ReturnType<typeof createRouter>): Promise<string> {
  const response = await handle(post('/api/auth/login', { username: USERNAME, password: PASSWORD }));
  expect(response.status).toBe(200);
  return cookieHeader(response);
}

describe('login', () => {
  test('the right password signs in and sets an HttpOnly session cookie', async () => {
    const { handle } = harness();
    const response = await handle(
      post('/api/auth/login', { username: USERNAME, password: PASSWORD })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ username: USERNAME });

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('Path=/');
  });

  test('the cookie carries only the opaque id — never the username', async () => {
    const { handle } = harness();
    const response = await handle(
      post('/api/auth/login', { username: USERNAME, password: PASSWORD })
    );
    expect(response.headers.get('set-cookie') ?? '').not.toContain(USERNAME);
  });

  test('a wrong password is rejected and sets no cookie', async () => {
    const { handle } = harness();
    const response = await handle(post('/api/auth/login', { username: USERNAME, password: 'wrong' }));

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  test('an unknown username fails identically to a wrong password', async () => {
    const { handle } = harness();

    const unknownUser = await handle(
      post('/api/auth/login', { username: 'nobody', password: PASSWORD })
    );
    const wrongPassword = await handle(
      post('/api/auth/login', { username: USERNAME, password: 'wrong' })
    );

    expect(unknownUser.status).toBe(wrongPassword.status);
    expect(await unknownUser.json()).toEqual(await wrongPassword.json());
  });

  test('selects a real decoy hash for an unknown username', () => {
    const users = [
      { username: USERNAME, passwordHash: PASSWORD_HASH },
      { username: SECOND_USERNAME, passwordHash: SECOND_PASSWORD_HASH },
    ];

    expect(selectVerificationTarget(users, 'nobody')).toEqual({
      hash: PASSWORD_HASH,
      matched: false,
      user: null,
    });
    expect(selectVerificationTarget(users, SECOND_USERNAME)).toEqual({
      hash: SECOND_PASSWORD_HASH,
      matched: true,
      user: users[1]!,
    });
  });

  test('every configured account gets a session under its own username', async () => {
    const users = [
      { username: USERNAME, passwordHash: PASSWORD_HASH },
      { username: SECOND_USERNAME, passwordHash: SECOND_PASSWORD_HASH },
    ];
    const { db, handle } = harness({ auth: { users } });

    const first = await handle(post('/api/auth/login', { username: USERNAME, password: PASSWORD }));
    const second = await handle(
      post('/api/auth/login', { username: SECOND_USERNAME, password: SECOND_PASSWORD })
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.select().from(sessions).all().map((row) => row.username).sort()).toEqual(
      [USERNAME, SECOND_USERNAME].sort()
    );
    const me = await handle(get('/api/auth/me', { cookie: cookieHeader(second) }));
    expect(await me.json()).toEqual({ username: SECOND_USERNAME });
  });

  test('unknown usernames pay the same coarse argon2 cost as wrong passwords', async () => {
    const { handle } = harness({ maxFailures: 20 });
    const elapsed = async (username: string, password: string) => {
      const startedAt = performance.now();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await handle(post('/api/auth/login', { username, password }));
      }
      return performance.now() - startedAt;
    };

    const unknown = await elapsed('nobody', 'wrong');
    const known = await elapsed(USERNAME, 'wrong');
    expect(unknown).toBeGreaterThanOrEqual(known * 0.5);
  });

  test('logging in with another account cookie mints a new session', async () => {
    const users = [
      { username: USERNAME, passwordHash: PASSWORD_HASH },
      { username: SECOND_USERNAME, passwordHash: SECOND_PASSWORD_HASH },
    ];
    const { db, handle } = harness({ auth: { users } });
    const first = await handle(post('/api/auth/login', { username: USERNAME, password: PASSWORD }));
    const firstCookie = cookieHeader(first);
    const firstId = readSessionCookie(get('/', { cookie: firstCookie }))!;

    const second = await handle(
      post(
        '/api/auth/login',
        { username: SECOND_USERNAME, password: SECOND_PASSWORD },
        { cookie: firstCookie }
      )
    );
    const secondId = readSessionCookie(get('/', { cookie: cookieHeader(second) }))!;

    expect(secondId).not.toBe(firstId);
    expect(db.select().from(sessions).where(eq(sessions.id, firstId)).all()[0]?.username).toBe(
      USERNAME
    );
    expect(db.select().from(sessions).where(eq(sessions.id, secondId)).all()[0]?.username).toBe(
      SECOND_USERNAME
    );
  });

  test('a malformed body is rejected without a crash', async () => {
    const { handle } = harness();
    expect((await handle(post('/api/auth/login', { username: USERNAME }))).status).toBe(401);
    expect((await handle(post('/api/auth/login', 'not an object'))).status).toBe(401);
  });

  test('COOKIE_SECURE=false drops Secure so local http works', async () => {
    const { handle } = harness({ auth: { cookieSecure: false } });
    const response = await handle(
      post('/api/auth/login', { username: USERNAME, password: PASSWORD })
    );
    expect(response.headers.get('set-cookie') ?? '').not.toContain('Secure');
  });
});

describe('protected routes', () => {
  test('no cookie is a 401 on every data route', async () => {
    const { handle } = harness();

    for (const request of [
      get('/api/tickets'),
      get('/api/tickets/T-1'),
      get('/api/tickets/T-1/history'),
      get('/api/report/weekly'),
      get('/api/docs/mcp'),
      get('/api/pull/status'),
      post('/api/pull'),
    ]) {
      expect((await handle(request)).status).toBe(401);
    }
  });

  test('the weekly report answers behind the gate, not beside it', async () => {
    // The one thing about that route that can be silently wrong is its position:
    // above the gate it would publish a year of customer ticket counts to anyone.
    const { handle } = harness();
    const response = await handle(get('/api/report/weekly?weeks=12'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized', message: 'Sign in to use the board.' });
  });

  test('the MCP guide answers with typed blocks behind a valid session', async () => {
    const { handle } = harness();
    const cookie = await login(handle);
    const response = await handle(get('/api/docs/mcp', { cookie }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { blocks: Array<{ kind: string }> };
    expect(body.blocks.length).toBeGreaterThan(0);
    const kinds = new Set(['h2', 'h3', 'p', 'code', 'table']);
    expect(body.blocks.every((block) => kinds.has(block.kind))).toBe(true);
  });

  test('an unknown or tampered session id is a 401', async () => {
    const { handle } = harness();
    const cookie = await login(handle);
    const tampered = `${cookie.slice(0, -1)}${cookie.at(-1) === 'A' ? 'B' : 'A'}`;

    expect((await handle(get('/api/tickets', { cookie: `${SESSION_COOKIE}=nonsense` }))).status).toBe(401);
    expect((await handle(get('/api/tickets', { cookie: tampered }))).status).toBe(401);
  });

  test('a valid session gets through', async () => {
    const { handle } = harness();
    const cookie = await login(handle);

    const response = await handle(get('/api/tickets', { cookie }));
    expect(response.status).toBe(200);
  });

  test('an expired session is a 401 and the row is swept', async () => {
    const { db, handle } = harness();
    // Written straight to the store with a lifetime already behind it.
    const id = createSession(db, USERNAME, -1000);

    const response = await handle(get('/api/tickets', { cookie: `${SESSION_COOKIE}=${id}` }));
    expect(response.status).toBe(401);
    expect(db.select().from(sessions).where(eq(sessions.id, id)).all()).toEqual([]);
  });

  test('/api/health stays open, and carries no ticket content', async () => {
    const { handle } = harness();
    const response = await handle(get('/api/health'));

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['lastPull', 'ok', 'tickets']);
  });

  test('an unknown /api path is a 401 before it is a 404', async () => {
    const { handle } = harness();
    expect((await handle(get('/api/nope'))).status).toBe(401);
  });
});

describe('me and logout', () => {
  test('/api/auth/me is 401 anonymous and the username once signed in', async () => {
    const { handle } = harness();
    expect((await handle(get('/api/auth/me'))).status).toBe(401);

    const cookie = await login(handle);
    const response = await handle(get('/api/auth/me', { cookie }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ username: USERNAME });
  });

  test('logout deletes the session row and the same cookie stops working', async () => {
    const { db, handle } = harness();
    const cookie = await login(handle);

    const loggedOut = await handle(post('/api/auth/logout', undefined, { cookie }));
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.headers.get('set-cookie') ?? '').toContain('Max-Age=0');

    expect(db.select().from(sessions).all()).toEqual([]);
    expect((await handle(get('/api/tickets', { cookie }))).status).toBe(401);
  });

  test('logout with no cookie is still a clean 200', async () => {
    const { handle } = harness();
    expect((await handle(post('/api/auth/logout'))).status).toBe(200);
  });
});

describe('throttling', () => {
  test('repeated failures lock the client out, and the right password stays locked out', async () => {
    const { handle } = harness({ maxFailures: 3 });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await handle(post('/api/auth/login', { username: USERNAME, password: 'wrong' }))).status).toBe(401);
    }

    const locked = await handle(post('/api/auth/login', { username: USERNAME, password: PASSWORD }));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    // The lockout must not hand back a different message than a bad password.
    expect(await locked.json()).toEqual({
      error: 'invalid_credentials',
      message: 'Incorrect username or password.',
    });
  });

  test('a successful login clears the failure count', async () => {
    const { handle } = harness({ maxFailures: 3 });

    await handle(post('/api/auth/login', { username: USERNAME, password: 'wrong' }));
    await handle(post('/api/auth/login', { username: USERNAME, password: 'wrong' }));
    await login(handle);

    // Two more failures would have tripped the lockout without the reset.
    await handle(post('/api/auth/login', { username: USERNAME, password: 'wrong' }));
    await handle(post('/api/auth/login', { username: USERNAME, password: 'wrong' }));
    expect((await handle(post('/api/auth/login', { username: USERNAME, password: PASSWORD }))).status).toBe(200);
  });

  test('locking one username does not lock another person out', async () => {
    const users = [
      { username: USERNAME, passwordHash: PASSWORD_HASH },
      { username: SECOND_USERNAME, passwordHash: SECOND_PASSWORD_HASH },
    ];
    const { handle } = harness({ auth: { users, trustProxy: true }, maxFailures: 3 });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await handle(
        post(
          '/api/auth/login',
          { username: SECOND_USERNAME, password: 'wrong' },
          { 'x-forwarded-for': '192.0.2.10' }
        )
      );
      expect(response.status).toBe(401);
    }

    const firstAccount = await handle(
      post(
        '/api/auth/login',
        { username: USERNAME, password: PASSWORD },
        { 'x-forwarded-for': '192.0.2.11' }
      )
    );
    expect(firstAccount.status).toBe(200);
  });
});

describe('unusable password hash', () => {
  test('every login is refused, and no request 500s', async () => {
    const { handle } = harness({
      auth: { users: [{ username: USERNAME, passwordHash: '$argon2id$not-a-real-hash' }] },
    });
    const response = await handle(
      post('/api/auth/login', { username: USERNAME, password: PASSWORD })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'invalid_credentials',
      message: 'Incorrect username or password.',
    });
  });
});

describe('client address', () => {
  const socket = { requestIP: () => ({ address: '10.0.0.1' }) };

  test('X-Forwarded-For is ignored unless TRUST_PROXY is on', () => {
    const request = get('/', { 'x-forwarded-for': '1.2.3.4' });
    expect(clientIp(request, socket, false)).toBe('10.0.0.1');
    expect(clientIp(request, socket, true)).toBe('1.2.3.4');
  });

  test('trusting the proxy takes the first hop, not the last', () => {
    const request = get('/', { 'x-forwarded-for': '1.2.3.4, 10.0.0.9' });
    expect(clientIp(request, socket, true)).toBe('1.2.3.4');
  });

  test('no socket and no trusted header still yields a usable bucket key', () => {
    expect(clientIp(get('/'), null, true)).toBe('unknown');
  });
});

describe('session store', () => {
  test('ids are 256-bit and never repeat', async () => {
    const { db } = harness();
    const ids = new Set(Array.from({ length: 50 }, () => createSession(db, USERNAME, 60_000)));

    expect(ids.size).toBe(50);
    for (const id of ids) expect(Buffer.from(id, 'base64url').length).toBe(32);
  });

  test('use slides the expiry forward', () => {
    const { db } = harness();
    const start = new Date('2026-08-24T00:00:00.000Z');
    const id = createSession(db, USERNAME, 60_000, start);

    const later = new Date(start.getTime() + 30_000);
    const touched = touchSession(db, id, 60_000, later);

    expect(touched?.expiresAt).toBe(new Date(later.getTime() + 60_000).toISOString());
  });

  test('a session survives reopening the database', () => {
    // `:memory:` cannot show this — the whole point is that the row is on disk.
    const path = join(tmpdir(), `board-auth-test-${crypto.randomUUID()}.db`);
    try {
      const first = openDatabase(path).db;
      const id = createSession(first, USERNAME, 60_000);

      // A new handle on the same file is what an API restart amounts to.
      const second = openDatabase(path).db;
      expect(touchSession(second, id, 60_000)?.username).toBe(USERNAME);
    } finally {
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
    }
  });
});

describe('cookie parsing', () => {
  test('picks its own cookie out of a crowded header', () => {
    const request = get('/', { cookie: `other=1; ${SESSION_COOKIE}=abc123; another=2` });
    expect(readSessionCookie(request)).toBe('abc123');
  });

  test('absent, empty, and near-miss names all read as no session', () => {
    expect(readSessionCookie(get('/'))).toBeNull();
    expect(readSessionCookie(get('/', { cookie: `${SESSION_COOKIE}=` }))).toBeNull();
    expect(readSessionCookie(get('/', { cookie: `not_${SESSION_COOKIE}=abc` }))).toBeNull();
  });

  test('a malformed escape is no session rather than a thrown request', async () => {
    // A lone `%` makes decodeURIComponent throw; that must not become a 500.
    expect(readSessionCookie(get('/', { cookie: `${SESSION_COOKIE}=%` }))).toBeNull();

    const { handle } = harness();
    expect((await handle(get('/api/tickets', { cookie: `${SESSION_COOKIE}=%zz` }))).status).toBe(401);
  });
});
