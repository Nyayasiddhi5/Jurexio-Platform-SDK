/**
 * Partner LLM catalog + router explain — /api/jrx/v1/sdk/llm/*
 */

import type { NyvHttpClient } from '../NyvClient.js';

export class LlmRouterApi {
  constructor(private readonly http: NyvHttpClient) {}

  catalog(query?: Record<string, string>): Promise<unknown> {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
    return this.http.get(`/api/jrx/v1/sdk/llm/catalog${qs}`);
  }

  providers(): Promise<unknown> {
    return this.http.get('/api/jrx/v1/sdk/llm/providers');
  }

  routerHealth(): Promise<unknown> {
    return this.http.get('/api/jrx/v1/sdk/llm/router/health');
  }

  routerExplain(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/v1/sdk/llm/router/explain', body);
  }
}
