import { join } from 'node:path';

/**
 * Server-side configuration. The HelpDesk API key and the password hash never
 * leave this process — they are read here and used only by the HelpDesk client
 * and the login handler.
 */

export type Config = {
  apiKey: string;
  /** Shared secret the Avada webhook signs its deliveries with. */
  webhookSecret: string;
  baseUrl: string;
  port: number;
  /** How long the HelpDesk tag directory stays cached in memory. */
  cacheTtlMs: number;
  /** Year window used for the by-date query. */
  year: number;
  appName: string;
  /** SQLite file the board is served from. `:memory:` is honoured for tests. */
  databasePath: string;
  auth: AuthConfig;
  /** Built web assets to serve alongside `/api/*`. `null` when there are none. */
  webDistPath: string | null;
};

export type AuthConfig = {
  /** Accounts that may sign in. There is no user-management UI. */
  users: readonly AuthUser[];
  /** Sliding session lifetime, refreshed on every authenticated request. */
  sessionTtlMs: number;
  /**
   * `Secure` on the session cookie. On by default — turning it off is an
   * explicit local-http decision, never something a missing variable causes.
   */
  cookieSecure: boolean;
  /**
   * Whether `X-Forwarded-For` may be believed. Off by default: without a proxy
   * in front, anyone could set that header and walk straight past the per-IP
   * login throttle.
   */
  trustProxy: boolean;
};

export type AuthUser = {
  username: string;
  /** Decoded `Bun.password` (argon2id) PHC string. See `decodePasswordHash`. */
  passwordHash: string;
};

/**
 * Default database location, resolved from this file rather than the working
 * directory: `bun run dev` starts the API with its cwd inside `apps/api`, and
 * the database belongs to the repo, not to one app. An explicit
 * `DATABASE_PATH` is used as given (relative paths resolve against the cwd).
 */
const DEFAULT_DATABASE_PATH = join(import.meta.dir, '../../../data/board.db');

/** Where `bun run build` puts the web app. Absent in a source checkout. */
const DEFAULT_WEB_DIST_PATH = join(import.meta.dir, '../../web/dist');

const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `AUTH_PASSWORD_HASH` is carried base64-encoded, and this turns it back into
 * the argon2id PHC string.
 *
 * An argon2 hash is full of `$` (`$argon2id$v=19$m=65536,...`). `bun
 * --env-file` expands those as variables — inside single quotes too — so a
 * pasted PHC string arrives as `=19=65536,t=2,p=1...` and every login fails
 * with an unsupported-algorithm error. Docker's `env_file` does no expansion at
 * all, so no single escaping works in both. Base64 has no `$` and so means the
 * same thing everywhere. A raw PHC string is still accepted for anyone who gets
 * it through intact.
 */
export function decodePasswordHash(raw: string): string {
  if (raw.startsWith('$argon2')) return raw;

  const decoded = Buffer.from(raw, 'base64').toString('utf8');
  if (decoded.startsWith('$argon2')) return decoded;

  throw new Error(
    'AUTH_PASSWORD_HASH is not a usable argon2id hash. Regenerate it with `bun run auth:hash` and paste the whole line.'
  );
}

/**
 * The argon2 cost parameters of a PHC string —
 * `$argon2id$v=19$m=65536,t=2,p=1$<salt>$<digest>` → `argon2id$v=19$m=65536,t=2,p=1`.
 * `null` when the string is not in that shape.
 */
export function argon2Parameters(hash: string): string | null {
  const match = hash.match(/^\$(argon2[a-z]*)\$(v=\d+)\$(m=\d+,t=\d+,p=\d+)\$/);
  return match ? `${match[1]}$${match[2]}$${match[3]}` : null;
}

/** Throws with an actionable message when required env is missing. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.API_KEY_HELPDESK?.trim();
  if (!apiKey) {
    throw new Error(
      'API_KEY_HELPDESK is not set. Add it to the repo-root .env (gitignored) before starting the API.'
    );
  }

  const webhookSecret = env.WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new Error(
      'WEBHOOK_SECRET is not set. Copy the value shown once in Avada admin → Webhooks into the repo-root .env before starting the API.'
    );
  }

  // The board exposes real customer data, so refusing to start beats starting
  // without a login — same reasoning as the missing-key check above.
  const username = env.AUTH_USERNAME?.trim();
  if (!username) {
    throw new Error('AUTH_USERNAME is not set. The API will not serve the board without a login.');
  }
  const passwordHash = env.AUTH_PASSWORD_HASH?.trim();
  if (!passwordHash) {
    throw new Error(
      'AUTH_PASSWORD_HASH is not set. Generate one with `bun run auth:hash` and put it in .env.'
    );
  }

  const firstHash = decodePasswordHash(passwordHash);
  // Entry 1 defines the reference cost. `selectVerificationTarget` verifies an
  // unknown username against entry 1's hash so the response time is the same as
  // a wrong password's; that only holds while every configured hash costs the
  // same to verify. A mismatched entry never enters the list below, so the decoy
  // cannot be mismatched — and only entry 1 itself refuses to start, because a
  // bad later entry must never take the live board down.
  const referenceParameters = argon2Parameters(firstHash);
  if (!referenceParameters) {
    throw new Error(
      'AUTH_PASSWORD_HASH is not a usable argon2id hash. Regenerate it with `bun run auth:hash` and paste the whole line.'
    );
  }

  const users: AuthUser[] = [{ username, passwordHash: firstHash }];
  const usernames = new Set([username]);
  for (let index = 2; index <= 20; index += 1) {
    const nameKey = `AUTH_USER_${index}_NAME`;
    const hashKey = `AUTH_USER_${index}_HASH`;
    const candidateUsername = env[nameKey]?.trim();
    const candidateHash = env[hashKey]?.trim();

    if (!candidateUsername && !candidateHash) continue;
    if (!candidateUsername) {
      console.error(`[config] ${nameKey} is missing; skipping account entry ${index}.`);
      continue;
    }
    if (!candidateHash) {
      console.error(`[config] ${hashKey} is missing; skipping account entry ${index}.`);
      continue;
    }
    if (usernames.has(candidateUsername)) {
      console.error(
        `[config] ${nameKey} duplicates an earlier username; skipping account entry ${index}.`
      );
      continue;
    }

    let decodedHash: string;
    try {
      decodedHash = decodePasswordHash(candidateHash);
    } catch {
      console.error(
        `[config] ${hashKey} is not a usable argon2id hash; skipping account entry ${index}.`
      );
      continue;
    }

    const parameters = argon2Parameters(decodedHash);
    if (parameters !== referenceParameters) {
      console.error(
        `[config] ${hashKey} was minted with different argon2 parameters ` +
          `(${parameters ?? 'unreadable'}) than AUTH_PASSWORD_HASH (${referenceParameters}); ` +
          `skipping account entry ${index}. Re-mint it with \`bun run auth:hash\` on this build.`
      );
      continue;
    }

    users.push({ username: candidateUsername, passwordHash: decodedHash });
    usernames.add(candidateUsername);
  }

  return {
    apiKey,
    webhookSecret,
    baseUrl: env.HELPDESK_BASE_URL?.trim() || 'https://helpdesk.avada.net/api/external',
    port: Number(env.PORT ?? 8787),
    cacheTtlMs: Number(env.CACHE_TTL_MS ?? 5 * 60 * 1000),
    year: Number(env.HELPDESK_YEAR ?? new Date().getUTCFullYear()),
    appName: env.HELPDESK_APP_NAME?.trim() || 'JOY Loyalty',
    databasePath: env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH,
    auth: {
      users,
      sessionTtlMs: Number(env.SESSION_TTL_MS ?? DEFAULT_SESSION_TTL_MS),
      cookieSecure: env.COOKIE_SECURE?.trim() !== 'false',
      trustProxy: env.TRUST_PROXY?.trim() === 'true',
    },
    webDistPath: env.WEB_DIST_PATH?.trim() || DEFAULT_WEB_DIST_PATH,
  };
}
