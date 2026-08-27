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

/**
 * Least height the hatched excluded slice may draw at. The stripe has a 5px
 * period; below about three pixels it degenerates into a row of teeth on the
 * bar's top edge, which at 1:1 is indistinguishable from anti-aliasing and from
 * a bar carrying no excluded cohort at all — the case the hatch exists to mark.
 * Four is the first height at which a full stripe and its gap both land inside
 * the region.
 */
export const MIN_EXCLUDED_HEIGHT = 4;

/**
 * The status split's created stack: one height per named slot, then the excluded
 * cohort on top.
 *
 * The named slots keep `stackHeights`' contract exactly — they sum to
 * `Math.round(barHeight(counted, max))`, the whole-pixel bar the counted tickets
 * alone would draw. The excluded slice sits *outside* that sum. It takes the gap
 * up to the printed total, or `MIN_EXCLUDED_HEIGHT` when the gap is thinner than
 * that, so a stack with a one-ticket cohort draws a pixel or two past the number
 * printed above it. Exact geometry is traded for a signal that survives at 1:1,
 * which is the same trade drawing the gap at all already made.
 *
 * The one thing it will not do is draw outside the plot. At the tallest bar
 * there is no room above to overshoot into, so the pixels the minimum needs come
 * out of the tallest named slots instead — the stack stays inside `plotHeight`
 * rather than being shrunk wholesale by the flex column that holds it.
 */
export function createdStackHeights(
  counts: number[],
  excluded: number,
  max: number
): number[] {
  const named = stackHeights(counts, max);
  if (excluded <= 0) return [...named, 0];

  const counted = counts.reduce((total, count) => total + count, 0);
  const gap = Math.round(barHeight(counted + excluded, max)) - Math.round(barHeight(counted, max));
  const height = Math.min(
    COLUMN_GEOMETRY.plotHeight,
    Math.max(gap, MIN_EXCLUDED_HEIGHT)
  );

  const namedTotal = named.reduce((total, slot) => total + slot, 0);
  let debt = Math.max(0, height + namedTotal - COLUMN_GEOMETRY.plotHeight);
  while (debt > 0) {
    // Tallest first, ties to the earlier slot: the pixel comes off the band that
    // can spare it, and never off a slot already drawing nothing.
    let tallest = -1;
    for (const index of named.keys()) {
      if ((named[index] ?? 0) > 0 && (tallest < 0 || (named[index] ?? 0) > (named[tallest] ?? 0)))
        tallest = index;
    }
    if (tallest < 0) break;
    named[tallest] = (named[tallest] ?? 0) - 1;
    debt -= 1;
  }

  return [...named, height];
}
