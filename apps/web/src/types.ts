/**
 * Wire types for the board API.
 *
 * Source of truth is `apps/api/src/board/types.ts`; these are the browser-side
 * mirror. Keep them in step when the wire format changes.
 */

export type Category =
  | 'DFY SETUP'
  | 'ONBOARDING'
  | 'BILLING / PLAN'
  | 'REFERRAL'
  | 'TRANSLATION'
  | 'EMAIL / NOTIFY'
  | 'ANALYTICS'
  | 'INTEGRATIONS'
  | 'VIP TIERS'
  | 'EARNING RULES'
  | 'REDEEM / REWARDS'
  | 'POINTS'
  | 'COUPON / CHECKOUT'
  | 'LOYALTY PAGE'
  | 'WIDGET'
  | 'CUSTOMIZATION'
  | 'OTHER';

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
  status: string;
  label: string;
  count: number;
  groups: BoardGroup[];
};

/** What the API's last pull attempt did. */
export type PullSummary = {
  startedAt: string;
  finishedAt: string | null;
  ticketCount: number | null;
  status: 'ok' | 'error';
  error: string | null;
};

export type Board = {
  /** When the last *successful* pull finished. The board is served from SQLite. */
  pulledAt: string;
  totalTickets: number;
  openTickets: number;
  boardTickets: number;
  columns: BoardColumn[];
  otherStatuses: Array<{ status: string; count: number }>;
  /** May be a later failed attempt — that is how stale data is spotted. */
  lastPull: PullSummary | null;
};

/** What a `POST /api/pull` changed. */
export type PullResult = {
  pulled: number;
  inserted: number;
  statusChanges: number;
};

/**
 * One observed status change. `observedAt` is when a pull noticed it, not when
 * it happened — HelpDesk does not report change times.
 */
export type StatusHistoryEntry = {
  fromStatus: string | null;
  toStatus: string | null;
  observedAt: string;
  ticketUpdatedAt: string | null;
};

export type TicketStore = {
  domain?: string | null;
  shopName?: string | null;
  email?: string | null;
  shopifyPlan?: string | null;
};

export type TicketMember = {
  memberId?: string | null;
  displayName?: string | null;
};

export type TicketTask = {
  id?: string | null;
  title?: string | null;
  completed?: boolean;
  completedAt?: string | null;
};

export type TicketTag = { id: string; name: string; color: string | null };

/** Raw HelpDesk record plus the computed category. */
export type TicketDetail = {
  ticketId: string;
  ticketNumber?: string | null;
  subject?: string | null;
  description?: string | null;
  category: Category;
  tsStatus?: string | null;
  ticketStatus?: string | null;
  priority?: string | null;
  level?: number | null;
  appName?: string | null;
  appPlan?: string | null;
  store?: TicketStore[] | null;
  storeDomains?: string[] | null;
  members?: TicketMember[] | null;
  tasks?: TicketTask[] | null;
  tagIds?: string[] | null;
  /** `tagIds` resolved against the HelpDesk tag directory. */
  tags?: TicketTag[];
  chatLink?: string | null;
  slackLink?: string | null;
  shortUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  dueDate?: string | null;
  /**
   * When HelpDesk first saw the ticket reach a done-ish state (`done`,
   * `dev_done`, `done_speed_up`). It is never cleared, so it means "has been
   * done at least once", not "is done now".
   */
  doneAt?: string | null;
};

export type ApiError = { error: string; message: string };
