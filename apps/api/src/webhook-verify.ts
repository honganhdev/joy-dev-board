import { createHmac, timingSafeEqual } from 'node:crypto';

// Avada may replay the original signature across its retry backoff. Permanent
// delivery-id dedupe is the primary replay defence, so this window is generous.
export const FRESHNESS_WINDOW_MS = 15 * 60 * 1000;

export function verifySignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string
): boolean {
  const expected = `sha256=${createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')}`;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(signature);
  if (expectedBytes.length !== receivedBytes.length) return false;
  return timingSafeEqual(expectedBytes, receivedBytes);
}

export function isFresh(timestamp: string, now: number, windowMs = FRESHNESS_WINDOW_MS): boolean {
  const sentAt = Number(timestamp);
  return Number.isSafeInteger(sentAt) && Math.abs(now - sentAt) <= windowMs;
}
