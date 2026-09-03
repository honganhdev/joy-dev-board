import { describe, expect, test } from 'bun:test';
import {
  searchNeedle as apiSearchNeedle,
  ticketMatches as apiTicketMatches,
} from '../../api/src/board/search';
import type { BoardTicket as ApiBoardTicket } from '../../api/src/board/types';
import { searchNeedle as webSearchNeedle, ticketMatches as webTicketMatches } from '../src/lib/search';

export const SEARCH_CASES = [
  '',
  '   ',
  'JOY-260823-ZJaFcq',
  '/t/JOY-260823-ZJaFcq',
  'https://helpdesk.test/t/JOY-260823-ZJaFcq',
  'https://app.crisp.chat/website/12345678/inbox/session_abcd1234/',
  'https://workspace.slack.com/archives/C12345678/p1780000000000000?thread_ts=1',
  'https://a-very-long-shared-hostname.example/t/short/identifying-segment',
  'https://example.test/path/abcdefgh?longer_parameter=ijklmnop',
  'https://example.test/path/value+with+plus',
  'https://example.test/path/value1234?a=b&thread=abc12345',
  'Điểm thưởng',
  'diem thuong',
  'Đổi quà',
  'DOI QUA',
  'Merchant Example',
  'merchant.example',
  'ABCDEF12',
  'subject text',
  'Mixed CASE',
  'https://example.test/',
  'not a url?with=query',
  'JOY-000001-a1',
  'prefix JOY-999999-ZZZ suffix',
  'https://example.test/path/segment123&other=second456',
] as const;

const TICKET: ApiBoardTicket = {
  ticketId: 'JOY-260823-ZJaFcq',
  subject: 'Điểm thưởng & đổi quà',
  category: 'OTHER',
  shopName: 'Merchant Example',
  domain: 'merchant.example',
  memberNames: [],
  createdAt: '2026-08-23T00:00:00.000Z',
  chatLink: 'https://app.crisp.chat/session/session_abcd1234',
  slackLink: 'https://workspace.slack.com/archives/C12345678/p1780000000000000',
  shortUrl: 'https://helpdesk.test/t/JOY-260823-ZJaFcq',
};

describe('API and web search parity', () => {
  test('reduces every query identically', () => {
    for (const query of SEARCH_CASES) {
      expect(apiSearchNeedle(query)).toBe(webSearchNeedle(query));
    }
  });

  test('matches every reduced query identically', () => {
    for (const query of SEARCH_CASES) {
      const needle = apiSearchNeedle(query);
      expect(apiTicketMatches(TICKET, needle)).toBe(webTicketMatches(TICKET, needle));
    }
  });

  test('keeps nullable ticket fields in parity', () => {
    const sparse = {
      ...TICKET,
      shopName: null,
      domain: null,
      chatLink: null,
      slackLink: null,
      shortUrl: null,
    };
    expect(apiTicketMatches(sparse, 'unrelated')).toBe(webTicketMatches(sparse, 'unrelated'));
  });
});
