import { classify } from './classify';
import { CATEGORIES, type Category } from './categories';
import { BOARD_COLUMNS, type Board, type BoardColumn, type BoardStatus, type BoardTicket, type TicketDetail } from './types';
import type { HelpDeskTicket } from '../helpdesk/types';

const COLUMN_STATUSES = new Set<string>(BOARD_COLUMNS.map((column) => column.status));

function isOpen(ticket: HelpDeskTicket): boolean {
  return ticket.ticketStatus === 'open';
}

function toBoardTicket(ticket: HelpDeskTicket): BoardTicket {
  const store = ticket.store?.[0];
  return {
    ticketId: ticket.ticketId,
    subject: ticket.subject?.trim() || '(no subject)',
    category: classify(ticket),
    shopName: store?.shopName?.trim() || null,
    domain: store?.domain?.trim() || ticket.storeDomains?.[0] || null,
    memberNames: (ticket.members ?? [])
      .map((member) => member?.displayName?.trim())
      .filter((name): name is string => Boolean(name)),
    createdAt: ticket.createdAt ?? null,
    chatLink: ticket.chatLink ?? null,
    slackLink: ticket.slackLink ?? null,
    shortUrl: ticket.shortUrl ?? null,
  };
}

/** Newest first inside a group. Tickets without a date sort last. */
function byCreatedAtDesc(a: BoardTicket, b: BoardTicket): number {
  if (!a.createdAt) return 1;
  if (!b.createdAt) return -1;
  return b.createdAt.localeCompare(a.createdAt);
}

function groupByCategory(tickets: BoardTicket[]) {
  const buckets = new Map<Category, BoardTicket[]>();
  for (const ticket of tickets) {
    const bucket = buckets.get(ticket.category);
    if (bucket) bucket.push(ticket);
    else buckets.set(ticket.category, [ticket]);
  }

  // Fixed category order so a column's groups never reshuffle between pulls.
  return CATEGORIES.filter((category) => buckets.has(category)).map((category) => {
    const tickets = (buckets.get(category) ?? []).sort(byCreatedAtDesc);
    return { category, count: tickets.length, tickets };
  });
}

/**
 * Builds the board payload from a raw HelpDesk pull.
 *
 * Only `ticketStatus === "open"` tickets are considered. Of those, a ticket
 * whose `tsStatus` has no column is not dropped silently — it is counted in
 * `otherStatuses`, which is how an unrecognised status becomes visible instead
 * of a crash or a missing card.
 */
export function assembleBoard(tickets: HelpDeskTicket[], pulledAt: string): Board {
  const open = tickets.filter(isOpen);

  const perStatus = new Map<BoardStatus, BoardTicket[]>();
  const otherCounts = new Map<string, number>();

  for (const ticket of open) {
    const status = ticket.tsStatus ?? '';
    if (COLUMN_STATUSES.has(status)) {
      const key = status as BoardStatus;
      const bucket = perStatus.get(key);
      if (bucket) bucket.push(toBoardTicket(ticket));
      else perStatus.set(key, [toBoardTicket(ticket)]);
    } else {
      const key = status || '(no status)';
      otherCounts.set(key, (otherCounts.get(key) ?? 0) + 1);
    }
  }

  const columns: BoardColumn[] = BOARD_COLUMNS.map(({ status, label }) => {
    const tickets = perStatus.get(status) ?? [];
    return { status, label, count: tickets.length, groups: groupByCategory(tickets) };
  });

  return {
    pulledAt,
    totalTickets: tickets.length,
    openTickets: open.length,
    boardTickets: columns.reduce((sum, column) => sum + column.count, 0),
    columns,
    otherStatuses: [...otherCounts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
  };
}

/** Finds one ticket by its HelpDesk `ticketId` and attaches its category. */
export function findTicketDetail(
  tickets: HelpDeskTicket[],
  ticketId: string
): TicketDetail | null {
  const match = tickets.find((ticket) => ticket.ticketId === ticketId);
  return match ? { ...match, category: classify(match) } : null;
}
