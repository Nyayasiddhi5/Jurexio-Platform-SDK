/**
 * Why did "orchestrate: post-spend claim+record removed" stay GREEN?
 *
 * Hypothesis A: no test covers the /orchestrate route's credit recording, so the
 *               mutation is simply unobserved (a real coverage gap).
 * Hypothesis B: the platform-wide response-finish backstop now records the same
 *               request, so removing the inline recorder loses nothing.
 *
 * Both can be true. This probe settles B by execution: with NO route claiming the
 * request, does the backstop write exactly one row with the real token total?
 * Positive control: with a route claiming, the backstop must NOT write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const recordMock = vi.fn();
vi.mock('../../src/services/jrx-ai-credit-enforcer.js', () => ({
  nvAICreditEnforcer: { enforce: vi.fn(), record: (...a: unknown[]) => recordMock(...a) },
}));
vi.mock('../../src/config/jrx-feature-flags.js', async (io) => ({
  ...(await io<Record<string, unknown>>()),
  isNyvFeatureOn: (f: string) => f === 'creditRecord',
}));
vi.mock('../../src/db/index.js', () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

const { nvRequestUsageContext, recordLlmUsage, claimRequestUsageForBilling, getRequestUsage } =
  await import('../../src/utils/jrx-request-usage-context.js');
const { nvUsageMetering } = await import('../../src/middleware/jrx-usage-metering-middleware.js');

async function drive(inlineRecorderPresent: boolean) {
  const app = express();
  app.use(express.json());
  app.use(nvRequestUsageContext);
  app.use(nvUsageMetering);
  app.post('/api/jrx/orchestrate', async (_req, res) => {
    recordLlmUsage({ tokensIn: 4_000, tokensOut: 2_000, costUsd: 0.12, model: 'gpt-4o' });
    if (inlineRecorderPresent) {
      if (claimRequestUsageForBilling(getRequestUsage())) {
        const { nvAICreditEnforcer } = await import('../../src/services/jrx-ai-credit-enforcer.js');
        await nvAICreditEnforcer.record({
          userId: 'u', tier: 'pro', tokensUsed: 6_000, agentKey: 'orchestrate', requestId: 'r',
        });
      }
    }
    res.json({ success: true });
  });
  const server: Server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const { port } = server.address() as AddressInfo;
  await fetch(`http://127.0.0.1:${port}/api/jrx/orchestrate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'x' }),
  });
  await new Promise((r) => setTimeout(r, 30));
  await new Promise((r) => server.close(r));
}

beforeEach(() => { recordMock.mockReset(); recordMock.mockResolvedValue(undefined); });

describe('NV-CREDIT-UNIVERSAL-001 — the backstop makes an inline recorder non-critical', () => {
  it('records the spend even when NO route-level recorder runs', async () => {
    await drive(false);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock.mock.calls[0][0].tokensUsed).toBe(6_000);
    expect(recordMock.mock.calls[0][0].agentKey).toBe('/api/jrx/orchestrate');
  });

  it('positive control — with an inline recorder it is billed once, by the route', async () => {
    await drive(true);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock.mock.calls[0][0].agentKey).toBe('orchestrate');
  });
});
