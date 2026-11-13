import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from '../../src/utils/verifyWebhookSignature.js';

describe('verifyWebhookSignature', () => {
  const secret = 'nyv_wh_testsecret';
  const rawBody = JSON.stringify({ event: 'orchestration.completed', id: '1' });
  const timestamp = new Date().toISOString();
  const signature =
    'sha256=' +
    createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

  it('accepts a valid signature', () => {
    expect(
      verifyWebhookSignature({ rawBody, signature, timestamp, secret }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(
      verifyWebhookSignature({
        rawBody: rawBody + 'x',
        signature,
        timestamp,
        secret,
      }),
    ).toBe(false);
  });

  it('rejects a wrong secret', () => {
    expect(
      verifyWebhookSignature({
        rawBody,
        signature,
        timestamp,
        secret: 'wrong',
      }),
    ).toBe(false);
  });

  it('accepts signature without sha256= prefix', () => {
    const hex = signature.replace(/^sha256=/, '');
    expect(
      verifyWebhookSignature({ rawBody, signature: hex, timestamp, secret }),
    ).toBe(true);
  });

  it('rejects a timestamp outside the 5 minute replay window', () => {
    const stale = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const staleSignature =
      'sha256=' +
      createHmac('sha256', secret).update(`${stale}.${rawBody}`).digest('hex');
    expect(
      verifyWebhookSignature({
        rawBody,
        signature: staleSignature,
        timestamp: stale,
        secret,
      }),
    ).toBe(false);
  });

  it('rejects a numeric millisecond timestamp', () => {
    const numeric = String(Date.now());
    const numericSignature =
      'sha256=' +
      createHmac('sha256', secret).update(`${numeric}.${rawBody}`).digest('hex');
    expect(
      verifyWebhookSignature({
        rawBody,
        signature: numericSignature,
        timestamp: numeric,
        secret,
      }),
    ).toBe(false);
  });

  it('skips the replay window when maxSkewSeconds is 0', () => {
    const dayOld = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const dayOldSignature =
      'sha256=' +
      createHmac('sha256', secret).update(`${dayOld}.${rawBody}`).digest('hex');
    expect(
      verifyWebhookSignature({
        rawBody,
        signature: dayOldSignature,
        timestamp: dayOld,
        secret,
        maxSkewSeconds: 0,
      }),
    ).toBe(true);
  });

  it('rejects a missing secret', () => {
    expect(
      verifyWebhookSignature({
        rawBody,
        signature,
        timestamp,
        secret: '',
      }),
    ).toBe(false);
  });
});
