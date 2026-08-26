import { json } from './http';
import { deliveryKey, isFresh, sanitizeForLog, verifySignature } from './webhook-verify';
import type { WebhookProcessor } from './webhook-service';

const MAX_BODY_BYTES = 65_536;

export type WebhookHandlerDeps = {
  secret: string;
  reserveDelivery: (key: string, ticketId: string, createdAt: string | null) => number | null;
  webhooks: WebhookProcessor;
  now?: () => number;
};

type WebhookBody = {
  deliveryId?: unknown;
  ticket?: {
    id?: unknown;
    createdAt?: unknown;
  };
};

export function createWebhookHandler({
  secret,
  reserveDelivery,
  webhooks,
  now = Date.now,
}: WebhookHandlerDeps): (request: Request) => Promise<Response> {
  function reject(status: 400 | 401, reason: string, deliveryId: string | null): Response {
    console.warn(`[webhook] rejected delivery ${sanitizeForLog(deliveryId)}: ${reason}`);
    return json({ error: status === 401 ? 'unauthorized' : 'invalid_request' }, status);
  }

  return async function handleWebhook(request: Request): Promise<Response> {
    let deliveryId: string | null = null;
    try {
      deliveryId = request.headers.get('X-Avada-Delivery');
      // A chunked or HTTP/2 sender declares no length at all, and rejecting
      // that would silently lose every delivery it makes. The read is bounded
      // by the byte check below and by `maxRequestBodySize` on the server;
      // neither needs the header. A header that is present and over the cap is
      // still refused, because then the read can be skipped entirely.
      const contentLength = request.headers.get('Content-Length');
      if (
        contentLength !== null &&
        contentLength !== '' &&
        (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)
      ) {
        return reject(400, 'invalid Content-Length', deliveryId);
      }

      const timestamp = request.headers.get('X-Avada-Timestamp');
      const signature = request.headers.get('X-Avada-Signature');
      if (deliveryId === null || deliveryId === '') {
        return reject(401, 'missing delivery id', deliveryId);
      }
      if (timestamp === null || timestamp === '') {
        return reject(401, 'missing timestamp', deliveryId);
      }
      if (signature === null || signature === '') {
        return reject(401, 'missing signature', deliveryId);
      }
      if (!isFresh(timestamp, now())) {
        return reject(401, 'stale timestamp', deliveryId);
      }

      const rawBody = await request.text();
      if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
        return reject(400, 'body exceeds 64 KB', deliveryId);
      }
      if (!verifySignature(secret, timestamp, rawBody, signature)) {
        return reject(401, 'invalid signature', deliveryId);
      }

      let body: WebhookBody;
      try {
        body = JSON.parse(rawBody) as WebhookBody;
      } catch {
        return reject(400, 'malformed JSON', deliveryId);
      }
      const ticketId = body.ticket?.id;
      if (typeof ticketId !== 'string' || ticketId === '') {
        return reject(400, 'missing ticket id', deliveryId);
      }
      const loggedDelivery = sanitizeForLog(deliveryId);
      const loggedTicket = sanitizeForLog(ticketId);

      if (request.headers.get('X-Avada-Event') === 'ticket.test') {
        console.log(`[webhook] accepted test delivery ${loggedDelivery} for ticket ${loggedTicket}`);
        return json({ accepted: true }, 202);
      }

      // Keyed on the signed body, never on the unsigned header.
      const key = deliveryKey(body.deliveryId, rawBody);
      const createdAt = typeof body.ticket?.createdAt === 'string' ? body.ticket.createdAt : null;
      const pullId = reserveDelivery(key, ticketId, createdAt);
      if (pullId === null) {
        console.log(`[webhook] duplicate delivery ${loggedDelivery} for ticket ${loggedTicket}`);
        return json({ duplicate: true });
      }

      console.log(`[webhook] accepted delivery ${loggedDelivery} for ticket ${loggedTicket}`);
      void webhooks.process(pullId, ticketId, createdAt).catch(() => undefined);
      return json({ accepted: true }, 202);
    } catch (cause) {
      // The cause stays out of the response and goes to the log instead: this
      // is the one route nobody can reproduce by hand, so an operator with no
      // reason has nothing to work from.
      console.error(
        `[webhook] delivery ${sanitizeForLog(deliveryId)} failed internally:`,
        cause instanceof Error ? cause.message : String(cause)
      );
      return json({ error: 'internal_error' }, 500);
    }
  };
}
