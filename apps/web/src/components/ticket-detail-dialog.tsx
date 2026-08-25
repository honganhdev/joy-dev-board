import { Fragment, useMemo } from 'react';
import { AlertTriangle, Check, ExternalLink, Square } from 'lucide-react';
import { DescriptionText } from '@/components/description-text';
import { StatusTimeline } from '@/components/status-timeline';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { categoryBadgeClass, categoryLabel } from '@/lib/category-style';
import { formatDate, formatFull } from '@/lib/format';
import { humanise, statusLabel } from '@/lib/status-label';
import { buildTicketTimeline } from '@/lib/ticket-timeline';
import { cn } from '@/lib/utils';
import type { StatusHistoryEntry, TicketDetail } from '@/types';

type TicketDetailDialogProps = {
  ticketId: string | null;
  detail: TicketDetail | null;
  history: StatusHistoryEntry[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  /** Hands focus back to the card. Returns false when that card is gone. */
  onRestoreFocus: () => boolean;
};

/** One small fact in the header row. Absent values are dropped, not shown as `—`. */
function Fact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap" title={title}>
      <span className="text-stone-400">{label}</span>
      <span className="text-stone-600">{value}</span>
    </span>
  );
}

/**
 * Label/value pairs. A two-column grid whose value cell can shrink, so a
 * 60-character shop domain wraps instead of widening the modal.
 */
function DetailRows({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="pt-px text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            {label}
          </dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/**
 * One block of the body.
 *
 * The heading is a full-bleed tinted band rather than a floating label: on a
 * white modal it is the cheapest thing that makes "where does this section
 * start" unmissable, and it repeats the same grammar for every block instead of
 * turning each one into a card inside an already-bounded panel.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-3 py-3.5 first:pt-0">
      <h3 className="-mx-3 mb-2.5 border-y border-stone-200 bg-stone-50 px-3 py-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The dense fact row that replaced a six-cell metadata grid. */
function Facts({ detail }: { detail: TicketDetail }) {
  const app = [detail.appName, humanise(detail.appPlan)].filter(Boolean).join(' · ');
  const facts: Array<{ label: string; value: string; title?: string }> = [];

  if (detail.ticketNumber) facts.push({ label: '#', value: detail.ticketNumber });
  if (app) facts.push({ label: 'App', value: app });
  if (detail.createdAt) {
    facts.push({ label: 'Created', value: formatDate(detail.createdAt), title: formatFull(detail.createdAt) });
  }
  if (detail.updatedAt) {
    facts.push({ label: 'Updated', value: formatDate(detail.updatedAt), title: formatFull(detail.updatedAt) });
  }
  if (detail.dueDate) {
    facts.push({ label: 'Due', value: formatDate(detail.dueDate), title: formatFull(detail.dueDate) });
  }
  // `doneAt` is set on first entry to a done-ish status and never cleared, so
  // the label says what it is rather than implying the ticket is done now.
  if (detail.doneAt) {
    facts.push({
      label: 'First done',
      value: formatDate(detail.doneAt),
      title: `${formatFull(detail.doneAt)} — when HelpDesk first saw this ticket reach a done state`,
    });
  }
  if (detail.priority) facts.push({ label: 'Priority', value: humanise(detail.priority) });
  if (typeof detail.level === 'number') facts.push({ label: 'Level', value: String(detail.level) });

  if (facts.length === 0) return null;

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px]">
      {facts.map((fact) => (
        <Fact key={fact.label} {...fact} />
      ))}
    </div>
  );
}

function DetailBody({ detail, history }: { detail: TicketDetail; history: StatusHistoryEntry[] }) {
  const timeline = useMemo(() => buildTicketTimeline(history, detail), [history, detail]);

  const store = detail.store?.[0];
  const storeRows: Array<[string, React.ReactNode]> = [];
  if (store?.shopName) storeRows.push(['Shop', store.shopName]);
  if (store?.domain) {
    storeRows.push([
      'Domain',
      <span className="font-mono text-[12px] [overflow-wrap:anywhere]">{store.domain}</span>,
    ]);
  }
  if (store?.email) {
    storeRows.push(['Email', <span className="[overflow-wrap:anywhere]">{store.email}</span>]);
  }
  if (store?.shopifyPlan) storeRows.push(['Plan', humanise(store.shopifyPlan)]);

  const links = [
    { label: 'Crisp chat', href: detail.chatLink },
    { label: 'Slack thread', href: detail.slackLink },
    {
      label: 'HelpDesk ticket',
      href: detail.shortUrl ? `https://helpdesk.avada.net${detail.shortUrl}` : null,
    },
  ].filter((link): link is { label: string; href: string } => Boolean(link.href));

  const description = detail.description?.trim();
  const tasks = detail.tasks ?? [];
  const members = detail.members ?? [];
  const tags = detail.tags ?? [];

  return (
    // Two columns keyed off the *modal's* width, not the viewport's — the modal
    // is what the layout has to fit inside.
    <div className="@container/detail">
      <div className="grid min-w-0 gap-y-1 @[54rem]/detail:grid-cols-[minmax(0,1.65fr)_minmax(20rem,1fr)] @[54rem]/detail:gap-x-6">
        <div className="min-w-0">
          <Section title="Description">
            {description ? (
              // No inner scroll: the body is the only scroll region, so the
              // wheel never gets trapped and Tasks are never hidden behind an
              // arbitrary boundary.
              <div className="max-w-[78ch] min-w-0">
                <DescriptionText text={description} />
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">No description.</p>
            )}
          </Section>

          {tasks.length > 0 && (
            <Section title={`Tasks (${tasks.length})`}>
              <ul className="space-y-1.5">
                {tasks.map((task, index) => (
                  <li key={task.id ?? index} className="flex items-start gap-2 text-[13px]">
                    {task.completed ? (
                      <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                    ) : (
                      <Square aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-stone-400" />
                    )}
                    <span
                      className={cn(
                        'min-w-0 [overflow-wrap:anywhere]',
                        task.completed && 'text-muted-foreground line-through'
                      )}
                    >
                      {task.title ?? '(untitled task)'}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="min-w-0 @[54rem]/detail:border-l @[54rem]/detail:border-stone-200 @[54rem]/detail:pl-6">
          <Section title="Status">
            <StatusTimeline timeline={timeline} />
          </Section>

          {storeRows.length > 0 && (
            <Section title="Store">
              <DetailRows rows={storeRows} />
            </Section>
          )}

          {members.length > 0 && (
            <Section title="Members">
              <ul className="flex flex-wrap gap-1.5">
                {members.map((member, index) => (
                  <li key={member.memberId ?? index} className="min-w-0">
                    <Badge
                      variant="secondary"
                      className="max-w-full font-normal whitespace-normal [overflow-wrap:anywhere]"
                    >
                      {member.displayName ?? member.memberId}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {tags.length > 0 && (
            <Section title="Tags">
              <ul className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <li key={tag.id} className="min-w-0">
                    <Badge
                      variant="outline"
                      className="max-w-full font-normal whitespace-normal [overflow-wrap:anywhere]"
                    >
                      {tag.name}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {links.length > 0 && (
            <Section title="Links">
              <ul className="space-y-1">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[13px] text-blue-700 hover:underline"
                    >
                      {link.label}
                      <ExternalLink aria-hidden="true" className="size-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Centred modal with the full HelpDesk record for one ticket.
 *
 * The header carries the hierarchy: identity and classification on one thin
 * line, the subject large enough to read first, then everything datelike
 * compressed into a single wrapping row of facts. Height follows the content
 * and only stops at the viewport, so a bare ticket gets a short modal instead of
 * a screenful of nothing.
 */
export function TicketDetailDialog({
  ticketId,
  detail,
  history,
  loading,
  error,
  onClose,
  onRestoreFocus,
}: TicketDetailDialogProps) {
  return (
    <Dialog open={ticketId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="h-auto max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none lg:max-h-[calc(100dvh-3rem)] lg:w-[min(70rem,calc(100vw-3rem))]"
        // Radix only restores focus to a trigger it rendered, and the board's
        // cards are plain elements — so the modal hands focus back itself.
        onCloseAutoFocus={(event) => {
          if (onRestoreFocus()) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 gap-2 border-b border-stone-200 px-5 py-4 pr-14 lg:px-6">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <DialogDescription className="font-mono text-[11px] tracking-tight">
              {ticketId}
            </DialogDescription>
            {detail && (
              <>
                <span
                  className={cn(
                    'rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase',
                    categoryBadgeClass(detail.category)
                  )}
                >
                  {categoryLabel(detail.category)}
                </span>
                {/* The raw value stays reachable: it is what HelpDesk search takes. */}
                <Badge variant="secondary" className="font-normal" title={detail.tsStatus ?? undefined}>
                  {statusLabel(detail.tsStatus)}
                </Badge>
                {detail.ticketStatus && detail.ticketStatus !== 'open' && (
                  <Badge variant="outline" className="font-normal">
                    {humanise(detail.ticketStatus)}
                  </Badge>
                )}
              </>
            )}
          </div>

          <DialogTitle className="text-[19px] leading-snug font-semibold [overflow-wrap:anywhere]">
            {loading ? <Skeleton className="h-6 w-3/4" /> : (detail?.subject ?? 'Ticket')}
          </DialogTitle>

          {detail && <Facts detail={detail} />}
        </DialogHeader>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 lg:px-6">
          {loading && (
            <div className="min-h-[18rem] space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}

          {!loading && error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p className="text-[13px] [overflow-wrap:anywhere]">{error}</p>
            </div>
          )}

          {!loading && !error && detail && <DetailBody detail={detail} history={history} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
