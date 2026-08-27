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

  test('gives every drawn segment its floored share, then the dropped pixels largest-remainder first', () => {
    // The sum landing on the right pixel says nothing about where the rounding
    // went. Pin the distribution too: no segment is more than one pixel off its
    // exact share, and the pixels flooring dropped go to the segments that lost
    // the most, ties to the earlier slot.
    for (const { counts, max } of cases) {
      const heights = stackHeights(counts, max);
      const drawn = drawnSegments(counts);
      if (drawn.length === 0) continue;

      const exact = drawn.map((index) => barHeight(counts[index] ?? 0, max));
      const floors = exact.map((height) => Math.floor(height));
      const total = counts.reduce((sum, count) => sum + count, 0);
      const residue = Math.round(barHeight(total, max)) - floors.reduce((sum, h) => sum + h, 0);
      const raised = new Set(
        floors
          .map((_, position) => position)
          .sort(
            (left, right) =>
              (exact[right] ?? 0) -
                (floors[right] ?? 0) -
                ((exact[left] ?? 0) - (floors[left] ?? 0)) || left - right
          )
          .slice(0, residue)
      );

      drawn.forEach((index, position) => {
        expect(heights[index]).toBe((floors[position] ?? 0) + (raised.has(position) ? 1 : 0));
      });
      for (const index of counts.keys()) {
        if (!drawn.includes(index)) expect(heights[index]).toBe(0);
      }
    }
  });

  test('never lets one slot hoard the residue while an identical count draws short', () => {
    // The case that named this rule: three twos and three ones, where sending
    // the whole remainder to the last drawn slot drew the final single ticket
    // taller than the doubles above it. Equal counts may now differ by a pixel,
    // which integer heights cannot avoid, and by no more than that.
    const counts = [2, 2, 2, 1, 1, 1];
    const heights = stackHeights(counts, 27);

    expect(heights.reduce((sum, height) => sum + height, 0)).toBe(Math.round(barHeight(9, 27)));
    for (const [left, right] of [
      [0, 1],
      [0, 2],
      [1, 2],
      [3, 4],
      [3, 5],
      [4, 5],
    ]) {
      expect(Math.abs((heights[left] ?? 0) - (heights[right] ?? 0))).toBeLessThanOrEqual(1);
    }
    // A single ticket never outdraws a double in the same stack.
    for (const single of [3, 4, 5]) {
      for (const double of [0, 1, 2]) {
        expect(heights[single] ?? 0).toBeLessThan(heights[double] ?? 0);
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
