import { AlertTriangle, LogOut, RefreshCw, Search } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatAge } from '@/lib/format';

export type BoardView = 'board' | 'report' | 'docs';

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
  /** Which surface is on screen. */
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
  /** Who the current session belongs to. */
  username: string | null;
  onSignOut: () => void;
};

/**
 * The instant a timestamp names, or null when it names nothing yet. `formatAge`
 * says the literal `never` for a missing or unparseable value, and the API
 * falls back to the epoch when no pull has ever been recorded — both mean the
 * same thing to a reader, and neither belongs in the bar as text.
 */
function instantOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) || at === 0 ? null : at;
}

const VIEWS: Array<{ value: BoardView; label: string }> = [
  { value: 'board', label: 'Board' },
  { value: 'report', label: 'Report' },
  { value: 'docs', label: 'Docs' },
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
  username,
  onSignOut,
}: TopBarProps) {
  const initials = username ? username.slice(0, 2).toUpperCase() : null;
  const searchRef = useRef<HTMLInputElement>(null);

  // The ages below are computed while rendering, so without a clock of their
  // own they keep reporting how old the data was when the board last loaded.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (view !== 'board') return;

    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      // A layer that holds the focus holds the keyboard with it: pulling focus
      // to the search field from inside the ticket dialog or the Columns
      // popover dismisses the layer the reader was working in.
      if (
        target instanceof HTMLElement &&
        target.closest('[role="dialog"], [data-radix-popper-content-wrapper]')
      ) {
        return;
      }

      event.preventDefault();
      searchRef.current?.focus();
    };

    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, [view]);

  // A pull the API could not date is a pull that has not happened: the epoch
  // sentinel it falls back to would otherwise read as a confident `20692d 5h ago`.
  const pulledAge =
    instantOf(status?.pulledAt) === null ? 'not yet' : formatAge(status?.pulledAt, now);
  const delivered = instantOf(status?.webhookAt) !== null;

  return (
    <header className="relative shrink-0">
      <a
        href="#main-content"
        className="sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:border focus:border-stone-200 focus:bg-white focus:px-3 focus:py-1.5 focus:text-[12px] focus:ring-[3px] focus:ring-ring/50 focus:not-sr-only"
      >
        Skip to content
      </a>

      <div className="flex h-12 items-center gap-4 border-b border-stone-100 bg-stone-50 px-5">
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-stone-900 text-sm font-bold text-white">
            J
          </div>
          <h1 className="text-[15px] font-bold">JOY Dev Board</h1>
        </div>

        {status ? (
          <div className="ml-auto flex items-center gap-3">
            <div className="flex flex-col justify-center gap-0.5">
              <span className="text-[10px] font-semibold tracking-wider whitespace-nowrap text-muted-foreground uppercase">
                JOY Loyalty tickets
              </span>
              <span className="text-[12px] leading-none tabular-nums">
                {status.tickets.onBoard} of {status.tickets.open} open
              </span>
            </div>
            <Separator orientation="vertical" />
            <div
              role="status"
              className={`flex flex-col justify-center gap-0.5 ${
                status.lastPullError ? 'text-amber-900' : ''
              }`}
            >
              <span className="text-[10px] font-semibold tracking-wider whitespace-nowrap text-muted-foreground uppercase">
                Pulled
              </span>
              {status.lastPullError ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-sm text-[12px] leading-none whitespace-nowrap tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <AlertTriangle className="size-3.5 shrink-0" />
                      {pulledAge} · retry failed {formatAge(status.lastPullError.failedAt, now)}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{status.lastPullError.detail}</TooltipContent>
                </Tooltip>
              ) : (
                <span className="text-[12px] leading-none whitespace-nowrap tabular-nums">
                  {pulledAge}
                </span>
              )}
            </div>
            <Separator orientation="vertical" />
            <div className="flex flex-col justify-center gap-0.5">
              <span className="text-[10px] font-semibold tracking-wider whitespace-nowrap text-muted-foreground uppercase">
                Webhook
              </span>
              <span className="flex items-center gap-1.5 text-[12px] leading-none whitespace-nowrap tabular-nums">
                <span
                  className={`size-1.5 rounded-full ${
                    delivered ? 'bg-emerald-500' : 'bg-stone-400'
                  }`}
                  aria-hidden="true"
                />
                {delivered ? formatAge(status.webhookAt, now) : 'waiting'}
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

      <div className="flex h-12 items-center gap-6 border-b border-stone-200 bg-white px-5">
        <ToggleGroup
          type="single"
          value={view}
          aria-label="View"
          className="shrink-0"
          onValueChange={(value) => {
            if (value) onViewChange(value as BoardView);
          }}
        >
          {VIEWS.map((entry) => (
            <ToggleGroupItem
              key={entry.value}
              value={entry.value}
              className="rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[12px] text-stone-700 hover:border-stone-300 data-[state=on]:border-stone-800 data-[state=on]:bg-stone-800 data-[state=on]:font-semibold data-[state=on]:text-white"
            >
              {entry.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {/* The search filters board cards, so it is meaningless on the report. */}
        {view === 'board' && (
          // 672px: closes the middle span at 1024–1280 and cuts it ~28% at 1920; wider would make the field a paragraph.
          <div className="relative min-w-0 flex-1 max-w-2xl">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Paste ticket URL, ID, Slack or Crisp…"
              aria-label="Search tickets"
              className="h-9 bg-stone-50 pl-9"
            />
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          {view === 'board' && columnSettings}

          <Button size="sm" className="shrink-0" onClick={onPull} disabled={pulling}>
            <RefreshCw className={pulling ? 'animate-spin' : undefined} />
            {pullLabel ?? 'Pull HelpDesk'}
          </Button>
        </div>
      </div>
    </header>
  );
}
