import { CategoryGroup } from './category-group';
import type { BoardColumn as BoardColumnData } from '@/types';

type BoardColumnProps = {
  column: BoardColumnData;
  /** Categories collapsed in this column. Absent = expanded. */
  collapsed: ReadonlySet<string>;
  onToggleCategory: (category: string, open: boolean) => void;
  onOpenTicket: (ticketId: string) => void;
  /** True when a search is active, so the empty state can say why. */
  filtered: boolean;
};

/**
 * One workflow lane. The header sits outside the scroll area so the column you
 * are reading is always named, however far down its cards you have scrolled.
 */
export function BoardColumn({
  column,
  collapsed,
  onToggleCategory,
  onOpenTicket,
  filtered,
}: BoardColumnProps) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-stone-300/70 bg-stone-100">
      <header className="flex shrink-0 items-center gap-2 border-b border-stone-300/70 bg-stone-200/60 px-3 py-2">
        <h2 className="flex-1 truncate text-[11px] font-bold tracking-wider text-stone-700 uppercase">
          {column.label}
        </h2>
        <span className="shrink-0 rounded-full bg-stone-700 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white">
          {column.count}
        </span>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-3">
        {column.groups.length === 0 ? (
          <p className="px-1 py-3 text-[12px] text-muted-foreground">
            {filtered ? 'No tickets match the search.' : 'No open tickets in this column.'}
          </p>
        ) : (
          column.groups.map((group) => (
            <CategoryGroup
              key={group.category}
              group={group}
              open={!collapsed.has(group.category)}
              onOpenChange={(open) => onToggleCategory(group.category, open)}
              onOpenTicket={onOpenTicket}
            />
          ))
        )}
      </div>
    </section>
  );
}
