import { describe, expect, test } from 'bun:test';
import { COLUMN_GEOMETRY, barHeight } from '../src/components/report/column-geometry';
import {
  createdStackHeights,
  drawnSegments,
  stackHeights,
} from '../src/components/report/segment-geometry';

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

describe('createdStackHeights', () => {
  // Named slots, the day's excluded cohort, and the panel's tallest value. Every
  // `max` is at least the day's own created total, as the panel's own is.
  const stacks = [
    { counts: [20, 12, 9, 7, 5, 4], excluded: 0, max: 57 },
    { counts: [20, 12, 9, 7, 5, 3], excluded: 1, max: 57 },
    { counts: [20, 12, 9, 7, 5, 4], excluded: 2, max: 130 },
    { counts: [20, 12, 9, 7, 5, 4], excluded: 1, max: 130 },
    { counts: [10, 6, 3, 2, 0, 0], excluded: 24, max: 57 },
    { counts: [0, 0, 0, 0, 0, 0], excluded: 3, max: 57 },
    { counts: [0, 0, 0, 0, 0, 0], excluded: 0, max: 57 },
    { counts: [1, 0, 0, 0, 0, 0], excluded: 56, max: 57 },
  ];

  test('draws a one and a two ticket cohort at four pixels, not at one and two', () => {
    // The defect this rule exists for, pinned at its literal heights: at one and
    // two pixels the 5px-period stripe is a row of teeth on the bar's top edge,
    // which at 1:1 reads exactly like a bar with no excluded cohort at all. Both
    // of these would otherwise draw at the gap — 1px and 2px respectively.
    expect(createdStackHeights([20, 12, 9, 7, 5, 4], 1, 130).at(-1)).toBe(4);
    expect(createdStackHeights([20, 12, 9, 7, 5, 4], 2, 130).at(-1)).toBe(4);
    // Still four at the tallest bar, where the pixels come out of the named slots.
    expect(createdStackHeights([20, 12, 9, 7, 5, 3], 1, 57).at(-1)).toBe(4);
    // And nothing at all when there is no excluded cohort.
    expect(createdStackHeights([20, 12, 9, 7, 5, 4], 0, 57).at(-1)).toBe(0);
  });

  test('leaves the named slots on the contract stackHeights already holds', () => {
    // The minimum is paid for by overshooting the printed total, not by taking
    // pixels out of the categories — except at the plot ceiling, where there is
    // nothing above to overshoot into.
    for (const { counts, excluded, max } of stacks) {
      const heights = createdStackHeights(counts, excluded, max);
      const named = heights.slice(0, -1);
      const counted = counts.reduce((total, count) => total + count, 0);
      const ceiling =
        Math.round(barHeight(counted, max)) + (heights.at(-1) ?? 0) > COLUMN_GEOMETRY.plotHeight;

      expect(heights.length).toBe(counts.length + 1);
      if (!ceiling) expect(named).toEqual(stackHeights(counts, max));
      expect(named.reduce((total, height) => total + height, 0)).toBe(
        ceiling
          ? COLUMN_GEOMETRY.plotHeight - (heights.at(-1) ?? 0)
          : Math.round(barHeight(counted, max))
      );
    }
  });

  test('never overshoots the printed total by more than four, and never leaves the plot', () => {
    for (const { counts, excluded, max } of stacks) {
      const heights = createdStackHeights(counts, excluded, max);
      const total = heights.reduce((sum, height) => sum + height, 0);
      const printed = Math.round(
        barHeight(counts.reduce((sum, count) => sum + count, 0) + excluded, max)
      );

      expect(total).toBeLessThanOrEqual(COLUMN_GEOMETRY.plotHeight);
      expect(total).toBeGreaterThanOrEqual(Math.min(printed, COLUMN_GEOMETRY.plotHeight));
      expect(total - printed).toBeLessThanOrEqual(4);
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(0);
    }
  });

  test('takes the whole gap when the gap is already wide enough to read', () => {
    // 24 excluded of 45 created at max 57: the hatch is the gap, unmodified, and
    // the stack lands exactly on the printed total.
    const heights = createdStackHeights([10, 6, 3, 2, 0, 0], 24, 57);
    const printed = Math.round(barHeight(45, 57));

    expect(heights.at(-1)).toBe(printed - Math.round(barHeight(21, 57)));
    expect(heights.at(-1)).toBe(55);
    expect(heights.reduce((sum, height) => sum + height, 0)).toBe(printed);
  });
});
