/**
 * Verify Jurexio webhook HMAC signatures.
 *
 * Canonical headers (see webhook-dispatcher):
 *   X-JRX-Timestamp: ISO-8601 timestamp
 *   X-JRX-Signature: sha256=<hex hmac of `${timestamp}.${rawBody}`>
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifyWebhookSignatureInput {
  /** Raw request body string (exact bytes as received). */
  rawBody: string;
  /** Value of X-JRX-Signature (with or without `sha256=` prefix). */
  signature: string;
  /** Value of X-JRX-Timestamp. */
  timestamp: string;
  /** Webhook secret (`nyv_wh_*`). */
  secret: string;
  /**
   * Reject timestamps older than this many seconds (replay protection).
   * Default 300 (5 minutes). Set 0 to skip skew check.
   */
  maxSkewSeconds?: number;
}

/**
 * Returns true when the signature matches and (optionally) the timestamp
 * is within the allowed skew window.
 */
export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
  const { rawBody, signature, timestamp, secret } = input;
  if (!rawBody || !signature || !timestamp || !secret) return false;

  const maxSkew = input.maxSkewSeconds ?? 300;
  if (maxSkew > 0) {
    const tsMs = Date.parse(timestamp);
    if (!Number.isFinite(tsMs)) return false;
    const skewSec = Math.abs(Date.now() - tsMs) / 1000;
    if (skewSec > maxSkew) return false;
  }

  const expected =
    'sha256=' +
    createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const provided = signature.startsWith('sha256=') ? signature : `sha256=${signature}`;

  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
