import type { Category } from './categories';
import type { HelpDeskTicket } from '../helpdesk/types';

/** The five workflow statuses shown as columns, in display order. */
export const BOARD_COLUMNS = [
  { status: 'dev_fixing', label: 'DEV FIXING' },
  { status: 'doing', label: 'DOING' },
  { status: 'waiting_customer', label: 'WAITING CUSTOMER' },
  { status: 'dev_done', label: 'DEV DONE' },
  { status: 'done', label: 'DONE' },
] as const;

export type BoardStatus = (typeof BOARD_COLUMNS)[number]['status'];

/** Trimmed ticket shape sent to the board. Detail is fetched separately. */
export type BoardTicket = {
  ticketId: string;
  subject: string;
  category: Category;
  shopName: string | null;
  domain: string | null;
  memberNames: string[];
  createdAt: string | null;
  chatLink: string | null;
  slackLink: string | null;
  shortUrl: string | null;
};

export type BoardGroup = {
  category: Category;
  count: number;
  tickets: BoardTicket[];
};

export type BoardColumn = {
  status: BoardStatus;
  label: string;
  count: number;
  groups: BoardGroup[];
};

export type ExtraBoardColumn = {
  status: string;
  label: string;
  count: number;
  groups: BoardGroup[];
};

export type Board = {
  /** When the underlying HelpDesk pull happened. */
  pulledAt: string;
  /** Every JOY ticket HelpDesk returned for the year. */
  totalTickets: number;
  /** `ticketStatus === "open"` subset. */
  openTickets: number;
  /** Open cards actually rendered in a default or enabled extra column. */
  boardTickets: number;
  columns: BoardColumn[];
  extraColumns: ExtraBoardColumn[];
  /**
   * Open tickets whose `tsStatus` has no column, counted per status so an
   * unknown or unmapped status is visible rather than silently dropped.
   */
  otherStatuses: Array<{ status: string; count: number }>;
};

/** Full ticket detail: the raw HelpDesk record plus the computed category. */
export type TicketDetail = HelpDeskTicket & { category: Category };

/** What the last pull attempt did, so the UI can say how old the board is. */
export type PullSummary = {
  startedAt: string;
  finishedAt: string | null;
  ticketCount: number | null;
  /** Null on rows written before these were recorded. */
  inserted: number | null;
  statusChanges: number | null;
  status: 'ok' | 'error' | 'running';
  error: string | null;
};

/**
 * The board as served: assembled from SQLite, with the last pull attached.
 * `pulledAt` is the last *successful* pull; `lastPull` may be a later failed
 * attempt, which is how a stale board is told apart from a fresh one.
 */
export type BoardResponse = Board & {
  /** Version of the stored column preference this board was assembled from. */
  columnVersion: number;
  lastPull: PullSummary | null;
  webhookAt: string | null;
};
