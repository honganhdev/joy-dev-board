import { ExternalLink } from 'lucide-react';
import { categoryBadgeClass, categoryLabel } from '@/lib/category-style';
import { formatDayMonth } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { BoardTicket } from '@/types';

type TicketCardProps = {
  ticket: BoardTicket;
  onOpen: (ticketId: string) => void;
};

/**
 * One card. The whole card opens the detail view; the Crisp link stops
 * propagation so it opens the chat rather than the drawer.
 */
export function TicketCard({ ticket, onOpen }: TicketCardProps) {
  // Only about a third of tickets carry a Slack thread, and a handful carry no
  // conversation at all, so the row and its divider are driven by what exists
  // rather than by chatLink alone.
  const links = [
    { label: 'Crisp', href: ticket.chatLink },
    { label: 'Slack', href: ticket.slackLink },
  ].filter((link): link is { label: string; href: string } => Boolean(link.href));

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpen(ticket.ticketId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(ticket.ticketId);
        }
      }}
      className="cursor-pointer rounded-md border border-stone-200 bg-card px-3 py-2.5 text-left transition-colors hover:border-stone-300 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="font-mono text-[11px] tracking-tight text-muted-foreground">
        {ticket.ticketId}
      </div>

      <div className="mt-1.5">
        <span
          className={cn(
            'inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium',
            categoryBadgeClass(ticket.category)
          )}
        >
          {categoryLabel(ticket.category)}
        </span>
      </div>

      <h3 className="mt-1.5 text-[15px] leading-snug font-semibold text-foreground">
        {ticket.subject}
      </h3>

      {(ticket.shopName || ticket.domain) && (
        <p className="mt-0.5 truncate text-[13px] text-stone-600">
          {ticket.shopName ?? ticket.domain}
        </p>
      )}

      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] text-muted-foreground">
          {ticket.memberNames.join(', ') || '—'}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatDayMonth(ticket.createdAt)}
        </span>
      </div>

      {links.length > 0 && (
        <>
          <div className="mt-2 border-t border-stone-100" />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                // The card itself opens the detail view, so a link inside it has to
                // stop the click reaching the card or it would do both.
                onClick={(event) => event.stopPropagation()}
                className="inline-flex items-center gap-1 text-[11px] text-stone-500 hover:text-foreground hover:underline"
              >
                {link.label}
                <ExternalLink className="size-3" />
              </a>
            ))}
          </div>
        </>
      )}
    </article>
  );
}
