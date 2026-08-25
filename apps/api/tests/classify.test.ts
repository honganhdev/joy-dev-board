import { describe, expect, test } from 'bun:test';
import { classify, normalize } from '../src/board/classify';
import { CATEGORIES, CATEGORY_KEYWORDS, FALLBACK_CATEGORY, type Category } from '../src/board/categories';
import type { Category as WebCategory } from '../../web/src/types';
import { loadFixtureTickets } from './fixtures';

/**
 * `apps/web/src/types.ts` hand-copies this union instead of importing it — the two
 * workspaces share no package — and that copy is what the board renders from. A
 * label added on one side only is a label the other has never heard of. A union
 * leaves nothing behind at runtime for a test to read, so the guard is this
 * compile-time assertion: `bun run typecheck` fails the moment the two drift.
 * It lives here because `apps/api/tests` is inside the api tsconfig program and
 * `apps/web/tests` is inside no program at all.
 */
type ExactlySameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const WEB_CATEGORY_UNION_IN_STEP: ExactlySameUnion<WebCategory, Category> = true;

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

  test('the setup labels outrank every topic label', () => {
    // Setup work touches every feature at once, so these subjects collect the
    // keywords of the labels below them. DFY SETUP and ONBOARDING sit first so the
    // ticket is filed as setup rather than as whichever feature it happened to name.
    expect(classify({ subject: '[DFY] set up the widget and the loyalty page' })).toBe('DFY SETUP');
    expect(classify({ subject: '[ONB] sync the tier list' })).toBe('ONBOARDING');
  });

  test('a setup subject beats what the description would have said', () => {
    // A `[DFY]` or `[ONB]` subject is often little more than a shop domain. Without
    // a row of its own the subject matches nothing, the description gets its turn,
    // and the ticket is filed by whatever the merchant happened to type.
    expect(
      classify({ subject: '[DFY] onboarding call', description: 'the widget will not open' })
    ).toBe('DFY SETUP');
    expect(classify({ subject: '[ONB] kickoff', description: 'points are wrong' })).toBe(
      'ONBOARDING'
    );
  });

  test('LOYALTY PAGE claims a subject that also names the widget', () => {
    // The two used to be one label. They are now separate and LOYALTY PAGE sits
    // above WIDGET, so a ticket naming both is a page ticket.
    expect(classify({ subject: 'widget on the loyalty page does not load' })).toBe('LOYALTY PAGE');
    expect(classify({ subject: 'widget does not load' })).toBe('WIDGET');
  });

  test('TRANSLATION claims a subject that also names email', () => {
    // Also one label until this table was rebuilt. TRANSLATION sits above, so a
    // translation complaint about an email stays a translation ticket.
    expect(classify({ subject: 'translate the email template to German' })).toBe('TRANSLATION');
    expect(classify({ subject: 'email template not sending' })).toBe('EMAIL / NOTIFY');
  });

  test('CUSTOMIZATION still wins when the subject names no feature', () => {
    // It sits last so a `[customize]` prefix never beats the topic. That is only
    // safe while it still fires when there is no topic to beat — otherwise the
    // label is unreachable and those tickets fall through to OTHER.
    expect(classify({ subject: '[customize] tuy chinh theo yeu cau' })).toBe('CUSTOMIZATION');
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

  test('every keyword still wins the category it is filed under', () => {
    // First match wins, so a keyword filed under a label that sits below another
    // label matching the same text is dead: it can never fire, and the label it was
    // added for silently loses those tickets. Moving a row, or adding one above an
    // existing row, is all it takes — and nothing about either is visible.
    const misfiled = CATEGORY_KEYWORDS.flatMap(({ category, keywords }) =>
      keywords
        .map((keyword) => ({ keyword, got: classify({ subject: keyword }) }))
        .filter(({ got }) => got !== category)
        .map(({ keyword, got }) => `${keyword}: ${category} -> ${got}`)
    );

    expect(misfiled).toEqual([]);
  });
});
