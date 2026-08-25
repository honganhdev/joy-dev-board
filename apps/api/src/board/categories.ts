/**
 * Category keyword table.
 *
 * Categories do not exist in HelpDesk — JOY tickets almost always have an empty
 * `tagIds` — so this app derives one per ticket from its text.
 *
 * Tuning notes for whoever edits this next:
 * - Order matters. The first category with a keyword hit wins, so specific
 *   topics sit above generic ones and `CUSTOMIZATION` sits last: `[customize]`
 *   prefixes 48 of 384 subjects and describes *how* the work is done, not
 *   *what* it touches.
 * - Setup labels sit first for the same reason in reverse: a `[DFY]` or `[ONB]`
 *   subject is only a shop domain, so anything lower lets the description
 *   fallback fire and mislabel the ticket.
 * - Keywords are matched case-insensitively and diacritic-insensitively, so
 *   `diem` here matches `điểm`, `Điểm` and `diem` in a subject.
 * - ASCII keywords match on word boundaries (`api` does not match `rapid`);
 *   anything containing a space or non-ASCII letter matches as a substring.
 */

export const CATEGORIES = [
  'DFY SETUP',
  'ONBOARDING',
  'BILLING / PLAN',
  'REFERRAL',
  'TRANSLATION',
  'EMAIL / NOTIFY',
  'ANALYTICS',
  'INTEGRATIONS',
  'VIP TIERS',
  'EARNING RULES',
  'REDEEM / REWARDS',
  'POINTS',
  'COUPON / CHECKOUT',
  'LOYALTY PAGE',
  'WIDGET',
  'CUSTOMIZATION',
  'OTHER',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Catch-all for tickets no keyword claims. */
export const FALLBACK_CATEGORY: Category = 'OTHER';

/**
 * Keyword table, evaluated in this exact order. `OTHER` has no keywords by
 * design — it is what a ticket gets when nothing above matched.
 */
export const CATEGORY_KEYWORDS: Array<{ category: Category; keywords: string[] }> = [
  { category: 'DFY SETUP', keywords: ['dfy', 'white-glove'] },
  { category: 'ONBOARDING', keywords: ['onb', 'onboarding', 'live mode', 'launch'] },
  {
    category: 'BILLING / PLAN',
    keywords: ['plan', 'billing', 'refund', 'invoice', 'trial', 'usage fee', 'compensation', 'downgrade'],
  },
  {
    category: 'REFERRAL',
    keywords: ['referral', 'referrer', 'referee', 'refer a friend', 'gioi thieu ban', 'nguoi gioi thieu'],
  },
  {
    category: 'TRANSLATION',
    keywords: [
      'translation',
      'dich',
      'translate',
      'localization',
      'language',
      'ngon ngu',
      'tieng anh',
      'tieng trung',
      'tieng duc',
    ],
  },
  {
    category: 'EMAIL / NOTIFY',
    keywords: [
      'email',
      'mail template',
      'notification',
      'thong bao',
      'reminder',
    ],
  },
  {
    category: 'ANALYTICS',
    keywords: [
      'analytics',
      'export',
      'report',
      'reporting',
      'thong ke',
      'metrics',
      'stats',
      'xuat danh sach',
      'xuat du lieu',
      'xuat toan bo',
      'xuat file',
    ],
  },
  {
    category: 'INTEGRATIONS',
    keywords: [
      'pos',
      'pixel',
      'klaviyo',
      'sync',
      'api',
      'integration',
      'integrate',
      'tich hop',
      'shopify flow',
      'omnisend',
      'shop app',
      'recharge',
      'judge.me',
      'intercom',
      'rivyo',
      'dong bo',
    ],
  },
  {
    category: 'VIP TIERS',
    keywords: ['tier', 'member', 'membership', 'thanh vien', 'vip'],
  },
  {
    category: 'EARNING RULES',
    keywords: [
      'birthday',
      'sinh nhat',
      'entry reward',
      'earn',
      'write review',
      'milestone',
      'earning',
      'anniversary',
      'visit website',
      'share program',
    ],
  },
  {
    category: 'REDEEM / REWARDS',
    keywords: [
      'redeem',
      'reward',
      'phan thuong',
      'free product',
      'free gift',
      'store credit',
      'perk',
      'redemption',
    ],
  },
  {
    category: 'POINTS',
    keywords: ['point', 'diem', 'points', 'balance', 'so du', 'lich su', 'activity', 'transaction', 'expire'],
  },
  {
    category: 'COUPON / CHECKOUT',
    keywords: ['coupon', 'cart', 'gio hang', 'discount', 'checkout', 'ma giam gia', 'bxgy'],
  },
  {
    category: 'LOYALTY PAGE',
    keywords: ['loyalty page', 'loyalty hub', 'hub', 'loyalty block', 'loyalty dashboard'],
  },
  {
    category: 'WIDGET',
    keywords: ['widget', 'icon', 'theme', 'launcher', 'popup', 'app embed', 'banner', 'css'],
  },
  {
    category: 'CUSTOMIZATION',
    keywords: ['customize', 'customise', 'customization', 'customisation', 'tuy chinh'],
  },
];
