import { describe, expect, test } from 'bun:test';
import {
  INITIAL_COLUMN_SETTINGS_STATE,
  reduceColumnSettings,
  sameColumnSet,
} from '../src/hooks/use-column-settings';

describe('reduceColumnSettings', () => {
  test('an older completion cannot clear a newer optimistic set', () => {
    const first = reduceColumnSettings(INITIAL_COLUMN_SETTINGS_STATE, {
      type: 'begin',
      sequence: 1,
      statuses: ['done_for_you'],
    });
    const second = reduceColumnSettings(first, {
      type: 'begin',
      sequence: 2,
      statuses: ['done_for_you', 'pending'],
    });

    expect(reduceColumnSettings(second, { type: 'settle', sequence: 1 })).toBe(second);
    expect(reduceColumnSettings(second, { type: 'settle', sequence: 2 })).toEqual({
      sequence: 2,
      pending: null,
    });
  });

  test('an older begin event cannot replace the latest selection', () => {
    const latest = reduceColumnSettings(INITIAL_COLUMN_SETTINGS_STATE, {
      type: 'begin',
      sequence: 4,
      statuses: ['pending'],
    });

    expect(
      reduceColumnSettings(latest, {
        type: 'begin',
        sequence: 3,
        statuses: ['done_for_you'],
      })
    ).toBe(latest);
  });
});

describe('sameColumnSet', () => {
  test('compares the stored response to the optimistic set without depending on order', () => {
    expect(sameColumnSet(['pending', 'done_for_you'], ['done_for_you', 'pending'])).toBe(true);
    expect(sameColumnSet(['pending'], ['done_for_you'])).toBe(false);
  });
});
