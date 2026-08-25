/**
 * Merges what HelpDesk knows about a ticket with what this board has observed,
 * and keeps the two apart.
 *
 * The board's `ticket_status_history` only starts at the first pull of this
 * deployment. Every ticket that was already sitting in its status then got one
 * `null → status` row stamped with that pull's time. Rendering that row as a
 * transition claims the ticket moved when the board booted, which for a ticket
 * created weeks earlier is simply false. So a `null → status` row is modelled
 * as a *first observation* and can never carry a duration, while HelpDesk's own
 * `createdAt` / `updatedAt` / `doneAt` are modelled as exact, because they are.
 */
import type { StatusHistoryEntry, TicketDetail } from '@/types';

export type TimelineEvent = {
  /** ISO timestamp this event is placed at. */
  at: string;
  /** `helpdesk` timestamps are exact; `board` ones are only when a pull looked. */
  source: 'helpdesk' | 'board';
  kind: 'created' | 'done' | 'updated' | 'first-seen' | 'transition';
  fromStatus?: string | null;
  toStatus?: string | null;
  /**
   * How long the status has held. Set only on a real observed transition —
   * never on a first observation, whose start time is unknown.
   */
  heldMs?: number;
};

export type TicketTimeline = {
  /** The ticket's current status, HelpDesk's value preferred over the board's. */
  status: string | null;
  /**
   * When the board watched the ticket enter `status`. Null when the move was
   * never observed, which is the case the old UI got wrong.
   */
  observedSince: string | null;
  observedForMs: number | null;
  /** When a pull first saw this ticket at all. Null if it has no history yet. */
  firstSeenAt: string | null;
  /** Chronological, oldest first. */
  events: TimelineEvent[];
};

function usable(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Ascending by timestamp; ties keep the order they were added in. */
function byTime(a: TimelineEvent, b: TimelineEvent): number {
  return Date.parse(a.at) - Date.parse(b.at);
}

export function buildTicketTimeline(
  entries: StatusHistoryEntry[],
  detail: Pick<TicketDetail, 'createdAt' | 'updatedAt' | 'doneAt' | 'tsStatus'>,
  now: number = Date.now()
): TicketTimeline {
  const observations = entries
    .filter((entry) => usable(entry.observedAt))
    .slice()
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));

  const events: TimelineEvent[] = [];

  const createdAt = usable(detail.createdAt);
  if (createdAt) events.push({ at: createdAt, source: 'helpdesk', kind: 'created' });

  const doneAt = usable(detail.doneAt);
  if (doneAt) events.push({ at: doneAt, source: 'helpdesk', kind: 'done' });

  const updatedAt = usable(detail.updatedAt);
  // Only worth a row when it is not just restating creation.
  if (updatedAt && updatedAt !== createdAt) {
    events.push({ at: updatedAt, source: 'helpdesk', kind: 'updated' });
  }

  observations.forEach((entry, index) => {
    const next = observations[index + 1];
    if (entry.fromStatus === null) {
      // A first sighting, not a move. No duration: nobody knows when it started.
      events.push({
        at: entry.observedAt,
        source: 'board',
        kind: 'first-seen',
        toStatus: entry.toStatus,
      });
      return;
    }
    events.push({
      at: entry.observedAt,
      source: 'board',
      kind: 'transition',
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      heldMs: (next ? Date.parse(next.observedAt) : now) - Date.parse(entry.observedAt),
    });
  });

  const last = observations[observations.length - 1];
  const status = detail.tsStatus ?? last?.toStatus ?? null;

  // "Since" is only honest when the board actually watched the move into the
  // status the ticket is in now.
  const observed =
    last && last.fromStatus !== null && last.toStatus === status ? last.observedAt : null;

  const firstSighting = observations.find((entry) => entry.fromStatus === null) ?? observations[0];

  return {
    status,
    observedSince: observed,
    observedForMs: observed ? now - Date.parse(observed) : null,
    firstSeenAt: firstSighting?.observedAt ?? null,
    events: events.sort(byTime),
  };
}
