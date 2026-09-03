/** Personal bearer credentials for the read-only MCP surface. */
import { createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { AuthConfig } from '../config';
import type { Db } from '../db/client';
import { mcpTokens, type McpTokenRow } from '../db/schema';

const TOKEN_PREFIX = 'jbmcp_';
const LAST_USED_DEBOUNCE_MS = 5 * 60 * 1000;
const lastUsedWrites = new Map<string, number>();

export const MCP_AUTH_FAILURE = 'Invalid or expired MCP token.';

type Verification =
  | { ok: true; token: McpTokenRow }
  | { ok: false; error: typeof MCP_AUTH_FAILURE };

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function parseToken(value: string): { publicId: string; secret: string } | null {
  const match = value.match(/^jbmcp_([A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]{43})$/);
  return match?.[1] && match[2] ? { publicId: match[1], secret: match[2] } : null;
}

function secretsMatch(received: string, storedHash: string): boolean {
  const receivedBytes = Buffer.from(hashSecret(received));
  const storedBytes = Buffer.from(storedHash);
  return receivedBytes.length === storedBytes.length && timingSafeEqual(receivedBytes, storedBytes);
}

export function issueMcpToken(
  db: Db,
  input: { username: string; label: string; expiresAt?: string | null },
  now = new Date()
): { token: string; row: McpTokenRow } {
  const publicId = randomBase64Url(8);
  const secret = randomBase64Url(32);
  const row: McpTokenRow = {
    publicId,
    label: input.label,
    username: input.username,
    secretHash: hashSecret(secret),
    createdAt: now.toISOString(),
    lastUsedAt: null,
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
  };
  db.insert(mcpTokens).values(row).run();
  return { token: `${TOKEN_PREFIX}${publicId}.${secret}`, row };
}

/**
 * Verifies possession, revocation, expiry, and continued account membership.
 * Every refusal intentionally has one value so callers cannot distinguish its
 * cause. `auth.users` is checked on every call: configured accounts are the
 * single source of truth for access after offboarding.
 */
export function verifyMcpToken(
  db: Db,
  auth: AuthConfig,
  value: string,
  now = new Date()
): Verification {
  const parsed = parseToken(value);
  if (!parsed) return { ok: false, error: MCP_AUTH_FAILURE };

  const [row] = db
    .select()
    .from(mcpTokens)
    .where(eq(mcpTokens.publicId, parsed.publicId))
    .limit(1)
    .all();
  if (
    !row ||
    !secretsMatch(parsed.secret, row.secretHash) ||
    row.revokedAt !== null ||
    (row.expiresAt !== null && Date.parse(row.expiresAt) <= now.getTime()) ||
    !auth.users.some((user) => user.username === row.username)
  ) {
    return { ok: false, error: MCP_AUTH_FAILURE };
  }

  const lastWrite = lastUsedWrites.get(row.publicId);
  if (lastWrite === undefined || now.getTime() - lastWrite >= LAST_USED_DEBOUNCE_MS) {
    const lastUsedAt = now.toISOString();
    db.update(mcpTokens)
      .set({ lastUsedAt })
      .where(eq(mcpTokens.publicId, row.publicId))
      .run();
    lastUsedWrites.set(row.publicId, now.getTime());
    return { ok: true, token: { ...row, lastUsedAt } };
  }

  return { ok: true, token: row };
}

export function revokeMcpToken(db: Db, publicId: string, now = new Date()): number {
  const rows = db
    .select({ publicId: mcpTokens.publicId })
    .from(mcpTokens)
    .where(and(eq(mcpTokens.publicId, publicId), isNull(mcpTokens.revokedAt)))
    .all();
  db
    .update(mcpTokens)
    .set({ revokedAt: now.toISOString() })
    .where(and(eq(mcpTokens.publicId, publicId), isNull(mcpTokens.revokedAt)))
    .run();
  return rows.length;
}

export function revokeMcpTokensForUser(db: Db, username: string, now = new Date()): number {
  const rows = db
    .select({ publicId: mcpTokens.publicId })
    .from(mcpTokens)
    .where(and(eq(mcpTokens.username, username), isNull(mcpTokens.revokedAt)))
    .all();
  db
    .update(mcpTokens)
    .set({ revokedAt: now.toISOString() })
    .where(and(eq(mcpTokens.username, username), isNull(mcpTokens.revokedAt)))
    .run();
  return rows.length;
}

export function listLiveMcpTokens(db: Db): McpTokenRow[] {
  return db.select().from(mcpTokens).where(isNull(mcpTokens.revokedAt)).all();
}
