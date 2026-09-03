/**
 * Issues one MCP bearer token. Only the one-time token reaches stdout; prompts,
 * errors, and confirmation stay on stderr.
 *
 * Usage: bun run mcp:issue -- --user <name> --label <client>
 */
import { issueMcpToken } from '../src/auth/mcp-token';
import { loadConfig } from '../src/config';
import { openDatabase } from '../src/db/client';

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && value !== '--' ? value : null;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.error('usage: bun run mcp:issue -- --user <name> --label <client>');
  process.exit(0);
}

const username = option('--user')?.trim();
const label = option('--label')?.trim();
if (!username || !label) {
  console.error('Both --user and --label are required.');
  process.exit(1);
}

const config = loadConfig();
if (!config.auth.users.some((user) => user.username === username)) {
  console.error('The requested user is not in the configured account list.');
  process.exit(1);
}

const { db, sqlite } = openDatabase(config.databasePath);
sqlite.exec('PRAGMA busy_timeout = 5000;');
const issued = issueMcpToken(db, { username, label });
console.error(
  `Issued MCP token ${issued.row.publicId} for "${username}". ` +
    'Copy the next line now; it cannot be recovered.'
);
console.log(issued.token);
sqlite.close();
