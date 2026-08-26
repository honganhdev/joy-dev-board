import { useCallback, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';
import { updateBoardColumns } from '@/lib/api';
import { boardColumnLabel } from '@/lib/board-columns';
import type { Board } from '@/types';

export type ColumnSettingsState = {
  sequence: number;
  pending: string[] | null;
};

export type ColumnSettingsEvent =
  | { type: 'begin'; sequence: number; statuses: string[] }
  | { type: 'settle'; sequence: number };

export const INITIAL_COLUMN_SETTINGS_STATE: ColumnSettingsState = {
  sequence: 0,
  pending: null,
};

/** Keeps an older request from clearing a newer optimistic selection. */
export function reduceColumnSettings(
  state: ColumnSettingsState,
  event: ColumnSettingsEvent
): ColumnSettingsState {
  if (event.sequence < state.sequence) return state;
  if (event.type === 'begin') return { sequence: event.sequence, pending: event.statuses };
  return { sequence: event.sequence, pending: null };
}

export function sameColumnSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((status) => right.includes(status));
}

type UseColumnSettingsOptions = {
  enabled: string[];
  refreshBoard: () => Promise<Board | null>;
};

export function useColumnSettings({ enabled, refreshBoard }: UseColumnSettingsOptions) {
  const [state, dispatch] = useReducer(reduceColumnSettings, INITIAL_COLUMN_SETTINGS_STATE);
  const [announcement, setAnnouncement] = useState('');
  const sequence = useRef(0);
  const selected = state.pending ?? enabled;

  const toggle = useCallback(
    async (status: string, checked: boolean) => {
      const statuses = checked
        ? [...new Set([...selected, status])]
        : selected.filter((candidate) => candidate !== status);
      const requestSequence = ++sequence.current;
      dispatch({ type: 'begin', sequence: requestSequence, statuses });

      try {
        const stored = await updateBoardColumns(statuses);
        if (requestSequence !== sequence.current) return;
        if (!sameColumnSet(stored.statuses, statuses)) {
          toast.error('Columns were changed by someone else.');
        }

        const board = await refreshBoard();
        if (requestSequence !== sequence.current) return;
        if (!board) throw new Error('Could not refresh the board.');

        const count = board.extraColumns.find((column) => column.status === status)?.count ?? 0;
        setAnnouncement(
          checked
            ? `${boardColumnLabel(status)} column added, ${count} ${count === 1 ? 'ticket' : 'tickets'}.`
            : `${boardColumnLabel(status)} column removed.`
        );
        dispatch({ type: 'settle', sequence: requestSequence });
      } catch (cause) {
        if (requestSequence !== sequence.current) return;
        dispatch({ type: 'settle', sequence: requestSequence });
        toast.error(cause instanceof Error ? cause.message : 'Could not update columns.');
      }
    },
    [refreshBoard, selected]
  );

  return {
    selected,
    busy: state.pending !== null,
    announcement,
    toggle,
  };
}
