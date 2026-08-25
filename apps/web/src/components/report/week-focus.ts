/**
 * Week selection stays in a pure module because this app has no DOM renderer,
 * so burying it in the report component would leave its boundary cases
 * untestable. The default is the last finished week: landing on a partial week
 * makes correct week-to-date figures look like a surprising drop.
 */
import type { WeekSummary } from '@/types';

export function defaultFocusWeek(weeks: WeekSummary[]): WeekSummary | null {
  for (let index = weeks.length - 1; index >= 0; index -= 1) {
    if (!weeks[index]?.inProgress) return weeks[index] ?? null;
  }
  return weeks[weeks.length - 1] ?? null;
}

export function resolveFocusedWeek(
  weeks: WeekSummary[],
  focusedKey: string | null
): WeekSummary | null {
  return weeks.find((week) => week.key === focusedKey) ?? defaultFocusWeek(weeks);
}

export function neighbourKeys(
  weeks: WeekSummary[],
  focusedKey: string | null
): { previous: string | null; next: string | null } {
  const index = weeks.findIndex((week) => week.key === focusedKey);
  if (index === -1) return { previous: null, next: null };

  return {
    previous: weeks[index - 1]?.key ?? null,
    next: weeks[index + 1]?.key ?? null,
  };
}
