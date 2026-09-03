import { describe, expect, spyOn, test } from 'bun:test';
import { issueMcpToken, revokeMcpToken } from '../src/auth/mcp-token';
import type { AuthConfig } from '../src/config';
import { openDatabase } from '../src/db/client';
import { createRouter } from '../src/routes';
import { SESSION_COOKIE } from '../src/auth/cookie';
import { createSession } from '../src/auth/session-store';

const USERNAME = 'boarduser';
const PASSWORD = 'correct horse battery staple';
const PASSWORD_HASH = await Bun.password.hash(PASSWORD, { algorithm: 'argon2id' });

function auth(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    users: [{ username: USERNAME, passwordHash: PASSWORD_HASH }],
    sessionTtlMs: 60_000,
    cookieSecure: false,
    trustProxy: false,
    ...overrides,
  };
}

function harness(options: { auth?: AuthConfig; maxFailures?: number } = {}) {
  const opened = openDatabase(':memory:');
  const authConfig = options.auth ?? auth();
  const handle = createRouter({
    db: opened.db,
    pulls: { run: async () => ({ pulled: 0, inserted: 0, statusChanges: 0 }), whenIdle: async () => {} },
    tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
    auth: authConfig,
    webhookSecret: 'test-webhook-secret',
    webhooks: { process: async () => {} },
    year: 2026,
    throttle: { maxFailures: options.maxFailures ?? 20 },
  });
  return { ...opened, auth: authConfig, handle };
}

function mcpRequest(token?: string, method = 'POST', forwardedFor?: string): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
  return new Request('http://localhost/api/mcp', {
    method,
    headers,
    body:
      method === 'POST'
        ? JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 'test-client', version: '1.0.0' },
            },
          })
        : undefined,
  });
}

function loginRequest(ip: string): Request {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
}

describe('/api/mcp bearer boundary', () => {
  test('missing, malformed, unknown, wrong, and revoked credentials are byte-identical', async () => {
    const { db, auth: authConfig, handle } = harness();
    const wrong = issueMcpToken(db, { username: USERNAME, label: 'wrong' });
    const revoked = issueMcpToken(db, { username: USERNAME, label: 'revoked' });
    revokeMcpToken(db, revoked.row.publicId);
    const wrongSecret = `${wrong.token.slice(0, -1)}${wrong.token.endsWith('A') ? 'B' : 'A'}`;
    const unknown = `jbmcp_AAAAAAAAAAA.${wrong.token.split('.')[1]}`;
    const requests = [
      mcpRequest(),
      mcpRequest('malformed'),
      mcpRequest(unknown),
      mcpRequest(wrongSecret),
      mcpRequest(revoked.token),
    ];

    const responses = await Promise.all(requests.map((request) => handle(request)));
    const signatures = await Promise.all(
      responses.map(async (response) => ({ status: response.status, body: await response.text() }))
    );
    expect(signatures).toEqual(Array.from({ length: 5 }, () => signatures[0]!));
    expect(signatures[0]?.status).toBe(401);
    for (const response of responses) {
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(authConfig.users).toHaveLength(1);
  });

  test('a good token reaches a fresh stateless SDK transport', async () => {
    const { db, handle } = harness();
    const issued = issueMcpToken(db, { username: USERNAME, label: 'working' });
    const first = await handle(mcpRequest(issued.token));
    const second = await handle(mcpRequest(issued.token));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get('content-type')).toContain('text/event-stream');
    expect(first.headers.get('access-control-allow-origin')).toBeNull();
    expect(await first.text()).toContain('protocolVersion');
    expect(await second.text()).toContain('protocolVersion');
  });

  test('owns every method without CORS and leaves board preflight unchanged', async () => {
    const { handle } = harness();
    for (const method of ['OPTIONS', 'GET', 'DELETE']) {
      const response = await handle(mcpRequest(undefined, method));
      expect(response.status).toBe(405);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }

    const boardPreflight = await handle(
      new Request('http://localhost/api/tickets', { method: 'OPTIONS' })
    );
    expect(boardPreflight.status).toBe(204);
    expect(boardPreflight.headers.get('access-control-allow-origin')).toBe('*');

    const boardUnauthorized = await handle(new Request('http://localhost/api/tickets'));
    expect(boardUnauthorized.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('cookie and bearer credentials cannot cross-authenticate', async () => {
    const { db, handle } = harness();
    const session = createSession(db, USERNAME, 60_000);
    const token = issueMcpToken(db, { username: USERNAME, label: 'separate' }).token;
    const cookieOnly = mcpRequest();
    cookieOnly.headers.set('cookie', `${SESSION_COOKIE}=${session}`);

    expect((await handle(cookieOnly)).status).toBe(401);
    expect(
      (
        await handle(
          new Request('http://localhost/api/tickets', {
            headers: { Authorization: `Bearer ${token}` },
          })
        )
      ).status
    ).toBe(401);
  });

  test('MCP lockout keys do not lock board login keys at the same trusted IP', async () => {
    const authConfig = auth({ trustProxy: true });
    const { db, handle } = harness({ auth: authConfig, maxFailures: 2 });
    const issued = issueMcpToken(db, { username: USERNAME, label: 'throttle' });
    const wrong = `${issued.token.slice(0, -1)}${issued.token.endsWith('A') ? 'B' : 'A'}`;
    const ip = '192.0.2.40';

    await handle(mcpRequest(wrong, 'POST', ip));
    await handle(mcpRequest(wrong, 'POST', ip));
    expect((await handle(mcpRequest(issued.token, 'POST', ip))).status).toBe(401);
    expect((await handle(loginRequest(ip))).status).toBe(200);
  });

  test('its error boundary is generic and CORS-free', async () => {
    const opened = harness();
    const issued = issueMcpToken(opened.db, { username: USERNAME, label: 'closed-db' });
    opened.sqlite.close();

    const response = await opened.handle(mcpRequest(issued.token));
    expect(response.status).toBe(500);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toEqual({
      error: 'internal_error',
      message: 'MCP request failed.',
    });
  });

  test('logs sanitized success and rejection attribution without a credential', async () => {
    const authConfig = auth({ trustProxy: true });
    const { db, handle } = harness({ auth: authConfig });
    const issued = issueMcpToken(db, { username: USERNAME, label: 'logging' });
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const warn = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await handle(mcpRequest(issued.token, 'POST', '192.0.2.50'));
      await handle(
        mcpRequest(`jbmcp_AAAAAAAAAAA.${issued.token.split('.')[1]}`, 'POST', '192.0.2.51')
      );

      const output = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
      expect(output).toContain(issued.row.publicId);
      expect(output).toContain(USERNAME);
      expect(output).toContain('192.0.2.50');
      expect(output).toContain('AAAAAAAAAAA');
      expect(output).toContain('192.0.2.51');
      expect(output).not.toContain(issued.token);
      expect(output).not.toContain(issued.token.split('.')[1]!);
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });
});
