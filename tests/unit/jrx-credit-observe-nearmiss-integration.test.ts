/**
 * NV-CREDIT-OBSERVE-001 — the near-miss is proven END TO END, unmocked
 *
 * WHY THIS SUITE EXISTS ALONGSIDE jrx-credit-observe-mode.test.ts
 * ─────────────────────────────────────────────────────────────
 * That suite mocks `jrx-ai-credit-enforcer` wholesale and mocks the logger. It is
 * the right shape for asserting what the MIDDLEWARE does with a refusal, but it
 * leaves two hops unexercised, and they are precisely the hops that decide
 * whether the deployed observability path is worth anything:
 *
 *   1. The `CreditCheckResult` it asserts against is a HAND-WRITTEN literal
 *      (`DENY_TOKENS`). If the real enforcer stopped setting `limit`, or set a
 *      different discriminator, or omitted the cost triple, every field
 *      assertion there would stay green while production logged a line that
 *      cannot be aggregated. The log line's fields are only meaningful if they
 *      come from the enforcer's OWN output.
 *
 *   2. The logger is replaced by a spy, so "the marker was emitted" is asserted
 *      against a mock — never against bytes that would reach `docker logs`. A
 *      real `logger.warn` that is filtered out by the process log level emits
 *      nothing, and the spy cannot tell the difference. That is the same class
 *      of defect as a health probe that bypasses the broken hop and reports
 *      green: zero near-miss lines then has two explanations (no near-miss, or a
 *      mute observer) and the mock-based suite cannot separate them.
 *
 * So this suite drives the REAL enforcer (its real arithmetic, over a stubbed
 * `usedToday`) through the REAL middleware into the REAL logger, and asserts on
 * captured stdout. Only the database is stubbed — the one dependency a unit test
 * genuinely cannot have.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

/**
 * Stubbed usage figures the REAL enforcer will read through its real SQL path.
 * `tokensToday` feeds `getUsedToday()`, `costUsdToday` feeds
 * `getCostUsedTodayMicroUsd()`, `hourlyCount` feeds `getHourlyRequests()`.
 */
const usage = { tokensToday: 0, costUsdToday: 0, hourlyCount: 0, orgBudget: null as number | null };

/**
 * One stub for the three different SELECTs the enforcer issues. Discriminated by
 * the aliases the enforcer's own SQL uses, so a query the enforcer changes shape
 * on falls through to `unmatched` and the test fails loudly rather than silently
 * reading 0 (which would look exactly like "no near-miss").
 */
const unmatched: string[] = [];
function answer(queryText: string): { rows: unknown[] } {
  const q = queryText.replace(/\s+/g, ' ');
  if (/daily_token_budget/.test(q)) {
    return { rows: usage.orgBudget === null ? [] : [{ daily_token_budget: usage.orgBudget }] };
  }
  if (/SUM\(tokens_used\)/.test(q)) return { rows: [{ total: usage.tokensToday }] };
  if (/SUM\(cost_usd\)/.test(q)) return { rows: [{ total: usage.costUsdToday }] };
  if (/COUNT\(\*\)/.test(q)) return { rows: [{ cnt: usage.hourlyCount }] };
  unmatched.push(q.slice(0, 120));
  return { rows: [] };
}

/**
 * Recover the SQL text from a drizzle `sql` template.
 *
 * Handles every shape this repo can hand us, because getting it wrong is
 * dangerous rather than merely broken:
 *   - `{ strings, values }` — `tests/setup.ts` globally mocks the `drizzle-orm`
 *     `sql` tag to this shape, so this is what unit tests actually see.
 *   - `{ queryChunks: [StringChunk{ value: [...] }, ...] }` — real drizzle.
 *   - `{ raw }` — `sql.raw()`.
 * Recursive because the enforcer composes `sql\`...${scope}...\`` where `scope`
 * is itself a fragment.
 *
 * An unrecognised shape yields '' and matches none of the discriminators, which
 * would make every query read as "no rows" == `usedToday: 0` — indistinguishable
 * from "no near-miss", i.e. precisely the failure mode this suite exists to rule
 * out. Hence the positive-control test below, which failed loudly and caught
 * exactly this while the suite was being written.
 */
function sqlText(node: unknown, depth = 0): string {
  if (node == null || depth > 8) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return node.map((n) => sqlText(n, depth + 1)).join(' ');
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.strings)) {
      return (o.strings as unknown[]).map((s) => sqlText(s, depth + 1)).join(' ')
        + ' ' + sqlText(o.values, depth + 1);
    }
    if (typeof o.raw === 'string') return o.raw;
    if (Array.isArray(o.value)) return (o.value as unknown[]).map((v) => sqlText(v, depth + 1)).join('');
    if (Array.isArray(o.queryChunks)) {
      return (o.queryChunks as unknown[]).map((v) => sqlText(v, depth + 1)).join(' ');
    }
    return '';
  }
  return '';
}

vi.mock('../../src/db/index.js', () => ({
  db: {
    execute: vi.fn(async (q: unknown) => answer(sqlText(q))),
  },
  pool: { query: vi.fn(async () => ({ rows: [] })) },
}));

/* `ensureCreditTables()` would try to CREATE TABLE. Neutralised, not silenced:
 * if it threw, the enforcer would still proceed (it swallows), so a no-op keeps
 * the enforcer on its normal path. */
vi.mock('../../src/db/jrx-ensure-schema.js', () => ({
  ensureNvSchemaTables: vi.fn(async () => undefined),
}));

const { nvAiCreditCap } = await import('../../src/middleware/jrx-ai-credit-cap-middleware.js');
const { CREDIT_CAP_OBSERVE_MARKER, buildCreditCapObserveRecord } =
  await import('../../src/middleware/jrx-credit-cap-observe.js');
const { nvRequestUsageContext } = await import('../../src/utils/jrx-request-usage-context.js');

// ── stdout capture: the bytes that would reach `docker logs` ─────────────────
/* eslint-disable no-console */
const ANSI = /\u001b\[[0-9;]*m/g;
let captured: string[] = [];
let restoreConsole: (() => void) | null = null;

function startCapture(): void {
  const realLog = console.log;
  const realErr = console.error;
  console.log = (...a: unknown[]) => { captured.push(a.map(String).join(' ')); };
  console.error = (...a: unknown[]) => { captured.push(a.map(String).join(' ')); };
  restoreConsole = () => { console.log = realLog; console.error = realErr; };
}

/**
 * Extract the observe records from captured stdout.
 *
 * The project logger emits a single JSON line under NODE_ENV=production and a
 * pretty `MESSAGE\n{json}` pair otherwise. Vitest runs with NODE_ENV=test, so
 * both shapes are handled — parsing only one would make this suite pass or fail
 * on an unrelated env var.
 */
function observeRecords(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const chunk of captured) {
    const clean = chunk.replace(ANSI, '');
    if (!clean.includes(CREDIT_CAP_OBSERVE_MARKER)) continue;
    const brace = clean.indexOf('{');
    if (brace < 0) continue;
    try {
      const parsed = JSON.parse(clean.slice(brace)) as Record<string, unknown>;
      // Pretty format puts message/level outside the JSON blob; carry the
      // message text along so message assertions remain possible.
      if (!('marker' in parsed)) continue;
      out.push({ ...parsed, __raw: clean });
    } catch { /* not the record blob */ }
  }
  return out;
}

function buildApp(
  capOptions: Parameters<typeof nvAiCreditCap>[0],
  subject: { userId: string; orgId: string },
  tier: string,
) {
  const { userId, orgId } = subject;
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(nvRequestUsageContext);
  app.use((req, _res, next) => {
    (req as unknown as { nvSdk?: unknown }).nvSdk = {
      appId: '77', orgId, appName: 'test', tier,
      apiKeyId: 'key_id_only_9911', requiresSigning: false, traceId: 't-int', requestStartMs: Date.now(),
    };
    (req as unknown as { user?: unknown }).user = { id: userId, tier };
    next();
  });
  app.post('/ai/run', nvAiCreditCap(capOptions), (_req, res) => {
    res.json({ success: true, reachedHandler: true });
  });
  return app;
}

async function post(app: express.Express, body: unknown, headers: Record<string, string> = {}) {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ai/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> | null };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const SAVED = { ...process.env };
let seq = 0;
/**
 * Fresh subject AND fresh org per test.
 *
 * The enforcer memoises `usedToday` in a module-level L1 map for 15s, and
 * `creditCacheKey()` keys it on `org:${orgId}` whenever an org is present — NOT
 * on the user. Reusing one org id across tests therefore leaks the first test's
 * `usedToday` into every later test in the file. That is worth knowing about the
 * production behaviour too: the `usedToday` an observe line reports is
 * org-scoped and may be up to 15s stale, so `overBy` is a near-real-time figure
 * rather than an exact one.
 */
const nextSubject = () => {
  const n = seq++;
  return { userId: `int-observe-u-${Date.now()}-${n}`, orgId: `int-observe-org-${Date.now()}-${n}` };
};

beforeEach(() => {
  captured = [];
  unmatched.length = 0;
  usage.tokensToday = 0;
  usage.costUsdToday = 0;
  usage.hourlyCount = 0;
  usage.orgBudget = null;
  delete process.env.JRX_CREDIT_CAP_MODE;
  delete process.env.JRX_CREDIT_ENFORCE;
  // The enforcer prefers a Redis L1 for `usedToday`; disabled so the stubbed PG
  // figure is definitively what the arithmetic uses.
  process.env.JRX_CREDIT_REDIS_L1 = '0';
  startCapture();
});
afterEach(() => {
  restoreConsole?.();
  restoreConsole = null;
  process.env = { ...SAVED };
});

describe('NV-CREDIT-OBSERVE-001 — near-miss proven through the REAL enforcer', () => {
  it('POSITIVE CONTROL: the stub is actually feeding usedToday to the enforcer', async () => {
    /* If this fails, every "would refuse" below could be an artefact of a stub
     * that returns nothing (which reads as usedToday = 0) rather than of real
     * arithmetic. An empty result and a real 0 are indistinguishable downstream,
     * so they are distinguished HERE. */
    usage.tokensToday = 799_000;
    const app = buildApp({ agentKey: 'ctl' }, nextSubject(), 'pro');
    await post(app, { prompt: 'x' });
    const recs = observeRecords();
    expect(unmatched, `enforcer issued a query the stub did not recognise: ${unmatched.join(' | ')}`)
      .toEqual([]);
    expect(recs).toHaveLength(1);
    expect(recs[0].usedToday).toBe(799_000);
  });

  it('emits the marker on a real daily_tokens near-miss AND admits the request', async () => {
    // pro = 800,000/day. 799,000 already used, so any real estimate trips it.
    usage.tokensToday = 799_000;
    const subject = nextSubject();
    const res = await post(buildApp({ agentKey: 'gateway:documents' }, subject, 'pro'), {
      prompt: 'draft a plaint',
    });

    // Observe mode must let the request THROUGH — that is the whole point.
    expect(res.status).toBe(200);
    expect(res.body?.reachedHandler).toBe(true);

    const recs = observeRecords();
    expect(recs, 'no NV-CREDIT-CAP-OBSERVE record reached stdout').toHaveLength(1);
    const r = recs[0];

    expect(r.marker).toBe(CREDIT_CAP_OBSERVE_MARKER);
    expect(r.decision).toBe('would_refuse');
    expect(r.mode).toBe('observe');
    expect(r.surface).toBe('/ai/run');
    expect(r.agentKey).toBe('gateway:documents');
    expect(r.tier).toBe('pro');
    // Attribution must be the real subject, not a default — an `overBy` that
    // cannot be tied back to an org/key/app is not actionable during an incident.
    expect(r.orgId).toBe(subject.orgId);
    expect(r.userId).toBe(subject.userId);
    expect(r.apiKeyId).toBe('key_id_only_9911');
    expect(r.appId).toBe('77');
    // These four come from the REAL enforcer's own return value.
    expect(r.limit).toBe('daily_tokens');
    expect(r.usedToday).toBe(799_000);
    expect(r.budgetLimit).toBe(800_000);
    expect(Number(r.estimatedTokens)).toBeGreaterThan(0);
    expect(r.overBy).toBe(799_000 + Number(r.estimatedTokens) - 800_000);
    // `overBy` is only useful if it is genuinely the overage, not a constant.
    expect(Number(r.overBy)).toBeGreaterThan(0);
  });

  it('the marker survives the real logger at the platform default log level', async () => {
    /* The deployed gateway runs LOG_LEVEL=info. `logger.warn` is level 40 and
     * therefore emits — but if the record were ever downgraded to debug/trace it
     * would vanish from `docker logs` while every mock-based assertion stayed
     * green, and the near-miss count would silently read 0 forever. Pin the
     * severity, not just the call. */
    process.env.LOG_LEVEL = 'info';
    usage.tokensToday = 799_000;
    await post(buildApp({ agentKey: 'lvl' }, nextSubject(), 'pro'), { prompt: 'x' });

    const recs = observeRecords();
    expect(recs).toHaveLength(1);
    const raw = String(recs[0].__raw);
    // Pretty format renders the level as `WARN `; JSON format as `"level":"warn"`.
    expect(raw.includes('WARN') || raw.includes('"level":"warn"')).toBe(true);
  });

  it('reports the MONEY overage with the full cost triple on a real daily_cost refusal', async () => {
    /* pro = 800,000 tokens => cost budget = (800000/1000) * $0.00475 * 1e6
     * = 3,800,000 micro-USD. $3.90 already spent puts the day past it, so the
     * money limit trips and the token limit does not — which is what makes the
     * two countable apart. */
    usage.costUsdToday = 3.9;
    const res = await post(
      buildApp({ agentKey: 'sdk:voice/synthesize', costDriver: 'tts_characters' }, nextSubject(), 'pro'),
      { text: 'y'.repeat(2_000) },
    );

    expect(res.status).toBe(200);
    expect(res.body?.reachedHandler).toBe(true);

    const recs = observeRecords();
    expect(recs).toHaveLength(1);
    const r = recs[0];
    expect(r.limit).toBe('daily_cost');
    // A money-metered surface must not also draw down the token budget.
    expect(r.estimatedTokens).toBe(0);
    expect(r.estimatedCostMicroUsd).toBe(2_000 * 15);
    expect(r.costBudgetMicroUsd).toBe(3_800_000);
    expect(r.costUsedTodayMicroUsd).toBe(3_900_000);
    expect(r.overBy).toBe(3_900_000 + 2_000 * 15 - 3_800_000);
  });

  it('reports an hourly_requests overage in requests, not tokens', async () => {
    // pro hourly limit = 500. Well inside the token and cost budgets, so the
    // ONLY thing that can trip is the request rate.
    usage.hourlyCount = 503;
    const res = await post(buildApp({ agentKey: 'rate' }, nextSubject(), 'pro'), { prompt: 'x' });

    expect(res.status).toBe(200);
    const recs = observeRecords();
    expect(recs).toHaveLength(1);
    expect(recs[0].limit).toBe('hourly_requests');
    expect(recs[0].hourlyRequests).toBe(503);
    expect(recs[0].hourlyLimit).toBe(500);
    // 503 - 500 + 1: the overage in REQUESTS. A token-shaped number here would
    // make the aggregate meaningless.
    expect(recs[0].overBy).toBe(4);
  });

  it('honours a real org budget override when computing the overage', async () => {
    /* NSP-style orgs carry a 5,000,000/day override. If the observe line reported
     * the tier default instead, every `overBy` for an overridden org would be
     * wrong and the tuning data would be worthless. */
    usage.tokensToday = 4_999_000;
    usage.orgBudget = 5_000_000;
    await post(buildApp({ agentKey: 'ovr' }, nextSubject(), 'pro'), { prompt: 'x' });

    const recs = observeRecords();
    expect(recs).toHaveLength(1);
    expect(recs[0].budgetLimit).toBe(5_000_000);
    expect(recs[0].overBy).toBe(4_999_000 + Number(recs[0].estimatedTokens) - 5_000_000);
  });

  it('NEGATIVE CONTROL: a request inside a real budget emits nothing', async () => {
    usage.tokensToday = 10;
    const res = await post(buildApp({ agentKey: 'ok' }, nextSubject(), 'pro'), { prompt: 'hello' });
    expect(res.status).toBe(200);
    expect(observeRecords()).toHaveLength(0);
  });

  it('a partner bypass produces NO near-miss telemetry — the enforcer short-circuits', async () => {
    /* NV-NSP-UNLIMITED-001 sets `bypassCaps`, and `enforce()` then returns
     * allowed:true WITHOUT reading usedToday at all. So bypassed partner traffic
     * cannot generate `overBy` data no matter how much it spends. Pinned as a
     * deliberate, documented consequence rather than a surprise: it is the
     * reason the record-first rollout gathers no telemetry from the busiest
     * callers. */
    usage.tokensToday = 100_000_000;
    const res = await post(
      buildApp({ agentKey: 'bypass' }, nextSubject(), 'pro'),
      { prompt: 'x' },
      { 'x-jrx-platform': 'nsp', 'x-jrx-consent': 'granted' },
    );
    expect(res.status).toBe(200);
    expect(observeRecords()).toHaveLength(0);
  });

  it('refuses with the same marker once the flag is flipped to enforce', async () => {
    process.env.JRX_CREDIT_CAP_MODE = 'enforce';
    usage.tokensToday = 799_000;
    const res = await post(buildApp({ agentKey: 'enf' }, nextSubject(), 'pro'), { prompt: 'x' });

    expect(res.status).toBe(429);
    expect(res.body?.error?.details?.code).toBe('CREDIT_CAP_EXCEEDED');
    const recs = observeRecords();
    expect(recs).toHaveLength(1);
    expect(recs[0].mode).toBe('enforce');
    // Same marker in both modes, so the near-miss count does not reset on the flip.
    expect(recs[0].marker).toBe(CREDIT_CAP_OBSERVE_MARKER);
  });

  it('NV-SECRETS-001: no key material reaches the emitted line', async () => {
    usage.tokensToday = 799_000;
    await post(
      buildApp({ agentKey: 'sec' }, nextSubject(), 'pro'),
      { prompt: 'x' },
      { 'x-api-key': 'nyv_live_MUST_NOT_APPEAR', authorization: 'Bearer JWT_MUST_NOT_APPEAR' },
    );
    const all = captured.join('\n');
    expect(all).not.toContain('MUST_NOT_APPEAR');
    const recs = observeRecords();
    expect(recs).toHaveLength(1);
    // The key IDENTIFIER is required for attribution; the key VALUE never is.
    expect(recs[0].apiKeyId).toBe('key_id_only_9911');
    expect(JSON.stringify(recs[0])).not.toContain('nyv_live');
  });
});

describe('NV-CREDIT-OBSERVE-001 — the enforcer must NAME the limit on every refusal', () => {
  /**
   * Added because mutation N5 ("enforcer drops the `limit: 'daily_tokens'`
   * discriminator") stayed GREEN against every other suite in the tree.
   *
   * The reason it survived is `buildCreditCapObserveRecord`'s deliberate
   * fallback: `limit: String(check.limit ?? 'daily_tokens')`, mirrored by
   * `computeOverBy`'s `case undefined:` branch. That default is correct for the
   * token path, but it means no assertion on the RECORD can distinguish "the
   * enforcer named daily_tokens" from "the enforcer named nothing at all".
   *
   * Why that matters: the fallback also decides the ARITHMETIC. A future refusal
   * kind whose `limit` the enforcer forgot to set would be silently relabelled
   * `daily_tokens` and its overage computed with token arithmetic — producing a
   * confidently wrong `overBy`, which is worse than a missing one because it
   * pollutes the aggregate the record-first rollout exists to build.
   *
   * So the provenance is pinned HERE, on the enforcer's own output, where the
   * fallback cannot mask it.
   */
  it('names daily_tokens on a token refusal', async () => {
    usage.tokensToday = 799_000;
    const { NVAICreditEnforcer } = await import('../../src/services/jrx-ai-credit-enforcer.js');
    const s = nextSubject();
    const check = await new NVAICreditEnforcer().enforce({
      userId: s.userId, orgId: s.orgId, tier: 'pro', estimatedTokens: 5_000, agentKey: 't',
    });
    expect(check.allowed).toBe(false);
    // Asserted on `check`, NOT on the record: the record would say 'daily_tokens'
    // even if this were undefined.
    expect(check.limit).toBe('daily_tokens');
  });

  it('names daily_cost on a money refusal', async () => {
    usage.costUsdToday = 3.9;
    const { NVAICreditEnforcer } = await import('../../src/services/jrx-ai-credit-enforcer.js');
    const s = nextSubject();
    const check = await new NVAICreditEnforcer().enforce({
      userId: s.userId, orgId: s.orgId, tier: 'pro', estimatedTokens: 0,
      estimatedCostMicroUsd: 30_000, agentKey: 't',
    });
    expect(check.allowed).toBe(false);
    expect(check.limit).toBe('daily_cost');
  });

  it('names hourly_requests on a rate refusal', async () => {
    usage.hourlyCount = 503;
    const { NVAICreditEnforcer } = await import('../../src/services/jrx-ai-credit-enforcer.js');
    const s = nextSubject();
    const check = await new NVAICreditEnforcer().enforce({
      userId: s.userId, orgId: s.orgId, tier: 'pro', estimatedTokens: 10, agentKey: 't',
    });
    expect(check.allowed).toBe(false);
    expect(check.limit).toBe('hourly_requests');
  });

  it('leaves the limit UNSET when the request is allowed', async () => {
    /* Negative control: `limit` present on an allow would make "which limit
     * tripped" meaningless, and would make the three assertions above pass
     * vacuously. */
    const { NVAICreditEnforcer } = await import('../../src/services/jrx-ai-credit-enforcer.js');
    const s = nextSubject();
    const check = await new NVAICreditEnforcer().enforce({
      userId: s.userId, orgId: s.orgId, tier: 'pro', estimatedTokens: 10, agentKey: 't',
    });
    expect(check.allowed).toBe(true);
    expect(check.limit).toBeUndefined();
  });

  it('the observe record DOES fall back to daily_tokens — deliberate, and pinned', () => {
    /* Documents the fallback as intended rather than accidental, so a future
     * change to it is a visible decision. This is the behaviour that made N5
     * survive; it stays, because a missing discriminator on the token path is
     * far more likely than a new limit kind, and defaulting there is right. */
    const rec = buildCreditCapObserveRecord(
      {
        surface: '/s', agentKey: 'a', estimatedTokens: 1_000,
        subject: { userId: 'u', tier: 'pro' },
        check: {
          allowed: false, budgetLimit: 800_000, usedToday: 799_500, remainingToday: 500,
          tier: 'pro',
          // `limit` deliberately absent.
        },
      },
      'observe',
    );
    expect(rec.limit).toBe('daily_tokens');
    expect(rec.overBy).toBe(799_500 + 1_000 - 800_000);
  });
});

describe('NV-CREDIT-OBSERVE-001 — the enforcing surfaces emit no observe telemetry', () => {
  it('the pre-existing enforced routes do not import the observe module', async () => {
    /* Documented as a FINDING, not a defect to fix here: `/orchestrate`,
     * `/orchestrate/stream`, `/legal-chat/send` and `/completions` refuse on
     * their own and must keep doing so. The consequence, which this pins so it
     * cannot be forgotten, is that the highest-traffic surfaces produce no
     * `overBy` record — so the record-first rollout gathers tuning data from
     * everywhere EXCEPT the paths that spend the most. */
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const root = resolve(import.meta.dirname, '../..');
    const files = [
      'src/routes/jrx-orchestration-routes.ts',
      'src/routes/jrx-legal-chat-routes.ts',
      'src/routes/jrx-completions-routes.ts',
    ];
    for (const f of files) {
      const src = readFileSync(resolve(root, f), 'utf8');
      // Positive control: each really does enforce inline.
      expect(src, `${f} should still enforce inline`).toContain('nvAICreditEnforcer.enforce(');
      // And really does not emit the observe marker.
      expect(src).not.toContain('NV-CREDIT-CAP-OBSERVE');
      expect(src).not.toContain('observeCreditCapRefusal');
    }
  });
});
