import { join } from 'node:path';

/**
 * Server-side configuration. The HelpDesk API key never leaves this process —
 * it is read here and used only by the HelpDesk client.
 */

export type Config = {
  apiKey: string;
  baseUrl: string;
  port: number;
  /** How long the HelpDesk tag directory stays cached in memory. */
  cacheTtlMs: number;
  /** Year window used for the by-date query. */
  year: number;
  appName: string;
  /** SQLite file the board is served from. `:memory:` is honoured for tests. */
  databasePath: string;
};

/**
 * Default database location, resolved from this file rather than the working
 * directory: `bun run dev` starts the API with its cwd inside `apps/api`, and
 * the database belongs to the repo, not to one app. An explicit
 * `DATABASE_PATH` is used as given (relative paths resolve against the cwd).
 */
const DEFAULT_DATABASE_PATH = join(import.meta.dir, '../../../data/board.db');

/** Throws with an actionable message when required env is missing. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.API_KEY_HELPDESK?.trim();
  if (!apiKey) {
    throw new Error(
      'API_KEY_HELPDESK is not set. Add it to the repo-root .env (gitignored) before starting the API.'
    );
  }

  return {
    apiKey,
    baseUrl: env.HELPDESK_BASE_URL?.trim() || 'https://helpdesk.avada.net/api/external',
    port: Number(env.PORT ?? 8787),
    cacheTtlMs: Number(env.CACHE_TTL_MS ?? 5 * 60 * 1000),
    year: Number(env.HELPDESK_YEAR ?? new Date().getUTCFullYear()),
    appName: env.HELPDESK_APP_NAME?.trim() || 'JOY Loyalty',
    databasePath: env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH,
  };
}
