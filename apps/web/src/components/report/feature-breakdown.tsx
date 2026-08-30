import { Panel } from './panel';
import { categoryDotClass } from '@/lib/category-style';
import type { WeeklyReport } from '@/types';

type FeatureBreakdownData = WeeklyReport['openByFeature'];

export function FeatureBreakdown({ data }: { data: FeatureBreakdownData }) {
  const max = data.rows.reduce((tallest, row) => Math.max(tallest, row.open), 0);
  const scale = Math.max(1, max);

  return (
    <Panel title="By feature — backlog age and resolution speed">
      <ul className="space-y-1.5">
        {data.rows.map((row) => {
          const marker = categoryDotClass(row.key);
          return (
            <li key={row.key} className="flex items-center gap-2">
              <span className={`size-2 shrink-0 rounded-full ${marker}`} />
              <span className="w-44 shrink-0 truncate text-[12px]" title={row.label}>
                {row.label}
              </span>
              <span className="relative h-2.5 min-w-0 flex-1">
                <span
                  className={`absolute inset-y-0 left-0 rounded-[2px] opacity-40 ${marker}`}
                  style={{ width: `${(row.open / scale) * 100}%` }}
                />
                <span
                  className={`absolute inset-y-0 left-0 rounded-[2px] ${marker}`}
                  style={{ width: `${(row.olderThan30 / scale) * 100}%` }}
                />
              </span>
              {/* Aged over the tickets whose date can be read, not over every
                  open ticket — an undated one is not a ticket that is not old. */}
              <span className="w-20 shrink-0 text-right text-[11px] tabular-nums">
                {row.olderThan30} of {row.openWithCreatedDate}
              </span>
              <span className="w-60 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {row.speedNote}
              </span>
              <span className="w-48 shrink-0 text-right text-[11px] tabular-nums">
                {row.comparison.figure}
              </span>
            </li>
          );
        })}
      </ul>
      {data.unavailableNote && (
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
          {data.unavailableNote}
        </p>
      )}
      <p className="mt-3 text-[10px] leading-snug text-muted-foreground">{data.caption}</p>
    </Panel>
  );
}
