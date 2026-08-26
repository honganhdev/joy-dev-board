import type { Config } from './config';
import type { Db } from './db/client';
import { failPull, finishPull, syncPull, type SyncResult } from './db/sync';
import type { HelpDeskTicket } from './helpdesk/types';
import type { PullRunner } from './pull-service';

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
    try {
      await pulls.whenIdle();
      if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
        throw new Error(`ticket ${ticketId} has no usable createdAt timestamp`);
      }

      const day = await fetchTicketsCreatedOn(config, createdAt);
      const record = day.find((ticket) => ticket.id === ticketId);
      if (!record) {
        throw new Error(
          `ticket ${ticketId} was not found in its ${createdAt.slice(0, 10)} UTC window`
        );
      }

      const recordYear = record.createdAt
        ? new Date(record.createdAt).getUTCFullYear()
        : Number.NaN;
      if (record.appName !== config.appName || recordYear !== config.year) {
        finishPull(db, pullId, NO_CHANGES);
        console.log(
          `[webhook ${pullId}] ignored ticket ${ticketId}: outside the configured app or year`
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
