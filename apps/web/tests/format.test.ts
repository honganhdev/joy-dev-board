import { describe, expect, test } from 'bun:test';
import { formatAge, formatDuration } from '../src/lib/format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatDuration', () => {
  test('collapses anything under a minute', () => {
    expect(formatDuration(0)).toBe('<1m');
    expect(formatDuration(59_999)).toBe('<1m');
  });

  test('shows at most two units', () => {
    expect(formatDuration(45 * MINUTE)).toBe('45m');
    expect(formatDuration(3 * HOUR)).toBe('3h');
    expect(formatDuration(3 * HOUR + 20 * MINUTE)).toBe('3h 20m');
    expect(formatDuration(2 * DAY)).toBe('2d');
    expect(formatDuration(2 * DAY + 4 * HOUR + 59 * MINUTE)).toBe('2d 4h');
  });
});

describe('formatAge', () => {
  const now = Date.parse('2026-08-24T12:00:00.000Z');

  test('reads as elapsed time', () => {
    expect(formatAge('2026-08-24T09:00:00.000Z', now)).toBe('3h ago');
    expect(formatAge('2026-08-24T11:59:30.000Z', now)).toBe('just now');
  });

  test('a missing or unparseable timestamp is never', () => {
    expect(formatAge(null, now)).toBe('never');
    expect(formatAge('not a date', now)).toBe('never');
  });
});
