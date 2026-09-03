import type { BoardTicket } from './types';

export type SearchableTicket = Pick<
  BoardTicket,
  'ticketId' | 'subject' | 'shopName' | 'domain' | 'chatLink' | 'slackLink' | 'shortUrl'
>;

/**
 * Duplicated from `apps/web/src/lib/search.ts` because the API and web app do
 * not share a package. `apps/web/tests/search-parity.test.ts` keeps both copies
 * in step; extract them if a third consumer appears.
 */

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

/** Reduces a pasted ticket or conversation link to the identifying text. */
export function searchNeedle(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return '';

  const ticketId = trimmed.match(TICKET_ID)?.[0];
  if (ticketId) return normalize(ticketId);

  if (/^https?:\/\//i.test(trimmed)) {
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

function haystack(ticket: SearchableTicket): string {
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

export function ticketMatches(ticket: SearchableTicket, needle: string): boolean {
  return !needle || haystack(ticket).includes(needle);
}
