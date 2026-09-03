/**
 * The read-only guarantee, asserted as behaviour rather than by reading imports.
 *
 * Every table is snapshotted before and after the whole tool surface is
 * exercised; the debounced `lastUsedAt` write in token verification is the only
 * difference allowed. Outbound HTTP is intercepted so a HelpDesk call that is
 * not a `GET` fails the test wherever it is spelled.
 */
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { issueMcpToken } from '../src/auth/mcp-token';
import type { AuthConfig } from '../src/config';
import { openDatabase, type Db } from '../src/db/client';
import { finishPull, startPull, syncPull } from '../src/db/sync';
import type { HelpDeskTicket } from '../src/helpdesk/types';
import { createRouter } from '../src/routes';

const USERNAME = 'teammate';
const AUTH: AuthConfig = {
  users: [{ username: USERNAME, passwordHash: 'unused' }],
  sessionTtlMs: 60_000,
  cookieSecure: false,
  trustProxy: false,
};

function ticket(index: number, overrides: Partial<HelpDeskTicket> = {}): HelpDeskTicket {
  return {
    id: `internal-${index}`,
    ticketId: `JOY-260903-${String(index).padStart(6, '0')}`,
    subject: `Ticket ${index}`,
    ticketStatus: 'open',
    tsStatus: index % 2 === 0 ? 'doing' : 'done',
    createdAt: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    store: [{ shopName: `Merchant ${index}`, domain: `merchant-${index}.test` }],
    tagIds: index === 0 ? ['tag-1'] : undefined,
    ...overrides,
  };
}

function tableNames(sqlite: Database): string[] {
  return (
    sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>
  )
    .map((row) => row.name)
    .filter((name) => !name.startsWith('sqlite_'));
}

/** Full contents of every table, ordered deterministically. */
function snapshot(sqlite: Database): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const name of tableNames(sqlite)) {
    out[name] = sqlite.query(`SELECT * FROM "${name}"`).all() as unknown[];
  }
  return out;
}

function harness(ticketCount = 40, options: { probeFetch?: boolean } = {}) {
  const { db, sqlite } = openDatabase(':memory:');
  const tickets = Array.from({ length: ticketCount }, (_, index) => ticket(index));
  tickets.push(ticket(900, { ticketId: 'JOY-260903-CLOSED', ticketStatus: 'closed' }));
  const pull = startPull(db, '2026-09-03T00:00:00.000Z');
  finishPull(db, pull, syncPull(db, tickets, pull, '2026-09-03T00:01:00.000Z'));

  const handle = createRouter({
    db,
    pulls: {
      run: async () => {
        throw new Error('MCP must not start a pull');
      },
      whenIdle: async () => {},
    },
    tags: {
      get: async () => {
        // Stands in for the HelpDesk tag directory, which is a GET. Only the
        // outbound-method test wants a real call to intercept.
        if (options.probeFetch) await fetch('https://helpdesk.test/api/external/tags');
        return { value: [{ id: 'tag-1', name: 'Important', color: null }], loadedAt: '', fromCache: false };
      },
    } as never,
    auth: AUTH,
    webhookSecret: 'test-webhook-secret',
    webhooks: { process: async () => {} },
    year: 2026,
  });
  const token = issueMcpToken(db, { username: USERNAME, label: 'read-only tests' }).token;
  return { db, sqlite, handle, token };
}

async function call(
  handle: ReturnType<typeof createRouter>,
  token: string,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ payload: Record<string, unknown>; text: string; isError: boolean }> {
  const response = await handle(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })
  );
  expect(response.status).toBe(200);
  const frame = (await response.text())
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
    .at(-1)!;
  const result = frame.result as { content: Array<{ text: string }>; isError?: boolean };
  const text = result.content[0]!.text;
  // A schema refusal comes back as a plain-text tool error, not a JSON payload.
  const payload = text.startsWith('{') ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { payload, text, isError: result.isError ?? false };
}

/** Every tool, exercised on hits, misses, filters and paging. */
async function exerciseEveryTool(handle: ReturnType<typeof createRouter>, token: string) {
  await call(handle, token, 'find_ticket', { query: 'Merchant' });
  await call(handle, token, 'find_ticket', { query: 'nothing matches this' });
  await call(handle, token, 'get_ticket', { ticketId: 'JOY-260903-000000' });
  await call(handle, token, 'get_ticket', { ticketId: 'JOY-260903-CLOSED' });
  await call(handle, token, 'get_ticket', { ticketId: 'JOY-260903-MISSING' });
  await call(handle, token, 'get_ticket_history', { ticketId: 'JOY-260903-000000' });
  await call(handle, token, 'get_ticket_history', { ticketId: 'JOY-260903-MISSING' });
  await call(handle, token, 'list_open', {});
  await call(handle, token, 'list_open', { cursor: '25' });
  await call(handle, token, 'list_open', { status: 'doing', limit: 5 });
}

describe('the MCP surface writes nothing', () => {
  test('no table changes except the debounced lastUsedAt on the presented token', async () => {
    const { sqlite, handle, token } = harness();
    // Warm the debounce so the first tool call has already written lastUsedAt.
    await call(handle, token, 'list_open', { limit: 1 });

    const before = snapshot(sqlite);
    await exerciseEveryTool(handle, token);
    const after = snapshot(sqlite);

    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(after).toEqual(before);
  });

  test('the only write the surface ever makes is lastUsedAt on mcp_tokens', async () => {
    const { sqlite, handle, token } = harness();
    const before = snapshot(sqlite);
    await exerciseEveryTool(handle, token);
    const after = snapshot(sqlite);

    const changed = Object.keys(before).filter(
      (name) => JSON.stringify(before[name]) !== JSON.stringify(after[name])
    );
    expect(changed).toEqual(['mcp_tokens']);

    const [beforeRow] = before.mcp_tokens as Array<Record<string, unknown>>;
    const [afterRow] = after.mcp_tokens as Array<Record<string, unknown>>;
    const differing = Object.keys(afterRow!).filter(
      (column) => afterRow![column] !== beforeRow![column]
    );
    expect(differing).toEqual(['lastUsedAt']);
  });

  test('every HelpDesk request the tool surface causes is a GET', async () => {
    const { handle, token } = harness(40, { probeFetch: true });
    const original = globalThis.fetch;
    const methods: string[] = [];
    globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
      const method = (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      methods.push(method);
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      await exerciseEveryTool(handle, token);
    } finally {
      globalThis.fetch = original;
    }

    // get_ticket resolves tag names, which is a HelpDesk read — never a write.
    expect(methods.length).toBeGreaterThan(0);
    expect([...new Set(methods)]).toEqual(['GET']);
  });

  test('no pull row is created by any tool', async () => {
    const { sqlite, handle, token } = harness();
    const before = sqlite.query('SELECT COUNT(*) AS n FROM pulls').get() as { n: number };
    await exerciseEveryTool(handle, token);
    const after = sqlite.query('SELECT COUNT(*) AS n FROM pulls').get() as { n: number };
    expect(after.n).toBe(before.n);
    expect(after.n).toBe(1);
  });
});

describe('the MCP surface is bounded', () => {
  test('list_open cannot be asked for the whole mirror in one response', async () => {
    const { handle, token } = harness(400);
    const over = await call(handle, token, 'list_open', { limit: 1000 });
    expect(over.isError).toBe(true);
    expect(over.text).toMatch(/limit/i);

    const capped = await call(handle, token, 'list_open', { limit: 100 });
    const payload = capped.payload as { tickets: unknown[]; nextCursor: string | null };
    expect(payload.tickets).toHaveLength(100);
    expect(payload.nextCursor).toBe('100');

    const unbounded = await call(handle, token, 'list_open', {});
    expect((unbounded.payload as { tickets: unknown[] }).tickets).toHaveLength(25);
  });

  test('find_ticket cannot be asked for more than fifty matches', async () => {
    const { handle, token } = harness(400);
    const over = await call(handle, token, 'find_ticket', { query: 'Merchant', limit: 500 });
    expect(over.isError).toBe(true);

    const capped = await call(handle, token, 'find_ticket', { query: 'Merchant', limit: 50 });
    expect((capped.payload as { tickets: unknown[] }).tickets).toHaveLength(50);

    const defaulted = await call(handle, token, 'find_ticket', { query: 'Merchant' });
    expect((defaulted.payload as { tickets: unknown[] }).tickets).toHaveLength(10);
  });

  test('a negative or fractional cursor cannot walk outside the result set', async () => {
    const { handle, token } = harness(40);
    for (const cursor of ['-5', '1.5', 'abc']) {
      const response = await call(handle, token, 'list_open', { cursor });
      expect(response.isError).toBe(true);
    }
    const past = await call(handle, token, 'list_open', { cursor: '99999' });
    const payload = past.payload as { tickets: unknown[]; nextCursor: string | null };
    expect(payload.tickets).toHaveLength(0);
    expect(payload.nextCursor).toBeNull();
  });
});

describe('what find_ticket enumerates versus the board', () => {
  test('enumerates exactly the statuses the board is configured to show', async () => {
    const { db, handle, token } = (() => {
      const opened = openDatabase(':memory:');
      const tickets = [
        ticket(1, { ticketId: 'JOY-260903-KNOWN', subject: 'zebra known', tsStatus: 'doing' }),
        ticket(2, { ticketId: 'JOY-260903-EXTRA', subject: 'zebra extra', tsStatus: 'waiting_dev' }),
      ];
      const pull = startPull(opened.db, '2026-09-03T00:00:00.000Z');
      finishPull(opened.db, pull, syncPull(opened.db, tickets, pull, '2026-09-03T00:01:00.000Z'));
      const handle = createRouter({
        db: opened.db,
        pulls: { run: async () => ({ pulled: 0, inserted: 0, statusChanges: 0 }), whenIdle: async () => {} },
        tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
        auth: AUTH,
        webhookSecret: 'test-webhook-secret',
        webhooks: { process: async () => {} },
        year: 2026,
      });
      return {
        db: opened.db,
        handle,
        token: issueMcpToken(opened.db, { username: USERNAME, label: 'scope' }).token,
      };
    })();

    const { createSession } = await import('../src/auth/session-store');
    const { SESSION_COOKIE } = await import('../src/auth/cookie');
    const { writeEnabledColumns } = await import('../src/db/preferences');
    const session = createSession(db, USERNAME, 60_000);

    async function boardIds(): Promise<string[]> {
      const response = await handle(
        new Request('http://localhost/api/tickets', {
          headers: { cookie: `${SESSION_COOKIE}=${session}` },
        })
      );
      expect(response.status).toBe(200);
      const body = JSON.stringify(await response.json());
      return ['JOY-260903-KNOWN', 'JOY-260903-EXTRA'].filter((id) => body.includes(id));
    }

    async function foundIds(): Promise<string[]> {
      const found = await call(handle, token, 'find_ticket', { query: 'zebra' });
      return (found.payload as { tickets: Array<{ ticketId: string }> }).tickets
        .map((value) => value.ticketId)
        .sort();
    }

    // With no stored column preference the board does not enumerate the extra
    // status, and neither does find_ticket.
    expect(await boardIds()).toEqual(['JOY-260903-KNOWN']);
    expect(await foundIds()).toEqual(['JOY-260903-KNOWN']);

    // Enabling that column on the board adds the ticket to both corpora. The
    // board's configuration is the only thing that decides what MCP can see.
    writeEnabledColumns(db, ['waiting_dev'], 0);
    expect((await boardIds()).sort()).toEqual(['JOY-260903-EXTRA', 'JOY-260903-KNOWN']);
    expect(await foundIds()).toEqual(['JOY-260903-EXTRA', 'JOY-260903-KNOWN']);
  });
});
