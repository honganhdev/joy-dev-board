import { assembleBoard, findTicketDetail } from './board/assemble';
import type { TtlCache } from './cache';
import { HelpDeskError } from './helpdesk/client';
import type { HelpDeskTag, HelpDeskTicket } from './helpdesk/types';

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

export type Caches = {
  tickets: TtlCache<HelpDeskTicket[]>;
  tags: TtlCache<HelpDeskTag[]>;
};

/** Routes every request. Read-only: nothing here writes back to HelpDesk. */
export function createRouter({ tickets, tags }: Caches) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      if (pathname === '/api/health') {
        return json({ ok: true });
      }

      // Re-fetch from HelpDesk and refresh the cache; the count feeds the toast.
      if (pathname === '/api/pull' && request.method === 'POST') {
        const pull = await tickets.refresh();
        const board = assembleBoard(pull.value, pull.loadedAt);
        return json({ pulled: board.totalTickets, board });
      }

      if (pathname === '/api/tickets' && request.method === 'GET') {
        const pull =
          url.searchParams.get('refresh') === '1'
            ? { ...(await tickets.refresh()), fromCache: false }
            : await tickets.get();
        const board = assembleBoard(pull.value, pull.loadedAt);
        return json({ ...board, fromCache: pull.fromCache });
      }

      const detailMatch = pathname.match(/^\/api\/tickets\/([^/]+)$/);
      if (detailMatch && request.method === 'GET') {
        const ticketId = decodeURIComponent(detailMatch[1] ?? '');
        const pull = await tickets.get();
        const detail = findTicketDetail(pull.value, ticketId);
        if (!detail) {
          return json({ error: 'not_found', message: `No ticket ${ticketId}` }, 404);
        }
        return json({ ...detail, tags: await resolveTags(tags, detail.tagIds) });
      }

      return json({ error: 'not_found', message: `No route for ${pathname}` }, 404);
    } catch (cause) {
      return errorResponse(cause);
    }
  };
}
