/**
 * Writing a pull into the database.
 *
 * A pull is recorded in three steps: `startPull` opens the row, `syncPull`
 * writes tickets and history in one transaction, `finishPull` / `failPull`
 * closes it. Splitting it that way is what lets a failed pull still leave a
 * record of the attempt without leaving half-written tickets behind.
 */
import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { pulls, tickets, ticketStatusHistory } from './schema';
import type { HelpDeskTicket } from '../helpdesk/types';

export type SyncResult = {
  /** Tickets in the payload. */
  pulled: number;
  /** Tickets never seen before this pull. */
  inserted: number;
  /** History rows written (new tickets included). */
  statusChanges: number;
};

/**
 * HelpDesk returns the occasional ticket with an empty `ticketId` — seen on
 * records whose `ticketNumber` is still `unknown…`. The board keys cards, the
 * detail route and history on `ticketId`, so such a ticket would show up and
 * then be unopenable. Its internal `id` is always present and unique, so it
 * stands in. The stored payload is normalized too, so the row, the board and
 * the detail view all agree on one identifier.
 */
function withTicketId(ticket: HelpDeskTicket): HelpDeskTicket {
  return ticket.ticketId ? ticket : { ...ticket, ticketId: ticket.id };
}

/** Flattens the columns the board queries on. Everything else lives in `raw`. */
function toRow(incoming: HelpDeskTicket, observedAt: string) {
  const ticket = withTicketId(incoming);
  const store = ticket.store?.[0];
  return {
    ticketId: ticket.ticketId,
    id: ticket.id,
    ticketNumber: ticket.ticketNumber ?? null,
    subject: ticket.subject ?? null,
    tsStatus: ticket.tsStatus ?? null,
    ticketStatus: ticket.ticketStatus ?? null,
    priority: ticket.priority ?? null,
    level: ticket.level ?? null,
    appName: ticket.appName ?? null,
    appPlan: ticket.appPlan ?? null,
    shopName: store?.shopName ?? null,
    domain: store?.domain ?? ticket.storeDomains?.[0] ?? null,
    createdAt: ticket.createdAt ?? null,
    updatedAt: ticket.updatedAt ?? null,
    dueDate: ticket.dueDate ?? null,
    raw: JSON.stringify(ticket),
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
  };
}

/** Opens a pull as `running`; the next boot sweeps it if this process dies. */
export function startPull(db: Db, startedAt = new Date().toISOString()): number {
  const [row] = db
    .insert(pulls)
    .values({ startedAt, status: 'running', source: 'pull' })
    .returning({ id: pulls.id })
    .all();
  if (!row) throw new Error('Could not open a pull row');
  return row.id;
}

/**
 * Atomically reserves one durable row per delivery. A successful reservation
 * makes processing at-most-once: settled successes stay permanently deduped.
 * Failed or boot-swept work may be re-reserved so the sender's retry can repair
 * an interrupted update.
 */
export function reserveDelivery(
  db: Db,
  deliveryId: string,
  startedAt = new Date().toISOString()
): number | null {
  const [row] = db
    .insert(pulls)
    .values({ startedAt, status: 'running', source: 'webhook', deliveryId })
    .onConflictDoUpdate({
      target: pulls.deliveryId,
      set: {
        startedAt,
        finishedAt: null,
        ticketCount: null,
        inserted: null,
        statusChanges: null,
        status: 'running',
        error: null,
      },
      where: eq(pulls.status, 'error'),
    })
    .returning({ id: pulls.id })
    .all();
  return row?.id ?? null;
}

export function finishPull(db: Db, pullId: number, result: SyncResult): void {
  db.update(pulls)
    .set({
      status: 'ok',
      finishedAt: new Date().toISOString(),
      ticketCount: result.pulled,
      inserted: result.inserted,
      statusChanges: result.statusChanges,
    })
    .where(eq(pulls.id, pullId))
    .run();
}

export function failPull(db: Db, pullId: number, error: string): void {
  db.update(pulls)
    .set({ status: 'error', finishedAt: new Date().toISOString(), error })
    .where(eq(pulls.id, pullId))
    .run();
}

/**
 * Flips every pull left `running` by a dead process to an honest failure.
 * Assumes a single writer process: any `running` row present at boot
 * provably belongs to a process that is no longer alive.
 */
export function sweepInterruptedPulls(db: Db): number {
  return db
    .update(pulls)
    .set({
      status: 'error',
      error: 'server restarted mid-pull',
      finishedAt: new Date().toISOString(),
    })
    .where(eq(pulls.status, 'running'))
    .returning({ id: pulls.id })
    .all().length;
}

/**
 * Upserts every ticket and appends a history row only where the status actually
 * moved. An unchanged ticket writes nothing — a pull every five minutes must
 * not append 130 rows each time.
 *
 * The whole thing runs in one transaction: a crash mid-pull cannot leave
 * tickets updated with their history missing.
 */
export function syncPull(
  db: Db,
  incoming: HelpDeskTicket[],
  pullId: number,
  observedAt = new Date().toISOString()
): SyncResult {
  return db.transaction((tx) => {
    const known = new Map(
      tx
        .select({ ticketId: tickets.ticketId, tsStatus: tickets.tsStatus })
        .from(tickets)
        .all()
        .map((row) => [row.ticketId, row.tsStatus])
    );

    let inserted = 0;
    let statusChanges = 0;

    for (const ticket of incoming) {
      const row = toRow(ticket, observedAt);
      const isNew = !known.has(row.ticketId);
      const previousStatus = known.get(row.ticketId) ?? null;

      tx.insert(tickets)
        .values(row)
        .onConflictDoUpdate({
          target: tickets.ticketId,
          // `firstSeenAt` is deliberately absent: it is set once, on insert.
          set: {
            id: row.id,
            ticketNumber: row.ticketNumber,
            subject: row.subject,
            tsStatus: row.tsStatus,
            ticketStatus: row.ticketStatus,
            priority: row.priority,
            level: row.level,
            appName: row.appName,
            appPlan: row.appPlan,
            shopName: row.shopName,
            domain: row.domain,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            dueDate: row.dueDate,
            raw: row.raw,
            lastSeenAt: row.lastSeenAt,
          },
        })
        .run();

      if (isNew || previousStatus !== row.tsStatus) {
        tx.insert(ticketStatusHistory)
          .values({
            ticketId: row.ticketId,
            fromStatus: isNew ? null : previousStatus,
            toStatus: row.tsStatus,
            observedAt,
            ticketUpdatedAt: row.updatedAt,
            pullId,
          })
          .run();
        statusChanges += 1;
      }

      if (isNew) inserted += 1;
      // Keeps the map honest when a payload repeats a ticketId.
      known.set(row.ticketId, row.tsStatus);
    }

    return { pulled: incoming.length, inserted, statusChanges };
  });
}
