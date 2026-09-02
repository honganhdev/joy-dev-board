import { directionGlyph } from './direction';

/**
 * Every figure on the page is 32px. The one exception is the live band's pair —
 * tickets created today beside every ticket open right now — where a flow and a
 * level share a row at equal width and at one size a `1` beside a `62` read as
 * the same kind of number. There the flow drops to 24px, leaving the level a
 * third larger — a step wide enough to read as chosen rather than as two cards
 * that failed to match. The exception stops at that pair: applied page-wide it
 * reads as breakage, most of all in a row of three matching tiles.
 */
const FIGURE_SIZE = {
  page: 'text-[32px]',
  againstLevel: 'text-[24px]',
} as const;

type ComparisonFigureProps = {
  current: number;
  currentLabel: string;
  previous: number | null;
  delta: number | null;
  magnitudeLabel: string | null;
  changeLabel: string | null;
  percentLabel: string | null;
  unavailableNote: string | null;
  /** `againstLevel` only where a level sits beside this card — the live band. */
  size?: keyof typeof FIGURE_SIZE;
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
  size = 'page',
}: ComparisonFigureProps) {
  const emphasis = [directionGlyph(delta), magnitudeLabel].filter(Boolean).join(' ');
  const detail = [changeLabel, previous === null ? null : `(${previous})`].filter(Boolean).join(' ');

  return (
    <div>
      {/*
        The paragraph keeps the 32px strut whatever the numeral measures, and the
        numeral is an inline box inside it. Inline boxes sit on the strut's
        baseline, so a 24px figure here and a 32px one in the card beside it are
        written on the same line — aligning the tops instead would leave their
        baselines 6px apart, which is what an accident looks like.
      */}
      <p className="text-[32px] leading-none font-semibold tabular-nums">
        <span className={FIGURE_SIZE[size]}>{current}</span>
      </p>
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
