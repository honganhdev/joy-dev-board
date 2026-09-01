import type { RangeMeta } from '@/types';

type RangePickerProps = {
  range: RangeMeta;
  onSelect: (weeks: number) => void;
  disabled: boolean;
};

/**
 * The id of the sentence explaining one withheld preset. Composed here so the
 * button and the note on the page cannot drift onto different ids: several
 * presets are withheld at once for most of a year, and each carries its own
 * reason naming its own span.
 */
export function withheldNoteId(weeks: number): string {
  return `report-range-withheld-${weeks}`;
}

/**
 * The four whole-week presets, as the server clamped them against the mirror's
 * own history. A preset the mirror cannot answer renders disabled with its label
 * unchanged — a range control that silently changes shape reads as a bug.
 *
 * Why it is withheld is the server's sentence, not one written here: an
 * explanation composed in the browser goes on describing whichever rule was in
 * force when it was typed, long after the server stopped applying it.
 */
export function RangePicker({ range, onSelect, disabled }: RangePickerProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        History
      </span>
      <div className="flex items-center gap-1">
        {range.presets.map((preset) => {
          const selected = preset.weeks === range.selectedWeeks;
          return (
            <button
              key={preset.weeks}
              type="button"
              disabled={disabled || !preset.available}
              onClick={() => onSelect(preset.weeks)}
              aria-describedby={
                preset.unavailableNote ? withheldNoteId(preset.weeks) : undefined
              }
              className={`rounded-md border px-2.5 py-1 text-[12px] tabular-nums disabled:cursor-not-allowed disabled:opacity-40 ${
                selected
                  ? 'border-stone-800 bg-stone-800 font-semibold text-white'
                  : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
