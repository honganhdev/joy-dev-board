import { describe, expect, test } from 'bun:test';
import { filterBoard, searchNeedle, ticketMatches } from '../src/lib/search';
import type { Board, BoardTicket } from '../src/types';

const CRISP =
  'https://app.crisp.chat/website/00000000-0000-4000-8000-000000000000/inbox/session_11111111-2222-4333-8444-555555555555/';
const SLACK = 'https://example.slack.com/archives/C00000000/p1700000000000001';

function ticket(overrides: Partial<BoardTicket> = {}): BoardTicket {
  return {
    ticketId: 'JOY-260823-ZJaFcq',
    subject: 'Ẩn nút widget trên trang giỏ hàng',
    category: 'WIDGET',
    shopName: 'The Sample Shop',
    domain: 'sample-shop.myshopify.com',
    memberNames: ['Agent A'],
    createdAt: '2026-08-23T00:00:00.000Z',
    chatLink: CRISP,
    slackLink: SLACK,
    shortUrl: '/t/JOY-260823-ZJaFcq',
    ...overrides,
  };
}

function board(tickets: BoardTicket[]): Board {
  return {
    pulledAt: '2026-08-24T04:00:00.000Z',
    totalTickets: tickets.length,
    openTickets: tickets.length,
    boardTickets: tickets.length,
    columns: [
      {
        status: 'done',
        label: 'DONE',
        count: tickets.length,
        groups: [{ category: 'WIDGET', count: tickets.length, tickets }],
      },
      { status: 'doing', label: 'DOING', count: 0, groups: [] },
    ],
    otherStatuses: [],
  };
}

describe('searchNeedle', () => {
  test('collapses a pasted ticket URL and a bare id to the same needle', () => {
    expect(searchNeedle('https://helpdesk.avada.net/t/JOY-260823-ZJaFcq')).toBe(
      'joy-260823-zjafcq'
    );
    expect(searchNeedle('JOY-260823-ZJaFcq')).toBe('joy-260823-zjafcq');
    expect(searchNeedle('  /t/JOY-260823-ZJaFcq  ')).toBe('joy-260823-zjafcq');
  });

  test('reduces a Crisp URL to its session id', () => {
    expect(searchNeedle(CRISP)).toBe('session_11111111-2222-4333-8444-555555555555');
  });

  test('reduces a Slack URL to its message id', () => {
    expect(searchNeedle(SLACK)).toBe('p1700000000000001');
  });

  test('leaves plain text alone apart from normalising it', () => {
    expect(searchNeedle('  Giỏ Hàng ')).toBe('gio hang');
  });

  test('an empty query has no needle', () => {
    expect(searchNeedle('   ')).toBe('');
  });
});

describe('ticketMatches', () => {
  const t = ticket();

  test('matches on id, subject, shop name and domain', () => {
    expect(ticketMatches(t, searchNeedle('JOY-260823-ZJaFcq'))).toBe(true);
    expect(ticketMatches(t, searchNeedle('widget'))).toBe(true);
    expect(ticketMatches(t, searchNeedle('sample shop'))).toBe(true);
    expect(ticketMatches(t, searchNeedle('sample-shop.myshopify.com'))).toBe(true);
  });

  test('matches a pasted Crisp or Slack URL against the stored link', () => {
    expect(ticketMatches(t, searchNeedle(CRISP))).toBe(true);
    // A trailing slash or query string must not stop the match.
    expect(ticketMatches(t, searchNeedle(`${CRISP.slice(0, -1)}?ref=x`))).toBe(true);
    expect(ticketMatches(t, searchNeedle(SLACK))).toBe(true);
  });

  test('finds Vietnamese subjects typed without diacritics', () => {
    expect(ticketMatches(t, searchNeedle('gio hang'))).toBe(true);
    expect(ticketMatches(t, searchNeedle('giỏ hàng'))).toBe(true);
  });

  test('does not match unrelated text', () => {
    expect(ticketMatches(t, searchNeedle('referral'))).toBe(false);
  });

  test('an empty needle matches everything', () => {
    expect(ticketMatches(t, '')).toBe(true);
  });

  test('tolerates a ticket with no links or store', () => {
    const bare = ticket({ chatLink: null, slackLink: null, shortUrl: null, shopName: null, domain: null });
    expect(ticketMatches(bare, searchNeedle('zjafcq'))).toBe(true);
    expect(ticketMatches(bare, searchNeedle(CRISP))).toBe(false);
  });
});

describe('filterBoard', () => {
  const source = board([
    ticket(),
    ticket({ ticketId: 'JOY-260101-other', subject: 'Referral code broken', shopName: 'Other Shop', chatLink: null }),
  ]);

  test('an empty query returns the board untouched', () => {
    expect(filterBoard(source, '  ')).toBe(source);
  });

  test('recomputes column, group and board counts after filtering', () => {
    const result = filterBoard(source, 'referral');
    expect(result.boardTickets).toBe(1);
    expect(result.columns[0]?.count).toBe(1);
    expect(result.columns[0]?.groups[0]?.count).toBe(1);
    expect(result.columns[0]?.groups[0]?.tickets[0]?.ticketId).toBe('JOY-260101-other');
  });

  test('drops emptied groups but keeps all five columns', () => {
    const result = filterBoard(source, 'nothing-matches-this');
    expect(result.boardTickets).toBe(0);
    expect(result.columns).toHaveLength(source.columns.length);
    expect(result.columns.every((column) => column.groups.length === 0)).toBe(true);
  });

  test('does not mutate the source board', () => {
    filterBoard(source, 'referral');
    expect(source.boardTickets).toBe(2);
    expect(source.columns[0]?.groups[0]?.tickets).toHaveLength(2);
  });
});
