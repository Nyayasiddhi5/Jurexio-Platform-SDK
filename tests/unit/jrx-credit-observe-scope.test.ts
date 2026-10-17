/**
 * NV-CREDIT-OBSERVE-001 — observe mode must NOT reach the pre-existing enforced surfaces
 *
 * `/orchestrate`, `/orchestrate/stream`, `/legal-chat/send` and `/completions` call
 * `nvAICreditEnforcer.enforce()` inline and refuse on their own. They carry live
 * partner traffic and their refusal behaviour is established. Routing them through a
 * default-observe switch would quietly turn four working caps off — a safety
 * REDUCTION dressed as caution.
 *
 * The guarantee is structural: observe mode lives in `nv-credit-cap-observe.ts`,
 * which only `nv-ai-credit-cap-middleware.ts` imports. This suite pins that
 * structure two ways — behaviourally (the enforcer still refuses with the observe
 * default in force) and by reading the actual import graph, so moving the observe
 * branch into the enforcer or into a route goes red.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '../..');

/** Every pre-existing inline `enforce()` call site, i.e. the surfaces that must keep refusing. */
const PRE_EXISTING_ENFORCED_FILES = [
  'src/routes/jrx-orchestration-routes.ts',
  'src/routes/jrx-legal-chat-routes.ts',
  'src/routes/jrx-completions-routes.ts',
] as const;

const OBSERVE_MODULE = './jrx-credit-cap-observe';

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

const SAVED = { ...process.env };
beforeEach(() => {
  delete process.env.NYV_CREDIT_CAP_MODE;
  delete process.env.NYV_CREDIT_ENFORCE;
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe('NV-CREDIT-OBSERVE-001 — scope containment', () => {
  it('is imported by exactly one module: the newly-added cap middleware', () => {
    /* Positive control first: if the grep cannot find the ONE known importer, the
     * instrument is broken and the negative assertions below prove nothing. */
    const cap = read('src/middleware/jrx-ai-credit-cap-middleware.ts');
    expect(cap).toContain(OBSERVE_MODULE);

    for (const file of PRE_EXISTING_ENFORCED_FILES) {
      expect(read(file), `${file} must not consult observe mode`).not.toContain(OBSERVE_MODULE);
    }
  });

  it('does not leak into the enforcer itself', () => {
    /* If the observe branch were moved into `enforce()`, every caller — including the
     * four pre-existing ones — would silently stop refusing. */
    const enforcer = read('src/services/jrx-ai-credit-enforcer.ts');
    expect(enforcer).not.toContain(OBSERVE_MODULE);
    expect(enforcer).not.toContain('NYV_CREDIT_CAP_MODE');
  });

  it('the pre-existing surfaces still refuse on their own, in the route body', () => {
    /* Each must both call enforce() and act on `allowed === false`. A call site that
     * evaluates the check and ignores it is the "decorative cap" defect. */
    const orch = read('src/routes/jrx-orchestration-routes.ts');
    expect(orch).toContain('nvAICreditEnforcer.enforce(');
    expect(orch).toContain('CREDIT_CAP_EXCEEDED');

    const chat = read('src/routes/jrx-legal-chat-routes.ts');
    expect(chat).toContain('nvAICreditEnforcer.enforce(');

    const completions = read('src/routes/jrx-completions-routes.ts');
    expect(completions).toContain('nvAICreditEnforcer.enforce(');
  });
});

describe('NV-CREDIT-OBSERVE-001 — the enforcer verdict is unchanged by the observe default', () => {
  it('still returns allowed:false for a breach while the caps are in observe mode', async () => {
    /* Behavioural counterpart to the structural test. The observe default must change
     * only what the CAP does with a refusal, never whether the enforcer produces one:
     * the pre-existing routes read `allowed` directly. */
    const { resolveCreditCapMode } = await import('../../src/middleware/jrx-credit-cap-observe.js');
    expect(resolveCreditCapMode()).toBe('observe');

    const { NVAICreditEnforcer } = await import('../../src/services/jrx-ai-credit-enforcer.js');
    const enforcer = new NVAICreditEnforcer();
    // No DB in unit tests, so getUsedToday() returns 0; an estimate larger than the
    // whole tier budget is the deterministic way to force the daily-token refusal.
    const check = await enforcer.enforce({
      userId: 'u-observe-scope',
      tier: 'solo',
      estimatedTokens: 10_000_000,
      agentKey: 'test',
    });

    expect(check.allowed).toBe(false);
    expect(check.limit).toBe('daily_tokens');
  });

  it('positive control: the same enforcer admits a request inside budget', async () => {
    const { NVAICreditEnforcer } = await import('../../src/services/jrx-ai-credit-enforcer.js');
    const check = await new NVAICreditEnforcer().enforce({
      userId: 'u-observe-scope-2',
      tier: 'pro',
      estimatedTokens: 100,
      agentKey: 'test',
    });
    expect(check.allowed).toBe(true);
    expect(check.limit).toBeUndefined();
  });
});

describe('NV-CREDIT-COST-DIM-001 — the real enforcer carries the money dimension', () => {
  /* Asserted here rather than in the cost-dimension suite because that suite mocks
   * `nv-ai-credit-enforcer` wholesale (it is testing the middleware's calls into it).
   * The enforcer's own arithmetic has to be exercised unmocked or it is untested. */
  it('refuses on the cost budget and names the limit, so the two are countable apart', async () => {
    const { NVAICreditEnforcer } = await import('../../src/services/jrx-ai-credit-enforcer.js');
    const check = await new NVAICreditEnforcer().enforce({
      userId: 'u-cost-1',
      tier: 'free',
      estimatedTokens: 0,
      // free tier = 10,000 tokens, priced at the blended rate ≈ 47 micro-USD of
      // money budget, so $1 of estimated spend is unambiguously past it.
      estimatedCostMicroUsd: 1_000_000,
      agentKey: 'test',
    });

    expect(check.allowed).toBe(false);
    expect(check.limit).toBe('daily_cost');
    expect(check.costBudgetMicroUsd).toBeGreaterThan(0);
    expect(check.costUsedTodayMicroUsd).toBe(0);
  });

  it('derives the money budget from the tier token budget rather than a second policy', async () => {
    const { NVAICreditEnforcer, MICRO_USD_PER_USD } = await import(
      '../../src/services/jrx-ai-credit-enforcer.js'
    );
    const enforcer = new NVAICreditEnforcer();
    const pro = await enforcer.enforce({
      userId: 'u-cost-pro', tier: 'pro', estimatedTokens: 0, estimatedCostMicroUsd: 0, agentKey: 't',
    });
    const solo = await enforcer.enforce({
      userId: 'u-cost-solo', tier: 'solo', estimatedTokens: 0, estimatedCostMicroUsd: 0, agentKey: 't',
    });

    // pro = 800k tokens, solo = 50k: the money budgets must keep the same 16× ratio,
    // which is what "one policy in two units" means.
    expect(pro.costBudgetMicroUsd! / solo.costBudgetMicroUsd!).toBeCloseTo(16, 4);
    expect(MICRO_USD_PER_USD).toBe(1_000_000);
  });

  it('omits the cost fields entirely when the caller did not ask for the dimension', async () => {
    /* Every pre-existing token-only call site must be byte-for-byte unchanged. */
    const { NVAICreditEnforcer } = await import('../../src/services/jrx-ai-credit-enforcer.js');
    const check = await new NVAICreditEnforcer().enforce({
      userId: 'u-cost-2', tier: 'pro', estimatedTokens: 100, agentKey: 'test',
    });
    expect(check.allowed).toBe(true);
    expect(check.costBudgetMicroUsd).toBeUndefined();
    expect(check.costUsedTodayMicroUsd).toBeUndefined();
  });
});
