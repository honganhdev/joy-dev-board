/**
 * One pull = fetch from HelpDesk, write to SQLite, record the attempt.
 *
 * Pulls are single-flight: a page load that finds an empty database and a
 * concurrent `POST /api/pull` join the same run rather than hitting HelpDesk
 * twice with the same query.
 */
import type { Config } from './config';
import type { Db } from './db/client';
import { failPull, finishPull, startPull, syncPull, type SyncResult } from './db/sync';
import type { HelpDeskTicket } from './helpdesk/types';

export type PullRunner = {
  run: () => Promise<SyncResult>;
  /** Orders webhook work after the existing single-flight pull without changing either write. */
  whenIdle: () => Promise<void>;
};
export type TicketFetcher = (config: Config) => Promise<HelpDeskTicket[]>;

export function createPullRunner(db: Db, config: Config, fetchTickets: TicketFetcher): PullRunner {
  let inFlight: Promise<SyncResult> | null = null;

  async function execute(): Promise<SyncResult> {
    const pullId = startPull(db);
    try {
      const tickets = await fetchTickets(config);
      const result = syncPull(db, tickets, pullId);
      finishPull(db, pullId, result);
      console.log(
        `[pull ${pullId}] ${result.pulled} tickets, ${result.inserted} new, ${result.statusChanges} status changes`
      );
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      failPull(db, pullId, message);
      console.error(`[pull ${pullId}] failed:`, message);
      throw cause;
    }
  }

  return {
    run() {
      inFlight ??= execute().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    whenIdle() {
      // Ordering avoids a stale pull overwriting a newer webhook observation;
      // an updatedAt predicate on only the webhook write cannot prevent that.
      return (inFlight ?? Promise.resolve()).then(
        () => undefined,
        () => undefined
      );
    },
  };
}
