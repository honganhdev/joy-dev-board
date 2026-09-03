/**
 * The live login must survive this change. A session issued by the deployed
 * board — before the account list existed and before migration 0007 ran — has
 * to keep working afterwards, or the deploy locks the user out of a board they
 * use every day.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from '../src/db/schema';
import type { AuthConfig } from '../src/config';
import { openDatabase } from '../src/db/client';
import { SESSION_COOKIE } from '../src/auth/cookie';
import { createRouter } from '../src/routes';

const USERNAME = 'boarduser';
const SECOND = 'teammate';
const HASH = await Bun.password.hash('correct horse battery staple', { algorithm: 'argon2id' });

function auth(users: AuthConfig['users']): AuthConfig {
  return { users, sessionTtlMs: 7 * 24 * 60 * 60 * 1000, cookieSecure: true, trustProxy: false };
}

function router(db: ReturnType<typeof openDatabase>['db'], authConfig: AuthConfig) {
  return createRouter({
    db,
    pulls: { run: async () => ({ pulled: 0, inserted: 0, statusChanges: 0 }), whenIdle: async () => {} },
    tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
    auth: authConfig,
    webhookSecret: 'test-webhook-secret',
    webhooks: { process: async () => {} },
    year: 2026,
  });
}

/** Writes a session row the way the pre-change server wrote one: raw columns. */
function insertLegacySession(sqlite: Database, id: string, username: string): void {
  const now = new Date();
  sqlite
    .query(
      'INSERT INTO sessions (id, username, createdAt, expiresAt, lastSeenAt) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      id,
      username,
      now.toISOString(),
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      now.toISOString()
    );
}

/** The migration set as it stood before this change: everything except 0007. */
function withoutLatestMigration(directory: string): string {
  const folder = join(directory, 'pre-0007');
  cpSync(join(import.meta.dir, '../drizzle'), folder, { recursive: true });
  const journalPath = join(folder, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  const dropped = journal.entries.pop()!;
  expect(dropped.tag.startsWith('0007_')).toBe(true);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return folder;
}

describe('a session issued before this change', () => {
  test('still authenticates after migration 0007 is applied over the old database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'session-continuity-'));
    const databasePath = join(directory, 'board.db');
    try {
      // Old image: migrations 0000..0006, one live session, no mcp_tokens table.
      const oldSqlite = new Database(databasePath, { create: true });
      migrate(drizzle({ client: oldSqlite, schema }), {
        migrationsFolder: withoutLatestMigration(directory),
      });
      expect(
        oldSqlite.query("SELECT name FROM sqlite_master WHERE name = 'mcp_tokens'").get()
      ).toBeNull();
      insertLegacySession(oldSqlite, 'legacy-session-id', USERNAME);
      oldSqlite.close();

      // New image boots on the same file and runs 0007.
      const opened = openDatabase(databasePath);
      expect(
        opened.sqlite.query("SELECT name FROM sqlite_master WHERE name = 'mcp_tokens'").get()
      ).not.toBeNull();

      const handle = router(opened.db, auth([{ username: USERNAME, passwordHash: HASH }]));
      const me = await handle(
        new Request('http://localhost/api/auth/me', {
          headers: { cookie: `${SESSION_COOKIE}=legacy-session-id` },
        })
      );
      expect(me.status).toBe(200);
      expect(await me.json()).toEqual({ username: USERNAME });

      const board = await handle(
        new Request('http://localhost/api/tickets', {
          headers: { cookie: `${SESSION_COOKIE}=legacy-session-id` },
        })
      );
      expect(board.status).toBe(200);
      opened.sqlite.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('still authenticates when its owner is no longer the first configured account', async () => {
    const { db, sqlite } = openDatabase(':memory:');
    insertLegacySession(sqlite, 'existing-session-id', USERNAME);
    const handle = router(
      db,
      auth([
        { username: SECOND, passwordHash: HASH },
        { username: USERNAME, passwordHash: HASH },
      ])
    );

    const me = await handle(
      new Request('http://localhost/api/auth/me', {
        headers: { cookie: `${SESSION_COOKIE}=existing-session-id` },
      })
    );
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ username: USERNAME });
  });

  test('outlives removal of its account from the configured list', async () => {
    // Documents the behaviour, which is NOT revocation: dropping an account from
    // the environment stops new logins and every MCP token, but leaves that
    // person's live board session usable until it expires or its row is deleted.
    const { db, sqlite } = openDatabase(':memory:');
    insertLegacySession(sqlite, 'departed-session-id', 'departed');
    const handle = router(db, auth([{ username: USERNAME, passwordHash: HASH }]));

    const me = await handle(
      new Request('http://localhost/api/auth/me', {
        headers: { cookie: `${SESSION_COOKIE}=departed-session-id` },
      })
    );
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ username: 'departed' });

    // Deleting the row is the only thing that ends it, and that works.
    sqlite.query('DELETE FROM sessions WHERE username = ?').run('departed');
    const after = await handle(
      new Request('http://localhost/api/auth/me', {
        headers: { cookie: `${SESSION_COOKIE}=departed-session-id` },
      })
    );
    expect(after.status).toBe(401);
  });
});
