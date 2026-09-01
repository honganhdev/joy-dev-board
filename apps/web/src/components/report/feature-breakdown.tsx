import { Panel } from './panel';
import { directionGlyph } from './direction';
import { categoryDotClass } from '@/lib/category-style';
import type { WeeklyReport } from '@/types';

type FeatureBreakdownData = WeeklyReport['openByFeature'];

/**
 * What each column answers to, worded once for both the strip that heads it and
 * the sentence a screen reader hears on every row. This panel sits under a band
 * head naming today and right now, and two of its columns answer to the
 * selected range instead — so the heading is the only thing on screen saying
 * which stretch of time they cover, and "in range" alone never says which range
 * that is.
 *
 * Composed here rather than on the wire: these are column nouns, the one place
 * the plan lets the browser write words.
 */
export function columnHeads(weeks: number) {
  const span = `${weeks} weeks`;
  return {
    feature: 'Feature',
    aged: 'Aged now',
    speed: `Speed in the last ${span}`,
    change: `Change vs the preceding ${span}`,
  };
}

export function FeatureBreakdown({
  data,
  weeks,
}: {
  data: FeatureBreakdownData;
  weeks: number;
}) {
  const max = data.rows.reduce((tallest, row) => Math.max(tallest, row.open), 0);
  const scale = Math.max(1, max);
  const heads = columnHeads(weeks);

  return (
    <Panel title="By feature — backlog age and resolution speed">
      {/*
        Hidden from assistive technology because a strip of five loose nouns
        read out before the list says nothing about which cell each one belongs
        to. Every row carries the same words against its own figures instead.
      */}
      <div
        aria-hidden="true"
        className="mb-2 flex items-center gap-2 text-[10px] tracking-wider whitespace-nowrap text-muted-foreground uppercase"
      >
        <span className="size-2 shrink-0" />
        <span className="w-44 shrink-0">{heads.feature}</span>
        <span className="min-w-0 flex-1" />
        <span className="w-20 shrink-0 text-right">{heads.aged}</span>
        <span className="w-60 shrink-0 text-right">{heads.speed}</span>
        <span className="w-56 shrink-0 text-right">{heads.change}</span>
      </div>
      <ul className="space-y-1.5">
        {data.rows.map((row) => {
          const marker = categoryDotClass(row.key);
          const detail =
            `(${row.comparison.previous} → ${row.comparison.current})` +
            (row.comparison.percentLabel === null ? '' : ` · ${row.comparison.percentLabel}`);
          // The glyph is the only thing carrying direction on screen, and it reads
          // as a triangle or as nothing at all. `heard` is the same change in the
          // server's words, so direction survives for a reader who cannot see it.
          const seen = [directionGlyph(row.comparison.delta), row.comparison.magnitudeLabel]
            .filter(Boolean)
            .join(' ');
          const heard = [row.comparison.magnitudeLabel, row.changeLabel]
            .filter(Boolean)
            .join(' ');
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
                <span className="sr-only">{heads.aged}: </span>
                {row.olderThan30} of {row.openWithCreatedDate}
              </span>
              <span className="w-60 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                <span className="sr-only">{heads.speed}: </span>
                {row.speedNote}
              </span>
              <span className="w-56 shrink-0 text-right text-[11px] tabular-nums">
                <span className="sr-only">{heads.change}: </span>
                {row.comparison.previous === null ? (
                  row.comparison.current
                ) : (
                  <>
                    <span aria-hidden="true">{seen}</span>
                    <span className="sr-only">{heard}</span> {detail}
                  </>
                )}
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
