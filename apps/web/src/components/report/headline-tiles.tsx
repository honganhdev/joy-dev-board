import type { ReactNode } from 'react';
import { directionGlyph } from './direction';
import type { WeekSummary } from '@/types';

type HeadlineTilesProps = {
  week: WeekSummary;
  doneRule: string;
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
 *
 * The outstanding tile prints two figures rather than one. Its headline is
 * `outstandingWithDoneDate` and the line under it is the `+N` residue, the same
 * split the backlog stack draws; printing `outstanding` alone would put the
 * ghosts inside the figure read first, where a caption cannot reach them. Both
 * values come off the wire, so this does no arithmetic — and the `+N` sentence
 * is the server's, worded for the week on screen and absent when it is zero.
 *
 * All three figures are written at 32px, the size every figure on the page
 * keeps. Three matching tiles abreast are read as one row, so an odd size on
 * the third reads as a mistake however the numbers differ in kind.
 *
 * The three tile titles and the caption under the outstanding figure come off
 * the wire too. The week holding today has not finished, so `Outstanding at week
 * end` would name a Sunday that has not happened; the server words that week
 * differently and this prints whichever wording it was sent.
 */
export function HeadlineTiles({
  week,
  doneRule,
}: HeadlineTilesProps) {
  const doneMax = Math.max(1, week.done);
  const createdChange =
    week.createdComparison.previous === null
      ? null
      : [
          directionGlyph(week.createdComparison.delta),
          week.createdComparison.magnitudeLabel,
          week.createdChangeLabel,
          `(${week.createdComparison.previous})`,
        ]
          .filter(Boolean)
          .join(' ') +
        (week.createdComparison.percentLabel === null
          ? ''
          : ` · ${week.createdComparison.percentLabel}`);

  return (
    <div className="flex gap-3">
      <Tile label={week.tileLabels.created}>
        <p className="mt-1 text-[32px] leading-none font-semibold tabular-nums">{week.created}</p>
        {createdChange && (
          <p className="mt-1 inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[11px] leading-snug tabular-nums text-stone-700">
            {createdChange}
          </p>
        )}
      </Tile>

      <Tile label={week.tileLabels.done}>
        <p className="mt-1 text-[32px] leading-none font-semibold tabular-nums">{week.done}</p>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{doneRule}</p>
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

      <Tile label={week.tileLabels.outstanding}>
        <p className="mt-1 text-[32px] leading-none font-semibold tabular-nums">
          {week.outstandingWithDoneDate}
        </p>
        {week.outstandingCaveat && (
          <p className="mt-1 text-[11px] leading-snug tabular-nums text-muted-foreground">
            {week.outstandingCaveat}
          </p>
        )}
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{week.outstandingCaption}</p>
      </Tile>
    </div>
  );
}
