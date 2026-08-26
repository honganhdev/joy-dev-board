import type { Config } from './config';
import type { Db } from './db/client';
import { readLastPull, readLastSuccessfulPull } from './db/queries';
import { failPull, finishPull, readFailedDeliveries, syncPull, type SyncResult } from './db/sync';
import type { HelpDeskTicket } from './helpdesk/types';
import type { PullRunner } from './pull-service';
import { sanitizeForLog } from './webhook-verify';

export type CreatedOnFetcher = (config: Config, createdAt: string) => Promise<HelpDeskTicket[]>;

export type WebhookProcessor = {
  process: (pullId: number, ticketId: string, createdAt: unknown) => Promise<void>;
};

const NO_CHANGES: SyncResult = { pulled: 0, inserted: 0, statusChanges: 0 };

export function createWebhookProcessor(
  db: Db,
  config: Config,
  pulls: PullRunner,
  fetchTicketsCreatedOn: CreatedOnFetcher
): WebhookProcessor {
  // A serial promise chain orders webhook observations without introducing a
  // timer, scheduler or second durable mechanism beside their pulls rows.
  let queue: Promise<void> = Promise.resolve();

  async function processOne(pullId: number, ticketId: string, createdAt: unknown): Promise<void> {
    const logged = sanitizeForLog(ticketId);
    try {
      await pulls.whenIdle();
      if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
        throw new Error(`ticket ${logged} has no usable createdAt timestamp`);
      }

      // The watermark this observation is judged against: any full pull opened
      // after it started reads HelpDesk later than we did.
      const latestPullBeforeFetch = readLastPull(db)?.id ?? 0;
      const day = await fetchTicketsCreatedOn(config, createdAt);
      // Re-checked here, not only before the fetch: a pull that started while
      // the fetch was in flight has to commit first, or the two writes land in
      // arrival order rather than in the order they observed HelpDesk.
      await pulls.whenIdle();

      const supersededBy = readLastSuccessfulPull(db);
      if (supersededBy && supersededBy.id > latestPullBeforeFetch) {
        // That pull read the whole mirrored year after this fetch began, so it
        // holds the newer record for this ticket too. Writing our older
        // snapshot over it would put a reversed transition into
        // `ticket_status_history`, which nothing can undo.
        finishPull(db, pullId, NO_CHANGES);
        console.log(
          `[webhook ${pullId}] skipped ticket ${logged}: full pull ${supersededBy.id} ` +
            'already committed a newer record'
        );
        return;
      }

      const record = day.find((ticket) => ticket.id === ticketId);
      if (!record) {
        throw new Error(
          `ticket ${logged} was not found in its ${createdAt.slice(0, 10)} UTC window`
        );
      }

      const recordYear = record.createdAt
        ? new Date(record.createdAt).getUTCFullYear()
        : Number.NaN;
      if (record.appName !== config.appName || recordYear !== config.year) {
        finishPull(db, pullId, NO_CHANGES);
        console.log(
          `[webhook ${pullId}] ignored ticket ${logged}: outside the configured app or year`
        );
        return;
      }

      const result = syncPull(db, [record], pullId);
      finishPull(db, pullId, result);
      console.log(
        `[webhook ${pullId}] ${result.pulled} ticket, ${result.inserted} new, ${result.statusChanges} status changes`
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      failPull(db, pullId, message);
      console.error(`[webhook ${pullId}] failed:`, message);
    }
  }

  return {
    process(pullId, ticketId, createdAt) {
      const work = queue.then(() => processOne(pullId, ticketId, createdAt));
      queue = work.catch(() => undefined);
      return work;
    },
  };
}

/**
 * Repeats deliveries that were acknowledged and then lost.
 *
 * The route answers 202 before it does the work, and Avada treats any 2xx as
 * terminal — a delivery that dies afterwards, from a restart or a HelpDesk
 * failure, is never sent again. This is what re-drives it: the reserved row
 * kept the ticket it named, so the work can be repeated from the row alone. It
 * runs at boot, where the interrupted-pull sweep has just turned every
 * `running` row into an honest `error`.
 */
export async function redriveFailedDeliveries(
  db: Db,
  webhooks: WebhookProcessor
): Promise<number> {
  const failed = readFailedDeliveries(db);
  if (failed.length === 0) return 0;

  console.log(`[joy-dev-board api] re-driving ${failed.length} unfinished webhook deliver(ies)`);
  await Promise.all(
    failed.map((delivery) =>
      webhooks.process(delivery.id, delivery.ticketId, delivery.createdAt).catch(() => undefined)
    )
  );
  return failed.length;
}
