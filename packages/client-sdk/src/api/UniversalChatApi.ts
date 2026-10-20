/**
 * Universal Chat — `/api/chat/*` (LRM-routed testbed; SDK key or JWT via `authenticateToken`).
 * Partner legal Q&A at scale should prefer `JrxClient.orchestrate` / `orchestrate.stream`.
 */

import type { JrxHttpClient } from '../JrxClient.js';

export interface UniversalChatCreateSessionInput {
  agentGroupId?: string;
  language?: string;
}

export interface UniversalChatSendMessageInput {
  content: string;
  useWorkflow?: boolean;
}

export class UniversalChatApi {
  constructor(private readonly http: JrxHttpClient) {}

  listAgentGroups(): Promise<unknown> {
    return this.http.get('/api/chat/agent-groups');
  }

  listLanguages(): Promise<unknown> {
    return this.http.get('/api/chat/languages');
  }

  createSession(body: UniversalChatCreateSessionInput = {}): Promise<unknown> {
    return this.http.post('/api/chat/sessions', body);
  }

  getSession(sessionId: string): Promise<unknown> {
    return this.http.get(`/api/chat/sessions/${encodeURIComponent(sessionId)}`);
  }

  sendMessage(sessionId: string, body: UniversalChatSendMessageInput): Promise<unknown> {
    return this.http.post(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
      body,
    );
  }

  upload(sessionId: string, form: FormData): Promise<unknown> {
    return this.http.postForm(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/upload`,
      form,
    );
  }
}
