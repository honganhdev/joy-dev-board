/**
 * Read path. Everything the API serves comes from here — HelpDesk is only ever
 * touched by a pull, never by a page load.
 */
import { and, asc, count, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { Db } from './client';
import { pulls, tickets, ticketStatusHistory } from './schema';
import type { PullRow } from './schema';
import type { HelpDeskTicket } from '../helpdesk/types';

export type StatusHistoryEntry = {
  fromStatus: string | null;
  toStatus: string | null;
  observedAt: string;
  ticketUpdatedAt: string | null;
};

function parseRaw(raw: string): HelpDeskTicket {
  return JSON.parse(raw) as HelpDeskTicket;
}

export function countTickets(db: Db): number {
  const [row] = db.select({ total: count() }).from(tickets).all();
  return row?.total ?? 0;
}

/** Every stored ticket, as the HelpDesk records they were pulled from. */
export function readTickets(db: Db): HelpDeskTicket[] {
  return db
    .select({ raw: tickets.raw })
    .from(tickets)
    .all()
    .map((row) => parseRaw(row.raw));
}

export function readTicket(db: Db, ticketId: string): HelpDeskTicket | null {
  const [row] = db
    .select({ raw: tickets.raw })
    .from(tickets)
    .where(eq(tickets.ticketId, ticketId))
    .limit(1)
    .all();
  return row ? parseRaw(row.raw) : null;
}

/** Status timeline for one ticket, oldest first. */
export function readStatusHistory(db: Db, ticketId: string): StatusHistoryEntry[] {
  return db
    .select({
      fromStatus: ticketStatusHistory.fromStatus,
      toStatus: ticketStatusHistory.toStatus,
      observedAt: ticketStatusHistory.observedAt,
      ticketUpdatedAt: ticketStatusHistory.ticketUpdatedAt,
    })
    .from(ticketStatusHistory)
    .where(eq(ticketStatusHistory.ticketId, ticketId))
    .orderBy(asc(ticketStatusHistory.id))
    .all();
}

const fullPull = or(isNull(pulls.source), eq(pulls.source, 'pull'));

/**
 * A delivery that actually wrote a ticket. One that was ignored — a foreign
 * app, another year, or a snapshot a full pull had already superseded — still
 * gets its row, because that row is the dedupe record and the audit trail, but
 * it did no work and must not read as freshness. NULL is a row written before
 * this was recorded, and stays counted.
 */
const wroteATicket = or(isNull(pulls.ticketCount), gt(pulls.ticketCount, 0));

/** Most recent full pull attempts, successful or not, newest first. */
export function readLastPulls(db: Db, limit: number): PullRow[] {
  return db.select().from(pulls).where(fullPull).orderBy(desc(pulls.id)).limit(limit).all();
}

/** Most recent full pull attempt, successful or not — this is what staleness is read from. */
export function readLastPull(db: Db): PullRow | null {
  return readLastPulls(db, 1)[0] ?? null;
}

/** Most recent full pull that actually committed. `null` before the first one. */
export function readLastSuccessfulPull(db: Db): PullRow | null {
  const [row] = db
    .select()
    .from(pulls)
    .where(and(fullPull, eq(pulls.status, 'ok')))
    .orderBy(desc(pulls.id))
    .limit(1)
    .all();
  return row ?? null;
}

/** Most recent webhook delivery that actually wrote a ticket. */
export function readLastSuccessfulWebhook(db: Db): PullRow | null {
  const [row] = db
    .select()
    .from(pulls)
    .where(and(eq(pulls.source, 'webhook'), eq(pulls.status, 'ok'), wroteATicket))
    .orderBy(desc(pulls.id))
    .limit(1)
    .all();
  return row ?? null;
}
