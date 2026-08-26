import { eq } from 'drizzle-orm';
import { BOARD_COLUMNS } from '../board/types';
import type { Db } from './client';
import { boardColumnSettings } from './schema';

const MAX_ENABLED_COLUMNS = 20;
const STATUS_SHAPE = /^[A-Za-z0-9 _()-]{1,64}$/;
const UNSAFE_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const DEFAULT_STATUSES = new Set<string>(BOARD_COLUMNS.map((column) => column.status));

export class InvalidBoardColumnsError extends Error {
  constructor() {
    super('statuses must be an array of at most 20 valid status strings');
    this.name = 'InvalidBoardColumnsError';
  }
}

/** The one validation and canonicalisation path used for stored and incoming values. */
export function normalise(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ENABLED_COLUMNS) return null;
  if (
    !value.every(
      (status) =>
        typeof status === 'string' &&
        STATUS_SHAPE.test(status) &&
        status.trim().length > 0 &&
        !UNSAFE_PROPERTY_NAMES.has(status)
    )
  ) {
    return null;
  }

  return [...new Set(value.filter((status) => !DEFAULT_STATUSES.has(status)))];
}

/** A preference must never make the board less available than it was before. */
export function readEnabledColumns(db: Db): string[] {
  try {
    const [row] = db
      .select({ statuses: boardColumnSettings.statuses })
      .from(boardColumnSettings)
      .where(eq(boardColumnSettings.id, 1))
      .limit(1)
      .all();
    if (!row) return [];

    const statuses = normalise(JSON.parse(row.statuses));
    if (!statuses) throw new Error('stored statuses are not valid');
    return statuses;
  } catch (cause) {
    console.error('[preferences] unable to read board columns:', cause);
    return [];
  }
}

export function writeEnabledColumns(db: Db, value: unknown): string[] {
  const statuses = normalise(value);
  if (!statuses) throw new InvalidBoardColumnsError();

  const row = { id: 1, statuses: JSON.stringify(statuses), updatedAt: new Date().toISOString() };
  db.insert(boardColumnSettings)
    .values(row)
    .onConflictDoUpdate({
      target: boardColumnSettings.id,
      set: { statuses: row.statuses, updatedAt: row.updatedAt },
    })
    .run();

  return statuses;
}
