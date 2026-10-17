/**
 * NV-CREDIT-COST-DIM-001 — a money dimension for the non-token paid surfaces
 *
 * Embeddings, STT, TTS and off-ring vision/OCR spend real money and consume zero
 * chat tokens. `ai_credit_usage.tokens_used` — the number the daily token budget
 * compares against — is the wrong unit for a per-audio-second or per-page bill, so
 * before this change those surfaces were outside the enforcer's model entirely.
 *
 * Three properties this suite keeps true:
 *
 *  1. The dimension ACCUMULATES for a non-token surface. `recordAuxSpend` adds to
 *     `costUsd` (never to token counts, which would corrupt the token budget), and
 *     the response-finish recorder writes a row for cost-only spend. The old
 *     `tokensUsed <= 0` early return silently discarded every such call, which would
 *     have left the cost budget reading a counter nothing writes — the original
 *     no-op defect in a new unit.
 *  2. Unmeasurable quantities are reported as unmeasurable, priced at ZERO. A
 *     fabricated OCR page count or audio duration that refuses a lawful request is
 *     worse than no estimate; the recorder still captures the real cost afterwards.
 *  3. Cost-metered caps are in OBSERVE mode like every other newly-added cap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

vi.mock('../../src/config/jrx-feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isNyvFeatureOn: (flag: string) => flag === 'creditRecord',
}));

vi.mock('../../src/db/index.js', () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

const { estimateAuxCostMicroUsd, NV_AUX_RATES } = await import(
  '../../src/middleware/jrx-aux-cost-estimator.js'
);
const { nvAiCreditCap } = await import('../../src/middleware/jrx-ai-credit-cap-middleware.js');
const { nvRequestUsageContext, recordAuxSpend, getRequestUsage } = await import(
  '../../src/utils/jrx-request-usage-context.js'
);
const { nvUsageMetering } = await import('../../src/middleware/jrx-usage-metering-middleware.js');

const ALLOW = {
  allowed: true, budgetLimit: 800_000, usedToday: 0, remainingToday: 800_000, tier: 'pro',
  costBudgetMicroUsd: 3_800_000, costUsedTodayMicroUsd: 0, costRemainingMicroUsd: 3_800_000,
};

const SAVED = { ...process.env };
beforeEach(() => {
  enforceMock.mockReset();
  recordMock.mockReset();
  enforceMock.mockResolvedValue(ALLOW);
  recordMock.mockResolvedValue(undefined);
  delete process.env.NYV_CREDIT_CAP_MODE;
});
afterEach(() => {
  process.env = { ...SAVED };
});

function buildCostApp(opts: {
  capOptions: Parameters<typeof nvAiCreditCap>[0];
  spend?: { costUsd: number; driver: string; units?: number };
}) {
  const app = express();
  app.use(express.json());
  app.use(nvRequestUsageContext);
  app.use(nvUsageMetering);
  app.post('/aux/call', nvAiCreditCap(opts.capOptions), (_req, res) => {
    if (opts.spend) recordAuxSpend({ ...opts.spend, provider: 'openai' });
    res.json({ success: true });
  });
  return app;
}

async function post(app: express.Express, body: unknown) {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/aux/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    await new Promise((r) => setTimeout(r, 30));
    return { status: res.status, body: json as Record<string, any> | null };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe('NV-CREDIT-COST-DIM-001 — the cost drivers are the real billing units', () => {
  it('prices embeddings per 1k input tokens, not per token', () => {
    /* `defaultEmbeddingConfig.providers.openai.costPerToken` is 0.00002 applied PER
     * TOKEN, but text-embedding-3-small lists at $0.00002 per 1,000 tokens. Feeding
     * the per-token figure into a spend budget over-prices by 1,000× and would refuse
     * lawful work. */
    const est = estimateAuxCostMicroUsd({ driver: 'embedding_tokens', text: 'x'.repeat(4_000) });
    expect(est.measurable).toBe(true);
    expect(est.quantity).toBe(1_000);
    expect(est.microUsd).toBe(NV_AUX_RATES.embeddingMicroUsdPer1kTokens);
  });

  it('sums an array of documents, the shape the docs-pipeline route sends', () => {
    const est = estimateAuxCostMicroUsd({
      driver: 'embedding_tokens',
      text: ['a'.repeat(2_000), 'b'.repeat(2_000)],
    });
    expect(est.quantity).toBe(1_000);
  });

  it('prices STT per audio second, derived from decoded bytes', () => {
    // 64,000 bytes at the 32 kB/s compressed floor = 2 s.
    const audio = Buffer.alloc(64_000).toString('base64');
    const est = estimateAuxCostMicroUsd({ driver: 'stt_audio_seconds', audioBase64: audio });
    expect(est.measurable).toBe(true);
    expect(est.quantity).toBe(2);
    expect(est.microUsd).toBe(2 * NV_AUX_RATES.sttMicroUsdPerSecond);
  });

  it('prices TTS per character', () => {
    const est = estimateAuxCostMicroUsd({ driver: 'tts_characters', text: 'y'.repeat(1_000) });
    expect(est.quantity).toBe(1_000);
    expect(est.microUsd).toBe(1_000 * NV_AUX_RATES.ttsMicroUsdPerCharacter);
  });

  it('prices vision per inline image', () => {
    const est = estimateAuxCostMicroUsd({ driver: 'vision_images', images: 1 });
    expect(est.measurable).toBe(true);
    expect(est.microUsd).toBe(NV_AUX_RATES.visionMicroUsdPerImage);
  });
});

describe('NV-CREDIT-COST-DIM-001 — honest unmeasurability', () => {
  it('reports OCR page count as unmeasurable and prices it at zero, not at a guess', () => {
    const est = estimateAuxCostMicroUsd({ driver: 'ocr_pages' });
    expect(est.measurable).toBe(false);
    expect(est.microUsd).toBe(0);
    expect(est.unmeasurableReason).toMatch(/only known after/i);
  });

  it('reports remote audio as unmeasurable — nothing has been fetched or decoded', () => {
    const est = estimateAuxCostMicroUsd({
      driver: 'stt_audio_seconds',
      audioUrl: 'https://example.test/a.wav',
    });
    expect(est.measurable).toBe(false);
    expect(est.microUsd).toBe(0);
    expect(est.unmeasurableReason).toMatch(/URL/);
  });

  it('an unmeasurable estimate does not refuse a subject inside budget', async () => {
    /* The whole point of pricing at zero rather than guessing. */
    process.env.NYV_CREDIT_CAP_MODE = 'enforce';
    const app = buildCostApp({ capOptions: { agentKey: 'ocr', costDriver: 'ocr_pages' } });
    const res = await post(app, { document: 'no page count declared' });

    expect(res.status).toBe(200);
    expect(enforceMock.mock.calls[0][0].estimatedCostMicroUsd).toBe(0);
  });
});

describe('NV-CREDIT-COST-DIM-001 — accumulation and recording', () => {
  it('accumulates cost WITHOUT inventing tokens', () => {
    /* Writing a synthesised token count would corrupt `tokens_used`, the number the
     * daily TOKEN budget is measured against, and silently reprice three product
     * lines. */
    let seen: ReturnType<typeof getRequestUsage>;
    const app = express();
    app.use(express.json());
    app.use(nvRequestUsageContext);
    app.post('/aux/call', (_req, res) => {
      recordAuxSpend({ costUsd: 0.0021, driver: 'stt_audio_seconds', units: 21 });
      seen = getRequestUsage();
      res.json({ success: true });
    });
    return post(app, {}).then(() => {
      expect(seen?.promptTokens).toBe(0);
      expect(seen?.completionTokens).toBe(0);
      expect(seen?.costUsd).toBeCloseTo(0.0021, 8);
      expect(seen?.calls).toBe(1);
      expect(seen?.auxCostUsd).toBeCloseTo(0.0021, 8);
      expect(seen?.auxCalls).toBe(1);
      expect(seen?.auxUnits).toBe(21);
      expect(seen?.auxDriver).toBe('stt_audio_seconds');
    });
  });

  it('records a credit row for cost-only spend (zero tokens)', async () => {
    /* Regression guard for the recorder's old `tokensUsed <= 0` early return, which
     * dropped every non-token paid call and would have left the cost budget reading
     * a counter nothing writes. */
    const app = buildCostApp({
      capOptions: { agentKey: 'sdk:voice/transcribe', costDriver: 'stt_audio_seconds' },
      spend: { costUsd: 0.003, driver: 'stt_audio_seconds', units: 30 },
    });
    const res = await post(app, { audio: Buffer.alloc(32_000).toString('base64') });

    expect(res.status).toBe(200);
    expect(recordMock).toHaveBeenCalledTimes(1);
    const rec = recordMock.mock.calls[0][0];
    expect(rec.tokensUsed).toBe(0);
    expect(rec.costUsd).toBeCloseTo(0.003, 8);
    expect(rec.agentKey).toBe('/aux/call');
  });

  it('still records nothing when no provider was called at all', async () => {
    const app = buildCostApp({
      capOptions: { agentKey: 'sdk:voice/transcribe', costDriver: 'stt_audio_seconds' },
    });
    await post(app, { audio: Buffer.alloc(1_000).toString('base64') });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('a cost-metered cap does not also charge the token budget', async () => {
    /* Double-counting the same request in two units would make both budgets wrong. */
    const app = buildCostApp({
      capOptions: { agentKey: 'gateway:documents/embeddings', costDriver: 'embedding_tokens' },
    });
    await post(app, { texts: ['x'.repeat(40_000)] });

    const call = enforceMock.mock.calls[0][0];
    expect(call.estimatedTokens).toBe(0);
    expect(call.estimatedCostMicroUsd).toBeGreaterThan(0);
  });

  it('a token-metered cap does not send a cost estimate, so pre-existing behaviour is unchanged', async () => {
    const app = buildCostApp({ capOptions: { agentKey: 'gateway:documents' } });
    await post(app, { prompt: 'analyse this' });

    const call = enforceMock.mock.calls[0][0];
    expect(call.estimatedTokens).toBeGreaterThan(0);
    expect(call.estimatedCostMicroUsd).toBeUndefined();
  });
});

describe('NV-CREDIT-COST-DIM-001 — the enforcer carries the second dimension', () => {
  it('cost-metered caps observe by default, like every other newly-added cap', async () => {
    const app = buildCostApp({
      capOptions: { agentKey: 'sdk:voice/synthesize', costDriver: 'tts_characters' },
    });
    enforceMock.mockResolvedValue({
      allowed: false, reason: 'Daily AI cost budget exceeded.', budgetLimit: 800_000,
      usedToday: 0, remainingToday: 800_000, tier: 'pro', limit: 'daily_cost',
      costBudgetMicroUsd: 100, costUsedTodayMicroUsd: 100, costRemainingMicroUsd: 0,
    });
    const res = await post(app, { text: 'read this aloud' });

    expect(res.status).toBe(200);
  });
});
