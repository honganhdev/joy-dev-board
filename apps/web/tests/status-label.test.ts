import { describe, expect, test } from 'bun:test';
import { humanise, statusLabel } from '../src/lib/status-label';

describe('statusLabel', () => {
  test('humanises the statuses the board columns use', () => {
    expect(statusLabel('dev_fixing')).toBe('Dev fixing');
    expect(statusLabel('waiting_customer')).toBe('Waiting customer');
    expect(statusLabel('dev_done')).toBe('Dev done');
    expect(statusLabel('done')).toBe('Done');
  });

  test('handles a status the board has never seen', () => {
    // tsStatus is not a closed enum, so an unknown value must still read.
    expect(statusLabel('advanced_2026')).toBe('Advanced 2026');
    expect(statusLabel('some-brand-new-state')).toBe('Some brand new state');
    expect(statusLabel('WAITING_PERMISSION')).toBe('Waiting permission');
  });

  test('says so rather than rendering blank when there is no status', () => {
    expect(statusLabel(null)).toBe('No status');
    expect(statusLabel(undefined)).toBe('No status');
    expect(statusLabel('')).toBe('No status');
    expect(statusLabel('   ')).toBe('No status');
    expect(statusLabel('___')).toBe('No status');
  });

  test('collapses stray separators instead of leaving gaps', () => {
    expect(statusLabel('  dev__fixing  ')).toBe('Dev fixing');
  });
});

describe('humanise', () => {
  test('reads the same rule for the other raw enum-ish fields', () => {
    expect(humanise('advanced_2026')).toBe('Advanced 2026');
    expect(humanise('medium')).toBe('Medium');
  });

  test('gives back an empty string so callers can drop the field entirely', () => {
    expect(humanise(null)).toBe('');
    expect(humanise('')).toBe('');
  });
});
