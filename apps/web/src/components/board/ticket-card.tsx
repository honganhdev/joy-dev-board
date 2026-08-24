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
            'inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase',
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

      {ticket.chatLink && (
        <>
          <div className="mt-2 border-t border-stone-100" />
          <a
            href={ticket.chatLink}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-stone-500 hover:text-foreground hover:underline"
          >
            Crisp
            <ExternalLink className="size-3" />
          </a>
        </>
      )}
    </article>
  );
}
