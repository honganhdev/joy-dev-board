import { COLUMN_GEOMETRY, barHeight } from './column-geometry';

/** Indices of the counts that draw at all — a zero count renders no element. */
export function drawnSegments(counts: number[]): number[] {
  return counts.flatMap((count, index) => (count > 0 ? [index] : []));
}

/**
 * Whole-pixel heights for one stacked bar. Every drawn segment starts at its
 * floored share; the pixels flooring dropped go back largest-remainder first, so
 * two equal counts in the same stack never draw different heights. The last
 * drawn segment then absorbs whatever is left over, sign included, which is what
 * makes the stack sum to `Math.round(barHeight(total, max))` exactly.
 *
 * That rounded total is the whole-pixel value the unsplit bar rounds to, not the
 * fractional height it is actually given: an `Off` bar draws at `barHeight`
 * unrounded, so a stack can sit up to half a pixel off its own solid bar.
 */
export function stackHeights(counts: number[], max: number): number[] {
  const heights = Array<number>(counts.length).fill(0);
  const drawn = drawnSegments(counts);
  if (drawn.length === 0) return heights;

  const totalCount = counts.reduce((total, count) => total + count, 0);
  const totalHeight = Math.round(barHeight(totalCount, max));
  const exact = drawn.map((index) => barHeight(counts[index] ?? 0, max));
  const shares = exact.map((height) => Math.floor(height));
  let residue = totalHeight - shares.reduce((total, height) => total + height, 0);

  // Ties go to the earlier slot, so the order is a property of the counts rather
  // than of the sort's stability.
  const byRemainder = shares
    .map((_, position) => position)
    .sort(
      (left, right) =>
        (exact[right] ?? 0) -
          (shares[right] ?? 0) -
          ((exact[left] ?? 0) - (shares[left] ?? 0)) || left - right
    );
  for (const position of byRemainder) {
    if (residue <= 0) break;
    shares[position] = (shares[position] ?? 0) + 1;
    residue -= 1;
  }
  shares[shares.length - 1] = (shares.at(-1) ?? 0) + residue;

  drawn.forEach((index, position) => {
    heights[index] = Math.min(
      COLUMN_GEOMETRY.plotHeight,
      Math.max(0, shares[position] ?? 0)
    );
  });

  return heights;
}
