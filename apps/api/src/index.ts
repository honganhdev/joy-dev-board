import { TtlCache } from './cache';
import { loadConfig } from './config';
import { fetchTags, fetchTicketsForYear } from './helpdesk/client';
import { createRouter } from './routes';

// Fail loudly and early: a missing API key is a startup error, not a 500 later.
let config;
try {
  config = loadConfig();
} catch (cause) {
  console.error(`\n[joy-dev-board api] ${cause instanceof Error ? cause.message : cause}\n`);
  process.exit(1);
}

const caches = {
  tickets: new TtlCache(() => fetchTicketsForYear(config), config.cacheTtlMs),
  // Tags change far less often than tickets, so they get a longer window.
  tags: new TtlCache(() => fetchTags(config), config.cacheTtlMs * 12),
};

const server = Bun.serve({ port: config.port, fetch: createRouter(caches) });

console.log(
  `[joy-dev-board api] listening on http://localhost:${server.port} ` +
    `(app "${config.appName}", year ${config.year}, cache ${config.cacheTtlMs}ms)`
);
