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
      <p className="text-[32px] leading-none font-semibold tabular-nums">{current}</p>
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
