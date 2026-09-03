import { describe, expect, test } from 'bun:test';
import {
  valencePillClass,
  valenceTextClass,
} from '../src/components/report/direction';

describe('valence classes', () => {
  test('reads a rise as bad when intake rising is unwanted', () => {
    expect(valenceTextClass(1, 'riseIsBad')).toBe('text-red-700');
    expect(valencePillClass(1, 'riseIsBad')).toBe('bg-red-50 text-red-700');
  });

  test('reads a fall as good even though the number is negative', () => {
    expect(valenceTextClass(-1, 'riseIsBad')).toBe('text-emerald-700');
    expect(valencePillClass(-1, 'riseIsBad')).toBe('bg-emerald-50 text-emerald-700');
  });

  test('reads a rise as good when the measure declares that direction', () => {
    expect(valenceTextClass(1, 'riseIsGood')).toBe('text-emerald-700');
    expect(valencePillClass(1, 'riseIsGood')).toBe('bg-emerald-50 text-emerald-700');
  });

  test('leaves zero neutral', () => {
    expect(valenceTextClass(0, 'riseIsBad')).toBe('');
    expect(valencePillClass(0, 'riseIsBad')).toBe('bg-stone-100 text-stone-700');
  });

  test('leaves an unavailable comparison neutral', () => {
    expect(valenceTextClass(null, 'riseIsBad')).toBe('');
    expect(valencePillClass(null, 'riseIsBad')).toBe('bg-stone-100 text-stone-700');
  });

  test('leaves a comparison without a declared direction neutral', () => {
    expect(valenceTextClass(1)).toBe('');
    expect(valencePillClass(1)).toBe('bg-stone-100 text-stone-700');
  });
});
