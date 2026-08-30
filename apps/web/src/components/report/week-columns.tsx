import { COLUMN_GEOMETRY, SLOT_STYLE, barHeight } from './column-geometry';
import { directionGlyph } from './direction';
import { Legend, Panel } from './panel';
import type { WeeklyReport, WeekSummary } from '@/types';

type WeekColumnsProps = {
  weeks: WeekSummary[];
  focusedKey: string;
  onFocus: (key: string) => void;
  growth: WeeklyReport['weeklyGrowth'];
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
export function WeekColumns({ weeks, focusedKey, onFocus, growth }: WeekColumnsProps) {
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
      {growth.unavailableNote ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {growth.unavailableNote}
        </p>
      ) : (
        <>
          {/* The row shares its panel with the created and done bars, whose legend
              names only those two, so nothing else says these figures track
              created only. Set in the page's label idiom rather than as prose:
              the panel's sentence budget below the chart is for explanation. */}
          <h3 className="mt-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            {growth.title}
          </h3>
          <div className="mt-1 flex items-end" style={{ gap: COLUMN_GEOMETRY.gap }}>
            {weeks.map((week) => {
              // Glyph plus unsigned magnitude, the same vocabulary as the
              // comparison cards: the glyph already says which way, so a signed
              // figure beside it would state the direction twice. A week with no
              // earlier week to compare against prints its bare count instead.
              const magnitude =
                week.createdComparison.previous === null
                  ? week.createdDeltaLabel
                  : week.createdComparison.magnitudeLabel;
              const seen = [directionGlyph(week.createdComparison.delta), magnitude]
                .filter(Boolean)
                .join(' ');
              // The glyph is the only thing carrying direction on screen, and it
              // reads as a triangle or as nothing at all. The same figure in the
              // server's words goes to assistive technology instead.
              const heard = [magnitude, week.createdChangeLabel].filter(Boolean).join(' ');
              return (
                <div
                  key={week.key}
                  style={SLOT_STYLE}
                  title={week.label}
                  className="flex min-w-0 flex-col items-center border-t border-stone-200 pt-2"
                >
                  <span className="text-[10px] font-semibold tabular-nums">
                    <span aria-hidden="true">{seen}</span>
                    <span className="sr-only">{heard}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{growth.direction}</p>
      {growth.horizonNote && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          {growth.horizonNote}
        </p>
      )}
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{growth.caption}</p>
    </Panel>
  );
}
