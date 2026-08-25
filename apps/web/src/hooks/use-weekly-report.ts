import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, fetchWeeklyReport } from '@/lib/api';
import type { WeeklyReport } from '@/types';

/** Whole-week ranges the control offers before the server has said which it can answer. */
const DEFAULT_WEEKS = 12;

function messageFor(cause: unknown): string {
  if (cause instanceof ApiRequestError) return cause.message;
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Loads the report, and re-loads it when the range changes or `pullToken` moves.
 *
 * The range is the only thing the *user* re-fetches on. Every week's breakdowns
 * are in the response already, so focusing a week is picking an element out of
 * an array the browser is holding — that state lives in the view, not here.
 * `pullToken` changes when a HelpDesk pull has rewritten the mirror underneath a
 * mounted report, which is the one other time these numbers are wrong.
 *
 * Responses are sequenced by request id rather than by arrival. Without it a
 * slow first load can land *after* a range click and leave the picker
 * highlighting the range the server sent last, while the hook believes it asked
 * for another — and clicking the wanted preset again is then a no-op, because
 * the state it would set is the state it already holds. That leaves a dead
 * button whose only cure is a reload.
 */
export function useWeeklyReport(pullToken = 0) {
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const request = (latestRequest.current += 1);
    setLoading(true);
    setError(null);
    try {
      const next = await fetchWeeklyReport(weeks);
      if (request !== latestRequest.current) return;
      setReport(next);
    } catch (cause) {
      if (request !== latestRequest.current) return;
      setError(messageFor(cause));
      setReport(null);
    } finally {
      // A superseded request must not clear the spinner the newer one is under.
      if (request === latestRequest.current) setLoading(false);
    }
  }, [weeks]);

  useEffect(() => {
    void load();
    // `pullToken` is not read by `load`; it is here because a completed pull
    // makes the report on screen stale in exactly the way a range change does.
  }, [load, pullToken]);

  return { report, loading, error, weeks, setWeeks, reload: load };
}
