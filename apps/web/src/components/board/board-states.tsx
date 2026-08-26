import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/** Five unlabeled shells while the server resolves the shared column setting. */
export function BoardSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 gap-4"
      aria-busy="true"
      aria-label="Loading the board"
    >
      {Array.from({ length: 5 }).map((_, columnIndex) => (
        <section
          key={columnIndex}
          className="flex min-h-0 flex-1 flex-col rounded-lg border border-stone-200 bg-white"
          aria-hidden="true"
        >
          <header className="flex items-center gap-2 px-4 py-3">
            <Skeleton className="h-4 flex-1" />
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
