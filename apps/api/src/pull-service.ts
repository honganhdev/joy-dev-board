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
  /** Resolves once the pull in flight *at the moment of the call* has settled. */
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
      // This resolves against `inFlight` as it is *now*: it guarantees only
      // that the pull running at the moment of the call has committed first,
      // not that no pull is running when the caller finally writes. A caller
      // that awaits it, then does upstream work, has to ask again — and the
      // webhook path additionally refuses to write at all once a full pull has
      // committed after its own fetch began, because ordering alone says
      // nothing about which of the two observations is the newer one.
      //
      // Residual: nothing waits on webhook work from this side. A full pull
      // that starts after the webhook's last check commits second and wins,
      // which is correct — its read of HelpDesk is the later one.
      return (inFlight ?? Promise.resolve()).then(
        () => undefined,
        () => undefined
      );
    },
  };
}
