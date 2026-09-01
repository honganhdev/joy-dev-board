import { directionGlyph } from './direction';

type ComparisonFigureProps = {
  current: number;
  currentLabel: string;
  previous: number | null;
  delta: number | null;
  magnitudeLabel: string | null;
  changeLabel: string | null;
  percentLabel: string | null;
  unavailableNote: string | null;
};

export function ComparisonFigure({
  current,
  currentLabel,
  previous,
  delta,
  magnitudeLabel,
  changeLabel,
  percentLabel,
  unavailableNote,
}: ComparisonFigureProps) {
  const emphasis = [directionGlyph(delta), magnitudeLabel].filter(Boolean).join(' ');
  const detail = [changeLabel, previous === null ? null : `(${previous})`].filter(Boolean).join(' ');

  return (
    <div>
      {/*
        A count of what arrived over a stretch of time, so it is deliberately a
        step below the 32px the live and week-end levels keep. The two sit side
        by side in the live band — tickets created today beside every ticket
        open right now — and at one size a flow of 1 and a level of 47 read as
        the same kind of number.
      */}
      <p className="text-[26px] leading-none font-semibold tabular-nums">{current}</p>
      <p className="text-[10px] text-muted-foreground">{currentLabel}</p>
      <p className="mt-1 text-[11px] tabular-nums">
        {previous === null ? (
          unavailableNote
        ) : (
          <>
            {emphasis && <span className="font-semibold">{emphasis}</span>}
            {emphasis && detail && ' '}
            {detail}
            {percentLabel !== null && (
              <span className="text-muted-foreground"> · {percentLabel}</span>
            )}
          </>
        )}
      </p>
    </div>
  );
}
