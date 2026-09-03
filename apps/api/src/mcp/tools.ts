import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { assembleBoard, toBoardTicket, toTicketDetail } from '../board/assemble';
import { BOARD_COLUMNS, type BoardTicket } from '../board/types';
import { searchNeedle, ticketMatches, type SearchableTicket } from '../board/search';
import type { StatusHistoryEntry } from '../db/queries';
import type { PullRow } from '../db/schema';
import type { HelpDeskTicket } from '../helpdesk/types';
import { MCP_CORPUS } from './corpus';

export type ResolvedTag = { id: string; name: string; color: string | null };

const FIXED_BOARD_STATUSES = new Set<string>(BOARD_COLUMNS.map((column) => column.status));

/** The complete capability available to tools: reads and tag resolution only. */
export type McpToolDeps = {
  readTickets: () => HelpDeskTicket[];
  readTicket: (ticketId: string) => HelpDeskTicket | null;
  readStatusHistory: (ticketId: string) => StatusHistoryEntry[];
  readLastPull: () => PullRow | null;
  readLastSuccessfulPull: () => PullRow | null;
  readLastSuccessfulWebhook: () => PullRow | null;
  countTickets: () => number;
  resolveTags: (tagIds: string[] | null | undefined) => Promise<ResolvedTag[]>;
};

type Mirror = {
  lastSuccessfulPullAt: string | null;
  lastWebhookAt: string | null;
  lastPullStatus: PullRow['status'] | null;
  ticketCount: number;
};

type MirrorTicket = BoardTicket & { status: string; ticketStatus: string | null };

type MirrorCandidate = SearchableTicket & {
  raw: HelpDeskTicket;
  createdAt: string | null;
};

function mirror(deps: McpToolDeps): Mirror {
  return {
    lastSuccessfulPullAt: deps.readLastSuccessfulPull()?.finishedAt ?? null,
    lastWebhookAt: deps.readLastSuccessfulWebhook()?.finishedAt ?? null,
    lastPullStatus: deps.readLastPull()?.status ?? null,
    ticketCount: deps.countTickets(),
  };
}

function result(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

function assembledOpen(deps: McpToolDeps): {
  tickets: MirrorTicket[];
  counts: {
    statuses: Array<{ status: string; label: string; count: number }>;
    categories: Array<{ category: string; count: number }>;
  };
} {
  const raw = deps.readTickets();
  const enabled = raw
    .filter((ticket) => ticket.ticketStatus === 'open')
    .map((ticket) => ticket.tsStatus || '(no status)')
    .filter((status) => !FIXED_BOARD_STATUSES.has(status));
  const board = assembleBoard(
    raw,
    deps.readLastSuccessfulPull()?.finishedAt ?? new Date(0).toISOString(),
    { enabled }
  );
  const columns = [...board.columns, ...board.extraColumns];
  const tickets = columns.flatMap((column) =>
    column.groups.flatMap((group) =>
      group.tickets.map((ticket) => ({
        ...ticket,
        status: column.status,
        ticketStatus: 'open',
      }))
    )
  );
  const categoryCounts = new Map<string, number>();
  for (const ticket of tickets) {
    categoryCounts.set(ticket.category, (categoryCounts.get(ticket.category) ?? 0) + 1);
  }

  return {
    tickets,
    counts: {
      statuses: columns.map((column) => ({
        status: column.status,
        label: column.label,
        count: column.count,
      })),
      categories: [...categoryCounts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    },
  };
}

function newestFirst(
  a: Pick<BoardTicket, 'createdAt' | 'ticketId'>,
  b: Pick<BoardTicket, 'createdAt' | 'ticketId'>
): number {
  if (!a.createdAt && !b.createdAt) return a.ticketId.localeCompare(b.ticketId);
  if (!a.createdAt) return 1;
  if (!b.createdAt) return -1;
  return b.createdAt.localeCompare(a.createdAt) || a.ticketId.localeCompare(b.ticketId);
}

function mirrorCandidate(ticket: HelpDeskTicket): MirrorCandidate {
  const store = ticket.store?.[0];
  return {
    raw: ticket,
    ticketId: ticket.ticketId,
    subject: ticket.subject?.trim() || '(no subject)',
    shopName: store?.shopName?.trim() || null,
    domain: store?.domain?.trim() || ticket.storeDomains?.[0] || null,
    createdAt: ticket.createdAt ?? null,
    chatLink: ticket.chatLink ?? null,
    slackLink: ticket.slackLink ?? null,
    shortUrl: ticket.shortUrl ?? null,
  };
}

function findInMirror(deps: McpToolDeps, query: string, limit: number): MirrorTicket[] {
  const needle = searchNeedle(query);
  return deps
    .readTickets()
    .map(mirrorCandidate)
    .filter((ticket) => ticketMatches(ticket, needle))
    .sort(newestFirst)
    .slice(0, limit)
    .map(({ raw }) => ({
      ...toBoardTicket(raw),
      status: raw.tsStatus || '(no status)',
      ticketStatus: raw.ticketStatus ?? null,
    }));
}

export function registerMcpTools(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    'find_ticket',
    {
      description:
        `${MCP_CORPUS} Search ticket id, subject, shop name, domain, and chat, Slack, or short links ` +
        '(not ticket body text); results are newest first.',
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true },
    },
    ({ query, limit }) => {
      return result({ mirror: mirror(deps), tickets: findInMirror(deps, query, limit) });
    }
  );

  server.registerTool(
    'get_ticket',
    {
      description:
        `${MCP_CORPUS} Read one ticket by exact id, including category and resolved tag names.`,
      inputSchema: { ticketId: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ ticketId }) => {
      const ticket = deps.readTicket(ticketId);
      if (!ticket) {
        return result(
          { mirror: mirror(deps), error: 'not_found', message: `No ticket ${ticketId}` },
          true
        );
      }
      const detail = toTicketDetail(ticket);
      return result({
        mirror: mirror(deps),
        ticket: { ...detail, tags: await deps.resolveTags(detail.tagIds) },
      });
    }
  );

  server.registerTool(
    'get_ticket_history',
    {
      description:
        `${MCP_CORPUS} Read one ticket's observed status history, oldest first. ` +
        'The first entry always has fromStatus null and records when this mirror first observed ' +
        'the ticket, not when the ticket entered that status; observation began 2026-08-24.',
      inputSchema: { ticketId: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    ({ ticketId }) => {
      if (!deps.readTicket(ticketId)) {
        return result(
          { mirror: mirror(deps), error: 'not_found', message: `No ticket ${ticketId}` },
          true
        );
      }
      return result({
        mirror: mirror(deps),
        ticketId,
        entries: deps.readStatusHistory(ticketId),
      });
    }
  );

  server.registerTool(
    'list_open',
    {
      description:
        `${MCP_CORPUS} List every open ticket, optionally filtered by workflow status or category. ` +
        'counts describes all open tickets; total describes the filtered set.',
      inputSchema: {
        status: z.string().min(1).optional(),
        category: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.string().regex(/^\d+$/).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ status, category, limit, cursor }) => {
      const assembled = assembledOpen(deps);
      const filtered = assembled.tickets
        .filter((ticket) => !status || ticket.status === status)
        .filter((ticket) => !category || ticket.category === category)
        .sort(newestFirst);
      const offset = cursor ? Number(cursor) : 0;
      const tickets = filtered.slice(offset, offset + limit);
      const nextOffset = offset + tickets.length;

      return result({
        mirror: mirror(deps),
        counts: assembled.counts,
        total: filtered.length,
        tickets,
        nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
      });
    }
  );
}
