import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from '../src/db/schema';
import type { AuthConfig } from '../src/config';
import { openDatabase, type Db } from '../src/db/client';
import { mcpTokens } from '../src/db/schema';
import {
  issueMcpToken,
  MCP_AUTH_FAILURE,
  revokeMcpToken,
  revokeMcpTokensForUser,
  verifyMcpToken,
} from '../src/auth/mcp-token';
import { eq } from 'drizzle-orm';

const USERNAME = 'teammate';
const TEST_HASH = '$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g';
const AUTH: AuthConfig = {
  users: [{ username: USERNAME, passwordHash: 'unused' }],
  sessionTtlMs: 60_000,
  cookieSecure: false,
  trustProxy: false,
};

function row(db: Db, publicId: string) {
  return db.select().from(mcpTokens).where(eq(mcpTokens.publicId, publicId)).all()[0]!;
}

describe('mcp token migration', () => {
  test('a fresh database has every token column', () => {
    const { sqlite } = openDatabase(':memory:');
    const columns = sqlite.query('PRAGMA table_info(mcp_tokens)').all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual([
      'publicId',
      'label',
      'username',
      'secretHash',
      'createdAt',
      'lastUsedAt',
      'expiresAt',
      'revokedAt',
    ]);
  });

  test('an older image treats an already-applied 0007 as a no-op', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mcp-migration-rollback-'));
    const currentMigrations = join(import.meta.dir, '../drizzle');
    const oldMigrations = join(directory, 'old-migrations');
    const databasePath = join(directory, 'board.db');

    try {
      cpSync(currentMigrations, oldMigrations, { recursive: true });
      const journalPath = join(oldMigrations, 'meta/_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: Array<{ when: number; tag: string }>;
      };
      const newest = journal.entries.at(-1)!;
      const previous = journal.entries.at(-2)!;
      expect(newest.tag.startsWith('0007_')).toBe(true);
      expect(newest.when).toBeGreaterThan(previous.when);
      journal.entries.pop();
      writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

      const currentSqlite = new Database(databasePath, { create: true });
      migrate(drizzle({ client: currentSqlite, schema }), { migrationsFolder: currentMigrations });
      currentSqlite.close();

      const oldSqlite = new Database(databasePath);
      expect(() =>
        migrate(drizzle({ client: oldSqlite, schema }), { migrationsFolder: oldMigrations })
      ).not.toThrow();
      const table = oldSqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mcp_tokens'")
        .get();
      expect(table).not.toBeNull();
      oldSqlite.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('mcp token lifecycle', () => {
  test('mints once, stores only a hash, and verifies the credential', () => {
    const { db } = openDatabase(':memory:');
    const issued = issueMcpToken(db, { username: USERNAME, label: 'test client' });
    const secret = issued.token.split('.')[1]!;
    const stored = row(db, issued.row.publicId);

    expect(issued.token).toMatch(/^jbmcp_[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(stored.secretHash).toHaveLength(64);
    expect(verifyMcpToken(db, AUTH, issued.token).ok).toBe(true);
  });

  test('wrong, unknown, revoked, expired, and offboarded tokens fail identically', () => {
    const { db } = openDatabase(':memory:');
    const wrong = issueMcpToken(db, { username: USERNAME, label: 'wrong' });
    const unknown = issueMcpToken(db, { username: USERNAME, label: 'unknown' });
    const revoked = issueMcpToken(db, { username: USERNAME, label: 'revoked' });
    const expired = issueMcpToken(db, {
      username: USERNAME,
      label: 'expired',
      expiresAt: '2026-09-02T00:00:00.000Z',
    });
    const invalidExpiry = issueMcpToken(db, {
      username: USERNAME,
      label: 'invalid expiry',
      expiresAt: 'not-a-timestamp',
    });
    const offboarded = issueMcpToken(db, { username: USERNAME, label: 'offboarded' });
    revokeMcpToken(db, revoked.row.publicId, new Date('2026-09-03T00:00:00.000Z'));

    const wrongSecret = `${wrong.token.slice(0, -1)}${wrong.token.endsWith('A') ? 'B' : 'A'}`;
    const unknownId = `jbmcp_AAAAAAAAAAA.${unknown.token.split('.')[1]}`;
    const now = new Date('2026-09-03T00:00:00.000Z');
    const failures = [
      verifyMcpToken(db, AUTH, wrongSecret, now),
      verifyMcpToken(db, AUTH, unknownId, now),
      verifyMcpToken(db, AUTH, revoked.token, now),
      verifyMcpToken(db, AUTH, expired.token, now),
      verifyMcpToken(db, AUTH, invalidExpiry.token, now),
      verifyMcpToken(db, { ...AUTH, users: [] }, offboarded.token, now),
    ];

    expect(failures).toEqual(
      Array.from({ length: failures.length }, () => ({ ok: false, error: MCP_AUTH_FAILURE }))
    );
  });

  test('revocation takes effect without reopening the database', () => {
    const { db } = openDatabase(':memory:');
    const issued = issueMcpToken(db, { username: USERNAME, label: 'revocable' });

    expect(verifyMcpToken(db, AUTH, issued.token).ok).toBe(true);
    expect(revokeMcpToken(db, issued.row.publicId)).toBe(1);
    expect(verifyMcpToken(db, AUTH, issued.token)).toEqual({
      ok: false,
      error: MCP_AUTH_FAILURE,
    });
  });

  test('lastUsedAt is written at most once per five minutes', () => {
    const { db } = openDatabase(':memory:');
    const issued = issueMcpToken(db, { username: USERNAME, label: 'debounced' });
    const start = new Date('2026-09-03T00:00:00.000Z');

    verifyMcpToken(db, AUTH, issued.token, start);
    expect(row(db, issued.row.publicId).lastUsedAt).toBe(start.toISOString());

    verifyMcpToken(db, AUTH, issued.token, new Date(start.getTime() + 60_000));
    expect(row(db, issued.row.publicId).lastUsedAt).toBe(start.toISOString());

    const later = new Date(start.getTime() + 6 * 60_000);
    verifyMcpToken(db, AUTH, issued.token, later);
    expect(row(db, issued.row.publicId).lastUsedAt).toBe(later.toISOString());
  });

  test('malformed values all fail generically', () => {
    const { db } = openDatabase(':memory:');
    for (const value of ['', 'token', 'jbmcp_no-dot', 'bad_AAAAAAAAAAA.secret', 'jbmcp_.', 'jbmcp_a.b.c']) {
      expect(verifyMcpToken(db, AUTH, value)).toEqual({
        ok: false,
        error: MCP_AUTH_FAILURE,
      });
    }
  });

  test('revokes every live token for one user and no others', () => {
    const { db } = openDatabase(':memory:');
    const first = issueMcpToken(db, { username: USERNAME, label: 'first' });
    const second = issueMcpToken(db, { username: USERNAME, label: 'second' });
    const other = issueMcpToken(db, { username: 'other', label: 'other' });

    expect(revokeMcpTokensForUser(db, USERNAME)).toBe(2);
    expect(row(db, first.row.publicId).revokedAt).not.toBeNull();
    expect(row(db, second.row.publicId).revokedAt).not.toBeNull();
    expect(row(db, other.row.publicId).revokedAt).toBeNull();
  });
});

describe('mcp token CLI', () => {
  test('help succeeds without configuration', async () => {
    const process = Bun.spawn(['bun', 'apps/api/scripts/issue-token.ts', '--help'], {
      cwd: join(import.meta.dir, '../../..'),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await process.exited).toBe(0);
  });

  test('issues, lists, and revokes a user without disclosing stored secrets', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mcp-token-cli-'));
    const databasePath = join(directory, 'board.db');
    const cwd = join(import.meta.dir, '../../..');
    const env = {
      PATH: process.env.PATH ?? '',
      API_KEY_HELPDESK: 'test-key',
      WEBHOOK_SECRET: 'test-webhook-secret',
      AUTH_USERNAME: USERNAME,
      AUTH_PASSWORD_HASH: TEST_HASH,
      DATABASE_PATH: databasePath,
    };

    try {
      const issued = Bun.spawn(
        [
          'bun',
          'apps/api/scripts/issue-token.ts',
          '--user',
          USERNAME,
          '--label',
          'test client',
        ],
        { cwd, env, stdout: 'pipe', stderr: 'pipe' }
      );
      const [issuedCode, issuedOut] = await Promise.all([
        issued.exited,
        new Response(issued.stdout).text(),
      ]);
      const token = issuedOut.trim();
      expect(issuedCode).toBe(0);
      expect(token).toMatch(/^jbmcp_/);

      const opened = openDatabase(databasePath);
      const stored = opened.db.select().from(mcpTokens).all()[0]!;
      expect(verifyMcpToken(opened.db, AUTH, token).ok).toBe(true);
      opened.sqlite.close();

      const listed = Bun.spawn(['bun', 'apps/api/scripts/revoke-token.ts'], {
        cwd,
        env,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const listing = await new Response(listed.stdout).text();
      expect(await listed.exited).toBe(0);
      expect(listing).toContain(stored.publicId);
      expect(listing).toContain(USERNAME);
      expect(listing).not.toContain(stored.secretHash);
      expect(listing).not.toContain(token);

      const revoked = Bun.spawn(
        ['bun', 'apps/api/scripts/revoke-token.ts', '--user', USERNAME],
        { cwd, env, stdout: 'pipe', stderr: 'pipe' }
      );
      expect(await revoked.exited).toBe(0);

      const after = openDatabase(databasePath);
      expect(verifyMcpToken(after.db, AUTH, token)).toEqual({
        ok: false,
        error: MCP_AUTH_FAILURE,
      });
      after.sqlite.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
