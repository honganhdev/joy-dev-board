/**
 * The restart case, proved through a real boot.
 *
 * `bootstrap()` is unit-tested elsewhere; that says nothing about whether the
 * server calls it, or calls it early enough. This starts the actual API process
 * against a throwaway database holding a pull row abandoned by a "previous"
 * process, and against a stand-in HelpDesk that never answers — so the pull the
 * boot starts is still running when the assertions read the rows back.
 *
 * It fails if the `bootstrap(db)` call site is removed (the abandoned row stays
 * `running`) and it fails if that call is moved below the first-pull kick (the
 * live pull's own row gets swept along with it).
 */
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/client';
import { pulls } from '../src/db/schema';
import { startPull } from '../src/db/sync';

const API_ENTRY = join(import.meta.dir, '../src/index.ts');

let cleanUp: (() => void)[] = [];

afterEach(() => {
  for (const undo of cleanUp.reverse()) undo();
  cleanUp = [];
});

/** Stands in for HelpDesk: records the hit, then never answers. */
function hangingHelpDesk(): { url: string; hits: () => number } {
  let hits = 0;
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: () => {
      hits += 1;
      return new Promise<Response>(() => {});
    },
  });
  cleanUp.push(() => void server.stop(true));
  return { url: `http://127.0.0.1:${server.port}`, hits: () => hits };
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return condition();
}

test(
  'a boot sweeps the previous process’s pull before starting its own',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'joy-board-boot-'));
    cleanUp.push(() => rmSync(directory, { recursive: true, force: true }));
    const databasePath = join(directory, 'board.db');

    // A pull row left behind by a process that is gone, and no tickets — so the
    // booting API also starts a first pull of its own.
    const seeded = openDatabase(databasePath);
    const abandonedId = startPull(seeded.db);
    seeded.sqlite.close();

    const helpdesk = hangingHelpDesk();
    const api = Bun.spawn(['bun', 'run', API_ENTRY], {
      // A hand-built environment, and a cwd outside the repo: neither the real
      // HelpDesk key nor the repo `.env` can reach this process.
      cwd: directory,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        API_KEY_HELPDESK: 'test-key',
        HELPDESK_BASE_URL: helpdesk.url,
        AUTH_USERNAME: 'boarduser',
        AUTH_PASSWORD_HASH: await Bun.password.hash('unused', { algorithm: 'argon2id' }),
        DATABASE_PATH: databasePath,
        WEB_DIST_PATH: join(directory, 'no-web-dist'),
        COOKIE_SECURE: 'false',
        PORT: '0',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    cleanUp.push(() => void api.kill());

    const started = await waitFor(() => helpdesk.hits() > 0, 15_000);
    if (!started) {
      api.kill();
      const [out, err] = await Promise.all([
        new Response(api.stdout).text(),
        new Response(api.stderr).text(),
      ]);
      throw new Error(`the API never reached HelpDesk.\nstdout:\n${out}\nstderr:\n${err}`);
    }

    api.kill();
    await api.exited;

    const after = openDatabase(databasePath);
    const rows = after.db.select().from(pulls).all();
    after.sqlite.close();

    const abandoned = rows.find((row) => row.id === abandonedId);
    const live = rows.find((row) => row.id !== abandonedId);

    expect(abandoned).toMatchObject({ status: 'error', error: 'server restarted mid-pull' });
    expect(abandoned?.finishedAt).not.toBeNull();
    // The pull this boot started is still in flight, and the sweep ran early
    // enough not to have flipped it.
    expect(live).toMatchObject({ status: 'running', finishedAt: null });
  },
  20_000
);
