/**
 * Session storage. Opaque ids in SQLite — revocable, and they outlive a restart.
 *
 * Nothing here ever logs an id: a session id is a bearer credential, so printing
 * one anywhere is the same as printing a password.
 */
import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions, type SessionRow } from '../db/schema';

/** 32 bytes = 256 bits of entropy, base64url so it is cookie-safe verbatim. */
export function newSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/** Drops every session past its expiry. Called on read and on login — no cron. */
export function deleteExpiredSessions(db: Db, now = new Date()): void {
  db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString())).run();
}

export function createSession(db: Db, username: string, ttlMs: number, now = new Date()): string {
  const id = newSessionId();
  const nowIso = now.toISOString();
  db.insert(sessions)
    .values({
      id,
      username,
      createdAt: nowIso,
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      lastSeenAt: nowIso,
    })
    .run();
  return id;
}

/**
 * The live session for `id`, or `null` for one that is unknown, tampered with
 * or expired — the caller cannot tell those apart, and does not need to.
 *
 * Reading a session slides its expiry forward, which is what makes the 7-day
 * window "since you last used it" rather than "since you signed in".
 */
export function touchSession(db: Db, id: string, ttlMs: number, now = new Date()): SessionRow | null {
  deleteExpiredSessions(db, now);

  const [row] = db.select().from(sessions).where(eq(sessions.id, id)).limit(1).all();
  if (!row) return null;

  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  db.update(sessions).set({ lastSeenAt: nowIso, expiresAt }).where(eq(sessions.id, id)).run();

  return { ...row, lastSeenAt: nowIso, expiresAt };
}

export function deleteSession(db: Db, id: string): void {
  db.delete(sessions).where(eq(sessions.id, id)).run();
}
