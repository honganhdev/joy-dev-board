import { humanise } from '@/lib/status-label';
import type { Board } from '@/types';

export type BoardColumnOption = {
  status: string;
  label: string;
  count: number;
  enabled: boolean;
};

export function boardColumnLabel(status: string): string {
  return status === '(no status)' ? 'No status' : humanise(status);
}

/** Uses the unfiltered board so searching cannot change which settings are offered. */
export function boardColumnOptions(board: Board): BoardColumnOption[] {
  const options = new Map<string, BoardColumnOption>();

  for (const entry of board.otherStatuses) {
    options.set(entry.status, {
      status: entry.status,
      label: boardColumnLabel(entry.status),
      count: entry.count,
      enabled: false,
    });
  }

  for (const column of board.extraColumns) {
    options.set(column.status, {
      status: column.status,
      label: boardColumnLabel(column.status),
      count: column.count,
      enabled: true,
    });
  }

  // Sorted the way the list reads, not the way the statuses spell: `(no status)`
  // shows as "No status" and belongs after "Customization". Status breaks ties.
  return [...options.values()].sort(
    (a, b) => a.label.localeCompare(b.label) || a.status.localeCompare(b.status)
  );
}
