import { useCallback, useEffect, useState } from 'react';
import { fetchTicketDetail, fetchTicketHistory } from '@/lib/api';
import type { StatusHistoryEntry, TicketDetail } from '@/types';

/** Fetches one ticket's detail and status timeline whenever the drawer opens. */
export function useTicketDetail() {
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticketId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    setHistory([]);

    // The timeline is secondary — a failure there empties it rather than
    // taking the whole drawer down with it.
    Promise.all([
      fetchTicketDetail(ticketId),
      fetchTicketHistory(ticketId).catch(() => [] as StatusHistoryEntry[]),
    ])
      .then(([result, entries]) => {
        if (cancelled) return;
        setDetail(result);
        setHistory(entries);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  const close = useCallback(() => setTicketId(null), []);

  return { ticketId, detail, history, loading, error, open: setTicketId, close };
}
