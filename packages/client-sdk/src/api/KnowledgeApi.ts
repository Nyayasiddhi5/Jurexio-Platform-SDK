/**
 * KnowledgeApi — Legal knowledge base + NYS federated Knowledge Plane.
 * Wraps: /api/jrx/knowledge/* (search, caselaw, statutes, retrieve, citations, archive, templates)
 */

import type {
  NyvKnowledgeSearchRequest,
  NyvKnowledgeSearchResponse,
  NyvJurisdiction,
} from '../types/index.js';
import type { NyvHttpClient } from '../NyvClient.js';

export interface AddKnowledgeRequest {
  text: string;
  title?: string;
  docType?: 'statute' | 'case-law' | 'commentary' | 'circular' | 'notification' | 'contract' | 'other';
  jurisdiction?: NyvJurisdiction;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface GraphSearchOptions {
  query: string;
  jurisdiction?: NyvJurisdiction;
  entityTypes?: string[];
  maxHops?: number;
  limit?: number;
}

export class KnowledgeApi {
  constructor(private readonly http: NyvHttpClient) {}

  /** Hybrid Auto-RAG search (includes NYS global layer when flag on). */
  search(req: NyvKnowledgeSearchRequest): Promise<NyvKnowledgeSearchResponse> {
    return this.http.post('/api/jrx/knowledge/search', req);
  }

  query(
    query: string,
    jurisdiction: NyvJurisdiction = 'IN',
    limit = 10,
  ): Promise<NyvKnowledgeSearchResponse> {
    return this.search({ query, jurisdiction, limit, searchMode: 'hybrid' });
  }

  /** Deterministic NYS retrieval planner (LLM-free when possible). */
  retrieve(input: { query: string; jurisdiction?: string }): Promise<unknown> {
    return this.http.post('/api/jrx/knowledge/retrieve', input);
  }

  /** Caselaw search via NYS plane. */
  searchCaselaw(params: {
    q: string;
    jurisdiction?: string;
    year?: number;
    court?: string;
    limit?: number;
    mode?: 'fts' | 'hybrid';
  }): Promise<unknown> {
    const qs = new URLSearchParams({ q: params.q });
    if (params.jurisdiction) qs.set('jurisdiction', params.jurisdiction);
    if (params.year !== undefined) qs.set('year', String(params.year));
    if (params.court) qs.set('court', params.court);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.mode) qs.set('mode', params.mode);
    return this.http.get(`/api/jrx/knowledge/caselaw/search?${qs}`);
  }

  /** IPC↔BNS / CrPC↔BNSS / IEA↔BSA compare helpers. */
  compareOldToNew(section: string, from: 'CrPC' | 'IEA' | 'IPC' = 'IPC'): Promise<unknown> {
    const kind = from === 'IPC' ? 'ipc-bns' : 'old-new';
    return this.compareCodes(kind, { section, from });
  }

  compareNewToOld(section: string, from: 'BNSS' | 'BSA' | 'BNS' = 'BNS'): Promise<unknown> {
    return this.compareCodes('new-old', { section, from });
  }

  getCaselawDocument(id: string | number): Promise<unknown> {
    return this.http.get(`/api/jrx/knowledge/caselaw/documents/${id}`);
  }

  similarCases(id: string | number, limit?: number): Promise<unknown> {
    const qs = limit !== undefined ? `?limit=${limit}` : '';
    return this.http.get(`/api/jrx/knowledge/caselaw/documents/${id}/similar${qs}`);
  }

  verifyCitation(input: { citation: string; jurisdiction?: string }): Promise<unknown> {
    return this.http.post('/api/jrx/knowledge/caselaw/verify-citation', input);
  }

  /**
   * Negative-treatment check for an authority (NV-CITATOR-NEGATIVE-TREATMENT-001).
   *
   * NOT a citator. `goodLaw` is `overruled | doubted | unknown` and `good` is
   * unreachable by construction: absence of adverse language in a bounded
   * retrieval is not evidence that an authority is good law. `unknown` is the
   * expected answer for most authorities and must be rendered as unknown, never
   * as a clearance.
   *
   * Pass `exact: true` to identify the authority by citation string only. Token
   * matching on party names is looser and has mislabelled one case as another,
   * so prefer exact mode when you hold a reporter citation.
   */
  caselawTreatment(params: {
    citation: string;
    exact?: boolean;
    direction?: 'citing' | 'cited';
  }): Promise<unknown> {
    const qs = new URLSearchParams({ citation: params.citation });
    if (params.exact) qs.set('exact', 'true');
    if (params.direction) qs.set('direction', params.direction);
    return this.http.get(`/api/jrx/knowledge/caselaw/treatment?${qs}`);
  }

  caselawStats(): Promise<unknown> {
    return this.http.get('/api/jrx/knowledge/caselaw/stats');
  }

  searchStatutes(params: {
    q: string;
    code?: string;
    jurisdiction?: string;
    limit?: number;
  }): Promise<unknown> {
    const qs = new URLSearchParams({ q: params.q });
    if (params.code) qs.set('code', params.code);
    if (params.jurisdiction) qs.set('jurisdiction', params.jurisdiction);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    return this.http.get(`/api/jrx/knowledge/statutes/search?${qs}`);
  }

  listStatuteActs(params?: {
    q?: string;
    practiceArea?: string;
    jurisdiction?: string;
  }): Promise<unknown> {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.practiceArea) qs.set('practiceArea', params.practiceArea);
    if (params?.jurisdiction) qs.set('jurisdiction', params.jurisdiction);
    const suffix = qs.size ? `?${qs}` : '';
    return this.http.get(`/api/jrx/knowledge/statutes/acts${suffix}`);
  }

  compareCodes(kind: string, body: Record<string, unknown>): Promise<unknown> {
    return this.http.post(`/api/jrx/knowledge/statutes/compare/${encodeURIComponent(kind)}`, body);
  }

  extractCitations(input: { text: string; link?: boolean }): Promise<unknown> {
    return this.http.post('/api/jrx/knowledge/citations/extract', input);
  }

  /**
   * Athena archive PDF search.
   * Accepts SDK-friendly `{ query, archive: 'all'|'sc'|'hc', ... }`;
   * gateway normalizes to NYS OpenAPI `{ q, archive?: 'sc'|'hc' }`.
   */
  searchArchive(body: {
    q?: string;
    query?: string;
    year?: number;
    court?: string;
    archive?: 'sc' | 'hc' | 'all' | string;
    limit?: number;
    [key: string]: unknown;
  }): Promise<unknown> {
    const q = (body.q ?? body.query ?? '').toString().trim();
    const payload: Record<string, unknown> = { ...body, q };
    delete payload.query;
    if (payload.archive === 'all') delete payload.archive;
    return this.http.post('/api/jrx/knowledge/documents/search', payload);
  }

  listTemplates(params?: {
    kind?: string;
    jurisdiction?: string;
    q?: string;
  }): Promise<unknown> {
    const qs = new URLSearchParams();
    if (params?.kind) qs.set('kind', params.kind);
    if (params?.jurisdiction) qs.set('jurisdiction', params.jurisdiction);
    if (params?.q) qs.set('q', params.q);
    const suffix = qs.size ? `?${qs}` : '';
    return this.http.get(`/api/jrx/knowledge/templates${suffix}`);
  }

  getTemplate(id: string): Promise<unknown> {
    return this.http.get(`/api/jrx/knowledge/templates/${encodeURIComponent(id)}`);
  }

  planeHealth(): Promise<unknown> {
    return this.http.get('/api/jrx/knowledge/plane/health');
  }

  /** Caselaw embedding coverage / SLO (NYS plane). */
  caselawEmbeddingCoverage(): Promise<unknown> {
    return this.http.get('/api/jrx/knowledge/caselaw/embedding/coverage');
  }

  /** Statute embedding coverage / SLO (NYS plane). */
  statutesEmbeddingCoverage(): Promise<unknown> {
    return this.http.get('/api/jrx/knowledge/statutes/embedding/coverage');
  }

  /**
   * Athena archive configuration status.
   *
   * NYS `/athena/status` takes no parameters — it reports whether the archive
   * tables are configured on the server, not the state of one document.
   */
  archiveDocumentStatus(): Promise<unknown> {
    return this.http.get('/api/jrx/knowledge/documents/status');
  }

  /**
   * Presigned URL for an archived judgment PDF.
   *
   * Keyed by the owned-bucket `s3Path` (from `searchArchive()` or a caselaw
   * row's `s3Path`) — NYS has no opaque archive id, so the earlier
   * `{ archiveId }` shape could only ever return 400.
   */
  getArchiveDocument(params: { s3Path: string }): Promise<unknown> {
    const qs = new URLSearchParams({ s3Path: params.s3Path });
    return this.http.get(`/api/jrx/knowledge/documents/document?${qs}`);
  }

  /** Athena archive extract. */
  extractArchive(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/knowledge/documents/extract', body);
  }

  /**
   * On-demand FULL judgment text (NV-NYS-FULLTEXT-001).
   *
   * Resolves the case through the Athena archive and extracts the owned-bucket
   * S3 PDF in one call. Pass `s3Path` when you already have it (cheapest — no
   * Athena scan), otherwise `query`. `archive` defaults to 'sc'; 'hc' scans
   * ~1.3 GB of Athena per query, so request it deliberately.
   *
   * This is intentionally NOT part of search/RAG responses: judgment bodies are
   * large and are only fetched when explicitly asked for.
   */
  judgmentFullText(body: {
    s3Path?: string;
    query?: string;
    archive?: 'sc' | 'hc';
    year?: number;
    court?: string;
    title?: string;
    maxChars?: number;
  }): Promise<unknown> {
    return this.http.post('/api/jrx/knowledge/judgments/full-text', body);
  }

  /** NYS console SSO launch (ecosystem). */
  ssoLaunch(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/knowledge/sso/launch', body);
  }

  graphSearch(opts: GraphSearchOptions): Promise<{
    nodes: Array<{ id: string; type: string; label: string; properties: Record<string, unknown> }>;
    edges: Array<{ from: string; to: string; type: string; weight: number }>;
    paths: Array<{ nodes: string[]; score: number }>;
    searchTimeMs: number;
  }> {
    return this.http.post('/api/jrx/knowledge/graph-search', opts);
  }

  add(req: AddKnowledgeRequest): Promise<{
    success: boolean;
    docId: string;
    chunksCreated: number;
    embeddingsGenerated: number;
  }> {
    return this.http.post('/api/jrx/knowledge/add', req);
  }

  remove(docId: string): Promise<{ success: boolean }> {
    return this.http.delete(`/api/jrx/knowledge/${docId}`);
  }

  getStats(jurisdiction?: NyvJurisdiction): Promise<{
    totalDocuments: number;
    totalChunks: number;
    totalEmbeddings: number;
    byJurisdiction: Record<string, number>;
    byDocType: Record<string, number>;
    lastUpdated: string;
  }> {
    const params = jurisdiction ? `?jurisdiction=${jurisdiction}` : '';
    return this.http.get(`/api/jrx/knowledge/stats${params}`);
  }

  similarity(
    text1: string,
    text2: string,
    jurisdiction?: NyvJurisdiction,
  ): Promise<{
    similarity: number;
    explanation: string;
    sharedConcepts: string[];
  }> {
    return this.http.post('/api/jrx/knowledge/similarity', { text1, text2, jurisdiction });
  }
}
