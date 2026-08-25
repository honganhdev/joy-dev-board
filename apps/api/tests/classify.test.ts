import { describe, expect, test } from 'bun:test';
import { classify, normalize } from '../src/board/classify';
import { CATEGORIES, CATEGORY_KEYWORDS, FALLBACK_CATEGORY } from '../src/board/categories';
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
      ['[bug] Điểm thưởng không được cộng cho đơn draft order đã thanh toán', 'POINTS'],
      ['Ẩn nút widget trên trang giỏ hàng và cart drawer', 'COUPON / CHECKOUT'],
      ['[request] Export coupons list', 'ANALYTICS'],
      ['Customize widget', 'WIDGET'],
      ['[customize] add point calculator: all product page templates', 'POINTS'],
      ['Point balance label not updated', 'POINTS'],
      ['Sync points & programs + assign Bronze tier to existing members before launch', 'ONBOARDING'],
    ];

    for (const [subject, expected] of cases) {
      expect(classify({ subject })).toBe(expected as never);
    }
  });

  test('matches Vietnamese written without diacritics', () => {
    expect(classify({ subject: 'khach hang mat diem thuong' })).toBe('POINTS');
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
      'WIDGET'
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

describe('category table integrity', () => {
  test('CATEGORY_KEYWORDS mirrors CATEGORIES in membership and order, minus the catch-all', () => {
    // Two independent arrays with different jobs: CATEGORIES is the board's group
    // display order, CATEGORY_KEYWORDS is match precedence. Nothing in the type
    // system keeps them in step, so reordering one alone silently splits the two.
    const keyworded = CATEGORY_KEYWORDS.map((entry) => entry.category);
    const expected = CATEGORIES.filter((category) => category !== FALLBACK_CATEGORY);

    expect(keyworded).toEqual([...expected]);
    expect(new Set(keyworded).size).toBe(keyworded.length);
  });
});
