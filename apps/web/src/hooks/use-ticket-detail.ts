import { useCallback, useEffect, useState } from 'react';
import { fetchTicketDetail } from '@/lib/api';
import type { TicketDetail } from '@/types';

/** Fetches one ticket's detail whenever the drawer opens on a new id. */
export function useTicketDetail() {
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticketId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);

    fetchTicketDetail(ticketId)
      .then((result) => {
        if (!cancelled) setDetail(result);
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

  return { ticketId, detail, loading, error, open: setTicketId, close };
}
