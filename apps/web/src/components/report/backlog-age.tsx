import { Panel } from './panel';
import type { WeeklyReport } from '@/types';

type OpenBacklog = WeeklyReport['openBacklog'];

export function BacklogAge({ data }: { data: OpenBacklog }) {
  const max = data.buckets.reduce((tallest, bucket) => Math.max(tallest, bucket.count), 0);
  const scale = Math.max(1, max, data.noCreatedDate);

  return (
    <Panel title="Backlog age and oldest open tickets">
      <ul className="space-y-1.5">
        {[...data.buckets, { label: data.noCreatedDateLabel, count: data.noCreatedDate }].map(
          (bucket) => (
            <li key={bucket.label} className="flex items-center gap-2">
              <span className="w-36 shrink-0 text-[12px]">{bucket.label}</span>
              <span className="h-2.5 min-w-0 flex-1">
                <span
                  className="block h-full rounded-[2px] bg-stone-500"
                  style={{ width: `${(bucket.count / scale) * 100}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-[11px] tabular-nums">
                {bucket.count}
              </span>
            </li>
          )
        )}
      </ul>

      {data.oldest.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-stone-200 pt-3">
          {data.oldest.map((ticket) => (
            <li key={ticket.ticketId} className="flex min-w-0 items-baseline gap-3 text-[12px]">
              <span className="min-w-0 flex-1 truncate font-medium" title={ticket.subject}>
                {ticket.subject}
              </span>
              <span className="shrink-0 text-muted-foreground">{ticket.merchant}</span>
              <span className="w-16 shrink-0 text-right tabular-nums">{ticket.ageLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
