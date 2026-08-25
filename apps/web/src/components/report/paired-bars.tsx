import { Legend, Panel } from './panel';

export type PairedRow = {
  key: string;
  /** Printed exactly as the wire gives it — no casing, no tidying. */
  label: string;
  done: number;
  outstanding: number;
  /** Solid marker class. Neutral when the dataset has no colour source. */
  markerClass?: string;
};

const NEUTRAL_MARKER = 'bg-stone-400';

type PairedBarsProps = {
  title: string;
  rows: PairedRow[];
  emptyMessage: string;
};

/**
 * Two cohorts across a small set of nominal values: names read left, counts read
 * right, both bars off a common baseline. Used for categories and for priorities
 * — the same shape of question, so the same component.
 *
 * The row count is whatever the wire sent. Nothing here knows how many rows to
 * expect or what any of them are called.
 */
export function PairedBars({ title, rows, emptyMessage }: PairedBarsProps) {
  const max = rows.reduce((tallest, row) => Math.max(tallest, row.done, row.outstanding), 0);
  const scale = Math.max(1, max);

  return (
    <Panel
      title={title}
      className="min-w-0 flex-1"
      aside={
        <Legend
          items={[
            { label: 'done', className: 'bg-stone-400' },
            { label: 'outstanding', className: 'bg-stone-400 opacity-40' },
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const marker = row.markerClass ?? NEUTRAL_MARKER;
            return (
              <li key={row.key} className="flex items-center gap-2">
                <span className={`size-2 shrink-0 rounded-full ${marker}`} />
                <span className="w-[42%] shrink-0 truncate text-[12px]" title={row.label}>
                  {row.label}
                </span>

                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="h-2.5 min-w-0 flex-1">
                    <span
                      className={`block h-full rounded-[2px] ${marker}`}
                      style={{ width: `${(row.done / scale) * 100}%` }}
                    />
                  </span>
                  <span className="w-6 shrink-0 text-right text-[11px] tabular-nums">
                    {row.done}
                  </span>
                </span>

                <span className="flex min-w-0 flex-1 items-center gap-1.5 border-l border-stone-200 pl-2.5">
                  <span className="h-2.5 min-w-0 flex-1">
                    {/* The bar fades; the count beside it does not. */}
                    <span
                      className={`block h-full rounded-[2px] opacity-40 ${marker}`}
                      style={{ width: `${(row.outstanding / scale) * 100}%` }}
                    />
                  </span>
                  <span className="w-6 shrink-0 text-right text-[11px] tabular-nums">
                    {row.outstanding}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
