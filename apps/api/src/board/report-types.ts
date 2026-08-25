/**
 * Wire shape of `GET /api/report/weekly`.
 *
 * The client formats nothing and derives nothing: every label, caption and rule
 * on the page arrives here as a string, and every number it draws is a number it
 * is given. That is what keeps date formatting, title-casing and arithmetic out
 * of the browser, where a second implementation of the done rule would drift
 * away from the one the tests pin.
 */

export type WeekSummary = {
  /** ISO week key, e.g. `2026-W34`. */
  key: string;
  /** `Mon 17 Aug – Sun 23 Aug 2026`. */
  label: string;
  /** `17 Aug` — the column tick. */
  shortLabel: string;
  created: number;
  done: number;
  /** Includes `closedWithoutDoneAt`. */
  outstanding: number;
  /**
   * `outstanding` with the ghosts already taken out. The backlog stack is this
   * segment plus `closedWithoutDoneAt`, so the column totals `outstanding`.
   * Emitted rather than subtracted in the renderer, which does no arithmetic.
   */
  outstandingWithDoneDate: number;
  /** The ghost residue *inside* `outstanding`, drawn as its own segment. */
  closedWithoutDoneAt: number;
  /**
   * The residue as the tile's second figure — `+N tickets closed with no done
   * date`, the addend that takes `outstandingWithDoneDate` back up to
   * `outstanding` — or `null` when this week has none, so the tile renders a
   * single clean figure. Week-scoped rather than mirror-scoped so the line
   * always describes the week the tile is showing.
   */
  outstandingCaveat: string | null;
  /** The done cohort split by each ticket's *current* tsStatus. Sums to `done`. */
  doneByStatus: Array<{ status: string; label: string; count: number }>;
  /**
   * One row per category present in either cohort, sorted by done+outstanding
   * descending with the classifier's catch-all category last. Both the names and
   * how many there are come from the classifier, so a renderer must handle any
   * number of rows and any name. `label` is what the panel prints.
   */
  categories: Array<{ category: string; label: string; done: number; outstanding: number }>;
  /** Same rule; an absent or unknown priority is a row keyed `(no priority)`, pinned last. */
  priorities: Array<{ priority: string; label: string; done: number; outstanding: number }>;
};

export type GhostAudit = {
  /** Closed-with-no-doneAt, over the whole mirror. */
  count: number;
  /** All tickets with `ticketStatus === 'closed'`, ghosts included. */
  closedTotal: number;
  /** `count / closedTotal`, 0 when `closedTotal` is 0. Rounded to 3 dp. */
  shareOfClosed: number;
  /** `count / outstanding` at the latest week in range, 0 when that is 0. */
  shareOfOutstandingLatestWeek: number;
  /**
   * The caveat, already worded, or `null` when `count` is 0. Naming the number of
   * finished tickets that cannot be dated is the whole of the ghost remedy — no
   * count changes anywhere because of it.
   */
  caveat: string | null;
};

export type RangeMeta = {
  /** Already clamped to what the mirror can answer. */
  presets: Array<{ weeks: number; label: string; available: boolean }>;
  /** What the server actually used — may differ from the request, so the client can see it. */
  selectedWeeks: number;
  /** Printed under the backlog panel. Names the mirror's horizon honestly. */
  coverageNote: string;
};

export type TimeToFirstDone = {
  /** Tickets whose `doneAt` falls inside the selected range and which have a `createdAt`. */
  sampleSize: number;
  /** Tickets with a `doneAt` in range but no `createdAt`. Reported, not hidden. */
  unmeasurable: number;
  medianDays: number | null;
  buckets: Array<{ label: string; count: number }>;
  /** The honest caveat, rendered verbatim. */
  caption: string;
};

export type WeeklyReport = {
  /** Weeks in the selected range, oldest first. Drives every panel. */
  weeks: WeekSummary[];
  /** What the range control may offer. The client derives no week keys itself. */
  range: RangeMeta;
  /** Range-scoped, not week-scoped. See its own caption. */
  timeToFirstDone: TimeToFirstDone;
  /**
   * `ticketStatus === 'open'` right now, across the whole mirror. Not week-scoped
   * and not derivable from any week — see `outstandingCaption`.
   */
  openRightNow: number;
  /** The measured ghost population. Both shares, so one render answers both questions. */
  ghosts: GhostAudit;
  /** Tickets in no cohort at all, named so nothing vanishes silently. */
  excluded: { deleted: number; unparseableDate: number };
  /** The done rule, in words, rendered on screen verbatim. */
  doneRule: string;
  /** Why OUTSTANDING AT WEEK END and `openRightNow` differ. Rendered verbatim. */
  outstandingCaption: string;
  /** Last successful HelpDesk pull, for the "as of" line. */
  pulledAt: string;
};
