import { describe, expect, test } from 'bun:test';
import { assembleBoard, findTicketDetail } from '../src/board/assemble';
import { classify } from '../src/board/classify';
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
    // Counts are derived from the fixture, not hardcoded — `bun run fixture:pull`
    // fetches whichever tickets are open at the time, so a snapshot would rot.
    const byStatus = Object.fromEntries(board.columns.map((c) => [c.status, c.count]));
    for (const column of board.columns) {
      const expected = fixture.filter((ticket) => ticket.tsStatus === column.status).length;
      expect(byStatus[column.status]).toBe(expected);
    }
    expect(board.totalTickets).toBe(fixture.length);
    expect(board.openTickets).toBe(fixture.length);
  });

  test('keeps a ticket whose tsStatus has no column visible in otherStatuses', () => {
    // Production has statuses with no board column (pending, onb, sale_request…).
    // Which ones land in the fixture depends on the pull, so derive them.
    const columnStatuses = new Set<string>(BOARD_COLUMNS.map((column) => column.status));
    for (const ticket of fixture) {
      if (ticket.tsStatus && !columnStatuses.has(ticket.tsStatus)) {
        expect(board.otherStatuses.map((other) => other.status)).toContain(ticket.tsStatus);
      }
    }
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
    // Compared against the source ticket, not a frozen snapshot of one id.
    const cards = board.columns
      .flatMap((column) => column.groups)
      .flatMap((group) => group.tickets);
    expect(cards.length).toBeGreaterThan(0);

    for (const card of cards) {
      const source = fixture.find((ticket) => ticket.ticketId === card.ticketId);
      expect(source).toBeDefined();
      expect(card.subject).toBe(source?.subject ?? '(no subject)');
      expect(card.shopName).toBe(source?.store?.[0]?.shopName ?? null);
      expect(card.domain).toBe(source?.store?.[0]?.domain ?? null);
      expect(card.memberNames).toEqual(
        (source?.members ?? [])
          .map((member) => member.displayName)
          .filter((name): name is string => Boolean(name))
      );
      expect(card.category).toBe(classify(source!));
    }
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
    // Picked from the fixture rather than hardcoded, so a re-pulled fixture still passes.
    const sample = fixture[0]!;
    const detail = findTicketDetail(fixture, sample.ticketId);
    expect(detail?.ticketNumber).toBe(sample.ticketNumber);
    expect(detail?.subject).toBe(sample.subject);
    expect(detail?.category).toBe(classify(sample));
  });

  test('returns null for an unknown id', () => {
    expect(findTicketDetail(fixture, 'JOY-000000-nope')).toBeNull();
  });
});
