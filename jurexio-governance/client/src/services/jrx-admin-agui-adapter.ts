/**
 * Console JWT adapter for POST /api/jrx/stream (AG-UI Queen).
 * Partner SSE (/orchestrate/stream) stays outcome-only.
 */
import { getAuthToken } from '@/lib/jrx-auth-token';
import { p } from '@/lib/jrx-api-paths';
import {
  mapAguiEventToTimeline,
  type AdminTimelineEvent,
  type AguiWireEvent,
} from '@/services/jrx-admin-agui-map';
import type { LegalChatTimelineEvent } from '@/services/legal-chat-api';
import { rememberLegalRun } from '@/services/jrx-legal-last-runs';
import type { ExecutionOutcome } from '@/components/execution/ExecutionOutcomePanel';

export type { AdminTimelineEvent };

export const DEFAULT_STREAM_MAX_OUTPUT_TOKENS = 16_384;

export function asLegalChatEvent(e: AdminTimelineEvent): LegalChatTimelineEvent {
  return e as LegalChatTimelineEvent;
}

export interface AdminAguiStreamOpts {
  task: string;
  pattern?: string;
  agentId?: string;
  jurisdiction?: string;
  matterId?: string;
  includeThinking?: boolean;
  includeCitations?: boolean;
  maxOutputTokens?: number;
}

export interface AdminAguiStreamResult {
  orchestrationId: string;
  answer: string;
  outcome: ExecutionOutcome;
}

function extractResponseFromEvent(e: LegalChatTimelineEvent): string | undefined {
  const data = e.data ?? {};
  const resp = data.response ?? data.answer ?? data.accumulated;
  return typeof resp === 'string' && resp.trim() ? resp : undefined;
}

function extractCitations(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object');
}

function buildOutcome(
  status: ExecutionOutcome['status'],
  partial: Partial<ExecutionOutcome>,
): ExecutionOutcome {
  return {
    status,
    text: partial.text ?? '',
    citations: partial.citations,
    model: partial.model,
    chars: partial.chars,
    maxOutputTokens: partial.maxOutputTokens,
    error: partial.error,
  };
}

export async function streamQueenAguiForConsole(
  opts: AdminAguiStreamOpts,
  onEvent: (e: LegalChatTimelineEvent) => void,
  abort?: AbortSignal,
  onAnswerUpdate?: (text: string) => void,
): Promise<AdminAguiStreamResult> {
  const token = getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const maxOutputTokens = opts.maxOutputTokens ?? DEFAULT_STREAM_MAX_OUTPUT_TOKENS;
  const fallbackId = `console-${Date.now()}`;
  const res = await fetch(p('AGUI_STREAM'), {
    method: 'POST',
    credentials: 'include',
    headers,
    signal: abort,
    body: JSON.stringify({
      task: opts.task,
      pattern: opts.pattern || 'P11',
      agentId: opts.agentId,
      jurisdiction: opts.jurisdiction || 'IN',
      matterId: opts.matterId,
      includeThinking: opts.includeThinking ?? true,
      includeCitations: opts.includeCitations ?? true,
      maxOutputTokens,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`admin AG-UI stream failed: ${res.status}`);
  }

  let orchestrationId = fallbackId;
  let answer = '';
  let citations: Array<Record<string, unknown>> = [];
  let model: string | undefined;
  let outcomeStatus: ExecutionOutcome['status'] = 'streaming';

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

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
      const raw = dataLine.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;
      let parsed: AguiWireEvent;
      try {
        parsed = JSON.parse(raw) as AguiWireEvent;
      } catch {
        continue;
      }

      if (parsed.type === 'text_delta') {
        const delta = typeof parsed.delta === 'string' ? parsed.delta : '';
        const accumulated = typeof parsed.accumulated === 'string' ? parsed.accumulated : undefined;
        if (accumulated) answer = accumulated;
        else if (delta) answer += delta;
        if (typeof parsed.model === 'string') model = parsed.model;
        if (answer && onAnswerUpdate) onAnswerUpdate(answer);
      }

      const mapped = mapAguiEventToTimeline(parsed, orchestrationId);
      if (!mapped) continue;
      orchestrationId = mapped.orchestrationId || orchestrationId;
      const legal = asLegalChatEvent(mapped);

      const stepResponse = extractResponseFromEvent(legal);
      if (stepResponse) {
        answer = stepResponse;
        onAnswerUpdate?.(answer);
      }
      if (legal.step === 'citation_grounding' || legal.step === 'run_complete') {
        citations = extractCitations(legal.data?.citations);
      }
      if (typeof legal.data?.model === 'string') model = legal.data.model;

      if (legal.step === 'run_complete') {
        outcomeStatus = legal.status === 'blocked' ? 'blocked' : 'complete';
      }
      if (legal.step === 'run_failed') {
        outcomeStatus = 'failed';
      }

      onEvent(legal);
    }
  }

  if (outcomeStatus === 'streaming') {
    outcomeStatus = answer.trim() ? 'complete' : 'failed';
  }

  if (orchestrationId) rememberLegalRun(orchestrationId, 'agui');

  const outcome = buildOutcome(outcomeStatus, {
    text: answer,
    citations,
    model,
    chars: answer.length,
    maxOutputTokens,
    error: outcomeStatus === 'failed' && !answer.trim()
      ? 'Stream ended without run_complete or synthesis_final text'
      : undefined,
  });

  return { orchestrationId, answer, outcome };
}
