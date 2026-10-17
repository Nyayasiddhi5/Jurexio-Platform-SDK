#!/usr/bin/env tsx
/**
 * NV-EVAL-LEGAL-ACCURACY — per-jurisdiction accuracy / citation-faithfulness /
 * hallucination eval + benchmark harness.  NV-SVC-AUTHORITY-ADAPTER-001.
 *
 * Measures, per jurisdiction (IN, UK, US, EU, GC, SG), the claims the platform
 * makes about "95%+ accuracy, bounded/zero hallucination":
 *   - accuracy            — blend of citation recall + keyword coverage + the
 *                           (heuristic, key-free) LLM-as-judge score
 *   - citationFaithfulness — verifiedRatio from the jurisdiction authority
 *                           adapter on the model's answer (no silent passes)
 *   - hallucinationRate   — fraction of *good* answers that surface a
 *                           structurally-invalid citation (target: 0)
 *   - adversarialDetection — fraction of *deliberately fabricated* answers the
 *                           verifier flags (target: high) — proves the bound is real
 *
 * Modes:
 *   --seed (default)   Score the golden-set reference answers (`seedAnswer`) and
 *                      the fabricated answers (`adversarialAnswer`). Runs with NO
 *                      DB and NO LLM keys — proves the harness + verifiers execute
 *                      and the release gate logic works end-to-end.
 *   --gateway <url> --token <jwt>   LIVE mode: POST each prompt to the running
 *                      gateway's legal-chat endpoint and score the real model
 *                      output. Requires the gateway + provider keys + DB.
 *
 * Output:
 *   docs/audit/eval/scoreboard-<UTC>.json     full machine-readable scoreboard
 *   docs/audit/eval/scoreboard-latest.json    symlink-style copy (latest)
 *   docs/audit/eval/scoreboard-latest.md      human-readable scoreboard
 *
 * Release gate (env-overridable):
 *   NYV_EVAL_MIN_ACCURACY            default 95   (%)
 *   NYV_EVAL_MIN_CITATION_FAITHFUL   default 0.95 (ratio)
 *   NYV_EVAL_MAX_HALLUCINATION       default 0    (%)
 *   NYV_EVAL_MIN_ADVERSARIAL_DETECT  default 90   (%)
 * Exit code is non-zero when any jurisdiction fails its gate (suppress with
 * --no-gate for an informational run).
 *
 * Usage:
 *   npm run eval:legal-accuracy                 # seed/dry-run, gate enforced
 *   npm run eval:legal-accuracy -- --no-gate    # informational
 *   npm run eval:legal-accuracy -- --jurisdiction UK
 *   npm run eval:legal-accuracy -- --gateway http://localhost:5000 --token "$JWT"
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  verifyCitations,
  normalizeJurisdiction,
  getAuthorityRegistrySnapshot,
} from '../src/services/citation-verification/index.js';
import { nvLlmJudgeService } from '../src/services/testing/jrx-llm-judge-service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const GOLDEN_DIR = join(REPO_ROOT, 'docs/audit/eval/golden');
const OUT_DIR = join(REPO_ROOT, 'docs/audit/eval');

/* ── CLI args ──────────────────────────────────────────────── */
const args = process.argv.slice(2);
function flag(name: string): boolean { return args.includes(`--${name}`); }
function opt(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}

const MODE_GATEWAY = opt('gateway');
const MODE_TOKEN = opt('token') || process.env.NYV_EVAL_TOKEN || '';
const ONLY_JURISDICTION = opt('jurisdiction');
const ENFORCE_GATE = !flag('no-gate');
const INCLUDE_ADVERSARIAL = !flag('no-adversarial');

const GATE = {
  minAccuracy: parseFloat(process.env.NYV_EVAL_MIN_ACCURACY || '95'),
  minCitationFaithful: parseFloat(process.env.NYV_EVAL_MIN_CITATION_FAITHFUL || '0.95'),
  maxHallucinationPct: parseFloat(process.env.NYV_EVAL_MAX_HALLUCINATION || '0'),
  minAdversarialDetectPct: parseFloat(process.env.NYV_EVAL_MIN_ADVERSARIAL_DETECT || '90'),
};

/* ── Types ─────────────────────────────────────────────────── */
interface GoldenItem {
  id: string;
  domain: string;
  prompt: string;
  expectedCitations: string[];
  expectedAnswerKeywords: string[];
  seedAnswer: string;
  adversarialAnswer?: string;
}
interface GoldenSet { jurisdiction: string; version: string; items: GoldenItem[]; }

/* ── Scoring helpers ───────────────────────────────────────── */

/** Fraction of expected-citation key tokens that appear in the answer. */
function citationRecall(answer: string, expected: string[]): number {
  if (!expected.length) return 1;
  const lower = answer.toLowerCase();
  let hit = 0;
  for (const cit of expected) {
    // Match on the distinctive tokens (numbers + capitalised words) of the citation.
    const tokens = cit.toLowerCase().match(/[a-z]{4,}|\d+/g) || [];
    const distinctive = tokens.filter(t => !['section', 'article', 'of', 'the', 'act', 'code'].includes(t));
    const need = distinctive.length || tokens.length;
    const found = (distinctive.length ? distinctive : tokens).filter(t => lower.includes(t)).length;
    if (need > 0 && found / need >= 0.5) hit++;
  }
  return hit / expected.length;
}

function keywordCoverage(answer: string, keywords: string[]): number {
  if (!keywords.length) return 1;
  const lower = answer.toLowerCase();
  const hit = keywords.filter(k => lower.includes(k.toLowerCase())).length;
  return hit / keywords.length;
}

/** Map our 6-code jurisdiction to the judge service's code (GC → GCC). */
function judgeJurisdiction(code: string): string {
  return code === 'GC' ? 'GCC' : code;
}

async function scoreAnswer(item: GoldenItem, jurisdiction: string, answer: string) {
  const report = await verifyCitations(answer, jurisdiction);
  const recall = citationRecall(answer, item.expectedCitations);
  const coverage = keywordCoverage(answer, item.expectedAnswerKeywords);

  let judgeTotal = 0;
  try {
    const j = await nvLlmJudgeService.evaluate(answer, {
      query: item.prompt,
      jurisdiction: judgeJurisdiction(jurisdiction) as any,
      domain: (item.domain as any) || 'other',
      expectedCitations: item.expectedCitations,
      groundTruth: item.seedAnswer,
    });
    judgeTotal = j.weightedTotal; // 0..10
  } catch {
    judgeTotal = 0;
  }

  // Blended accuracy (0..100): citation recall + keyword coverage + judge.
  const accuracy = ((recall + coverage + judgeTotal / 10) / 3) * 100;

  return {
    citationRecall: round(recall),
    keywordCoverage: round(coverage),
    judgeScore: round(judgeTotal),
    accuracyPct: round(accuracy),
    citationsFound: report.citationsFound,
    verified: report.citationsVerified,
    unverified: report.citationsUnverified,
    invalid: report.citationsInvalid,
    unsupported: report.citationsUnsupported,
    verifiedRatio: report.verifiedRatio,
    liveApiConsulted: report.liveApiConsulted,
    flagged: report.citationsInvalid + report.citationsUnverified > 0,
  };
}

function round(n: number): number { return Math.round(n * 1000) / 1000; }

/* ── Live-mode answer fetch (requires running gateway + provider keys + DB) ──
 * The legal-chat `/send` endpoint streams Server-Sent Events through the full
 * safety ring; the synthesized answer arrives in the terminal `run_complete`
 * frame as `data.response`. We POST `prompt` (the field the handler reads),
 * read the SSE body, and extract that final answer. Falls back to JSON parsing
 * if a future/alternate endpoint returns a plain JSON envelope. */
function extractRunCompleteAnswer(sse: string): string {
  // SSE frames are `event: <step>\n` + `data: <json>\n\n`. Scan every data
  // line, prefer the `run_complete` frame's response, else the longest answer.
  let best = '';
  for (const line of sse.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload[0] !== '{') continue;
    try {
      const frame: any = JSON.parse(payload);
      const d = frame?.data ?? frame;
      if (frame?.step === 'run_complete') {
        const ans = String(d?.response ?? d?.answer ?? d?.content ?? '');
        if (ans) return ans;
      }
      const candidate = String(d?.response ?? d?.answer ?? d?.content ?? '');
      if (candidate.length > best.length) best = candidate;
    } catch { /* non-JSON data line — ignore */ }
  }
  return best;
}

const LIVE_FETCH_TIMEOUT_MS = parseInt(process.env.NYV_EVAL_LIVE_TIMEOUT_MS || '180000', 10);
async function fetchLiveAnswer(item: GoldenItem, jurisdiction: string): Promise<string> {
  if (!MODE_GATEWAY) throw new Error('live mode requires --gateway');
  const base = MODE_GATEWAY.replace(/\/+$/, '');
  // The 164-agent orchestration behind /send can take 1–3 min per query, so we
  // allow a generous abort budget (env-overridable) rather than the platform
  // default — a timed-out item degrades to an empty answer, never a hang.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/jrx/legal-chat/send`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(MODE_TOKEN ? { Authorization: `Bearer ${MODE_TOKEN}` } : {}),
      },
      // `prompt` is the field the /send handler reads; send `message` too for
      // forward-compat. jurisdictions[] drives the jurisdiction overlay +
      // Step-7 authority verification.
      body: JSON.stringify({
        prompt: item.prompt,
        message: item.prompt,
        jurisdiction,
        jurisdictions: [jurisdiction],
        mode: 'research',
        tier: 'pro',
      }),
    });
    if (!res.ok) throw new Error(`gateway ${res.status} for ${item.id}`);
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    if (ct.includes('application/json')) {
      try {
        const data: any = JSON.parse(text);
        return String(data?.response ?? data?.answer ?? data?.content ?? data?.data?.response ?? '');
      } catch { /* fall through to SSE parse */ }
    }
    return extractRunCompleteAnswer(text);
  } finally {
    clearTimeout(timer);
  }
}

/* ── Main ──────────────────────────────────────────────────── */
async function main() {
  const mode = MODE_GATEWAY ? 'live' : 'seed';
  const files = readdirSync(GOLDEN_DIR).filter(f => f.endsWith('.json'));
  const snapshot = getAuthorityRegistrySnapshot();

  const jurisdictionResults: any[] = [];

  for (const file of files) {
    const set: GoldenSet = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf-8'));
    const code = normalizeJurisdiction(set.jurisdiction);
    // --jurisdiction accepts a single code OR a comma-separated list (e.g.
    // `--jurisdiction UK,EU,IN,SG`) so a live run can target a subset.
    if (ONLY_JURISDICTION) {
      const wanted = ONLY_JURISDICTION.split(',').map(s => normalizeJurisdiction(s.trim()));
      if (!wanted.includes(code)) continue;
    }

    const adapterInfo = snapshot.find(s => s.jurisdiction === code);
    const itemResults: any[] = [];
    const adversarialResults: any[] = [];

    for (const item of set.items) {
      let answer: string;
      if (mode === 'live') {
        try { answer = await fetchLiveAnswer(item, code); }
        catch (e: any) { answer = ''; console.error(`  ! ${item.id} live fetch failed: ${e?.message}`); }
        if (!answer) console.error(`  ! ${item.id} live answer empty (timeout/queue) — scored as no-answer`);
        else console.error(`  ✓ ${item.id} live answer ${answer.length} chars`);
        // Space out heavy orchestration calls so we don't trip per-user
        // concurrency/queue limits that return fast-empty responses.
        const delayMs = parseInt(process.env.NYV_EVAL_LIVE_DELAY_MS || '1500', 10);
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      } else {
        answer = item.seedAnswer;
      }
      const scored = await scoreAnswer(item, code, answer);
      itemResults.push({ id: item.id, domain: item.domain, ...scored });

      if (INCLUDE_ADVERSARIAL && item.adversarialAnswer) {
        const adv = await scoreAnswer(item, code, item.adversarialAnswer);
        adversarialResults.push({ id: item.id, detected: adv.flagged, invalid: adv.invalid, unverified: adv.unverified });
      }
    }

    const n = itemResults.length || 1;
    const accuracyPct = round(itemResults.reduce((s, r) => s + r.accuracyPct, 0) / n);
    const citationFaithfulness = round(itemResults.reduce((s, r) => s + r.verifiedRatio, 0) / n);
    const halluCount = itemResults.filter(r => r.invalid > 0).length;
    const hallucinationRatePct = round((halluCount / n) * 100);
    const unverifiedSurfaced = itemResults.reduce((s, r) => s + r.unverified, 0);
    const advN = adversarialResults.length;
    const adversarialDetectionPct = advN ? round((adversarialResults.filter(a => a.detected).length / advN) * 100) : null;

    // In seed/dry-run mode the accuracy figure reflects the golden REFERENCE
    // answer text (+ the heuristic judge), not live model output, so it is
    // reported but NOT release-blocking. The verifier-based metrics
    // (citation-faithfulness, hallucination-rate, adversarial-detection) ARE
    // meaningful in seed mode and stay blocking. Live mode blocks on all.
    const gateFailures: string[] = [];
    const infoOnly: string[] = [];
    const accuracyMsg = `accuracy ${accuracyPct}% < ${GATE.minAccuracy}%`;
    if (accuracyPct < GATE.minAccuracy) (mode === 'live' ? gateFailures : infoOnly).push(accuracyMsg);
    if (citationFaithfulness < GATE.minCitationFaithful) gateFailures.push(`citationFaithfulness ${citationFaithfulness} < ${GATE.minCitationFaithful}`);
    if (hallucinationRatePct > GATE.maxHallucinationPct) gateFailures.push(`hallucinationRate ${hallucinationRatePct}% > ${GATE.maxHallucinationPct}%`);
    if (adversarialDetectionPct !== null && adversarialDetectionPct < GATE.minAdversarialDetectPct) {
      gateFailures.push(`adversarialDetection ${adversarialDetectionPct}% < ${GATE.minAdversarialDetectPct}%`);
    }

    jurisdictionResults.push({
      jurisdiction: code,
      adapter: adapterInfo?.adapter,
      authoritySources: adapterInfo?.authoritySources,
      liveApiEnabled: adapterInfo?.liveApiEnabled ?? false,
      itemsEvaluated: itemResults.length,
      accuracyPct,
      citationFaithfulness,
      hallucinationRatePct,
      unverifiedSurfaced,
      adversarialDetectionPct,
      gatePassed: gateFailures.length === 0,
      gateFailures,
      infoOnly,
      items: itemResults,
      adversarial: adversarialResults,
    });
  }

  jurisdictionResults.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));

  const releaseGatePassed = jurisdictionResults.every(j => j.gatePassed);
  const scoreboard = {
    generatedAt: new Date().toISOString(),
    mode,
    note: mode === 'seed'
      ? 'SEED/DRY-RUN: scored against golden reference answers (no live model). Accuracy on seed answers reflects the reference text, not live model output. Citation-faithfulness, hallucination-rate and adversarial-detection are REAL signals from the jurisdiction authority verifiers.'
      : 'LIVE: scored against live gateway model output.',
    gate: GATE,
    releaseGatePassed,
    jurisdictions: jurisdictionResults,
  };

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const stamp = scoreboard.generatedAt.replace(/[:.]/g, '-');
  writeFileSync(join(OUT_DIR, `scoreboard-${stamp}.json`), JSON.stringify(scoreboard, null, 2));
  writeFileSync(join(OUT_DIR, 'scoreboard-latest.json'), JSON.stringify(scoreboard, null, 2));
  writeFileSync(join(OUT_DIR, 'scoreboard-latest.md'), renderMarkdown(scoreboard));

  printConsole(scoreboard);

  if (ENFORCE_GATE && !releaseGatePassed) {
    console.error('\n✗ RELEASE GATE FAILED — see failures above.');
    process.exit(1);
  }
  console.log(`\n✓ Scoreboard written to docs/audit/eval/scoreboard-latest.{json,md}`);
}

function renderMarkdown(s: any): string {
  const lines: string[] = [];
  lines.push('# Nyayavigya — Legal Accuracy & Hallucination Scoreboard');
  lines.push('');
  lines.push(`- **Generated:** ${s.generatedAt}`);
  lines.push(`- **Mode:** ${s.mode}`);
  lines.push(`- **Release gate:** ${s.releaseGatePassed ? '✅ PASS' : '❌ FAIL'}`);
  lines.push(`- **Thresholds:** accuracy ≥ ${s.gate.minAccuracy}% · citation-faithfulness ≥ ${s.gate.minCitationFaithful} · hallucination ≤ ${s.gate.maxHallucinationPct}% · adversarial-detection ≥ ${s.gate.minAdversarialDetectPct}%`);
  lines.push('');
  lines.push(`> ${s.note}`);
  lines.push('');
  lines.push('| Jurisdiction | Adapter | Live API | Items | Accuracy | Citation faithfulness | Hallucination rate | Unverified surfaced | Adversarial detection | Gate |');
  lines.push('|---|---|:--:|--:|--:|--:|--:|--:|--:|:--:|');
  for (const j of s.jurisdictions) {
    lines.push(`| ${j.jurisdiction} | ${j.adapter ?? '—'} | ${j.liveApiEnabled ? 'on' : 'off'} | ${j.itemsEvaluated} | ${j.accuracyPct}% | ${j.citationFaithfulness} | ${j.hallucinationRatePct}% | ${j.unverifiedSurfaced} | ${j.adversarialDetectionPct === null ? '—' : j.adversarialDetectionPct + '%'} | ${j.gatePassed ? '✅' : '❌'} |`);
  }
  lines.push('');
  for (const j of s.jurisdictions.filter((x: any) => !x.gatePassed)) {
    lines.push(`- **${j.jurisdiction} gate failures:** ${j.gateFailures.join('; ')}`);
  }
  if (s.mode === 'seed') {
    const infos = s.jurisdictions.filter((x: any) => x.infoOnly?.length);
    if (infos.length) {
      lines.push('');
      lines.push('_Informational (not release-blocking in seed mode — accuracy here reflects the reference answer text + heuristic judge, not live model output):_');
      for (const j of infos) lines.push(`- **${j.jurisdiction}:** ${j.infoOnly.join('; ')}`);
    }
  }
  lines.push('');
  lines.push('_Authority sources per jurisdiction:_');
  for (const j of s.jurisdictions) {
    lines.push(`- **${j.jurisdiction}** — ${(j.authoritySources || []).join(', ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

function printConsole(s: any) {
  console.log(`\nNyayavigya legal-accuracy eval — mode=${s.mode}  gate=${s.releaseGatePassed ? 'PASS' : 'FAIL'}`);
  console.log('─'.repeat(96));
  console.log(
    'JCN'.padEnd(5) + 'Acc%'.padStart(7) + 'CitFaith'.padStart(10) +
    'Hallu%'.padStart(9) + 'Unver'.padStart(7) + 'AdvDet%'.padStart(9) + '  Gate',
  );
  for (const j of s.jurisdictions) {
    console.log(
      j.jurisdiction.padEnd(5) +
      String(j.accuracyPct).padStart(7) +
      String(j.citationFaithfulness).padStart(10) +
      String(j.hallucinationRatePct).padStart(9) +
      String(j.unverifiedSurfaced).padStart(7) +
      String(j.adversarialDetectionPct ?? '—').padStart(9) +
      '  ' + (j.gatePassed
        ? '✅' + (j.infoOnly?.length ? ` (info: ${j.infoOnly.join('; ')})` : '')
        : '❌ ' + j.gateFailures.join('; ')),
    );
  }
}

main().catch(err => { console.error(err); process.exit(1); });
