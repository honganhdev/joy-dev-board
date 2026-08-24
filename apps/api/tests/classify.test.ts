import { describe, expect, test } from 'bun:test';
import { classify, normalize } from '../src/board/classify';
import { CATEGORIES } from '../src/board/categories';
import { loadFixtureTickets } from './fixtures';

describe('normalize', () => {
  test('strips Vietnamese diacritics so one keyword spelling covers both forms', () => {
    expect(normalize('Điểm thưởng')).toBe('diem thuong');
    expect(normalize('Giỏ Hàng')).toBe('gio hang');
    expect(normalize('WIDGET')).toBe('widget');
  });
});

describe('classify', () => {
  test('classifies real fixture subjects', () => {
    const cases: Array<[string, string]> = [
      ['[bug] Điểm thưởng không được cộng cho đơn draft order đã thanh toán', 'POINTS / ACTIVITY'],
      ['Ẩn nút widget trên trang giỏ hàng và cart drawer', 'WIDGET / UNIFIED'],
      ['[request] Export coupons list', 'ANALYTICS'],
      ['Customize widget', 'WIDGET / UNIFIED'],
      ['[customize] add point calculator: all product page templates', 'POINTS / ACTIVITY'],
      ['Point balance label not updated', 'POINTS / ACTIVITY'],
      ['Sync points & programs + assign Bronze tier to existing members before launch', 'INTEGRATIONS'],
    ];

    for (const [subject, expected] of cases) {
      expect(classify({ subject })).toBe(expected as never);
    }
  });

  test('matches Vietnamese written without diacritics', () => {
    expect(classify({ subject: 'khach hang mat diem thuong' })).toBe('POINTS / ACTIVITY');
  });

  test('is case-insensitive', () => {
    expect(classify({ subject: 'REFERRAL code broken' })).toBe('REFERRAL');
    expect(classify({ subject: 'referral code broken' })).toBe('REFERRAL');
  });

  test('word-bounded ASCII keywords do not match inside other words', () => {
    // "api" must not fire on "rapid", "pos" must not fire on "position".
    expect(classify({ subject: 'rapid page reload' })).toBe('OTHER');
    expect(classify({ subject: 'composition of nothing relevant' })).toBe('OTHER');
  });

  test('falls back to the description only when the subject matches nothing', () => {
    expect(classify({ subject: 'zzz nothing here', description: 'the widget will not open' })).toBe(
      'WIDGET / UNIFIED'
    );
    // Subject wins over a description that would match a different category.
    expect(classify({ subject: 'referral code broken', description: 'the widget will not open' })).toBe(
      'REFERRAL'
    );
  });

  test('unmatched text lands in the OTHER catch-all', () => {
    expect(classify({ subject: 'qwertyuiop' })).toBe('OTHER');
    expect(classify({})).toBe('OTHER');
    expect(classify({ subject: null, description: null })).toBe('OTHER');
  });

  test('is deterministic and total over every fixture ticket', () => {
    const tickets = loadFixtureTickets();
    expect(tickets.length).toBeGreaterThan(0);

    for (const ticket of tickets) {
      const first = classify(ticket);
      expect(CATEGORIES).toContain(first);
      expect(classify(ticket)).toBe(first);
    }
  });
});
