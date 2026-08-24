import { AlertTriangle, Check, ExternalLink, Square } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusTimeline } from '@/components/status-timeline';
import { categoryBadgeClass, categoryLabel } from '@/lib/category-style';
import { formatFull } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { StatusHistoryEntry, TicketDetail } from '@/types';

type TicketDetailSheetProps = {
  ticketId: string | null;
  detail: TicketDetail | null;
  history: StatusHistoryEntry[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] break-words">{value ?? '—'}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-stone-200 pt-4">
      <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function DetailBody({ detail, history }: { detail: TicketDetail; history: StatusHistoryEntry[] }) {
  const store = detail.store?.[0];
  const links = [
    { label: 'Crisp chat', href: detail.chatLink },
    { label: 'Slack thread', href: detail.slackLink },
    {
      label: 'HelpDesk ticket',
      href: detail.shortUrl ? `https://helpdesk.avada.net${detail.shortUrl}` : null,
    },
  ].filter((link): link is { label: string; href: string } => Boolean(link.href));

  return (
    <div className="space-y-4 px-4 pb-8 text-foreground">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase',
            categoryBadgeClass(detail.category)
          )}
        >
          {categoryLabel(detail.category)}
        </span>
        {detail.tsStatus && <Badge variant="secondary">{detail.tsStatus}</Badge>}
        {detail.ticketStatus && <Badge variant="outline">{detail.ticketStatus}</Badge>}
        {detail.priority && <Badge variant="outline">priority: {detail.priority}</Badge>}
        {typeof detail.level === 'number' && <Badge variant="outline">level {detail.level}</Badge>}
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <Field label="Ticket number" value={<span className="font-mono">{detail.ticketNumber ?? '—'}</span>} />
        <Field label="App" value={`${detail.appName ?? '—'} · ${detail.appPlan ?? '—'}`} />
        <Field label="Created" value={formatFull(detail.createdAt)} />
        <Field label="Updated" value={formatFull(detail.updatedAt)} />
        <Field label="Due" value={formatFull(detail.dueDate)} />
      </dl>

      <Section title="Status timeline">
        <StatusTimeline entries={history} />
      </Section>

      <Section title="Description">
        {detail.description?.trim() ? (
          // Descriptions are multi-paragraph and sometimes contain pasted JSON,
          // so line breaks are preserved verbatim.
          <p className="rounded-md bg-stone-50 p-3 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
            {detail.description}
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">No description.</p>
        )}
      </Section>

      <Section title="Store">
        {store ? (
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Shop" value={store.shopName ?? '—'} />
            <Field label="Domain" value={<span className="font-mono text-[12px]">{store.domain ?? '—'}</span>} />
            <Field label="Email" value={store.email ?? '—'} />
            <Field label="Shopify plan" value={store.shopifyPlan ?? '—'} />
          </dl>
        ) : (
          <p className="text-[13px] text-muted-foreground">No store attached.</p>
        )}
      </Section>

      <Section title="Members">
        {detail.members?.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {detail.members.map((member, index) => (
              <li key={member.memberId ?? index}>
                <Badge variant="secondary">{member.displayName ?? member.memberId}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">No members assigned.</p>
        )}
      </Section>

      <Section title={`Tasks (${detail.tasks?.length ?? 0})`}>
        {detail.tasks?.length ? (
          <ul className="space-y-1.5">
            {detail.tasks.map((task, index) => (
              <li key={task.id ?? index} className="flex items-start gap-2 text-[13px]">
                {task.completed ? (
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                ) : (
                  <Square className="mt-0.5 size-3.5 shrink-0 text-stone-400" />
                )}
                <span className={task.completed ? 'text-muted-foreground line-through' : undefined}>
                  {task.title ?? '(untitled task)'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">No tasks.</p>
        )}
      </Section>

      <Section title="Tags">
        {detail.tags?.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {detail.tags.map((tag) => (
              <li key={tag.id}>
                <Badge variant="outline">{tag.name}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">No tags.</p>
        )}
      </Section>

      <Section title="Links">
        {links.length ? (
          <ul className="space-y-1">
            {links.map((link) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[13px] text-blue-700 hover:underline"
                >
                  {link.label}
                  <ExternalLink className="size-3" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">No links.</p>
        )}
      </Section>
    </div>
  );
}

/** Right-hand drawer with the full HelpDesk record for one ticket. */
export function TicketDetailSheet({
  ticketId,
  detail,
  history,
  loading,
  error,
  onClose,
}: TicketDetailSheetProps) {
  return (
    <Sheet open={ticketId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="gap-1">
          <SheetDescription className="font-mono text-[11px]">{ticketId}</SheetDescription>
          <SheetTitle className="text-[17px] leading-snug">
            {loading ? <Skeleton className="h-5 w-3/4" /> : (detail?.subject ?? 'Ticket')}
          </SheetTitle>
        </SheetHeader>

        {loading && (
          <div className="space-y-3 px-4 pb-8">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {!loading && error && (
          <div className="mx-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-[13px] break-words">{error}</p>
          </div>
        )}

        {!loading && !error && detail && <DetailBody detail={detail} history={history} />}
      </SheetContent>
    </Sheet>
  );
}
