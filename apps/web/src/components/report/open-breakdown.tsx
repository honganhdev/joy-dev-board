import { Panel } from './panel';

export type OpenBreakdownScope = 'createdInRange' | 'stillOpen';

type OpenBreakdownProps = {
  title: string;
  rows: Array<{ key: string; label: string; count: number }>;
  notes: Array<string | null>;
  scope: OpenBreakdownScope;
  scopeLabels: { createdInRange: string; stillOpen: string };
  onScopeChange: (scope: OpenBreakdownScope) => void;
};

export function OpenBreakdown({
  title,
  rows,
  notes,
  scope,
  scopeLabels,
  onScopeChange,
}: OpenBreakdownProps) {
  const max = rows.reduce((tallest, row) => Math.max(tallest, row.count), 0);
  const scale = Math.max(1, max);
  const buttonClass = (selected: boolean) =>
    `rounded-md border px-2 py-1 text-[10px] focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:outline-none ${
      selected
        ? 'border-stone-800 bg-stone-800 font-semibold text-white'
        : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
    }`;

  return (
    <Panel
      title={title}
      className="min-w-0 flex-1"
      aside={
        <div className="flex shrink-0 gap-1">
          {(['createdInRange', 'stillOpen'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={scope === option}
              onClick={() => onScopeChange(option)}
              className={buttonClass(scope === option)}
            >
              {scopeLabels[option]}
            </button>
          ))}
        </div>
      }
    >
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span className="w-[42%] shrink-0 truncate text-[12px]" title={row.label}>
              {row.label}
            </span>
            <span className="h-2.5 min-w-0 flex-1">
              <span
                className="block h-full rounded-[2px] bg-stone-500"
                style={{ width: `${(row.count / scale) * 100}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right text-[11px] tabular-nums">{row.count}</span>
          </li>
        ))}
      </ul>
      {notes.map(
        (note, index) =>
          note && (
            <p key={index} className="mt-2 text-[10px] leading-snug text-muted-foreground">
              {note}
            </p>
          )
      )}
    </Panel>
  );
}
