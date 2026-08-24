import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HelpDeskTicket } from '../src/helpdesk/types';

/**
 * The fixture is a real HelpDesk payload — merchant domains, shop names and
 * Crisp session links — so it is gitignored rather than committed. Regenerate
 * it with `bun run fixture:pull` (needs API_KEY_HELPDESK in the repo-root .env).
 */
const FIXTURE_PATH = join(import.meta.dir, 'fixtures/sample-joy-open-tickets.json');

export function loadFixtureTickets(): HelpDeskTicket[] {
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(
      `Test fixture missing at ${FIXTURE_PATH}.\n` +
        'It holds real customer data so it is not committed. Run `bun run fixture:pull` to fetch it.'
    );
  }

  const parsed = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
    data?: { tickets?: HelpDeskTicket[] };
  };
  const tickets = parsed.data?.tickets;
  if (!Array.isArray(tickets) || tickets.length === 0) {
    throw new Error(`Test fixture at ${FIXTURE_PATH} has no tickets. Re-run \`bun run fixture:pull\`.`);
  }

  return tickets;
}
