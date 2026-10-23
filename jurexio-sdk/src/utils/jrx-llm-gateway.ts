/**
 * NVY LLM Gateway — v3.1.2 (compatibility shim)
 * ─────────────────────────────────────────────────────────────────────────────
 * The LLM Gateway is now a thin compatibility wrapper around the consolidated
 * Intelligent Router (`src/services/intelligent-router/llm-orchestrator.ts`).
 *
 * All model selection, provider cascading, health tracking, and observability
 * is owned by the orchestrator. The gateway exists ONLY to preserve the
 * existing `callLLM` / `streamLLM` / `extractJSON` / `getEmbedding` /
 * `makeRequestId` API surface so existing routes don't need to be rewritten
 * in one shot.
 *
 * Old internal cascade (OpenRouter → OpenAI → Anthropic → simulation),
 * PATTERN_MODEL_MAP, COST_PER_1M, and per-call retry logic have been deleted —
 * they are duplicated and superseded by the orchestrator.
 *
 * NEW callsites should import directly from
 *   `src/services/intelligent-router/index.ts`
 *
 * @module jrx-llm-gateway
 * @version 3.1.2
 */

import { createLogger } from './logger.js';
import { randomUUID } from 'crypto';
import {
  orchestrateLLM,
  streamLLMOrchestrated,
  type OrchestrationInput,
} from '../services/intelligent-router/index.js';

const logger = createLogger('./jrx-llm-gateway');

// ─────────────────────────────────────────────────────────────────────────────
// Types (preserved for back-compat)
// ─────────────────────────────────────────────────────────────────────────────

export type LLMProvider = 'openrouter' | 'openai' | 'anthropic' | 'google' | 'agentzero' | 'simulation';
export type JurisdictionCode = 'IN' | 'UK' | 'US' | 'EU' | 'GCC' | 'SG';
export type TemplateMode = 'STRICT' | 'GUIDED' | 'MENTOR';
export type PatternKey =
  | 'P01' | 'P02' | 'P03' | 'P04' | 'P05' | 'P06' | 'P07' | 'P08'
  | 'P09' | 'P10' | 'P11' | 'P12' | 'P13' | 'P14' | 'P15' | 'P16'
  | 'P17' | 'P18' | 'P19' | 'P20' | 'P21' | 'P22';

export interface GatewayRequest {
  requestId: string;
  userId?: string;
  organizationId?: string;
  agentId?: string;
  patternKey?: PatternKey;
  systemPrompt: string;
  userMessage: string;
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  jurisdiction?: JurisdictionCode;
  templateMode?: TemplateMode;
  expectJson?: boolean;
  jsonSchema?: string;
  stream?: boolean;
  tier?: 'free' | 'solo' | 'plus' | 'pro' | 'enterprise' | 'superadmin' | 'institutional';
  plan?: string;
  app?: string;
  context?: Record<string, unknown>;
  preferredModels?: string[];
  fallbackModels?: string[];
  maxCostUsd?: number;
}

export interface GatewayResponse {
  content: string;
  model: string;
  provider: LLMProvider;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  fallbackLevel: number;
  isSimulation: boolean;
  finishReason: string;
  requestId: string;
  cost?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// callLLM — thin shim that builds an OrchestrationInput and delegates
// ─────────────────────────────────────────────────────────────────────────────

function normalizeTier(tier?: string): GatewayRequest['tier'] {
  const t = (tier ?? '').toLowerCase();
  if (t === 'institutional') return 'enterprise';
  if (['free', 'solo', 'plus', 'pro', 'enterprise', 'superadmin'].includes(t)) {
    return t as GatewayRequest['tier'];
  }
  return undefined;
}

export async function callLLM(req: GatewayRequest): Promise<GatewayResponse> {
  const orchestratorInput: OrchestrationInput = {
    requestId: req.requestId,
    systemPrompt: req.systemPrompt,
    userMessage: req.userMessage,
    messages: req.messages,
    templateMode: req.templateMode,
    expectJson: req.expectJson,
    jsonSchema: req.jsonSchema,
    maxTokens: req.maxTokens,
    temperature: req.temperature,
    routing: {
      agentId: req.agentId ?? req.patternKey,
      userId: req.userId,
      organizationId: req.organizationId,
      tier: normalizeTier(req.tier),
      plan: req.plan,
      app: req.app,
      jurisdiction: req.jurisdiction,
      promptTokens: Math.ceil((req.systemPrompt.length + req.userMessage.length) / 4),
      expectedOutputTokens: req.maxTokens,
      requireJson: req.expectJson,
      patternKey: req.patternKey,
      preferredModels: req.preferredModels ?? (req.model ? [req.model] : undefined),
      fallbackModels: req.fallbackModels,
      maxCostUsd: req.maxCostUsd,
    },
  };

  const result = await orchestrateLLM(orchestratorInput);
  const provider = (['openrouter', 'openai', 'anthropic', 'google', 'agentzero', 'simulation'] as const).includes(result.provider as any)
    ? (result.provider as LLMProvider)
    : 'simulation';
  return {
    content: result.content,
    model: result.model,
    provider,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs: result.latencyMs,
    fallbackLevel: result.fallbackLevel,
    isSimulation: result.isSimulation,
    finishReason: result.finishReason,
    requestId: result.requestId,
    cost: result.costUsd,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// streamLLM — thin shim, also goes through the orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export async function* streamLLM(req: GatewayRequest): AsyncGenerator<string> {
  const orchestratorInput: OrchestrationInput = {
    requestId: req.requestId,
    systemPrompt: req.systemPrompt,
    userMessage: req.userMessage,
    messages: req.messages,
    templateMode: req.templateMode,
    expectJson: req.expectJson,
    jsonSchema: req.jsonSchema,
    maxTokens: req.maxTokens,
    temperature: req.temperature,
    stream: true,
    routing: {
      agentId: req.agentId ?? req.patternKey,
      userId: req.userId,
      organizationId: req.organizationId,
      tier: normalizeTier(req.tier),
      plan: req.plan,
      app: req.app,
      jurisdiction: req.jurisdiction,
      promptTokens: Math.ceil((req.systemPrompt.length + req.userMessage.length) / 4),
      expectedOutputTokens: req.maxTokens,
      requireJson: req.expectJson,
      patternKey: req.patternKey,
      preferredModels: req.preferredModels ?? (req.model ? [req.model] : undefined),
      fallbackModels: req.fallbackModels,
      maxCostUsd: req.maxCostUsd,
    },
  };

  for await (const chunk of streamLLMOrchestrated(orchestratorInput)) {
    yield chunk;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON extraction helper (preserved verbatim from previous gateway)
// ─────────────────────────────────────────────────────────────────────────────

export function extractJSON<T = unknown>(content: string): T | null {
  try { return JSON.parse(content) as T; } catch { /* continue */ }
  const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock?.[1]) {
    try { return JSON.parse(codeBlock[1].trim()) as T; } catch { /* continue */ }
  }
  const firstBrace = content.indexOf('{');
  const lastBrace = content.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(content.slice(firstBrace, lastBrace + 1)) as T; } catch { /* continue */ }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embeddings (unchanged — embeddings don't go through chat orchestrator)
// ─────────────────────────────────────────────────────────────────────────────

export async function getEmbedding(text: string, model = 'text-embedding-3-small'): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logger.warn('getEmbedding: No API key — returning zero vector');
    return new Array(1536).fill(0);
  }
  const isOpenAI = !!process.env.OPENAI_API_KEY;
  const url = isOpenAI
    ? 'https://api.openai.com/v1/embeddings'
    : 'https://openrouter.ai/api/v1/embeddings';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(isOpenAI ? {} : { 'HTTP-Referer': 'https://jurexio.com' }),
    },
    body: JSON.stringify({ input: text, model }),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.ok === false) throw new Error(`Embedding API ${res.status}`);
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data[0]?.embedding ?? new Array(1536).fill(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: build request ID
// ─────────────────────────────────────────────────────────────────────────────

export function makeRequestId(prefix = 'req'): string {
  return `${prefix}-${Date.now()}-${randomUUID().substring(0, 8)}`;
}
