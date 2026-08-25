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

  test('takes the last week when no week in the range is running', () => {
    // The server always ends the range on the week holding `now`, so this is
    // the shape a lagging mirror or a clock at a week boundary would produce:
    // there is nothing partial to step back from, so the last week is the week.
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
    expect(resolveFocusedWeek(weeks, 'W20')?.key).toBe('W34');
    expect(resolveFocusedWeek(weeks, 'W33')?.key).toBe('W33');
    expect(resolveFocusedWeek(weeks, null)?.key).toBe('W34');
  });

  test('keeps a week the viewer chose when the new range still holds it', () => {
    // A wider range restores what was being looked at rather than snapping back
    // to that range's own default — including the running week, which the
    // default would never pick but which the viewer may have stepped onto.
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

    expect(focused?.key).toBe('W34');
    expect(neighbourKeys(weeks, focused?.key ?? null)).toEqual({
      previous: 'W33',
      next: 'W35',
    });
    // The vanished key on its own names no neighbour in either direction.
    expect(neighbourKeys(weeks, 'W20')).toEqual({ previous: null, next: null });
  });
});

describe('a single-week range', () => {
  test('keeps its only week focused and disables both directions', () => {
    const running = [week('W35', true)];
    expect(defaultFocusWeek(running)?.key).toBe('W35');
    expect(neighbourKeys(running, 'W35')).toEqual({ previous: null, next: null });
    expect(defaultFocusWeek([week('W34', false)])?.key).toBe('W34');
  });

  test('falls back to that one week when the stored focus came from a wider range', () => {
    const running = [week('W35', true)];
    const focused = resolveFocusedWeek(running, 'W33');

    expect(focused?.key).toBe('W35');
    expect(neighbourKeys(running, focused?.key ?? null)).toEqual({
      previous: null,
      next: null,
    });
  });
});
