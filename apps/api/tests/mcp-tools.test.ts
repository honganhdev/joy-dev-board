import { describe, expect, test } from 'bun:test';
import { issueMcpToken } from '../src/auth/mcp-token';
import type { AuthConfig } from '../src/config';
import { openDatabase } from '../src/db/client';
import { writeEnabledColumns } from '../src/db/preferences';
import { readLastSuccessfulPull } from '../src/db/queries';
import { pulls } from '../src/db/schema';
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
    subject: `Unclassified ticket ${index}`,
    ticketStatus: 'open',
    tsStatus: index % 2 === 0 ? 'doing' : 'done',
    createdAt: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    store: [{ shopName: `Merchant ${index}`, domain: `merchant-${index}.test` }],
    ...overrides,
  };
}

function harness(options: { tagsFail?: boolean } = {}) {
  const { db } = openDatabase(':memory:');
  const tickets = Array.from({ length: 30 }, (_, index) => ticket(index));
  tickets.push(
    ticket(100, {
      ticketId: 'JOY-260903-OPENMATCH',
      subject: 'Điểm thưởng special search',
      tsStatus: 'custom_status',
      tagIds: ['tag-1', 'missing-tag'],
    }),
    ticket(101, {
      ticketId: 'JOY-260903-CLOSEDMATCH',
      subject: 'Điểm thưởng closed search',
      ticketStatus: 'closed',
    })
  );
  const firstPull = startPull(db, '2026-09-03T00:00:00.000Z');
  finishPull(db, firstPull, syncPull(db, tickets, firstPull, '2026-09-03T00:01:00.000Z'));

  const moved = tickets.map((value) =>
    value.ticketId === 'JOY-260903-OPENMATCH' ? { ...value, tsStatus: 'custom_status_2' } : value
  );
  const secondPull = startPull(db, '2026-09-03T00:02:00.000Z');
  finishPull(db, secondPull, syncPull(db, moved, secondPull, '2026-09-03T00:03:00.000Z'));

  // The tools enumerate exactly the columns the board is configured to show, so
  // the extra status OPENMATCH sits in has to be one of them for these tests to
  // be about search and paging rather than about column configuration.
  writeEnabledColumns(db, ['custom_status_2'], 0);

  let pullRuns = 0;
  const handle = createRouter({
    db,
    pulls: {
      run: async () => {
        pullRuns += 1;
        throw new Error('MCP must not start a pull');
      },
      whenIdle: async () => {},
    },
    tags: {
      get: async () => {
        if (options.tagsFail) throw new Error('tag directory unavailable');
        return {
          value: [{ id: 'tag-1', name: 'Important', color: '#123456' }],
          loadedAt: '',
          fromCache: false,
        };
      },
    } as never,
    auth: AUTH,
    webhookSecret: 'test-webhook-secret',
    webhooks: { process: async () => {} },
    year: 2026,
  });
  const token = issueMcpToken(db, { username: USERNAME, label: 'tool tests' }).token;
  return { db, handle, token, pullRuns: () => pullRuns };
}

async function rpc(
  handle: ReturnType<typeof createRouter>,
  token: string,
  method: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const response = await handle(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
    })
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const frames = (await response.text())
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
  return frames.at(-1)!;
}

async function call(
  h: ReturnType<typeof harness>,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const envelope = await rpc(h.handle, h.token, 'tools/call', { name, arguments: args });
  const result = envelope.result as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  return {
    payload: JSON.parse(result.content[0]!.text) as Record<string, unknown>,
    isError: result.isError ?? false,
  };
}

describe('MCP tools', () => {
  test('lists exactly the four read-only tools', async () => {
    const h = harness();
    const envelope = await rpc(h.handle, h.token, 'tools/list');
    const tools = (
      envelope.result as {
        tools: Array<{
          name: string;
          description?: string;
          inputSchema: { type: string; properties?: Record<string, unknown> };
        }>;
      }
    ).tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      ['find_ticket', 'get_ticket', 'get_ticket_history', 'list_open'].sort()
    );
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe('object');
      expect(Object.keys(tool.inputSchema.properties ?? {}).length).toBeGreaterThan(0);
    }
  });

  test('find_ticket searches open tickets only, including the extra statuses the board shows', async () => {
    const h = harness();
    const found = await call(h, 'find_ticket', { query: 'diem thuong', limit: 10 });
    const tickets = (found.payload as { tickets: Array<{ ticketId: string }> }).tickets;

    expect(tickets.map((value) => value.ticketId)).toEqual(['JOY-260903-OPENMATCH']);
    expect(tickets.map((value) => value.ticketId)).not.toContain('JOY-260903-CLOSEDMATCH');
  });

  test('find_ticket honours its result limit', async () => {
    const h = harness();
    const found = await call(h, 'find_ticket', { query: 'Merchant', limit: 2 });
    expect((found.payload as { tickets: unknown[] }).tickets).toHaveLength(2);
  });

  test('get_ticket returns detail and resolved tag names', async () => {
    const h = harness();
    const read = await call(h, 'get_ticket', { ticketId: 'JOY-260903-OPENMATCH' });
    const detail = read.payload as {
      ticket: { ticketId: string; tags: Array<{ id: string; name: string; color: string | null }> };
    };

    expect(detail.ticket.ticketId).toBe('JOY-260903-OPENMATCH');
    expect(detail.ticket.tags).toEqual([
      { id: 'tag-1', name: 'Important', color: '#123456' },
      { id: 'missing-tag', name: 'missing-tag', color: null },
    ]);
  });

  test('get_ticket can still read a closed ticket by exact id', async () => {
    const h = harness();
    const read = await call(h, 'get_ticket', { ticketId: 'JOY-260903-CLOSEDMATCH' });
    expect((read.payload as { ticket: { ticketStatus: string } }).ticket.ticketStatus).toBe(
      'closed'
    );
  });

  test('tag directory failures degrade to raw ids', async () => {
    const h = harness({ tagsFail: true });
    const read = await call(h, 'get_ticket', { ticketId: 'JOY-260903-OPENMATCH' });
    const tags = (read.payload as { ticket: { tags: Array<{ id: string; name: string }> } }).ticket.tags;
    expect(tags.map((tag) => tag.name)).toEqual(['tag-1', 'missing-tag']);
  });

  test('history distinguishes an unknown ticket from an empty history', async () => {
    const h = harness();
    const known = await call(h, 'get_ticket_history', { ticketId: 'JOY-260903-OPENMATCH' });
    const missing = await call(h, 'get_ticket_history', { ticketId: 'JOY-260903-NOTFOUND' });

    expect((known.payload as { entries: unknown[] }).entries).toHaveLength(2);
    expect(missing.isError).toBe(true);
    expect(missing.payload).toMatchObject({ error: 'not_found' });
  });

  test('list_open pages tickets while keeping complete counts', async () => {
    const h = harness();
    const first = await call(h, 'list_open', {});
    const firstPayload = first.payload as {
      tickets: unknown[];
      counts: unknown;
      nextCursor: string;
    };
    const second = await call(h, 'list_open', { cursor: firstPayload.nextCursor });
    const secondPayload = second.payload as { tickets: unknown[]; counts: unknown };

    expect(firstPayload.tickets).toHaveLength(25);
    expect(secondPayload.tickets).toHaveLength(6);
    expect(secondPayload.counts).toEqual(firstPayload.counts);
  });

  test('list_open filters status and category without changing complete counts', async () => {
    const h = harness();
    const all = await call(h, 'list_open', { limit: 100 });
    const allPayload = all.payload as {
      tickets: Array<{ status: string; category: string }>;
      counts: unknown;
    };
    const category = allPayload.tickets[0]!.category;
    const filtered = await call(h, 'list_open', { status: 'doing', category, limit: 100 });
    const filteredPayload = filtered.payload as {
      tickets: Array<{ status: string; category: string }>;
      counts: unknown;
    };

    expect(filteredPayload.tickets.every((value) => value.status === 'doing')).toBe(true);
    expect(filteredPayload.tickets.every((value) => value.category === category)).toBe(true);
    expect(filteredPayload.counts).toEqual(allPayload.counts);
  });

  test('freshness is stamped on every success and error and no pull starts', async () => {
    const h = harness();
    const expected = readLastSuccessfulPull(h.db)?.finishedAt;
    const responses = [
      await call(h, 'find_ticket', { query: 'Merchant 1' }),
      await call(h, 'get_ticket', { ticketId: 'JOY-260903-000001' }),
      await call(h, 'get_ticket_history', { ticketId: 'JOY-260903-NOTFOUND' }),
      await call(h, 'list_open', { limit: 1 }),
    ];

    for (const response of responses) {
      expect(response.payload).toMatchObject({
        mirror: { lastSuccessfulPullAt: expected, lastPullStatus: 'ok', ticketCount: 32 },
      });
    }
    expect(h.pullRuns()).toBe(0);
    expect(h.db.select().from(pulls).all()).toHaveLength(2);
  });
});
