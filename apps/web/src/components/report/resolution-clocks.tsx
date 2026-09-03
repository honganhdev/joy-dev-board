import type { ResolutionClocks as ResolutionClocksData } from '../../types';
import { Legend, Panel } from './panel';

export type ResolutionClock = keyof ResolutionClocksData['clockLabels'];

export function ResolutionClocks({
  data,
  clock,
  onClockChange,
}: {
  data: ResolutionClocksData;
  clock: ResolutionClock;
  onClockChange: (clock: ResolutionClock) => void;
}) {
  const panel = data[clock];
  const buttonClass = (selected: boolean) =>
    `rounded-md border px-2 py-1 text-[10px] focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:outline-none ${
      selected
        ? 'border-stone-800 bg-stone-800 font-semibold text-white'
        : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
    }`;

  return (
    <Panel
      title={data.clockLabels[clock]}
      aside={
        <div className="flex shrink-0 gap-1">
          {(['csReply', 'customerOk'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={clock === option}
              onClick={() => onClockChange(option)}
              className={buttonClass(clock === option)}
            >
              {data.clockLabels[option]}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend
          items={[
            { label: panel.done.label, className: 'bg-stone-500' },
            { label: panel.devDone.label, className: 'bg-stone-500 opacity-40' },
          ]}
        />
        <div className="flex gap-3 tabular-nums">
          <span className="flex items-baseline gap-1">
            <span className="text-[12px] font-semibold">{panel.done.sampleNote}</span>
            {panel.done.smallSampleNote && (
              <span className="text-[10px] text-muted-foreground">
                {panel.done.smallSampleNote}
              </span>
            )}
          </span>
          <span className="flex items-baseline gap-1">
            <span className="text-[12px] font-semibold">{panel.devDone.sampleNote}</span>
            {panel.devDone.smallSampleNote && (
              <span className="text-[10px] text-muted-foreground">
                {panel.devDone.smallSampleNote}
              </span>
            )}
          </span>
        </div>
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground tabular-nums">{panel.sampleNote}</p>

      <ul className="mt-3 space-y-1.5">
        {data.bucketLabels.map((label, index) => {
          const doneCount = panel.done.buckets[index] ?? 0;
          const devDoneCount = panel.devDone.buckets[index] ?? 0;
          const doneWidth = panel.done.barWidths[index] ?? 0;
          const devDoneWidth = panel.devDone.barWidths[index] ?? 0;
          return (
            <li key={label} className="flex items-center gap-2">
              <span className="w-40 shrink-0 text-[12px]">{label}</span>

              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="h-2.5 min-w-0 flex-1">
                  <span
                    className="block h-full rounded-[2px] bg-stone-500"
                    style={{ width: `${doneWidth}%` }}
                  />
                </span>
                <span className="w-7 shrink-0 text-right text-[11px] tabular-nums">
                  {doneCount}
                </span>
              </span>

              <span className="flex min-w-0 flex-1 items-center gap-1.5 border-l border-stone-200 pl-2.5">
                <span className="h-2.5 min-w-0 flex-1">
                  <span
                    className="block h-full rounded-[2px] bg-stone-500 opacity-40"
                    style={{ width: `${devDoneWidth}%` }}
                  />
                </span>
                <span className="w-7 shrink-0 text-right text-[11px] tabular-nums">
                  {devDoneCount}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[10px] leading-snug text-muted-foreground">{panel.scaleNote}</p>
      {panel.otherStatusNote && (
        <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
          {panel.otherStatusNote}
        </p>
      )}
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">{panel.carriedNote}</p>
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        {panel.selectionNote}
      </p>
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        {panel.unmeasuredNote}
      </p>
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">{panel.caption}</p>
    </Panel>
  );
}
