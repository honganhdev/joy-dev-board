import { clientIp, createAuthHandlers, unauthorized, type ClientAddress } from './auth/handlers';
import { MCP_AUTH_FAILURE, mcpPublicId, verifyMcpToken } from './auth/mcp-token';
import { LoginThrottle, type ThrottleOptions } from './auth/throttle';
import { assembleBoard, toTicketDetail } from './board/assemble';
import { resolveTags } from './board/tags';
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
import { sanitizeForLog } from './webhook-verify';
import { handleMcpRequest } from './mcp/server';
import type { McpToolDeps } from './mcp/tools';
import { MCP_GUIDE_BLOCKS } from './docs/mcp-guide';

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
  const loginThrottle = new LoginThrottle(throttle);
  const authHandlers = createAuthHandlers({ db, auth, throttle: loginThrottle });
  const serveStatic: StaticHandler = createStaticHandler(webDistPath ?? null);
  const handleWebhook = createWebhookHandler({
    secret: webhookSecret,
    reserveDelivery: (key, ticketId, createdAt) =>
      reserveDelivery(db, key, undefined, ticketId, createdAt),
    webhooks,
  });
  const mcpTools: McpToolDeps = {
    readTickets: () => readTickets(db),
    readTicket: (ticketId) => readTicket(db, ticketId),
    readStatusHistory: (ticketId) => readStatusHistory(db, ticketId),
    readLastPull: () => readLastPull(db),
    readLastSuccessfulPull: () => readLastSuccessfulPull(db),
    readLastSuccessfulWebhook: () => readLastSuccessfulWebhook(db),
    countTickets: () => countTickets(db),
    resolveTags: (tagIds) => resolveTags(tags, tagIds),
  };

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

    // Bearer credentials must never inherit the cookie surface's permissive
    // CORS headers. This branch owns every method and its own error boundary,
    // and it owns subpaths too: a client configured with a trailing slash used
    // to fall through to the board gate and get its generic 401 with
    // `Access-Control-Allow-Origin: *` on it.
    if (pathname === '/api/mcp' || pathname.startsWith('/api/mcp/')) {
      if (request.method !== 'POST') {
        return Response.json(
          { error: 'method_not_allowed', message: 'Use POST for MCP requests.' },
          { status: 405, headers: { Allow: 'POST' } }
        );
      }

      try {
        const authorization = request.headers.get('authorization') ?? '';
        const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';
        const publicId = mcpPublicId(bearer);
        const ip = clientIp(request, server, auth.trustProxy);
        // Only by IP. The public id is non-secret by design — it is printed in
        // every line below and by `mcp:revoke` — so keying a lockout on it let
        // anyone who had read a log refuse the owner's own token. The secret is
        // 32 CSPRNG bytes: entropy is the control against guessing, and the
        // per-token key bought nothing but a targeted denial.
        const keys = auth.trustProxy ? [`mcp-ip:${ip}`] : [];

        const verdict = loginThrottle.check(keys);
        const verification = verdict.locked
          ? { ok: false as const, error: MCP_AUTH_FAILURE }
          : verifyMcpToken(db, auth, bearer);
        if (!verification.ok) {
          if (!verdict.locked) loginThrottle.recordFailure(keys);
          console.warn(
            `[mcp] rejected ${sanitizeForLog(publicId)} (ip ${sanitizeForLog(ip)})`
          );
          return Response.json(
            { error: 'unauthorized', message: MCP_AUTH_FAILURE },
            { status: 401 }
          );
        }

        loginThrottle.reset(keys);
        console.log(
          `[mcp] accepted ${sanitizeForLog(verification.token.publicId)} ` +
            `(user ${sanitizeForLog(verification.token.username)}, ip ${sanitizeForLog(ip)})`
        );
        return await handleMcpRequest(request, mcpTools);
      } catch (cause) {
        console.error(
          `[mcp] request failed: ${sanitizeForLog(cause instanceof Error ? cause.message : String(cause))}`
        );
        return Response.json(
          { error: 'internal_error', message: 'MCP request failed.' },
          { status: 500 }
        );
      }
    }

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

      if (pathname === '/api/docs/mcp' && request.method === 'GET') {
        return json({ blocks: MCP_GUIDE_BLOCKS });
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
