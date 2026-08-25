import { COLUMN_GEOMETRY, SLOT_STYLE, barHeight } from './column-geometry';
import { Legend, Panel } from './panel';
import type { WeekSummary } from '@/types';

type WeekColumnsProps = {
  weeks: WeekSummary[];
  focusedKey: string;
  onFocus: (key: string) => void;
};

/**
 * Created against done, one pair of columns per week — counts of discrete events
 * in discrete buckets, where a line would imply values between weeks that do not
 * exist.
 *
 * Each week is a `<button>`, not a div with a handler: it is the page's only
 * interactive chart element, and a div gets no keyboard focus, no Enter, no role
 * and no focus ring.
 */
export function WeekColumns({ weeks, focusedKey, onFocus }: WeekColumnsProps) {
  const max = weeks.reduce((tallest, week) => Math.max(tallest, week.created, week.done), 0);

  return (
    <Panel
      title="Created vs done per week"
      aside={
        <Legend
          items={[
            { label: 'created', className: 'bg-stone-800' },
            { label: 'done', className: 'bg-emerald-500' },
          ]}
        />
      }
    >
      <div className="flex items-end" style={{ gap: COLUMN_GEOMETRY.gap }}>
        {weeks.map((week) => {
          const focused = week.key === focusedKey;
          return (
            <button
              key={week.key}
              type="button"
              onClick={() => onFocus(week.key)}
              aria-pressed={focused}
              title={`${week.label} · ${week.created} created · ${week.done} done`}
              style={SLOT_STYLE}
              className={`group flex flex-col items-center rounded-t-sm pt-1 outline-none focus-visible:ring-2 focus-visible:ring-stone-400 ${
                focused ? 'bg-stone-100' : 'hover:bg-stone-50'
              }`}
            >
              <span
                className="flex w-full items-end justify-center gap-[2px]"
                style={{ height: COLUMN_GEOMETRY.plotHeight }}
              >
                <span
                  className="w-1/2 max-w-[22px] rounded-t-[2px] bg-stone-800"
                  style={{ height: barHeight(week.created, max) }}
                />
                <span
                  className="w-1/2 max-w-[22px] rounded-t-[2px] bg-emerald-500"
                  style={{ height: barHeight(week.done, max) }}
                />
              </span>
              <span
                className={`mt-1 w-full border-t-2 ${
                  focused ? 'border-stone-800' : 'border-stone-200'
                }`}
              />
              <span className="mt-1 truncate text-[10px] tabular-nums text-muted-foreground">
                {week.shortLabel}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Click a week to focus it. The tiles and both breakdowns follow.
      </p>
    </Panel>
  );
}
