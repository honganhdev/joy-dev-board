import type { Category } from '@/types';

/**
 * Badge colour per category — soft background, darker text, matching the flat
 * light board. Any category without an entry falls back to neutral, so adding a
 * category to the backend table cannot break rendering.
 */
const STYLES: Record<string, string> = {
  'WIDGET / UNIFIED': 'bg-blue-50 text-blue-700 border-blue-100',
  'COUPON / CART': 'bg-amber-50 text-amber-700 border-amber-100',
  'PROGRAM ADMIN': 'bg-violet-50 text-violet-700 border-violet-100',
  'TRANSLATION / EMAIL': 'bg-teal-50 text-teal-700 border-teal-100',
  'POINTS / ACTIVITY': 'bg-emerald-50 text-emerald-700 border-emerald-100',
  INTEGRATIONS: 'bg-sky-50 text-sky-700 border-sky-100',
  ANALYTICS: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  REFERRAL: 'bg-rose-50 text-rose-700 border-rose-100',
  CUSTOMIZATION: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100',
  OTHER: 'bg-stone-100 text-stone-600 border-stone-200',
};

const NEUTRAL = 'bg-stone-100 text-stone-600 border-stone-200';

/** Solid marker shown beside a category name in a collapsible group header. */
const DOTS: Record<string, string> = {
  'WIDGET / UNIFIED': 'bg-blue-500',
  'COUPON / CART': 'bg-amber-500',
  'PROGRAM ADMIN': 'bg-violet-500',
  'TRANSLATION / EMAIL': 'bg-teal-500',
  'POINTS / ACTIVITY': 'bg-emerald-500',
  INTEGRATIONS: 'bg-sky-500',
  ANALYTICS: 'bg-indigo-500',
  REFERRAL: 'bg-rose-500',
  CUSTOMIZATION: 'bg-fuchsia-500',
  OTHER: 'bg-stone-400',
};

export function categoryBadgeClass(category: Category | string): string {
  return STYLES[category] ?? NEUTRAL;
}

export function categoryDotClass(category: Category | string): string {
  return DOTS[category] ?? 'bg-stone-400';
}

/** `WIDGET / UNIFIED` → `Widget / Unified` for the card badge. */
export function categoryLabel(category: Category | string): string {
  return category
    .toLowerCase()
    .split(' ')
    .map((word) => (word === '/' ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}
