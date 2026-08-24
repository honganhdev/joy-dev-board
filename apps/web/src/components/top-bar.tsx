import { AlertTriangle, LogOut, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type TopBarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  onPull: () => void;
  pulling: boolean;
  subtitle: string;
  /** Set when the board is being served from storage after a failed pull. */
  warning?: { label: string; detail: string } | null;
  /** Who the current session belongs to. */
  username: string | null;
  onSignOut: () => void;
};

export function TopBar({
  query,
  onQueryChange,
  onPull,
  pulling,
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
        Pull HelpDesk
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
