/**
 * Safe SQLite backup.
 *
 * `VACUUM INTO` asks SQLite to write a consistent copy of the database while it
 * is being used. A plain `cp` of a live file can capture a torn write or miss
 * the WAL entirely, which produces a backup that only fails when it is needed.
 *
 * Usage: bun run db:backup [destination.db]
 */
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '../src/config';

const config = loadConfig();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination =
  process.argv[2] ?? join(dirname(config.databasePath), 'backups', `board-${stamp}.db`);

mkdirSync(dirname(destination), { recursive: true });

const source = new Database(config.databasePath, { readonly: true });
source.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
source.close();

// Read the copy back so the script fails here rather than during a restore.
const copy = new Database(destination, { readonly: true });
const integrity = copy.query('PRAGMA integrity_check').get() as { integrity_check?: string } | null;
const tickets = copy.query('SELECT count(*) AS total FROM tickets').get() as { total: number };
const history = copy.query('SELECT count(*) AS total FROM ticket_status_history').get() as { total: number };
copy.close();

if (integrity?.integrity_check !== 'ok') {
  console.error(`Backup at ${destination} failed integrity_check: ${integrity?.integrity_check}`);
  process.exit(1);
}

console.log(
  `Backed up ${config.databasePath} → ${destination} ` +
    `(${tickets.total} tickets, ${history.total} history rows, integrity_check ok)`
);
