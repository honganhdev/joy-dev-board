import { describe, expect, test } from 'bun:test';
import { FRESHNESS_WINDOW_MS, isFresh, verifySignature } from '../src/webhook-verify';
import { signWebhook } from './webhook-helpers';

const secret = 'locally-generated-test-secret';
const timestamp = '1787736000000';
const body = JSON.stringify({ event: 'ticket.updated', ticket: { id: 'ticket-id' } });

describe('verifySignature', () => {
  test('accepts the documented sha256-prefixed hex HMAC over timestamp dot raw body', () => {
    expect(verifySignature(secret, timestamp, body, signWebhook(secret, timestamp, body))).toBe(
      true
    );
  });

  test('rejects one changed hexadecimal character', () => {
    const signature = signWebhook(secret, timestamp, body);
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
    expect(verifySignature(secret, timestamp, body, flipped)).toBe(false);
  });

  test('rejects a signature over another body', () => {
    const signature = signWebhook(secret, timestamp, '{}');
    expect(verifySignature(secret, timestamp, body, signature)).toBe(false);
  });

  test('rejects a signature over another timestamp', () => {
    const signature = signWebhook(secret, '1787736000001', body);
    expect(verifySignature(secret, timestamp, body, signature)).toBe(false);
  });

  test('returns false instead of throwing for a header of the wrong length', () => {
    expect(verifySignature(secret, timestamp, body, 'sha256=short')).toBe(false);
  });
});

describe('isFresh', () => {
  const now = 1_787_736_000_000;

  test('accepts a timestamp fourteen minutes old', () => {
    expect(isFresh(String(now - 14 * 60 * 1000), now, FRESHNESS_WINDOW_MS)).toBe(true);
  });

  test('rejects timestamps sixteen minutes away in either direction', () => {
    expect(isFresh(String(now - 16 * 60 * 1000), now, FRESHNESS_WINDOW_MS)).toBe(false);
    expect(isFresh(String(now + 16 * 60 * 1000), now, FRESHNESS_WINDOW_MS)).toBe(false);
  });

  test('rejects a non-numeric timestamp', () => {
    expect(isFresh('abc', now, FRESHNESS_WINDOW_MS)).toBe(false);
  });

  test('treats the documented timestamp unit as milliseconds', () => {
    // A roughly 13-digit Unix value is milliseconds; roughly 10 digits is seconds.
    expect(isFresh(String(now), now, FRESHNESS_WINDOW_MS)).toBe(true);
    expect(isFresh(String(Math.floor(now / 1000)), now, FRESHNESS_WINDOW_MS)).toBe(false);
  });
});
