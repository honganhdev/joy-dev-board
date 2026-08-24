import type { Board, PullResult, StatusHistoryEntry, TicketDetail } from '@/types';

/**
 * Errors carry the message the API produced so the UI can show what actually
 * went wrong (HelpDesk 502, key missing, network down) instead of a blank board.
 */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiRequestError('Cannot reach the board API. Is `bun run dev:api` running?');
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `Request failed with ${response.status}`;
    throw new ApiRequestError(message, response.status);
  }

  return body as T;
}

export function fetchBoard(): Promise<Board> {
  return request<Board>('/api/tickets');
}

/** Re-pulls from HelpDesk into the API's database. Returns what changed. */
export function pullFromHelpDesk(): Promise<PullResult> {
  return request<PullResult>('/api/pull', { method: 'POST' });
}

export function fetchTicketDetail(ticketId: string): Promise<TicketDetail> {
  return request<TicketDetail>(`/api/tickets/${encodeURIComponent(ticketId)}`);
}

/** That ticket's observed status changes, oldest first. */
export function fetchTicketHistory(ticketId: string): Promise<StatusHistoryEntry[]> {
  return request<{ entries: StatusHistoryEntry[] }>(
    `/api/tickets/${encodeURIComponent(ticketId)}/history`
  ).then((body) => body.entries);
}
