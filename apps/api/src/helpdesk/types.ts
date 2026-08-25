/**
 * Shape of a HelpDesk ticket as returned by `GET /tickets/by-date`.
 *
 * Only the keys this app reads are typed. HelpDesk adds keys per ticket
 * (`attachments`, `resolutionMetrics`, `refund`, …) so the type stays open and
 * every optional field is treated as possibly absent.
 */
export type HelpDeskStore = {
  domain?: string | null;
  shopName?: string | null;
  email?: string | null;
  shopifyPlan?: string | null;
};

export type HelpDeskMember = {
  memberId?: string | null;
  displayName?: string | null;
  authUid?: string | null;
  isCreate?: boolean;
};

export type HelpDeskTask = {
  id?: string | null;
  title?: string | null;
  completed?: boolean;
  completedAt?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
};

export type HelpDeskTag = {
  id: string;
  name?: string | null;
  color?: string | null;
};

export type HelpDeskTicket = {
  id: string;
  ticketId: string;
  ticketNumber?: string | null;
  type?: string | null;
  subject?: string | null;
  description?: string | null;
  /** Workflow status. NOT a closed enum — production has at least 12 values. */
  tsStatus?: string | null;
  /** `open` | `closed` (also treated as open-ended). */
  ticketStatus?: string | null;
  priority?: string | null;
  level?: number | null;
  appName?: string | null;
  appPlan?: string | null;
  members?: HelpDeskMember[] | null;
  memberIds?: string[] | null;
  store?: HelpDeskStore[] | null;
  storeDomains?: string[] | null;
  tagIds?: string[] | null;
  tasks?: HelpDeskTask[] | null;
  chatLink?: string | null;
  slackLink?: string | null;
  shortUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  dueDate?: string | null;
  /**
   * Set the first time HelpDesk sees the ticket reach a done-ish state
   * (`done`, `dev_done`, `done_speed_up`) and never cleared afterwards — so it
   * means "has been done at least once", not "is done now".
   */
  doneAt?: string | null;
  deletedAt?: string | null;
  [key: string]: unknown;
};

export type TagsResponse = {
  success?: boolean;
  data?: HelpDeskTag[];
};

export type ByDateResponse = {
  success?: boolean;
  data?: {
    tickets?: HelpDeskTicket[];
    total?: number;
  };
};
