/**
 * Login, logout, and the session check every other route goes through.
 *
 * Nothing in here logs a password, a session id, or a cookie header — not at
 * any level. A failed login logs the username and the reason and stops there.
 */
import type { AuthConfig, AuthUser } from '../config';
import type { Db } from '../db/client';
import { json } from '../http';
import { clearedSessionCookie, readSessionCookie, sessionCookie } from './cookie';
import { createSession, deleteExpiredSessions, deleteSession, touchSession } from './session-store';
import { LoginThrottle } from './throttle';

/**
 * The same words for a wrong password, an unknown username and a locked-out
 * client. Anything more specific tells an attacker which half they got right.
 */
const GENERIC_FAILURE = 'Incorrect username or password.';

export type ClientAddress = { requestIP?: (request: Request) => { address: string } | null } | null;

/**
 * The address to throttle against. `X-Forwarded-For` is only believed when a
 * proxy is actually in front — otherwise a client could set the header itself
 * and get a fresh bucket for every guess.
 */
export function clientIp(request: Request, server: ClientAddress, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers.get('x-forwarded-for');
    const first = forwarded?.split(',')[0]?.trim();
    if (first) return first;
  }
  return server?.requestIP?.(request)?.address ?? 'unknown';
}

function parseCredentials(body: unknown): { username: string; password: string } | null {
  if (!body || typeof body !== 'object') return null;
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  if (!username || !password) return null;
  return { username, password };
}

export type AuthDeps = { db: Db; auth: AuthConfig; throttle: LoginThrottle };

/** Chooses one real argon2 hash even when the submitted username is unknown. */
export function selectVerificationTarget(
  users: readonly AuthUser[],
  username: string
): { hash: string; matched: boolean; user: AuthUser | null } {
  const user = users.find((candidate) => candidate.username === username) ?? null;
  return { hash: user?.passwordHash ?? users[0]!.passwordHash, matched: user !== null, user };
}

export function createAuthHandlers({ db, auth, throttle }: AuthDeps) {
  async function login(request: Request, server: ClientAddress): Promise<Response> {
    const body = await request.json().catch(() => null);
    const credentials = parseCredentials(body);
    const ip = clientIp(request, server, auth.trustProxy);
    // An unparseable body still gets throttled by IP: it is a login attempt.
    const keys = [`ip:${ip}`, `user:${credentials?.username ?? ''}`];

    const verdict = throttle.check(keys);
    if (verdict.locked) {
      console.warn(`[auth] locked out, ${verdict.retryAfterSeconds}s remaining (ip ${ip})`);
      return json({ error: 'invalid_credentials', message: GENERIC_FAILURE }, 429, {
        'Retry-After': String(verdict.retryAfterSeconds),
      });
    }

    if (!credentials) {
      throttle.recordFailure(keys);
      return json({ error: 'invalid_credentials', message: GENERIC_FAILURE }, 401);
    }

    // Verify unconditionally, then check the match: an unknown username must
    // cost the same argon2 work as a wrong password, or the response time says
    // which one it was.
    const target = selectVerificationTarget(auth.users, credentials.username);
    const passwordOk = await Bun.password
      .verify(credentials.password, target.hash)
      .catch((cause: unknown) => {
        // A hash that argon2 cannot read is a misconfigured deployment. Say so
        // in the log, and still answer the client with the same refusal.
        console.error('[auth] AUTH_PASSWORD_HASH is unusable:', cause instanceof Error ? cause.message : cause);
        return false;
      });
    if (!passwordOk || !target.matched || !target.user) {
      throttle.recordFailure(keys);
      console.warn(`[auth] failed login for "${credentials.username}" (ip ${ip})`);
      return json({ error: 'invalid_credentials', message: GENERIC_FAILURE }, 401);
    }

    throttle.reset(keys);
    deleteExpiredSessions(db);
    const id = createSession(db, target.user.username, auth.sessionTtlMs);
    console.log(`[auth] signed in "${target.user.username}" (ip ${ip})`);

    return json({ username: target.user.username }, 200, {
      'Set-Cookie': sessionCookie(id, auth.sessionTtlMs, auth.cookieSecure),
    });
  }

  function logout(request: Request): Response {
    const id = readSessionCookie(request);
    if (id) deleteSession(db, id);
    // The cookie is cleared either way, so a stale one cannot linger after a
    // session the server already forgot.
    return json({ ok: true }, 200, { 'Set-Cookie': clearedSessionCookie(auth.cookieSecure) });
  }

  /** The signed-in username, or `null` for no cookie, an unknown id or an expired one. */
  function currentUser(request: Request): string | null {
    const id = readSessionCookie(request);
    if (!id) return null;
    return touchSession(db, id, auth.sessionTtlMs)?.username ?? null;
  }

  function me(request: Request): Response {
    const username = currentUser(request);
    if (!username) return unauthorized();
    return json({ username });
  }

  return { login, logout, me, currentUser };
}

export function unauthorized(): Response {
  return json({ error: 'unauthorized', message: 'Sign in to use the board.' }, 401);
}
