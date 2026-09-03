/**
 * The bearer surface must never carry the board's permissive CORS headers, on
 * any method and on every error path — a browser page on another origin must
 * not be able to read a response even if it can make the request.
 */
import { describe, expect, test } from 'bun:test';
import { issueMcpToken, MCP_AUTH_FAILURE } from '../src/auth/mcp-token';
import type { AuthConfig } from '../src/config';
import { openDatabase } from '../src/db/client';
import { createRouter } from '../src/routes';

const USERNAME = 'teammate';
const AUTH: AuthConfig = {
  users: [{ username: USERNAME, passwordHash: 'unused' }],
  sessionTtlMs: 60_000,
  cookieSecure: false,
  trustProxy: false,
};

function harness() {
  const opened = openDatabase(':memory:');
  const handle = createRouter({
    db: opened.db,
    pulls: { run: async () => ({ pulled: 0, inserted: 0, statusChanges: 0 }), whenIdle: async () => {} },
    tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
    auth: AUTH,
    webhookSecret: 'test-webhook-secret',
    webhooks: { process: async () => {} },
    year: 2026,
  });
  const token = issueMcpToken(opened.db, { username: USERNAME, label: 'cors tests' }).token;
  return { ...opened, handle, token };
}

const CORS_NAMES = [
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-allow-credentials',
] as const;

function expectNoCors(response: Response, label: string): void {
  for (const name of CORS_NAMES) {
    expect(response.headers.get(name), `${label} leaked ${name}`).toBeNull();
  }
}

function mcp(init: RequestInit & { token?: string; origin?: string; path?: string } = {}): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.origin) headers.Origin = init.origin;
  return new Request(`http://localhost${init.path ?? '/api/mcp'}`, {
    method: init.method ?? 'POST',
    headers,
    body: init.body,
  });
}

describe('/api/mcp never answers with CORS headers', () => {
  test('on every HTTP method, authenticated or not', async () => {
    const { handle, token } = harness();
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      for (const token_ of [undefined, token]) {
        const response = await handle(
          mcp({ method, token: token_, origin: 'https://evil.test' })
        );
        expect(response.status, `${method} should be refused`).toBe(405);
        expect(response.headers.get('allow')).toBe('POST');
        expectNoCors(response, `${method} (${token_ ? 'authenticated' : 'anonymous'})`);
      }
    }
  });

  test('on an unauthenticated POST', async () => {
    const { handle } = harness();
    const response = await handle(
      mcp({ body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }), origin: 'https://evil.test' })
    );
    expect(response.status).toBe(401);
    expectNoCors(response, 'unauthenticated POST');
  });

  test('on a malformed body behind a valid token', async () => {
    const { handle, token } = harness();
    for (const body of ['not json at all', '', '{"jsonrpc":"2.0"', '[]', 'null', '{"a":1}']) {
      const response = await handle(mcp({ token, body, origin: 'https://evil.test' }));
      // Whatever the transport decides the status is, the headers stay bare.
      expect(response.status).not.toBe(500);
      expectNoCors(response, `malformed body ${JSON.stringify(body)}`);
    }
  });

  test('on a well-formed request for a method the server does not have', async () => {
    const { handle, token } = harness();
    const response = await handle(
      mcp({
        token,
        origin: 'https://evil.test',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nonexistent/method', params: {} }),
      })
    );
    expectNoCors(response, 'unknown JSON-RPC method');
  });

  test('on a request that makes the handler throw', async () => {
    const opened = harness();
    const token = opened.token;
    opened.sqlite.close();
    const response = await opened.handle(
      mcp({
        token,
        origin: 'https://evil.test',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      })
    );
    expect(response.status).toBe(500);
    expectNoCors(response, 'thrown handler');
    expect(await response.json()).toEqual({
      error: 'internal_error',
      message: 'MCP request failed.',
    });
  });

  test('on a subpath, which the MCP branch owns rather than the board gate', async () => {
    const { handle, token } = harness();
    for (const path of ['/api/mcp/', '/api/mcp/x']) {
      // A POST to a subpath gets the MCP failure shape, not the board's generic
      // `unauthorized` — a client configured with a trailing slash used to be
      // sent to debug the wrong surface, with `Allow-Origin: *` on the answer.
      const anonymous = await handle(
        mcp({ path, origin: 'https://evil.test', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) })
      );
      expect(anonymous.status, `${path} anonymous POST`).toBe(401);
      expect(await anonymous.json()).toEqual({ error: 'unauthorized', message: MCP_AUTH_FAILURE });
      expectNoCors(anonymous, `${path} anonymous POST`);

      const authenticated = await handle(
        mcp({ path, token, origin: 'https://evil.test', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) })
      );
      expectNoCors(authenticated, `${path} authenticated POST`);

      // And a non-POST subpath is refused by the MCP branch, not preflighted by
      // the board's OPTIONS handler.
      for (const method of ['GET', 'OPTIONS']) {
        const refused = await handle(mcp({ path, method, origin: 'https://evil.test' }));
        expect(refused.status, `${method} ${path}`).toBe(405);
        expect(refused.headers.get('allow')).toBe('POST');
        expectNoCors(refused, `${method} ${path}`);
      }
    }
  });

  test('while the board surface keeps the CORS headers it already had', async () => {
    const { handle } = harness();
    const preflight = await handle(new Request('http://localhost/api/tickets', { method: 'OPTIONS' }));
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');

    const unauthorized = await handle(new Request('http://localhost/api/tickets'));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('access-control-allow-origin')).toBe('*');

    const notFound = await handle(new Request('http://localhost/api/nope'));
    expect(notFound.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('the two credential surfaces stay disjoint', () => {
  test('an MCP token opens no board route', async () => {
    const { handle, token } = harness();
    for (const path of ['/api/tickets', '/api/auth/me', '/api/report/weekly', '/api/health']) {
      const response = await handle(
        new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } })
      );
      // /api/health is deliberately unauthenticated; everything else must refuse.
      expect(path === '/api/health' ? 200 : 401).toBe(response.status);
    }
  });

  test('a board session cookie opens no MCP call, even a well-formed one', async () => {
    const { db, handle } = harness();
    const { createSession } = await import('../src/auth/session-store');
    const { SESSION_COOKIE } = await import('../src/auth/cookie');
    const id = createSession(db, USERNAME, 60_000);
    const request = mcp({
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    request.headers.set('cookie', `${SESSION_COOKIE}=${id}`);

    const response = await handle(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'unauthorized' });
  });
});

describe('the token lockout', () => {
  function throttledHarness(maxFailures: number) {
    const opened = openDatabase(':memory:');
    const handle = createRouter({
      db: opened.db,
      pulls: { run: async () => ({ pulled: 0, inserted: 0, statusChanges: 0 }), whenIdle: async () => {} },
      tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
      auth: AUTH,
      webhookSecret: 'test-webhook-secret',
      webhooks: { process: async () => {} },
      year: 2026,
      throttle: { maxFailures },
    });
    return { ...opened, handle };
  }

  const initialize = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
  });

  test('is not keyed on the public id, so knowing one cannot lock that token out', async () => {
    const { db, handle } = throttledHarness(3);
    const issued = issueMcpToken(db, { username: USERNAME, label: 'victim' });
    expect((await handle(mcp({ token: issued.token, body: initialize }))).status).toBe(200);

    // The public id is non-secret by design: it is printed in the server log and
    // by the revoke CLI. Spending a budget keyed on it was a denial of service
    // anyone who had read a log could aim at one person. The secret is 32 CSPRNG
    // bytes, so entropy — not a counter — is what stops guessing.
    const guess = `jbmcp_${issued.row.publicId}.${'A'.repeat(43)}`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await handle(mcp({ token: guess, body: initialize }))).status).toBe(401);
    }

    const afterAttempts = await handle(mcp({ token: issued.token, body: initialize }));
    expect(afterAttempts.status).toBe(200);
    expectNoCors(afterAttempts, 'token after failed guesses at its public id');
  });

  test('does not spill from one token onto another', async () => {
    const { db, handle } = throttledHarness(3);
    const victim = issueMcpToken(db, { username: USERNAME, label: 'victim' });
    const bystander = issueMcpToken(db, { username: USERNAME, label: 'bystander' });
    const guess = `jbmcp_${victim.row.publicId}.${'A'.repeat(43)}`;

    for (let attempt = 0; attempt < 10; attempt += 1) await handle(mcp({ token: guess, body: initialize }));

    expect((await handle(mcp({ token: victim.token, body: initialize }))).status).toBe(200);
    expect((await handle(mcp({ token: bystander.token, body: initialize }))).status).toBe(200);
  });

  test('still locks out by IP once a proxy is trusted', async () => {
    const opened = openDatabase(':memory:');
    const handle = createRouter({
      db: opened.db,
      pulls: { run: async () => ({ pulled: 0, inserted: 0, statusChanges: 0 }), whenIdle: async () => {} },
      tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
      auth: { ...AUTH, trustProxy: true },
      webhookSecret: 'test-webhook-secret',
      webhooks: { process: async () => {} },
      year: 2026,
      throttle: { maxFailures: 3 },
    });
    const issued = issueMcpToken(opened.db, { username: USERNAME, label: 'victim' });

    function from(ip: string, token: string): Request {
      const request = mcp({ token, body: initialize });
      request.headers.set('x-forwarded-for', ip);
      return request;
    }

    const guess = `jbmcp_${issued.row.publicId}.${'A'.repeat(43)}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await handle(from('203.0.113.9', guess))).status).toBe(401);
    }

    // The guessing address is locked out even with the real token in hand...
    const locked = await handle(from('203.0.113.9', issued.token));
    expect(locked.status).toBe(401);
    expectNoCors(locked, 'locked-out address');

    // ...and the owner, on their own address, is untouched by it.
    expect((await handle(from('198.51.100.4', issued.token))).status).toBe(200);
  });
});
