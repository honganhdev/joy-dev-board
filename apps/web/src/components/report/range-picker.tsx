import type { RangeMeta } from '@/types';

type RangePickerProps = {
  range: RangeMeta;
  onSelect: (weeks: number) => void;
  disabled: boolean;
};

/**
 * The four whole-week presets, as the server clamped them against the mirror's
 * own history. A preset the mirror cannot answer renders disabled with its label
 * unchanged — a range control that silently changes shape reads as a bug.
 */
export function RangePicker({ range, onSelect, disabled }: RangePickerProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        Range
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
              title={
                preset.available
                  ? undefined
                  : 'The mirror has no continuous history that far back, so most of that range would be empty.'
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
