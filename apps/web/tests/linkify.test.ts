import { describe, expect, test } from 'bun:test';
import { linkify } from '../src/lib/linkify';

/** The segments must always rebuild the input exactly — nothing dropped. */
function rejoin(text: string): string {
  return linkify(text)
    .map((segment) => segment.text)
    .join('');
}

describe('linkify', () => {
  test('splits a URL out of surrounding prose', () => {
    expect(linkify('see https://capture.avada.io/abc for the video')).toEqual([
      { text: 'see ', href: null },
      { text: 'https://capture.avada.io/abc', href: 'https://capture.avada.io/abc' },
      { text: ' for the video', href: null },
    ]);
  });

  test('leaves sentence punctuation outside the link', () => {
    const cases = [
      ['https://a.io/x.', 'https://a.io/x'],
      ['https://a.io/x,', 'https://a.io/x'],
      ['https://a.io/x!?', 'https://a.io/x'],
      ['(https://a.io/x)', 'https://a.io/x'],
      ['see "https://a.io/x"', 'https://a.io/x'],
    ];
    for (const [input, expected] of cases) {
      const link = linkify(input as string).find((segment) => segment.href);
      expect(link?.href).toBe(expected as string);
    }
  });

  test('keeps a bracket the URL itself opened', () => {
    const link = linkify('https://wiki.io/A_(disambiguation)').find((segment) => segment.href);
    expect(link?.href).toBe('https://wiki.io/A_(disambiguation)');
  });

  test('finds several URLs across lines', () => {
    const links = linkify('one https://a.io/1\ntwo https://b.io/2')
      .filter((segment) => segment.href)
      .map((segment) => segment.href);
    expect(links).toEqual(['https://a.io/1', 'https://b.io/2']);
  });

  test('never turns markup or a non-http scheme into a link', () => {
    const hostile = '<script>alert(1)</script> javascript:alert(1) data:text/html,<b> www.a.io';
    expect(linkify(hostile).every((segment) => segment.href === null)).toBe(true);
    expect(rejoin(hostile)).toBe(hostile);
  });

  test('does not link an embedded javascript: scheme inside a matched URL run', () => {
    for (const segment of linkify('https://a.io/x?next=javascript:alert(1)')) {
      expect(segment.href === null || segment.href.startsWith('https://')).toBe(true);
    }
  });

  test('a bare scheme is prose, not a link', () => {
    expect(linkify('protocols like https:// exist').every((s) => s.href === null)).toBe(true);
  });

  test('empty text yields no segments', () => {
    expect(linkify('')).toEqual([]);
  });

  test('round-trips multi-paragraph text with embedded JSON', () => {
    const text = 'Steps:\n\n{"shop":"a.myshopify.com"}\n\nVideo: https://capture.avada.io/z\n';
    expect(rejoin(text)).toBe(text);
  });
});
