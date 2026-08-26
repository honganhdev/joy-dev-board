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
  test('a stored row that a writer would have rejected is still discarded on read', () => {
    // A row can arrive by hand edit or a restored backup and never pass through
    // the writer, so the read path has to hold the same line on its own.
    for (const stored of [
      JSON.stringify({ statuses: ['pending'] }),
      JSON.stringify(['pending', 42]),
      JSON.stringify(['pending', null]),
      JSON.stringify([['pending']]),
      JSON.stringify(Array.from({ length: 21 }, (_, index) => `status_${index}`)),
      JSON.stringify(['x'.repeat(65)]),
      JSON.stringify(['\u0110i\u1ec3m']),
      '[',
    ]) {
      const { db } = openDatabase(':memory:');
      db.insert(boardColumnSettings)
        .values({ id: 1, statuses: stored, updatedAt: new Date().toISOString() })
        .run();
      expect(readEnabledColumns(db)).toEqual([]);
    }
  });

  test('a wrong column type and a wrong table shape both degrade to no extras', () => {
    const wrongType = openDatabase(':memory:');
    wrongType.sqlite.exec(
      "INSERT INTO board_column_settings (id, statuses, updatedAt) VALUES (1, 12345, 'x')"
    );
    expect(readEnabledColumns(wrongType.db)).toEqual([]);

    const wrongShape = openDatabase(':memory:');
    wrongShape.sqlite.exec('DROP TABLE board_column_settings');
    wrongShape.sqlite.exec('CREATE TABLE board_column_settings (id integer PRIMARY KEY NOT NULL)');
    expect(readEnabledColumns(wrongShape.db)).toEqual([]);
  });
});
