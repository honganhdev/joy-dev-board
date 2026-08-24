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
import { fetchTicketsForYear } from './helpdesk/client';

export type PullRunner = { run: () => Promise<SyncResult> };

export function createPullRunner(db: Db, config: Config): PullRunner {
  let inFlight: Promise<SyncResult> | null = null;

  async function execute(): Promise<SyncResult> {
    const pullId = startPull(db);
    try {
      const tickets = await fetchTicketsForYear(config);
      const result = syncPull(db, tickets, pullId);
      finishPull(db, pullId, result.pulled);
      console.log(
        `[pull ${pullId}] ${result.pulled} tickets, ${result.inserted} new, ${result.statusChanges} status changes`
      );
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      failPull(db, pullId, message);
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
  };
}
