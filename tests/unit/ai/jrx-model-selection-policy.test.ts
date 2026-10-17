import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NV-COST-ROUTER-SSOT-001 + NV-MODEL-AVAIL-PROBE-001 regression suite.
 *
 * Two defects are locked in here:
 *
 * 1. `cost-aware-router.selectModel()` carried its OWN hardcoded eight-model
 *    catalog of 2024-era OpenRouter ids (`anthropic/claude-3-haiku`,
 *    `openai/gpt-4o`, `google/gemini-flash-1.5`, `mistralai/mistral-7b-instruct`,
 *    …) with hand-written prices. `nv-queen-orchestrator` calls it for EVERY
 *    Queen leaf, so leaf routing ignored live provider availability, breaker
 *    health, jurisdiction fit, task fit and real prices — and could name models
 *    this account cannot call at all.
 *
 * 2. `gemini-2.5-pro` / `gemini-2.5-flash` are dead on this account: the Gemini
 *    API returns 404 "no longer available to new users"
 *    (`scripts/_ec2-model-avail-probe.sh`, 2026-08-16). They appeared in the
 *    catalog, in `getGeminiCascadeModels()`, and in most curated fallback
 *    ladders, where a dead rung can only burn a hop plus the per-attempt timeout.
 */

// The scorer imports the SME-GRPO tie-breaker, which transitively pulls in the
// Redis URL resolver. That chain fails to resolve under vitest (it is only ever
// loaded through the compiled server entrypoint) and is irrelevant to model
// selection: the GRPO nudge is a bounded ±0.04 tie-breaker. Stub both so these
// tests exercise routing rather than Redis wiring.
vi.mock('../../../src/services/jrx-sme/jrx-sme-grpo-redis-queue.js', () => ({
  getEmaBoostSync: () => 0,
}));
vi.mock('../../../src/services/jrx-grpo-online-policy.js', () => ({
  resolveGrpoOnlineNudge: () => ({ source: 'none', preferFastModel: false, preferHighQuality: false }),
}));

// Provider availability is env-gated, so give the scorer a deterministic,
// key-free world: Google + Bedrock on, everything else off.
function setProviderEnv(): void {
  process.env.GEMINI_API_KEY = 'test-key-not-a-secret';
  process.env.NYV_BEDROCK_ENABLED = 'true';
  process.env.AWS_REGION = 'ap-south-1';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.XAI_API_KEY;
  delete process.env.GROK_API_KEY;
  delete process.env.TOGETHER_API_KEY;
  delete process.env.COHERE_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.SARVAM_API_KEY;
  delete process.env.NYV_SARVAM_API_KEY;
  delete process.env.OMNIROUTE_API_KEY;
}

describe('cost-aware-router — delegates to the evidence-based scorer (NV-COST-ROUTER-SSOT-001)', () => {
  beforeEach(() => {
    vi.resetModules();
    setProviderEnv();
  });

  it('never returns a model outside the real catalog', async () => {
    const { selectModel } = await import('../../../src/services/cost-aware-router.js');
    const { getModel } = await import('../../../src/services/intelligent-router/model-catalog.js');

    const prompts = [
      'What is anticipatory bail?',
      'Draft a petition for quashing under BNSS section 528 with limitation analysis.',
      'Summarise this contract clause.',
      'Constitutional validity of the amendment across multi-jurisdiction operations.',
    ];
    for (const p of prompts) {
      const d = selectModel(p, { domain: 'legal' });
      // The stale catalog's ids (e.g. openai/gpt-4o) are absent from the real
      // registry, so this assertion fails outright on a regression.
      expect(getModel(d.model), `${p} → ${d.model}`).toBeDefined();
    }
  });

  it('never selects a model whose provider is unconfigured', async () => {
    const { selectModel } = await import('../../../src/services/cost-aware-router.js');
    const { getModel, isProviderAvailable } = await import(
      '../../../src/services/intelligent-router/model-catalog.js'
    );

    const d = selectModel('Draft a bail application citing BNSS 482.', { domain: 'legal' });
    const entry = getModel(d.model);
    expect(entry).toBeDefined();
    expect(isProviderAvailable(entry!.provider)).toBe(true);
  });

  it('returns a usable ordered fallback ladder, not just a primary', async () => {
    const { selectModel } = await import('../../../src/services/cost-aware-router.js');
    const { getModel } = await import('../../../src/services/intelligent-router/model-catalog.js');

    const d = selectModel('Research precedent on PMLA attachment and limitation.', {
      domain: 'legal',
    });
    expect(d.fallbacks.length).toBeGreaterThan(0);
    // Every rung must be real and distinct from the primary — a dead or
    // duplicated rung wastes a hop plus the per-attempt timeout.
    const seen = new Set([d.model]);
    for (const f of d.fallbacks) {
      expect(getModel(f.model), f.model).toBeDefined();
      expect(seen.has(f.model), `duplicate rung ${f.model}`).toBe(false);
      seen.add(f.model);
    }
  });

  it('treats maxBudgetUSD as a hard cap, which is what demotes exploration leaves', async () => {
    const { selectModel } = await import('../../../src/services/cost-aware-router.js');
    const { getModel } = await import('../../../src/services/intelligent-router/model-catalog.js');

    const prompt = 'Analyse the interplay of BNSS 482 and PMLA section 5 for a client.';
    // The Queen passes 0.005 for exploration and 0.05 for synthesis.
    const explore = selectModel(prompt, { domain: 'legal', maxBudgetUSD: 0.005, expectedOutputTokens: 2_048 });
    const synth = selectModel(prompt, { domain: 'legal', maxBudgetUSD: 0.05, expectedOutputTokens: 8_192 });

    const em = getModel(explore.model)!;
    const sm = getModel(synth.model)!;
    expect(em).toBeDefined();
    expect(sm).toBeDefined();
    // The exploration pick must not be more expensive per output token than the
    // synthesis pick — otherwise the split has no cost effect at all.
    expect(em.costOutPer1M).toBeLessThanOrEqual(sm.costOutPer1M);
    // NV-POLICY-BUDGET-001: applyRoutingPolicy used to prepend curated leads
    // without honouring maxCostUsd, so an over-budget frontier model was put
    // back at position 0 after the scorer had correctly excluded it.
    expect(explore.estimatedCostUSD).toBeLessThanOrEqual(0.005);
  });

  it('honours the budget for EVERY fallback rung, not only the primary (NV-POLICY-BUDGET-001)', async () => {
    const { selectModel } = await import('../../../src/services/cost-aware-router.js');
    const { getModel } = await import('../../../src/services/intelligent-router/model-catalog.js');

    const budget = 0.005;
    const d = selectModel('Analyse BNSS 482 exposure.', {
      domain: 'legal',
      maxBudgetUSD: budget,
      expectedOutputTokens: 2_048,
    });
    // A cascade that falls back onto an unaffordable model breaks the budget the
    // moment the lead fails — which is exactly when fallbacks are used.
    for (const f of d.fallbacks) {
      const m = getModel(f.model)!;
      if (m.provider === 'agentzero') continue; // free terminal fallback
      const est = ((Math.ceil('Analyse BNSS 482 exposure.'.length / 3) + 500) * m.costInPer1M
        + 2_048 * m.costOutPer1M) / 1_000_000;
      expect(est, `${f.model} costs ${est} > ${budget}`).toBeLessThanOrEqual(budget);
    }
  });

  it('keeps the complexity classifier intact', async () => {
    const { classifyComplexity } = await import('../../../src/services/cost-aware-router.js');
    expect(classifyComplexity('What is bail?')).toBe('nano');
    expect(classifyComplexity('Draft a contract for cross-border arbitration')).toBe('expert');
    expect(classifyComplexity('Explain section 482 of BNSS', 'legal')).toBe('macro');
  });
});

describe('gemini model availability (NV-MODEL-AVAIL-PROBE-001)', () => {
  beforeEach(() => {
    vi.resetModules();
    setProviderEnv();
    delete process.env.NYV_LLM_CASCADE_GEMINI;
    delete process.env.NYV_GEMINI_FLASH_MODEL;
    delete process.env.NYV_GEMINI_PRO_MODEL;
  });

  it('drops the retired 2.5 ids from the catalog', async () => {
    const { MODEL_CATALOG } = await import('../../../src/services/intelligent-router/model-catalog.js');
    const googleIds = MODEL_CATALOG.filter((m) => m.provider === 'google').map((m) => m.id);
    expect(googleIds).not.toContain('gemini-2.5-pro');
    expect(googleIds).not.toContain('gemini-2.5-flash');
  });

  it('aliases any lingering 2.5 reference to a live model', async () => {
    const { getModel } = await import('../../../src/services/intelligent-router/model-catalog.js');
    // A stale env override or agent-registry stamp must degrade, not 404.
    expect(getModel('gemini-2.5-flash')?.id).toBe('gemini-3.7-flash');
    expect(getModel('gemini-2.5-pro')?.id).toBe('gemini-3-1-pro-preview');
  });

  it('carries the measured-live latest Flash and prefers it as the flash rail', async () => {
    const { getModel } = await import('../../../src/services/intelligent-router/model-catalog.js');
    const { getGeminiFlashModel } = await import('../../../src/config/jrx-gemini-models.js');
    expect(getModel('gemini-3.7-flash')).toBeDefined();
    expect(getGeminiFlashModel()).toBe('gemini-3.7-flash');
  });

  it('scores the slower Pro model below the measured-faster Flash on speed', async () => {
    const { getModel } = await import('../../../src/services/intelligent-router/model-catalog.js');
    // Bench: 3.7 Flash 6.99s vs 3.1 Pro 20.79s on the same legal question.
    const flash = getModel('gemini-3.7-flash')!;
    const pro = getModel('gemini-3-1-pro-preview')!;
    expect(flash.speedScore).toBeGreaterThan(pro.speedScore);
    // …and be cheaper, so a fast rail is never also the expensive one.
    expect(flash.costOutPer1M).toBeLessThan(pro.costOutPer1M);
  });

  it('emits no dead rungs in the gemini cascade', async () => {
    const { getGeminiCascadeModels, toGeminiApiModelId } = await import(
      '../../../src/config/jrx-gemini-models.js'
    );
    const dead = new Set(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);
    for (const id of getGeminiCascadeModels()) {
      expect(dead.has(toGeminiApiModelId(id)), `${id} maps to a 404 model`).toBe(false);
    }
  });

  it('remaps retired ids at the API boundary as a last line of defence', async () => {
    const { toGeminiApiModelId } = await import('../../../src/config/jrx-gemini-models.js');
    expect(toGeminiApiModelId('gemini-2.5-flash')).toBe('gemini-3.7-flash');
    expect(toGeminiApiModelId('gemini-2.5-pro')).toBe('gemini-3.1-pro-preview');
    // Catalog hyphen form still normalises to the dotted API id.
    expect(toGeminiApiModelId('gemini-3-1-pro-preview')).toBe('gemini-3.1-pro-preview');
  });

  it('keeps curated fallback ladders free of dead rungs', async () => {
    const { ultimateFallbackSequence } = await import(
      '../../../src/services/intelligent-router/default-sequences.js'
    );
    const ids = ultimateFallbackSequence().map((m) => m.id);
    expect(ids).not.toContain('gemini-2.5-pro');
    expect(ids).not.toContain('gemini-2.5-flash');
    expect(ids.length).toBeGreaterThan(0);
  });
});
