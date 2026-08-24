/**
 * Category keyword table.
 *
 * Categories do not exist in HelpDesk — JOY tickets almost always have an empty
 * `tagIds` — so this app derives one per ticket from its text.
 *
 * Tuning notes for whoever edits this next:
 * - Order matters. The first category with a keyword hit wins, so specific
 *   topics sit above generic ones and `CUSTOMIZATION` sits last: `[customize]`
 *   is a prefix on a third of all subjects and describes *how* the work is done,
 *   not *what* it touches.
 * - Keywords are matched case-insensitively and diacritic-insensitively, so
 *   `diem` here matches `điểm`, `Điểm` and `diem` in a subject.
 * - ASCII keywords match on word boundaries (`api` does not match `rapid`);
 *   anything containing a space or non-ASCII letter matches as a substring.
 */

export const CATEGORIES = [
  'REFERRAL',
  'TRANSLATION / EMAIL',
  'ANALYTICS',
  'INTEGRATIONS',
  'WIDGET / UNIFIED',
  'COUPON / CART',
  'POINTS / ACTIVITY',
  'PROGRAM ADMIN',
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
  {
    category: 'REFERRAL',
    keywords: ['referral', 'referrer', 'referee', 'refer a friend', 'gioi thieu ban', 'nguoi gioi thieu'],
  },
  {
    category: 'TRANSLATION / EMAIL',
    keywords: [
      'translation',
      'translate',
      'localization',
      'localisation',
      'language',
      'dich',
      'ngon ngu',
      'tieng anh',
      'tieng duc',
      'tieng trung',
      'email',
      'mail template',
      'notification',
      'thong bao',
      'email template',
    ],
  },
  {
    category: 'ANALYTICS',
    keywords: [
      'analytics',
      'report',
      'reporting',
      'dashboard',
      'export',
      'xuat du lieu',
      'xuat file',
      'thong ke',
      'metrics',
      'stats',
      'summary stats',
    ],
  },
  {
    category: 'INTEGRATIONS',
    keywords: [
      'klaviyo',
      'intercom',
      'mailchimp',
      'omnisend',
      'yotpo',
      'judge.me',
      'zapier',
      'shopify flow',
      'shop app',
      'pos',
      'webhook',
      'api',
      'integration',
      'integrate',
      'tich hop',
      'sync',
      'dong bo',
      'third party',
    ],
  },
  {
    category: 'WIDGET / UNIFIED',
    keywords: [
      'widget',
      'unified',
      'launcher',
      'loyalty page',
      'loyalty hub',
      'loyalty block',
      'floating button',
      'icon',
      'popup',
      'pop-up',
      'css',
      'theme',
      'banner',
      'giao dien',
    ],
  },
  {
    category: 'COUPON / CART',
    keywords: [
      'coupon',
      'discount',
      'discount code',
      'promo code',
      'voucher',
      'ma giam gia',
      'ma coupon',
      'cart',
      'cart drawer',
      'gio hang',
      'checkout',
      'bxgy',
      'buy x get y',
      'free gift',
      'free shipping',
      'store credit',
    ],
  },
  {
    category: 'POINTS / ACTIVITY',
    keywords: [
      'point',
      'points',
      'diem',
      'diem thuong',
      'point calculator',
      'point balance',
      'earning',
      'earn',
      'redeem',
      'activity',
      'transaction',
      'lich su',
      'birthday',
      'sinh nhat',
      'balance',
    ],
  },
  {
    category: 'PROGRAM ADMIN',
    keywords: [
      'program',
      'chuong trinh',
      'tier',
      'vip',
      'membership',
      'member',
      'reward',
      'phan thuong',
      'perk',
      'milestone',
      'setting',
      'settings',
      'cai dat',
      'admin',
      'plan',
      'billing',
      'onboarding',
      'onb',
    ],
  },
  {
    category: 'CUSTOMIZATION',
    keywords: ['customize', 'customise', 'customization', 'customisation', 'custom', 'tuy chinh', 'chinh sua'],
  },
];
