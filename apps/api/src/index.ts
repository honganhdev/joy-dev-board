import { TtlCache } from './cache';
import { loadConfig } from './config';
import { openDatabase } from './db/client';
import { countTickets } from './db/queries';
import { fetchTags } from './helpdesk/client';
import { createPullRunner } from './pull-service';
import { createRouter } from './routes';

// Fail loudly and early: a missing API key is a startup error, not a 500 later.
let config;
try {
  config = loadConfig();
} catch (cause) {
  console.error(`\n[joy-dev-board api] ${cause instanceof Error ? cause.message : cause}\n`);
  process.exit(1);
}

const { db } = openDatabase(config.databasePath);
const pulls = createPullRunner(db, config);

// The tag directory is the one thing still read live from HelpDesk: it is a
// lookup table, not part of the ticket mirror, so it is cached in memory rather
// than given a table. Tickets are cached by SQLite itself.
const tags = new TtlCache(() => fetchTags(config), config.cacheTtlMs * 12);

const server = Bun.serve({ port: config.port, fetch: createRouter({ db, pulls, tags }) });

const stored = countTickets(db);
console.log(
  `[joy-dev-board api] listening on http://localhost:${server.port} ` +
    `(app "${config.appName}", year ${config.year}, db ${config.databasePath}, ${stored} tickets stored)`
);

// A fresh database has nothing to serve. Start the first pull straight away
// rather than waiting for a request; a request arriving meanwhile joins it.
if (stored === 0) {
  console.log('[joy-dev-board api] empty database — pulling from HelpDesk');
  pulls.run().catch((cause: unknown) => {
    console.error('[joy-dev-board api] first pull failed:', cause instanceof Error ? cause.message : cause);
  });
}
