import type { ReactNode } from 'react';
import type { WeekSummary } from '@/types';

type HeadlineTilesProps = {
  week: WeekSummary;
  devFixOpenRightNow: number;
  devFixOpenRightNowLabel: string;
  agingHeadline: string | null;
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
 * The live figure under it is labelled by the server too. It counts only the
 * dev-fix tickets, which is not what the payload's `openRightNow` counts, so the
 * label has to name its cohort — and naming it here would be the browser
 * composing prose about a number it did not decide.
 *
 * The three tile titles and the caption under the outstanding figure come off
 * the wire too. The week holding today has not finished, so `Outstanding at week
 * end` would name a Sunday that has not happened; the server words that week
 * differently and this prints whichever wording it was sent.
 */
export function HeadlineTiles({
  week,
  devFixOpenRightNow,
  devFixOpenRightNowLabel,
  agingHeadline,
}: HeadlineTilesProps) {
  const doneMax = Math.max(1, week.done);

  return (
    <div className="flex gap-3">
      <Tile label={week.tileLabels.created}>
        <p className="mt-1 text-[32px] leading-none font-semibold tabular-nums">{week.created}</p>
      </Tile>

      <Tile label={week.tileLabels.done}>
        <p className="mt-1 text-[32px] leading-none font-semibold tabular-nums">{week.done}</p>
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
        <p className="mt-2 text-[11px] text-muted-foreground">
          {devFixOpenRightNowLabel} <span className="tabular-nums">{devFixOpenRightNow}</span>
        </p>
        {agingHeadline && (
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{agingHeadline}</p>
        )}
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{week.outstandingCaption}</p>
      </Tile>
    </div>
  );
}
