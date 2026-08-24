/**
 * SQLite schema for the board mirror.
 *
 * The mirror is deliberately shallow: flat columns for what the board queries
 * on, plus the untouched HelpDesk payload in `raw` so no upstream field is ever
 * lost. Nested arrays (`store`, `members`, `tasks`, `tagIds`) are not shredded
 * into tables — nothing in v1 queries them.
 *
 * Column names match the TypeScript property names one-to-one, so a row reads
 * the same in SQL and in code.
 */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** One row per ticket, upserted on every pull. */
export const tickets = sqliteTable(
  'tickets',
  {
    ticketId: text('ticketId').primaryKey(),
    id: text('id').notNull(),
    ticketNumber: text('ticketNumber'),
    subject: text('subject'),
    tsStatus: text('tsStatus'),
    ticketStatus: text('ticketStatus'),
    priority: text('priority'),
    level: integer('level'),
    appName: text('appName'),
    appPlan: text('appPlan'),
    shopName: text('shopName'),
    domain: text('domain'),
    createdAt: text('createdAt'),
    updatedAt: text('updatedAt'),
    dueDate: text('dueDate'),
    /** The complete HelpDesk ticket, verbatim, as JSON. */
    raw: text('raw').notNull(),
    /** ISO timestamps for when this row was first and most recently observed. */
    firstSeenAt: text('firstSeenAt').notNull(),
    lastSeenAt: text('lastSeenAt').notNull(),
  },
  (table) => [
    index('tickets_tsStatus_idx').on(table.tsStatus),
    index('tickets_ticketStatus_idx').on(table.ticketStatus),
  ]
);

/**
 * One row per *observed* status change.
 *
 * HelpDesk only ever returns a ticket's current state, so a change is only
 * known to have happened somewhere between two pulls. `observedAt` is when the
 * pull noticed it — not when it happened. A column called `changedAt` would be
 * read as fact later and would be a lie. `ticketUpdatedAt` is HelpDesk's own
 * `updatedAt`, the closest thing to a real change time.
 */
export const ticketStatusHistory = sqliteTable(
  'ticket_status_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ticketId: text('ticketId')
      .notNull()
      .references(() => tickets.ticketId),
    /** NULL = the first time this ticket was ever seen. */
    fromStatus: text('fromStatus'),
    /** Nullable: HelpDesk can return a ticket with no status at all. */
    toStatus: text('toStatus'),
    observedAt: text('observedAt').notNull(),
    ticketUpdatedAt: text('ticketUpdatedAt'),
    pullId: integer('pullId')
      .notNull()
      .references(() => pulls.id),
  },
  (table) => [index('ticket_status_history_ticketId_idx').on(table.ticketId)]
);

/**
 * One row per pull attempt, so history has a known observation window.
 *
 * A row is inserted as `error` when the pull starts and flipped to `ok` only
 * once the sync commits, so a process killed mid-pull leaves an honest record
 * (`status = 'error'`, `finishedAt = null`) rather than a phantom success.
 */
export const pulls = sqliteTable('pulls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: text('startedAt').notNull(),
  finishedAt: text('finishedAt'),
  ticketCount: integer('ticketCount'),
  status: text('status', { enum: ['ok', 'error'] }).notNull(),
  error: text('error'),
});

export type PullRow = typeof pulls.$inferSelect;
export type TicketStatusHistoryRow = typeof ticketStatusHistory.$inferSelect;
