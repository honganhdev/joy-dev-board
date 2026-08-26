import { formatDuration, formatFull } from '@/lib/format';
import { statusLabel } from '@/lib/status-label';
import type { TicketTimeline, TimelineEvent } from '@/lib/ticket-timeline';
import { cn } from '@/lib/utils';

type StatusTimelineProps = { timeline: TicketTimeline };

/**
 * What each row of the chronology says.
 *
 * A board observation is phrased so it cannot be read as a change time: a
 * `first-seen` row says the board *found* the ticket in that status, and never
 * how long it had been there — that is the one thing the board cannot know.
 */
function describe(event: TimelineEvent): string {
  switch (event.kind) {
    case 'created':
      return 'Created in HelpDesk';
    case 'done':
      return 'First reached a done state';
    case 'updated':
      return 'Last updated in HelpDesk';
    case 'first-seen':
      return `First seen by this board, already in ${statusLabel(event.toStatus)}`;
    case 'transition':
      return `${statusLabel(event.fromStatus)} → ${statusLabel(event.toStatus)}`;
  }
}

/** One-line answer to "how long has it been like this?", or an honest refusal. */
function Summary({ timeline }: StatusTimelineProps) {
  const status = <span className="font-medium">{statusLabel(timeline.status)}</span>;

  if (timeline.observedSince && timeline.observedForMs !== null) {
    return (
      <p className="text-[13px]">
        In {status} for{' '}
        <span className="font-medium">{formatDuration(timeline.observedForMs)}</span> — this board saw it
        move on {formatFull(timeline.observedSince)}.
      </p>
    );
  }

  if (timeline.firstSeenAt) {
    return (
      <p className="text-[13px]">
        In {status}. The board never saw it move here — it was already in that status when first seen
        on {formatFull(timeline.firstSeenAt)}, so how long it has held is unknown.
      </p>
    );
  }

  return (
    <p className="text-[13px]">
      In {status}. This board has not recorded a status change for this ticket yet.
    </p>
  );
}

/**
 * A ticket's chronology, oldest first, keeping HelpDesk's exact timestamps and
 * this board's observations visually apart — a solid marker is a fact, a hollow
 * one is only when this board happened to look.
 */
export function StatusTimeline({ timeline }: StatusTimelineProps) {
  const hasObservations = timeline.events.some((event) => event.source === 'board');

  return (
    <div className="space-y-2.5">
      <Summary timeline={timeline} />

      {timeline.events.length > 0 && (
        <ol className="space-y-2 border-l border-stone-200 pl-3.5">
          {timeline.events.map((event, index) => (
            <li key={`${event.at}-${event.kind}-${index}`} className="relative text-[12px] leading-snug">
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-1 -left-[1.16rem] size-[7px] rounded-full border',
                  event.source === 'helpdesk'
                    ? 'border-stone-500 bg-stone-500'
                    : 'border-stone-300 bg-background'
                )}
              />
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-medium break-words">{describe(event)}</span>
                {event.heldMs !== undefined && (
                  <span className="text-muted-foreground">held {formatDuration(event.heldMs)}</span>
                )}
              </div>
              <div className="text-muted-foreground">
                {formatFull(event.at)}
                {/* Both sides are labelled: a silent row next to an "observed"
                    one reads as ambiguous rather than as a fact. */}
                {event.source === 'board' ? ' · observed' : ' · HelpDesk'}
              </div>
            </li>
          ))}
        </ol>
      )}

      {hasObservations && (
        <p className="text-[11px] text-muted-foreground">
          Rows marked <span className="font-medium">observed</span> are stamped when this board noticed
          (a pull or a webhook), not when HelpDesk made the change. Rows marked{' '}
          <span className="font-medium">HelpDesk</span> are exact.
        </p>
      )}
    </div>
  );
}
