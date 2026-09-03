import type { TtlCache } from '../cache';
import type { HelpDeskTag } from '../helpdesk/types';

/**
 * Resolves opaque tag ids for detail responses. A tag-directory failure
 * degrades to raw ids rather than failing the ticket read.
 */
export async function resolveTags(
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
