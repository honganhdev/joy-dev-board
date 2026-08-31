import type { ReactNode } from 'react';

type SectionDividerProps = {
  title: string;
  aside?: ReactNode;
  note?: ReactNode;
};

export function SectionDivider({ title, aside, note }: SectionDividerProps) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-1 py-2">
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </span>
        {aside && <div className="shrink-0">{aside}</div>}
        <span className="h-px min-w-8 flex-1 bg-stone-200" />
      </div>
      {note && (
        <div className="px-1 text-[10px] leading-snug text-muted-foreground">{note}</div>
      )}
    </>
  );
}
