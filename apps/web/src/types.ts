/**
 * Wire types for the board API.
 *
 * Source of truth is `apps/api/src/board/types.ts`; these are the browser-side
 * mirror. Keep them in step when the wire format changes.
 */

export type Category =
  | 'REFERRAL'
  | 'TRANSLATION / EMAIL'
  | 'ANALYTICS'
  | 'INTEGRATIONS'
  | 'WIDGET / UNIFIED'
  | 'COUPON / CART'
  | 'POINTS / ACTIVITY'
  | 'PROGRAM ADMIN'
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

export type Board = {
  pulledAt: string;
  totalTickets: number;
  openTickets: number;
  boardTickets: number;
  columns: BoardColumn[];
  otherStatuses: Array<{ status: string; count: number }>;
  fromCache?: boolean;
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
};

export type ApiError = { error: string; message: string };
