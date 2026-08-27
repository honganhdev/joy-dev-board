import { useEffect, useState } from 'react';
import { COLUMN_GEOMETRY, barHeight } from './column-geometry';
import { Panel } from './panel';
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

type SplitMode = 'category' | 'status';
type Mode = 'off' | SplitMode;
type DaySplit = WeeklyReport['daySplit'];

function modeAvailable(week: WeekSummary, mode: SplitMode, slots: number): boolean {
  if (slots === 0) return false;
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
          data-segment-index={index}
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
}: {
  label: string;
  counts: number[];
  vocabulary: Array<{ label: string }>;
  ramp: readonly string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="font-semibold text-stone-700">{label}</span>
      {vocabulary.map((row, index) => (
        <span key={`${row.label}-${index}`} className="contents">
          {index > 0 && <span aria-hidden="true">·</span>}
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className={`size-2 rounded-[2px] ${ramp[index] ?? ''}`} />
            <span>{row.label}</span>
            <span className="font-medium tabular-nums text-stone-700">{counts[index] ?? 0}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

/** Created against done inside the focused week, with one non-interactive slot per day. */
export function DayColumns({ week, daySplit }: { week: WeekSummary; daySplit?: DaySplit }) {
  const [mode, setMode] = useState<Mode>('off');
  const max = week.days.reduce(
    (tallest, day) => Math.max(tallest, day.created ?? 0, day.done ?? 0),
    0
  );
  const categoryVocabulary = Array.isArray(daySplit?.categories) ? daySplit.categories : [];
  const statusVocabulary = Array.isArray(daySplit?.statuses) ? daySplit.statuses : [];
  const available = {
    category: modeAvailable(week, 'category', categoryVocabulary.length),
    status: modeAvailable(week, 'status', statusVocabulary.length),
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
  const titleFor = (day: WeekSummary['days'][number], measured: boolean) => {
    if (!measured) return `${day.label} · no figures yet`;
    const lead = `${day.label} · ${day.created} created · ${day.done} done`;
    if (renderedMode === 'off') return lead;
    const created = day.createdSplit?.[renderedMode] ?? [];
    const done = day.doneSplit?.[renderedMode] ?? [];
    const details = (counts: number[]) =>
      vocabulary.map((row, index) => `${row.label} ${counts[index] ?? 0}`).join(', ');
    return `${lead} · created: ${details(created)} · done: ${details(done)}`;
  };

  return (
    <Panel
      title="Created vs done per day"
      aside={
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-pressed={renderedMode === 'off'}
            onClick={() => setMode('off')}
            className={buttonClass(renderedMode === 'off')}
          >
            Off
          </button>
          <button
            type="button"
            aria-pressed={renderedMode === 'category'}
            disabled={!available.category}
            title={available.category ? undefined : 'Category split data is unavailable for this week.'}
            onClick={() => setMode('category')}
            className={buttonClass(renderedMode === 'category')}
          >
            {daySplit?.modeLabels?.category}
          </button>
          <button
            type="button"
            aria-pressed={renderedMode === 'status'}
            disabled={!available.status}
            title={available.status ? undefined : 'Status split data is unavailable for this week.'}
            onClick={() => setMode('status')}
            className={buttonClass(renderedMode === 'status')}
          >
            {daySplit?.modeLabels?.status}
          </button>
        </div>
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
              title={titleFor(day, measured)}
              className="flex min-w-0 flex-col items-center"
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
                        className="block rounded-t-[2px] bg-stone-800"
                        style={{ height: barHeight(created, max), width: '100%' }}
                      />
                    ) : (
                      <StackedBar
                        counts={day.createdSplit?.[renderedMode] ?? []}
                        max={max}
                        ramp={CREATED_RAMP}
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
                        className="block rounded-t-[2px] bg-emerald-500"
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
            </div>
          );
        })}
      </div>
      {renderedMode !== 'off' && (
        <div className="mt-3 space-y-1 text-[10px] leading-snug text-muted-foreground">
          <SegmentReadout
            label="created"
            counts={week.daySplitTotals?.[renderedMode]?.created ?? []}
            vocabulary={vocabulary}
            ramp={CREATED_RAMP}
          />
          <SegmentReadout
            label="done"
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
      {renderedMode !== 'off' && daySplit?.asOfLabel && (
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
