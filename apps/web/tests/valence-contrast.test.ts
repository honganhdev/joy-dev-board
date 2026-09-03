import { expect, test } from 'bun:test';

function luminance(hex: string): number {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((value) => parseInt(value, 16) / 255) ?? [];
  const [red = 0, green = 0, blue = 0] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('keeps every valence pair above the app contrast floor', () => {
  /**
   * Tailwind 4.3.3 supplies #c10007 text-red-700, #007a55 text-emerald-700,
   * #fef2f2 bg-red-50, #ecfdf5 bg-emerald-50, #44403b text-stone-700 and
   * #f5f5f4 bg-stone-100; #ffffff is the existing white tile/panel background.
   * These pin hex output rather than resolving utilities, so bun.lock staying
   * unchanged is what pins Tailwind 4.3.3. The 4.61 floor is the app's existing
   * tightest pair and is deliberately stricter than WCAG AA's 4.5 floor.
   */
  const pairs = [
    ['#c10007', '#fef2f2'],
    ['#007a55', '#ecfdf5'],
    ['#c10007', '#ffffff'],
    ['#007a55', '#ffffff'],
    ['#44403b', '#f5f5f4'],
  ] as const;

  for (const [foreground, background] of pairs) {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.61);
  }
});
