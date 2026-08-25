import type { Board, PullSummary, StatusHistoryEntry, TicketDetail, WeeklyReport } from '@/types';

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

/**
 * Called when a request comes back `401`, so a session that expired or was
 * revoked while the tab sat open drops straight to the login screen rather than
 * leaving a board that silently stops updating.
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    // `same-origin` is the default, but the session cookie is the whole point
    // of these calls — worth being explicit about.
    response = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiRequestError('Cannot reach the board API. Is `bun run dev:api` running?');
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    // The auth endpoints report their own 401s; anywhere else it means the
    // session is gone and the whole app has to go back to the login screen.
    if (response.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized?.();

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

/** The whole report in one response — the server picks no week, the client picks no range. */
export function fetchWeeklyReport(weeks: number): Promise<WeeklyReport> {
  return request<WeeklyReport>(`/api/report/weekly?weeks=${weeks}`);
}

/** Starts a HelpDesk pull and returns the current server-side attempt. */
export function pullFromHelpDesk(): Promise<PullSummary | null> {
  return request<PullSummary | null>('/api/pull', { method: 'POST' });
}

/** The API's last pull attempt, however it ended. */
export function fetchPullStatus(): Promise<PullSummary | null> {
  return request<PullSummary | null>('/api/pull/status');
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

/**
 * Signs in. The session id comes back as an `HttpOnly` cookie the browser
 * stores itself — no token is ever handed to this code, and none is kept here.
 */
export function login(username: string, password: string): Promise<{ username: string }> {
  return request<{ username: string }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/auth/logout', { method: 'POST' });
}

/** Who the cookie belongs to. Rejects with a `401` when there is no session. */
export function fetchCurrentUser(): Promise<{ username: string }> {
  return request<{ username: string }>('/api/auth/me');
}
