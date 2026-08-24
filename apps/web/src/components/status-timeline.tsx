import { formatDuration, formatFull } from '@/lib/format';
import type { StatusHistoryEntry } from '@/types';

type StatusTimelineProps = { entries: StatusHistoryEntry[] };

function label(status: string | null): string {
  return status ?? '(no status)';
}

/**
 * A ticket's status timeline, oldest first, with how long each one held.
 *
 * Every timestamp here is an *observation*: HelpDesk only ever returns a
 * ticket's current state, so all the board knows is that a change happened
 * somewhere between two pulls. The caption says so rather than letting the
 * times be read as exact.
 */
export function StatusTimeline({ entries }: StatusTimelineProps) {
  if (entries.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No status change observed yet — the timeline starts at the first pull that saw this ticket.
      </p>
    );
  }

  const now = Date.now();
  const current = entries[entries.length - 1];

  return (
    <div className="space-y-2">
      {current && (
        <p className="text-[13px]">
          In <span className="font-medium">{label(current.toStatus)}</span> since{' '}
          {formatFull(current.observedAt)} ·{' '}
          <span className="font-medium">{formatDuration(now - Date.parse(current.observedAt))}</span>
        </p>
      )}

      <ol className="space-y-1.5 border-l border-stone-200 pl-3">
        {entries.map((entry, index) => {
          const until = entries[index + 1]?.observedAt;
          const held = formatDuration((until ? Date.parse(until) : now) - Date.parse(entry.observedAt));
          return (
            <li key={`${entry.observedAt}-${index}`} className="text-[12px] leading-snug">
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                {entry.fromStatus !== null && (
                  <span className="text-muted-foreground">{label(entry.fromStatus)} →</span>
                )}
                <span className="font-medium">{label(entry.toStatus)}</span>
                <span className="text-muted-foreground">held {held}</span>
              </div>
              <div className="text-muted-foreground">
                {entry.fromStatus === null ? 'first seen' : 'observed'} {formatFull(entry.observedAt)}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="text-[11px] text-muted-foreground">
        Times are when a pull noticed the change, not when HelpDesk made it.
      </p>
    </div>
  );
}
