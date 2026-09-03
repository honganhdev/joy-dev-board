/**
 * Lists or revokes MCP bearer tokens without ever reading or printing a secret.
 *
 * Usage:
 *   bun run mcp:revoke
 *   bun run mcp:revoke -- --id <publicId>
 *   bun run mcp:revoke -- --user <name>
 */
import {
  listLiveMcpTokens,
  revokeMcpToken,
  revokeMcpTokensForUser,
} from '../src/auth/mcp-token';
import { loadConfig } from '../src/config';
import { openDatabase } from '../src/db/client';

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && value !== '--' ? value : null;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('usage: bun run mcp:revoke [-- --id <publicId> | --user <name>]');
  process.exit(0);
}

const config = loadConfig();
const { db, sqlite } = openDatabase(config.databasePath);
sqlite.exec('PRAGMA busy_timeout = 5000;');

const username = option('--user');
const publicId =
  option('--id') ??
  (username ? null : process.argv.slice(2).find((value) => !value.startsWith('-')) ?? null);
if (publicId && username) {
  console.error('Choose either --id or --user, not both.');
  sqlite.close();
  process.exit(1);
}

if (username) {
  const count = revokeMcpTokensForUser(db, username);
  console.log(`Revoked ${count} live MCP token${count === 1 ? '' : 's'} for "${username}".`);
} else if (publicId) {
  const count = revokeMcpToken(db, publicId);
  console.log(count === 1 ? `Revoked MCP token ${publicId}.` : `No live MCP token ${publicId}.`);
} else {
  const tokens = listLiveMcpTokens(db);
  if (tokens.length === 0) console.log('No live MCP tokens.');
  else {
    console.log('publicId\tusername\tlabel\tcreatedAt\tlastUsedAt');
    for (const token of tokens) {
      console.log(
        [token.publicId, token.username, token.label, token.createdAt, token.lastUsedAt ?? 'never'].join('\t')
      );
    }
  }
}

sqlite.close();
