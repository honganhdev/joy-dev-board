/**
 * Login throttle.
 *
 * One password on the public internet is a brute-force target, so failures are
 * counted per username *and* per client IP and a run of them locks that key out
 * for a spell. Both keys matter: per-username alone lets a botnet spread the
 * guesses across addresses, per-IP alone lets one host work through a list of
 * usernames.
 *
 * State is in memory, so a restart of the API clears every counter. That is a
 * real limit and an accepted one — the alternative is a write to SQLite on
 * every failed guess, which is its own denial-of-service surface. Restarts are
 * rare and deliberate; an attacker cannot cause one.
 */

const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LOCKOUT_MS = 15 * 60 * 1000;

type Entry = { failures: number; firstFailureAt: number; lockedUntil: number };

export type ThrottleOptions = {
  /** Failures inside the window before the key is locked. */
  maxFailures?: number;
  /** How long a run of failures stays counted. */
  windowMs?: number;
  /** How long a locked key stays locked. */
  lockoutMs?: number;
};

export type ThrottleVerdict = { locked: boolean; retryAfterSeconds: number };

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly lockoutMs: number;

  constructor(options: ThrottleOptions = {}) {
    this.maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.lockoutMs = options.lockoutMs ?? DEFAULT_LOCKOUT_MS;
  }

  /**
   * Forgets entries that are neither locked nor inside their counting window.
   * Without this, an attacker rotating source addresses would grow the map for
   * as long as the process lives.
   */
  private sweep(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.lockedUntil <= now && now - entry.firstFailureAt > this.windowMs) {
        this.entries.delete(key);
      }
    }
  }

  /** Whether any of these keys is currently locked out. */
  check(keys: readonly string[], now = Date.now()): ThrottleVerdict {
    this.sweep(now);

    let lockedUntil = 0;
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry && entry.lockedUntil > now) lockedUntil = Math.max(lockedUntil, entry.lockedUntil);
    }

    if (lockedUntil === 0) return { locked: false, retryAfterSeconds: 0 };
    return { locked: true, retryAfterSeconds: Math.ceil((lockedUntil - now) / 1000) };
  }

  /** Counts one failed attempt against every key, locking those that run out. */
  recordFailure(keys: readonly string[], now = Date.now()): void {
    for (const key of keys) {
      const existing = this.entries.get(key);
      // A run that has gone quiet for a whole window starts over rather than
      // adding to a count from hours ago.
      const entry =
        existing && now - existing.firstFailureAt <= this.windowMs
          ? existing
          : { failures: 0, firstFailureAt: now, lockedUntil: 0 };

      entry.failures += 1;
      if (entry.failures >= this.maxFailures) {
        entry.lockedUntil = now + this.lockoutMs;
        entry.failures = 0;
        entry.firstFailureAt = now;
      }
      this.entries.set(key, entry);
    }
  }

  /** A successful login clears the keys it was made with. */
  reset(keys: readonly string[]): void {
    for (const key of keys) this.entries.delete(key);
  }
}
