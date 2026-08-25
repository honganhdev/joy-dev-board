import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BacklogColumns } from './backlog-columns';
import { DurationHistogram } from './duration-histogram';
import { HeadlineTiles } from './headline-tiles';
import { PairedBars, type PairedRow } from './paired-bars';
import { RangePicker } from './range-picker';
import { WeekColumns } from './week-columns';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useWeeklyReport } from '@/hooks/use-weekly-report';
import { categoryDotClass } from '@/lib/category-style';

function ReportSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-16 w-full rounded-lg" />
      <div className="flex gap-3">
        <Skeleton className="h-28 flex-1 rounded-lg" />
        <Skeleton className="h-28 flex-1 rounded-lg" />
        <Skeleton className="h-28 flex-1 rounded-lg" />
      </div>
      <Skeleton className="h-52 w-full rounded-lg" />
      <Skeleton className="h-52 w-full rounded-lg" />
    </div>
  );
}

function ReportError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md rounded-lg border border-destructive/30 bg-white p-6 text-center">
        <AlertTriangle className="mx-auto size-6 text-destructive" />
        <h2 className="mt-3 text-[15px] font-semibold">Could not load the report</h2>
        <p className="mt-1.5 text-[13px] break-words text-muted-foreground">{message}</p>
        <Button className="mt-4" size="sm" onClick={onRetry}>
          <RefreshCw />
          Try again
        </Button>
      </div>
    </div>
  );
}

/**
 * The report page.
 *
 * The hook is mounted here rather than in `BoardApp` so a viewer who never opens
 * the report never pays for its request. The focused week is state *here*,
 * because the response already carries every week's breakdowns: clicking a
 * column picks an element out of an array the browser is holding, and must never
 * refetch or blank the chart under the cursor.
 *
 * `pullToken` is how a pull reaches those numbers without moving the request
 * back up into `BoardApp`: the header reports a pull the whole page has to
 * honour, and a report left at its pre-pull figures under a header saying
 * "pulled just now" is worse than one that says it is loading.
 */
export function ReportView({ pullToken }: { pullToken: number }) {
  const { report, loading, error, setWeeks, reload } = useWeeklyReport(pullToken);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const weeks = report?.weeks ?? [];
  const lastKey = weeks[weeks.length - 1]?.key ?? null;
  const focusExists = focusedKey !== null && weeks.some((week) => week.key === focusedKey);

  // A new range may not contain the week that was focused in the old one.
  useEffect(() => {
    if (!focusExists) setFocusedKey(lastKey);
  }, [focusExists, lastKey]);

  if (loading) return <ReportSkeleton />;
  if (error) return <ReportError message={error} onRetry={reload} />;
  if (!report) return null;

  const focused = weeks.find((week) => week.key === focusedKey) ?? weeks[weeks.length - 1];
  if (!focused) return null;

  const categoryRows: PairedRow[] = focused.categories.map((row) => ({
    key: row.category,
    label: row.label,
    done: row.done,
    outstanding: row.outstanding,
    markerClass: categoryDotClass(row.category),
  }));

  // Priorities have no colour source and none is invented: every row takes the
  // neutral marker `PairedBars` falls back to.
  const priorityRows: PairedRow[] = focused.priorities.map((row) => ({
    key: row.priority,
    label: row.label,
    done: row.done,
    outstanding: row.outstanding,
  }));

  const footnotes: string[] = [];
  if (report.excluded.deleted > 0) {
    footnotes.push(
      `${report.excluded.deleted} deleted ${report.excluded.deleted === 1 ? 'ticket' : 'tickets'}`
    );
  }
  if (report.excluded.unparseableDate > 0) {
    footnotes.push(
      `${report.excluded.unparseableDate} ${
        report.excluded.unparseableDate === 1 ? 'ticket' : 'tickets'
      } with an unreadable date`
    );
  }
  // Neither a created nor a done date: in no week, so in no figure on this page,
  // and still counted in the live open total. Named here or it vanishes.
  if (report.excluded.undated > 0) {
    footnotes.push(
      `${report.excluded.undated} ${
        report.excluded.undated === 1 ? 'ticket' : 'tickets'
      } with no created or done date`
    );
  }

  return (
    <div className="space-y-3 pb-4">
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-4">
          <RangePicker range={report.range} onSelect={setWeeks} disabled={loading} />
          <span className="ml-auto text-[12px] font-medium">{focused.label}</span>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{report.doneRule}</p>
      </section>

      <HeadlineTiles week={focused} openRightNow={report.openRightNow} />

      <WeekColumns weeks={weeks} focusedKey={focused.key} onFocus={setFocusedKey} />

      <BacklogColumns
        weeks={weeks}
        focusedKey={focused.key}
        coverageNote={report.range.coverageNote}
        ghostCaveat={report.ghosts.caveat}
      />

      <div className="flex gap-3">
        <PairedBars
          title="By category — this week"
          rows={categoryRows}
          emptyMessage="No tickets in either cohort this week."
        />
        <PairedBars
          title="By priority — this week"
          rows={priorityRows}
          emptyMessage="No tickets in either cohort this week."
        />
      </div>

      <DurationHistogram data={report.timeToFirstDone} />

      {footnotes.length > 0 && (
        <p className="px-1 text-[11px] text-muted-foreground">
          Not counted: {footnotes.join(' · ')}.
        </p>
      )}
    </div>
  );
}
