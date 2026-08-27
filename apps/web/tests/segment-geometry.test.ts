import { describe, expect, test } from 'bun:test';
import { COLUMN_GEOMETRY, barHeight } from '../src/components/report/column-geometry';
import { drawnSegments, stackHeights } from '../src/components/report/segment-geometry';

const cases = [
  { counts: [0, 0, 0, 0, 0, 0], max: 27 },
  { counts: [0, 7, 0, 0, 0, 0], max: 27 },
  { counts: [3, 3, 3, 3, 3, 3], max: 27 },
  { counts: [4, 0, 3, 0, 2, 1], max: 27 },
  { counts: [20, 12, 9, 7, 5, 4], max: 57 },
  { counts: [8, 6, 5, 4, 3, 1], max: 27 },
  { counts: [0, 0, 0, 0, 0, 0], max: 0 },
];

describe('stackHeights', () => {
  test('lands every stack on the whole pixel its single bar would reach', () => {
    for (const { counts, max } of cases) {
      const heights = stackHeights(counts, max);
      const sum = counts.reduce((total, count) => total + count, 0);

      expect(heights.reduce((total, height) => total + height, 0)).toBe(
        Math.round(barHeight(sum, max))
      );
      for (const height of heights) {
        expect(Number.isFinite(height)).toBe(true);
        expect(height).toBeGreaterThanOrEqual(0);
        expect(height).toBeLessThanOrEqual(COLUMN_GEOMETRY.plotHeight);
      }
    }
  });

  test('floors every segment but the last drawn one, which carries the whole residue', () => {
    // The sum landing on the right pixel says nothing about where the rounding
    // went. Pin the distribution too: every segment but one is its own floored
    // share, and the single segment that differs is the last *drawn* slot — not
    // the last slot, and not the tallest.
    for (const { counts, max } of cases) {
      const heights = stackHeights(counts, max);
      const drawn = drawnSegments(counts);
      if (drawn.length === 0) continue;

      const last = drawn.at(-1) as number;
      let floored = 0;
      for (const index of drawn.slice(0, -1)) {
        expect(heights[index]).toBe(Math.floor(barHeight(counts[index] ?? 0, max)));
        floored += heights[index] ?? 0;
      }
      const total = counts.reduce((sum, count) => sum + count, 0);
      expect(heights[last]).toBe(Math.round(barHeight(total, max)) - floored);
      for (const index of counts.keys()) {
        if (!drawn.includes(index)) expect(heights[index]).toBe(0);
      }
    }
  });

  test('carries the residue past trailing empty slots to the last drawn one', () => {
    // `[0, 7, 0, 0, 0, 0]` is the case that separates "last drawn" from "last
    // slot": the four empty tails must stay at zero and slot 1 must hold the
    // whole bar, or the stack draws a gap where the rounding went.
    const heights = stackHeights([0, 7, 0, 0, 0, 0], 27);

    expect(heights[1]).toBe(Math.round(barHeight(7, 27)));
    expect(heights).toEqual([0, heights[1] as number, 0, 0, 0, 0]);
  });

  test('keeps zero slots undrawn without losing their positions', () => {
    expect(drawnSegments([4, 0, 3, 0, 2, 1])).toEqual([0, 2, 4, 5]);
    expect(stackHeights([0, 0, 0], 0)).toEqual([0, 0, 0]);
  });
});
