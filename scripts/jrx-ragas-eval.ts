#!/usr/bin/env tsx
/**
 * NV-RAGAS-EVAL — RAGAS-style RETRIEVAL eval harness over the platform's OWN
 * live RAG path.  NV-EVAL-RAGAS-001.
 *
 * This is the retrieval-quality companion to `scripts/jrx-eval-legal-accuracy.ts`
 * (which scores generated ANSWERS — accuracy / citation-faithfulness /
 * hallucination). This harness instead measures RETRIEVAL quality — the
 * RAGAS context-precision / context-recall pair — by driving the live
 * retrieval entrypoint `retrieveDocuments()` in
 * `src/services/jrx-rag-live-service.ts` and scoring the chunks it returns
 * against a grounded gold set.
 *
 * It deliberately REUSES the existing, versioned, statute-grounded gold sets
 * at `docs/audit/eval/golden/*.json` (the same files the legal-accuracy
 * harness consumes) rather than duplicating a parallel dataset — each gold
 * item already carries the expected relevant statute citations + answer
 * keywords, which are exactly the gold-relevance signals a retrieval eval
 * needs. Override the directory with NYV_RAGAS_GOLDEN_DIR.
 *
 * ── Metrics (ALL computed from real retrieval; never hardcoded/random) ──────
 *
 *   Per gold item q with retrieved chunks C = retrieveDocuments(q.prompt):
 *     relevant(c)        := citationMatch(c, q.expectedCitations)
 *                            OR keywordCoverage(c, q.expectedAnswerKeywords) ≥ KW
 *     covered(cit)       := ∃ c ∈ C such that citationMatch(c, {cit})
 *
 *     contextPrecision(q) = |{ c ∈ C : relevant(c) }| / |C|
 *                           ( # retrieved chunks that are relevant / # retrieved )
 *     contextRecall(q)    = |{ cit ∈ q.expectedCitations : covered(cit) }|
 *                              / |q.expectedCitations|
 *                           ( # gold-relevant items retrieved / # gold-relevant )
 *
 *   Aggregate (per jurisdiction and overall) = arithmetic mean over items.
 *
 *   citationMatch(c, cits): the citation's distinctive tokens (4+ letter words
 *     and numbers, minus generic legal stopwords like "section"/"article"/
 *     "act"/"code") must appear in the chunk text (content + citationRef +
 *     statute/section metadata) at a ratio ≥ NYV_RAGAS_CITATION_MATCH (0.6).
 *   keywordCoverage(c, kws) = (# expectedAnswerKeywords present in chunk) / |kws|.
 *
 *   (Optional) LLM-judge faithfulness + answer-relevancy — ONLY routed through
 *   the safety-ring orchestrator (`callNyayavigyaSimple` →
 *   `callNyayavigya`, NV-LLM-001 compliant). For each item we ask the judge to
 *   rate, in [0,1], whether the gold reference answer is (a) faithful to the
 *   chunks we actually retrieved and (b) relevant to the question. The score is
 *   PARSED from the model's JSON output. If no LLM key is configured, or the
 *   judge output can't be parsed, the LLM metrics are SKIPPED with a printed
 *   message — never a fabricated score.
 *
 * ── SKIP / threshold logic ─────────────────────────────────────────────────
 *
 *   • DB / RAG store UNREACHABLE  → print a SKIP banner and exit 0
 *     (non-failing) so CI on machines without a DB never goes red spuriously.
 *     "Unreachable" = checkDatabaseHealth() unhealthy, OR rag_documents table
 *     absent, OR rag_documents has zero rows (store not yet populated).
 *   • DB reachable + store populated → compute real metrics. If any gated
 *     metric falls below its (env-overridable, default-lenient) threshold, exit
 *     non-zero so this can gate CI. Suppress the gate with --no-gate.
 *
 *   Thresholds (env-overridable, default lenient):
 *     NYV_RAGAS_MIN_CONTEXT_PRECISION   default 0.30
 *     NYV_RAGAS_MIN_CONTEXT_RECALL      default 0.30
 *     NYV_RAGAS_MIN_FAITHFULNESS        default 0    (0 = informational only)
 *     NYV_RAGAS_MIN_ANSWER_RELEVANCY    default 0    (0 = informational only)
 *
 *   Retrieval knobs:
 *     NYV_RAGAS_TOPK                    default 5
 *     NYV_RAGAS_MIN_SIMILARITY         default 0.2
 *     NYV_RAGAS_CITATION_MATCH         default 0.6
 *     NYV_RAGAS_KW_RELEVANCE           default 0.5
 *     NYV_RAGAS_NAMESPACE              default per-jurisdiction (see map)
 *     NYV_RAGAS_GOLDEN_DIR             default docs/audit/eval/golden
 *
 * Usage:
 *   npm run eval:ragas                       # gate enforced
 *   npm run eval:ragas -- --no-gate          # informational (always exit 0)
 *   npm run eval:ragas -- --jurisdiction IN  # single (or IN,UK,EU…) subset
 *   npm run eval:ragas -- --no-llm-judge     # deterministic metrics only
 *
 * Output:
 *   docs/audit/eval/ragas-scoreboard-<UTC>.json   full machine-readable
 *   docs/audit/eval/ragas-scoreboard-latest.json  latest copy
 *   docs/audit/eval/ragas-scoreboard-latest.md    human-readable
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { retrieveDocuments, type JurisdictionCode } from '../src/services/jrx-rag-live-service.js';
import { callNyayavigyaSimple } from '../src/services/jrx-client.js';
import { checkDatabaseHealth, pool } from '../src/db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const GOLDEN_DIR = process.env.NYV_RAGAS_GOLDEN_DIR
  ? join(REPO_ROOT, process.env.NYV_RAGAS_GOLDEN_DIR)
  : join(REPO_ROOT, 'docs/audit/eval/golden');
const OUT_DIR = join(REPO_ROOT, 'docs/audit/eval');

/* ── CLI args ──────────────────────────────────────────────── */
const args = process.argv.slice(2);
function flag(name: string): boolean { return args.includes(`--${name}`); }
function opt(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}

const ONLY_JURISDICTION = opt('jurisdiction');
const ENFORCE_GATE = !flag('no-gate');
const USE_LLM_JUDGE = !flag('no-llm-judge');

/* ── Tunables / gate (env-overridable, default lenient) ─────── */
const TOPK = parseInt(process.env.NYV_RAGAS_TOPK || '5', 10);
const MIN_SIMILARITY = parseFloat(process.env.NYV_RAGAS_MIN_SIMILARITY || '0.2');
const CITATION_MATCH = parseFloat(process.env.NYV_RAGAS_CITATION_MATCH || '0.6');
const KW_RELEVANCE = parseFloat(process.env.NYV_RAGAS_KW_RELEVANCE || '0.5');

const GATE = {
  minContextPrecision: parseFloat(process.env.NYV_RAGAS_MIN_CONTEXT_PRECISION || '0.30'),
  minContextRecall: parseFloat(process.env.NYV_RAGAS_MIN_CONTEXT_RECALL || '0.30'),
  minFaithfulness: parseFloat(process.env.NYV_RAGAS_MIN_FAITHFULNESS || '0'),
  minAnswerRelevancy: parseFloat(process.env.NYV_RAGAS_MIN_ANSWER_RELEVANCY || '0'),
};

/* ── Jurisdiction → live-service code + RAG namespace (mirrors
 *    nv-statute-rag-backfill-service.ts so we query the exact store the
 *    statutes were seeded into). ───────────────────────────────────────── */
const LIVE_JURIS: Record<string, JurisdictionCode> = {
  IN: 'IN', UK: 'UK', US: 'US', EU: 'EU', SG: 'SG', GC: 'GCC', GCC: 'GCC',
};
const NAMESPACE_BY_JURIS: Record<string, string> = {
  IN: 'in-bare-acts',
  UK: 'uk-statutes',
  US: 'us-federal',
  EU: 'eu-regulations',
  SG: 'sg-statutes',
  GC: 'gc-legislation',
  GCC: 'gc-legislation',
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

interface LlmScore { faithfulness: number; answerRelevancy: number; }

/* ── Relevance scoring helpers (deterministic, real) ───────── */

const CITATION_STOPWORDS = new Set(['section', 'article', 'of', 'the', 'act', 'code']);

/** Distinctive tokens of a citation: 4+ letter words + numbers, minus generic legal stopwords. */
function distinctiveTokens(citation: string): string[] {
  const tokens = citation.toLowerCase().match(/[a-z]{4,}|\d+/g) || [];
  const distinctive = tokens.filter(t => !CITATION_STOPWORDS.has(t));
  return distinctive.length ? distinctive : tokens;
}

/** True when ≥ CITATION_MATCH of a citation's distinctive tokens appear in the chunk text. */
function citationMatch(chunkText: string, citation: string): boolean {
  const tokens = distinctiveTokens(citation);
  if (!tokens.length) return false;
  const lower = chunkText.toLowerCase();
  const found = tokens.filter(t => lower.includes(t)).length;
  return found / tokens.length >= CITATION_MATCH;
}

/** Fraction of the item's expected answer keywords that appear in a single chunk. */
function keywordCoverage(chunkText: string, keywords: string[]): number {
  if (!keywords.length) return 0;
  const lower = chunkText.toLowerCase();
  const hit = keywords.filter(k => lower.includes(k.toLowerCase())).length;
  return hit / keywords.length;
}

/** Flatten a retrieved chunk into the searchable text used for relevance matching. */
function chunkText(chunk: { content: string; metadata: Record<string, unknown> }): string {
  const m = chunk.metadata || {};
  const metaBits = [m.citationRef, m.statute, m.section, m.practiceArea]
    .filter(Boolean)
    .map(String)
    .join(' ');
  return `${chunk.content}\n${metaBits}`;
}

function round(n: number): number { return Math.round(n * 1000) / 1000; }

/* ── LLM-judge availability + scoring (safety-ring routed) ──── */

const LLM_KEY_ENVS = [
  'OPENROUTER_API_KEY', 'AI_INTEGRATIONS_OPENROUTER_API_KEY',
  'OPENAI_API_KEY', 'NV_OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_API_KEY',
  'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'GROQ_API_KEY',
  'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY', 'TOGETHER_API_KEY', 'COHERE_API_KEY',
  'PERPLEXITY_API_KEY', 'SARVAM_API_KEY',
];
function llmKeyConfigured(): boolean {
  return LLM_KEY_ENVS.some(k => !!process.env[k]);
}

function parseLlmScore(raw: string): LlmScore | null {
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const f = Number(obj.faithfulness);
    const a = Number(obj.answerRelevancy ?? obj.answer_relevancy);
    if (!Number.isFinite(f) || !Number.isFinite(a)) return null;
    const clamp = (x: number) => Math.min(1, Math.max(0, x));
    return { faithfulness: clamp(f), answerRelevancy: clamp(a) };
  } catch {
    return null;
  }
}

/**
 * Judge faithfulness + answer-relevancy of the gold reference answer against
 * the ACTUALLY-RETRIEVED context, via the safety-ring orchestrator. Returns
 * null (never a fabricated score) when the judge is unavailable/unparsable.
 */
async function judgeRetrieval(
  item: GoldenItem,
  retrievedContext: string,
): Promise<LlmScore | null> {
  const system =
    'You are a strict legal-RAG evaluation judge. You score numerically and ' +
    'output ONLY compact JSON, no prose.';
  const userPrompt = [
    'Given a QUESTION, the CONTEXT a retrieval system returned, and a candidate ANSWER,',
    'score two metrics in the range 0.0 to 1.0:',
    '  - "faithfulness": the fraction of the ANSWER\'s factual claims that are supported by the CONTEXT.',
    '  - "answerRelevancy": how directly the ANSWER addresses the QUESTION.',
    'Respond with ONLY this JSON: {"faithfulness": <number>, "answerRelevancy": <number>}',
    '',
    `QUESTION:\n${item.prompt}`,
    '',
    `CONTEXT:\n${retrievedContext.slice(0, 6000) || '(no context retrieved)'}`,
    '',
    `ANSWER:\n${item.seedAnswer}`,
  ].join('\n');

  let raw: string;
  try {
    raw = await callNyayavigyaSimple(system, userPrompt, 256);
  } catch (e) {
    console.error(`  ! ${item.id} LLM judge call failed: ${(e as Error).message}`);
    return null;
  }
  if (!raw || /service (temporarily )?unavailable|blocked by nyayavigya/i.test(raw)) {
    console.error(`  ! ${item.id} LLM judge returned no usable content — skipping LLM score`);
    return null;
  }
  const score = parseLlmScore(raw);
  if (!score) console.error(`  ! ${item.id} LLM judge output unparsable — skipping LLM score`);
  return score;
}

/* ── DB / RAG-store reachability probe ─────────────────────── */
interface Reachability { ok: boolean; reason: string; ragDocumentCount: number; }
async function probeReachability(): Promise<Reachability> {
  let health: { healthy: boolean };
  try {
    health = await checkDatabaseHealth();
  } catch (e) {
    return { ok: false, reason: `DB health check threw: ${(e as Error).message}`, ragDocumentCount: 0 };
  }
  if (!health.healthy) {
    return { ok: false, reason: 'database unhealthy/unconfigured (checkDatabaseHealth)', ragDocumentCount: 0 };
  }
  if (!pool) {
    return { ok: false, reason: 'no database pool initialized (DATABASE_URL unset)', ragDocumentCount: 0 };
  }
  try {
    const res = await pool.query('SELECT COUNT(*)::int AS c FROM rag_documents');
    const rows = (res.rows ?? []) as { c?: number }[];
    const count = Number(rows[0]?.c ?? 0);
    if (count <= 0) {
      return { ok: false, reason: 'rag_documents store is empty (run npm run rag:backfill-statutes)', ragDocumentCount: 0 };
    }
    return { ok: true, reason: 'reachable', ragDocumentCount: count };
  } catch (e) {
    return { ok: false, reason: `rag_documents not queryable: ${(e as Error).message}`, ragDocumentCount: 0 };
  }
}

/* ── Per-item evaluation ───────────────────────────────────── */
interface ItemResult {
  id: string;
  domain: string;
  retrieved: number;
  relevantRetrieved: number;
  contextPrecision: number;
  citationsExpected: number;
  citationsCovered: number;
  contextRecall: number;
  faithfulness: number | null;
  answerRelevancy: number | null;
}

async function evaluateItem(item: GoldenItem, code: string): Promise<ItemResult> {
  const liveJur = LIVE_JURIS[code] || (code as JurisdictionCode);
  const namespace = process.env.NYV_RAGAS_NAMESPACE || NAMESPACE_BY_JURIS[code] || 'default';

  const chunks = await retrieveDocuments({
    query: item.prompt,
    jurisdiction: liveJur,
    namespace,
    topK: TOPK,
    minSimilarity: MIN_SIMILARITY,
  });

  const texts = chunks.map(chunkText);

  // contextPrecision: fraction of retrieved chunks that are relevant.
  let relevantRetrieved = 0;
  for (const t of texts) {
    const citHit = item.expectedCitations.some(c => citationMatch(t, c));
    const kwHit = keywordCoverage(t, item.expectedAnswerKeywords) >= KW_RELEVANCE;
    if (citHit || kwHit) relevantRetrieved++;
  }
  const contextPrecision = chunks.length ? relevantRetrieved / chunks.length : 0;

  // contextRecall: fraction of expected citations covered by ≥1 retrieved chunk.
  const expected = item.expectedCitations;
  let citationsCovered = 0;
  for (const cit of expected) {
    if (texts.some(t => citationMatch(t, cit))) citationsCovered++;
  }
  const contextRecall = expected.length ? citationsCovered / expected.length : 1;

  let faithfulness: number | null = null;
  let answerRelevancy: number | null = null;
  if (USE_LLM_JUDGE && llmKeyConfigured()) {
    const score = await judgeRetrieval(item, chunks.map(c => c.content).join('\n---\n'));
    if (score) {
      faithfulness = round(score.faithfulness);
      answerRelevancy = round(score.answerRelevancy);
    }
  }

  return {
    id: item.id,
    domain: item.domain,
    retrieved: chunks.length,
    relevantRetrieved,
    contextPrecision: round(contextPrecision),
    citationsExpected: expected.length,
    citationsCovered,
    contextRecall: round(contextRecall),
    faithfulness,
    answerRelevancy,
  };
}

/* ── Aggregation ───────────────────────────────────────────── */
function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return round(nums.reduce((s, n) => s + n, 0) / nums.length);
}
function meanNullable(nums: (number | null)[]): number | null {
  const present = nums.filter((n): n is number => n !== null);
  return present.length ? mean(present) : null;
}

/* ── Main ──────────────────────────────────────────────────── */
async function main(): Promise<void> {
  if (!existsSync(GOLDEN_DIR)) {
    console.error(`✗ gold dataset directory not found: ${GOLDEN_DIR}`);
    process.exit(2);
  }

  const llmEnabled = USE_LLM_JUDGE && llmKeyConfigured();
  if (USE_LLM_JUDGE && !llmEnabled) {
    console.log('ℹ No LLM provider key configured — SKIPPING LLM-judge metrics (faithfulness / answer-relevancy). Deterministic retrieval metrics still computed.');
  }

  // ── Reachability gate: SKIP (exit 0) when DB / RAG store is unreachable. ──
  const reach = await probeReachability();
  if (!reach.ok) {
    printSkipBanner(reach.reason);
    await closePool();
    process.exit(0);
  }
  console.log(`✓ RAG store reachable — rag_documents rows: ${reach.ragDocumentCount}`);

  const files = readdirSync(GOLDEN_DIR).filter(f => f.endsWith('.json'));
  const jurisdictionResults: Array<Record<string, unknown>> = [];

  const wanted = ONLY_JURISDICTION
    ? ONLY_JURISDICTION.split(',').map(s => s.trim().toUpperCase())
    : null;

  for (const file of files) {
    const set: GoldenSet = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf-8'));
    const code = String(set.jurisdiction || '').toUpperCase();
    if (wanted && !wanted.includes(code)) continue;

    const itemResults: ItemResult[] = [];
    for (const item of set.items) {
      const r = await evaluateItem(item, code);
      itemResults.push(r);
      console.error(`  • ${r.id} retrieved=${r.retrieved} precision=${r.contextPrecision} recall=${r.contextRecall}`);
    }

    const contextPrecision = mean(itemResults.map(r => r.contextPrecision));
    const contextRecall = mean(itemResults.map(r => r.contextRecall));
    const faithfulness = meanNullable(itemResults.map(r => r.faithfulness));
    const answerRelevancy = meanNullable(itemResults.map(r => r.answerRelevancy));

    const gateFailures: string[] = [];
    if (contextPrecision < GATE.minContextPrecision) gateFailures.push(`contextPrecision ${contextPrecision} < ${GATE.minContextPrecision}`);
    if (contextRecall < GATE.minContextRecall) gateFailures.push(`contextRecall ${contextRecall} < ${GATE.minContextRecall}`);
    if (GATE.minFaithfulness > 0 && faithfulness !== null && faithfulness < GATE.minFaithfulness) gateFailures.push(`faithfulness ${faithfulness} < ${GATE.minFaithfulness}`);
    if (GATE.minAnswerRelevancy > 0 && answerRelevancy !== null && answerRelevancy < GATE.minAnswerRelevancy) gateFailures.push(`answerRelevancy ${answerRelevancy} < ${GATE.minAnswerRelevancy}`);

    jurisdictionResults.push({
      jurisdiction: code,
      version: set.version,
      itemsEvaluated: itemResults.length,
      contextPrecision,
      contextRecall,
      faithfulness,
      answerRelevancy,
      gatePassed: gateFailures.length === 0,
      gateFailures,
      items: itemResults,
    });
  }

  jurisdictionResults.sort((a, b) => String(a.jurisdiction).localeCompare(String(b.jurisdiction)));

  const overall = {
    contextPrecision: mean(jurisdictionResults.map(j => j.contextPrecision as number)),
    contextRecall: mean(jurisdictionResults.map(j => j.contextRecall as number)),
    faithfulness: meanNullable(jurisdictionResults.map(j => j.faithfulness as number | null)),
    answerRelevancy: meanNullable(jurisdictionResults.map(j => j.answerRelevancy as number | null)),
  };
  const releaseGatePassed = jurisdictionResults.every(j => j.gatePassed as boolean);

  const scoreboard = {
    generatedAt: new Date().toISOString(),
    harness: './jrx-ragas-eval',
    retrievalEntrypoint: 'src/services/jrx-rag-live-service.ts#retrieveDocuments',
    goldenDir: GOLDEN_DIR.replace(REPO_ROOT + '/', ''),
    ragDocumentCount: reach.ragDocumentCount,
    llmJudge: llmEnabled ? 'enabled (safety-ring: callNyayavigyaSimple)' : 'skipped (no LLM key or --no-llm-judge)',
    knobs: { TOPK, MIN_SIMILARITY, CITATION_MATCH, KW_RELEVANCE },
    gate: GATE,
    overall,
    releaseGatePassed,
    jurisdictions: jurisdictionResults,
  };

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const stamp = scoreboard.generatedAt.replace(/[:.]/g, '-');
  writeFileSync(join(OUT_DIR, `ragas-scoreboard-${stamp}.json`), JSON.stringify(scoreboard, null, 2));
  writeFileSync(join(OUT_DIR, 'ragas-scoreboard-latest.json'), JSON.stringify(scoreboard, null, 2));
  writeFileSync(join(OUT_DIR, 'ragas-scoreboard-latest.md'), renderMarkdown(scoreboard));

  printConsole(scoreboard);
  await closePool();

  if (ENFORCE_GATE && !releaseGatePassed) {
    console.error('\n✗ RAGAS GATE FAILED — see failures above.');
    process.exit(1);
  }
  console.log('\n✓ RAGAS scoreboard written to docs/audit/eval/ragas-scoreboard-latest.{json,md}');
}

function printSkipBanner(reason: string): void {
  console.log('');
  console.log('────────────────────────────────────────────────────────────────────');
  console.log('  NV-RAGAS-EVAL — SKIPPED (non-failing, exit 0)');
  console.log(`  Reason: ${reason}`);
  console.log('  The DB / RAG store is unreachable or unpopulated, so retrieval');
  console.log('  metrics cannot be computed. This is intentionally NOT a CI failure.');
  console.log('────────────────────────────────────────────────────────────────────');
}

function renderMarkdown(s: Record<string, any>): string {
  const lines: string[] = [];
  lines.push('# Nyayavigya — RAGAS Retrieval Scoreboard');
  lines.push('');
  lines.push(`- **Generated:** ${s.generatedAt}`);
  lines.push(`- **Retrieval entrypoint:** \`${s.retrievalEntrypoint}\``);
  lines.push(`- **Gold set:** \`${s.goldenDir}\` · **rag_documents rows:** ${s.ragDocumentCount}`);
  lines.push(`- **LLM judge:** ${s.llmJudge}`);
  lines.push(`- **Release gate:** ${s.releaseGatePassed ? '✅ PASS' : '❌ FAIL'}`);
  lines.push(`- **Thresholds:** context-precision ≥ ${s.gate.minContextPrecision} · context-recall ≥ ${s.gate.minContextRecall}`);
  lines.push('');
  lines.push(`- **Overall:** precision ${s.overall.contextPrecision} · recall ${s.overall.contextRecall} · faithfulness ${s.overall.faithfulness ?? '—'} · answer-relevancy ${s.overall.answerRelevancy ?? '—'}`);
  lines.push('');
  lines.push('| Jurisdiction | Ver | Items | Context precision | Context recall | Faithfulness | Answer relevancy | Gate |');
  lines.push('|---|---|--:|--:|--:|--:|--:|:--:|');
  for (const j of s.jurisdictions) {
    lines.push(`| ${j.jurisdiction} | ${j.version} | ${j.itemsEvaluated} | ${j.contextPrecision} | ${j.contextRecall} | ${j.faithfulness ?? '—'} | ${j.answerRelevancy ?? '—'} | ${j.gatePassed ? '✅' : '❌'} |`);
  }
  lines.push('');
  for (const j of s.jurisdictions.filter((x: any) => !x.gatePassed)) {
    lines.push(`- **${j.jurisdiction} gate failures:** ${j.gateFailures.join('; ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

function printConsole(s: Record<string, any>): void {
  console.log(`\nNyayavigya RAGAS retrieval eval — gate=${s.releaseGatePassed ? 'PASS' : 'FAIL'}`);
  console.log('─'.repeat(80));
  console.log('JCN'.padEnd(5) + 'Items'.padStart(7) + 'Prec'.padStart(8) + 'Recall'.padStart(8) + 'Faith'.padStart(8) + 'AnsRel'.padStart(8) + '  Gate');
  for (const j of s.jurisdictions) {
    console.log(
      String(j.jurisdiction).padEnd(5) +
      String(j.itemsEvaluated).padStart(7) +
      String(j.contextPrecision).padStart(8) +
      String(j.contextRecall).padStart(8) +
      String(j.faithfulness ?? '—').padStart(8) +
      String(j.answerRelevancy ?? '—').padStart(8) +
      '  ' + (j.gatePassed ? '✅' : '❌ ' + j.gateFailures.join('; ')),
    );
  }
  console.log('─'.repeat(80));
  console.log(`OVERALL  precision=${s.overall.contextPrecision}  recall=${s.overall.contextRecall}  faithfulness=${s.overall.faithfulness ?? '—'}  answerRelevancy=${s.overall.answerRelevancy ?? '—'}`);
}

async function closePool(): Promise<void> {
  try {
    if (pool && typeof pool.end === 'function') await pool.end();
  } catch { /* best-effort pool teardown */ }
}

main().catch(err => { console.error(err); process.exit(1); });
