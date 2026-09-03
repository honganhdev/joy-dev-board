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
  /** Null on rows written before these were recorded. */
  inserted: number | null;
  statusChanges: number | null;
  status: 'ok' | 'error' | 'running';
  error: string | null;
};

export type Board = {
  /** When the last *successful* pull finished. The board is served from SQLite. */
  pulledAt: string;
  totalTickets: number;
  openTickets: number;
  boardTickets: number;
  columns: BoardColumn[];
  extraColumns: BoardColumn[];
  otherStatuses: Array<{ status: string; count: number }>;
  /** Version of the stored column preference this board was assembled from. */
  columnVersion: number;
  /** May be a later failed attempt — that is how stale data is spotted. */
  lastPull: PullSummary | null;
  webhookAt?: string | null;
};

/**
 * One observed status change. `observedAt` is when this board noticed it, not
 * when it happened — HelpDesk does not report change times.
 */
export type StatusHistoryEntry = {
  fromStatus: string | null;
  toStatus: string | null;
  observedAt: string;
  ticketUpdatedAt: string | null;
};

/**
 * Wire shape of `GET /api/report/weekly`.
 *
 * Source of truth is `apps/api/src/board/report-types.ts`. Every label, caption
 * and rule here is a string the server rendered: the report view formats no
 * dates, cases no names and derives no counts.
 */
export type Comparison = {
  current: number;
  previous: number | null;
  delta: number | null;
  magnitudeLabel: string | null;
  percentLabel: string | null;
  /**
   * What a rise in this measure means, so the page can colour direction rather
   * than sign. Absent renders neutral: a comparison added without a decision
   * looks exactly as this page looks today.
   */
  valence?: 'riseIsBad' | 'riseIsGood';
};

export type WeekSummary = {
  /** ISO week key, e.g. `2026-W34`. */
  key: string;
  /** `Mon 17 Aug – Sun 23 Aug 2026`. */
  label: string;
  /** `17 Aug` — the column tick. */
  shortLabel: string;
  /** The week holding `now`: its figures are week-to-date, not final. */
  inProgress: boolean;
  /** The running day's label; `null` on every finished week. */
  currentDayLabel: string | null;
  /** Titles for the three headline tiles; the week still running is worded differently. */
  tileLabels: { created: string; done: string; outstanding: string };
  /** What this week's outstanding figure counts; the running week is worded differently. */
  outstandingCaption: string;
  created: number;
  createdComparison: Comparison;
  createdDeltaLabel: string | null;
  createdChangeLabel: string | null;
  done: number;
  medianDaysToDone: number | null;
  doneSample: number;
  /** `doneSample` in words, rendered verbatim under the weekly figure. */
  doneSampleLabel: string;
  /** Includes `closedWithoutDoneAt`. */
  outstanding: number;
  /** `outstanding` with the ghosts taken out; stacks with `closedWithoutDoneAt`. */
  outstandingWithDoneDate: number;
  /** The ghost residue *inside* `outstanding`, drawn as its own segment. */
  closedWithoutDoneAt: number;
  /** The residue as the tile's second figure, added to `outstandingWithDoneDate`; `null` when none. */
  outstandingCaveat: string | null;
  /** Focused-week totals, positional against the root-scoped split vocabularies. */
  daySplitTotals: {
    category: { created: number[]; done: number[] };
    status: { created: number[]; done: number[] };
  };
  /** Created here and already closed without a done date. */
  createdClosedWithoutDoneAt: number;
  /** Server-worded explanation of that excluded created cohort, or `null`. */
  createdClosedWithoutDoneAtNote: string | null;
  doneByStatus: Array<{ status: string; label: string; count: number }>;
  /** Any number of rows, any names — both come from the classifier at runtime. */
  categories: Array<{ category: string; label: string; done: number; outstanding: number }>;
  priorities: Array<{ priority: string; label: string; done: number; outstanding: number }>;
  /**
   * The focused week's seven days, Monday first. `created` and `done` are `null`
   * together when the day has not started and received nothing; a day that has
   * started reports a real 0.
   */
  days: Array<{
    /** `Mon 17 Aug` — the column tick. Unique within a week. */
    label: string;
    created: number | null;
    done: number | null;
    /** This day's share of the created cohort the status split leaves out. */
    createdClosedWithoutDoneAt: number | null;
    createdSplit: { category: number[]; status: number[] } | null;
    doneSplit: { category: number[]; status: number[] } | null;
  }>;
  /** The finished week's shape in words, or `null` when there is nothing final to describe. */
  daysHighlight: string | null;
  /** Future-day and day-to-date wording for the running week; `null` for a finished week. */
  daysNote: string | null;
};

export type GhostAudit = {
  count: number;
  /** Already worded, or `null` when there are none. */
  caveat: string | null;
};

export type RangeMeta = {
  /** Already clamped to what the mirror can answer; `unavailableNote` says why not. */
  presets: Array<{
    weeks: number;
    label: string;
    available: boolean;
    unavailableNote: string | null;
  }>;
  /** What the server actually used — may differ from what was requested. */
  selectedWeeks: number;
  coverageNote: string;
};

export type TimeToFirstDone = {
  sampleSize: number;
  unmeasurable: number;
  medianDays: number | null;
  /** Server wording for a range that finished nothing measurable. */
  noMedianLabel: string;
  withinTwoDaysNote: string | null;
  buckets: Array<{ label: string; count: number }>;
  caption: string;
};

/** One cohort of one clock: `done` or `dev_done`, split by `tsStatus`. */
export type ResolutionClockGroup = {
  /** Server-worded cohort name, printed verbatim. */
  label: string;
  /** Tickets in this cohort carrying this clock. Always real, never suppressed. */
  sampleSize: number;
  /** Hours to one decimal; `null` below the median floor of 3. */
  medianHours: number | null;
  /** Sample first, then the median or the no-median wording. Rendered verbatim. */
  sampleNote: string;
  /** One count per `bucketLabels` entry — same length, same order. */
  buckets: number[];
};

export type ResolutionClockPanel = {
  /** What it measures, where its clock starts, and what it is not comparable to. */
  caption: string;
  /** Tickets carrying this clock at all. */
  sampleSize: number;
  medianHours: number | null;
  /** The panel's own headline, sample first — the same shape the cohort rows use. */
  sampleNote: string;
  /** `sampleSize` against every dated ticket, in words. Sample first. */
  carriedNote: string;
  /** How the measured subset differs from the tickets on which this clock was not recorded. */
  selectionNote: string;
  /** The groups that carry no reading on this clock. */
  unmeasuredNote: string;
  /** Carrying the clock under some other HelpDesk status; `null` when none do. */
  otherStatusNote: string | null;
  done: ResolutionClockGroup;
  devDone: ResolutionClockGroup;
};

export type ResolutionClocks = {
  /** Band heading: scope, population and rule, in the server's words. */
  sectionTitle: string;
  /** Why the range control above does not reach this band. */
  scopeRule: string;
  /** What the shared bar scale does and does not compare. Rendered under the bars. */
  scaleNote: string;
  /** The shared hour axis. Every `buckets` array has this length and order. */
  bucketLabels: string[];
  /** Server wording for a cohort under the median floor. */
  noMedianLabel: string;
  /** Names the two clocks on the toggle; the browser composes no list. */
  clockLabels: { csReply: string; customerOk: string };
  csReply: ResolutionClockPanel;
  customerOk: ResolutionClockPanel;
};

export type PlanReading = {
  rows: Array<{ key: string; label: string; count: number }>;
  freeNote: string | null;
  scopeNote: string;
};

export type MerchantReading = {
  rows: Array<{ key: string; label: string; count: number }>;
  concentrationNote: string;
  tailNote: string | null;
  tailCount: number;
  scopeNote: string;
};

export type WeeklyReport = {
  /** Oldest first. Drives every panel. */
  weeks: WeekSummary[];
  range: RangeMeta;
  /** The backlog panel's heading, worded for whether the last column is a finished week. */
  backlogTitle: string;
  weeklySpeed: {
    caption: string;
    emptyWeeksNote: string | null;
    unavailableLabel: string | null;
  };
  weeklyGrowth: {
    /** Names the row of figures, rendered verbatim above it. */
    title: string;
    caption: string;
    direction: string;
    horizonNote: string | null;
    unavailableNote: string | null;
  };
  /** Range-scoped, not week-scoped. */
  timeToFirstDone: TimeToFirstDone;
  /**
   * Lifetime-scoped and population-wide: HelpDesk computes these over each
   * ticket's whole life, so the range control does not reach them and the
   * dev-fix filter does not apply. Its own band says both.
   */
  resolutionClocks: ResolutionClocks;
  /** About the current day, independent of the focused week. */
  dayComparison: Comparison & {
    title: string;
    caption: string;
    currentLabel: string;
    changeLabel: string | null;
    unavailableNote: string | null;
  };
  /** Selected range up to now against the equally long preceding range. */
  rangeComparison: Comparison & {
    title: string;
    caption: string;
    currentLabel: string;
    changeLabel: string | null;
    unavailableNote: string | null;
  };
  /** Range-wide vocabularies and every server-owned word used by the day split. */
  daySplit: {
    categories: Array<{ category: string; label: string }>;
    statuses: Array<{ status: string; label: string }>;
    modeLabels: { off: string; category: string; status: string };
    cohortLabels: { created: string; done: string };
    excludedLabel: string;
    captions: { category: string; status: string };
    unavailableNotes: { category: string; status: string };
    asOfLabel: string;
  };
  openBacklog: {
    total: number;
    agingHeadline: string | null;
    buckets: Array<{ label: string; count: number }>;
    noCreatedDate: number;
    noCreatedDateLabel: string;
    oldest: Array<{
      ticketId: string;
      subject: string;
      merchant: string;
      ageDays: number;
      ageLabel: string;
    }>;
    /** Names the cap on `oldest`; rendered verbatim. */
    oldestCaption: string;
  };
  openSectionTitle: string;
  /**
   * Both breakdown panels read one population — Dev Fixing or Dev Done tickets
   * created in the selected range — under two readings, and the control that
   * chooses between them is shared, so the two panels always answer the same
   * question.
   */
  openBreakdown: {
    scopeLabels: { createdInRange: string; stillOpen: string };
  };
  openByPlan: {
    createdInRange: PlanReading;
    stillOpen: PlanReading;
  };
  openByMerchant: {
    createdInRange: MerchantReading;
    stillOpen: MerchantReading;
  };
  openByFeature: {
    rows: Array<{
      key: string;
      label: string;
      open: number;
      /** The `olderThan30` denominator: open tickets whose created date is readable. */
      openWithCreatedDate: number;
      olderThan30: number;
      medianDaysToDone: number | null;
      doneSample: number;
      speedNote: string;
      comparison: Comparison;
      /** Server wording for the intake change; `null` with no earlier range. */
      changeLabel: string | null;
    }>;
    unavailableNote: string | null;
    caption: string;
  };
  openRightNow: number;
  /** Open tickets whose HelpDesk status is Dev Fixing or Dev Done. */
  devFixOpenRightNow: number;
  /** Names that cohort beside the figure, so the client composes no prose. */
  devFixOpenRightNowLabel: string;
  ghosts: GhostAudit;
  /** `undated` is a ticket with neither a created nor a done date: it fits in no week. */
  excluded: { deleted: number; unparseableDate: number; undated: number; notDevFix: number };
  /** The same exclusions in words, or `null` when there are none. Rendered verbatim. */
  excludedNote: string | null;
  /** The dev-fix counting rule, rendered verbatim. */
  bugRule: string;
  doneRule: string;
  /** The timezone and boundary rule, rendered on screen verbatim. */
  timeZoneNote: string;
  /** Server-worded heading for the multi-week context section. */
  trendSectionTitle: string;
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
