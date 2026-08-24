import { ChevronDown, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { TicketCard } from './ticket-card';
import type { BoardGroup } from '@/types';

type CategoryGroupProps = {
  group: BoardGroup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTicket: (ticketId: string) => void;
};

/** A collapsible category row inside a column. Collapsed shows only the header. */
export function CategoryGroup({ group, open, onOpenChange, onOpenTicket }: CategoryGroupProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-stone-200/60">
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-stone-500" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-stone-500" />
        )}
        <span className="flex-1 truncate text-[11px] font-semibold tracking-wide text-stone-600 uppercase">
          {group.category}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-stone-500">{group.count}</span>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-1 flex flex-col gap-2 pb-1">
        {group.tickets.length === 0 ? (
          <p className="px-1 py-1 text-[11px] text-muted-foreground">No tickets in this group.</p>
        ) : (
          group.tickets.map((ticket) => (
            <TicketCard key={ticket.ticketId} ticket={ticket} onOpen={onOpenTicket} />
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
