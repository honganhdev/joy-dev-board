import { describe, expect, test } from 'bun:test';
import { categoryBadgeClass, categoryDotClass, categoryLabel } from '../src/lib/category-style';
import { CATEGORIES } from '../../api/src/board/categories';

/**
 * The backend table is imported rather than restated: these maps exist only to
 * cover it, and a copy of the label list here would drift the same way the maps
 * being tested can.
 */

/** A label the backend table cannot produce. */
const UNKNOWN = 'NOT A CATEGORY';

describe('categoryLabel', () => {
  test('title-cases a label and leaves the slash alone', () => {
    expect(categoryLabel('COUPON / CHECKOUT')).toBe('Coupon / Checkout');
    expect(categoryLabel('LOYALTY PAGE')).toBe('Loyalty Page');
    expect(categoryLabel('WIDGET')).toBe('Widget');
  });

  test('keeps acronym labels upper-case', () => {
    // Plain title-casing renders these as `Dfy Setup` and `Vip Tiers` on every card
    // and group header.
    expect(categoryLabel('DFY SETUP')).toBe('DFY Setup');
    expect(categoryLabel('VIP TIERS')).toBe('VIP Tiers');
  });

  test('loses nothing from any label the backend can produce', () => {
    // Casing is the only thing this is allowed to change.
    for (const category of CATEGORIES) {
      expect(categoryLabel(category).toUpperCase()).toBe(category);
    }
  });
});

describe('categoryBadgeClass and categoryDotClass', () => {
  test('give every backend category a colour of its own', () => {
    // Both maps are keyed by plain string and fall through to neutral, so a label
    // added to the backend table and not here renders grey — the same grey as
    // OTHER — with nothing failing anywhere. Compared against the fallback rather
    // than a hardcoded class so this survives a palette change.
    const neutralBadge = categoryBadgeClass(UNKNOWN);
    const neutralDot = categoryDotClass(UNKNOWN);

    const uncoloured = CATEGORIES.filter(
      (category) =>
        category !== 'OTHER' &&
        (categoryBadgeClass(category) === neutralBadge || categoryDotClass(category) === neutralDot)
    );

    expect(uncoloured).toEqual([]);
  });

  test('give no two categories the same colour', () => {
    // A board column now carries ~17 groups where it carried 6. Two labels sharing
    // a dot or a badge is the point of the change quietly undone.
    const dots = CATEGORIES.map((category) => categoryDotClass(category));
    expect(new Set(dots).size).toBe(dots.length);

    const badges = CATEGORIES.map((category) => categoryBadgeClass(category));
    expect(new Set(badges).size).toBe(badges.length);
  });

  test('fall back to neutral for a category they have never seen', () => {
    // Category is a closed union in TypeScript but arrives over the wire as a
    // string, so an API ahead of the deployed bundle must still render.
    expect(categoryBadgeClass(UNKNOWN)).toBe('bg-stone-100 text-stone-600 border-stone-200');
    expect(categoryDotClass(UNKNOWN)).toBe('bg-stone-400');
  });
});
