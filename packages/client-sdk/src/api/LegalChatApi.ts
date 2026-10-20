/**
 * Console Legal Chat dashboard — `/api/jrx/legal-chat/*`.
 * Requires hosted-console JWT + SME/superadmin RBAC (not the SDK-key partner path).
 * For partner frontends, use `orchestrate`, `orchestrate.stream`, or `legalWork.chat`.
 */

import type { JrxHttpClient } from '../JrxClient.js';

export interface LegalChatSendInput {
  sessionId?: string;
  prompt: string;
  jurisdictions?: string[];
  tier?: string;
  agentId?: string;
  preferredModel?: string;
  mode?: string;
  fileIds?: string[];
  [key: string]: unknown;
}

export class LegalChatApi {
  constructor(private readonly http: JrxHttpClient) {}

  createSession(body: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.post('/api/jrx/legal-chat/sessions', body);
  }

  listSessions(): Promise<unknown> {
    return this.http.get('/api/jrx/legal-chat/sessions');
  }

  getSession(sessionId: string): Promise<unknown> {
    return this.http.get(`/api/jrx/legal-chat/sessions/${encodeURIComponent(sessionId)}`);
  }

  listAgents(): Promise<unknown> {
    return this.http.get('/api/jrx/legal-chat/agents');
  }

  listModels(): Promise<unknown> {
    return this.http.get('/api/jrx/legal-chat/models');
  }

  upload(form: FormData): Promise<unknown> {
    return this.http.postForm('/api/jrx/legal-chat/upload', form);
  }

  submitFeedback(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/legal-chat/feedback', body);
  }

  /**
   * POST `/send` returns SSE; use `JrxClient.orchestrate.stream` for AG-UI SSE with SDK keys.
   * This helper exists for console forks that already hold a JWT session cookie.
   */
  send(body: LegalChatSendInput): Promise<unknown> {
    return this.http.post('/api/jrx/legal-chat/send', body);
  }
}
