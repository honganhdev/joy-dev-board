import { and, eq } from 'drizzle-orm';
import { BOARD_COLUMNS } from '../board/types';
import type { Db } from './client';
import { boardColumnSettings } from './schema';

const MAX_ENABLED_COLUMNS = 20;
const MAX_STATUS_LENGTH = 64;
/**
 * `tsStatus` is an open set, so the only thing a status cannot contain is a
 * character no display surface can render. There is no alphabet here on purpose:
 * every sink is already safe — SQL is parameterised, every status-keyed
 * structure is a `Map`, and React escapes text and attributes.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
/** Belt and braces: the `Map` conversion is what actually makes these inert. */
const UNSAFE_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const DEFAULT_STATUSES = new Set<string>(BOARD_COLUMNS.map((column) => column.status));

/** The stored set plus the version a writer has to quote back to replace it. */
export type BoardColumnPreference = {
  statuses: string[];
  version: number;
};

export class InvalidBoardColumnsError extends Error {
  constructor() {
    super('statuses must be an array of at most 20 status strings of at most 64 characters');
    this.name = 'InvalidBoardColumnsError';
  }
}

/** Raised when someone else replaced the row between this writer's read and write. */
export class BoardColumnVersionConflictError extends Error {
  constructor(readonly current: BoardColumnPreference) {
    super('the stored columns changed since they were read');
    this.name = 'BoardColumnVersionConflictError';
  }
}

/** The one validation and canonicalisation path used for stored and incoming values. */
export function normalise(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (
    !value.every(
      (status) =>
        typeof status === 'string' &&
        status.length <= MAX_STATUS_LENGTH &&
        status.trim().length > 0 &&
        !CONTROL_CHARACTERS.test(status) &&
        !UNSAFE_PROPERTY_NAMES.has(status)
    )
  ) {
    return null;
  }

  // Counted after normalising: 21 entries that reduce to three are three columns,
  // and rejecting them would refuse a set the board can render.
  const statuses = [...new Set(value.filter((status) => !DEFAULT_STATUSES.has(status)))];
  return statuses.length > MAX_ENABLED_COLUMNS ? null : statuses;
}

function readRow(db: Db): { statuses: string; version: number } | null {
  const [row] = db
    .select({ statuses: boardColumnSettings.statuses, version: boardColumnSettings.version })
    .from(boardColumnSettings)
    .where(eq(boardColumnSettings.id, 1))
    .limit(1)
    .all();
  return row ?? null;
}

/**
 * The stored preference and its version.
 *
 * A preference must never make the board less available than it was before, so
 * anything unreadable degrades to no extra columns. The version is still
 * reported when the row exists but its contents are unusable — otherwise a
 * corrupt row could never be overwritten.
 */
export function readBoardColumns(db: Db): BoardColumnPreference {
  let row: { statuses: string; version: number } | null;
  try {
    row = readRow(db);
  } catch (cause) {
    console.error('[preferences] unable to read board columns:', cause);
    return { statuses: [], version: 0 };
  }
  if (!row) return { statuses: [], version: 0 };

  try {
    const statuses = normalise(JSON.parse(row.statuses));
    if (!statuses) throw new Error('stored statuses are not valid');
    return { statuses, version: row.version };
  } catch (cause) {
    console.error('[preferences] unable to read board columns:', cause);
    return { statuses: [], version: row.version };
  }
}

export function readEnabledColumns(db: Db): string[] {
  return readBoardColumns(db).statuses;
}

/**
 * Replaces the stored set, but only if it is still the one the caller read.
 *
 * The version check is the whole point: without it two saves in flight commit in
 * whatever order they finish, and the board keeps the set the user already
 * replaced. `bun:sqlite` is synchronous, so nothing runs between the read and
 * the write below, and the `version` predicate on the UPDATE holds the same line
 * inside SQLite.
 */
export function writeEnabledColumns(
  db: Db,
  value: unknown,
  expectedVersion: unknown
): BoardColumnPreference {
  const statuses = normalise(value);
  if (!statuses) throw new InvalidBoardColumnsError();
  if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 0) {
    throw new InvalidBoardColumnsError();
  }

  const row = readRow(db);
  if ((row?.version ?? 0) !== expectedVersion) {
    throw new BoardColumnVersionConflictError(readBoardColumns(db));
  }

  const version = expectedVersion + 1;
  const next = {
    statuses: JSON.stringify(statuses),
    updatedAt: new Date().toISOString(),
    version,
  };
  if (row) {
    db.update(boardColumnSettings)
      .set(next)
      .where(and(eq(boardColumnSettings.id, 1), eq(boardColumnSettings.version, expectedVersion)))
      .run();
  } else {
    db.insert(boardColumnSettings).values({ id: 1, ...next }).run();
  }

  // Reading back is how the SQL predicate is observed: a write the `version`
  // clause refused leaves the row exactly as it was, and that is a conflict.
  if (readRow(db)?.version !== version) {
    throw new BoardColumnVersionConflictError(readBoardColumns(db));
  }
  return { statuses, version };
}
