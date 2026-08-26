import { Panel } from './panel';

type OpenBreakdownProps = {
  title: string;
  rows: Array<{ key: string; label: string; count: number }>;
  notes: Array<string | null>;
};

export function OpenBreakdown({ title, rows, notes }: OpenBreakdownProps) {
  const max = rows.reduce((tallest, row) => Math.max(tallest, row.count), 0);
  const scale = Math.max(1, max);

  return (
    <Panel title={title} className="min-w-0 flex-1">
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
