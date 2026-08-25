import type { ReactNode } from 'react';

type PanelProps = {
  title: string;
  /** Legend or caption shown on the header's right, opposite the title. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** The report's one container: white card, hairline border, uppercase section label. */
export function Panel({ title, aside, children, className }: PanelProps) {
  return (
    <section className={`rounded-lg border border-stone-200 bg-white p-4 ${className ?? ''}`}>
      <header className="mb-3 flex items-baseline gap-3">
        <h2 className="flex-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** The two-swatch key both column panels and both bar panels carry. */
export function Legend({ items }: { items: Array<{ label: string; className: string }> }) {
  return (
    <div className="flex shrink-0 items-center gap-3 text-[10px] text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={`size-2.5 rounded-[2px] ${item.className}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
