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
  test('lands on the week that is still running', () => {
    expect(defaultFocusWeek(weeks)?.key).toBe('W35');
  });

  test('uses the available week when none are finished and returns null when there are none', () => {
    expect(defaultFocusWeek([week('W35', true)])?.key).toBe('W35');
    expect(defaultFocusWeek([])).toBeNull();
  });

  test('defensively takes the last week when a malformed payload has no running week', () => {
    // This server always marks the final week as running; this branch only
    // keeps the pure helper total for a malformed payload that does not.
    expect(defaultFocusWeek([week('W32', false), week('W33', false)])?.key).toBe('W33');
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
    expect(resolveFocusedWeek(weeks, 'W20')?.key).toBe('W35');
    expect(resolveFocusedWeek(weeks, 'W33')?.key).toBe('W33');
    expect(resolveFocusedWeek(weeks, null)?.key).toBe('W35');
  });

  test('keeps a week the viewer chose when the new range still holds it', () => {
    // A wider range restores what was being looked at rather than snapping back
    // to that range's own default — including the running week, which the
    // default also picks but which remains an explicit stored choice.
    const wider = [week('W28', false), week('W29', false), ...weeks];

    expect(resolveFocusedWeek(wider, 'W33')?.key).toBe('W33');
    expect(resolveFocusedWeek(wider, 'W35')?.key).toBe('W35');
  });
});

describe('a range that no longer holds the focused week', () => {
  test('names the neighbours of the week it fell back to, not of the one that went', () => {
    // The page resolves the week first and asks for the neighbours of *that*.
    // Asking with the stored key would leave both buttons disabled on a page
    // plainly showing an interior week.
    const focused = resolveFocusedWeek(weeks, 'W20');

    expect(focused?.key).toBe('W35');
    expect(neighbourKeys(weeks, focused?.key ?? null)).toEqual({
      previous: 'W34',
      next: null,
    });
    // The vanished key on its own names no neighbour in either direction.
    expect(neighbourKeys(weeks, 'W20')).toEqual({ previous: null, next: null });
  });
});

describe('a malformed single-week payload', () => {
  // This server emits at least four weeks; these cases keep the pure helpers
  // total if a malformed payload contains only one.
  test('defensively keeps its only week focused and disables both directions', () => {
    const running = [week('W35', true)];
    expect(defaultFocusWeek(running)?.key).toBe('W35');
    expect(neighbourKeys(running, 'W35')).toEqual({ previous: null, next: null });
    expect(defaultFocusWeek([week('W34', false)])?.key).toBe('W34');
  });

  test('defensively falls back when the stored focus came from a wider range', () => {
    const running = [week('W35', true)];
    const focused = resolveFocusedWeek(running, 'W33');

    expect(focused?.key).toBe('W35');
    expect(neighbourKeys(running, focused?.key ?? null)).toEqual({
      previous: null,
      next: null,
    });
  });
});
