import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { assembleBoard, toTicketDetail } from '../board/assemble';
import { BOARD_COLUMNS, type BoardTicket } from '../board/types';
import { searchNeedle, ticketMatches } from '../board/search';
import type { StatusHistoryEntry } from '../db/queries';
import type { PullRow } from '../db/schema';
import type { HelpDeskTicket } from '../helpdesk/types';

export type ResolvedTag = { id: string; name: string; color: string | null };

/** The complete capability available to tools: reads and tag resolution only. */
export type McpToolDeps = {
  readTickets: () => HelpDeskTicket[];
  readTicket: (ticketId: string) => HelpDeskTicket | null;
  readStatusHistory: (ticketId: string) => StatusHistoryEntry[];
  readLastPull: () => PullRow | null;
  readLastSuccessfulPull: () => PullRow | null;
  countTickets: () => number;
  resolveTags: (tagIds: string[] | null | undefined) => Promise<ResolvedTag[]>;
};

type Mirror = {
  lastSuccessfulPullAt: string | null;
  lastPullStatus: PullRow['status'] | null;
  ticketCount: number;
};

type OpenTicket = BoardTicket & { status: string };

function mirror(deps: McpToolDeps): Mirror {
  return {
    lastSuccessfulPullAt: deps.readLastSuccessfulPull()?.finishedAt ?? null,
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
  tickets: OpenTicket[];
  counts: {
    statuses: Array<{ status: string; label: string; count: number }>;
    categories: Array<{ category: string; count: number }>;
  };
} {
  const raw = deps.readTickets();
  const known = new Set<string>(BOARD_COLUMNS.map((column) => column.status));
  const extraStatuses = [
    ...new Set(
      raw
        .filter((ticket) => ticket.ticketStatus === 'open')
        .map((ticket) => ticket.tsStatus || '(no status)')
        .filter((status) => !known.has(status))
    ),
  ];
  const board = assembleBoard(
    raw,
    deps.readLastSuccessfulPull()?.finishedAt ?? new Date(0).toISOString(),
    { enabled: extraStatuses }
  );
  const columns = [...board.columns, ...board.extraColumns];
  const tickets = columns.flatMap((column) =>
    column.groups.flatMap((group) =>
      group.tickets.map((ticket) => ({ ...ticket, status: column.status }))
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

function newestFirst(a: OpenTicket, b: OpenTicket): number {
  if (!a.createdAt && !b.createdAt) return a.ticketId.localeCompare(b.ticketId);
  if (!a.createdAt) return 1;
  if (!b.createdAt) return -1;
  return b.createdAt.localeCompare(a.createdAt) || a.ticketId.localeCompare(b.ticketId);
}

export function registerMcpTools(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    'find_ticket',
    {
      description: 'Search open tickets using the same link, id, and text matching as the board.',
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true },
    },
    ({ query, limit }) => {
      const open = assembledOpen(deps).tickets;
      const needle = searchNeedle(query);
      const matches = open.filter((ticket) => ticketMatches(ticket, needle)).slice(0, limit);
      return result({ mirror: mirror(deps), tickets: matches });
    }
  );

  server.registerTool(
    'get_ticket',
    {
      description: 'Read one mirrored ticket by id, including category and resolved tag names.',
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
      description: 'Read the observed status history for one mirrored ticket.',
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
      description: 'List and count open tickets, optionally filtered by workflow status or category.',
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
        tickets,
        nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
      });
    }
  );
}
