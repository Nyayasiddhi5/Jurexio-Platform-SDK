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
});
