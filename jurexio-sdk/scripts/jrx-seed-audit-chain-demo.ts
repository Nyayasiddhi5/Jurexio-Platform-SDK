/**
 * Demo G1A — Audit Chain + Guardrail Monitor seed (task-297, 2026-05-13).
 *
 * Creates (if missing) and backfills two compliance tables that power the
 * /console/audit-chain and /console/guardrail-monitor demo pages:
 *
 *   nv_pattern_audit_log         — hash-chained audit ledger (prev_hash → record_hash)
 *   nv_hallucination_detections  — per-request guardrail check results (passed nullable)
 *
 * Source of seed payloads:
 *   - the e2e harness (scripts/jrx-sdk-platform-e2e.mjs) that produces
 *     /tmp/jrx-sdk-e2e-report.json. If the report is absent we synthesise a
 *     realistic mix from the same test catalogue (15 routes × 7 SDKs).
 *
 * Volume guarantee: ≥ 100 audit rows per jurisdiction (US, IN). Hash chain
 * is built per-jurisdiction so each jurisdiction has a self-consistent chain.
 *
 * Idempotent: re-running tops up to the floor; existing rows are not touched.
 *
 * NV-DB-SCRIPT-001: uses makePgSql (pg.Pool shim), not the neon HTTP driver.
 * NV-NAMING-001: jrx-* prefix. Standalone seeder, not auto-mounted.
 */
import { createHash, randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_pattern_audit_log': [
    'id', 'trace_id', 'request_id', 'pattern', 'agent_id', 'sdk_key', 'org_id',
    'jurisdiction', 'route', 'method', 'status_code', 'model', 'provider',
    'input_hash', 'output_hash', 'chain_hash', 'prev_hash', 'record_hash',
    'risk_score', 'risk_badge', 'blocked', 'tokens_used', 'tokens_in',
    'tokens_out', 'latency_ms', 'metadata', 'created_at',
  ],
  'public.nv_hallucination_detections': [
    'id', 'trace_id', 'agent_id', 'org_id', 'jurisdiction',
    'guardrail_type', 'passed', 'severity', 'score', 'flagged',
    'details', 'route', 'metadata', 'created_at',
  ],
} as const;

const sql = makePgSql(process.env.JRX_DATABASE_URL ?? process.env.DATABASE_URL!);

const JURISDICTIONS = ['US', 'IN'] as const;
const TARGET_PER_JURISDICTION = 120;

const SDK_KEYS = [
  { sku: 'NSP',  org: 'org-nsp-e2e',  agent: 'nsp-contract-analyst' },
  { sku: 'NSPM', org: 'org-nspm-e2e', agent: 'nspm-matter-coordinator' },
  { sku: 'NSI',  org: 'org-nsi-e2e',  agent: 'nsi-enterprise-counsel' },
  { sku: 'NSA',  org: 'org-nsa-e2e',  agent: 'nsa-academy-tutor' },
  { sku: 'NSM',  org: 'org-nsm-e2e',  agent: 'nsm-policy-analyst' },
  { sku: 'NYM',  org: 'org-nym-e2e',  agent: 'nym-citizen-helper' },
  { sku: 'JRX',  org: 'org-jrx-e2e',  agent: 'jrx-judicial-research' },
];

const ROUTES = [
  { route: '/api/jrx/intelligence/sentiment',         method: 'POST', kind: 'real-llm', model: 'gemini-2.5-flash',     provider: 'google'    },
  { route: '/api/jrx/intelligence/summarize',          method: 'POST', kind: 'real-llm', model: 'gemini-2.5-flash',     provider: 'google'    },
  { route: '/api/jrx/intelligence/classify',           method: 'POST', kind: 'real-llm', model: 'claude-3-5-haiku',     provider: 'anthropic' },
  { route: '/api/jrx/intelligence/ner',                method: 'POST', kind: 'real-llm', model: 'gpt-4o-mini',          provider: 'openai'    },
  { route: '/api/jrx/gateway/documents/summarize',     method: 'POST', kind: 'real-llm', model: 'gemini-2.5-flash',     provider: 'google'    },
  { route: '/api/jrx/gateway/documents/analyze',       method: 'POST', kind: 'real-llm', model: 'claude-3-5-sonnet',    provider: 'anthropic' },
  { route: '/api/jrx/gateway/research/query',          method: 'POST', kind: 'real-llm', model: 'gpt-4o',               provider: 'openai'    },
  { route: '/api/jrx/orchestrate',                     method: 'POST', kind: 'real-llm', model: 'gemini-2.5-flash',     provider: 'google'    },
  { route: '/api/jrx/gateway/info',                    method: 'GET',  kind: 'catalog',  model: null,                   provider: null        },
  { route: '/api/jrx/gateway/models',                  method: 'GET',  kind: 'catalog',  model: null,                   provider: null        },
  { route: '/api/jrx/gateway/agents',                  method: 'GET',  kind: 'catalog',  model: null,                   provider: null        },
  { route: '/api/jrx/intelligence/compliance-calendar', method: 'GET', kind: 'catalog',  model: null,                   provider: null        },
  { route: '/api/jrx/intelligence/regulatory-feed',    method: 'GET',  kind: 'catalog',  model: null,                   provider: null        },
  { route: '/api/jrx/gateway/guardrails/stats',        method: 'GET',  kind: 'catalog',  model: null,                   provider: null        },
];

const GUARDRAIL_TYPES = ['pii_redaction', 'hallucination', 'citation', 'policy'] as const;

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length];
}

function randInt(min: number, max: number, seed: number): number {
  // Deterministic-ish hash-based randomness so re-seeding is stable.
  const h = createHash('sha1').update(String(seed)).digest();
  return min + (h.readUInt32BE(0) % (max - min + 1));
}

async function ensureTables(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS nv_pattern_audit_log (
      id            VARCHAR(64)  PRIMARY KEY,
      trace_id      VARCHAR(64)  NOT NULL,
      request_id    VARCHAR(64),
      pattern       VARCHAR(40),
      agent_id      VARCHAR(80),
      sdk_key       VARCHAR(40),
      org_id        VARCHAR(40),
      jurisdiction  VARCHAR(10),
      route         VARCHAR(300),
      method        VARCHAR(10),
      status_code   INTEGER,
      model         VARCHAR(120),
      provider      VARCHAR(40),
      input_hash    VARCHAR(64),
      output_hash   VARCHAR(64),
      chain_hash    VARCHAR(64),
      prev_hash     VARCHAR(64),
      record_hash   VARCHAR(64),
      risk_score    REAL    DEFAULT 0,
      risk_badge    VARCHAR(10) DEFAULT 'GREEN',
      blocked       BOOLEAN DEFAULT FALSE,
      tokens_used   INTEGER DEFAULT 0,
      tokens_in     INTEGER DEFAULT 0,
      tokens_out    INTEGER DEFAULT 0,
      latency_ms    INTEGER DEFAULT 0,
      metadata      JSONB   DEFAULT '{}'::jsonb,
      created_at    TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_nv_pattern_audit_jur_created ON nv_pattern_audit_log (jurisdiction, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_nv_pattern_audit_created ON nv_pattern_audit_log (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_nv_pattern_audit_record_hash ON nv_pattern_audit_log (record_hash)`;

  await sql`
    CREATE TABLE IF NOT EXISTS nv_hallucination_detections (
      id              VARCHAR(64) PRIMARY KEY,
      trace_id        VARCHAR(64),
      agent_id        VARCHAR(80),
      org_id          VARCHAR(40),
      jurisdiction    VARCHAR(10),
      guardrail_type  VARCHAR(40),
      passed          BOOLEAN,
      severity        VARCHAR(20),
      score           REAL,
      flagged         BOOLEAN DEFAULT FALSE,
      details         TEXT,
      route           VARCHAR(300),
      metadata        JSONB DEFAULT '{}'::jsonb,
      created_at      TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_nv_halluc_jur_created ON nv_hallucination_detections (jurisdiction, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_nv_halluc_created ON nv_hallucination_detections (created_at DESC)`;
}

async function lastChainHash(jur: string): Promise<string> {
  const r: any[] = await sql`
    SELECT record_hash FROM nv_pattern_audit_log
    WHERE jurisdiction = ${jur}
    ORDER BY created_at DESC, id DESC LIMIT 1
  ` as any;
  return (r as any[])[0]?.record_hash ?? sha256(`genesis|${jur}`);
}

interface RouteSpec { route: string; method: string; kind: string; model: string | null; provider: string | null }

/**
 * If the e2e harness has just run, /tmp/jrx-sdk-e2e-report.json contains the
 * actual list of recent calls (route, sdk, status, latency, model, ...).
 * We map each report entry to one audit row + one guardrail row so the demo
 * data reflects real platform activity. Returns [] when the report is
 * missing or malformed; the caller falls back to synthetic top-up.
 */
function loadE2eReport(jur: string): Array<{ route: string; method: string; sku: string; status: number; latencyMs?: number; model?: string | null; provider?: string | null; tokensIn?: number; tokensOut?: number; passed?: boolean | null }> {
  const path = process.env.NV_E2E_REPORT_PATH ?? '/tmp/jrx-sdk-e2e-report.json';
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const items: any[] = Array.isArray(raw) ? raw : (raw.results ?? raw.calls ?? raw.entries ?? []);
    return items
      .map((it: any) => ({
        route:        String(it.route ?? it.path ?? it.endpoint ?? ''),
        method:       String(it.method ?? 'POST').toUpperCase(),
        sku:          String(it.sku ?? it.product ?? 'NSP').toUpperCase(),
        status:       Number(it.status ?? it.statusCode ?? 200),
        latencyMs:    Number(it.latencyMs ?? it.latency_ms ?? it.durationMs ?? 0) || undefined,
        model:        it.model ?? it.pickedModelId ?? null,
        provider:     it.provider ?? null,
        tokensIn:     Number(it.tokensIn ?? it.tokens_in ?? 0)  || undefined,
        tokensOut:    Number(it.tokensOut ?? it.tokens_out ?? 0) || undefined,
        passed:       typeof it.guardrailPassed === 'boolean' ? it.guardrailPassed : null,
        jurisdiction: String(it.jurisdiction ?? '').toUpperCase(),
      }))
      .filter((it) => it.route && (it.jurisdiction === '' || it.jurisdiction === jur));
  } catch (e) {
    console.warn(`[seed] failed to parse ${path}:`, (e as Error).message);
    return [];
  }
}

async function seedJurisdiction(jur: string): Promise<{ inserted: number; halluc: number; fromReport: number }> {
  // Top-up to TARGET if there's already data. Counted per-jurisdiction.
  const haveAudit  = Number(((await sql`SELECT COUNT(*)::int AS c FROM nv_pattern_audit_log WHERE jurisdiction = ${jur}` as any)[0]?.c) ?? 0);
  const haveHalluc = Number(((await sql`SELECT COUNT(*)::int AS c FROM nv_hallucination_detections WHERE jurisdiction = ${jur}` as any)[0]?.c) ?? 0);
  const need       = Math.max(0, TARGET_PER_JURISDICTION - haveAudit);
  const needHalluc = Math.max(0, TARGET_PER_JURISDICTION - haveHalluc);

  let prev = await lastChainHash(jur);
  let inserted = 0;
  let fromReport = 0;

  // CHAIN CHRONOLOGY (task-297, code-review fix):
  // The API returns rows ordered `created_at DESC` (newest first). The UI
  // verifies the chain by checking `newer.previousHash === older.recordHash`.
  // Therefore the row inserted FIRST must have the OLDEST timestamp, and each
  // subsequent row must be NEWER than the previous one. We compute timestamps
  // as `t_base + i * DELTA_MS` so iteration order == chronological order ==
  // chain order. Inverting this (which the previous version did) broke chain
  // verification because newer rows ended up pointing forward in time.
  const DELTA_MS = 41_000; // 41s spacing keeps 240 rows under ~3 hours

  // Phase 1: ingest real entries from /tmp/jrx-sdk-e2e-report.json (when
  // present). This makes the audit chain reflect the consumer-platform E2E
  // run that just shipped (replit.md operational truth, 2026-05-13).
  // Synthetic top-up runs after to guarantee the ≥120/jurisdiction floor.
  const now = Date.now();
  const report = loadE2eReport(jur);
  const phase1Count = Math.min(report.length, need);
  const totalNew    = need;                // chain order index 0..totalNew-1
  const tBase       = now - totalNew * DELTA_MS;
  for (let j = 0; j < phase1Count; j++) {
    const it    = report[j];
    const sdk   = SDK_KEYS.find((s) => s.sku === it.sku) ?? SDK_KEYS[0];
    const traceId   = randomUUID();
    const requestId = `req_${jur.toLowerCase()}_e2e_${(tBase + inserted * DELTA_MS).toString(36)}`;
    const status    = it.status || 200;
    const blocked   = status >= 400;
    const risk      = blocked ? 0.85 : 0.05;
    const badge     = blocked ? 'RED' : 'GREEN';
    const tokensIn  = it.tokensIn  ?? 0;
    const tokensOut = it.tokensOut ?? 0;
    const latency   = it.latencyMs ?? 1200;
    const inHash    = sha256(`in|${requestId}|${j}`);
    const outHash   = it.model ? sha256(`out|${requestId}|${j}`) : null;
    const payload   = `${jur}|${it.route}|${status}|${traceId}|${prev}`;
    const recHash   = sha256(payload);
    const id        = sha256(`e2e|${jur}|${j}|${prev}`).slice(0, 32);
    const createdAt = new Date(tBase + inserted * DELTA_MS).toISOString();
    const meta = { jurisdiction: jur, sku: sdk.sku, source: 'e2e-report', kind: it.model ? 'real-llm' : 'catalog', requestId, sdkKeyPreview: `nyv_${sdk.sku.toLowerCase()}_…${id.slice(-6)}`, pickedModelId: it.model, provider: it.provider, e2eRunId: 'e2e-2026-05-13' };
    await sql`
      INSERT INTO nv_pattern_audit_log (
        id, trace_id, request_id, pattern, agent_id, sdk_key, org_id, jurisdiction,
        route, method, status_code, model, provider,
        input_hash, output_hash, chain_hash, prev_hash, record_hash,
        risk_score, risk_badge, blocked, tokens_used, tokens_in, tokens_out,
        latency_ms, metadata, created_at
      ) VALUES (
        ${id}, ${traceId}, ${requestId}, ${it.model ? 'real-llm' : 'catalog'}, ${sdk.agent},
        ${`nyv_${sdk.sku.toLowerCase()}_${id.slice(-8)}`}, ${sdk.org}, ${jur},
        ${it.route}, ${it.method}, ${status}, ${it.model ?? null}, ${it.provider ?? null},
        ${inHash}, ${outHash}, ${recHash}, ${prev}, ${recHash},
        ${risk}, ${badge}, ${blocked}, ${tokensIn + tokensOut}, ${tokensIn}, ${tokensOut},
        ${latency}, ${JSON.stringify(meta)}::jsonb, ${createdAt}::timestamp
      )
      ON CONFLICT (id) DO NOTHING
    `;
    inserted++;
    fromReport++;
    prev = recHash;
  }

  // Phase 2: synthetic top-up so we always meet the demo floor.
  // Each row links prev → current via SHA-256 over a stable payload:
  // jurisdiction|route|status|trace|prev. This means the chain can be
  // re-verified client-side or by /audit/chain/verify without trusting us.
  // Chronology continues forward from phase 1 (see DELTA_MS comment above).
  for (let i = 0; inserted < need; i++) {
    const sdk    = pick(SDK_KEYS, i + (jur === 'US' ? 0 : 3));
    const r: RouteSpec = pick(ROUTES, i);
    const traceId   = randomUUID();
    const requestId = `req_${jur.toLowerCase()}_${(tBase + inserted * DELTA_MS).toString(36)}`;
    const status    = r.kind === 'real-llm' ? (i % 23 === 0 ? 429 : 200) : 200;
    const blocked   = i % 41 === 0; // ~2.5% blocked
    const risk      = blocked ? 0.85 : Math.min(0.45, (i % 17) / 60);
    const badge     = blocked ? 'RED' : (risk > 0.3 ? 'AMBER' : 'GREEN');
    const tokensIn  = r.kind === 'real-llm' ? randInt(120,  900,  i * 13 + 1) : 0;
    const tokensOut = r.kind === 'real-llm' ? randInt(60,   400,  i * 13 + 2) : 0;
    const latency   = r.kind === 'real-llm' ? randInt(380, 4200,  i * 13 + 3) : randInt(8, 45, i * 13 + 4);
    const inHash    = sha256(`in|${requestId}|${i}`);
    const outHash   = r.kind === 'real-llm' ? sha256(`out|${requestId}|${i}`) : null;
    const payload   = `${jur}|${r.route}|${status}|${traceId}|${prev}`;
    const recHash   = sha256(payload);
    const id        = sha256(`row|${jur}|${i}|${prev}`).slice(0, 32);
    const createdAt = new Date(tBase + inserted * DELTA_MS).toISOString();

    const meta = {
      jurisdiction: jur,
      sku: sdk.sku,
      tier: 'enterprise',
      kind: r.kind,
      requestId,
      sdkKeyPreview: `nyv_${sdk.sku.toLowerCase()}_…${id.slice(-6)}`,
      pickedModelId: r.model,
      provider: r.provider,
      e2eRunId: 'e2e-2026-05-13',
    };

    await sql`
      INSERT INTO nv_pattern_audit_log (
        id, trace_id, request_id, pattern, agent_id, sdk_key, org_id, jurisdiction,
        route, method, status_code, model, provider,
        input_hash, output_hash, chain_hash, prev_hash, record_hash,
        risk_score, risk_badge, blocked, tokens_used, tokens_in, tokens_out,
        latency_ms, metadata, created_at
      ) VALUES (
        ${id}, ${traceId}, ${requestId}, ${r.kind}, ${sdk.agent}, ${`nyv_${sdk.sku.toLowerCase()}_${id.slice(-8)}`},
        ${sdk.org}, ${jur},
        ${r.route}, ${r.method}, ${status}, ${r.model}, ${r.provider},
        ${inHash}, ${outHash}, ${recHash}, ${prev}, ${recHash},
        ${risk}, ${badge}, ${blocked}, ${tokensIn + tokensOut}, ${tokensIn}, ${tokensOut},
        ${latency}, ${JSON.stringify(meta)}::jsonb, ${createdAt}::timestamp
      )
      ON CONFLICT (id) DO NOTHING
    `;
    inserted++;
    prev = recHash;
  }

  // Seed guardrail-detection rows. Mix: ~75% pass, ~12% fail, ~13% N/A (passed = NULL).
  let halluc = 0;
  for (let i = 0; i < needHalluc; i++) {
    const sdk      = pick(SDK_KEYS, i + (jur === 'IN' ? 1 : 4));
    const r        = pick(ROUTES.filter(x => x.kind === 'real-llm'), i);
    const gType    = pick(GUARDRAIL_TYPES, i + (jur === 'IN' ? 0 : 2));
    // Tri-state: NULL means "guardrail did not apply to this request"
    // (e.g. a non-LLM call has no hallucination check, a non-PII prompt
    //  has no PII redaction signal). We surface this as a separate
    // bucket on the dashboard rather than counting it as a failure.
    const r1 = i % 11; // 0..10
    const passed: boolean | null =
      r1 < 8 ? true :          // ~73% pass
      r1 === 8 ? false :       // ~9% fail
      null;                    // ~18% N/A
    const flagged  = passed === false;
    const severity = flagged ? (i % 9 === 0 ? 'critical' : i % 5 === 0 ? 'high' : 'medium') : 'low';
    const score    = passed === false ? 0.78 + (i % 20) / 100 : passed === true ? 0.04 + (i % 15) / 100 : 0;
    const createdAt = new Date(now - i * 41_000).toISOString();
    const id        = sha256(`halluc|${jur}|${i}`).slice(0, 32);

    const details = passed === null
      ? `${gType} guardrail not applicable (${r.kind} request)`
      : passed === true
        ? `${gType} guardrail passed (score ${score.toFixed(2)})`
        : `${gType} guardrail flagged response — ${severity} severity, score ${score.toFixed(2)}`;

    await sql`
      INSERT INTO nv_hallucination_detections (
        id, trace_id, agent_id, org_id, jurisdiction,
        guardrail_type, passed, severity, score, flagged,
        details, route, metadata, created_at
      ) VALUES (
        ${id}, ${randomUUID()}, ${sdk.agent}, ${sdk.org}, ${jur},
        ${gType}, ${passed}, ${severity}, ${score}, ${flagged},
        ${details}, ${r.route},
        ${JSON.stringify({ sku: sdk.sku, model: r.model, provider: r.provider, e2eRunId: 'e2e-2026-05-13' })}::jsonb,
        ${createdAt}::timestamp
      )
      ON CONFLICT (id) DO NOTHING
    `;
    halluc++;
  }

  return { inserted, halluc, fromReport };
}

async function main(): Promise<void> {
  console.log('▶ Demo G1A — seeding nv_pattern_audit_log + nv_hallucination_detections');
  await ensureTables();
  console.log('  ✓ tables ensured');
  await assertColumns(sql, './jrx-seed-audit-chain-demo', REQUIRED_COLUMNS);
  console.log('  ✓ schema columns asserted (no drift)');

  // --reseed flag wipes prior demo rows for US/IN before re-seeding.
  // Necessary when the chain chronology changes (task-297 code-review fix):
  // existing rows would otherwise cause integrity breaks against the new chain.
  if (process.argv.includes('--reseed')) {
    for (const jur of JURISDICTIONS) {
      await sql`DELETE FROM nv_pattern_audit_log       WHERE jurisdiction = ${jur}`;
      await sql`DELETE FROM nv_hallucination_detections WHERE jurisdiction = ${jur}`;
    }
    console.log('  ✓ wiped existing US/IN demo rows (--reseed)');
  }

  for (const jur of JURISDICTIONS) {
    const r = await seedJurisdiction(jur);
    console.log(`  ✓ ${jur}: +${r.inserted} audit rows (${r.fromReport} from e2e report, ${r.inserted - r.fromReport} synthetic), +${r.halluc} guardrail rows`);
  }
  // Final counts
  const audit:  any[] = await sql`SELECT jurisdiction, COUNT(*)::int AS c FROM nv_pattern_audit_log GROUP BY jurisdiction ORDER BY 1` as any;
  const halluc: any[] = await sql`SELECT jurisdiction, COUNT(*)::int AS c FROM nv_hallucination_detections GROUP BY jurisdiction ORDER BY 1` as any;
  console.log('\n  Audit rows by jurisdiction:', audit);
  console.log('  Guardrail rows by jurisdiction:', halluc);

  // Chain integrity check — same logic as the UI (newer.prev_hash === older.record_hash).
  // Iterates created_at ASC and asserts each row's prev_hash matches the previous
  // row's record_hash. Aborts the seed (exit 2) on any break so CI / future runs
  // catch chronology bugs immediately.
  console.log('\n  Verifying chain integrity per jurisdiction…');
  let totalBreaks = 0;
  for (const jur of JURISDICTIONS) {
    const rows: any[] = await sql`
      SELECT id, prev_hash, record_hash, created_at
      FROM nv_pattern_audit_log
      WHERE jurisdiction = ${jur}
      ORDER BY created_at ASC, id ASC
    ` as any;
    let breaks = 0;
    let lastHash = await lastChainHash(jur); // genesis only matters if rows[0] is the very first
    if (rows.length > 0) lastHash = rows[0].prev_hash; // start of this chain segment
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].prev_hash !== rows[i - 1].record_hash) breaks++;
    }
    totalBreaks += breaks;
    console.log(`    ${jur}: ${rows.length} rows · ${breaks} chain break(s)`);
  }
  await sql.end();
  if (totalBreaks > 0) {
    console.error(`\n❌ FAIL: chain has ${totalBreaks} break(s). The demo audit page will flag these.`);
    process.exit(2);
  }
  console.log('\n✅ done — chain verified intact');
}

main().catch(async (e) => {
  console.error('FATAL', e);
  try { await sql.end(); } catch { /* ignore */ }
  process.exit(1);
});
