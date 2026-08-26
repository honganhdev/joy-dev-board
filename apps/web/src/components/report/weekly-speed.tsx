import { COLUMN_GEOMETRY, SLOT_STYLE } from './column-geometry';
import { Panel } from './panel';
import type { WeekSummary } from '@/types';

type WeeklySpeedProps = {
  weeks: WeekSummary[];
  caption: string;
  emptyWeeksNote: string | null;
};

/**
 * Weekly medians as figures rather than bars: the observed band is narrow, so
 * scaling one-, two- and three-day values as columns would manufacture a trend.
 */
export function WeeklySpeed({ weeks, caption, emptyWeeksNote }: WeeklySpeedProps) {
  return (
    <Panel title="Resolution speed per week">
      <div className="flex items-end" style={{ gap: COLUMN_GEOMETRY.gap }}>
        {weeks.map((week) => (
          <div
            key={week.key}
            style={SLOT_STYLE}
            title={week.label}
            className="flex min-w-0 flex-col items-center border-t border-stone-200 pt-2"
          >
            <span className="text-[15px] font-semibold tabular-nums">
              {week.medianDaysToDone ?? '—'}
            </span>
            {/* The sample the figure stands on, so a one-ticket week cannot read
                as the same kind of measurement as a forty-ticket one. */}
            <span className="mt-0.5 w-full truncate text-center text-[10px] tabular-nums text-muted-foreground">
              {week.doneSampleLabel}
            </span>
            <span className="mt-1 w-full truncate text-center text-[10px] tabular-nums text-muted-foreground">
              {week.shortLabel}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">{caption}</p>
      {emptyWeeksNote && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{emptyWeeksNote}</p>
      )}
    </Panel>
  );
}
