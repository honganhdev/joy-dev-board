import { describe, expect, test } from 'bun:test';
import { openDatabase } from '../src/db/client';
import {
  BoardColumnVersionConflictError,
  InvalidBoardColumnsError,
  readBoardColumns,
  readEnabledColumns,
  writeEnabledColumns,
} from '../src/db/preferences';
import { boardColumnSettings } from '../src/db/schema';

describe('board column preferences', () => {
  test('round-trips a normalised set', () => {
    const { db } = openDatabase(':memory:');

    expect(writeEnabledColumns(db, ['done_for_you', 'done', 'done_for_you'], 0)).toEqual({
      statuses: ['done_for_you'],
      version: 1,
    });
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
      expect(() => writeEnabledColumns(db, [status], 0)).toThrow(InvalidBoardColumnsError);

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
        Array.from({ length: 21 }, (_, index) => `status_${index}`),
        0
      )
    ).toThrow(InvalidBoardColumnsError);
    expect(() => writeEnabledColumns(db, ['x'.repeat(65)], 0)).toThrow(InvalidBoardColumnsError);
  });

  test('counts the cap after de-duplicating and dropping the defaults', () => {
    // 21 entries that reduce to three are three columns. Counting before
    // normalising refused a set the board renders perfectly well.
    const { db } = openDatabase(':memory:');
    const noisy = [
      ...Array.from({ length: 9 }, () => 'pending'),
      ...Array.from({ length: 9 }, () => 'done'),
      'onb',
      'onb',
      'customization',
    ];
    expect(noisy).toHaveLength(21);
    expect(writeEnabledColumns(db, noisy, 0).statuses).toEqual(['pending', 'onb', 'customization']);
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
      '[',
    ]) {
      const { db } = openDatabase(':memory:');
      db.insert(boardColumnSettings)
        .values({ id: 1, statuses: stored, updatedAt: new Date().toISOString() })
        .run();
      expect(readEnabledColumns(db)).toEqual([]);
    }
  });

  test('accepts every status the board can actually show', () => {
    // `tsStatus` is an open set, so a status is not required to look like ASCII.
    // A hardcoded alphabet listed `qa/review` in the footer, offered it a live
    // checkbox, and then 400d the click — the setting has to accept what it offers.
    const { db } = openDatabase(':memory:');
    expect(
      writeEnabledColumns(db, ['qa/review', '\u0110i\u1ec3m', 'needs.review', '(no status)'], 0)
        .statuses
    ).toEqual(['qa/review', '\u0110i\u1ec3m', 'needs.review', '(no status)']);
    expect(readEnabledColumns(db)).toEqual([
      'qa/review',
      '\u0110i\u1ec3m',
      'needs.review',
      '(no status)',
    ]);
  });

  test.each(['\u0000', 'a\u001fb', 'tab\there'])('rejects control character %p', (status) => {
    const { db } = openDatabase(':memory:');
    expect(() => writeEnabledColumns(db, [status], 0)).toThrow(InvalidBoardColumnsError);
  });

  test('a second writer quoting a stale version is refused, and the row is unchanged', () => {
    const { db } = openDatabase(':memory:');
    const first = writeEnabledColumns(db, ['pending'], 0);
    expect(first.version).toBe(1);

    // The older writer read version 0 and never saw the write above.
    let refused: unknown;
    try {
      writeEnabledColumns(db, [], 0);
    } catch (cause) {
      refused = cause;
    }
    expect(refused).toBeInstanceOf(BoardColumnVersionConflictError);
    expect((refused as BoardColumnVersionConflictError).current).toEqual({
      statuses: ['pending'],
      version: 1,
    });
    expect(readBoardColumns(db)).toEqual({ statuses: ['pending'], version: 1 });

    // Quoting the version it was told about, the same writer succeeds.
    expect(writeEnabledColumns(db, [], 1)).toEqual({ statuses: [], version: 2 });
  });

  test('a version that is not a whole non-negative number is refused', () => {
    const { db } = openDatabase(':memory:');
    for (const version of [undefined, null, '0', -1, 1.5, Number.NaN]) {
      expect(() => writeEnabledColumns(db, ['pending'], version)).toThrow(InvalidBoardColumnsError);
    }
  });

  test('a corrupt row still reports its version so it can be replaced', () => {
    const { db } = openDatabase(':memory:');
    db.insert(boardColumnSettings)
      .values({ id: 1, statuses: 'not json', updatedAt: new Date().toISOString(), version: 7 })
      .run();

    expect(readBoardColumns(db)).toEqual({ statuses: [], version: 7 });
    expect(writeEnabledColumns(db, ['pending'], 7)).toEqual({ statuses: ['pending'], version: 8 });
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
