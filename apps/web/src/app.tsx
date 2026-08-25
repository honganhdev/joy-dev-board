import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BoardColumn } from '@/components/board/board-column';
import { BoardError, BoardSkeleton } from '@/components/board/board-states';
import { LoginScreen } from '@/components/login-screen';
import { ReportView } from '@/components/report/report-view';
import { TicketDetailDialog } from '@/components/ticket-detail-dialog';
import { TopBar, type BoardView } from '@/components/top-bar';
import { Toaster } from '@/components/ui/sonner';
import { useAuth } from '@/hooks/use-auth';
import { useBoard } from '@/hooks/use-board';
import { useTicketDetail } from '@/hooks/use-ticket-detail';
import { formatAge } from '@/lib/format';
import { filterBoard } from '@/lib/search';

/** Collapsed categories, keyed by column. Lives as long as the page does. */
type CollapsedState = Record<string, ReadonlySet<string>>;

const EMPTY_COLLAPSED: ReadonlySet<string> = new Set();

/**
 * The board itself. Mounted only once there is a session, so none of its
 * requests ever fire while signed out — a signed-out visitor gets the login
 * screen, not a board that 401s its way to an error state.
 */
function BoardApp({ username, onSignOut }: { username: string | null; onSignOut: () => void }) {
  const { board, loading, pulling, error, reload, pull } = useBoard();
  const detail = useTicketDetail();
  const [view, setView] = useState<BoardView>('board');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<CollapsedState>({});

  const filtered = useMemo(() => (board ? filterBoard(board, query) : null), [board, query]);

  const toggleCategory = useCallback((columnStatus: string, category: string, open: boolean) => {
    setCollapsed((current) => {
      const next = new Set(current[columnStatus] ?? []);
      if (open) next.delete(category);
      else next.add(category);
      return { ...current, [columnStatus]: next };
    });
  }, []);

  const handlePull = useCallback(async () => {
    try {
      const { pulled, inserted, statusChanges } = await pull();
      toast.success(
        `Pulled ${pulled} tickets · ${inserted} new · ${statusChanges} status ${statusChanges === 1 ? 'change' : 'changes'}.`
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Pull failed.');
    }
  }, [pull]);

  const boardSubtitle = board
    ? `${board.boardTickets} of ${board.openTickets} open JOY Loyalty tickets · pulled ${formatAge(board.pulledAt)}`
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

  const searching = query.trim().length > 0;

  return (
    <div className="flex h-screen flex-col bg-background">
      <TopBar
        view={view}
        onViewChange={setView}
        query={query}
        onQueryChange={setQuery}
        onPull={handlePull}
        pulling={pulling}
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
          <div className="h-full overflow-y-auto">
            <ReportView />
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
                <div className="flex h-full min-h-0 gap-4">
                  {filtered.columns.map((column) => (
                    <BoardColumn
                      key={column.status}
                      column={column}
                      collapsed={collapsed[column.status] ?? EMPTY_COLLAPSED}
                      onToggleCategory={(category, open) =>
                        toggleCategory(column.status, category, open)
                      }
                      onOpenTicket={detail.open}
                      filtered={searching}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>

      {view === 'board' && board && board.otherStatuses.length > 0 && (
        <footer className="shrink-0 border-t border-stone-200 bg-white px-5 py-2 text-[11px] text-muted-foreground">
          Not on the board:{' '}
          {board.otherStatuses.map((entry) => `${entry.status} (${entry.count})`).join(' · ')}
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
