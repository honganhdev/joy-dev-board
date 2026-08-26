import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Avada may replay the original signature across its retry backoff. Permanent
// delivery-key dedupe is the primary replay defence, so this window is generous.
export const FRESHNESS_WINDOW_MS = 15 * 60 * 1000;

/** Longest attacker-supplied value that may reach a log line. */
const MAX_LOG_VALUE_LENGTH = 64;

/** C0 control characters and DEL, newlines included. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

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

/**
 * The value a delivery is deduped on.
 *
 * It has to come from inside the signature. `X-Avada-Delivery` is not signed,
 * so one captured request replayed under a fresh header would reserve a second
 * row and do the work again — an upstream GET, a durable row and a queue entry
 * per replay. The spec carries the same id in the body (`deliveryId`), which is
 * signed; a body that omits it is deduped on its own bytes instead, which says
 * the same thing for any two deliveries that carry the same payload.
 */
export function deliveryKey(bodyDeliveryId: unknown, rawBody: string): string {
  if (typeof bodyDeliveryId === 'string' && bodyDeliveryId !== '') return bodyDeliveryId;
  return `body:${createHash('sha256').update(rawBody).digest('hex')}`;
}

/**
 * Makes a caller-supplied value safe to put in a log line: an anonymous caller
 * must not be able to forge a line by sending a newline, or grow the log
 * without bound by sending a very long header.
 */
export function sanitizeForLog(value: string | null | undefined): string {
  const stripped = (value ?? '').replace(CONTROL_CHARACTERS, '');
  if (stripped === '') return '(missing)';
  return stripped.length > MAX_LOG_VALUE_LENGTH
    ? `${stripped.slice(0, MAX_LOG_VALUE_LENGTH)}…`
    : stripped;
}
