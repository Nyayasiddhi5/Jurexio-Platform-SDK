/**
 * InstantSearchApi — facade over Knowledge Plane proxies (no dedicated /instant route).
 * NSP typeahead: statutes + caselaw (+ acts catalog).
 */
import type { NyvHttpClient } from '../NyvClient.js';
import type { NyvJurisdiction } from '../types/index.js';
import { KnowledgeApi } from './KnowledgeApi.js';

export interface InstantSearchOptions {
  jurisdiction?: NyvJurisdiction | string;
  limit?: number;
  /** Caselaw backend: fts (snappy typeahead) | hybrid (RRF). */
  mode?: 'fts' | 'hybrid';
  code?: string;
}

export class InstantSearchApi {
  private readonly knowledge: KnowledgeApi;

  constructor(private readonly http: NyvHttpClient) {
    this.knowledge = new KnowledgeApi(http);
  }

  statutes(q: string, opts: InstantSearchOptions = {}): Promise<unknown> {
    return this.knowledge.searchStatutes({
      q,
      jurisdiction: opts.jurisdiction as string | undefined,
      limit: opts.limit ?? 8,
      code: opts.code,
    });
  }

  acts(q?: string, opts: InstantSearchOptions = {}): Promise<unknown> {
    return this.knowledge.listStatuteActs({
      q,
      jurisdiction: opts.jurisdiction as string | undefined,
    });
  }

  /** Caselaw typeahead — supports mode=fts|hybrid via query string. */
  caselaw(q: string, opts: InstantSearchOptions = {}): Promise<unknown> {
    const qs = new URLSearchParams({ q });
    if (opts.jurisdiction) qs.set('jurisdiction', String(opts.jurisdiction));
    else qs.set('jurisdiction', 'IN');
    if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
    if (opts.mode) qs.set('mode', opts.mode);
    return this.http.get(`/api/jrx/knowledge/caselaw/search?${qs}`);
  }

  /** Parallel statutes + caselaw for dropdown Instant Search. */
  async search(q: string, opts: InstantSearchOptions = {}): Promise<{
    statutes: unknown;
    caselaw: unknown;
    query: string;
    jurisdiction: string;
  }> {
    const jurisdiction = String(opts.jurisdiction || 'IN');
    const limit = opts.limit ?? 8;
    const mode = opts.mode ?? 'fts';
    const [statutes, caselaw] = await Promise.all([
      this.statutes(q, { jurisdiction, limit, code: opts.code }),
      this.caselaw(q, { jurisdiction, limit, mode }),
    ]);
    return { statutes, caselaw, query: q, jurisdiction };
  }

  retrieve(query: string, jurisdiction: string = 'IN'): Promise<unknown> {
    return this.knowledge.retrieve({ query, jurisdiction });
  }
}
