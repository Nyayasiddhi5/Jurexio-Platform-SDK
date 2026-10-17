import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from '../../src/utils/verifyWebhookSignature.js';

describe('verifyWebhookSignature', () => {
  const secret = 'nyv_wh_testsecret';
  const rawBody = JSON.stringify({ event: 'orchestration.completed', ok: true });
  const timestamp = new Date().toISOString();

  function sign(ts: string, body: string): string {
    return 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  }

  it('accepts a valid signature', () => {
    expect(
      verifyWebhookSignature({
        rawBody,
        signature: sign(timestamp, rawBody),
        timestamp,
        secret,
      }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(
      verifyWebhookSignature({
        rawBody: rawBody + 'x',
        signature: sign(timestamp, rawBody),
        timestamp,
        secret,
      }),
    ).toBe(false);
  });

  it('rejects stale timestamps when skew enforced', () => {
    const old = new Date(Date.now() - 600_000).toISOString();
    expect(
      verifyWebhookSignature({
        rawBody,
        signature: sign(old, rawBody),
        timestamp: old,
        secret,
        maxSkewSeconds: 60,
      }),
    ).toBe(false);
  });
});
