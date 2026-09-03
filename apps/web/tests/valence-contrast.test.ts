import { expect, test } from 'bun:test';
import { valencePillClass, valenceTextClass } from '../src/components/report/direction';

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

/**
 * Tailwind 4.3.3 supplies these hexes, and bun.lock staying unchanged is what
 * pins that version. Nothing here runs Tailwind, so the last inch — that the
 * class name really resolves to the hex beside it — is not mechanically closed
 * and cannot be without a renderer, which these tests do not have. What the
 * suite does close is the edge that used to be open: the table below is keyed
 * by class name and the test asserts those keys are exactly the classes
 * `direction.ts` emits, so a swapped or added utility fails here instead of
 * quietly shipping an unmeasured pair.
 */
const hexByClass: Record<string, string> = {
  'text-red-700': '#c10007',
  'text-emerald-700': '#007a55',
  'text-stone-700': '#44403b',
  'bg-red-50': '#fef2f2',
  'bg-emerald-50': '#ecfdf5',
  'bg-stone-100': '#f5f5f4',
};

/** Tiles and panels sit on white, so a bare text class is read against it. */
const TILE_BACKGROUND = '#ffffff';

/** The app's tightest existing pair; deliberately stricter than WCAG AA's 4.5. */
const CONTRAST_FLOOR = 4.61;

const DELTAS = [1, -1, 0, null] as const;
const VALENCES = ['riseIsBad', 'riseIsGood', undefined] as const;

test('keeps every valence pair the page can emit above the app contrast floor', () => {
  const textClasses = new Set<string>();
  const pillClasses = new Set<string>();
  for (const delta of DELTAS) {
    for (const valence of VALENCES) {
      const text = valenceTextClass(delta, valence);
      if (text) textClasses.add(text);
      pillClasses.add(valencePillClass(delta, valence));
    }
  }

  const emitted = [...textClasses, ...pillClasses].flatMap((value) => value.split(' '));
  expect([...new Set(emitted)].sort()).toEqual(Object.keys(hexByClass).sort());

  for (const pill of pillClasses) {
    const [background, foreground] = pill.split(' ');
    expect(contrast(hexByClass[foreground]!, hexByClass[background]!)).toBeGreaterThanOrEqual(
      CONTRAST_FLOOR
    );
  }
  for (const text of textClasses) {
    expect(contrast(hexByClass[text]!, TILE_BACKGROUND)).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
  }
});
