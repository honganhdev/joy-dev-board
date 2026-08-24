import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, fetchBoard, pullFromHelpDesk } from '@/lib/api';
import type { Board } from '@/types';

function messageFor(cause: unknown): string {
  if (cause instanceof ApiRequestError) return cause.message;
  return cause instanceof Error ? cause.message : String(cause);
}

/** Loads the board once, and re-pulls on demand. */
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
      // Keep the error visible instead of falling back to a stale/empty board.
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Re-pulls from HelpDesk; resolves with the pulled count for the toast. */
  const pull = useCallback(async (): Promise<number> => {
    setPulling(true);
    try {
      const { pulled, board: fresh } = await pullFromHelpDesk();
      setBoard(fresh);
      setError(null);
      return pulled;
    } catch (cause) {
      setError(messageFor(cause));
      throw cause;
    } finally {
      setPulling(false);
    }
  }, []);

  return { board, loading, pulling, error, reload: load, pull };
}
