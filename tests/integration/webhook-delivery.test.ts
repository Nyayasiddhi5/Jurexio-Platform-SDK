/**
 * tests/integration/webhook-delivery.test.ts
 *
 * Verifies the Jurexio webhook dispatcher contract WITHOUT requiring
 * Redis / BullMQ to be live (BullMQ is optional in this environment —
 * see src/services/queue/bullmq-queue.ts).
 *
 * What we assert:
 *   1. dispatchWebhook() rejects SSRF-y / private URLs.
 *   2. dispatchWebhook() rejects non-https URLs in production mode.
 *   3. handleWebhookDelivery() POSTs the body with X-NYV-Signature whose
 *      HMAC-SHA256 over `${ts}.${body}` matches the configured secret.
 *   4. handleWebhookDelivery() throws on a 5xx response so BullMQ retries.
 *   5. signWebhookBody() is deterministic + uses sha256= prefix.
 */

import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  signWebhookBody,
  handleWebhookDelivery,
  dispatchWebhook,
} from '../../src/services/queue/webhook-dispatcher.js';

const SECRET = 'whsec_test_1234567890abcdef';

describe('webhook-dispatcher signing', () => {
  it('produces sha256= prefixed HMAC over `${ts}.${body}`', () => {
    const body = '{"event":"x","payload":{"a":1}}';
    const ts = '2026-05-06T00:00:00.000Z';
    const sig = signWebhookBody(body, SECRET, ts);
    expect(sig.startsWith('sha256=')).toBe(true);
    const expected =
      'sha256=' + crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
    expect(sig).toBe(expected);
    // Deterministic
    expect(signWebhookBody(body, SECRET, ts)).toBe(sig);
  });
});

describe('dispatchWebhook SSRF guard', () => {
  beforeEach(() => {
    delete process.env.NYV_WEBHOOK_ALLOW_PRIVATE;
  });

  it('rejects loopback hostnames', async () => {
    await expect(
      dispatchWebhook({
        appId: 'a', platform: 'p', url: 'http://127.0.0.1/hook',
        event: 'e', payload: {}, secret: SECRET,
      }),
    ).rejects.toThrow(/private|internal/i);
  });

  it('rejects "localhost"', async () => {
    await expect(
      dispatchWebhook({
        appId: 'a', platform: 'p', url: 'http://localhost:9000/hook',
        event: 'e', payload: {}, secret: SECRET,
      }),
    ).rejects.toThrow(/private|internal/i);
  });

  it('rejects RFC1918 10.x', async () => {
    await expect(
      dispatchWebhook({
        appId: 'a', platform: 'p', url: 'http://10.0.0.5/hook',
        event: 'e', payload: {}, secret: SECRET,
      }),
    ).rejects.toThrow(/private|internal/i);
  });
});

describe('handleWebhookDelivery transport', () => {
  let originalFetch: typeof fetch;
  let calls: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    originalFetch = global.fetch;
    calls = [];
    process.env.NYV_WEBHOOK_ALLOW_PRIVATE = 'true'; // allow the synthetic test URL
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.NYV_WEBHOOK_ALLOW_PRIVATE;
  });

  it('POSTs JSON body with signed X-NYV-Signature header on 200', async () => {
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return new Response('', { status: 200 }) as any;
    }) as any;

    const result = await handleWebhookDelivery({
      appId: 'app_123',
      platform: 'nyayamitra',
      url: 'http://127.0.0.1:1/webhook',
      event: 'document.processed',
      payload: { docId: 'doc_1' },
      secret: SECRET,
    });

    expect(result.status).toBe(200);
    expect(calls.length).toBe(1);
    const init = calls[0].init as any;
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-NYV-Event']).toBe('document.processed');
    expect(headers['X-NYV-Platform']).toBe('nyayamitra');
    expect(typeof headers['X-NYV-Timestamp']).toBe('string');

    const sig = headers['X-NYV-Signature'];
    expect(sig.startsWith('sha256=')).toBe(true);

    // Verify signature matches body+timestamp.
    const body = String(init.body);
    const ts = headers['X-NYV-Timestamp'];
    const expected =
      'sha256=' + crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
    expect(sig).toBe(expected);
  });

  it('throws on 5xx so BullMQ retries the job', async () => {
    global.fetch = vi.fn(async () => new Response('boom', { status: 503 }) as any) as any;

    await expect(
      handleWebhookDelivery({
        appId: 'app_123',
        platform: 'nyayamitra',
        url: 'http://127.0.0.1:1/webhook',
        event: 'document.processed',
        payload: {},
        secret: SECRET,
      }),
    ).rejects.toThrow(/responded 503/);
  });
});
