import type { ReactNode } from 'react';
import type { WeekSummary } from '@/types';

type HeadlineTilesProps = {
  week: WeekSummary;
  openRightNow: number;
  /** Why the historical number and the live one differ. Rendered verbatim. */
  outstandingCaption: string;
};

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex-1 rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </h2>
      {children}
    </section>
  );
}

/**
 * The three numbers the request actually asked for. A chart of one number is
 * decoration, so these are figures — the only proportion drawn here is the done
 * split, where the proportion is the point.
 */
export function HeadlineTiles({ week, openRightNow, outstandingCaption }: HeadlineTilesProps) {
  const doneMax = Math.max(1, week.done);

  return (
    <div className="flex gap-3">
      <Tile label="New this week">
        <p className="mt-1 text-[32px] leading-none font-semibold tabular-nums">{week.created}</p>
      </Tile>

      <Tile label="Done this week">
        <p className="mt-1 text-[32px] leading-none font-semibold tabular-nums">{week.done}</p>
        {week.doneByStatus.length > 0 && (
          <>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-stone-100">
              {week.doneByStatus.map((entry, index) => (
                <div
                  key={entry.status}
                  className={index % 2 === 0 ? 'bg-stone-800' : 'bg-stone-400'}
                  style={{ width: `${(entry.count / doneMax) * 100}%` }}
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {week.doneByStatus.map((entry, index) => (
                <span key={entry.status}>
                  {index > 0 && ' · '}
                  <span className="tabular-nums">{entry.count}</span> {entry.label}
                </span>
              ))}
            </p>
          </>
        )}
      </Tile>

      <Tile label="Outstanding at week end">
        <p className="mt-1 text-[32px] leading-none font-semibold tabular-nums">
          {week.outstanding}
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          open right now: <span className="tabular-nums">{openRightNow}</span>
        </p>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{outstandingCaption}</p>
      </Tile>
    </div>
  );
}
