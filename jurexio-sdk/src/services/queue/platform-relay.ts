/**
 * Platform Relay — when one Jurexio platform requests work that should be
 * delivered asynchronously to another (e.g. JRX-INS triggers an audit ping
 * on JRX-MIN, or NYM acks a long-running brief back to the WhatsApp gateway),
 * the request is enqueued here so the producer never blocks and we never lose
 * the delivery.
 *
 * Guarantees:
 *  - At-least-once delivery (5 attempts, exponential back-off, DLQ).
 *  - Per-target idempotency via correlationId-based job key.
 *  - Strict 30 s upstream timeout per attempt.
 */

import { enqueuePlatformRelay, type PlatformRelayJob } from './bullmq-queue.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('platform-relay');

export async function relayToPlatform(j: PlatformRelayJob) {
  const job = await enqueuePlatformRelay(j, { jobId: j.correlationId });
  logger.info('relay queued', { platform: j.platform, endpoint: j.endpoint, correlationId: j.correlationId });
  return { jobId: job.id! };
}

export async function handlePlatformRelay(data: PlatformRelayJob): Promise<{ status: number; bytes: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(data.endpoint, {
      method: data.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${data.apiKey}`,
        'X-JRX-Platform': data.platform,
        'X-Correlation-ID': data.correlationId,
        ...(data.headers || {}),
      },
      body: data.body !== undefined ? JSON.stringify(data.body) : undefined,
      signal: ctrl.signal,
    });
    const buf = await res.arrayBuffer();
    if (res.status >= 200 && res.status < 300) {
      return { status: res.status, bytes: buf.byteLength };
    }
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`upstream ${res.status} (retryable)`);
    }
    // 4xx (non-429): permanent failure -> let it move to DLQ on final attempt
    throw new Error(`upstream ${res.status} (permanent)`);
  } finally {
    clearTimeout(timer);
  }
}
