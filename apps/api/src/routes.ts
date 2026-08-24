import { assembleBoard, toTicketDetail } from './board/assemble';
import type { BoardResponse, PullSummary } from './board/types';
import type { TtlCache } from './cache';
import type { Db } from './db/client';
import {
  countTickets,
  readLastPull,
  readLastSuccessfulPull,
  readStatusHistory,
  readTicket,
  readTickets,
} from './db/queries';
import type { PullRow } from './db/schema';
import { HelpDeskError } from './helpdesk/client';
import type { HelpDeskTag } from './helpdesk/types';
import type { PullRunner } from './pull-service';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

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
  const { startedAt, finishedAt, ticketCount, status, error } = row;
  return { startedAt, finishedAt, ticketCount, status, error };
}

/** Assembles the board out of SQLite. No HelpDesk call happens on this path. */
function boardFromDb(db: Db): BoardResponse {
  const lastSuccessful = readLastSuccessfulPull(db);
  const lastPull = readLastPull(db);
  // A stored ticket always came from a successful pull; the second fallback is
  // only reachable if the pulls table was truncated by hand.
  const pulledAt = lastSuccessful?.finishedAt ?? lastPull?.startedAt ?? new Date(0).toISOString();

  return { ...assembleBoard(readTickets(db), pulledAt), lastPull: toPullSummary(lastPull) };
}

export type RouterDeps = {
  db: Db;
  pulls: PullRunner;
  tags: TtlCache<HelpDeskTag[]>;
};

/**
 * Routes every request. Reads come from SQLite so the board survives a HelpDesk
 * outage; only an explicit pull talks upstream, and every upstream call is a GET.
 */
export function createRouter({ db, pulls, tags }: RouterDeps) {
  /** First boot has nothing to serve — pull instead of returning an empty board. */
  async function ensureSeeded(): Promise<void> {
    if (countTickets(db) === 0) await pulls.run();
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      if (pathname === '/api/health') {
        return json({ ok: true, tickets: countTickets(db), lastPull: toPullSummary(readLastPull(db)) });
      }

      if (pathname === '/api/pull' && request.method === 'POST') {
        return json(await pulls.run());
      }

      if (pathname === '/api/tickets' && request.method === 'GET') {
        if (url.searchParams.get('refresh') === '1') await pulls.run();
        else await ensureSeeded();
        return json(boardFromDb(db));
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

      return json({ error: 'not_found', message: `No route for ${pathname}` }, 404);
    } catch (cause) {
      return errorResponse(cause);
    }
  };
}
