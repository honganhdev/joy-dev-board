import { describe, expect, test } from 'bun:test';
import { boardColumnOptions } from '../src/lib/board-columns';
import type { Board } from '../src/types';

function board(): Board {
  return {
    pulledAt: '2026-08-24T04:00:00.000Z',
    totalTickets: 12,
    openTickets: 12,
    boardTickets: 5,
    columns: [],
    extraColumns: [
      { status: 'done_for_you', label: 'Done for you', count: 3, groups: [] },
      { status: 'retired_status', label: 'Retired status', count: 0, groups: [] },
    ],
    otherStatuses: [
      { status: 'pending', count: 4 },
      { status: '(no status)', count: 2 },
    ],
    lastPull: null,
  };
}

describe('boardColumnOptions', () => {
  test('unions open hidden statuses with every currently enabled status', () => {
    expect(boardColumnOptions(board())).toEqual([
      { status: '(no status)', label: 'No status', count: 2, enabled: false },
      { status: 'done_for_you', label: 'Done for you', count: 3, enabled: true },
      { status: 'pending', label: 'Pending', count: 4, enabled: false },
      { status: 'retired_status', label: 'Retired status', count: 0, enabled: true },
    ]);
  });

  test('prefers the enabled column when a status appears in both inputs', () => {
    const source = board();
    source.otherStatuses.push({ status: 'done_for_you', count: 99 });
    expect(boardColumnOptions(source).find((option) => option.status === 'done_for_you')).toEqual({
      status: 'done_for_you',
      label: 'Done for you',
      count: 3,
      enabled: true,
    });
  });
});
