/**
 * NV-PROVIDER-TOKEN-STREAM-001 — true provider token streaming with post-gates.
 *
 * Safety model (honest):
 *   1. Pre: credit + consent already enforced by route.
 *   2. Stream: `streamLLM` emits provisional `text_delta` (provisional: true).
 *   3. Post: lightweight safety pass on full text; if blocked, emit
 *      `safety_blocked` and do not treat answer as final trusted legal advice.
 *
 * Queen multi-agent synthesis still uses word-chunk after full result until
 * synthesizeWithLLM gains a streaming hook (tracked separately).
 */

import { streamLLM } from '../services/intelligent-router/llm-orchestrator.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-provider-token-stream');

export interface ProviderTokenStreamArgs {
  prompt: string;
  systemPrompt?: string;
  jurisdiction?: string;
  taskType?: string;
  tier?: string;
  maxTokens?: number;
  onDelta: (delta: string, accumulated: string) => void;
  isClosed?: () => boolean;
}

export interface ProviderTokenStreamResult {
  content: string;
  safetyOk: boolean;
  safetyReason?: string;
  interrupted: boolean;
}

/** Heuristic post-gate — fail-soft; never throws into stream path. */
function postStreamSafety(text: string): { ok: boolean; reason?: string } {
  const t = (text || '').trim();
  if (!t) return { ok: false, reason: 'empty_response' };
  if (/\[STREAM_INTERRUPTED:/i.test(t)) return { ok: false, reason: 'stream_interrupted' };
  if (/\b(ignore previous instructions|system prompt leak)\b/i.test(t)) {
    return { ok: false, reason: 'policy_block' };
  }
  return { ok: true };
}

export async function streamProviderTokensThroughSafetyRing(
  args: ProviderTokenStreamArgs,
): Promise<ProviderTokenStreamResult> {
  let accumulated = '';
  let interrupted = false;
  const requestId = `pts-${Date.now().toString(36)}`;
  const systemPrompt = args.systemPrompt
    || 'You are a precise legal AI assistant. Provide accurate, well-cited responses.';
  try {
    for await (const delta of streamLLM({
      requestId,
      systemPrompt,
      userMessage: args.prompt,
      routing: {
        agentId: 'orchestrate-stream-specialist',
        jurisdiction: (args.jurisdiction as 'IN' | 'UK' | 'US' | 'EU' | 'SG' | 'GC' | 'DEFAULT') || 'IN',
        taskKind: 'legal_research',
        tier: args.tier,
      },
      maxTokens: args.maxTokens ?? 4096,
      temperature: 0.3,
    })) {
      if (args.isClosed?.()) {
        interrupted = true;
        break;
      }
      if (!delta) continue;
      if (/\[STREAM_INTERRUPTED:/i.test(delta)) {
        interrupted = true;
        accumulated += delta;
        break;
      }
      accumulated += delta;
      args.onDelta(delta, accumulated);
    }
  } catch (err: any) {
    logger.warn('provider token stream failed', { err: err?.message });
    interrupted = true;
  }

  const gate = postStreamSafety(accumulated);
  return {
    content: accumulated,
    safetyOk: gate.ok && !interrupted,
    safetyReason: gate.reason || (interrupted ? 'client_closed_or_error' : undefined),
    interrupted,
  };
}
