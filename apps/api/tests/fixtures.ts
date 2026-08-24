import fixture from './fixtures/sample-joy-open-tickets.json';
import type { HelpDeskTicket } from '../src/helpdesk/types';

/** Real HelpDesk payload: 8 open JOY Loyalty tickets captured from production. */
export function loadFixtureTickets(): HelpDeskTicket[] {
  return (fixture as { data: { tickets: HelpDeskTicket[] } }).data.tickets;
}
