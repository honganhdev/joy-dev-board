import { expect, test } from 'bun:test';
import { aggregateWeeklyReport } from '../src/board/weekly-report';
import { openDatabase } from '../src/db/client';
import { readTickets } from '../src/db/queries';
import { finishPull, startPull, syncPull } from '../src/db/sync';
import type { HelpDeskTicket } from '../src/helpdesk/types';

const NOW = new Date('2026-08-26T03:00:00.000Z');
const HOUR = 60 * 60 * 1000;

/**
 * The report is aggregated over tickets read back out of the mirror, never over
 * the payload HelpDesk returned. `syncPull` flattens the columns the board
 * queries on and keeps everything else inside one serialised `raw` blob, so
 * `resolutionMetrics` reaches the clocks only if that round trip preserves a
 * nested object nothing in the schema names. Every other test in this repo calls
 * `aggregateWeeklyReport` on tickets built in memory, where that seam does not
 * exist: the band could read zero on the deployed page with all of them green.
 */
test('carries the resolution clocks through the mirror round trip', () => {
  const { db } = openDatabase(':memory:');
  const tickets: HelpDeskTicket[] = [1, 2, 3].map((index) => ({
    id: `internal-${index}`,
    ticketId: `JOY-260810-00000${index}`,
    subject: 'widget broken',
    ticketStatus: 'closed',
    tsStatus: 'done',
    createdAt: '2026-08-10T09:00:00+07:00',
    doneAt: '2026-08-18T09:00:00+07:00',
    updatedAt: '2026-08-18T09:00:00+07:00',
    resolutionMetrics: {
      ticketResolution: { createdAt: 1_786_000_000_000, doneAt: 1_786_691_200_000 },
      issueResolution: {
        customerReportAt: 1_785_998_200_000,
        durationToCsDoneMs: index * HOUR,
        durationToCustomerOkMs: index * 2 * HOUR,
      },
    },
  }));

  const pullId = startPull(db);
  finishPull(db, pullId, syncPull(db, tickets, pullId));

  const stored = readTickets(db);
  expect(stored).toHaveLength(3);

  const clocks = aggregateWeeklyReport(stored, { weeks: 12, now: NOW, year: 2026 })
    .resolutionClocks;

  expect(clocks.csReply.done).toMatchObject({ sampleSize: 3, medianHours: 2 });
  expect(clocks.customerOk.done).toMatchObject({ sampleSize: 3, medianHours: 4 });
  expect(clocks.csReply.carriedNote).toContain('3 of 3 dated tickets carry this clock (100%).');
});
