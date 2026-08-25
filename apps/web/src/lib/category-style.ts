import type { Category } from '@/types';

/**
 * Badge colour per category — soft background, darker text, matching the flat
 * light board. Any category without an entry falls back to neutral, so adding a
 * category to the backend table cannot break rendering.
 */
export const STYLES: Record<string, string> = {
  'DFY SETUP': 'bg-orange-50 text-orange-700 border-orange-100',
  ONBOARDING: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  'BILLING / PLAN': 'bg-red-50 text-red-700 border-red-100',
  REFERRAL: 'bg-sky-50 text-sky-700 border-sky-100',
  TRANSLATION: 'bg-purple-50 text-purple-700 border-purple-100',
  'EMAIL / NOTIFY': 'bg-teal-50 text-teal-700 border-teal-100',
  ANALYTICS: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  INTEGRATIONS: 'bg-lime-50 text-lime-700 border-lime-100',
  'VIP TIERS': 'bg-amber-50 text-amber-700 border-amber-100',
  'EARNING RULES': 'bg-cyan-50 text-cyan-700 border-cyan-100',
  'REDEEM / REWARDS': 'bg-rose-50 text-rose-700 border-rose-100',
  POINTS: 'bg-green-50 text-green-700 border-green-100',
  'COUPON / CHECKOUT': 'bg-yellow-50 text-yellow-700 border-yellow-100',
  'LOYALTY PAGE': 'bg-violet-50 text-violet-700 border-violet-100',
  WIDGET: 'bg-blue-50 text-blue-700 border-blue-100',
  CUSTOMIZATION: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100',
  OTHER: 'bg-stone-100 text-stone-600 border-stone-200',
};

const NEUTRAL = 'bg-stone-100 text-stone-600 border-stone-200';

/** Solid marker shown beside a category name in a collapsible group header. */
export const DOTS: Record<string, string> = {
  'DFY SETUP': 'bg-orange-500',
  ONBOARDING: 'bg-emerald-500',
  'BILLING / PLAN': 'bg-red-500',
  REFERRAL: 'bg-sky-500',
  TRANSLATION: 'bg-purple-500',
  'EMAIL / NOTIFY': 'bg-teal-500',
  ANALYTICS: 'bg-indigo-500',
  INTEGRATIONS: 'bg-lime-500',
  'VIP TIERS': 'bg-amber-500',
  'EARNING RULES': 'bg-cyan-500',
  'REDEEM / REWARDS': 'bg-rose-500',
  POINTS: 'bg-green-500',
  'COUPON / CHECKOUT': 'bg-yellow-500',
  'LOYALTY PAGE': 'bg-violet-500',
  WIDGET: 'bg-blue-500',
  CUSTOMIZATION: 'bg-fuchsia-500',
  OTHER: 'bg-stone-400',
};

export function categoryBadgeClass(category: Category | string): string {
  return STYLES[category] ?? NEUTRAL;
}

export function categoryDotClass(category: Category | string): string {
  return DOTS[category] ?? 'bg-stone-400';
}

/** Labels the board shows as written — title-casing would mangle them. */
const ACRONYMS = new Set(['dfy', 'vip']);

/** `COUPON / CHECKOUT` → `Coupon / Checkout` for the card badge. */
export function categoryLabel(category: Category | string): string {
  return category
    .toLowerCase()
    .split(' ')
    .map((word) => {
      if (word === '/') return word;
      if (ACRONYMS.has(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
