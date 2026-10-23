import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  message: string;
  history?: ChatMessage[];
  agentId?: string;
  context?: Record<string, unknown>;
}

interface ChatResponse {
  response: string;
  agentId?: string;
  model?: string;
  tokensUsed?: number;
}

export async function sendChatMessage(req: ChatRequest): Promise<ChatResponse> {
  const token = getAuthToken();
  const res = await fetch(nv('chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Chat request failed' }));
    throw new Error(err.error || 'Chat request failed');
  }
  return res.json();
}

export async function getAgentList() {
  const token = getAuthToken();
  const res = await fetch(nv('agents'), {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}
