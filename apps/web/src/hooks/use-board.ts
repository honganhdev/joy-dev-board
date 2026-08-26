import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, fetchBoard, pullFromHelpDesk } from '@/lib/api';
import { followPull } from '@/lib/pull-poll';
import type { Board, PullSummary } from '@/types';

function messageFor(cause: unknown): string {
  if (cause instanceof ApiRequestError) return cause.message;
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Loads the board once, and re-pulls on demand.
 *
 * The board comes from the API's database, so a failed pull is not a failed
 * board: the stored tickets stay on screen and the failure is reported through
 * `board.lastPull` instead of blanking the page.
 *
 * `onPullSettled` is called with the summary of any pull this hook followed to
 * a stop, from either path, so a pull that was already running when the page
 * loaded is reported exactly like one the button started.
 */
export function useBoard(onPullSettled?: (settled: PullSummary | null) => void) {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so `load` keeps a stable identity and the mount effect fires
  // once, whatever the caller does with its callback between renders.
  const reportSettled = useRef(onPullSettled);
  reportSettled.current = onPullSettled;

  /**
   * Writes a board the caller fetched itself.
   *
   * `refreshBoard` fetches and writes in one step, which is right for the pull
   * loop and wrong for anything that has to decide whether its own answer is
   * still the newest one: by the time it resolves, the write has already
   * happened. A caller that needs the guard to come first reads the board and
   * hands it here.
   */
  const applyBoard = useCallback((next: Board) => setBoard(next), []);

  /** Best effort: a re-read that fails leaves the board already on screen. */
  const refreshBoard = useCallback(async (): Promise<Board | null> => {
    try {
      const nextBoard = await fetchBoard();
      setBoard(nextBoard);
      return nextBoard;
    } catch {
      return null;
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    let nextBoard: Board;
    try {
      nextBoard = await fetchBoard();
    } catch (cause) {
      setError(messageFor(cause));
      // Nothing stored yet and nothing fetchable — show the error, not an empty board.
      setBoard(null);
      setLoading(false);
      return;
    }

    // The board is in hand, so stop showing the skeleton over it. A pull someone
    // else started is followed on top of live tickets, under the top bar's
    // "Pulling…", rather than behind a skeleton for as long as the pull runs.
    setBoard(nextBoard);
    setLoading(false);
    if (nextBoard.lastPull?.status !== 'running') return;

    setPulling(true);
    try {
      const settled = await followPull();
      await refreshBoard();
      reportSettled.current?.(settled);
    } catch {
      // A failed follow is not a failed board: the tickets that loaded stay, and
      // the re-read picks up the API's record of the failed attempt, which is
      // what the stale warning reads.
      await refreshBoard();
    } finally {
      setPulling(false);
    }
  }, [refreshBoard]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Starts a pull, follows it to a stop, then re-reads the board it wrote. */
  const pull = useCallback(async (): Promise<PullSummary | null> => {
    setPulling(true);
    try {
      await pullFromHelpDesk();
      const settled = await followPull();
      setBoard(await fetchBoard());
      setError(null);
      return settled;
    } catch (cause) {
      // Re-read anyway: the pull failed, but the API records the failed attempt
      // and the stored board is still worth showing.
      await fetchBoard()
        .then(setBoard)
        .catch(() => undefined);
      throw cause;
    } finally {
      setPulling(false);
    }
  }, []);

  return { board, loading, pulling, error, reload: load, refreshBoard, applyBoard, pull };
}
