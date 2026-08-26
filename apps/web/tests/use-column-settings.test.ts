import { describe, expect, test } from 'bun:test';
import {
  INITIAL_COLUMN_SETTINGS_STATE,
  reduceColumnSettings,
  runColumnWrite,
  type ColumnSettingsEvent,
  type ColumnWriteDeps,
} from '../src/hooks/use-column-settings';
import type { Board } from '../src/types';

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
      writing: false,
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

  test('a write is in flight from begin until it settles or reconciles', () => {
    const writing = reduceColumnSettings(INITIAL_COLUMN_SETTINGS_STATE, {
      type: 'begin',
      sequence: 1,
      statuses: ['pending'],
    });
    expect(writing.writing).toBe(true);

    // Reconcile keeps a selection that is known to be stored on screen while
    // releasing the control, so a failed board re-read does not lock the popover.
    const reconciled = reduceColumnSettings(writing, {
      type: 'reconcile',
      sequence: 1,
      statuses: ['pending'],
    });
    expect(reconciled).toEqual({ sequence: 1, pending: ['pending'], writing: false });
    expect(reduceColumnSettings(writing, { type: 'settle', sequence: 1 }).writing).toBe(false);
  });
});

function board(extraColumns: Array<{ status: string; count: number }>): Board {
  return {
    pulledAt: '2026-08-26T04:00:00.000Z',
    totalTickets: 0,
    openTickets: 0,
    boardTickets: 0,
    columns: [],
    extraColumns: extraColumns.map(({ status, count }) => ({
      status,
      label: status,
      count,
      groups: [],
    })),
    otherStatuses: [],
    columnVersion: 1,
    lastPull: null,
  };
}

type Recorded = {
  events: ColumnSettingsEvent[];
  applied: Board[];
  errors: string[];
  announcements: string[];
  versions: number[];
};

function harness(
  overrides: Partial<ColumnWriteDeps> = {}
): { deps: ColumnWriteDeps; recorded: Recorded } {
  const recorded: Recorded = {
    events: [],
    applied: [],
    errors: [],
    announcements: [],
    versions: [],
  };
  const deps: ColumnWriteDeps = {
    save: async (statuses) => ({ ok: true, statuses, version: 2 }),
    readBoard: async () => board([]),
    applyBoard: (next) => recorded.applied.push(next),
    isCurrent: () => true,
    dispatch: (event) => recorded.events.push(event),
    announce: (message) => recorded.announcements.push(message),
    reportError: (message) => recorded.errors.push(message),
    rememberVersion: (version) => recorded.versions.push(version),
    ...overrides,
  };
  return { deps, recorded };
}

const WRITE = {
  status: 'done_for_you',
  checked: true,
  statuses: ['done_for_you'],
  version: 1,
  sequence: 1,
};

describe('runColumnWrite', () => {
  test('a board that arrives after a newer toggle never reaches global state', async () => {
    // The guard has to come before the write, not after it. A re-read that
    // fetches and applies in one step has already replaced `board` — and with it
    // the enabled set the checkbox is derived from — by the time anyone can
    // refuse it, so the newer selection silently disappears.
    let current = true;
    const { deps, recorded } = harness({
      readBoard: async () => {
        // A newer toggle starts while this older request is still in flight.
        current = false;
        return board([]);
      },
      isCurrent: () => current,
    });

    await runColumnWrite(WRITE, deps);

    expect(recorded.applied).toEqual([]);
    expect(recorded.events).toEqual([]);
    expect(recorded.announcements).toEqual([]);
  });

  test('a save that loses the race is dropped before it touches anything', async () => {
    let current = true;
    const { deps, recorded } = harness({
      save: async (statuses) => {
        current = false;
        return { ok: true, statuses, version: 2 };
      },
      isCurrent: () => current,
    });

    await runColumnWrite(WRITE, deps);

    expect(recorded.applied).toEqual([]);
    expect(recorded.events).toEqual([]);
    expect(recorded.versions).toEqual([]);
  });

  test('the newest write applies its board, announces, and settles', async () => {
    const { deps, recorded } = harness({
      readBoard: async () => board([{ status: 'done_for_you', count: 129 }]),
    });

    await runColumnWrite(WRITE, deps);

    expect(recorded.applied).toHaveLength(1);
    expect(recorded.versions).toEqual([2]);
    expect(recorded.announcements).toEqual(['Done for you column added, 129 tickets.']);
    expect(recorded.events).toEqual([{ type: 'settle', sequence: 1 }]);
    expect(recorded.errors).toEqual([]);
  });

  test('a refused write warns about the other person and shows what is stored', async () => {
    // This is the clobber warning actually firing: the server refused the write
    // because someone else had already replaced the row.
    const { deps, recorded } = harness({
      save: async () => ({ ok: false, statuses: ['pending'], version: 5 }),
      readBoard: async () => board([{ status: 'pending', count: 8 }]),
    });

    await runColumnWrite(WRITE, deps);

    expect(recorded.errors).toEqual(['Columns were changed by someone else.']);
    expect(recorded.applied).toHaveLength(1);
    expect(recorded.applied[0]?.extraColumns.map((column) => column.status)).toEqual(['pending']);
    expect(recorded.events).toEqual([{ type: 'settle', sequence: 1 }]);
    expect(recorded.announcements).toEqual([]);
  });

  test('a refusal whose board re-read also fails still shows the stored set', async () => {
    const { deps, recorded } = harness({
      save: async () => ({ ok: false, statuses: ['pending'], version: 5 }),
      readBoard: async () => {
        throw new Error('offline');
      },
    });

    await runColumnWrite(WRITE, deps);

    expect(recorded.errors).toEqual(['Columns were changed by someone else.']);
    expect(recorded.events).toEqual([
      { type: 'reconcile', sequence: 1, statuses: ['pending'] },
    ]);
  });

  test('a committed write whose board re-read fails is not reported as a failed save', async () => {
    // The row changed. Reverting the selection here would make this tab show and
    // say the opposite of what is stored, and a retry would send another
    // unintended whole-set replacement.
    const { deps, recorded } = harness({
      readBoard: async () => {
        throw new Error('The board API took too long to answer.');
      },
    });

    await runColumnWrite(WRITE, deps);

    expect(recorded.applied).toEqual([]);
    expect(recorded.events).toEqual([
      { type: 'reconcile', sequence: 1, statuses: ['done_for_you'] },
    ]);
    expect(recorded.errors).toEqual(['Columns saved, but the board could not be refreshed.']);
  });

  test('a save that never reached the server reverts the selection and reports it', async () => {
    const { deps, recorded } = harness({
      save: async () => {
        throw new Error('Cannot reach the board API.');
      },
    });

    await runColumnWrite(WRITE, deps);

    expect(recorded.events).toEqual([{ type: 'settle', sequence: 1 }]);
    expect(recorded.errors).toEqual(['Cannot reach the board API.']);
    expect(recorded.applied).toEqual([]);
  });

  test('removing a column announces the removal, not a count', async () => {
    const { deps, recorded } = harness();

    await runColumnWrite({ ...WRITE, checked: false, statuses: [] }, deps);

    expect(recorded.announcements).toEqual(['Done for you column removed.']);
  });
});
