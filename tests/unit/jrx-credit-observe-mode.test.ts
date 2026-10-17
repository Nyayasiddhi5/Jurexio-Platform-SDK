/**
 * NV-CREDIT-OBSERVE-001 — observe mode on the newly-added pre-spend caps
 *
 * Two properties this suite exists to keep true:
 *
 *  1. The 40 caps added by NV-CREDIT-UNIVERSAL-001 default to RECORD-ONLY. They run
 *     the enforcer, log the arithmetic of the refusal they would have made, and let
 *     the request through. Their budgets have never been compared to real traffic —
 *     the counter behind them was never written — so refusing on day one would
 *     refuse lawful partner work against unvalidated numbers.
 *  2. Observe mode is scoped to those caps ONLY. The pre-existing inline enforcement
 *     on `/orchestrate`, `/orchestrate/stream`, `/legal-chat/send` and
 *     `/completions` must keep refusing. Silently converting live enforced surfaces
 *     to observe mode would REDUCE safety.
 *
 * DESIGN NOTE — the recorder is not mocked away. Observe mode is only worth
 * anything if recording stays live: observing a counter that nothing increments
 * reproduces the original defect and calls it caution. So the real
 * `nvRequestUsageContext` + `recordLlmUsage` + finish-hook recorder run here, and a
 * test asserts that an observed (admitted) request still records.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const enforceMock = vi.fn();
const recordMock = vi.fn();
const warnMock = vi.fn();

vi.mock('../../src/services/jrx-ai-credit-enforcer.js', () => ({
  nvAICreditEnforcer: {
    enforce: (...a: unknown[]) => enforceMock(...a),
    record: (...a: unknown[]) => recordMock(...a),
  },
}));

/* `creditRecord` defaults OFF in test, which would make the "observe mode still
 * records" assertion vacuously pass. Forced ON so the recording leg runs. */
vi.mock('../../src/config/jrx-feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isJrxFeatureOn: (flag: string) => flag === 'creditRecord',
}));

vi.mock('../../src/db/index.js', () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

/* Capture the observe log line. Only the observe module's logger is intercepted, so
 * a line emitted from anywhere else cannot satisfy the assertions below. */
vi.mock('../../src/utils/logger.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const createLogger = actual.createLogger as (n: string) => Record<string, unknown>;
  return {
    ...actual,
    createLogger: (name: string) => {
      const real = createLogger(name);
      if (name !== './jrx-credit-cap-observe') return real;
      return { ...real, warn: (...a: unknown[]) => warnMock(...a) };
    },
  };
});

const { nvAiCreditCap } = await import('../../src/middleware/jrx-ai-credit-cap-middleware.js');
const { nvRequestUsageContext, recordLlmUsage } = await import(
  '../../src/utils/jrx-request-usage-context.js'
);
const { nvUsageMetering } = await import('../../src/middleware/jrx-usage-metering-middleware.js');
const { resolveCreditCapMode, buildCreditCapObserveRecord, CREDIT_CAP_OBSERVE_MARKER } =
  await import('../../src/middleware/jrx-credit-cap-observe.js');

const DENY_TOKENS = {
  allowed: false,
  reason: 'Daily token budget exceeded. Used: 800,000, Limit: 800,000.',
  budgetLimit: 800_000,
  usedToday: 799_000,
  remainingToday: 1_000,
  tier: 'pro',
  limit: 'daily_tokens' as const,
  retryAfterSeconds: 1234,
};

function buildApp(capOptions: Parameters<typeof nvAiCreditCap>[0] = { agentKey: 'test:analyze' }) {
  const app = express();
  app.use(express.json());
  app.use(nvRequestUsageContext);
  app.use(nvUsageMetering);
  app.use((req, _res, next) => {
    (req as unknown as { nvSdk?: unknown }).nvSdk = {
      appId: '42', orgId: 'org-nsp', appName: 'nsp', tier: 'pro',
      apiKeyId: 'key_abc123', requiresSigning: false, traceId: 't-1', requestStartMs: Date.now(),
    };
    next();
  });
  app.post('/ai/analyze', nvAiCreditCap(capOptions), (_req, res) => {
    recordLlmUsage({ tokensIn: 1_000, tokensOut: 500, costUsd: 0.02, model: 'gpt-4o', provider: 'openai' });
    res.json({ success: true });
  });
  return app;
}

async function post(app: express.Express, body: unknown, headers: Record<string, string> = {}) {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ai/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    await new Promise((r) => setTimeout(r, 30));
    return { status: res.status, body: json as Record<string, any> | null };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const SAVED = { ...process.env };
beforeEach(() => {
  enforceMock.mockReset();
  recordMock.mockReset();
  warnMock.mockReset();
  recordMock.mockResolvedValue(undefined);
  delete process.env.JRX_CREDIT_CAP_MODE;
  delete process.env.JRX_CREDIT_ENFORCE;
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe('NV-CREDIT-OBSERVE-001 — the switch', () => {
  it('defaults to observe, so a deploy that sets nothing cannot start refusing', () => {
    expect(resolveCreditCapMode()).toBe('observe');
  });

  it('flips to enforce only on an explicit opt-in', () => {
    process.env.JRX_CREDIT_CAP_MODE = 'enforce';
    expect(resolveCreditCapMode()).toBe('enforce');
    process.env.JRX_CREDIT_CAP_MODE = '1';
    expect(resolveCreditCapMode()).toBe('enforce');
  });

  it('treats an unrecognised value as observe rather than guessing', () => {
    process.env.JRX_CREDIT_CAP_MODE = 'yolo';
    expect(resolveCreditCapMode()).toBe('observe');
  });

  it('honours the pre-existing global escape: JRX_CREDIT_ENFORCE=0 beats enforce', () => {
    /* An operator who switched credit enforcement off entirely has not asked these
     * caps to refuse either. The narrower flag must not re-enable what the global
     * kill switch turned off. */
    process.env.JRX_CREDIT_CAP_MODE = 'enforce';
    process.env.JRX_CREDIT_ENFORCE = '0';
    expect(resolveCreditCapMode()).toBe('observe');
  });
});

describe('NV-CREDIT-OBSERVE-001 — behaviour of an observed cap', () => {
  it('admits a request the cap would have refused', async () => {
    enforceMock.mockResolvedValue(DENY_TOKENS);
    const res = await post(buildApp(), { prompt: 'draft a plaint' });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    // The enforcer still ran — observe mode is not "skip the check".
    expect(enforceMock).toHaveBeenCalledTimes(1);
  });

  it('STILL RECORDS the spend of an admitted request', async () => {
    /* The load-bearing property. Without recording, the observation is of a counter
     * that stays 0 — which is the exact defect this whole change fixes. */
    enforceMock.mockResolvedValue(DENY_TOKENS);
    await post(buildApp(), { prompt: 'draft a plaint' });

    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock.mock.calls[0][0].tokensUsed).toBe(1_500);
  });

  it('refuses once the flag is flipped to enforce', async () => {
    process.env.JRX_CREDIT_CAP_MODE = 'enforce';
    enforceMock.mockResolvedValue(DENY_TOKENS);
    const res = await post(buildApp(), { prompt: 'draft a plaint' });

    expect(res.status).toBe(429);
    expect(res.body?.error?.details?.code).toBe('CREDIT_CAP_EXCEEDED');
  });

  it('does not log a near-miss when the request was within budget', async () => {
    enforceMock.mockResolvedValue({
      allowed: true, budgetLimit: 800_000, usedToday: 10, remainingToday: 799_990, tier: 'pro',
    });
    const res = await post(buildApp(), { prompt: 'hello' });

    expect(res.status).toBe(200);
    expect(warnMock).not.toHaveBeenCalled();
  });
});

describe('NV-CREDIT-OBSERVE-001 — the log line', () => {
  it('carries key id, tier, surface, estimate, budget and the overage', async () => {
    enforceMock.mockResolvedValue(DENY_TOKENS);
    await post(buildApp({ agentKey: 'gateway:documents' }), { prompt: 'x'.repeat(8_000) });

    expect(warnMock).toHaveBeenCalledTimes(1);
    const [message, fields] = warnMock.mock.calls[0] as [string, Record<string, unknown>];

    expect(message).toContain(CREDIT_CAP_OBSERVE_MARKER);
    expect(message).toContain('would refuse');
    expect(fields.decision).toBe('would_refuse');
    expect(fields.mode).toBe('observe');
    expect(fields.surface).toBe('/ai/analyze');
    expect(fields.agentKey).toBe('gateway:documents');
    expect(fields.tier).toBe('pro');
    expect(fields.apiKeyId).toBe('key_abc123');
    expect(fields.appId).toBe('42');
    expect(fields.orgId).toBe('org-nsp');
    expect(fields.limit).toBe('daily_tokens');
    expect(fields.budgetLimit).toBe(800_000);
    expect(fields.usedToday).toBe(799_000);
    expect(Number(fields.estimatedTokens)).toBeGreaterThan(0);
    // usedToday 799,000 + estimate − budget 800,000. The estimate must be the one
    // the enforcer was actually given, or the overage is unusable for tuning.
    const estimate = Number(fields.estimatedTokens);
    expect(fields.overBy).toBe(799_000 + estimate - 800_000);
  });

  it('never echoes key material — NV-SECRETS-001', async () => {
    enforceMock.mockResolvedValue(DENY_TOKENS);
    await post(buildApp(), { prompt: 'x' }, { 'x-api-key': 'nyv_live_SUPERSECRET' });

    const serialised = JSON.stringify(warnMock.mock.calls);
    expect(serialised).not.toContain('SUPERSECRET');
    expect(serialised).not.toContain('x-api-key');
  });

  it('logs the same marker in enforce mode, so a near-miss count does not reset on the flip', async () => {
    process.env.JRX_CREDIT_CAP_MODE = 'enforce';
    enforceMock.mockResolvedValue(DENY_TOKENS);
    await post(buildApp(), { prompt: 'x' });

    expect(warnMock).toHaveBeenCalledTimes(1);
    const [message, fields] = warnMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain(CREDIT_CAP_OBSERVE_MARKER);
    expect(fields.mode).toBe('enforce');
  });

  it('reports the overage in the units of the limit that actually tripped', () => {
    /* Token overage and request-count overage are different quantities; summing them
     * into one `overBy` would make the aggregate meaningless. */
    const hourly = buildCreditCapObserveRecord(
      {
        surface: '/s', agentKey: 'a', estimatedTokens: 5_000,
        subject: { userId: 'u', tier: 'pro' },
        check: {
          allowed: false, budgetLimit: 800_000, usedToday: 10, remainingToday: 1, tier: 'pro',
          limit: 'hourly_requests', hourlyRequests: 503, hourlyLimit: 500,
        },
      },
      'observe',
    );
    expect(hourly.limit).toBe('hourly_requests');
    expect(hourly.overBy).toBe(4);

    const cost = buildCreditCapObserveRecord(
      {
        surface: '/s', agentKey: 'a', estimatedTokens: 0, estimatedCostMicroUsd: 500,
        subject: { userId: 'u', tier: 'pro' },
        check: {
          allowed: false, budgetLimit: 800_000, usedToday: 0, remainingToday: 800_000, tier: 'pro',
          limit: 'daily_cost', costBudgetMicroUsd: 3_800_000, costUsedTodayMicroUsd: 3_800_000,
        },
      },
      'observe',
    );
    expect(cost.limit).toBe('daily_cost');
    expect(cost.overBy).toBe(500);
  });
});
