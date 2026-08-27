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

  test('keeps zero slots undrawn without losing their positions', () => {
    expect(drawnSegments([4, 0, 3, 0, 2, 1])).toEqual([0, 2, 4, 5]);
    expect(stackHeights([0, 0, 0], 0)).toEqual([0, 0, 0]);
  });
});
