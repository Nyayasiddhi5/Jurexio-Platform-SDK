/**
 * NV-CREDIT-UNIVERSAL-001 — AI credit enforcement coverage
 *
 * Two defects this suite exists to keep closed:
 *
 *  1. Pre-spend caps existed on only `/orchestrate`, `/orchestrate/stream` and
 *     `/legal-chat/send`. ~110 further partner-reachable handlers reached a paid
 *     model call with no cap at all.
 *  2. More subtly, a pre-spend cap with no post-spend `record()` is a permanent
 *     no-op: `enforce()` admits on `getUsedToday()`, which sums
 *     `nv_schema.ai_credit_usage`, so with nothing writing that table `usedToday`
 *     stays 0 and neither the daily budget nor the hourly limit can ever trip.
 *     `/orchestrate/stream` was exactly that — it enforced a cap it could not fire.
 *
 * DESIGN NOTE — why the usage accumulator is NOT mocked.
 * On the legal-chat work a mutation survived green because the suite mocked
 * `orchestrate()`, so the *producing* half of the fix was unguarded. Here the real
 * `nvRequestUsageContext` middleware and the real `recordLlmUsage()` are used, and
 * spend is injected the way the router injects it. Only the enforcer's two
 * DB-facing methods are stubbed. So if the accumulator→recorder wiring breaks,
 * these tests go red rather than asserting against a mock of themselves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const enforceMock = vi.fn();
const recordMock = vi.fn();

vi.mock('../../src/services/jrx-ai-credit-enforcer.js', () => ({
  nvAICreditEnforcer: {
    enforce: (...a: unknown[]) => enforceMock(...a),
    record: (...a: unknown[]) => recordMock(...a),
  },
}));

/* `creditRecord` defaults OFF in test, which would make every post-spend
 * assertion below vacuously pass. Forced ON so the recording leg runs the way it
 * does in production. */
vi.mock('../../src/config/jrx-feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isNyvFeatureOn: (flag: string) => flag === 'creditRecord',
}));

/* The metering middleware's own `sdk_usage_metering` insert needs a DB. Stubbed to
 * a no-op so this suite tests credit accounting, not that unrelated writer. */
vi.mock('../../src/db/index.js', () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

const { nvAiCreditCap } = await import('../../src/middleware/jrx-ai-credit-cap-middleware.js');
const { nvRequestUsageContext, recordLlmUsage, getRequestUsage } = await import(
  '../../src/utils/jrx-request-usage-context.js'
);
const { nvUsageMetering } = await import('../../src/middleware/jrx-usage-metering-middleware.js');

interface Spend {
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  model?: string;
}

/**
 * Build a small app shaped like the real gateway: global usage context, global
 * metering (which carries the post-spend recorder), then a capped route whose
 * handler "spends" by calling the real recordLlmUsage().
 */
function buildApp(opts: {
  spend?: Spend | null;
  capOptions?: Parameters<typeof nvAiCreditCap>[0];
  user?: Record<string, unknown>;
  onOrder?: (event: string) => void;
} = {}) {
  const app = express();
  app.use(express.json());
  app.use(nvRequestUsageContext);
  app.use(nvUsageMetering);
  if (opts.user) {
    app.use((req, _res, next) => {
      (req as unknown as { user?: unknown }).user = opts.user;
      next();
    });
  }
  app.post(
    '/ai/analyze',
    nvAiCreditCap(opts.capOptions ?? { agentKey: 'test:analyze' }),
    (_req, res) => {
      opts.onOrder?.('model-called');
      if (opts.spend) {
        recordLlmUsage({
          tokensIn: opts.spend.tokensIn ?? 0,
          tokensOut: opts.spend.tokensOut ?? 0,
          costUsd: opts.spend.costUsd ?? 0,
          model: opts.spend.model ?? 'gpt-4o',
          provider: 'openai',
        });
      }
      res.json({ success: true });
    },
  );
  return app;
}

async function post(app: express.Express, path: string, body: unknown, headers: Record<string, string> = {}) {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    // The recorder runs on the response 'finish' event, which fires after fetch
    // resolves. Yield so the assertions see it.
    await new Promise((r) => setTimeout(r, 30));
    return { status: res.status, body: json as Record<string, any> | null };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const ALLOW = {
  allowed: true,
  budgetLimit: 800_000,
  usedToday: 10,
  remainingToday: 799_990,
  tier: 'pro',
};
const DENY = {
  allowed: false,
  reason: 'Daily token budget exceeded. Used: 800,000, Limit: 800,000.',
  budgetLimit: 800_000,
  usedToday: 800_000,
  remainingToday: 0,
  tier: 'pro',
  retryAfterSeconds: 1234,
};

beforeEach(() => {
  enforceMock.mockReset();
  recordMock.mockReset();
  enforceMock.mockResolvedValue(ALLOW);
  recordMock.mockResolvedValue(undefined);
  delete process.env.NYV_CREDIT_CAP_MODE;
});

describe('NV-CREDIT-UNIVERSAL-001 — pre-spend cap', () => {
  it('enforces BEFORE the model is called, not after', async () => {
    const order: string[] = [];
    enforceMock.mockImplementation(async () => {
      order.push('enforce');
      return ALLOW;
    });
    const app = buildApp({ spend: { tokensIn: 100, tokensOut: 50 }, onOrder: (e) => order.push(e) });
    const res = await post(app, '/ai/analyze', { prompt: 'is this contract enforceable?' });

    expect(res.status).toBe(200);
    expect(order).toEqual(['enforce', 'model-called']);
  });

  it('refuses a cap breach with CREDIT_CAP_EXCEEDED and never calls the model', async () => {
    /* NV-CREDIT-OBSERVE-001: these caps default to observe, so the refusal contract
     * is asserted with the mode explicitly set to enforce. Observe-mode behaviour
     * (admit + log) is pinned separately in `nv-credit-observe-mode.test.ts`; the
     * contract itself must stay pinned here so flipping the flag on in production
     * cannot ship a refusal shape a partner has never seen. */
    process.env.NYV_CREDIT_CAP_MODE = 'enforce';
    const order: string[] = [];
    enforceMock.mockResolvedValue(DENY);
    const app = buildApp({ spend: { tokensIn: 100, tokensOut: 50 }, onOrder: (e) => order.push(e) });
    const res = await post(app, '/ai/analyze', { prompt: 'draft a plaint' });

    expect(res.status).toBe(429);
    /* Same envelope `/api/jrx/orchestrate` returns: catalog code RATE_LIMIT_EXCEEDED
     * on the outer error, business code CREDIT_CAP_EXCEEDED in `error.details`. A
     * partner branches on one shape across every capped surface. */
    expect(res.body?.error?.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(res.body?.error?.details?.code).toBe('CREDIT_CAP_EXCEEDED');
    expect(res.body?.error?.details?.retryAfterSeconds).toBe(1234);
    expect(res.body?.error?.details?.remainingToday).toBe(0);
    // The whole point of a PRE-spend cap: no model call happened.
    expect(order).not.toContain('model-called');
  });

  it('matches /orchestrate fail-soft: an enforcer that throws does not block the answer', async () => {
    enforceMock.mockRejectedValue(new Error('relation "ai_credit_usage" does not exist'));
    const app = buildApp({ spend: { tokensIn: 100, tokensOut: 50 } });
    const res = await post(app, '/ai/analyze', { prompt: 'section 138 NI Act' });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
  });

  it('prices the attached document, not just the instruction', async () => {
    const app = buildApp({ spend: { tokensIn: 10, tokensOut: 10 } });
    await post(app, '/ai/analyze', { prompt: 'summarise' });
    const smallEstimate = enforceMock.mock.calls[0][0].estimatedTokens;

    enforceMock.mockClear();
    await post(app, '/ai/analyze', { prompt: 'summarise', documentText: 'x'.repeat(60_000) });
    const largeEstimate = enforceMock.mock.calls[0][0].estimatedTokens;

    // A 60 KB attachment must dominate: estimating on the bare instruction is
    // what waves a document past a cap it exceeds.
    expect(largeEstimate).toBeGreaterThan(smallEstimate + 10_000);
  });

  it('prices the prompt fields, not arbitrary payload bloat', async () => {
    /* Discriminates the named-key extraction from the whole-body fallback. A
     * caller that attaches unrelated metadata has not asked us to send it to a
     * model, so it must not consume their budget. Without this, a mutation that
     * deletes the named-key scan survives green, because the `chars === 0`
     * fallback happens to re-price the same document.
     *
     * Sized at 60 KB, under express.json()'s 100 KB default: at 200 KB the request
     * is rejected 413 before the middleware runs, so the assertion passed on a
     * request that never reached the code under test. */
    const app = buildApp({ spend: { tokensIn: 10, tokensOut: 10 } });
    const res = await post(app, '/ai/analyze', {
      prompt: 'short question',
      auditTrail: 'y'.repeat(60_000),
    });
    expect(res.status).toBe(200);
    expect(enforceMock).toHaveBeenCalledTimes(1);
    const estimate = enforceMock.mock.calls[0][0].estimatedTokens;
    const allowance = 4_096;
    expect(estimate).toBeLessThan(allowance + 1_000);
  });

  it('passes bypassCaps so NSP/NYM demo-unlimited traffic is unaffected', async () => {
    const app = buildApp({ spend: { tokensIn: 10, tokensOut: 10 } });
    await post(app, '/ai/analyze', { prompt: 'hello' }, {
      'x-nyv-platform': 'nsp',
      'x-nyv-consent': 'granted',
    });
    expect(enforceMock.mock.calls[0][0].bypassCaps).toBe(true);
  });

  it('does not claim bypass for an ordinary caller', async () => {
    const app = buildApp({ spend: { tokensIn: 10, tokensOut: 10 } });
    await post(app, '/ai/analyze', { prompt: 'hello' });
    expect(enforceMock.mock.calls[0][0].bypassCaps).toBe(false);
  });
});

describe('NV-CREDIT-UNIVERSAL-001 — post-spend recording (what makes the cap real)', () => {
  it('records the request spend so getUsedToday() can ever be non-zero', async () => {
    const app = buildApp({ spend: { tokensIn: 1_200, tokensOut: 800, costUsd: 0.031, model: 'claude-sonnet-4' } });
    const res = await post(app, '/ai/analyze', { prompt: 'analyse this' });

    expect(res.status).toBe(200);
    expect(recordMock).toHaveBeenCalledTimes(1);
    const rec = recordMock.mock.calls[0][0];
    expect(rec.tokensUsed).toBe(2_000);
    expect(rec.costUsd).toBeCloseTo(0.031, 6);
    expect(rec.model).toBe('claude-sonnet-4');
    expect(rec.agentKey).toBe('/ai/analyze');
  });

  it('records nothing when no model was called — a free read must not consume budget', async () => {
    const app = buildApp({ spend: null });
    const res = await post(app, '/ai/analyze', { prompt: 'deterministic path' });

    expect(res.status).toBe(200);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('bills a request exactly once when a route-level recorder already claimed it', async () => {
    // Mirrors /orchestrate and /legal-chat/send, which record inline. Double
    // billing a customer is worse than the under-billing this backstop fixes.
    const app = express();
    app.use(express.json());
    app.use(nvRequestUsageContext);
    app.use(nvUsageMetering);
    app.post('/ai/analyze', nvAiCreditCap({ agentKey: 'test' }), async (_req, res) => {
      recordLlmUsage({ tokensIn: 500, tokensOut: 500, costUsd: 0.01, model: 'gpt-4o' });
      const { claimRequestUsageForBilling } = await import('../../src/utils/jrx-request-usage-context.js');
      const usage = getRequestUsage();
      if (claimRequestUsageForBilling(usage)) {
        const { nvAICreditEnforcer } = await import('../../src/services/jrx-ai-credit-enforcer.js');
        await nvAICreditEnforcer.record({
          userId: 'u1', tier: 'pro', tokensUsed: 1_000,
          agentKey: 'route-level', requestId: 'r1',
        });
      }
      res.json({ success: true });
    });

    await post(app, '/ai/analyze', { prompt: 'x' });

    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock.mock.calls[0][0].agentKey).toBe('route-level');
  });

  it('attributes partner SDK spend to the application, not a shared anon bucket', async () => {
    const app = express();
    app.use(express.json());
    app.use(nvRequestUsageContext);
    app.use(nvUsageMetering);
    app.use((req, _res, next) => {
      (req as unknown as { nvSdk?: unknown }).nvSdk = {
        appId: '42', orgId: 'org-nsp', appName: 'nsp', tier: 'pro',
        apiKeyId: 'k1', requiresSigning: false, traceId: 'trace-9', requestStartMs: Date.now(),
      };
      next();
    });
    app.post('/ai/analyze', nvAiCreditCap({ agentKey: 'test' }), (_req, res) => {
      recordLlmUsage({ tokensIn: 300, tokensOut: 200, costUsd: 0.005, model: 'gpt-4o' });
      res.json({ success: true });
    });

    await post(app, '/ai/analyze', { prompt: 'x' });

    const rec = recordMock.mock.calls[0][0];
    expect(rec.userId).toBe('sdk_app_42');
    expect(rec.orgId).toBe('org-nsp');
    expect(rec.requestId).toBe('trace-9');
  });

  it('prefers the JWT user over the SDK application when both are present', async () => {
    const app = buildApp({
      spend: { tokensIn: 100, tokensOut: 100 },
      user: { id: 'user-7', organizationId: 'org-7', tier: 'plus' },
    });
    await post(app, '/ai/analyze', { prompt: 'x' });

    const rec = recordMock.mock.calls[0][0];
    expect(rec.userId).toBe('user-7');
    expect(rec.tier).toBe('plus');
  });

  it('is fail-soft: a record() rejection does not affect the response', async () => {
    recordMock.mockRejectedValue(new Error('credit table missing'));
    const app = buildApp({ spend: { tokensIn: 100, tokensOut: 100 } });
    const res = await post(app, '/ai/analyze', { prompt: 'x' });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
  });

  it('is fail-soft at the unit boundary: a synchronous enforcer throw is swallowed', async () => {
    /* Asserted directly rather than over HTTP on purpose. Over HTTP the metering
     * middleware's own try/catch is a second net, so the recorder losing its
     * try/catch cannot be observed from the response — the property is real but
     * unfalsifiable at that layer, and a test that cannot fail is not a test. */
    const { recordRequestAiCredit } = await import('../../src/middleware/jrx-credit-usage-recorder.js');
    recordMock.mockImplementation(() => {
      throw new Error('synchronous enforcer failure');
    });
    const usage = {
      promptTokens: 100, completionTokens: 100, costUsd: 0.01, calls: 1,
      wastedPromptTokens: 0, wastedCompletionTokens: 0, wastedCostUsd: 0, wastedCalls: 0,
    };
    const req = { path: '/ai/analyze', headers: {}, method: 'POST' } as never;
    const res = { getHeader: () => undefined } as never;

    expect(() => recordRequestAiCredit(req, res, usage)).not.toThrow();
  });
});

describe('NV-CREDIT-UNIVERSAL-001 — the billing claim', () => {
  it('grants the claim when there is no request accumulator', async () => {
    /* Off-request spend — a worker, a cron sweep, an EDJ job — runs with no
     * AsyncLocalStorage accumulator. Refusing the claim there would silently stop
     * that spend from ever being recorded, which is the original no-op defect in a
     * different costume: the response-finish backstop reads the same object, so
     * with nothing to mark there is nothing that could double-bill. */
    const { claimRequestUsageForBilling } = await import('../../src/utils/jrx-request-usage-context.js');
    expect(claimRequestUsageForBilling(undefined)).toBe(true);
  });

  it('grants the claim once, then refuses', async () => {
    const { claimRequestUsageForBilling } = await import('../../src/utils/jrx-request-usage-context.js');
    const acc = {
      promptTokens: 0, completionTokens: 0, costUsd: 0, calls: 0,
      wastedPromptTokens: 0, wastedCompletionTokens: 0, wastedCostUsd: 0, wastedCalls: 0,
    };
    expect(claimRequestUsageForBilling(acc)).toBe(true);
    expect(claimRequestUsageForBilling(acc)).toBe(false);
    expect(claimRequestUsageForBilling(acc)).toBe(false);
  });
});
