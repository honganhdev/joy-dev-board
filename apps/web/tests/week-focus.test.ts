import { describe, expect, test } from 'bun:test';
import {
  defaultFocusWeek,
  neighbourKeys,
  resolveFocusedWeek,
} from '../src/components/report/week-focus';
import type { WeekSummary } from '../src/types';

function week(key: string, inProgress: boolean): WeekSummary {
  return { key, inProgress } as unknown as WeekSummary;
}

const weeks = [
  week('W32', false),
  week('W33', false),
  week('W34', false),
  week('W35', true),
];

describe('defaultFocusWeek', () => {
  test('lands on the last finished week rather than the one still running', () => {
    expect(defaultFocusWeek(weeks)?.key).toBe('W34');
  });

  test('uses the available week when none are finished and returns null when there are none', () => {
    expect(defaultFocusWeek([week('W35', true)])?.key).toBe('W35');
    expect(defaultFocusWeek([])).toBeNull();
  });
});

describe('neighbourKeys', () => {
  test('clamps at both ends and names the weeks beside an interior focus', () => {
    expect(neighbourKeys(weeks, 'W32')).toEqual({ previous: null, next: 'W33' });
    expect(neighbourKeys(weeks, 'W35')).toEqual({ previous: 'W34', next: null });
    expect(neighbourKeys(weeks, 'W33')).toEqual({ previous: 'W32', next: 'W34' });
    expect(neighbourKeys(weeks, null)).toEqual({ previous: null, next: null });
  });
});

describe('resolveFocusedWeek', () => {
  test('falls back to the default when a range no longer contains the stored focus', () => {
    expect(resolveFocusedWeek(weeks, 'W20')?.key).toBe('W34');
    expect(resolveFocusedWeek(weeks, 'W33')?.key).toBe('W33');
    expect(resolveFocusedWeek(weeks, null)?.key).toBe('W34');
  });
});

describe('a single-week range', () => {
  test('keeps its only week focused and disables both directions', () => {
    const running = [week('W35', true)];
    expect(defaultFocusWeek(running)?.key).toBe('W35');
    expect(neighbourKeys(running, 'W35')).toEqual({ previous: null, next: null });
    expect(defaultFocusWeek([week('W34', false)])?.key).toBe('W34');
  });
});
