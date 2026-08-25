/**
 * Turns plain text into text/link segments.
 *
 * Ticket descriptions are untrusted — customers and agents type them — so they
 * are never rendered as HTML. This produces data, not markup: the caller emits
 * each segment as a text node and only wraps the ones carrying an `href` in an
 * anchor. Anything that is not a recognised `http(s)` URL stays inert text,
 * which is what keeps a pasted `<script>` a literal string.
 */

export type TextSegment = {
  text: string;
  /** Non-null only for a detected `http(s)` URL. */
  href: string | null;
};

/**
 * Deliberately narrow: an explicit `http://` or `https://` scheme, then
 * everything up to whitespace or a bracket that clearly closes a wrapper.
 * Bare `www.` and other schemes are left as text — guessing a scheme is how a
 * `javascript:` payload becomes a live link.
 */
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

/** Sentence punctuation that sits after a URL far more often than inside one. */
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', "'", '"', '»', '”']);

/**
 * Trims punctuation the writer meant as prose, not as part of the address.
 * A closing bracket is only trimmed when its opener is absent, so a URL that
 * genuinely contains a balanced pair keeps it.
 */
function trimTrailing(url: string): string {
  let end = url.length;
  while (end > 0) {
    const char = url[end - 1] as string;
    if (TRAILING.has(char)) {
      end -= 1;
      continue;
    }
    const opener = char === ')' ? '(' : char === ']' ? '[' : char === '}' ? '{' : null;
    if (opener && !url.slice(0, end - 1).includes(opener)) {
      end -= 1;
      continue;
    }
    break;
  }
  return url.slice(0, end);
}

/**
 * Splits `text` into consecutive segments. Concatenating every `text` back
 * together reproduces the input exactly, so nothing is dropped or reordered.
 */
export function linkify(text: string): TextSegment[] {
  if (!text) return [];

  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const start = match.index;
    const url = trimTrailing(raw);

    // Nothing but a scheme left after trimming — treat it as prose.
    if (url.length <= 'https://'.length) continue;

    if (start > cursor) segments.push({ text: text.slice(cursor, start), href: null });
    segments.push({ text: url, href: url });
    cursor = start + url.length;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), href: null });
  return segments;
}
