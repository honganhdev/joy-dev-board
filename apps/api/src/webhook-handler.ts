import { json } from './http';
import { isFresh, verifySignature } from './webhook-verify';
import type { WebhookProcessor } from './webhook-service';

const MAX_BODY_BYTES = 65_536;

export type WebhookHandlerDeps = {
  secret: string;
  reserveDelivery: (deliveryId: string) => number | null;
  webhooks: WebhookProcessor;
  now?: () => number;
};

type WebhookBody = {
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
    console.warn(`[webhook] rejected delivery ${deliveryId || '(missing)'}: ${reason}`);
    return json({ error: status === 401 ? 'unauthorized' : 'invalid_request' }, status);
  }

  return async function handleWebhook(request: Request): Promise<Response> {
    let deliveryId: string | null = null;
    try {
      deliveryId = request.headers.get('X-Avada-Delivery');
      const contentLength = request.headers.get('Content-Length');
      if (
        contentLength === null ||
        contentLength === '' ||
        !/^\d+$/.test(contentLength) ||
        Number(contentLength) > MAX_BODY_BYTES
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

      if (request.headers.get('X-Avada-Event') === 'ticket.test') {
        console.log(`[webhook] accepted test delivery ${deliveryId} for ticket ${ticketId}`);
        return json({ accepted: true }, 202);
      }

      const pullId = reserveDelivery(deliveryId);
      if (pullId === null) {
        console.log(`[webhook] duplicate delivery ${deliveryId} for ticket ${ticketId}`);
        return json({ duplicate: true });
      }

      console.log(`[webhook] accepted delivery ${deliveryId} for ticket ${ticketId}`);
      void webhooks.process(pullId, ticketId, body.ticket?.createdAt).catch(() => undefined);
      return json({ accepted: true }, 202);
    } catch {
      console.error(`[webhook] delivery ${deliveryId || '(missing)'} failed internally`);
      return json({ error: 'internal_error' }, 500);
    }
  };
}
