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
  /**
   * The week holding `now`: its Sunday has not happened, so every figure on it
   * is week-to-date. Emitted because the page has to choose a week to land on
   * and the alternative is the browser reading meaning out of `label`'s prose.
   */
  inProgress: boolean;
  /**
   * Titles for the three headline tiles. Worded per week because the week
   * holding `now` has not finished: its figures are week-to-date, so it cannot
   * be titled with an end-of-week figure. The renderer prints what it is given.
   */
  tileLabels: { created: string; done: string; outstanding: string };
  /**
   * Why this week's outstanding figure and `openRightNow` differ. Week-scoped
   * for the same reason as `tileLabels`: the sentence for a finished week calls
   * the figure historical, which is untrue of the week still running.
   */
  outstandingCaption: string;
  created: number;
  done: number;
  /**
   * Whole days from creation to first done, over tickets whose first done date
   * falls in this week. `null` when the week finished no measurable ticket.
   */
  medianDaysToDone: number | null;
  /** How many tickets the weekly median is measured over. */
  doneSample: number;
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
  /**
   * The caveat, already worded, or `null` when `count` is 0. Naming the number of
   * finished tickets that cannot be dated is the whole of the ghost remedy — no
   * count changes anywhere because of it.
   */
  caveat: string | null;
};

export type RangeMeta = {
  /**
   * Already clamped to what the mirror can answer. `unavailableNote` is why a
   * withheld preset is withheld, worded here and rendered verbatim: the control
   * explains nothing in its own words, so it cannot go on explaining a rule the
   * server no longer applies.
   */
  presets: Array<{
    weeks: number;
    label: string;
    available: boolean;
    unavailableNote: string | null;
  }>;
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
  /** Server-worded share measured within 48 hours; the browser divides nothing. */
  withinTwoDaysNote: string | null;
  buckets: Array<{ label: string; count: number }>;
  /** The honest caveat, rendered verbatim. */
  caption: string;
};

export type WeeklyReport = {
  /** Weeks in the selected range, oldest first. Drives every panel. */
  weeks: WeekSummary[];
  /** What the range control may offer. The client derives no week keys itself. */
  range: RangeMeta;
  /**
   * The backlog panel's heading. Worded here because only the server knows
   * whether the last column is a finished week or the running one, and a
   * heading promising an end-of-week figure over a mid-week column is false.
   */
  backlogTitle: string;
  /** Range-scoped resolution-speed wording rendered verbatim. */
  weeklySpeed: {
    /** What the medians exclude, and the observed band across measurable weeks. */
    caption: string;
    /** Names empty weeks, or `null` when every week has a median. */
    emptyWeeksNote: string | null;
  };
  /** Range-scoped, not week-scoped. See its own caption. */
  timeToFirstDone: TimeToFirstDone;
  /** Every open ticket right now over the whole mirror, independent of the selected range. */
  openBacklog: {
    /** Equals `openRightNow`; both are derived from the same array. */
    total: number;
    /** Server-worded age headline, or `null` when there are no open tickets. */
    agingHeadline: string | null;
    /** All four age buckets, including zeroes. */
    buckets: Array<{ label: string; count: number }>;
    /** Open tickets with no readable created date, never silently dropped. */
    noCreatedDate: number;
    /** Label rendered beside `noCreatedDate`. */
    noCreatedDateLabel: string;
    /** The five oldest readable tickets, oldest first. */
    oldest: Array<{
      ticketId: string;
      subject: string;
      merchant: string;
      ageDays: number;
      ageLabel: string;
    }>;
  };
  /** Server-worded heading for the absolute all-open section. */
  openSectionTitle: string;
  /**
   * `ticketStatus === 'open'` right now, across the whole mirror. Not week-scoped
   * and not derivable from any week — see each week's `outstandingCaption`.
   */
  openRightNow: number;
  /** The measured ghost population, and the caveat naming it. */
  ghosts: GhostAudit;
  /**
   * Tickets in no cohort at all, named so nothing vanishes silently. `undated`
   * is a ticket with neither a created nor a done date: it can be placed in no
   * week, so no total and no breakdown row can hold it.
   */
  excluded: { deleted: number; unparseableDate: number; undated: number };
  /**
   * The same exclusions in words, or `null` when there are none. The counts
   * above stay on the wire for anything that wants to do arithmetic with them;
   * this is what the page prints, so the browser writes no prose and picks no
   * plural.
   */
  excludedNote: string | null;
  /** The done rule, in words, rendered on screen verbatim. */
  doneRule: string;
};
