/**
 * NV-AUTO-RAG-001 — Unified tier-aware RAG orchestration router.
 *
 * Closes P1 RAG fragmentation: merges knowledge_chunks + rag_documents via RRF,
 * tier-routes adaptive / corrective / LightRAG / GraphRAG through capability
 * manifest, and is the single entry for Queen Step-0, SDK callJurexio, and
 * orchestration middleware pre-enrichment.
 */
import { createLogger } from '../utils/logger.js';
import {
  capabilityManifest,
  mapBillingTierToCapabilityTier,
  type CapabilityTier,
  type CapabilityContext,
} from '../orchestration/capability-manifest.js';
import { retrieveKnowledge, type KnowledgeChunk } from './rag-service.js';
import { retrieveDocuments, type RagDocument } from './jrx-rag-live-service.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import { correctiveRAGService } from './rag/corrective-rag-service.js';
import type { DeterministicAnswer } from './jrx-nys-deterministic-answer.js';
import {
  assessAuthorityGap,
  describeAuthorityTier,
  resolveAuthoritySalience,
  type AuthorityGap,
  type AuthorityTier,
  type AuthorityTierRequest,
} from './jrx-authority-salience.js';
import {
  describeRetrievalStack,
} from './jrx-agent-retrieval-policy.js';

const logger = createLogger('./jrx-auto-rag-router');

/**
 * Confidence heuristic shared by the initial pass and the re-retrieval pass.
 * Exported for tests — the thresholds it feeds (re-retrieval 0.55, abstain 0.45)
 * are cost- and quality-critical, so the curve is locked by unit tests.
 *
 * NV-RAG-CONF-001 — the previous form was `0.45 + mean(top-3 raw RRF)`. Because
 * a raw RRF sum tops out near `nLists/(k+1)` (≈0.098 for six lists at k=60), it
 * could never exceed **0.5484**: below the 0.55 re-retrieval threshold, so a
 * second full retrieval pass fired on **100%** of RAG requests, while the 0.45
 * abstain floor was simultaneously unreachable and the confidence returned to
 * SDK clients was a near-constant ~0.47.
 *
 * Confidence is now built from retrieval *provenance* rather than the fused sum:
 *   - rankQuality — how near the top of its best list the chunk appeared.
 *     `1/(1 + bestRank/3)`: rank 0 → 1.00, rank 3 → 0.50, rank 9 → 0.25.
 *   - coverage — how many independent retrievers agreed, saturating at two,
 *     because unanimity across every configured retriever is not a realistic
 *     bar and penalising extra retrievers would invert the incentive.
 *
 * Deliberately NOT normalised by the number of contributing lists: doing so made
 * a single strong hit score *lower* when more retrievers were enabled, which
 * would have pushed genuine answers under the abstain floor.
 */
export function scoreConfidence(chunks: AutoRagChunk[]): number {
  if (chunks.length === 0) return 0;
  const top = chunks.slice(0, 3);
  let acc = 0;
  for (const c of top) {
    const stat = fusionStats.get(c);
    const bestRank = stat?.bestRank ?? 0;
    const hits = stat?.hits ?? 1;
    const rankQuality = 1 / (1 + bestRank / 3);
    const coverage = Math.min(1, hits / 2);
    acc += 0.6 * rankQuality + 0.4 * coverage;
  }
  const agreement = acc / top.length;
  return Math.max(0, Math.min(0.98, 0.15 + 0.85 * agreement));
}

export type AutoRagIntent =
  | 'citation_lookup'
  | 'precedent_research'
  | 'comparative_analysis'
  | 'statute_research'
  | 'general';

export interface AutoRagChunk {
  id: string;
  source: string;
  title: string;
  content: string;
  jurisdiction: string;
  score: number;
  layer: 'knowledge_chunks' | 'rag_documents' | 'adaptive' | 'corrective' | 'lightrag' | 'graphrag' | 'sme_approved' | 'nys_global';
  citationRef?: string;
  /**
   * NV-CITE-GROUND-001 (2026-08-19) — the reference a lawyer could actually look
   * the authority up by, rendered into the LLM-visible context block.
   *
   * Deliberately NOT the same field as `citationRef`. `citationRef` is a *lookup
   * key*: `rag-service.lookupByCitationRefs` does `WHERE citation_ref = ANY(...)`
   * on it, and `chunkKey()` uses it as the RRF dedup identity, so two authorities
   * that shared one would be fused into one and silently lost. It is also, for
   * NYS judgments, `citation || title` — which on the ~99.8% of the corpus where
   * `citation IS NULL` is a verbatim echo of the title.
   *
   * `authorityRef` carries the *display* reference instead — a real reporter
   * citation when the row has one, otherwise a reference synthesised from the
   * metadata that does exist (court, year, CNR, case number). Optional: chunks
   * that are not authorities (graph entities, tenant documents) leave it unset
   * and render exactly as before.
   */
  authorityRef?: string;
  /**
   * NV-AUTHORITY-SALIENCE-001 — the court tier that decided this authority, as
   * `judgments.court_type` spells it. Set by `caseToChunk`; absent on chunks
   * that are not judgments (statutes, graph entities, tenant documents), which
   * is why the salience reorder must treat `undefined` as "adds no signal"
   * rather than "not the requested tier and therefore demoted".
   */
  courtTier?: AuthorityTier;
  /**
   * True when this row carries a real reporter citation (not a title echoed
   * into the `citation` column). Used for the honesty disclosure — can we hand
   * the lawyer a reference they can actually look up? — and deliberately NOT
   * added to the rank: it is 100% collinear with `courtTier === 'sc'` in this
   * corpus (43,505/43,505 SC rows have one; 0 of 2,000,000 non-SC rows do), so
   * scoring both would double-weight a single fact.
   */
  hasReporterCitation?: boolean;
}

/** JRX global legal intelligence — canonical six-jurisdiction set for cross-jx retrieval. */
export const JRX_SIX_JURISDICTIONS = ['IN', 'UK', 'US', 'EU', 'SG', 'GC'] as const;

export function normalizeRagJurisdiction(jurisdiction?: string): string {
  const u = (jurisdiction || 'IN').toUpperCase();
  return u === 'GCC' ? 'GC' : u;
}

export interface AutoRagRequest {
  query: string;
  jurisdiction?: string;
  /** When true (or comparative intent), retrieve top-k per jurisdiction and merge (tagged chunks). */
  crossJurisdiction?: boolean;
  /** Billing tier (pro, plus, government, …) or capability tier (lite, mitra, enterprise, sovereign). */
  tier?: string;
  taskType?: string;
  userId?: string;
  tenantId?: string;
  topK?: number;
  /**
   * NV-RAG-CHAR-BUDGET-001: character ceilings for the assembled context block.
   * Supply from `resolveContextBudgets()` — omitting them preserves the previous
   * unbounded behaviour rather than silently applying a default.
   */
  ragChunkCharCap?: number;
  ragTotalCharCap?: number;
  domain?: string;
}

export interface AutoRagResult {
  chunks: AutoRagChunk[];
  contextBlock: string;
  intent: AutoRagIntent;
  capabilityTier: CapabilityTier;
  layersUsed: string[];
  retrievalMethods: string[];
  totalFound: number;
  confidence: number;
  latencyMs: number;
  /**
   * NV-JRX-LLMREQUIRED-001 — the NYS knowledge plane's own verdict plus, when it
   * and the local scope gate agree, a rendered zero-token answer.
   *
   * Auto-RAG previously read only `.chunks` from the NYS response and dropped
   * this, so a statute lookup NYS had already resolved in ~50 ms was re-asked of
   * a frontier model. Callers that can return early MUST check
   * `deterministic.answer` before dispatching a completion; the chunks remain
   * populated either way so ignoring it degrades to today's behaviour rather
   * than losing grounding.
   */
  deterministic?: {
    llmRequired?: boolean;
    nysIntent?: string;
    answer?: DeterministicAnswer;
  };
  /**
   * NV-AUTHORITY-SALIENCE-001 — the court tier the query asked for, and whether
   * the delivered set met it. Present only when the query named a tier or asked
   * for leading authority; absent (and therefore inert) on every other query.
   */
  authoritySalience?: {
    request: AuthorityTierRequest;
    /** Requested-tier chunks delivered, after the salience reorder. */
    tierCount: number;
    /** Of those, how many can be cited by a reporter citation. */
    citableCount: number;
  };
}

const NAMESPACE_BY_JURIS: Record<string, string> = {
  IN: 'in-bare-acts',
  UK: 'uk-statutes',
  US: 'us-federal',
  EU: 'eu-regulations',
  SG: 'sg-statutes',
  GC: 'gc-legislation',
  GCC: 'gc-legislation',
};

const SME_NAMESPACE_BY_JURIS: Record<string, string> = {
  IN: 'in-sme-approved',
  UK: 'uk-sme-approved',
  US: 'us-sme-approved',
  EU: 'eu-sme-approved',
  SG: 'sg-sme-approved',
  GC: 'gc-sme-approved',
  GCC: 'gc-sme-approved',
};

const PRECEDENT_RE = /\b(precedent|case\s*law|judgment|judgement|ruling|held\s+that|overruled|distinguish|ratio\s+decidendi|stare\s+decisis|court\s+held|landmark\s+case)\b/i;
/** NV-NI-ACT-AUTHORITY-INTENT-001 — "leading authorities / cite the cases" must
 * route as precedent research before section-number citation_lookup fires. */
const AUTHORITY_SEEKING_RE = /\b(authorit(?:y|ies)|leading|landmark|cite\s+the\s+cases?)\b/i;
const COMPARATIVE_RE = /\b(compare|comparison|versus|vs\.?|difference\s+between|contrast|jurisdictional\s+comparison)\b/i;
const CITATION_RE = /\b(section|s\.|art\.|article|u\/s|u\.s\.|schedule|rule|regulation)\s*\d+/i;

/** Classify retrieval intent for tier-routing (exported for tests). */
export function classifyRagIntent(query: string, taskType?: string): AutoRagIntent {
  // Never throw on missing query — Queen swarm/ADaPT leaves may omit `query`.
  const q = String(query ?? '').trim();
  const task = (taskType || '').toLowerCase();
  if (
    PRECEDENT_RE.test(q)
    || AUTHORITY_SEEKING_RE.test(q)
    || task.includes('precedent')
    || task.includes('case')
  ) {
    return 'precedent_research';
  }
  if (COMPARATIVE_RE.test(q) || task.includes('compar')) {
    return 'comparative_analysis';
  }
  if (CITATION_RE.test(q) || task.includes('citation') || task.includes('statute')) {
    return 'citation_lookup';
  }
  if (/\b(act|statute|code|regulation|law|bare\s+act|legislation)\b/i.test(q) || task.includes('research')) {
    return 'statute_research';
  }
  return 'general';
}

/**
 * NV-RAG-CONF-001 — per-chunk fusion provenance, needed to turn a fused score
 * into a real confidence. Carried alongside the chunk rather than inside it so
 * the public `AutoRagChunk` shape is unchanged for consumers.
 */
interface FusionStat {
  /** How many contributing lists contained this chunk. */
  hits: number;
  /** Best (lowest) zero-based rank this chunk achieved in any list. */
  bestRank: number;
}

const fusionStats = new WeakMap<AutoRagChunk, FusionStat>();

/**
 * Reciprocal Rank Fusion across ranked lists (exported for tests).
 *
 * NV-RAG-CONF-001 — each contributing list adds at most `1/(k+1)` (0.0164 at
 * k=60), so a fused score is a *relative* ranking signal on a tiny absolute
 * scale and must never be read as a 0–1 confidence. `scoreConfidence` uses the
 * rank/coverage provenance recorded here instead of the raw sum.
 */
export function reciprocalRankFusion(
  lists: Array<Array<{ key: string; chunk: AutoRagChunk }>>,
  k = 60,
): AutoRagChunk[] {
  const scores = new Map<string, { score: number; chunk: AutoRagChunk; hits: number; bestRank: number }>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const rrf = 1 / (k + rank + 1);
      const prev = scores.get(item.key);
      if (prev) {
        prev.score += rrf;
        prev.chunk.score = prev.score;
        prev.hits += 1;
        prev.bestRank = Math.min(prev.bestRank, rank);
      } else {
        scores.set(item.key, {
          score: rrf,
          chunk: { ...item.chunk, score: rrf },
          hits: 1,
          bestRank: rank,
        });
      }
    });
  }
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((x) => {
      fusionStats.set(x.chunk, { hits: x.hits, bestRank: x.bestRank });
      return x.chunk;
    });
}

function resolveCapabilityTier(tier?: string): CapabilityTier {
  if (!tier) return 'lite';
  const t = tier.toLowerCase();
  const capabilityTiers: CapabilityTier[] = ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'];
  if (capabilityTiers.includes(t as CapabilityTier)) return t as CapabilityTier;
  return mapBillingTierToCapabilityTier(t);
}

function tierHasCapability(tier: CapabilityTier, capabilityId: string): boolean {
  return capabilityManifest.list({ tier }).some((c) => c.id === capabilityId);
}

function knowledgeToAuto(chunk: KnowledgeChunk, layer: AutoRagChunk['layer'] = 'knowledge_chunks'): AutoRagChunk {
  return {
    id: `kc:${chunk.id}`,
    source: chunk.source,
    title: chunk.title,
    content: chunk.content,
    jurisdiction: chunk.jurisdiction,
    score: chunk.score,
    layer,
    citationRef: chunk.citationRef,
  };
}

function ragDocToAuto(doc: RagDocument, layer: AutoRagChunk['layer'] = 'rag_documents'): AutoRagChunk {
  const meta = doc.metadata || {};
  return {
    id: `rd:${doc.id}`,
    source: String(meta.source || doc.namespace || 'rag_documents'),
    title: String(meta.title || meta.citation_ref || doc.namespace || 'Document'),
    content: doc.content,
    jurisdiction: doc.jurisdiction,
    score: doc.similarity ?? 0.5,
    layer,
    citationRef: meta.citation_ref as string | undefined,
  };
}

function chunkKey(c: AutoRagChunk): string {
  const norm = c.content.slice(0, 120).replace(/\s+/g, ' ').toLowerCase();
  return `${c.layer}:${c.citationRef || norm}`;
}

async function fetchUnifiedBase(
  query: string,
  jurisdiction: string,
  domain: string,
  topK: number,
): Promise<{ chunks: AutoRagChunk[]; methods: string[] }> {
  const methods: string[] = [];
  const lists: Array<Array<{ key: string; chunk: AutoRagChunk }>> = [];

  const [kcResult, primaryDocs, smeDocs] = await Promise.all([
    retrieveKnowledge(query, { jurisdiction, domain, topK }).catch((e) => {
      logger.warn('auto-rag knowledge_chunks failed', { error: (e as Error).message });
      return { chunks: [], retrievalMethod: 'none' as const, totalFound: 0 };
    }),
    retrieveDocuments({
      query,
      jurisdiction: jurisdiction as 'IN' | 'UK' | 'US' | 'EU' | 'SG' | 'GCC',
      namespace: NAMESPACE_BY_JURIS[jurisdiction] || NAMESPACE_BY_JURIS.IN,
      topK,
    }).catch(() => [] as RagDocument[]),
    retrieveDocuments({
      query,
      jurisdiction: jurisdiction as 'IN' | 'UK' | 'US' | 'EU' | 'SG' | 'GCC',
      namespace: SME_NAMESPACE_BY_JURIS[jurisdiction] || SME_NAMESPACE_BY_JURIS.IN,
      topK: Math.max(3, Math.floor(topK / 2)),
    }).catch(() => [] as RagDocument[]),
  ]);

  if (kcResult.chunks.length > 0) {
    methods.push(`knowledge_chunks:${kcResult.retrievalMethod}`);
    lists.push(
      kcResult.chunks.map((c) => ({ key: chunkKey(knowledgeToAuto(c)), chunk: knowledgeToAuto(c) })),
    );
  }
  if (primaryDocs.length > 0) {
    methods.push('rag_documents:vector');
    lists.push(
      primaryDocs.map((d) => {
        const c = ragDocToAuto(d);
        return { key: chunkKey(c), chunk: c };
      }),
    );
  }
  if (smeDocs.length > 0) {
    methods.push('rag_documents:sme-approved');
    lists.push(
      smeDocs.map((d) => {
        const c = ragDocToAuto(d, 'sme_approved');
        return { key: chunkKey(c), chunk: c };
      }),
    );
  }

  const merged = lists.length > 0 ? reciprocalRankFusion(lists).slice(0, topK) : [];
  return { chunks: merged, methods };
}

function buildCapabilityCtx(req: AutoRagRequest, capabilityTier: CapabilityTier): CapabilityContext {
  return {
    requestId: `auto-rag-${Date.now()}`,
    userId: req.userId,
    tenantId: req.tenantId,
    jurisdiction: req.jurisdiction || 'IN',
    tier: capabilityTier,
    agentKey: 'auto-rag-router',
  };
}

async function invokeAdaptiveLayer(
  req: AutoRagRequest,
  ctx: CapabilityContext,
  capabilityTier: CapabilityTier,
): Promise<AutoRagChunk[]> {
  if (!tierHasCapability(capabilityTier, 'rag.adaptive')) return [];
  try {
    const r = await capabilityManifest.invoke(
      'rag.adaptive',
      { query: req.query, context: { jurisdiction: req.jurisdiction, taskType: req.taskType, tier: req.tier } },
      ctx,
    );
    const payload = r as { documents?: Array<{ content: string; source?: string; title?: string; relevanceScore?: number }>; fusedContext?: string };
    const docs = payload?.documents || [];
    return docs.slice(0, req.topK ?? 5).map((d, i) => ({
      id: `adaptive:${i}`,
      source: String(d.source || 'adaptive-rag'),
      title: String(d.title || `Adaptive source ${i + 1}`),
      content: d.content,
      jurisdiction: req.jurisdiction || 'IN',
      score: d.relevanceScore ?? 0.7,
      layer: 'adaptive' as const,
    }));
  } catch (e) {
    logger.warn('auto-rag adaptive layer failed', { error: (e as Error).message });
    return [];
  }
}

async function invokeCorrectiveLayer(
  req: AutoRagRequest,
  ctx: CapabilityContext,
  capabilityTier: CapabilityTier,
  seedDocs: AutoRagChunk[],
): Promise<AutoRagChunk[]> {
  if (!tierHasCapability(capabilityTier, 'rag.corrective') || seedDocs.length >= 3) return [];
  try {
    const pipeline = await capabilityManifest.invoke(
      'rag.corrective',
      {
        query: req.query,
        documents: seedDocs.map((d) => ({ content: d.content, source: d.source })),
      },
      ctx,
    ) as { success?: boolean; finalContext?: string; documents?: Array<{ content: string; source: string; grade?: string }> };

    if (pipeline?.finalContext?.trim()) {
      return [{
        id: 'corrective:0',
        source: 'corrective-rag',
        title: 'Corrective-RAG fused context',
        content: pipeline.finalContext,
        jurisdiction: req.jurisdiction || 'IN',
        score: 0.78,
        layer: 'corrective' as const,
      }];
    }

    const relevant = (pipeline?.documents || []).filter(
      (d) => d.grade === 'relevant' || d.grade === 'partially_relevant',
    );
    return relevant.slice(0, req.topK ?? 5).map((d, i) => ({
      id: `corrective:${i}`,
      source: String(d.source || 'corrective-rag'),
      title: `Corrected source ${i + 1}`,
      content: d.content,
      jurisdiction: req.jurisdiction || 'IN',
      score: 0.75,
      layer: 'corrective' as const,
    }));
  } catch (e) {
    logger.warn('auto-rag corrective layer failed', { error: (e as Error).message });
    return [];
  }
}

async function invokeLightRagLayer(
  req: AutoRagRequest,
  ctx: CapabilityContext,
  capabilityTier: CapabilityTier,
): Promise<AutoRagChunk[]> {
  if (!tierHasCapability(capabilityTier, 'rag.lightrag')) return [];
  try {
    const r = await capabilityManifest.invoke(
      'rag.lightrag',
      { query: req.query, mode: 'mix', limit: req.topK ?? 5 },
      ctx,
    );
    const result = r as { chunks?: Array<{ content: string }>; context?: string; vectorContext?: string };
    const texts: string[] = [];
    if (result?.context) texts.push(result.context);
    if (result?.vectorContext) texts.push(result.vectorContext);
    for (const c of result?.chunks || []) {
      if (c.content) texts.push(c.content);
    }
    return texts.slice(0, req.topK ?? 5).map((content, i) => ({
      id: `lightrag:${i}`,
      source: 'lightrag',
      title: `LightRAG chunk ${i + 1}`,
      content,
      jurisdiction: req.jurisdiction || 'IN',
      score: 0.65,
      layer: 'lightrag' as const,
    }));
  } catch (e) {
    logger.warn('auto-rag lightrag layer failed', { error: (e as Error).message });
    return [];
  }
}

async function invokeGraphRagLayer(
  req: AutoRagRequest,
  ctx: CapabilityContext,
  capabilityTier: CapabilityTier,
): Promise<AutoRagChunk[]> {
  if (!tierHasCapability(capabilityTier, 'rag.graph')) return [];
  try {
    const r = await capabilityManifest.invoke(
      'rag.graph',
      {
        query: req.query,
        orgId: req.tenantId || 'default',
        userId: req.userId || 'system',
        maxResults: req.topK ?? 5,
      },
      ctx,
    );
    const results = Array.isArray(r) ? r : (r as { results?: unknown[] })?.results || [];
    return (results as Array<{ entityValue?: string; relatedStatutes?: string[]; relatedSections?: string[]; score?: number }>)
      .slice(0, req.topK ?? 5)
      .map((g, i) => ({
        id: `graphrag:${i}`,
        source: 'graphrag',
        title: String(g.entityValue || `Graph entity ${i + 1}`),
        content: [
          g.entityValue ? `Entity: ${g.entityValue}` : '',
          g.relatedStatutes?.length ? `Statutes: ${g.relatedStatutes.join(', ')}` : '',
          g.relatedSections?.length ? `Sections: ${g.relatedSections.join(', ')}` : '',
        ].filter(Boolean).join('\n'),
        jurisdiction: req.jurisdiction || 'IN',
        score: g.score ?? 0.8,
        layer: 'graphrag' as const,
      }))
      .filter((c) => c.content.length > 0);
  } catch (e) {
    logger.warn('auto-rag graphrag layer failed', { error: (e as Error).message });
    return [];
  }
}

/** Format unified context block for prompt injection. */
/**
 * NV-RAG-CHAR-BUDGET-001: truncate a retrieved excerpt on a sentence boundary.
 *
 * A hard slice mid-sentence is worse than useless for legal drafting — the model
 * completes the dangling clause and invents the rest. Prefer the last sentence
 * terminator inside the budget; fall back to the last word boundary; only then
 * cut hard. The ellipsis is explicit so the model can see the excerpt is partial
 * and does not present it as the complete provision.
 */
function truncateExcerpt(text: string, cap: number): { text: string; truncated: boolean } {
  const s = String(text ?? '');
  if (cap <= 0 || s.length <= cap) return { text: s, truncated: false };
  const window = s.slice(0, cap);
  const sentenceEnd = Math.max(
    window.lastIndexOf('. '), window.lastIndexOf('.\n'),
    window.lastIndexOf('; '), window.lastIndexOf('?\n'), window.lastIndexOf('!\n'),
  );
  // Only honour a sentence break if it keeps a useful majority of the budget;
  // otherwise a single long sentence would collapse the excerpt to almost nothing.
  if (sentenceEnd > cap * 0.5) {
    return { text: `${window.slice(0, sentenceEnd + 1)} […]`, truncated: true };
  }
  const wordEnd = window.lastIndexOf(' ');
  const cut = wordEnd > cap * 0.5 ? window.slice(0, wordEnd) : window;
  return { text: `${cut} […]`, truncated: true };
}

/**
 * NV-CITE-GROUND-001 — the display reference for one retrieved authority, or
 * `undefined` when we have nothing to add beyond the title.
 *
 * Suppressing a reference that merely repeats the title is the whole point:
 * `caseToChunk()` sets `citationRef = citation || title`, so on High Court and
 * District Court rows (where the NYS ingest mappers hardcode `citation: null` —
 * `ingest-rds.ts` `mapHcRow` / `mapDcRow`) a naive render produces
 * `X versus Y — X versus Y`, which spends tokens to say nothing and trains the
 * model to treat the "citation" slot as noise.
 */
function authorityRefFor(c: AutoRagChunk): string | undefined {
  const ref = String(c.authorityRef ?? c.citationRef ?? '').trim();
  if (!ref) return undefined;
  const title = String(c.title ?? '').trim();
  if (ref.toLowerCase() === title.toLowerCase()) return undefined;
  return ref;
}

export function formatAutoRagContext(
  result: AutoRagResult,
  budget?: { ragChunkCharCap?: number; ragTotalCharCap?: number },
): string {
  if (result.chunks.length === 0) return '';
  // Full § RETRIEVAL POLICY is injected by Queen Step-0 (always). Here we only
  // label the stack so the model can see which layers actually hit.
  const stack = describeRetrievalStack(result.layersUsed);

  // NV-RAG-CHAR-BUDGET-001: `ragTopK` bounded chunk COUNT but nothing bounded
  // chunk SIZE, so this function interpolated `c.content` raw. On the partner
  // floor (topK 16) with judgment-length excerpts that is ~18,000 tokens of
  // retrieval alone — 7.2x the `chat` prompt budget. Callers that pass no budget
  // keep the previous unbounded behaviour, so this cannot silently truncate a
  // path that was not measured.
  const chunkCap = Number(budget?.ragChunkCharCap) > 0 ? Number(budget!.ragChunkCharCap) : 0;
  const totalCap = Number(budget?.ragTotalCharCap) > 0 ? Number(budget!.ragTotalCharCap) : 0;

  /* NV-CITE-GROUND-001 (2026-08-19) — reserve budget for the authority roll-up
   * BEFORE spending it on excerpts.
   *
   * The roll-up is the cheapest thing in this block and the only part that
   * survives a truncated excerpt, so it must not be the part that gets dropped.
   * 20% of the total (hard-capped at 1,200 chars ≈ 300 tokens) buys ~16 authority
   * lines; the excerpt loop then works against the remainder, so the declared
   * `ragTotalCharCap` stays a true ceiling for the whole block rather than
   * quietly growing by the size of the new section. */
  const authorityReserve = totalCap > 0 ? Math.min(1_200, Math.floor(totalCap * 0.2)) : 1_200;
  const excerptCap = totalCap > 0 ? Math.max(1, totalCap - authorityReserve) : 0;

  const parts: string[] = [];
  const authorityLines: string[] = [];
  let authorityChars = 0;
  let used = 0;
  let dropped = 0;
  let truncatedCount = 0;

  for (let i = 0; i < result.chunks.length; i++) {
    const c = result.chunks[i];
    const ref = authorityRefFor(c);
    const citeRef = String(c.citationRef ?? '').trim();
    const citeSuffix = ref
      ? ` — ${ref}`
      : citeRef && citeRef.toLowerCase() !== String(c.title ?? '').trim().toLowerCase()
        ? ` — citationRef: ${citeRef}`
        : citeRef
          ? ` — ${citeRef}`
          : '';
    const label = `[${i + 1}|${c.layer}|${c.source}] ${c.title}${citeSuffix}`;
    const { text, truncated } = chunkCap
      ? truncateExcerpt(c.content, chunkCap)
      : { text: String(c.content ?? ''), truncated: false };

    // Chunks arrive in relevance order, so spending the total budget on the
    // highest-ranked excerpts and dropping the tail is the correct trade.
    if (excerptCap && used + text.length > excerptCap) {
      dropped = result.chunks.length - i;
      break;
    }
    if (truncated) truncatedCount++;
    used += text.length;
    parts.push(`${label}\n${text}`);

    /* Only authorities that were actually rendered get listed. Inviting the
     * model to cite a judgment whose excerpt was dropped for budget is how a
     * grounding fix turns into a fabrication vector. */
    const rollRef = ref || (citeRef && citeRef.toLowerCase() !== String(c.title ?? '').trim().toLowerCase() ? citeRef : '');
    if (rollRef) {
      const line = `${i + 1}. ${c.title} — ${rollRef}`;
      if (authorityChars + line.length <= authorityReserve) {
        authorityLines.push(line);
        authorityChars += line.length + 1;
      }
    }
  }

  // State the elision in-band. If retrieval was trimmed the model must not claim
  // to have surveyed the full authority set.
  const notes: string[] = [];
  if (truncatedCount > 0) notes.push(`${truncatedCount} excerpt(s) shortened`);
  if (dropped > 0) notes.push(`${dropped} lower-ranked source(s) omitted for budget`);
  const budgetNote = notes.length ? ` | ${notes.join('; ')}` : '';

  const header =
    `--- Relevant Legal Knowledge (Auto-RAG: ${result.layersUsed.join('+')} | stack: ${stack}${budgetNote}) ---`;

  /* The numbered roll-up, in the format already proven on the SDK research path
   * (`jrx-sdk-gateway-routes.ts:1147`). The numbers match the `[n|layer|source]`
   * excerpt tags below it, so "authority 2" is unambiguous in both directions.
   *
   * Without this the only place a case name appeared was inside a debug-shaped
   * tag (`[3|nys_global|global:caselaw:IN] SUSHILA AGGARWAL …`) with the reporter
   * citation absent entirely — measured, see NV-CITE-GROUND-001 in CHANGELOG. */
  const authorityBlock = authorityLines.length
    ? `AUTHORITIES SUPPLIED (${authorityLines.length}) — cite these by name and reference for every proposition that rests on them; cite nothing that is not here:\n`
      + `${authorityLines.join('\n')}\n\n`
    : '';

  /* NV-AUTHORITY-SALIENCE-001 — say so when the tier the lawyer asked for is
   * not in the box.
   *
   * The overlay already forbids inventing a citation. Presenting four routine
   * High Court bail orders in answer to "leading Supreme Court authorities" is
   * the adjacent failure: nothing is fabricated, yet the governing-authority
   * slot is filled with material that does not belong there, and the lawyer has
   * no way to tell. Retrieval genuinely cannot always identify the leading
   * authority — `judgments.search_tsv` indexes metadata only and `full_text` is
   * NULL corpus-wide, so a landmark's significance is not searchable — and the
   * honest response to that is to state it, not to dress it up.
   *
   * Rendered only when a tier was actually requested; silent otherwise. */
  const gapNote = renderAuthorityGapNote(result);

  return `\n\n${header}\n${authorityBlock}${gapNote}${parts.join('\n\n')}`;
}

function renderAuthorityGapNote(result: AutoRagResult): string {
  const request = result.authoritySalience?.request;
  const gap = assessAuthorityGap(result.chunks, request ?? null);
  if (!request || !gap) return '';
  const tier = describeAuthorityTier(request.tier);

  if (gap.unmet) {
    return `AUTHORITY GAP — the question asks for ${tier} authority and retrieval returned NONE. `
      + `The corpus index covers judgment metadata only (title, parties, reporter citation, headnote); `
      + `judgment bodies are not indexed, so a landmark cannot be found by what it decided. `
      + `State plainly that no ${tier} authority was retrieved, reason from the statutory text and the `
      + `authorities that WERE supplied, and do not present a lower-court order as if it were the `
      + `governing ${tier} authority. Do not supply a ${tier} case name or citation from memory.\n\n`;
  }
  if (gap.citableCount === 0) {
    return `AUTHORITY NOTE — ${gap.tierCount} ${tier} authority(ies) were retrieved but none carries a `
      + `reporter citation, so each can only be identified by court, year and case number. Cite them that `
      + `way; do not upgrade a case-number reference into a reporter citation.\n\n`;
  }
  return '';
}

interface AutoRagStats {
  attempts: number;
  hits: number;
  byLayer: Record<string, number>;
  avgLatencyMs: number;
}

const stats: AutoRagStats = { attempts: 0, hits: 0, byLayer: {}, avgLatencyMs: 0 };

export function getAutoRagStats(): AutoRagStats & { hitRate: number } {
  return {
    ...stats,
    hitRate: stats.attempts > 0 ? Math.round((stats.hits / stats.attempts) * 1000) / 1000 : 0,
  };
}

/**
 * Unified Auto-RAG retrieval — tier-aware, multi-store, manifest-driven.
 */
export async function autoRagRetrieve(req: AutoRagRequest): Promise<AutoRagResult> {
  const start = Date.now();
  stats.attempts += 1;

  const jurisdiction = normalizeRagJurisdiction(req.jurisdiction);
  const domain = req.domain || 'ALL';
  const topK = req.topK ?? 8;
  const capabilityTier = resolveCapabilityTier(req.tier);
  const intent = classifyRagIntent(req.query, req.taskType);
  const ctx = buildCapabilityCtx(req, capabilityTier);
  const layersUsed: string[] = ['unified-base'];
  const retrievalMethods: string[] = [];

  const useCrossJurisdiction =
    req.crossJurisdiction === true || intent === 'comparative_analysis';

  let baseChunks: AutoRagChunk[];
  let baseMethods: string[];
  if (useCrossJurisdiction) {
    const perJxTopK = Math.max(2, Math.ceil(topK / JRX_SIX_JURISDICTIONS.length));
    const packs = await Promise.all(
      JRX_SIX_JURISDICTIONS.map((jx) =>
        fetchUnifiedBase(req.query, jx, domain, perJxTopK),
      ),
    );
    baseChunks = packs.flatMap((p) => p.chunks);
    baseMethods = [...new Set(packs.flatMap((p) => p.methods))];
    layersUsed.push('cross-jurisdiction');
  } else {
    const single = await fetchUnifiedBase(req.query, jurisdiction, domain, topK);
    baseChunks = single.chunks;
    baseMethods = single.methods;
  }
  retrievalMethods.push(...baseMethods);

  const extraLists: Array<Array<{ key: string; chunk: AutoRagChunk }>> = [
    baseChunks.map((c) => ({ key: chunkKey(c), chunk: c })),
  ];

  // NV-RAG-PARALLEL-EXTRAS-001 — run NYS / LightRAG / adaptive|corrective / GraphRAG
  // in parallel under a hard deadline so sync UX never waits on serial 45s hops.
  //
  // NV-CITE-GROUND-001 (2026-08-19) — default raised 2,500 → 8,000 ms.
  //
  // The 2,500 ms cap was optimising the wrong axis. Measured from inside the
  // gateway, NYS `POST /retrieve` completes in 285–464 ms (6x headroom), yet a
  // captured trace showed the deadline firing and then
  // `NYS knowledge recovered after retry` arriving 1.2 s AFTER the answer was
  // composed — on a request whose total latency was 65 s. So we were discarding
  // the caselaw layer to protect 5.5 s out of 65 s, i.e. ~4% of a request, and
  // the retrieval work completed anyway: the deadline stops us JRXTING, it does
  // not stop the hop.
  //
  // 8,000 ms covers the observed recovery path. With the raise, the per-hop cap
  // becomes `min(8000, JRX_ECOSYSTEM_KNOWLEDGE_SYNC_TIMEOUT_MS=3000)` = 3,000 ms, so a
  // first attempt that hangs aborts at 3.0 s, backs off 250 ms, and the retry
  // lands in ~450 ms — ~3.7 s total, which is exactly the "recovered 1.2 s too
  // late" case under the old 2.5 s budget, and comfortably inside 8 s now. It is
  // still well inside `parallelTimeoutMs` (20–35 s) so it cannot become the
  // binding constraint on the outer race. The env override is retained and the
  // 15 s hard ceiling is unchanged.
  const extrasDeadlineMs = (() => {
    const n = Number(process.env.JRX_AUTO_RAG_EXTRAS_DEADLINE_MS);
    return Number.isFinite(n) && n >= 500 ? Math.min(15_000, Math.floor(n)) : 8_000;
  })();

  type ExtraHit = { layer: string; method?: string; chunks: AutoRagChunk[] };
  const extraJobs: Array<Promise<ExtraHit | null>> = [];

  // NV-JRX-LLMREQUIRED-001 — NYS's own "an LLM is unnecessary" verdict, plus the
  // rendered zero-token answer when the local scope gate agrees. Runs in the
  // same parallel race as the retrieval extras, so it adds no serial latency.
  //
  // The probe is a second NYS round trip on top of `retrieveNysGlobalKnowledge`
  // (which flattens the same plan into chunks and is the SSoT for that). It is
  // gated on `couldBeDeterministic` — a pure regex requiring a section or
  // reporter citation — so it only fires on the narrow slice where it can
  // replace a ~30 s frontier completion with ~50 ms of I/O.
  let deterministic: AutoRagResult['deterministic'];
  /* NV-AUTHORITY-SALIENCE-001 — the tier request is derived from the PROMPT, not
   * from the NYS hop's return value.
   *
   * It used to be read off `retrieveNysGlobalKnowledge`'s result, which made the
   * disclosure conditional on that hop having succeeded — so the one case the
   * disclosure exists for ("you asked for Supreme Court authority and retrieval
   * found none") was the case that could not render it: NYS timing out, tripping
   * its breaker, answering 503 "corpus is busy", or falling through to statutes
   * all produced silence. Detection is pure regex with no I/O, so there is no
   * reason for it to depend on the network at all. Set below, after ranking. */
  let tierRequest: AuthorityTierRequest | undefined;
  let authorityGap: AuthorityGap | null = null;
  const deterministicJob: Promise<void> = (async () => {
    if (!isJrxFeatureOn('nysKnowledgePlane')) return;
    try {
      const { couldBeDeterministic, tryNysDeterministicAnswer } = await import(
        './jrx-nys-deterministic-answer.js'
      );
      if (!couldBeDeterministic(req.query)) return;
      const answer = await tryNysDeterministicAnswer({
        query: req.query,
        jurisdiction,
        timeoutMs: extrasDeadlineMs,
      });
      if (answer) {
        deterministic = { ...(deterministic ?? {}), llmRequired: false, nysIntent: answer.intent, answer };
      }
    } catch (e) {
      logger.warn('auto-rag deterministic probe failed (non-fatal)', {
        error: (e as Error).message,
      });
    }
  })();

  if (isJrxFeatureOn('nysKnowledgePlane')) {
    extraJobs.push((async (): Promise<ExtraHit | null> => {
      try {
        const { retrieveNysGlobalKnowledge } = await import('./jrx-nys-knowledge-retriever.js');
        const nys = await retrieveNysGlobalKnowledge({
          query: req.query,
          jurisdiction,
          topK,
          // Prefer short sync timeout when retriever honors it
          timeoutMs: Math.min(extrasDeadlineMs, Number(process.env.JRX_ECOSYSTEM_KNOWLEDGE_SYNC_TIMEOUT_MS || 3000)),
        });
        if (nys.llmRequired === false) {
          // Carried even when the local scope gate later declines: the verdict
          // is useful telemetry for how much traffic *could* go deterministic.
          deterministic = { ...(deterministic ?? {}), llmRequired: false, nysIntent: nys.intent };
        }
        if (nys.chunks.length > 0) {
          return { layer: 'nys_global', method: nys.method, chunks: nys.chunks };
        }
        if (nys.method && nys.method !== 'nys:flag_off') {
          retrievalMethods.push(nys.method);
        }
      } catch (e) {
        logger.warn('auto-rag NYS global layer failed (non-fatal)', { error: (e as Error).message });
      }
      return null;
    })());
  }

  // NV-LEGAL-FEED-RAG-001 — prepend today's legal intelligence digest for IN counsel research.
  if (
    jurisdiction === 'IN'
    && (intent === 'precedent_research' || intent === 'statute_research' || intent === 'general')
  ) {
    extraJobs.push((async (): Promise<ExtraHit | null> => {
      try {
        const { getLegalIntelligenceFeed } = await import('./jrx-legal-intelligence-feed-service.js');
        const digest = await getLegalIntelligenceFeed({ jurisdiction: 'IN', limit: 3 });
        if (!digest?.items?.length) return null;
        const chunks: AutoRagChunk[] = digest.items.slice(0, 3).map((item, idx) => ({
          id: `legal-feed:${item.id}`,
          source: 'global:legal-intel-feed:IN',
          title: item.title,
          content: [
            item.summary,
            item.whyItMatters ? `Why it matters: ${item.whyItMatters}` : '',
            item.sourceName ? `Source: ${item.sourceName}` : '',
          ].filter(Boolean).join('\n').slice(0, 2000),
          jurisdiction: 'IN',
          score: 0.58 - idx * 0.04,
          layer: 'rag_documents',
          citationRef: item.sourceUrl || item.title,
        }));
        return { layer: 'legal_intel_feed', method: 'feed:digest', chunks };
      } catch (e) {
        logger.warn('auto-rag legal intel feed failed (non-fatal)', { error: (e as Error).message });
        return null;
      }
    })());
  }

  if (
    tierHasCapability(capabilityTier, 'rag.lightrag')
    && (intent === 'statute_research' || intent === 'general')
  ) {
    extraJobs.push((async (): Promise<ExtraHit | null> => {
      const lightChunks = await invokeLightRagLayer(req, ctx, capabilityTier);
      return lightChunks.length > 0
        ? { layer: 'lightrag', method: 'lightrag:mix', chunks: lightChunks }
        : null;
    })());
  }

  if (tierHasCapability(capabilityTier, 'rag.adaptive')) {
    extraJobs.push((async (): Promise<ExtraHit | null> => {
      const adaptiveChunks = await invokeAdaptiveLayer(req, ctx, capabilityTier);
      if (adaptiveChunks.length > 0) {
        return { layer: 'adaptive', method: 'adaptive', chunks: adaptiveChunks };
      }
      const correctiveChunks = await invokeCorrectiveLayer(req, ctx, capabilityTier, baseChunks);
      return correctiveChunks.length > 0
        ? { layer: 'corrective', method: 'corrective', chunks: correctiveChunks }
        : null;
    })());
  }

  if (
    tierHasCapability(capabilityTier, 'rag.graph')
    && (intent === 'precedent_research' || intent === 'comparative_analysis' || capabilityTier === 'sovereign')
  ) {
    extraJobs.push((async (): Promise<ExtraHit | null> => {
      const graphChunks = await invokeGraphRagLayer(req, ctx, capabilityTier);
      return graphChunks.length > 0
        ? { layer: 'graphrag', method: 'graphrag', chunks: graphChunks }
        : null;
    })());
  }

  if (extraJobs.length > 0) {
    const timed = extraJobs.map((job) =>
      Promise.race([
        job,
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), extrasDeadlineMs);
        }),
      ]),
    );
    const settled = await Promise.allSettled(timed);    let anyHit = false;
    for (const r of settled) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      anyHit = true;
      const hit = r.value;
      layersUsed.push(hit.layer);
      if (hit.method) retrievalMethods.push(hit.method);
      extraLists.push(hit.chunks.map((c) => ({ key: chunkKey(c), chunk: c })));
    }
    if (!anyHit) {
      logger.warn('auto-rag extras deadline — using unified-base only', {
        extrasDeadlineMs,
        jobs: extraJobs.length,
      });
    }
  }

  let merged = reciprocalRankFusion(extraLists).slice(0, topK);
  let confidence = scoreConfidence(merged);

  // Bounded by the same extras deadline, so a slow NYS cannot delay the result.
  await Promise.race([
    deterministicJob,
    new Promise<void>((resolve) => {
      setTimeout(resolve, extrasDeadlineMs);
    }),
  ]);

  // NV-AGENTIC-RR-001 — bounded agentic re-retrieval. When the first pass is
  // low-confidence, reformulate the query (LLM via the safety ring when
  // JRX_F_RAG_LLM_REFORMULATE is on, else a deterministic heuristic rewrite),
  // run ONE extra unified-base retrieval, re-fuse (RRF) and recompute
  // confidence — keeping the new result only if it does not lower confidence.
  // Fully fail-safe: any error preserves the original result.
  const RR_MIN_CONF = Number(process.env.JRX_RAG_RERETRIEVE_MIN_CONFIDENCE || '0.55');
  // NV-JRX-LLMREQUIRED-001 — re-retrieval's query reformulation is itself an LLM
  // call (`llmReformulateQuery`). Paying for it to improve grounding we are
  // about to bypass entirely would defeat the deterministic tier.
  if (isJrxFeatureOn('agenticReretrieval') && confidence < RR_MIN_CONF && !deterministic?.answer) {
    try {
      const weakSnippets = merged.slice(0, 3).map((c) => c.content);
      let reformulated = await correctiveRAGService.llmReformulateQuery(req.query, weakSnippets);
      if (!reformulated) {
        const heuristic = await correctiveRAGService.rewriteQuery(req.query);
        if (heuristic && heuristic.toLowerCase() !== req.query.toLowerCase()) {
          reformulated = heuristic;
        }
      }
      if (reformulated && reformulated.toLowerCase() !== req.query.toLowerCase()) {
        const { chunks: rrChunks, methods: rrMethods } = await fetchUnifiedBase(
          reformulated,
          jurisdiction,
          domain,
          topK,
        );
        const rrExtra: Array<Array<{ key: string; chunk: AutoRagChunk }>> = [];
        if (rrChunks.length > 0) {
          rrExtra.push(rrChunks.map((c) => ({ key: chunkKey(c), chunk: c })));
        }
        // Also re-query NYS global plane with the reformulated query
        if (isJrxFeatureOn('nysKnowledgePlane')) {
          try {
            const { retrieveNysGlobalKnowledge } = await import('./jrx-nys-knowledge-retriever.js');
            const nysRr = await retrieveNysGlobalKnowledge({
              query: reformulated,
              jurisdiction,
              topK,
            });
            if (nysRr.chunks.length > 0) {
              rrExtra.push(nysRr.chunks.map((c) => ({ key: chunkKey(c), chunk: c })));
              rrMethods.push(`reretrieval:${nysRr.method}`);
            }
          } catch (nysRrErr) {
            logger.warn('auto-rag NYS re-retrieval failed (non-fatal)', {
              error: (nysRrErr as Error).message,
            });
          }
        }
        if (rrExtra.length > 0) {
          const beforeConf = confidence;
          for (const list of rrExtra) extraLists.push(list);
          const reMerged = reciprocalRankFusion(extraLists).slice(0, topK);
          const reConf = scoreConfidence(reMerged);
          if (reConf >= beforeConf) {
            merged = reMerged;
            confidence = reConf;
            layersUsed.push('re-retrieval');
            retrievalMethods.push(...rrMethods.map((m) => `reretrieval:${m}`));
          }
          logger.info('auto-rag re-retrieval pass', {
            beforeConf: Math.round(beforeConf * 1000) / 1000,
            afterConf: Math.round(reConf * 1000) / 1000,
            kept: reConf >= beforeConf,
            addedChunks: rrExtra.reduce((n, l) => n + l.length, 0),
          });
        }
      }
    } catch (e) {
      logger.warn('auto-rag re-retrieval failed (non-fatal)', { error: (e as Error).message });
    }
  }

  // NV-RAG-RERANK-001 — optional neural cross-encoder rerank of the fused set.
  // This is the highest-ROI RAG precision win when a rerank provider
  // (CROSS_ENCODER_URL → Cohere → Voyage) is configured; the reranker degrades
  // to a logged keyword-overlap heuristic when none is. Flag-gated and fully
  // fail-safe — any error keeps the existing RRF order untouched.
  if (isJrxFeatureOn('ragNeuralRerank') && merged.length > 1) {
    try {
      const { nvLegalRerankerService } = await import('./rag/jrx-legal-reranker-service.js');
      // Honesty: skip hop when only keyword heuristic would run (unless explicitly allowed).
      const allowHeuristic = process.env.JRX_RAG_RERANK_ALLOW_HEURISTIC === '1';
      if (!nvLegalRerankerService.hasNeuralProvider() && !allowHeuristic) {
        logger.info('auto-rag rerank skipped — no neural provider configured');
      } else {
      const ranked = await nvLegalRerankerService.rerankLegal(
        req.query,
        merged.map((c) => ({
          id: c.id,
          content: c.content,
          score: c.score,
          jurisdiction: c.jurisdiction as any,
          metadata: { layer: c.layer },
        })),
        { jurisdiction: (jurisdiction as any) || undefined, topK },
      );
      if (ranked.length > 0) {
        /*
         * NV-RAG-MMR-001 (2026-08-18) — apply MMR diversity after the cross-encoder.
         *
         * `applyMMR` was reachable only through `rerankResults`, which nothing on the
         * retrieval path calls: Auto-RAG calls `rerankLegal` instead, and that returns a
         * purely relevance-ordered list. So the fused set was optimised for precision with
         * no diversity term, and a multi-issue question could fill its whole budget with
         * near-duplicate passages about the strongest single issue.
         *
         * We do NOT call `rerankResults` here even though it already chains
         * rerankLegal → applyMMR: it performs its own RRF over a bm25/vector split, and
         * this path has already fused several layers (unified-base, nys_global, lightrag,
         * graphrag, …). Feeding it pre-fused input would fuse twice and distort the ranking.
         *
         * λ (relevance vs diversity) is env-tunable and defaults to the service default.
         * Fail-safe: any error leaves the cross-encoder order untouched.
         */
        const byId = new Map(merged.map((c) => [c.id, c]));
        let ordered = ranked;
        try {
          const lambdaRaw = Number(process.env.JRX_RAG_MMR_LAMBDA);
          const lambda = Number.isFinite(lambdaRaw) && lambdaRaw > 0 && lambdaRaw <= 1
            ? lambdaRaw
            : undefined;
          const diverse = nvLegalRerankerService.applyMMR(ranked, lambda as number, topK);
          if (Array.isArray(diverse) && diverse.length > 0) ordered = diverse;
        } catch (mmrErr) {
          logger.warn('auto-rag MMR diversity failed (keeping rerank order)', {
            error: (mmrErr as Error).message,
          });
        }
        const reordered: AutoRagChunk[] = [];
        for (const r of ordered) {
          const chunk = byId.get(r.id);
          if (chunk) {
            chunk.score = r.finalScore;
            reordered.push(chunk);
          }
        }
        if (reordered.length > 0) {
          merged = reordered.slice(0, topK);
          layersUsed.push('rerank');
          retrievalMethods.push(
            nvLegalRerankerService.hasNeuralProvider() ? 'rerank:neural' : 'rerank:heuristic',
          );
          if (ordered !== ranked) retrievalMethods.push('mmr:diversity');
        }
      }
      }
    } catch (e) {
      logger.warn('auto-rag neural rerank failed (non-fatal)', { error: (e as Error).message });
    }
  }

  const latencyMs = Date.now() - start;

  /* NV-AUTHORITY-SALIENCE-001 — the last ranking step, and deliberately last.
   *
   * It runs AFTER the cross-encoder and MMR because those two answer "how
   * relevant is this passage" and "is it saying something new", and neither can
   * see the one thing the metadata-only index does expose: which court decided
   * it. It is a bounded rank credit (3 places; 2 when the tier was inferred
   * from "leading"/"landmark" rather than named), not a score multiplier, so a
   * strongly-ranked authority from another tier still out-ranks a weak one from
   * the requested tier. That bound is what stops this from becoming "Supreme
   * Court first, always" — which would be a regression on every state-specific
   * procedural question, where the High Court judgment IS the right answer.
   *
   * No new ranker: `applyTierSalience` is a permutation of the list the existing
   * fusion/rerank path produced. */
  {
    const salience = resolveAuthoritySalience(req.query, merged);
    merged = salience.ranked;
    tierRequest = salience.request ?? undefined;
    authorityGap = salience.gap;
    if (salience.request) {
      logger.info('auto-rag authority salience applied', {
        tier: salience.request.tier,
        inferred: salience.request.inferred,
        cues: salience.request.cues.slice(0, 4),
        contentQuery: salience.request.contentQuery,
        reordered: salience.reordered,
        tierCount: authorityGap?.tierCount ?? 0,
        citableCount: authorityGap?.citableCount ?? 0,
        unmet: authorityGap?.unmet ?? false,
      });
    }

    /* NV-LEADING-SC-SALIENCE-001 — when SC tier was requested but gap remains,
     * float reporter-cited SC rows to the front so AUTHORITIES SUPPLIED carries
     * locatable leading authority instead of HC bail orders with headnotes only.
     * NV-NI-ACT-SC-SALIENCE-001 — same float for NI Act §138/139 research where
     * HC dishonour orders otherwise bury SC presumption authorities. */
    const niActAuthorityQuery =
      /\b(section\s*(?:138|139)|negotiable instruments act|ni\s*act|cheque dishonou?r)\b/i.test(req.query);
    if (tierRequest?.tier === 'sc' && merged.length > 1 && (authorityGap?.unmet || niActAuthorityQuery)) {
      const scCitable = merged.filter((c) => c.courtTier === 'sc' && c.hasReporterCitation);
      if (scCitable.length > 0) {
        const rest = merged.filter((c) => !(c.courtTier === 'sc' && c.hasReporterCitation));
        merged = [...scCitable, ...rest].slice(0, topK);
      }
    }
  }

  if (merged.length > 0) stats.hits += 1;
  for (const layer of layersUsed) {
    stats.byLayer[layer] = (stats.byLayer[layer] || 0) + 1;
  }
  stats.avgLatencyMs = Math.round(
    (stats.avgLatencyMs * (stats.attempts - 1) + latencyMs) / stats.attempts,
  );

  const result: AutoRagResult = {
    chunks: merged,
    contextBlock: '',
    intent,
    capabilityTier,
    layersUsed,
    retrievalMethods,
    totalFound: merged.length,
    confidence,
    latencyMs,
    ...(deterministic ? { deterministic } : {}),
    ...(tierRequest
      ? {
        authoritySalience: {
          request: tierRequest,
          tierCount: authorityGap?.tierCount ?? 0,
          citableCount: authorityGap?.citableCount ?? 0,
        },
      }
      : {}),
  };
  result.contextBlock = formatAutoRagContext(result, {
    ragChunkCharCap: req.ragChunkCharCap,
    ragTotalCharCap: req.ragTotalCharCap,
  });

  logger.info('auto-rag complete', {
    intent,
    capabilityTier,
    layersUsed,
    chunkCount: merged.length,
    latencyMs,
    nysLlmRequired: deterministic?.llmRequired,
    deterministicResolver: deterministic?.answer?.resolver,
  });

  return result;
}

export const autoRagRouter = { autoRagRetrieve, formatAutoRagContext, classifyRagIntent, getAutoRagStats };
