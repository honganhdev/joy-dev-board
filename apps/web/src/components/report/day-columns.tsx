import { COLUMN_GEOMETRY, barHeight } from './column-geometry';
import { Legend, Panel } from './panel';
import type { WeekSummary } from '@/types';

const DAY_SLOT_STYLE = {
  flex: '1 1 0',
  minWidth: 48,
} as const;

const BAR_GROUP_STYLE = {
  width: '50%',
  maxWidth: 40,
  height: '100%',
} as const;

/** Created against done inside the focused week, with one non-interactive slot per day. */
export function DayColumns({ week }: { week: WeekSummary }) {
  const max = week.days.reduce(
    (tallest, day) => Math.max(tallest, day.created ?? 0, day.done ?? 0),
    0
  );

  return (
    <Panel
      title="Created vs done per day"
      aside={
        <Legend
          items={[
            { label: 'created', className: 'bg-stone-800' },
            { label: 'done', className: 'bg-emerald-500' },
          ]}
        />
      }
    >
      <div className="flex items-end" style={{ gap: 12 }}>
        {week.days.map((day) => {
          const created = day.created;
          const done = day.done;
          const measured = created !== null && done !== null;
          return (
            <div
              key={day.label}
              style={DAY_SLOT_STYLE}
              title={
                measured
                  ? `${day.label} · ${created} created · ${done} done`
                  : `${day.label} · no figures yet`
              }
              className="flex min-w-0 flex-col items-center"
            >
              {measured ? (
                <span
                  className="flex items-end justify-center"
                  style={{ gap: 6, height: COLUMN_GEOMETRY.plotHeight + 18, width: '100%' }}
                >
                  <span
                    className="flex flex-col items-center justify-end"
                    style={BAR_GROUP_STYLE}
                  >
                    <span className="mb-1 text-[11px] font-medium tabular-nums">{created}</span>
                    <span
                      className="block rounded-t-[2px] bg-stone-800"
                      style={{ height: barHeight(created, max), width: '100%' }}
                    />
                  </span>
                  <span
                    className="flex flex-col items-center justify-end"
                    style={BAR_GROUP_STYLE}
                  >
                    <span className="mb-1 text-[11px] font-medium tabular-nums">{done}</span>
                    <span
                      className="block rounded-t-[2px] bg-emerald-500"
                      style={{ height: barHeight(done, max), width: '100%' }}
                    />
                  </span>
                </span>
              ) : (
                <span
                  className="flex items-end justify-center text-[15px] font-semibold text-muted-foreground"
                  style={{ height: COLUMN_GEOMETRY.plotHeight + 18 }}
                >
                  —
                </span>
              )}
              <span className="mt-1 border-t-2 border-stone-200" style={{ width: '100%' }} />
              <span
                className="mt-1 truncate text-center text-[10px] tabular-nums text-muted-foreground"
                style={{ width: '100%' }}
              >
                {day.label}
              </span>
            </div>
          );
        })}
      </div>
      {week.daysHighlight && (
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">{week.daysHighlight}</p>
      )}
      {week.daysNote && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{week.daysNote}</p>
      )}
    </Panel>
  );
}
