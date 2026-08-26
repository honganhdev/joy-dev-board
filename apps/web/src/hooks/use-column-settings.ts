import { useCallback, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';
import { fetchBoard, updateBoardColumns, type BoardColumnUpdate } from '@/lib/api';
import { boardColumnLabel } from '@/lib/board-columns';
import type { Board } from '@/types';

export type ColumnSettingsState = {
  sequence: number;
  pending: string[] | null;
  /** True from the moment a save starts until it stops being in flight. */
  writing: boolean;
};

export type ColumnSettingsEvent =
  | { type: 'begin'; sequence: number; statuses: string[] }
  | { type: 'settle'; sequence: number }
  /** A set that is known to be stored but is not yet reflected in the board. */
  | { type: 'reconcile'; sequence: number; statuses: string[] };

export const INITIAL_COLUMN_SETTINGS_STATE: ColumnSettingsState = {
  sequence: 0,
  pending: null,
  writing: false,
};

/** Keeps an older request from clearing a newer optimistic selection. */
export function reduceColumnSettings(
  state: ColumnSettingsState,
  event: ColumnSettingsEvent
): ColumnSettingsState {
  if (event.sequence < state.sequence) return state;
  if (event.type === 'begin') {
    return { sequence: event.sequence, pending: event.statuses, writing: true };
  }
  if (event.type === 'reconcile') {
    return { sequence: event.sequence, pending: event.statuses, writing: false };
  }
  return { sequence: event.sequence, pending: null, writing: false };
}

/** Everything one column write touches, so the write itself can be run without React. */
export type ColumnWriteDeps = {
  save: (statuses: string[], version: number) => Promise<BoardColumnUpdate>;
  readBoard: () => Promise<Board>;
  /** Writes the board into global state. Only ever called for the newest write. */
  applyBoard: (board: Board) => void;
  /** False once a later toggle has started. */
  isCurrent: () => boolean;
  dispatch: (event: ColumnSettingsEvent) => void;
  announce: (message: string) => void;
  reportError: (message: string) => void;
  rememberVersion: (version: number) => void;
};

export type ColumnWrite = {
  status: string;
  checked: boolean;
  statuses: string[];
  version: number;
  sequence: number;
};

/**
 * Saves one column selection and brings the board back in line with it.
 *
 * Two things this has to keep apart. An older request must never write global
 * state, so the board is read here and the staleness check happens *before* it
 * is applied — a re-read that both fetches and writes would have written the
 * older board before anyone could refuse it. And a save that committed is not a
 * failure just because the board could not be re-read afterwards: the row has
 * changed, so the selection stays on screen and only the refresh is reported.
 */
export async function runColumnWrite(write: ColumnWrite, deps: ColumnWriteDeps): Promise<void> {
  const { status, checked, statuses, version, sequence } = write;

  let stored: BoardColumnUpdate;
  try {
    stored = await deps.save(statuses, version);
  } catch (cause) {
    if (!deps.isCurrent()) return;
    deps.dispatch({ type: 'settle', sequence });
    deps.reportError(cause instanceof Error ? cause.message : 'Could not update columns.');
    return;
  }

  if (!deps.isCurrent()) return;
  deps.rememberVersion(stored.version);

  const board = await deps.readBoard().catch(() => null);
  if (!deps.isCurrent()) return;
  if (board) deps.applyBoard(board);

  if (!stored.ok) {
    // The server refused the write because the row had already moved on. The
    // refreshed board carries what is stored now; if the re-read failed, the
    // refusal's own set is the closest thing to the truth this tab has.
    deps.reportError('Columns were changed by someone else.');
    deps.dispatch(
      board
        ? { type: 'settle', sequence }
        : { type: 'reconcile', sequence, statuses: stored.statuses }
    );
    return;
  }

  if (!board) {
    deps.dispatch({ type: 'reconcile', sequence, statuses: stored.statuses });
    deps.reportError('Columns saved, but the board could not be refreshed.');
    return;
  }

  const count = board.extraColumns.find((column) => column.status === status)?.count ?? 0;
  deps.announce(
    checked
      ? `${boardColumnLabel(status)} column added, ${count} ${count === 1 ? 'ticket' : 'tickets'}.`
      : `${boardColumnLabel(status)} column removed.`
  );
  deps.dispatch({ type: 'settle', sequence });
}

type UseColumnSettingsOptions = {
  enabled: string[];
  /** Version of the preference the current board was assembled from. */
  version: number;
  applyBoard: (board: Board) => void;
};

export function useColumnSettings({ enabled, version, applyBoard }: UseColumnSettingsOptions) {
  const [state, dispatch] = useReducer(reduceColumnSettings, INITIAL_COLUMN_SETTINGS_STATE);
  const [announcement, setAnnouncement] = useState('');
  const sequence = useRef(0);
  // The board prop lags a save until its re-read lands, and a save whose re-read
  // never landed leaves it lagging for good. The newest version either source
  // has produced is the one to quote back.
  const seenVersion = useRef(version);
  const selected = state.pending ?? enabled;

  const toggle = useCallback(
    async (status: string, checked: boolean) => {
      const statuses = checked
        ? [...new Set([...selected, status])]
        : selected.filter((candidate) => candidate !== status);
      const requestSequence = ++sequence.current;
      dispatch({ type: 'begin', sequence: requestSequence, statuses });

      await runColumnWrite(
        {
          status,
          checked,
          statuses,
          version: Math.max(version, seenVersion.current),
          sequence: requestSequence,
        },
        {
          save: updateBoardColumns,
          readBoard: fetchBoard,
          applyBoard,
          isCurrent: () => requestSequence === sequence.current,
          dispatch,
          announce: setAnnouncement,
          reportError: (message) => toast.error(message),
          rememberVersion: (next) => {
            seenVersion.current = Math.max(seenVersion.current, next);
          },
        }
      );
    },
    [applyBoard, selected, version]
  );

  return {
    selected,
    busy: state.writing,
    announcement,
    toggle,
  };
}
