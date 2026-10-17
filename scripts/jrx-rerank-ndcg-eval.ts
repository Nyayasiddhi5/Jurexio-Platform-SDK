#!/usr/bin/env npx tsx
/**
 * NV-RAG-NDCG-001 — offline nDCG@K for neural vs keyword/RRF rerank.
 *
 * Usage:
 *   npm run rag:ndcg
 *   JRX_RERANK_FIXTURE=tests/fixtures/rag/in-ndcg-sample.json npm run rag:ndcg
 *   JRX_NDCG_REQUIRE_NEURAL=1 npm run rag:ndcg   # CI soak — skip 0 without keys
 *   JRX_NDCG_MIN_DELTA=0.0 npm run rag:ndcg      # fail if meanDelta below floor
 *
 * Does not call production Auto-RAG — measures nvLegalRerankerService only.
 * Neural path needs COHERE_API_KEY / VOYAGE_API_KEY / CROSS_ENCODER_URL when present;
 * otherwise compares keyword heuristic to identity ranking (honest baseline).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

type Candidate = { id: string; content: string; score: number };
type QueryCase = {
  query: string;
  relevantIds: string[];
  candidates: Candidate[];
};

function hasNeuralKey(): boolean {
  const cohere = String(process.env.COHERE_API_KEY || '').trim();
  const voyage = String(process.env.VOYAGE_API_KEY || '').trim();
  const ce = String(process.env.CROSS_ENCODER_URL || '').trim();
  return !!(cohere || voyage || ce);
}

function dcgAtK(rankedIds: string[], relevant: Set<string>, k: number): number {
  let s = 0;
  for (let i = 0; i < Math.min(k, rankedIds.length); i++) {
    if (!relevant.has(rankedIds[i])) continue;
    s += 1 / Math.log2(i + 2);
  }
  return s;
}

function ndcgAtK(rankedIds: string[], relevantIds: string[], k: number): number {
  const rel = new Set(relevantIds);
  const ideal = [...relevantIds];
  const idcg = dcgAtK(ideal, rel, k);
  if (idcg <= 0) return 0;
  return dcgAtK(rankedIds, rel, k) / idcg;
}

async function main(): Promise<void> {
  const requireNeural = process.env.JRX_NDCG_REQUIRE_NEURAL === '1';
  if (requireNeural && !hasNeuralKey()) {
    console.log(
      JSON.stringify(
        {
          skipped: true,
          reason: 'JRX_NDCG_REQUIRE_NEURAL=1 but no COHERE_API_KEY / VOYAGE_API_KEY / CROSS_ENCODER_URL',
          note: 'CI soak is skip-safe without live keys — wire org secrets to enable neural gate.',
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const fixturePath =
    process.env.JRX_RERANK_FIXTURE ||
    path.join(process.cwd(), 'tests', 'fixtures', 'rag', 'in-ndcg-sample.json');
  if (!fs.existsSync(fixturePath)) {
    console.error('[rag:ndcg] fixture missing:', fixturePath);
    process.exit(1);
  }
  const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as QueryCase[];
  const { nvLegalRerankerService } = await import('../src/services/rag/jrx-legal-reranker-service.js');

  const k = Math.max(1, Number(process.env.JRX_NDCG_K) || 5);
  let sumBase = 0;
  let sumRerank = 0;
  let n = 0;
  const rows: Array<Record<string, unknown>> = [];

  for (const c of cases) {
    const baseIds = [...c.candidates]
      .sort((a, b) => b.score - a.score)
      .map((x) => x.id);
    const t0 = Date.now();
    const ranked = await nvLegalRerankerService.rerankLegal(
      c.query,
      c.candidates.map((x) => ({ ...x })),
      { jurisdiction: 'IN', topK: Math.max(k, c.candidates.length) },
    );
    const latencyMs = Date.now() - t0;
    const rerankIds = ranked.map((r) => r.id);
    const base = ndcgAtK(baseIds, c.relevantIds, k);
    const rr = ndcgAtK(rerankIds, c.relevantIds, k);
    sumBase += base;
    sumRerank += rr;
    n += 1;
    rows.push({
      query: c.query.slice(0, 80),
      ndcgBase: Number(base.toFixed(4)),
      ndcgRerank: Number(rr.toFixed(4)),
      delta: Number((rr - base).toFixed(4)),
      latencyMs,
      topIds: rerankIds.slice(0, k),
    });
  }

  const meanDelta = n ? (sumRerank - sumBase) / n : 0;
  const providerHint = process.env.CROSS_ENCODER_URL
    ? String(process.env.CROSS_ENCODER_URL).includes('127.0.0.1') ||
      String(process.env.CROSS_ENCODER_URL).includes('localhost')
      ? 'local-cross-encoder'
      : 'cross-encoder'
    : process.env.COHERE_API_KEY && String(process.env.COHERE_API_KEY).trim()
      ? 'cohere'
      : process.env.VOYAGE_API_KEY && String(process.env.VOYAGE_API_KEY).trim()
        ? 'voyage'
        : 'keyword-heuristic';

  const out = {
    fixture: fixturePath,
    k,
    cases: n,
    meanNdcgBase: n ? Number((sumBase / n).toFixed(4)) : 0,
    meanNdcgRerank: n ? Number((sumRerank / n).toFixed(4)) : 0,
    meanDelta: Number(meanDelta.toFixed(4)),
    providerHint,
    neuralRequired: requireNeural,
    rows,
    note: 'Offline soak metric — not a live A/B. Prefer neural when meanDelta > 0 consistently.',
  };
  console.log(JSON.stringify(out, null, 2));

  const minDeltaRaw = process.env.JRX_NDCG_MIN_DELTA;
  if (minDeltaRaw !== undefined && minDeltaRaw !== '') {
    const minDelta = Number(minDeltaRaw);
    if (Number.isFinite(minDelta) && meanDelta < minDelta) {
      console.error(
        `[rag:ndcg] FAIL meanDelta=${meanDelta.toFixed(4)} < JRX_NDCG_MIN_DELTA=${minDelta} (provider=${providerHint})`,
      );
      process.exit(1);
    }
  }

  if (requireNeural && providerHint === 'keyword-heuristic') {
    console.error('[rag:ndcg] FAIL neural required but reranker fell back to keyword-heuristic');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[rag:ndcg] fatal', e);
  process.exit(1);
});
