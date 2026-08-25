import { COLUMN_GEOMETRY, SLOT_STYLE, barHeight } from './column-geometry';
import { Legend, Panel } from './panel';
import type { WeekSummary } from '@/types';

type BacklogColumnsProps = {
  weeks: WeekSummary[];
  focusedKey: string;
  /** Printed verbatim under the stack; both name what the mirror cannot see. */
  coverageNote: string;
  ghostCaveat: string | null;
};

/**
 * The backlog as a stock, not a flow: how many tickets stood open at each week's
 * end. Same geometry as the panel above, deliberately, so the eye drops straight
 * from "we closed five and got twelve" to "and the backlog rose".
 *
 * The stack is `outstandingWithDoneDate` plus `closedWithoutDoneAt`, both from
 * the wire. Stacking `outstanding` itself under the residue would draw a column
 * taller than the real backlog by a margin that grows every week.
 */
export function BacklogColumns({
  weeks,
  focusedKey,
  coverageNote,
  ghostCaveat,
}: BacklogColumnsProps) {
  const max = weeks.reduce((tallest, week) => Math.max(tallest, week.outstanding), 0);

  return (
    <Panel
      title="Backlog at each week end"
      aside={
        <Legend
          items={[
            { label: 'outstanding', className: 'bg-stone-500' },
            { label: 'closed without a done date', className: 'bg-stone-500 opacity-40' },
          ]}
        />
      }
    >
      <div className="flex items-end" style={{ gap: COLUMN_GEOMETRY.gap }}>
        {weeks.map((week) => {
          const focused = week.key === focusedKey;
          return (
            <div
              key={week.key}
              style={SLOT_STYLE}
              title={`${week.label} · ${week.outstanding} outstanding · ${week.closedWithoutDoneAt} without a done date`}
              className={`flex flex-col items-center rounded-t-sm pt-1 ${focused ? 'bg-stone-100' : ''}`}
            >
              <span
                className="flex w-full flex-col justify-end"
                style={{ height: COLUMN_GEOMETRY.plotHeight }}
              >
                <span
                  className="mx-auto w-2/3 max-w-[34px] bg-stone-500 opacity-40"
                  style={{ height: barHeight(week.closedWithoutDoneAt, max) }}
                />
                <span
                  className="mx-auto w-2/3 max-w-[34px] bg-stone-500"
                  style={{ height: barHeight(week.outstandingWithDoneDate, max) }}
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
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] leading-snug text-muted-foreground">{coverageNote}</p>
      {ghostCaveat && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{ghostCaveat}</p>
      )}
    </Panel>
  );
}
