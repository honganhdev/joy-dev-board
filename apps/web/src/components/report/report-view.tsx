import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { BacklogColumns } from './backlog-columns';
import { BacklogAge } from './backlog-age';
import { DayColumns } from './day-columns';
import { DurationHistogram } from './duration-histogram';
import { FeatureBreakdown } from './feature-breakdown';
import { HeadlineTiles } from './headline-tiles';
import { PairedBars, type PairedRow } from './paired-bars';
import { OpenBreakdown } from './open-breakdown';
import { RangePicker } from './range-picker';
import { SectionDivider } from './section-divider';
import { WeekColumns } from './week-columns';
import { WeeklySpeed } from './weekly-speed';
import { neighbourKeys, resolveFocusedWeek } from './week-focus';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useWeeklyReport } from '@/hooks/use-weekly-report';
import { categoryDotClass } from '@/lib/category-style';

function ReportSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {/* Matches the subject card approximately; server-owned copy wrapping can make it drift. */}
      <Skeleton className="h-[122px] w-full rounded-lg" />
      <div className="flex gap-3">
        <Skeleton className="h-28 flex-1 rounded-lg" />
        <Skeleton className="h-28 flex-1 rounded-lg" />
        <Skeleton className="h-28 flex-1 rounded-lg" />
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
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

  if (loading) return <ReportSkeleton />;
  if (error) return <ReportError message={error} onRetry={reload} />;
  if (!report) return null;

  const focused = resolveFocusedWeek(weeks, focusedKey);
  const { previous, next } = neighbourKeys(weeks, focused?.key ?? null);
  if (!focused) return null;

  const categoryRows: PairedRow[] = focused.categories.map((row) => ({
    key: row.category,
    label: row.label,
    done: row.done,
    outstanding: row.outstanding,
    markerClass: categoryDotClass(row.category),
  }));

  return (
    <div className="space-y-3 pb-4">
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="ghost"
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
            aria-disabled={previous === null}
            onClick={() => previous !== null && setFocusedKey(previous)}
            aria-label="Previous week"
            title="Previous week"
          >
            <ChevronLeft />
          </Button>
          <span className="text-[15px] font-semibold">{focused.label}</span>
          <Button
            size="icon-sm"
            variant="ghost"
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
            aria-disabled={next === null}
            onClick={() => next !== null && setFocusedKey(next)}
            aria-label="Next week"
            title="Next week"
          >
            <ChevronRight />
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{report.doneRule}</p>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {report.timeZoneNote}
        </p>
      </section>

      <HeadlineTiles
        week={focused}
        openRightNow={report.openRightNow}
        agingHeadline={report.openBacklog.agingHeadline}
      />

      <DayColumns week={focused} />

      <PairedBars
        title="By category"
        rows={categoryRows}
        emptyMessage="No tickets in either cohort."
      />

      <SectionDivider title={report.trendSectionTitle} />

      <div className="px-1">
        <RangePicker range={report.range} onSelect={setWeeks} disabled={loading} />
      </div>

      <WeekColumns weeks={weeks} focusedKey={focused.key} onFocus={setFocusedKey} />

      <BacklogColumns
        weeks={weeks}
        focusedKey={focused.key}
        title={report.backlogTitle}
        coverageNote={report.range.coverageNote}
        ghostCaveat={report.ghosts.caveat}
      />

      <WeeklySpeed
        weeks={weeks}
        caption={report.weeklySpeed.caption}
        emptyWeeksNote={report.weeklySpeed.emptyWeeksNote}
      />

      <DurationHistogram data={report.timeToFirstDone} />

      <SectionDivider title={report.openSectionTitle} />

      <BacklogAge data={report.openBacklog} />

      <div className="space-y-3">
        <OpenBreakdown
          title="By service plan"
          rows={report.openByPlan.rows}
          notes={[report.openByPlan.freeNote]}
        />
        <OpenBreakdown
          title="By merchant"
          rows={report.openByMerchant.rows}
          notes={[report.openByMerchant.concentrationNote, report.openByMerchant.tailNote]}
        />
      </div>

      <FeatureBreakdown data={report.openByFeature} />

      {/*
        What reached no week, named so nothing vanishes silently — in the
        server's own words. The wording is not "not counted": an undated ticket
        that is open is still in the live open figure above.
      */}
      {report.excludedNote && (
        <p className="px-1 text-[11px] text-muted-foreground">{report.excludedNote}</p>
      )}
    </div>
  );
}
