/**
 * Regenerates the test fixture from production HelpDesk.
 *
 * The fixture holds real merchant data, so it is gitignored — a fresh clone has
 * to pull its own copy before the tests can run.
 *
 * Usage: bun run fixture:pull
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '../src/config';
import { fetchTicketsForYear } from '../src/helpdesk/client';

const SAMPLE_SIZE = 8;
const OUT_PATH = join(import.meta.dir, '../tests/fixtures/sample-joy-open-tickets.json');

const config = loadConfig();
const tickets = await fetchTicketsForYear(config);
const open = tickets.filter((ticket) => ticket.ticketStatus === 'open');

if (open.length === 0) {
  console.error(`No open ${config.appName} tickets came back for ${config.year} — nothing to write.`);
  process.exit(1);
}

const payload = {
  success: true,
  data: {
    tickets: open.slice(0, SAMPLE_SIZE),
    note: `${SAMPLE_SIZE} open ${config.appName} tickets, pulled for tests. Real customer data — do not commit.`,
    totalOpen: open.length,
  },
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 1)}\n`);
console.log(`Wrote ${Math.min(SAMPLE_SIZE, open.length)} of ${open.length} open tickets to ${OUT_PATH}`);
