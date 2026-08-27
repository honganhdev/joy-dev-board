import { COLUMN_GEOMETRY, barHeight } from './column-geometry';

/** Indices of the counts that draw at all — a zero count renders no element. */
export function drawnSegments(counts: number[]): number[] {
  return counts.flatMap((count, index) => (count > 0 ? [index] : []));
}

/**
 * Whole-pixel heights for one stacked bar. The rounding remainder belongs to
 * the last drawn segment so the stack lands exactly where its solid bar would.
 */
export function stackHeights(counts: number[], max: number): number[] {
  const heights = Array<number>(counts.length).fill(0);
  const drawn = drawnSegments(counts);
  const totalCount = counts.reduce((total, count) => total + count, 0);
  const totalHeight = Math.round(barHeight(totalCount, max));
  let used = 0;

  drawn.forEach((index, drawnIndex) => {
    const last = drawnIndex === drawn.length - 1;
    const height = last
      ? Math.max(0, totalHeight - used)
      : Math.floor(barHeight(counts[index] ?? 0, max));
    heights[index] = Math.min(COLUMN_GEOMETRY.plotHeight, height);
    used += height;
  });

  return heights;
}
