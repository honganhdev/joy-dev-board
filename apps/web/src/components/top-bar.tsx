import { AlertTriangle, LogOut, RefreshCw, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { formatAge } from '@/lib/format';

export type BoardView = 'board' | 'report';

export type BoardStatus = {
  /** Cards on the board out of all open tickets. Rendered `N of M open`. */
  tickets: { onBoard: number; open: number };
  /** ISO. When the last successful pull finished. */
  pulledAt: string;
  /** ISO, or null until Avada has ever delivered. Null renders `waiting`. */
  webhookAt: string | null;
  /** Set only when the last pull attempt failed: the board on screen is stale. */
  lastPullError: { failedAt: string; detail: string } | null;
};

type TopBarProps = {
  /** Which of the two surfaces is on screen. */
  view: BoardView;
  onViewChange: (view: BoardView) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Optional so a surface that has no column control can leave it out. */
  columnSettings?: ReactNode;
  onPull: () => void;
  pulling: boolean;
  /** Replaces the Pull button's label while a pull is being followed. */
  pullLabel?: string;
  /** Board facts for the status strip. Null before the first load. */
  status: BoardStatus | null;
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
  status,
  warning,
  username,
  onSignOut,
}: TopBarProps) {
  const initials = username ? username.slice(0, 2).toUpperCase() : null;

  return (
    <header className="relative shrink-0">
      <a
        href="#main-content"
        className="sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:border focus:border-stone-200 focus:bg-white focus:px-3 focus:py-1.5 focus:text-[12px] focus:ring-[3px] focus:ring-ring/50 focus:not-sr-only"
      >
        Skip to content
      </a>

      <div className="flex h-11 items-center gap-4 border-b border-stone-200 bg-white px-5">
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-stone-900 text-sm font-bold text-white">
            J
          </div>
          <h1 className="text-[15px] font-bold">JOY Dev Board</h1>
        </div>

        {status ? (
          <div className="ml-auto flex items-center gap-3">
            <div className="flex flex-col justify-center gap-0.5">
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Tickets
              </span>
              <span className="text-[12px] leading-none tabular-nums">
                {status.tickets.onBoard} of {status.tickets.open} open
              </span>
            </div>
            <Separator orientation="vertical" />
            <div className="flex flex-col justify-center gap-0.5">
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Pulled
              </span>
              <span className="text-[12px] leading-none tabular-nums">
                {formatAge(status.pulledAt)}
              </span>
            </div>
            <Separator orientation="vertical" />
            <div className="flex flex-col justify-center gap-0.5">
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Webhook
              </span>
              <span className="flex items-center gap-1.5 text-[12px] leading-none tabular-nums">
                <span
                  className={`size-1.5 rounded-full ${
                    status.webhookAt === null ? 'bg-stone-400' : 'bg-emerald-500'
                  }`}
                  aria-hidden="true"
                />
                {status.webhookAt === null ? 'waiting' : formatAge(status.webhookAt)}
              </span>
            </div>
          </div>
        ) : (
          <p className="ml-auto text-[12px] text-muted-foreground">
            HelpDesk tickets for JOY Loyalty · read-only
          </p>
        )}

        <Separator orientation="vertical" />

        <div className="flex shrink-0 items-center gap-2">
          {initials !== null && (
            <>
              <div className="flex size-6 items-center justify-center rounded-full bg-stone-200 text-[10px] font-semibold">
                {initials}
              </div>
              <span className="text-[12px] text-muted-foreground" title="Signed in">
                {username}
              </span>
            </>
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
      </div>

      <div className="flex h-10 items-center gap-3 border-b border-stone-200 bg-white px-5">
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
      </div>
    </header>
  );
}
