/**
 * Webhook Dispatcher — durable, signed, retried, DLQ-backed.
 * Replaces ad-hoc fetch() webhook calls in services that need at-least-once
 * delivery to platform partners.
 *
 * Usage from any service:
 *   await dispatchWebhook({ appId, platform, url, event, payload, secret });
 *
 * Worker is started by startQueueWorkers() (src/services/queue/queue-workers.ts).
 */

import crypto from 'node:crypto';
import net from 'node:net';
import { enqueueWebhook, type WebhookDeliveryJob } from './bullmq-queue.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('webhook-dispatcher');

/* ---------- SSRF guard ---------- */

const PRIVATE_V4 = [
  /^10\./, /^127\./, /^169\.254\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

function isPrivateHost(host: string): boolean {
  // Block obvious metadata + literal IPv6 loopback / link-local
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  if (net.isIPv4(host) && PRIVATE_V4.some((re) => re.test(host))) return true;
  // Hostname blocklist (DNS rebinding still possible — operators must also use egress firewall)
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) return true;
  if (lower === 'metadata.google.internal' || lower === 'metadata.azure.internal') return true;
  return false;
}

function assertPublicWebhookUrl(rawUrl: string) {
  // explicit allowlist override for testing only
  if (process.env.NYV_WEBHOOK_ALLOW_PRIVATE === 'true') return;
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error(`webhook url invalid: ${rawUrl}`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error(`webhook url must be http/https (got ${u.protocol})`);
  }
  if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') {
    throw new Error('webhook url must use https in production');
  }
  if (isPrivateHost(u.hostname)) {
    throw new Error(`webhook url targets private/internal host: ${u.hostname}`);
  }
}

export async function dispatchWebhook(j: WebhookDeliveryJob): Promise<{ jobId: string }> {
  if (!j.url || !j.event || !j.secret) {
    throw new Error('dispatchWebhook: url, event, secret are required');
  }
  assertPublicWebhookUrl(j.url);
  const job = await enqueueWebhook(j);
  logger.info('webhook queued', { appId: j.appId, event: j.event, jobId: job.id });
  return { jobId: job.id! };
}

/**
 * Canonical X-NYV-Signature header. Format: `sha256=<hex>` over `${ts}.${body}`
 * — the timestamp is in `X-NYV-Timestamp` and prevents replay.
 */
export function signWebhookBody(rawBody: string, secret: string, timestamp: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/** Worker handler — exported so queue-workers.ts can register it. */
export async function handleWebhookDelivery(data: WebhookDeliveryJob): Promise<{ status: number }> {
  // Re-validate at delivery time — secret/URL could have rotated since enqueue.
  assertPublicWebhookUrl(data.url);

  const ts = new Date().toISOString();
  const body = JSON.stringify({
    event: data.event,
    appId: data.appId,
    platform: data.platform,
    correlationId: data.correlationId,
    payload: data.payload,
    ts,
  });
  const sig = signWebhookBody(body, data.secret, ts);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(data.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Jurexio-Webhook/5.0.0',
        'X-NYV-Event': data.event,
        'X-NYV-Platform': data.platform,
        'X-NYV-Timestamp': ts,
        'X-NYV-Signature': sig,
        'X-NYV-Correlation-Id': data.correlationId ?? '',
      },
      body,
      signal: ctrl.signal,
      redirect: 'manual', // do not follow redirects — defends against SSRF via 30x to internal IPs
    });
    if (res.status >= 200 && res.status < 300) {
      logger.debug('webhook delivered', { appId: data.appId, event: data.event, status: res.status });
      return { status: res.status };
    }
    // 4xx: do not retry forever (BullMQ attempts handles back-off; we throw to retry)
    // 5xx: retry
    throw new Error(`webhook responded ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}
