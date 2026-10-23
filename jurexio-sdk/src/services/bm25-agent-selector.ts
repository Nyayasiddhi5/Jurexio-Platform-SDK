/**
 * BM25 + Semantic Agent Selection — Algorithm P1/P3
 * @version 5.2.0
 *
 * Two-phase agent selection:
 *   Phase 1 — BM25 keyword ranking over agent descriptors
 *   Phase 2 — Performance-weighted re-ranking via AgentPerformanceTracker
 *
 * Returns ranked list of agent keys for QueenOrchestrator to assign.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('bm25-agent-selector');

/* ── Types ─────────────────────────────────────────────────── */

export interface AgentDescriptor {
  key: string;
  name: string;
  description: string;
  practiceAreas: string[];
  tier: string;
  protocols: string[];
}

export interface ScoredAgent {
  key: string;
  bm25Score: number;
  performanceScore: number;
  finalScore: number;
  reason: string;
}

/* ── BM25 implementation ────────────────────────────────────── */

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

const K1 = 1.5;
const B  = 0.75;

function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  docTF: Map<string, number>,
  idf: Map<string, number>,
  avgDocLen: number
): number {
  const docLen = docTokens.length;
  let score = 0;
  for (const qt of queryTokens) {
    const tf   = docTF.get(qt) || 0;
    const idfV = idf.get(qt)   || 0;
    const numerator   = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + B * (docLen / avgDocLen));
    score += idfV * (numerator / denominator);
  }
  return score;
}

/* ── BM25AgentSelector ─────────────────────────────────────── */

export class BM25AgentSelector {
  private agents: AgentDescriptor[] = [];
  private docCorpus: Array<{ tokens: string[]; tf: Map<string, number> }> = [];
  private idf: Map<string, number> = new Map();
  private avgDocLen = 0;

  load(agents: AgentDescriptor[]): void {
    this.agents = agents;
    this.docCorpus = agents.map(a => {
      const text   = [a.name, a.description, ...a.practiceAreas, ...a.protocols].join(' ');
      const tokens = tokenize(text);
      const tf     = computeTF(tokens);
      return { tokens, tf };
    });

    /* IDF computation */
    const N = agents.length;
    const df = new Map<string, number>();
    for (const doc of this.docCorpus) {
      for (const term of doc.tf.keys()) {
        df.set(term, (df.get(term) || 0) + 1);
      }
    }
    this.idf = new Map(
      [...df.entries()].map(([t, d]) => [t, Math.log((N - d + 0.5) / (d + 0.5) + 1)])
    );

    this.avgDocLen =
      this.docCorpus.reduce((s, d) => s + d.tokens.length, 0) / (N || 1);

    logger.info('bm25_corpus_loaded', { agentCount: N, avgDocLen: this.avgDocLen });
  }

  select(
    query: string,
    topK = 5,
    performanceScores: Map<string, number> = new Map()
  ): ScoredAgent[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.agents.length === 0) return [];

    const scored: ScoredAgent[] = this.agents.map((agent, i) => {
      const doc  = this.docCorpus[i];
      const bm25 = bm25Score(queryTokens, doc.tokens, doc.tf, this.idf, this.avgDocLen);
      const perf = performanceScores.get(agent.key) ?? 0.8; // default 0.8 if no history
      /* Weighted combination: 60% BM25 relevance, 40% performance */
      const finalScore = bm25 * 0.6 + perf * 0.4;

      return {
        key: agent.key,
        bm25Score: parseFloat(bm25.toFixed(4)),
        performanceScore: parseFloat(perf.toFixed(4)),
        finalScore: parseFloat(finalScore.toFixed(4)),
        reason: `BM25=${bm25.toFixed(2)} perf=${perf.toFixed(2)}`,
      };
    });

    scored.sort((a, b) => b.finalScore - a.finalScore);
    return scored.slice(0, topK);
  }
}

export const bm25AgentSelector = new BM25AgentSelector();
