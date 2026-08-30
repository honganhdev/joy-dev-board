import { COLUMN_GEOMETRY, SLOT_STYLE } from './column-geometry';
import { Panel } from './panel';
import type { WeeklyReport } from '@/types';

type WeeklyGrowthProps = {
  weeks: WeeklyReport['weeks'];
  data: WeeklyReport['weeklyGrowth'];
};

export function WeeklyGrowth({ weeks, data }: WeeklyGrowthProps) {
  return (
    <Panel title={data.title}>
      {data.unavailableNote ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {data.unavailableNote}
        </p>
      ) : (
        <div className="flex items-end" style={{ gap: COLUMN_GEOMETRY.gap }}>
          {weeks.map((week) => (
            <div
              key={week.key}
              style={SLOT_STYLE}
              title={week.label}
              className="flex min-w-0 flex-col items-center border-t border-stone-200 pt-2"
            >
              {/* At the 1024px floor, 26 weeks leave about 31px per slot. A
                  10px signed figure fits beside the 6px gap; 15px does not. */}
              <span className="text-[10px] font-semibold tabular-nums">
                {week.createdDeltaLabel}
              </span>
              <span className="mt-1 w-full truncate text-center text-[10px] tabular-nums text-muted-foreground">
                {week.shortLabel}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        {data.direction}
      </p>
      {data.horizonNote && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          {data.horizonNote}
        </p>
      )}
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
        {data.caption}
      </p>
    </Panel>
  );
}
