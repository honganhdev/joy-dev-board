import { CATEGORY_KEYWORDS, FALLBACK_CATEGORY, type Category } from './categories';

/**
 * Lowercases and strips Vietnamese diacritics so one keyword spelling covers
 * both `điểm` and `diem`. `đ`/`Đ` do not decompose under NFD, so they are
 * replaced explicitly.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-bounded for plain ASCII words (so `api` misses `rapid`), plain substring
 * for phrases and anything with a non-ASCII letter.
 */
function buildMatcher(keyword: string): RegExp {
  const normalized = normalize(keyword);
  const pattern = escapeRegExp(normalized);
  return /^[a-z0-9]+$/.test(normalized)
    ? new RegExp(`\\b${pattern}\\b`)
    : new RegExp(pattern);
}

/** Compiled once at module load — the table is static data. */
const COMPILED = CATEGORY_KEYWORDS.map(({ category, keywords }) => ({
  category,
  matchers: keywords.map(buildMatcher),
}));

export type Classifiable = {
  subject?: string | null;
  description?: string | null;
};

/**
 * Assigns exactly one category.
 *
 * The subject is checked against the whole table first; only when nothing in the
 * subject matches does the description get a turn. Descriptions are long and
 * quote store data, so letting them compete with the subject would drown the
 * signal.
 */
export function classify(ticket: Classifiable): Category {
  const subject = normalize(ticket.subject ?? '');
  const description = normalize(ticket.description ?? '');

  for (const source of [subject, description]) {
    if (!source) continue;
    for (const { category, matchers } of COMPILED) {
      if (matchers.some((matcher) => matcher.test(source))) return category;
    }
  }

  return FALLBACK_CATEGORY;
}

export type { Category };
