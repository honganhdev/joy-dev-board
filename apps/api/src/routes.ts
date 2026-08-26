import { createAuthHandlers, unauthorized, type ClientAddress } from './auth/handlers';
import { LoginThrottle, type ThrottleOptions } from './auth/throttle';
import { assembleBoard, toTicketDetail } from './board/assemble';
import type { BoardResponse, PullSummary } from './board/types';
import { aggregateWeeklyReport } from './board/weekly-report';
import type { TtlCache } from './cache';
import type { AuthConfig } from './config';
import type { Db } from './db/client';
import { reserveDelivery } from './db/sync';
import {
  InvalidBoardColumnsError,
  BoardColumnVersionConflictError,
  readBoardColumns,
  writeEnabledColumns,
} from './db/preferences';
import {
  countTickets,
  readLastPull,
  readLastPulls,
  readLastSuccessfulPull,
  readLastSuccessfulWebhook,
  readStatusHistory,
  readTicket,
  readTickets,
} from './db/queries';
import type { PullRow } from './db/schema';
import { HelpDeskError } from './helpdesk/client';
import type { HelpDeskTag } from './helpdesk/types';
import { CORS_HEADERS, json } from './http';
import type { PullRunner } from './pull-service';
import { createStaticHandler, type StaticHandler } from './static';
import { createWebhookHandler } from './webhook-handler';
import type { WebhookProcessor } from './webhook-service';

// Bounds drift from deletions, bulk closes and silent updates that emit no webhook.
const STALE_PULL_MS = 30 * 60 * 1000;

/**
 * How long a board load stops starting opportunistic pulls once two full pulls
 * have failed in a row. Staleness is measured from the last *successful* pull,
 * so without this every request while HelpDesk is down starts another 34-window
 * sweep. One failure is still retried at once — that is a blip, not an outage.
 */
const FAILED_PULL_BACKOFF_MS = 5 * 60 * 1000;

/**
 * Turns a failure into an error the UI can show. HelpDesk problems become 502
 * so a broken upstream is never mistaken for an empty board.
 */
function errorResponse(cause: unknown): Response {
  if (cause instanceof HelpDeskError) {
    console.error('[helpdesk]', cause.message);
    return json({ error: 'helpdesk_unavailable', message: cause.message }, 502);
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error('[api]', message);
  return json({ error: 'internal_error', message }, 500);
}

/**
 * Resolves a ticket's opaque `tagIds` into `{id, name, color}`. Tags are a
 * nicety on the detail view, so a failing tag directory degrades to raw ids
 * rather than failing the whole request.
 */
async function resolveTags(
  tagsCache: TtlCache<HelpDeskTag[]>,
  tagIds: string[] | null | undefined
): Promise<Array<{ id: string; name: string; color: string | null }>> {
  if (!tagIds?.length) return [];

  let directory: HelpDeskTag[] = [];
  try {
    directory = (await tagsCache.get()).value;
  } catch (cause) {
    console.error('[helpdesk] tag directory unavailable:', cause);
  }

  const byId = new Map(directory.map((tag) => [tag.id, tag]));
  return tagIds.map((id) => ({
    id,
    name: byId.get(id)?.name ?? id,
    color: byId.get(id)?.color ?? null,
  }));
}

function toPullSummary(row: PullRow | null): PullSummary | null {
  if (!row) return null;
  const { startedAt, finishedAt, ticketCount, inserted, statusChanges, status, error } = row;
  return { startedAt, finishedAt, ticketCount, inserted, statusChanges, status, error };
}

/** Assembles the board out of SQLite. No HelpDesk call happens on this path. */
function boardFromDb(db: Db): BoardResponse {
  const lastSuccessful = readLastSuccessfulPull(db);
  const lastPull = readLastPull(db);
  // A stored ticket always came from a successful pull; the second fallback is
  // only reachable if the pulls table was truncated by hand.
  const pulledAt = lastSuccessful?.finishedAt ?? lastPull?.startedAt ?? new Date(0).toISOString();

  const preference = readBoardColumns(db);

  return {
    ...assembleBoard(readTickets(db), pulledAt, { enabled: preference.statuses }),
    // The board is where the client learns which version of the column
    // preference it is looking at, so a save can quote it back.
    columnVersion: preference.version,
    lastPull: toPullSummary(lastPull),
    webhookAt: readLastSuccessfulWebhook(db)?.finishedAt ?? null,
  };
}

export type RouterDeps = {
  db: Db;
  pulls: PullRunner;
  tags: TtlCache<HelpDeskTag[]>;
  auth: AuthConfig;
  webhookSecret: string;
  webhooks: WebhookProcessor;
  /**
   * The calendar year the pull covers. The weekly report names it in its
   * coverage note, which would lie if it were read from the clock instead of
   * from the config the pull actually used.
   */
  year: number;
  /** Built web app to serve alongside the API. Omitted in dev and in tests. */
  webDistPath?: string | null;
  /** Tightened in tests so a lockout can be provoked without five real logins. */
  throttle?: ThrottleOptions;
};

/**
 * Routes every request. Reads come from SQLite so the board survives a HelpDesk
 * outage; only an explicit pull talks upstream, and every upstream call is a GET.
 *
 * Everything under `/api/` needs a session except the auth handlers, health,
 * and the signed webhook. Health answers with counts and pull status only,
 * never ticket content; the webhook returns fixed acknowledgements only.
 */
export function createRouter({
  db,
  pulls,
  tags,
  auth,
  webhookSecret,
  webhooks,
  year,
  webDistPath,
  throttle,
}: RouterDeps) {
  const authHandlers = createAuthHandlers({ db, auth, throttle: new LoginThrottle(throttle) });
  const serveStatic: StaticHandler = createStaticHandler(webDistPath ?? null);
  const handleWebhook = createWebhookHandler({
    secret: webhookSecret,
    reserveDelivery: (key, ticketId, createdAt) =>
      reserveDelivery(db, key, undefined, ticketId, createdAt),
    webhooks,
  });

  /** Starts a pull without holding the request. The runner records its own failure. */
  function kickPull(): void {
    void pulls.run().catch(() => undefined);
  }

  /** True while the upstream has failed twice running and the second failure is recent. */
  function backingOff(): boolean {
    const [latest, previous] = readLastPulls(db, 2);
    if (latest?.status !== 'error' || previous?.status !== 'error') return false;
    const failedAt = latest.finishedAt ? Date.parse(latest.finishedAt) : Number.NaN;
    return Number.isFinite(failedAt) && Date.now() - failedAt < FAILED_PULL_BACKOFF_MS;
  }

  /**
   * Reconcile an empty or stale mirror without holding the board response.
   * The Pull button does not come through here: a person pressing it always
   * pulls, whatever the last attempts did.
   */
  function ensureSeeded(): void {
    if (backingOff()) return;
    const finishedAt = readLastSuccessfulPull(db)?.finishedAt;
    const finishedMs = finishedAt ? Date.parse(finishedAt) : Number.NaN;
    const stale = !Number.isFinite(finishedMs) || Date.now() - finishedMs > STALE_PULL_MS;
    if (countTickets(db) === 0 || stale) kickPull();
  }

  return async function handle(request: Request, server: ClientAddress = null): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // --- Unauthenticated surface: health, auth handlers, and the signed webhook.
      if (pathname === '/api/health') {
        return json({ ok: true, tickets: countTickets(db), lastPull: toPullSummary(readLastPull(db)) });
      }

      if (pathname === '/api/auth/login' && request.method === 'POST') {
        return await authHandlers.login(request, server);
      }

      if (pathname === '/api/auth/logout' && request.method === 'POST') {
        return authHandlers.logout(request);
      }

      if (pathname === '/api/auth/me' && request.method === 'GET') {
        return authHandlers.me(request);
      }

      if (pathname === '/api/webhooks/avada-ticket' && request.method === 'POST') {
        return handleWebhook(request);
      }

      // --- Everything else under /api needs a session.
      if (pathname.startsWith('/api/')) {
        if (!authHandlers.currentUser(request)) return unauthorized();
      }

      if (pathname === '/api/pull' && request.method === 'POST') {
        kickPull();
        return json(toPullSummary(readLastPull(db)), 202);
      }

      if (pathname === '/api/pull/status' && request.method === 'GET') {
        return json(toPullSummary(readLastPull(db)));
      }

      if (pathname === '/api/preferences/board-columns' && request.method === 'PUT') {
        const body = (await request.json().catch(() => null)) as {
          statuses?: unknown;
          version?: unknown;
        } | null;
        try {
          return json(writeEnabledColumns(db, body?.statuses, body?.version));
        } catch (cause) {
          if (cause instanceof BoardColumnVersionConflictError) {
            // The refusal carries what is stored now, so the caller can show the
            // truth rather than the set it just failed to write.
            return json(
              { error: 'version_conflict', message: cause.message, ...cause.current },
              409
            );
          }
          if (cause instanceof InvalidBoardColumnsError) {
            return json({ error: 'invalid_request', message: cause.message }, 400);
          }
          throw cause;
        }
      }

      if (pathname === '/api/tickets' && request.method === 'GET') {
        if (url.searchParams.get('refresh') === '1') kickPull();
        else ensureSeeded();
        return json(boardFromDb(db));
      }

      if (pathname === '/api/report/weekly' && request.method === 'GET') {
        ensureSeeded();
        const weeks = Number(url.searchParams.get('weeks'));
        return json(aggregateWeeklyReport(readTickets(db), { weeks, now: new Date(), year }));
      }

      const historyMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/history$/);
      if (historyMatch && request.method === 'GET') {
        const ticketId = decodeURIComponent(historyMatch[1] ?? '');
        if (!readTicket(db, ticketId)) {
          return json({ error: 'not_found', message: `No ticket ${ticketId}` }, 404);
        }
        return json({ ticketId, entries: readStatusHistory(db, ticketId) });
      }

      const detailMatch = pathname.match(/^\/api\/tickets\/([^/]+)$/);
      if (detailMatch && request.method === 'GET') {
        const ticketId = decodeURIComponent(detailMatch[1] ?? '');
        const ticket = readTicket(db, ticketId);
        if (!ticket) {
          return json({ error: 'not_found', message: `No ticket ${ticketId}` }, 404);
        }
        const detail = toTicketDetail(ticket);
        return json({ ...detail, tags: await resolveTags(tags, detail.tagIds) });
      }

      if (pathname.startsWith('/api/')) {
        return json({ error: 'not_found', message: `No route for ${pathname}` }, 404);
      }

      // The web app itself. Unauthenticated on purpose: it is a public bundle
      // that renders the login screen, and every byte of data it shows still
      // has to come back through the guarded routes above. HEAD is served too:
      // proxies and uptime checks use it, and a 404 there reads as a dead app.
      if (request.method === 'GET' || request.method === 'HEAD') {
        const asset = await serveStatic(pathname);
        if (asset) return asset;
      }

      return json({ error: 'not_found', message: `No route for ${pathname}` }, 404);
    } catch (cause) {
      return errorResponse(cause);
    }
  };
}
