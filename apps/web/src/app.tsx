import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BoardColumn } from '@/components/board/board-column';
import { ColumnSettings } from '@/components/board/column-settings';
import { BoardError, BoardSkeleton } from '@/components/board/board-states';
import { LoginScreen } from '@/components/login-screen';
import { ReportView } from '@/components/report/report-view';
import { TicketDetailDialog } from '@/components/ticket-detail-dialog';
import { TopBar, type BoardView } from '@/components/top-bar';
import { Toaster } from '@/components/ui/sonner';
import { useAuth } from '@/hooks/use-auth';
import { useBoard } from '@/hooks/use-board';
import { useColumnSettings } from '@/hooks/use-column-settings';
import { useTicketDetail } from '@/hooks/use-ticket-detail';
import { formatAge } from '@/lib/format';
import { filterBoard } from '@/lib/search';
import { cn } from '@/lib/utils';
import type { PullSummary } from '@/types';

/** Collapsed categories, keyed by column. Lives as long as the page does. */
type CollapsedState = Map<string, ReadonlySet<string>>;

const EMPTY_COLLAPSED: ReadonlySet<string> = new Set();

/**
 * The board itself. Mounted only once there is a session, so none of its
 * requests ever fire while signed out — a signed-out visitor gets the login
 * screen, not a board that 401s its way to an error state.
 */
function BoardApp({ username, onSignOut }: { username: string | null; onSignOut: () => void }) {
  const detail = useTicketDetail();
  const [view, setView] = useState<BoardView>('board');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<CollapsedState>(() => new Map());
  // Bumped by a finished pull. The board re-reads itself; the report is mounted
  // elsewhere and needs telling that its numbers just aged.
  const [pullToken, setPullToken] = useState(0);

  // How a finished pull is reported, whoever started it: the button, or a page
  // load that found one already running.
  const reportPull = useCallback((settled: PullSummary | null) => {
    if (settled?.status === 'ok') {
      setPullToken((token) => token + 1);
      if (settled.inserted !== null && settled.statusChanges !== null) {
        toast.success(
          `Pulled ${settled.ticketCount} tickets · ${settled.inserted} new · ${settled.statusChanges} status ${settled.statusChanges === 1 ? 'change' : 'changes'}.`
        );
      } else {
        toast.success(`Pulled ${settled.ticketCount} tickets.`);
      }
    } else if (settled?.status === 'running') {
      toast.message('Pull still running — reload to check.');
    } else {
      toast.error(settled?.error ?? 'Pull failed.');
    }
  }, []);

  const { board, loading, pulling, error, reload, applyBoard, pull } = useBoard(reportPull);

  const enabledColumns = useMemo(
    () => board?.extraColumns.map((column) => column.status) ?? [],
    [board]
  );
  const columnSettings = useColumnSettings({
    enabled: enabledColumns,
    version: board?.columnVersion ?? 0,
    applyBoard,
  });

  const filtered = useMemo(() => (board ? filterBoard(board, query) : null), [board, query]);

  const toggleCategory = useCallback((columnStatus: string, category: string, open: boolean) => {
    setCollapsed((current) => {
      const nextCollapsed = new Map(current);
      const next = new Set(current.get(columnStatus) ?? []);
      if (open) next.delete(category);
      else next.add(category);
      nextCollapsed.set(columnStatus, next);
      return nextCollapsed;
    });
  }, []);

  const handlePull = useCallback(async () => {
    try {
      reportPull(await pull());
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Pull failed.');
    }
  }, [pull, reportPull]);

  const boardSubtitle = board
    ? `${board.boardTickets} of ${board.openTickets} open JOY Loyalty tickets · pulled ${formatAge(board.pulledAt)} · webhook ${formatAge(board.webhookAt)}`
    : 'HelpDesk tickets for JOY Loyalty · read-only';

  const subtitle =
    view === 'report'
      ? board
        ? `Weekly issue report · as of pulled ${formatAge(board.pulledAt)}`
        : 'Weekly issue report for JOY Loyalty'
      : boardSubtitle;

  // The board is served from the API's database, so a failed pull leaves real
  // tickets on screen. Say how old they are instead of pretending they are fresh.
  const warning =
    board && board.lastPull?.status === 'error'
      ? {
          label: `Stale · HelpDesk pull failed ${formatAge(board.lastPull.finishedAt ?? board.lastPull.startedAt)}`,
          detail: board.lastPull.error ?? 'The last pull did not finish.',
        }
      : null;

  // The report scrolls in here, so focusing a week from its trend chart has to
  // scroll this element: the panels that change sit above it, off-screen.
  const reportScroll = useRef<HTMLDivElement>(null);

  const searching = query.trim().length > 0;
  const hasExtraColumns = Boolean(filtered?.extraColumns.length);

  return (
    <div className="flex h-screen flex-col bg-background">
      <TopBar
        view={view}
        onViewChange={setView}
        query={query}
        onQueryChange={setQuery}
        columnSettings={
          <ColumnSettings
            board={board}
            selected={columnSettings.selected}
            busy={columnSettings.busy}
            announcement={columnSettings.announcement}
            onToggle={columnSettings.toggle}
          />
        }
        onPull={handlePull}
        pulling={pulling}
        pullLabel={pulling ? 'Pulling…' : undefined}
        subtitle={subtitle}
        warning={warning}
        username={username}
        onSignOut={onSignOut}
      />

      <main className="min-h-0 flex-1 px-4 py-4">
        {/* The board scrolls inside its columns; the report is one long page and
            needs a scroll container of its own or everything below the first
            panels is unreachable at any window size. */}
        {view === 'report' ? (
          <div ref={reportScroll} className="h-full overflow-y-auto">
            <ReportView pullToken={pullToken} scrollRef={reportScroll} />
          </div>
        ) : (
          <>
            {loading && <BoardSkeleton />}

            {!loading && error && (
              <BoardError message={error} onRetry={reload} retrying={pulling} />
            )}

            {!loading && !error && filtered && (
              <>
                {searching && filtered.boardTickets === 0 && (
                  <p className="mb-3 text-[13px] text-muted-foreground">
                    Nothing matches “{query.trim()}”.
                  </p>
                )}
                <div
                  className={cn(
                    'flex h-full min-h-0 gap-4',
                    hasExtraColumns && 'overflow-x-auto'
                  )}
                  tabIndex={hasExtraColumns ? 0 : undefined}
                  role={hasExtraColumns ? 'group' : undefined}
                  aria-label={hasExtraColumns ? 'Board columns, horizontally scrollable' : undefined}
                >
                  {[...filtered.columns, ...filtered.extraColumns].map((column) => (
                    <BoardColumn
                      key={column.status}
                      column={column}
                      collapsed={collapsed.get(column.status) ?? EMPTY_COLLAPSED}
                      onToggleCategory={(category, open) =>
                        toggleCategory(column.status, category, open)
                      }
                      onOpenTicket={detail.open}
                      filtered={searching}
                      useMinimumWidth={hasExtraColumns}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>

      {view === 'board' && board && board.otherStatuses.length > 0 && (
        <footer className="shrink-0 border-t border-stone-200 bg-white px-5 py-2 text-[11px] leading-relaxed break-words text-muted-foreground">
          Not on the board:{' '}
          {board.otherStatuses.map((entry) => `${entry.status} (${entry.count})`).join(' · ')}
          {' — turn these on in Columns.'}
        </footer>
      )}

      <TicketDetailDialog
        ticketId={detail.ticketId}
        detail={detail.detail}
        history={detail.history}
        loading={detail.loading}
        error={detail.error}
        onClose={detail.close}
        onRestoreFocus={detail.restoreFocus}
      />

      <Toaster position="top-center" />
    </div>
  );
}

/**
 * Authentication gate. Three states, and `checking` is not cosmetic: without it
 * a reload with a perfectly good cookie would flash the login form before the
 * session check came back.
 */
export function App() {
  const { status, username, submitting, error, signIn, signOut } = useAuth();

  if (status === 'checking') {
    return <div className="min-h-screen bg-stone-50" aria-busy="true" />;
  }

  if (status === 'anonymous') {
    return <LoginScreen onSubmit={signIn} submitting={submitting} error={error} />;
  }

  return <BoardApp username={username} onSignOut={signOut} />;
}
