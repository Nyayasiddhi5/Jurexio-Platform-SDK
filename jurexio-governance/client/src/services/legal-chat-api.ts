import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_BASE, nv } from '@/lib/jrx-api-paths';
/**
 * Legal Chat API client
 * Thin wrappers around /api/jrx/legal-chat/*. Uses fetch directly for SSE
 * since EventSource cannot send POST bodies.
 */

import { apiRequest } from '@/lib/queryClient';
import { rememberLegalRun } from '@/services/jrx-legal-last-runs';

export interface LegalChatSession {
  id: string;
  title: string;
  jurisdictions: string[];
  tier: string;
  mode: string;
  last_used_at: string;
  created_at: string;
}

// Canonical legal-chat timeline taxonomy. SOURCE OF TRUTH is the set of
// `step:` literals emitted by `src/services/legal-chat-event-bus.ts` +
// `src/routes/jrx-legal-chat-routes.ts`. WorkflowPane v2 groups these into
// a fixed 7-phase grid; any future server-side step name added must also
// be added here (and to WorkflowPane.PHASES if it should render in the
// canonical grid). Unknown steps still flow through as raw events.
export type LegalChatTimelineStep =
  | 'request_received'
  | 'pii_redaction'
  | 'session_persisted'
  | 'memory_injection'
  | 'agent_selection'
  | 'router_decision'
  | 'prompt_compiled'
  | 'llm_stream_started'
  | 'llm_stream_completed'
  | 'maker_checker'
  | 'safety_verdict'
  | 'audit_chain'
  | 'run_complete'
  | 'run_failed'
  // Emitted by jrx-legal-chat-routes.ts (rag / citations / persist).
  // llm_stream_token remains unused until Queen synthesis exposes onChunk.
  | 'rag_retrieval'
  | 'llm_stream_token'
  | 'citation_grounding'
  | 'response_persisted';

export interface LegalChatTimelineEvent {
  orchestrationId: string;
  step: LegalChatTimelineStep | string;
  status: 'pending' | 'running' | 'ok' | 'failed' | 'skipped' | 'blocked';
  ts: number;
  durationMs?: number;
  data?: Record<string, unknown>;
  message?: string;
}

export interface SendOptions {
  sessionId?: string;
  prompt: string;
  jurisdictions?: string[];
  tier?: string;
  agentId?: string;
  preferredModel?: string;
  preferCheaper?: boolean;
  requireReasoning?: boolean;
  requireJson?: boolean;
  requireVision?: boolean;
  mode?: string;
  fileIds?: string[];
  swarmTopology?: string;
  taskKind?: string;
}

export const legalChatApi = {
  listSessions: () => apiRequest(nv('legal-chat/sessions'), 'GET'),
  createSession: (body: Partial<LegalChatSession>) =>
    apiRequest(nv('legal-chat/sessions'), 'POST', body),
  getSession: (id: string) =>
    apiRequest(`${NV_BASE}legal-chat/sessions/${id}`, 'GET'),
  listAgents: (jurisdiction = 'IN') =>
    apiRequest(`${NV_BASE}legal-chat/agents?jurisdiction=${jurisdiction}`, 'GET'),
  listModels: () => apiRequest(nv('legal-chat/models'), 'GET'),
  postFeedback: (body: {
    orchestrationId: string;
    sessionId?: string;
    ratings: Record<string, number | string>;
    comment?: string;
  }) => apiRequest(nv('legal-chat/feedback'), 'POST', body),
  uploadFiles: async (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    const token = getAuthToken();
    const r = await fetch(nv('legal-chat/upload'), {
      method: 'POST',
      body: fd,
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) throw new Error(`upload failed: ${r.status}`);
    return r.json();
  },
  listAllocations: () => apiRequest(nv('legal-chat/sme-allocations'), 'GET'),
  createAllocation: (body: {
    smeEmail?: string;
    smeUserId?: number;
    scope?: { jurisdictions?: string[]; tiers?: string[]; notes?: string } & Record<string, unknown>;
  }) => apiRequest(nv('legal-chat/sme-allocations'), 'POST', body),
  revokeAllocation: (id: number) =>
    apiRequest(`${NV_BASE}legal-chat/sme-allocations/${id}`, 'DELETE'),
  issueSmeCredentials: (body: {
    email: string;
    scope?: { jurisdictions?: string[]; tiers?: string[]; notes?: string } & Record<string, unknown>;
  }) => apiRequest(nv('legal-chat/sme-allocations/issue'), 'POST', body),
};

/**
 * Stream a /send request. Calls onEvent for every parsed timeline event.
 * Returns a promise that resolves when the stream finishes (run_complete or
 * run_failed) or the connection closes.
 */
export async function streamLegalChatSend(
  body: SendOptions,
  onEvent: (e: LegalChatTimelineEvent) => void,
  abort?: AbortSignal,
  opts?: { shell?: 'sme' | 'console' },
): Promise<void> {
  const token = getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts?.shell) headers['X-NV-Shell'] = opts.shell;
  const r = await fetch(nv('legal-chat/send'), {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
    signal: abort,
  });
  if (!r.ok || !r.body) {
    throw new Error(`send failed: ${r.status}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let lastOrch = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      try {
        const evt = JSON.parse(dataLine.slice(6)) as LegalChatTimelineEvent;
        if (evt.orchestrationId) lastOrch = evt.orchestrationId;
        onEvent(evt);
      } catch {
        // ignore
      }
    }
  }
  if (lastOrch) rememberLegalRun(lastOrch, 'legal-chat');
}
