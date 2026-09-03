import type {
  Board,
  DocsBlock,
  PullSummary,
  StatusHistoryEntry,
  TicketDetail,
  WeeklyReport,
} from '@/types';

/**
 * Errors carry the message the API produced so the UI can show what actually
 * went wrong (HelpDesk 502, key missing, network down) instead of a blank board.
 */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** The parsed error body, for the few callers that act on its contents. */
    readonly body?: unknown
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
    // A caller that set its own deadline gets told the request ran out of time.
    // Everyone else gets the one thing that is usually true: nothing answered.
    if (init?.signal?.aborted) throw new ApiRequestError('The board API took too long to answer.');
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
    throw new ApiRequestError(message, response.status, body);
  }

  return body as T;
}

export function fetchBoard(): Promise<Board> {
  return request<Board>('/api/tickets');
}

/**
 * What a column save did. `ok: false` is the server refusing the write because
 * someone else replaced the row first — not a failure to reach it — and the set
 * it carries is what is stored now.
 */
export type BoardColumnUpdate = {
  ok: boolean;
  statuses: string[];
  version: number;
};

function isStoredPreference(body: unknown): body is { statuses: string[]; version: number } {
  if (!body || typeof body !== 'object') return false;
  const candidate = body as { statuses?: unknown; version?: unknown };
  return (
    Array.isArray(candidate.statuses) &&
    candidate.statuses.every((status) => typeof status === 'string') &&
    typeof candidate.version === 'number'
  );
}

/**
 * Replaces the shared column set, quoting the version this tab last saw. The
 * server writes only while that version is still current, so the older of two
 * saves cannot land last.
 */
export async function updateBoardColumns(
  statuses: string[],
  version: number
): Promise<BoardColumnUpdate> {
  try {
    const stored = await request<{ statuses: string[]; version: number }>(
      '/api/preferences/board-columns',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statuses, version }),
      }
    );
    return { ok: true, ...stored };
  } catch (cause) {
    if (cause instanceof ApiRequestError && cause.status === 409 && isStoredPreference(cause.body)) {
      return { ok: false, statuses: cause.body.statuses, version: cause.body.version };
    }
    throw cause;
  }
}

/** The whole report in one response — the server picks no week, the client picks no range. */
export function fetchWeeklyReport(weeks: number): Promise<WeeklyReport> {
  return request<WeeklyReport>(`/api/report/weekly?weeks=${weeks}`);
}

export function fetchMcpDocs(): Promise<readonly DocsBlock[]> {
  return request<{ blocks: readonly DocsBlock[] }>('/api/docs/mcp').then((body) => body.blocks);
}

/** Starts a HelpDesk pull and returns the current server-side attempt. */
export function pullFromHelpDesk(): Promise<PullSummary | null> {
  return request<PullSummary | null>('/api/pull', { method: 'POST' });
}

/**
 * The API's last pull attempt, however it ended. `timeoutMs` bounds the single
 * request, so a connection that establishes and then stalls fails instead of
 * hanging the caller that is polling on it.
 */
export function fetchPullStatus(timeoutMs?: number): Promise<PullSummary | null> {
  return request<PullSummary | null>(
    '/api/pull/status',
    timeoutMs === undefined ? undefined : { signal: AbortSignal.timeout(timeoutMs) }
  );
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
