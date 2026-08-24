/**
 * The session cookie. The opaque id is the only thing that travels — no
 * username, no expiry claim, nothing the browser could be talked into editing.
 */
export const SESSION_COOKIE = 'board_session';

/**
 * Reads one cookie out of a request. Hand-parsed rather than taken from a
 * helper so it is obvious that only this one name is ever looked at, and so the
 * raw header is never passed on anywhere it could be logged.
 */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;

    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw) || null;
    } catch {
      // A lone `%` makes decodeURIComponent throw. That is a malformed cookie,
      // which means no session — not a 500 for the client to learn from.
      return null;
    }
  }
  return null;
}

function serialize(value: string, maxAgeSeconds: number, secure: boolean): string {
  // SameSite=Lax keeps the cookie off cross-site POSTs, which is what stops a
  // third-party page from driving the API as the signed-in user.
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function sessionCookie(id: string, ttlMs: number, secure: boolean): string {
  return serialize(id, Math.floor(ttlMs / 1000), secure);
}

/** Same attributes with an empty value and a zero lifetime — the browser drops it. */
export function clearedSessionCookie(secure: boolean): string {
  return serialize('', 0, secure);
}
