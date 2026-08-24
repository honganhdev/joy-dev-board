import type { Board, BoardTicket } from '@/types';

/** Lowercase + strip Vietnamese diacritics, so `diem` finds `Điểm`. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

const TICKET_ID = /JOY-\d{6}-[A-Za-z0-9]+/i;

/**
 * Turns whatever was pasted into the one string to look for.
 *
 * - A ticket URL or a bare id collapses to the id (`/t/JOY-260823-ZJaFcq`, a
 *   full HelpDesk URL, and `JOY-260823-ZJaFcq` all behave the same).
 * - A Crisp or Slack URL collapses to its longest path segment — the session or
 *   message id — so a trailing slash or an extra query string does not stop it
 *   matching the stored `chatLink` / `slackLink`.
 * - Anything else is used as typed.
 */
export function searchNeedle(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return '';

  const ticketId = trimmed.match(TICKET_ID)?.[0];
  if (ticketId) return normalize(ticketId);

  if (/^https?:\/\//i.test(trimmed)) {
    // Only the path and query can identify a conversation — the host is shared
    // by every link from the same service and must never win the "longest" pick.
    let path = trimmed;
    try {
      const parsed = new URL(trimmed);
      path = `${parsed.pathname}${parsed.search}`;
    } catch {
      path = trimmed.replace(/^https?:\/\/[^/]*/i, '');
    }

    const longest = path
      .split(/[/?#&=]/)
      .filter((segment) => segment.length >= 8)
      .sort((a, b) => b.length - a.length)[0];
    if (longest) return normalize(longest);
  }

  return normalize(trimmed);
}

function haystack(ticket: BoardTicket): string {
  return normalize(
    [
      ticket.ticketId,
      ticket.subject,
      ticket.shopName ?? '',
      ticket.domain ?? '',
      ticket.chatLink ?? '',
      ticket.slackLink ?? '',
      ticket.shortUrl ?? '',
    ].join(' ')
  );
}

export function ticketMatches(ticket: BoardTicket, needle: string): boolean {
  return !needle || haystack(ticket).includes(needle);
}

/**
 * Filters the board client-side and recomputes every count, so column and group
 * badges always describe what is on screen. Groups that lose all their tickets
 * are dropped; columns are kept so the five-column layout never collapses.
 */
export function filterBoard(board: Board, query: string): Board {
  const needle = searchNeedle(query);
  if (!needle) return board;

  const columns = board.columns.map((column) => {
    const groups = column.groups
      .map((group) => {
        const tickets = group.tickets.filter((ticket) => ticketMatches(ticket, needle));
        return { ...group, tickets, count: tickets.length };
      })
      .filter((group) => group.count > 0);

    return {
      ...column,
      groups,
      count: groups.reduce((sum, group) => sum + group.count, 0),
    };
  });

  return {
    ...board,
    columns,
    boardTickets: columns.reduce((sum, column) => sum + column.count, 0),
  };
}
