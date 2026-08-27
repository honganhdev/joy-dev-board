import { useEffect, useState } from 'react';
import { COLUMN_GEOMETRY, barHeight } from './column-geometry';
import { Legend, Panel } from './panel';
import { drawnSegments, stackHeights } from './segment-geometry';
import type { WeeklyReport, WeekSummary } from '@/types';

/**
 * The bar column: the plot, plus the value label sitting above the taller bar.
 * The label is `text-[11px]` under the document's 1.5 line-height, so it takes
 * 16.5px, and `mb-1` adds 4 — budget 21, not the 18 the font size suggests. Too
 * small and the column shrinks its only shrinkable child, so the tallest bar in
 * the panel is the one that draws short.
 */
const BAR_COLUMN_HEIGHT = COLUMN_GEOMETRY.plotHeight + 21;

const DAY_SLOT_STYLE = {
  flex: '1 1 0',
  minWidth: 48,
} as const;

const BAR_GROUP_STYLE = {
  width: '50%',
  maxWidth: 40,
  height: '100%',
} as const;

const CREATED_SOLID = 'bg-stone-800';
const DONE_SOLID = 'bg-emerald-500';

const CREATED_RAMP = [
  'bg-stone-900',
  'bg-stone-700',
  'bg-stone-600',
  'bg-stone-500',
  'bg-stone-400',
  'bg-stone-300',
] as const;

const DONE_RAMP = [
  'bg-emerald-900',
  'bg-emerald-700',
  'bg-emerald-600',
  'bg-emerald-500',
  'bg-emerald-400',
  'bg-emerald-300',
] as const;

/**
 * The created cohort the status split leaves out, drawn rather than left as a
 * gap. A stack that simply stops short under a taller printed number is the same
 * picture a wrong payload would draw, so the excluded tickets take the bar up to
 * the figure above it as a hatch — a region that reads as not filled in.
 *
 * Written out as a literal class: Tailwind v4 scans source text, so a class name
 * assembled at runtime matches nothing and generates no CSS.
 */
const EXCLUDED_HATCH =
  'bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,#d6d3d1_3px,#d6d3d1_5px)]';

type SplitMode = 'category' | 'status';
type Mode = 'off' | SplitMode;
type DaySplit = WeeklyReport['daySplit'];
type Day = WeekSummary['days'][number];

/**
 * Whether a split can be drawn at all. Two shape contracts, not one: the counts
 * have to be present and as long as the range vocabulary, *and* the vocabulary
 * has to fit the colour ramp this file owns. The second is what stops a longer
 * server-side vocabulary from rendering a real label and a real count beside an
 * uncoloured, invisible segment.
 */
function modeAvailable(
  week: WeekSummary,
  mode: SplitMode,
  slots: number,
  rampLength: number
): boolean {
  if (slots === 0 || slots > rampLength) return false;
  if (
    !Array.isArray(week.daySplitTotals?.[mode]?.created) ||
    week.daySplitTotals[mode].created.length !== slots ||
    !Array.isArray(week.daySplitTotals?.[mode]?.done) ||
    week.daySplitTotals[mode].done.length !== slots
  ) {
    return false;
  }
  return week.days.every((day) => {
    const measured = day.created !== null && day.done !== null;
    if (!measured) return day.createdSplit == null && day.doneSplit == null;
    return (
      Array.isArray(day.createdSplit?.[mode]) &&
      day.createdSplit[mode].length === slots &&
      Array.isArray(day.doneSplit?.[mode]) &&
      day.doneSplit[mode].length === slots
    );
  });
}

function StackedBar({
  counts,
  max,
  ramp,
}: {
  counts: number[];
  max: number;
  ramp: readonly string[];
}) {
  const heights = stackHeights(counts, max);
  const drawn = drawnSegments(counts);
  const top = drawn.at(-1);

  return (
    <span
      className="flex flex-col-reverse justify-start"
      style={{ height: COLUMN_GEOMETRY.plotHeight, width: '100%' }}
    >
      {drawn.map((index) => (
        <span
          key={index}
          className={`block ${index === top ? 'rounded-t-[2px]' : ''} ${ramp[index] ?? ''}`}
          style={{ height: heights[index] ?? 0, width: '100%' }}
        />
      ))}
    </span>
  );
}

function SegmentReadout({
  label,
  counts,
  vocabulary,
  ramp,
  trailing,
}: {
  label: string;
  counts: number[];
  vocabulary: Array<{ label: string }>;
  ramp: readonly string[];
  trailing?: { label: string; count: number; className: string };
}) {
  const rows = [
    ...vocabulary.map((row, index) => ({
      label: row.label,
      count: counts[index] ?? 0,
      className: ramp[index] ?? '',
    })),
    ...(trailing ? [trailing] : []),
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="font-semibold text-stone-700">{label}</span>
      {rows.map((row, index) => (
        <span key={`${row.label}-${index}`} className="contents">
          {index > 0 && <span aria-hidden="true">·</span>}
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className={`size-2 rounded-[2px] ${row.className}`} />
            <span>{row.label}</span>
            <span className="font-medium tabular-nums text-stone-700">{row.count}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

/** Created against done inside the focused week, with one slot per day. */
export function DayColumns({ week, daySplit }: { week: WeekSummary; daySplit?: DaySplit }) {
  const [mode, setMode] = useState<Mode>('off');
  const [openDay, setOpenDay] = useState<string | null>(null);
  const max = week.days.reduce(
    (tallest, day) => Math.max(tallest, day.created ?? 0, day.done ?? 0),
    0
  );
  const categoryVocabulary = Array.isArray(daySplit?.categories) ? daySplit.categories : [];
  const statusVocabulary = Array.isArray(daySplit?.statuses) ? daySplit.statuses : [];
  const cohortLabels = daySplit?.cohortLabels ?? null;
  const modeLabels = daySplit?.modeLabels ?? null;
  // Both ramps have to cover the vocabulary, so the shorter one is the contract.
  const rampLength = Math.min(CREATED_RAMP.length, DONE_RAMP.length);
  const available = {
    category: modeAvailable(week, 'category', categoryVocabulary.length, rampLength),
    status: modeAvailable(week, 'status', statusVocabulary.length, rampLength),
  };
  const renderedMode: Mode = mode !== 'off' && available[mode] ? mode : 'off';

  useEffect(() => {
    if (mode !== 'off' && !available[mode]) setMode('off');
  }, [available.category, available.status, mode]);

  const buttonClass = (selected: boolean) =>
    `rounded-md border px-2 py-1 text-[10px] focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
      selected
        ? 'border-stone-800 bg-stone-800 font-semibold text-white'
        : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
    }`;
  const vocabulary =
    renderedMode === 'category'
      ? categoryVocabulary
      : renderedMode === 'status'
        ? statusVocabulary
        : [];
  /**
   * The status split's created bar carries one more slot than the vocabulary:
   * the day's excluded tickets, hatched, taking the stack up to `created`.
   */
  const excludedSlot = renderedMode === 'status';
  const createdRamp = excludedSlot
    ? [...CREATED_RAMP.slice(0, vocabulary.length), EXCLUDED_HATCH]
    : CREATED_RAMP;
  const createdCounts = (day: Day, splitMode: SplitMode) => {
    const counts = day.createdSplit?.[splitMode] ?? [];
    return excludedSlot ? [...counts, day.createdClosedWithoutDoneAt ?? 0] : counts;
  };

  /**
   * The day's whole vector as one sentence. It is the slot's accessible name and
   * the line the slot opens when it is activated, so the per-segment numbers are
   * reachable by keyboard, by touch and by a reader who cannot separate the
   * hues — none of which a hover title reaches.
   */
  const describeDay = (day: Day, measured: boolean) => {
    if (!measured) return `${day.label} · no figures yet`;
    if (!cohortLabels) return `${day.label} · ${day.created} · ${day.done}`;
    const parts = [
      day.label,
      `${day.created} ${cohortLabels.created}`,
      `${day.done} ${cohortLabels.done}`,
    ];
    if (renderedMode !== 'off') {
      const details = (counts: number[]) =>
        vocabulary.map((row, index) => `${row.label} ${counts[index] ?? 0}`).join(', ');
      const excluded =
        excludedSlot && daySplit
          ? `, ${daySplit.excludedLabel} ${day.createdClosedWithoutDoneAt ?? 0}`
          : '';
      parts.push(
        `${cohortLabels.created}: ${details(day.createdSplit?.[renderedMode] ?? [])}${excluded}`,
        `${cohortLabels.done}: ${details(day.doneSplit?.[renderedMode] ?? [])}`
      );
    }
    return parts.join(' · ');
  };

  const openDetail = week.days.find((day) => day.label === openDay);

  return (
    <Panel
      title="Created vs done per day"
      aside={
        <div className="flex shrink-0 items-center gap-3">
          {renderedMode === 'off' && cohortLabels && (
            <Legend
              items={[
                { label: cohortLabels.created, className: CREATED_SOLID },
                { label: cohortLabels.done, className: DONE_SOLID },
              ]}
            />
          )}
          {modeLabels?.off && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={renderedMode === 'off'}
                onClick={() => setMode('off')}
                className={buttonClass(renderedMode === 'off')}
              >
                {modeLabels.off}
              </button>
              {(['category', 'status'] as const).map((splitMode) =>
                modeLabels[splitMode] ? (
                  <button
                    key={splitMode}
                    type="button"
                    aria-pressed={renderedMode === splitMode}
                    disabled={!available[splitMode]}
                    title={
                      available[splitMode] ? undefined : daySplit?.unavailableNotes?.[splitMode]
                    }
                    onClick={() => setMode(splitMode)}
                    className={buttonClass(renderedMode === splitMode)}
                  >
                    {modeLabels[splitMode]}
                  </button>
                ) : null
              )}
            </div>
          )}
        </div>
      }
    >
      <div className="flex items-end" style={{ gap: 12 }}>
        {week.days.map((day) => {
          const created = day.created;
          const done = day.done;
          const measured = created !== null && done !== null;
          const description = describeDay(day, measured);
          return (
            <button
              key={day.label}
              type="button"
              style={DAY_SLOT_STYLE}
              title={description}
              aria-label={description}
              aria-pressed={openDay === day.label}
              onClick={() => setOpenDay(openDay === day.label ? null : day.label)}
              className="flex min-w-0 flex-col items-center rounded-sm focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:outline-none"
            >
              {measured ? (
                <span
                  className="flex items-end justify-center"
                  style={{ gap: 6, height: BAR_COLUMN_HEIGHT, width: '100%' }}
                >
                  <span
                    className="flex flex-col items-center justify-end"
                    style={BAR_GROUP_STYLE}
                  >
                    <span className="mb-1 text-[11px] font-medium tabular-nums">{created}</span>
                    {renderedMode === 'off' ? (
                      <span
                        className={`block rounded-t-[2px] ${CREATED_SOLID}`}
                        style={{ height: barHeight(created, max), width: '100%' }}
                      />
                    ) : (
                      <StackedBar
                        counts={createdCounts(day, renderedMode)}
                        max={max}
                        ramp={createdRamp}
                      />
                    )}
                  </span>
                  <span
                    className="flex flex-col items-center justify-end"
                    style={BAR_GROUP_STYLE}
                  >
                    <span className="mb-1 text-[11px] font-medium tabular-nums">{done}</span>
                    {renderedMode === 'off' ? (
                      <span
                        className={`block rounded-t-[2px] ${DONE_SOLID}`}
                        style={{ height: barHeight(done, max), width: '100%' }}
                      />
                    ) : (
                      <StackedBar
                        counts={day.doneSplit?.[renderedMode] ?? []}
                        max={max}
                        ramp={DONE_RAMP}
                      />
                    )}
                  </span>
                </span>
              ) : (
                <span
                  className="flex items-end justify-center text-[15px] font-semibold text-muted-foreground"
                  style={{ height: BAR_COLUMN_HEIGHT }}
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
            </button>
          );
        })}
      </div>
      {openDetail && (
        <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
          {describeDay(openDetail, openDetail.created !== null && openDetail.done !== null)}
        </p>
      )}
      {renderedMode !== 'off' && cohortLabels && (
        <div className="mt-3 space-y-1 text-[10px] leading-snug text-muted-foreground">
          <SegmentReadout
            label={cohortLabels.created}
            counts={week.daySplitTotals?.[renderedMode]?.created ?? []}
            vocabulary={vocabulary}
            ramp={CREATED_RAMP}
            trailing={
              excludedSlot && daySplit
                ? {
                    label: daySplit.excludedLabel,
                    count: week.createdClosedWithoutDoneAt,
                    className: EXCLUDED_HATCH,
                  }
                : undefined
            }
          />
          <SegmentReadout
            label={cohortLabels.done}
            counts={week.daySplitTotals?.[renderedMode]?.done ?? []}
            vocabulary={vocabulary}
            ramp={DONE_RAMP}
          />
        </div>
      )}
      {renderedMode !== 'off' && daySplit?.captions?.[renderedMode] && (
        <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
          {daySplit.captions[renderedMode]}
        </p>
      )}
      {daySplit?.asOfLabel && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{daySplit.asOfLabel}</p>
      )}
      {renderedMode === 'status' && week.createdClosedWithoutDoneAtNote && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          {week.createdClosedWithoutDoneAtNote}
        </p>
      )}
      {week.daysHighlight && (
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">{week.daysHighlight}</p>
      )}
      {week.daysNote && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{week.daysNote}</p>
      )}
    </Panel>
  );
}
