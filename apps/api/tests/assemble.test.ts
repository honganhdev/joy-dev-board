import { describe, expect, test } from 'bun:test';
import { assembleBoard, findTicketDetail } from '../src/board/assemble';
import { BOARD_COLUMNS } from '../src/board/types';
import type { HelpDeskTicket } from '../src/helpdesk/types';
import { loadFixtureTickets } from './fixtures';

const PULLED_AT = '2026-08-24T04:00:00.000Z';

function ticket(overrides: Partial<HelpDeskTicket>): HelpDeskTicket {
  return {
    id: overrides.ticketId ?? 'id',
    ticketId: 'JOY-260101-aaaaaa',
    subject: 'widget broken',
    ticketStatus: 'open',
    tsStatus: 'doing',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('assembleBoard', () => {
  const fixture = loadFixtureTickets();
  const board = assembleBoard(fixture, PULLED_AT);

  test('renders the five columns in the fixed order', () => {
    expect(board.columns.map((column) => column.status)).toEqual(
      BOARD_COLUMNS.map((column) => column.status)
    );
    expect(board.columns.map((column) => column.label)).toEqual([
      'DEV FIXING',
      'DOING',
      'WAITING CUSTOMER',
      'DEV DONE',
      'DONE',
    ]);
  });

  test('column counts equal the number of grouped tickets', () => {
    for (const column of board.columns) {
      const grouped = column.groups.reduce((sum, group) => sum + group.tickets.length, 0);
      expect(column.count).toBe(grouped);
      for (const group of column.groups) {
        expect(group.count).toBe(group.tickets.length);
      }
    }
    expect(board.boardTickets).toBe(
      board.columns.reduce((sum, column) => sum + column.count, 0)
    );
  });

  test('places fixture tickets in the column matching their tsStatus', () => {
    // Fixture: 1 dev_fixing, 5 waiting_customer, 1 pending (no column), 1 waiting_customer.
    const byStatus = Object.fromEntries(board.columns.map((c) => [c.status, c.count]));
    expect(byStatus.dev_fixing).toBe(1);
    expect(byStatus.waiting_customer).toBe(6);
    expect(byStatus.doing).toBe(0);
    expect(board.totalTickets).toBe(fixture.length);
    expect(board.openTickets).toBe(fixture.length);
  });

  test('keeps a ticket whose tsStatus has no column visible in otherStatuses', () => {
    // `pending` is a real production status with no board column.
    expect(board.otherStatuses).toContainEqual({ status: 'pending', count: 1 });
    expect(board.boardTickets + board.otherStatuses.reduce((s, o) => s + o.count, 0)).toBe(
      board.openTickets
    );
  });

  test('tolerates an unknown tsStatus instead of dropping or crashing on it', () => {
    const withUnknown = [
      ...fixture,
      ticket({ ticketId: 'JOY-999999-unknown', tsStatus: 'brand_new_status_from_helpdesk' }),
      ticket({ ticketId: 'JOY-999999-nostatus', tsStatus: null }),
    ];
    const result = assembleBoard(withUnknown, PULLED_AT);

    expect(result.otherStatuses).toContainEqual({
      status: 'brand_new_status_from_helpdesk',
      count: 1,
    });
    expect(result.otherStatuses).toContainEqual({ status: '(no status)', count: 1 });
    expect(result.openTickets).toBe(fixture.length + 2);
  });

  test('excludes closed tickets from the board', () => {
    const result = assembleBoard(
      [ticket({ ticketId: 'JOY-1', ticketStatus: 'closed' }), ticket({ ticketId: 'JOY-2' })],
      PULLED_AT
    );
    expect(result.totalTickets).toBe(2);
    expect(result.openTickets).toBe(1);
    expect(result.boardTickets).toBe(1);
  });

  test('maps card fields off the real ticket shape', () => {
    const card = board.columns
      .flatMap((column) => column.groups)
      .flatMap((group) => group.tickets)
      .find((t) => t.ticketId === 'JOY-260823-ZJaFcq');

    expect(card).toBeDefined();
    expect(card?.subject).toBe('Customize widget');
    expect(card?.shopName).toBe('The Sample Shop');
    expect(card?.domain).toBe('sample-shop.myshopify.com');
    expect(card?.memberNames.length).toBeGreaterThan(0);
    expect(card?.chatLink).toContain('crisp.chat');
    expect(card?.category).toBe('WIDGET / UNIFIED');
  });

  test('falls back to the store domain when shopName is missing', () => {
    const result = assembleBoard(
      [
        ticket({
          ticketId: 'JOY-3',
          store: [{ domain: 'only-domain.myshopify.com', shopName: null }],
        }),
      ],
      PULLED_AT
    );
    const card = result.columns[1]?.groups[0]?.tickets[0];
    expect(card?.shopName).toBeNull();
    expect(card?.domain).toBe('only-domain.myshopify.com');
  });

  test('sorts tickets inside a group newest first', () => {
    const result = assembleBoard(
      [
        ticket({ ticketId: 'JOY-old', createdAt: '2026-01-01T00:00:00.000Z' }),
        ticket({ ticketId: 'JOY-new', createdAt: '2026-08-01T00:00:00.000Z' }),
        ticket({ ticketId: 'JOY-mid', createdAt: '2026-04-01T00:00:00.000Z' }),
      ],
      PULLED_AT
    );
    expect(result.columns[1]?.groups[0]?.tickets.map((t) => t.ticketId)).toEqual([
      'JOY-new',
      'JOY-mid',
      'JOY-old',
    ]);
  });

  test('survives a ticket with no subject, store, or members', () => {
    const result = assembleBoard(
      [ticket({ ticketId: 'JOY-bare', subject: null, store: null, members: null })],
      PULLED_AT
    );
    const card = result.columns[1]?.groups[0]?.tickets[0];
    expect(card?.subject).toBe('(no subject)');
    expect(card?.shopName).toBeNull();
    expect(card?.memberNames).toEqual([]);
  });

  test('produces an empty board rather than throwing on an empty pull', () => {
    const result = assembleBoard([], PULLED_AT);
    expect(result.boardTickets).toBe(0);
    expect(result.columns).toHaveLength(5);
    expect(result.columns.every((column) => column.groups.length === 0)).toBe(true);
  });
});

describe('findTicketDetail', () => {
  const fixture = loadFixtureTickets();

  test('returns the raw ticket plus its computed category', () => {
    const detail = findTicketDetail(fixture, 'JOY-260824-V77Mwn');
    expect(detail?.ticketNumber).toBe('joy262108');
    expect(detail?.category).toBe('POINTS / ACTIVITY');
    expect(detail?.description?.length).toBeGreaterThan(100);
  });

  test('returns null for an unknown id', () => {
    expect(findTicketDetail(fixture, 'JOY-000000-nope')).toBeNull();
  });
});
