import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const COLUMN_LABELS = ['DEV FIXING', 'DOING', 'WAITING CUSTOMER', 'DEV DONE', 'DONE'];

/** Five column shells with card-shaped skeletons while the first pull runs. */
export function BoardSkeleton() {
  return (
    <div className="flex h-full min-h-0 gap-4">
      {COLUMN_LABELS.map((label, columnIndex) => (
        <section
          key={label}
          className="flex min-h-0 flex-1 flex-col rounded-lg border border-stone-200 bg-white"
          aria-label={`${label} loading`}
        >
          <header className="flex items-center gap-2 px-4 py-3">
            <span className="flex-1 text-[11px] font-bold tracking-wider text-stone-400 uppercase">
              {label}
            </span>
            <Skeleton className="h-4 w-6 rounded-full" />
          </header>
          <div className="space-y-3 px-3 pb-3">
            {Array.from({ length: 4 - (columnIndex % 2) }).map((_, index) => (
              <Skeleton key={index} className="h-[104px] w-full rounded-md" />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

type BoardErrorProps = {
  message: string;
  onRetry: () => void;
  retrying: boolean;
};

/** Shown instead of the board — an empty board must never stand in for a failure. */
export function BoardError({ message, onRetry, retrying }: BoardErrorProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md rounded-lg border border-destructive/30 bg-white p-6 text-center">
        <AlertTriangle className="mx-auto size-6 text-destructive" />
        <h2 className="mt-3 text-[15px] font-semibold">Could not load the board</h2>
        <p className="mt-1.5 text-[13px] break-words text-muted-foreground">{message}</p>
        <Button className="mt-4" size="sm" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={retrying ? 'animate-spin' : undefined} />
          Try again
        </Button>
      </div>
    </div>
  );
}
