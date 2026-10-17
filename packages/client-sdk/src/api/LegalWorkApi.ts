/**
 * LegalWorkApi — NYS federated legal-work + knowledge plane surface.
 * Wraps: /api/jrx/legal-work/*, /api/jrx/knowledge/*
 */

import type { JrxHttpClient } from '../JrxClient.js';

export class LegalWorkApi {
  constructor(private readonly http: JrxHttpClient) {}

  listTasks(params?: {
    q?: string;
    jurisdiction?: string;
    category?: string;
    workType?: string;
  }): Promise<unknown> {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.jurisdiction) qs.set('jurisdiction', params.jurisdiction);
    if (params?.category) qs.set('category', params.category);
    if (params?.workType) qs.set('workType', params.workType);
    const suffix = qs.size ? `?${qs}` : '';
    return this.http.get(`/api/jrx/legal-work/tasks${suffix}`);
  }

  getTask(id: string): Promise<unknown> {
    return this.http.get(`/api/jrx/legal-work/tasks/${encodeURIComponent(id)}`);
  }

  /** Async legal-work run (202 queued). Poll getRun(). */
  createRun(input: {
    instruction: string;
    context?: string;
    jurisdiction?: string;
    taskId?: string;
  }): Promise<unknown> {
    return this.http.post('/api/jrx/legal-work/runs', input);
  }

  listRuns(): Promise<unknown> {
    return this.http.get('/api/jrx/legal-work/runs');
  }

  getRun(runId: string): Promise<unknown> {
    return this.http.get(`/api/jrx/legal-work/runs/${encodeURIComponent(runId)}`);
  }

  async evaluateRun(runId: string): Promise<unknown> {
    return this.http.post(`/api/jrx/legal-work/runs/${encodeURIComponent(runId)}/evaluate`, {});
  }

  /** Sync evaluate from instruction (Wave-C NSP). */
  evaluate(body: {
    instruction: string;
    context?: string;
    jurisdiction?: string;
    taskId?: string;
    timeoutMs?: number;
  }): Promise<unknown> {
    return this.http.post('/api/jrx/legal-work/evaluate', body);
  }

  /** Alias for createChatConversation. */
  chat(body: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.post('/api/jrx/legal-work/chat', body);
  }

  createChatConversation(body: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.post('/api/jrx/legal-work/chat/conversations', body);
  }

  sendChatMessage(conversationId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.http.post(
      `/api/jrx/legal-work/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
      body,
    );
  }
}
