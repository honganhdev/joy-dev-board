import { describe, expect, test } from 'bun:test';
import { openDatabase } from '../src/db/client';
import {
  InvalidBoardColumnsError,
  readEnabledColumns,
  writeEnabledColumns,
} from '../src/db/preferences';
import { boardColumnSettings } from '../src/db/schema';

describe('board column preferences', () => {
  test('round-trips a normalised set', () => {
    const { db } = openDatabase(':memory:');

    expect(writeEnabledColumns(db, ['done_for_you', 'done', 'done_for_you'])).toEqual([
      'done_for_you',
    ]);
    expect(readEnabledColumns(db)).toEqual(['done_for_you']);
  });

  test('a corrupt row degrades to the five defaults', () => {
    const { db } = openDatabase(':memory:');
    db.insert(boardColumnSettings)
      .values({ id: 1, statuses: 'not json', updatedAt: new Date().toISOString() })
      .run();

    expect(readEnabledColumns(db)).toEqual([]);
  });

  test('read normalisation drops defaults and duplicate stored values', () => {
    const { db } = openDatabase(':memory:');
    db.insert(boardColumnSettings)
      .values({
        id: 1,
        statuses: JSON.stringify(['pending', 'done', 'pending']),
        updatedAt: new Date().toISOString(),
      })
      .run();

    expect(readEnabledColumns(db)).toEqual(['pending']);
  });

  test.each(['__proto__', 'constructor', 'prototype', '', ' '])(
    'rejects hostile status %p',
    (status) => {
      const { db } = openDatabase(':memory:');
      expect(() => writeEnabledColumns(db, [status])).toThrow(InvalidBoardColumnsError);

      db.insert(boardColumnSettings)
        .values({ id: 1, statuses: JSON.stringify([status]), updatedAt: new Date().toISOString() })
        .run();
      expect(readEnabledColumns(db)).toEqual([]);
    }
  );

  test('rejects more than 20 statuses and values over 64 characters', () => {
    const { db } = openDatabase(':memory:');
    expect(() =>
      writeEnabledColumns(
        db,
        Array.from({ length: 21 }, (_, index) => `status_${index}`)
      )
    ).toThrow(InvalidBoardColumnsError);
    expect(() => writeEnabledColumns(db, ['x'.repeat(65)])).toThrow(InvalidBoardColumnsError);
  });

  test('a missing table returns the safe empty preference', () => {
    const { db, sqlite } = openDatabase(':memory:');
    sqlite.exec('DROP TABLE board_column_settings');
    expect(readEnabledColumns(db)).toEqual([]);
  });
});
