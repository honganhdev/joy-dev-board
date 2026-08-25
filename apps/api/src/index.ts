import { TtlCache } from './cache';
import { loadConfig } from './config';
import { openDatabase } from './db/client';
import { countTickets } from './db/queries';
import { fetchTags } from './helpdesk/client';
import { createPullRunner } from './pull-service';
import { createRouter } from './routes';

// Fail loudly and early: missing credentials are a startup error, not a 500
// later — and a board with no login must never come up at all.
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

const handle = createRouter({
  db,
  pulls,
  tags,
  auth: config.auth,
  year: config.year,
  webDistPath: config.webDistPath,
});

const server = Bun.serve({
  port: config.port,
  // Bun's default closes an idle connection after ~10s. A manual pull now walks
  // the year in 7-day windows and takes ~45s, sending nothing until it finishes,
  // so the default cut the socket mid-pull: the pull completed and committed
  // while the caller — and Caddy in front of it — saw an EOF and reported 502.
  // 255 is Bun's maximum. This buys headroom, not a guarantee: the pull grows
  // with the corpus, and the real fix is for /api/pull to answer immediately and
  // let the client poll the pull status it already records.
  idleTimeout: 255,
  // The socket address is passed through so the login throttle can bucket by
  // client when there is no trusted proxy header to read.
  fetch: (request, bunServer) => handle(request, bunServer),
});

const stored = countTickets(db);
console.log(
  `[joy-dev-board api] listening on http://localhost:${server.port} ` +
    `(app "${config.appName}", year ${config.year}, db ${config.databasePath}, ${stored} tickets stored)`
);
if (!config.auth.cookieSecure) {
  console.warn('[joy-dev-board api] COOKIE_SECURE=false — session cookie will be sent over plain http');
}

// A fresh database has nothing to serve. Start the first pull straight away
// rather than waiting for a request; a request arriving meanwhile joins it.
if (stored === 0) {
  console.log('[joy-dev-board api] empty database — pulling from HelpDesk');
  pulls.run().catch((cause: unknown) => {
    console.error('[joy-dev-board api] first pull failed:', cause instanceof Error ? cause.message : cause);
  });
}
