import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, fetchWeeklyReport } from '@/lib/api';
import type { WeeklyReport } from '@/types';

/** Whole-week ranges the control offers before the server has said which it can answer. */
const DEFAULT_WEEKS = 12;

function messageFor(cause: unknown): string {
  if (cause instanceof ApiRequestError) return cause.message;
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Loads the report, and re-loads it when the range changes.
 *
 * The range is the *only* thing it re-fetches on. Every week's breakdowns are in
 * the response already, so focusing a week is picking an element out of an array
 * the browser is holding — that state lives in the view, not here.
 */
export function useWeeklyReport() {
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchWeeklyReport(weeks));
    } catch (cause) {
      setError(messageFor(cause));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [weeks]);

  useEffect(() => {
    void load();
  }, [load]);

  return { report, loading, error, weeks, setWeeks, reload: load };
}
