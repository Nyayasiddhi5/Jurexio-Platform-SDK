/**
 * SDK document pipeline — /api/jrx/sdk/docs-pipeline/*
 */

import type { JrxHttpClient } from '../JrxClient.js';

export class DocsPipelineApi {
  constructor(private readonly http: JrxHttpClient) {}

  parse(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/sdk/docs-pipeline/documents/parse', body);
  }

  /** NSP primary alias — same handler as intelligence; includes court fields + docparseMeta. */
  analyze(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/sdk/docs-pipeline/documents/analyze', body);
  }

  extract(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/sdk/docs-pipeline/documents/extract', body);
  }

  pipeline(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/sdk/docs-pipeline/documents/pipeline', body);
  }

  intelligence(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/sdk/docs-pipeline/documents/intelligence', body);
  }

  summarize(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/sdk/docs-pipeline/documents/summarize', body);
  }

  complianceCheck(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/sdk/docs-pipeline/documents/compliance-check', body);
  }

  compare(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/sdk/docs-pipeline/documents/compare', body);
  }

  embeddings(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/sdk/docs-pipeline/documents/embeddings', body);
  }

  listTemplates(): Promise<unknown> {
    return this.http.get('/api/jrx/sdk/docs-pipeline/documents/templates');
  }

  clauseLibrary(): Promise<unknown> {
    return this.http.get('/api/jrx/sdk/docs-pipeline/clauses/library');
  }

  suggestClauses(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/sdk/docs-pipeline/clauses/suggest', body);
  }
}
