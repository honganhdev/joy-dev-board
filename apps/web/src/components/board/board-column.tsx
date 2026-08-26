import { CategoryGroup } from './category-group';
import { cn } from '@/lib/utils';
import type { BoardColumn as BoardColumnData } from '@/types';

type BoardColumnProps = {
  column: BoardColumnData;
  /** Categories collapsed in this column. Absent = expanded. */
  collapsed: ReadonlySet<string>;
  onToggleCategory: (category: string, open: boolean) => void;
  onOpenTicket: (ticketId: string) => void;
  /** True when a search is active, so the empty state can say why. */
  filtered: boolean;
  /** Extra-column boards scroll horizontally and keep every lane usable. */
  useMinimumWidth: boolean;
};

/**
 * One workflow lane: a white panel with a hairline border on the near-white
 * page. The header sits outside the scroll area so the column you are reading
 * is always named, however far down its cards you have scrolled.
 */
export function BoardColumn({
  column,
  collapsed,
  onToggleCategory,
  onOpenTicket,
  filtered,
  useMinimumWidth,
}: BoardColumnProps) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-stone-200 bg-white',
        useMinimumWidth ? 'min-w-[200px]' : 'min-w-0'
      )}
    >
      <header className="flex shrink-0 items-center gap-2 px-4 py-3">
        <h2
          className="flex-1 truncate text-[13px] font-bold tracking-wide text-stone-800 uppercase"
          title={column.label}
        >
          {column.label}
        </h2>
        <span className="shrink-0 text-[11px] text-stone-400">scroll ↓</span>
        <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-stone-600">
          {column.count}
        </span>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
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
