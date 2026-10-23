#!/usr/bin/env node
/**
 * JRX ↔ NYS Knowledge Plane live matrix (read-only probes + golden accuracy).
 * Usage:
 *   JRX_BASE=https://api.jurexio.com \
 *   JRX_SDK_KEY=... \
 *   JRX_ECOSYSTEM_BASE=https://nyayasearch.jurexio.com/api \
 *   JRX_ECOSYSTEM_KNOWLEDGE_API_KEY=... optional \
 *   npx tsx scripts/jrx-nys-knowledge-matrix.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const JRX = (process.env.JRX_BASE || 'http://127.0.0.1:5000').replace(/\/$/, '');
const NYS = (process.env.JRX_ECOSYSTEM_BASE || 'https://nyayasearch.jurexio.com/api').replace(/\/$/, '');
const JRX_KEY = process.env.JRX_SDK_KEY || process.env.JRX_SDK_KEY_NSP || '';
const JRX_ECOSYSTEM_KEY = process.env.JRX_ECOSYSTEM_KNOWLEDGE_API_KEY || process.env.JRX_ECOSYSTEM_SDK_API_KEY || '';

type Row = {
  name: string;
  http: number;
  ms: number;
  ok: boolean;
  brief: string;
  accuracy?: 'PASS' | 'FAIL' | 'SKIP';
};

async function call(
  name: string,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 60_000,
): Promise<{ row: Row; json?: any }> {
  const h: Record<string, string> = { Accept: 'application/json', ...headers };
  const init: RequestInit = { method, headers: h, signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const t0 = Date.now();
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let brief = text.slice(0, 160).replace(/\s+/g, ' ');
    let json: any;
    try {
      json = JSON.parse(text);
      brief = JSON.stringify(
        json.error || json.message || {
          success: json.success,
          keys: Object.keys(json).slice(0, 8),
          layersUsed: json.layersUsed || json.data?.layersUsed,
          ungrounded: json.ungrounded,
        },
      ).slice(0, 200);
    } catch {
      /* keep */
    }
    return {
      row: { name, http: res.status, ms: Date.now() - t0, ok: res.ok, brief },
      json,
    };
  } catch (e) {
    return {
      row: { name, http: 0, ms: Date.now() - t0, ok: false, brief: (e as Error).message },
    };
  }
}

function goldBns103(json: any): 'PASS' | 'FAIL' | 'SKIP' {
  if (!json) return 'SKIP';
  const blob = JSON.stringify(json).toLowerCase();
  const hasBns = /\bbns\b/.test(blob) && /\b103\b/.test(blob);
  const denies =
    /not (a )?widely recognized|unknown code|cannot provide|no reliable source/.test(blob);
  const grounded =
    (Array.isArray(json.layersUsed) && json.layersUsed.includes('nys_global')) ||
    json.ungrounded === false ||
    (json.chunks && json.chunks.length > 0) ||
    (json.data?.chunks && json.data.chunks.length > 0) ||
    hasBns;
  if (denies && !hasBns) return 'FAIL';
  if (grounded && hasBns) return 'PASS';
  if (hasBns) return 'PASS';
  return 'FAIL';
}

async function main() {
  const rows: Row[] = [];
  const nyvH = JRX_KEY ? { 'X-API-Key': JRX_KEY } : {};
  const nysH = JRX_ECOSYSTEM_KEY ? { 'X-API-Key': JRX_ECOSYSTEM_KEY } : {};

  const push = (r: Row) => rows.push(r);

  push((await call('nyv.health', 'GET', `${JRX}/api/jrx/health`)).row);
  push((await call('nyv.statutes.summary', 'GET', `${JRX}/api/jrx/statutes/_summary`, undefined, nyvH)).row);

  {
    const { row, json } = await call(
      'nyv.statutes.search.BNS103',
      'GET',
      `${JRX}/api/jrx/statutes/search?q=${encodeURIComponent('BNS 103')}&limit=3`,
      undefined,
      nyvH,
    );
    const hits = json?.results?.length ?? json?.data?.results?.length ?? 0;
    row.accuracy = hits > 0 ? 'PASS' : 'FAIL';
    row.brief = `${row.brief} hits=${hits}`;
    push(row);
  }

  push((await call('nyv.knowledge.plane.health', 'GET', `${JRX}/api/jrx/knowledge/plane/health`, undefined, nyvH)).row);

  {
    const { row, json } = await call(
      'nyv.knowledge.search.BNS103',
      'POST',
      `${JRX}/api/jrx/knowledge/search`,
      { query: 'Punishment for murder under BNS section 103', jurisdiction: 'IN', limit: 5 },
      nyvH,
    );
    row.accuracy = goldBns103(json);
    push(row);
  }

  push(
    (
      await call(
        'nyv.knowledge.caselaw',
        'GET',
        `${JRX}/api/jrx/knowledge/caselaw/search?q=bail&jurisdiction=IN&limit=2`,
        undefined,
        nyvH,
      )
    ).row,
  );
  push(
    (
      await call(
        'nyv.knowledge.compare.ipc',
        'GET',
        `${JRX}/api/jrx/knowledge/statutes/compare/ipc-bns?section=302`,
        undefined,
        nyvH,
      )
    ).row,
  );
  push(
    (
      await call(
        'nyv.knowledge.cite.verify',
        'POST',
        `${JRX}/api/jrx/knowledge/caselaw/verify-citation`,
        { citation: '(2024) 1 SCC 1', jurisdiction: 'IN' },
        nyvH,
      )
    ).row,
  );
  push(
    (
      await call(
        'nyv.knowledge.athena',
        'POST',
        `${JRX}/api/jrx/knowledge/documents/search`,
        { q: 'bail anticipatory', limit: 5 },
        nyvH,
      )
    ).row,
  );
  push((await call('nyv.knowledge.retrieve', 'POST', `${JRX}/api/jrx/knowledge/retrieve`, { query: 'BNS 103', jurisdiction: 'IN' }, nyvH)).row);
  push((await call('nyv.knowledge.templates', 'GET', `${JRX}/api/jrx/knowledge/templates?jurisdiction=IN`, undefined, nyvH)).row);
  push((await call('nyv.knowledge.caselaw.stats', 'GET', `${JRX}/api/jrx/knowledge/caselaw/stats`, undefined, nyvH)).row);
  push((await call('nyv.knowledge.documents.status', 'GET', `${JRX}/api/jrx/knowledge/documents/status`, undefined, nyvH)).row);

  {
    const { row, json } = await call('nyv.legalWork.tasks', 'GET', `${JRX}/api/jrx/legal-work/tasks`, undefined, nyvH);
    const n = Array.isArray(json) ? json.length : Array.isArray(json?.data) ? json.data.length : Array.isArray(json?.tasks) ? json.tasks.length : 0;
    row.accuracy = row.ok && n > 0 ? 'PASS' : row.http === 401 ? 'SKIP' : 'FAIL';
    row.brief = `${row.brief} tasks=${n}`;
    push(row);
  }

  {
    const { row, json } = await call(
      'nyv.patterns.nyayarag',
      'POST',
      `${JRX}/api/jrx/patterns/nyayarag`,
      { task: 'What is the punishment for murder under BNS 103?', jurisdiction: 'IN' },
      nyvH,
      120_000,
    );
    row.accuracy = goldBns103(json) === 'PASS' || json?.isRealRAG || (json?.layersUsed || []).length
      ? goldBns103(json) === 'FAIL' && !json?.isRealRAG
        ? 'FAIL'
        : json?.layersUsed?.includes?.('nys_global') || json?.isRealRAG
          ? 'PASS'
          : goldBns103(json)
      : goldBns103(json);
    push(row);
  }

  {
    const { row, json } = await call(
      'nyv.orchestrate.BNS103',
      'POST',
      `${JRX}/api/jrx/orchestrate`,
      {
        prompt: 'What is the punishment for murder under Bharatiya Nyaya Sanhita section 103?',
        jurisdiction: 'IN',
        enableRAG: true,
      },
      nyvH,
      180_000,
    );
    row.accuracy = goldBns103(json?.data || json);
    push(row);
  }

  push((await call('nys.healthz', 'GET', `${NYS}/healthz`)).row);
  push((await call('nys.caselaw', 'GET', `${NYS}/caselaw/search?q=bail&jurisdiction=IN&limit=2`, undefined, nysH)).row);
  push(
    (
      await call(
        'nys.retrieve',
        'POST',
        `${NYS}/retrieve`,
        { query: 'BNS 103 murder', jurisdiction: 'IN' },
        nysH,
      )
    ).row,
  );
  {
    const { row, json } = await call(
      'nys.statutes.BNS103',
      'GET',
      `${NYS}/statutes/search?q=${encodeURIComponent('BNS 103')}&limit=3`,
      undefined,
      nysH,
    );
    const hits = json?.results?.length ?? 0;
    row.accuracy = row.ok && hits > 0 ? 'PASS' : row.http === 401 ? 'SKIP' : 'FAIL';
    push(row);
  }
  push((await call('nys.templates', 'GET', `${NYS}/templates?jurisdiction=IN`, undefined, nysH)).row);

  console.log('\n=== JRX↔NYS matrix ===');
  let accPass = 0;
  let accFail = 0;
  for (const r of rows) {
    const mark = r.ok ? 'PASS' : r.http === 401 || r.http === 403 ? 'AUTH' : r.http === 404 ? 'MISS' : 'FAIL';
    const acc = r.accuracy ? ` acc=${r.accuracy}` : '';
    if (r.accuracy === 'PASS') accPass++;
    if (r.accuracy === 'FAIL') accFail++;
    console.log(
      `${mark.padEnd(5)} HTTP=${String(r.http).padStart(3)} ${String(r.ms).padStart(6)}ms  ${r.name.padEnd(36)}${acc}  ${r.brief}`,
    );
  }
  console.log(`\nAccuracy goldens: PASS=${accPass} FAIL=${accFail}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(process.cwd(), 'uat-reports');
  try {
    mkdirSync(outDir, { recursive: true });
  } catch {
    /* */
  }
  const out = join(outDir, `nys-knowledge-matrix-${stamp}.json`);
  try {
    writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), nyv: JRX, nys: NYS, accPass, accFail, rows }, null, 2));
    console.log('wrote', out);
  } catch {
    writeFileSync('/tmp/nys-knowledge-matrix.json', JSON.stringify({ rows, accPass, accFail }, null, 2));
    console.log('wrote /tmp/nys-knowledge-matrix.json');
  }

  if (accFail > 0 && process.env.JRX_MATRIX_STRICT === '1') process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
