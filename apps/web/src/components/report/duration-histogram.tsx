import { Panel } from './panel';
import type { TimeToFirstDone } from '@/types';

/**
 * A distribution, not a series, so it deliberately shares no axis with the week
 * panels. Median rather than mean: the tail is long and a mean would lie.
 */
export function DurationHistogram({ data }: { data: TimeToFirstDone }) {
  const max = data.buckets.reduce((tallest, bucket) => Math.max(tallest, bucket.count), 0);
  const scale = Math.max(1, max);

  return (
    <Panel
      title="Time to first done"
      aside={
        <span className="shrink-0 text-[11px] text-muted-foreground">
          median{' '}
          <span className="tabular-nums">
            {data.medianDays === null ? '—' : `${data.medianDays} days`}
          </span>{' '}
          · <span className="tabular-nums">{data.sampleSize}</span> tickets
        </span>
      }
    >
      <ul className="space-y-1.5">
        {data.buckets.map((bucket) => (
          <li key={bucket.label} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-[12px]">{bucket.label}</span>
            <span className="h-2.5 min-w-0 flex-1">
              <span
                className="block h-full rounded-[2px] bg-stone-500"
                style={{ width: `${(bucket.count / scale) * 100}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right text-[11px] tabular-nums">{bucket.count}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[10px] leading-snug text-muted-foreground">{data.caption}</p>
      {data.unmeasurable > 0 && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          <span className="tabular-nums">{data.unmeasurable}</span> finished tickets carry no
          created date and are not in this sample.
        </p>
      )}
    </Panel>
  );
}
