#!/usr/bin/env tsx
/**
 * NV-HASH-CHAIN-VERIFY — T9a (Session 2026-05-09)
 *
 * Drives N gateway calls, then walks `nv_schema.nv_audit_logs` row-by-row
 * confirming each row's `previous_hash` == prior row's `record_hash`.
 *
 * Verifies the post-Session-7 audit hash chain remains unbroken under
 * a realistic mixed workload (research + agent-execute interleaved).
 *
 * Usage:
 *   npx tsx scripts/jrx-hash-chain-verify.ts --calls=100 --concurrency=4
 *
 * Acceptance:
 *   - All N audit rows added during this run have prev==prior.hash
 *   - Output saved to audit/hash-chain-2026-05-09.json
 */
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { normalizePgConnectionString } from '../src/utils/jrx-pg-url.js';

const args = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const a = args.find(x => x.startsWith(`--${n}=`));
  return a ? a.split('=').slice(1).join('=') : d;
};
const N           = parseInt(arg('calls', '100'));
const CONC        = parseInt(arg('concurrency', '4'));
const BASE        = arg('base', process.env.JRX_UAT_BASE || 'http://localhost:5000');
const SDK_KEY     = process.env.JRX_SDK_KEY_NSP || '';
const DB_URL      = process.env.JRX_DATABASE_URL || process.env.DATABASE_URL || '';

if (!SDK_KEY)  { console.error('JRX_SDK_KEY_NSP not set'); process.exit(2); }
if (!DB_URL)   { console.error('JRX_DATABASE_URL not set'); process.exit(2); }

const RESEARCH_PROMPTS = [
  'Section 138 NI Act limitation period',
  'IT Act 2000 reasonable security practices',
  'DPDP Act 2023 consent manager obligations',
  'GDPR Art. 6 lawful bases overview',
  'CCPA opt-out signal compliance for SaaS',
];
const DRAFT_PROMPTS = [
  'Draft a 2-paragraph demand notice under NI Act 138',
  'Draft a DPDPA consent notice for a fintech onboarding flow',
  'Draft a US privacy policy snippet for CCPA opt-out',
];

async function callResearch(idx: number) {
  const body = { query: RESEARCH_PROMPTS[idx % RESEARCH_PROMPTS.length], jurisdiction: 'IN', options: {} };
  const r = await fetch(`${BASE}/api/jrx/gateway/research/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': SDK_KEY },
    body: JSON.stringify(body),
  });
  return { http: r.status, kind: 'research' };
}
async function callExecute(idx: number) {
  const body = { prompt: DRAFT_PROMPTS[idx % DRAFT_PROMPTS.length], jurisdiction: 'IN' };
  const r = await fetch(`${BASE}/api/jrx/gateway/agents/legal-research-specialist/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': SDK_KEY },
    body: JSON.stringify(body),
  });
  return { http: r.status, kind: 'execute' };
}

async function pool<T>(items: T[], conc: number, fn: (t: T, i: number) => Promise<any>) {
  const out: any[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: conc }).map(async () => {
    while (true) {
      const idx = i++; if (idx >= items.length) return;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e: any) { out[idx] = { http: 0, error: e.message }; }
    }
  }));
  return out;
}

async function main() {
  const db = new Pool({ connectionString: normalizePgConnectionString(DB_URL), ssl: DB_URL.includes('localhost') ? false : { rejectUnauthorized: false } });

  // Baseline
  const baseRow = (await db.query<{ id: string; record_hash: string; ts: string }>(
    `SELECT id::text, record_hash, created_at::text AS ts
     FROM nv_schema.nv_audit_logs ORDER BY created_at DESC LIMIT 1`)).rows[0];
  const baselineHash = baseRow?.record_hash || '0000000000000000000000000000000000000000000000000000000000000000';
  const baselineCount = parseInt((await db.query<{ c: string }>(
    `SELECT COUNT(*)::text c FROM nv_schema.nv_audit_logs`)).rows[0].c);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  NV-HASH-CHAIN-VERIFY  N=${N}  concurrency=${CONC}`);
  console.log(`  baseline rows=${baselineCount}  last.hash=${baselineHash.slice(0,16)}…`);
  console.log('═══════════════════════════════════════════════════════════════');

  const t0 = Date.now();
  const items = Array.from({ length: N }, (_, i) => i);
  const httpResults = await pool(items, CONC, async (i) =>
    i % 2 === 0 ? callResearch(i) : callExecute(i)
  );
  const elapsed = Date.now() - t0;

  // settle: audit log writes happen post-response in some paths
  await new Promise(r => setTimeout(r, 2500));

  // Walk full chain (newest-first, then reverse)
  const rows = (await db.query<{ id: string; previous_hash: string; record_hash: string; event_type: string; created_at: string }>(
    `SELECT id::text, previous_hash, record_hash, event_type, created_at::text
     FROM nv_schema.nv_audit_logs ORDER BY created_at ASC`)).rows;

  // Validate chain
  const breaks: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].previous_hash !== rows[i - 1].record_hash) {
      breaks.push({
        atIndex: i, id: rows[i].id, ts: rows[i].created_at,
        expectedPrev: rows[i - 1].record_hash.slice(0, 16) + '…',
        actualPrev:   rows[i].previous_hash.slice(0, 16) + '…',
      });
    }
  }
  // Also check first row's prev (should be all zeros)
  const genesisOk = rows[0]?.previous_hash === '0000000000000000000000000000000000000000000000000000000000000000';

  const newRows = rows.length - baselineCount;
  const httpOk = httpResults.filter(r => r.http >= 200 && r.http < 300).length;

  const summary = {
    timestamp: new Date().toISOString(),
    config: { N, CONC, base: BASE },
    workload: {
      attempted: N,
      http_2xx: httpOk,
      http_other: N - httpOk,
      elapsedMs: elapsed,
      throughputPerSec: +(N / (elapsed / 1000)).toFixed(2),
      sampleHttp: httpResults.slice(0, 5),
    },
    audit: {
      rowsBefore: baselineCount,
      rowsAfter: rows.length,
      newRows,
      genesisPrevAllZeros: genesisOk,
      chainUnbroken: breaks.length === 0,
      breakCount: breaks.length,
      breaks: breaks.slice(0, 10),
      firstNewRow: rows[baselineCount] ? { id: rows[baselineCount].id, ts: rows[baselineCount].created_at, event: rows[baselineCount].event_type } : null,
      lastRow: rows[rows.length - 1] ? { id: rows[rows.length - 1].id, ts: rows[rows.length - 1].created_at, event: rows[rows.length - 1].event_type } : null,
    },
    verdict: breaks.length === 0 ? 'PASS' : 'FAIL',
  };

  const outPath = path.join('audit', `hash-chain-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.mkdirSync('audit', { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

  console.log('───────────────────────────────────────────────────────────────');
  console.log(`  HTTP 2xx          : ${httpOk}/${N}`);
  console.log(`  Audit rows added  : ${newRows}`);
  console.log(`  Chain breaks      : ${breaks.length}`);
  console.log(`  Genesis prev=0… : ${genesisOk}`);
  console.log(`  Verdict           : ${summary.verdict}`);
  console.log(`  Ledger            : ${outPath}`);
  console.log('═══════════════════════════════════════════════════════════════');

  await db.end();
  process.exit(breaks.length === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });
