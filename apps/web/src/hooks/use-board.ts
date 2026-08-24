import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, fetchBoard, pullFromHelpDesk } from '@/lib/api';
import type { Board, PullResult } from '@/types';

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
 */
export function useBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBoard(await fetchBoard());
    } catch (cause) {
      setError(messageFor(cause));
      // Nothing stored yet and nothing fetchable — show the error, not an empty board.
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Re-pulls from HelpDesk, then re-reads the board the pull just wrote. */
  const pull = useCallback(async (): Promise<PullResult> => {
    setPulling(true);
    try {
      const result = await pullFromHelpDesk();
      setBoard(await fetchBoard());
      setError(null);
      return result;
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

  return { board, loading, pulling, error, reload: load, pull };
}
