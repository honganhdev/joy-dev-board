export function SectionDivider({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 px-1 py-2">
      <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </span>
      <span className="h-px min-w-8 flex-1 bg-stone-200" />
    </div>
  );
}
