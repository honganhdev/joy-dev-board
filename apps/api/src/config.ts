/**
 * Server-side configuration. The HelpDesk API key never leaves this process —
 * it is read here and used only by the HelpDesk client.
 */

export type Config = {
  apiKey: string;
  baseUrl: string;
  port: number;
  /** How long a HelpDesk pull stays fresh before the next request re-fetches. */
  cacheTtlMs: number;
  /** Year window used for the by-date query. */
  year: number;
  appName: string;
};

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
  };
}
