import { AlertTriangle, LogOut, RefreshCw, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type BoardView = 'board' | 'report';

type TopBarProps = {
  /** Which of the two surfaces is on screen. */
  view: BoardView;
  onViewChange: (view: BoardView) => void;
  query: string;
  onQueryChange: (query: string) => void;
  columnSettings: ReactNode;
  onPull: () => void;
  pulling: boolean;
  /** Replaces the Pull button's label while a pull is being followed. */
  pullLabel?: string;
  subtitle: string;
  /** Set when the board is being served from storage after a failed pull. */
  warning?: { label: string; detail: string } | null;
  /** Who the current session belongs to. */
  username: string | null;
  onSignOut: () => void;
};

const VIEWS: Array<{ value: BoardView; label: string }> = [
  { value: 'board', label: 'Board' },
  { value: 'report', label: 'Report' },
];

export function TopBar({
  view,
  onViewChange,
  query,
  onQueryChange,
  columnSettings,
  onPull,
  pulling,
  pullLabel,
  subtitle,
  warning,
  username,
  onSignOut,
}: TopBarProps) {
  return (
    <header className="flex h-[72px] shrink-0 items-center gap-6 border-b border-stone-200 bg-white px-5">
      <div className="flex shrink-0 items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-stone-900 text-sm font-bold text-white">
          J
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-bold">JOY Dev Board</div>
          <div className="text-[11px] text-muted-foreground">{subtitle}</div>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="View"
        className="flex shrink-0 items-center gap-0.5 rounded-md border border-stone-200 bg-stone-50 p-0.5"
      >
        {VIEWS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={view === entry.value}
            onClick={() => onViewChange(entry.value)}
            className={
              view === entry.value
                ? 'rounded-[5px] bg-white px-3 py-1 text-[12px] font-semibold text-stone-900 shadow-none'
                : 'rounded-[5px] px-3 py-1 text-[12px] text-muted-foreground hover:text-stone-900'
            }
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* The search filters board cards, so it is meaningless on the report. */}
      {view === 'board' ? (
        <div className="relative mx-auto w-full max-w-xl">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Paste ticket URL, ID, Slack or Crisp…"
            aria-label="Search tickets"
            className="h-9 bg-stone-50 pl-9"
          />
        </div>
      ) : (
        <div className="mx-auto" />
      )}

      {view === 'board' && columnSettings}

      {warning && (
        <div
          title={warning.detail}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900"
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          {warning.label}
        </div>
      )}

      <Button size="sm" className="shrink-0" onClick={onPull} disabled={pulling}>
        <RefreshCw className={pulling ? 'animate-spin' : undefined} />
        {pullLabel ?? 'Pull HelpDesk'}
      </Button>

      <div className="flex shrink-0 items-center gap-2 border-l border-stone-200 pl-4">
        {username && (
          <span className="text-[12px] text-muted-foreground" title="Signed in">
            {username}
          </span>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onSignOut}
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut />
        </Button>
      </div>
    </header>
  );
}
