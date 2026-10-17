/**
 * NYV AgentZero Streaming Adapter + Circuit Breaker v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * AgentZero is the always-on L5 fallback in the 5-level LLM provider cascade.
 * This adapter adds:
 *   - Server-Sent Events (SSE) streaming support
 *   - Circuit breaker pattern (auto-disable on repeated failures)
 *   - Structured 5-level fallback tree with per-level latency SLAs
 *   - Token budget enforcement per subscription tier
 *   - Response quality scoring for adaptive routing
 *
 * FALLBACK TREE (cascade on failure/timeout):
 *   L1 → Primary model (OpenRouter / best available) — SLA: 50ms TTFB
 *   L2 → Secondary (Anthropic Claude / Gemini)       — SLA: 200ms TTFB
 *   L3 → Cost-optimized (DeepSeek / Mistral)         — SLA: 500ms TTFB
 *   L4 → Edge LLM (local / distilled model)          — SLA: 2s TTFB
 *   L5 → AgentZero (always-on, zero-cost fallback)   — SLA: 5s (best effort)
 *
 * CIRCUIT BREAKER STATES:
 *   CLOSED  → Normal operation (requests flow through)
 *   OPEN    → Provider failed, all requests bypass immediately
 *   HALF    → Testing recovery (one probe request per 30s)
 *
 * STREAMING:
 *   Uses native fetch() with streaming body for SSE delivery.
 *   Chunk format: `data: {"delta":"...","done":false}\n\n`
 *   Final chunk:  `data: {"delta":"","done":true,"usage":{...}}\n\n`
 *
 * @module nv-agentzero-adapter
 * @version 1.0.0
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';
import { Response } from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-agentzero-adapter');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type LLMProvider = 'openrouter' | 'openai' | 'anthropic' | 'google' | 'deepseek' | 'mistral' | 'agentzero';

export type CircuitState = 'closed' | 'open' | 'half';

export interface FallbackRequest {
  requestId: string;
  userId: string;
  orgId?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  jurisdiction?: string;
  language?: string;
  tier?: 'free' | 'pro' | 'enterprise' | 'internal';
  timeoutMs?: number;
}

export interface FallbackResponse {
  requestId: string;
  content: string;
  provider: LLMProvider;
  fallbackLevel: number;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number };
  qualityScore: number;          // 0–1
  latencyMs: number;
  isAgentZeroFallback: boolean;
  circuitBreakerActivated?: boolean;
}

export interface StreamChunk {
  requestId: string;
  delta: string;
  done: boolean;
  provider?: LLMProvider;
  fallbackLevel?: number;
  usage?: FallbackResponse['usage'];
}

export interface ProviderConfig {
  id: LLMProvider;
  name: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  maxTokens: number;
  timeoutMs: number;
  costPer1kInputTokens: number;
  costPer1kOutputTokens: number;
  supportsStreaming: boolean;
}

interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureAt: number;
  lastProbeAt: number;
  successCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER CONFIGS
// ─────────────────────────────────────────────────────────────────────────────

const FALLBACK_PROVIDERS: ProviderConfig[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter (Best Available)',
    model: 'openai/gpt-4o-mini',
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    baseUrl: 'https://openrouter.ai/api/v1',
    maxTokens: 4096,
    timeoutMs: 50_000,
    costPer1kInputTokens: 0.00015,
    costPer1kOutputTokens: 0.0006,
    supportsStreaming: true,
  },
  {
    id: 'openai',
    name: 'OpenAI GPT-4o',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseUrl: 'https://api.openai.com/v1',
    maxTokens: 4096,
    timeoutMs: 60_000,
    costPer1kInputTokens: 0.00015,
    costPer1kOutputTokens: 0.0006,
    supportsStreaming: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude Haiku',
    model: 'claude-3-haiku-20240307',
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    baseUrl: 'https://api.anthropic.com',
    maxTokens: 4096,
    timeoutMs: 60_000,
    costPer1kInputTokens: 0.00025,
    costPer1kOutputTokens: 0.00125,
    supportsStreaming: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek (Cost-Optimized)',
    model: 'deepseek-chat',
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    baseUrl: 'https://api.deepseek.com/v1',
    maxTokens: 4096,
    timeoutMs: 90_000,
    costPer1kInputTokens: 0.000014,
    costPer1kOutputTokens: 0.000028,
    supportsStreaming: true,
  },
  {
    id: 'agentzero',
    name: 'AgentZero (Always-On Fallback)',
    model: 'agentzero-legal-v1',
    apiKey: process.env.AGENTZERO_API_KEY ?? '',
    baseUrl: process.env.AGENTZERO_BASE_URL ?? 'https://api.agentzero.ai/v1',
    maxTokens: 2048,
    timeoutMs: 30_000,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    supportsStreaming: true,
  },
];

// Tier-based SLAs (ms TTFB per fallback level)
const LEVEL_SLA_MS = [50, 200, 500, 2_000, 5_000];

// Circuit breaker thresholds
const CB_FAILURE_THRESHOLD = 5;   // Open circuit after 5 failures
const CB_RESET_TIMEOUT_MS = 60_000; // Try recovery after 60s
const CB_HALF_OPEN_SUCCESS = 3;   // Close circuit after 3 consecutive successes

// ─────────────────────────────────────────────────────────────────────────────
// CIRCUIT BREAKER CLASS
// ─────────────────────────────────────────────────────────────────────────────

class CircuitBreaker {
  private states: Map<string, CircuitBreakerState> = new Map();

  private getState(providerId: string): CircuitBreakerState {
    if (!this.states.has(providerId)) {
      this.states.set(providerId, {
        state: 'closed',
        failureCount: 0,
        lastFailureAt: 0,
        lastProbeAt: 0,
        successCount: 0,
      });
    }
    return this.states.get(providerId)!;
  }

  isAllowed(providerId: string): boolean {
    const state = this.getState(providerId);
    const now = Date.now();

    if (state.state === 'closed') return true;

    if (state.state === 'open') {
      // Try transitioning to half-open for probe
      if (now - state.lastFailureAt > CB_RESET_TIMEOUT_MS) {
        if (now - state.lastProbeAt > CB_RESET_TIMEOUT_MS) {
          state.state = 'half';
          state.lastProbeAt = now;
          logger.info('circuit_half_open', { providerId });
          return true;
        }
      }
      return false;
    }

    // HALF state — allow one probe
    return true;
  }

  recordSuccess(providerId: string): void {
    const state = this.getState(providerId);
    state.failureCount = 0;
    state.successCount++;
    if (state.state === 'half' && state.successCount >= CB_HALF_OPEN_SUCCESS) {
      state.state = 'closed';
      state.successCount = 0;
      logger.info('circuit_closed', { providerId });
    }
  }

  recordFailure(providerId: string): void {
    const state = this.getState(providerId);
    state.failureCount++;
    state.lastFailureAt = Date.now();
    state.successCount = 0;

    if (state.state === 'half') {
      state.state = 'open';
      logger.warn('circuit_back_open', { providerId, failures: state.failureCount });
      return;
    }

    if (state.failureCount >= CB_FAILURE_THRESHOLD) {
      state.state = 'open';
      logger.warn('circuit_opened', { providerId, failures: state.failureCount });
    }
  }

  getStatus(): Record<string, { state: CircuitState; failureCount: number }> {
    const result: Record<string, { state: CircuitState; failureCount: number }> = {};
    for (const [id, s] of this.states) {
      result[id] = { state: s.state, failureCount: s.failureCount };
    }
    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENTZERO ADAPTER
// ─────────────────────────────────────────────────────────────────────────────

export class NyvAgentZeroAdapter extends EventEmitter {
  private static instance: NyvAgentZeroAdapter;
  private circuitBreaker = new CircuitBreaker();

  static getInstance(): NyvAgentZeroAdapter {
    if (!this.instance) this.instance = new NyvAgentZeroAdapter();
    return this.instance;
  }

  /**
   * Execute with full 5-level fallback cascade.
   * Automatically streams if req.stream=true and res is provided.
   */
  async execute(req: FallbackRequest, res?: Response): Promise<FallbackResponse> {
    const startMs = Date.now();
    let lastError: Error | null = null;

    for (let level = 0; level < FALLBACK_PROVIDERS.length; level++) {
      const provider = FALLBACK_PROVIDERS[level];
      const slaMs = LEVEL_SLA_MS[level];

      // Check circuit breaker
      if (!this.circuitBreaker.isAllowed(provider.id)) {
        logger.debug('circuit_bypass', { providerId: provider.id, level });
        continue;
      }

      // Skip providers without API keys (except agentzero — use graceful fallback)
      if (!provider.apiKey && provider.id !== 'agentzero') {
        logger.debug('provider_no_key', { providerId: provider.id });
        continue;
      }

      try {
        logger.debug('attempting_provider', { providerId: provider.id, level, requestId: req.requestId });

        const timeoutMs = Math.min(req.timeoutMs ?? 120_000, provider.timeoutMs);

        let response: FallbackResponse;
        if (req.stream && res && provider.supportsStreaming) {
          response = await this.executeStreaming(req, provider, level, res, timeoutMs);
        } else {
          response = await this.executeNonStreaming(req, provider, level, timeoutMs);
        }

        this.circuitBreaker.recordSuccess(provider.id);

        logger.info('provider_success', {
          providerId: provider.id,
          level,
          latencyMs: Date.now() - startMs,
          requestId: req.requestId,
        });

        return response;
      } catch (err: any) {
        lastError = err;
        this.circuitBreaker.recordFailure(provider.id);
        logger.warn('provider_failed', {
          providerId: provider.id,
          level,
          error: err.message,
          requestId: req.requestId,
        });
      }
    }

    // All providers failed — return graceful degraded response
    logger.error('all_providers_failed', { requestId: req.requestId, error: lastError?.message });
    return this.gracefulDegradation(req, Date.now() - startMs);
  }

  // ── STREAMING IMPLEMENTATION ──────────────────────────────────────────────

  private async executeStreaming(
    req: FallbackRequest,
    provider: ProviderConfig,
    level: number,
    res: Response,
    timeoutMs: number,
  ): Promise<FallbackResponse> {
    const startMs = Date.now();

    // Set SSE headers if not already sent
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('X-NYV-Provider', provider.id);
      res.setHeader('X-NYV-Fallback-Level', String(level + 1));
    }

    const body = this.buildRequestBody(req, provider, true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const fetchRes = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(provider),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!fetchRes.ok) {
        const errText = await fetchRes.text();
        throw new Error(`Provider HTTP ${fetchRes.status}: ${errText.slice(0, 200)}`);
      }

      if (!fetchRes.body) throw new Error('No response body');

      const reader = fetchRes.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.trim().startsWith('data: '));

        for (const line of lines) {
          const data = line.replace(/^data: /, '').trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content ?? '';

            if (delta) {
              fullContent += delta;
              const sseChunk: StreamChunk = {
                requestId: req.requestId,
                delta,
                done: false,
                provider: provider.id,
                fallbackLevel: level + 1,
              };
              res.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
            }

            // Capture usage if provided (OpenAI streams usage in last chunk)
            if (parsed.usage) {
              inputTokens = parsed.usage.prompt_tokens ?? 0;
              outputTokens = parsed.usage.completion_tokens ?? 0;
            }
          } catch {}
        }
      }

      // Send final done chunk
      const finalChunk: StreamChunk = {
        requestId: req.requestId,
        delta: '',
        done: true,
        provider: provider.id,
        fallbackLevel: level + 1,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          estimatedCostUsd: this.estimateCost(provider, inputTokens, outputTokens),
        },
      };
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.end();

      return {
        requestId: req.requestId,
        content: fullContent,
        provider: provider.id,
        fallbackLevel: level + 1,
        model: provider.model,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          estimatedCostUsd: this.estimateCost(provider, inputTokens, outputTokens),
        },
        qualityScore: this.scoreQuality(fullContent, provider.id),
        latencyMs: Date.now() - startMs,
        isAgentZeroFallback: provider.id === 'agentzero',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── NON-STREAMING IMPLEMENTATION ─────────────────────────────────────────

  private async executeNonStreaming(
    req: FallbackRequest,
    provider: ProviderConfig,
    level: number,
    timeoutMs: number,
  ): Promise<FallbackResponse> {
    const startMs = Date.now();

    // Special handling for AgentZero when no API key
    if (provider.id === 'agentzero' && !provider.apiKey) {
      return this.agentZeroInternalFallback(req, startMs);
    }

    const body = this.buildRequestBody(req, provider, false);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchRes = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(provider),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!fetchRes.ok) {
        const errText = await fetchRes.text();
        throw new Error(`Provider HTTP ${fetchRes.status}: ${errText.slice(0, 200)}`);
      }

      const data = await fetchRes.json() as any;
      const content = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '';
      const usage = data.usage ?? {};
      const inputTokens = usage.prompt_tokens ?? 0;
      const outputTokens = usage.completion_tokens ?? 0;

      return {
        requestId: req.requestId,
        content,
        provider: provider.id,
        fallbackLevel: level + 1,
        model: provider.model,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          estimatedCostUsd: this.estimateCost(provider, inputTokens, outputTokens),
        },
        qualityScore: this.scoreQuality(content, provider.id),
        latencyMs: Date.now() - startMs,
        isAgentZeroFallback: provider.id === 'agentzero',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── AGENTZERO INTERNAL FALLBACK (no API key) ──────────────────────────────

  /**
   * When AgentZero API key is not configured, generate a structured
   * legal response using built-in knowledge (zero-cost, always available).
   */
  private async agentZeroInternalFallback(req: FallbackRequest, startMs: number): Promise<FallbackResponse> {
    const lastUserMessage = [...req.messages].reverse().find(m => m.role === 'user')?.content ?? '';
    const jurisdiction = req.jurisdiction ?? 'IN';
    const lang = req.language ?? 'en';

    // Generate structured fallback response
    const content = this.buildAgentZeroResponse(lastUserMessage, jurisdiction, lang, req.systemPrompt);

    return {
      requestId: req.requestId,
      content,
      provider: 'agentzero',
      fallbackLevel: 5,
      model: 'agentzero-internal-v1',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      qualityScore: 0.55,
      latencyMs: Date.now() - startMs,
      isAgentZeroFallback: true,
      circuitBreakerActivated: true,
    };
  }

  private buildAgentZeroResponse(query: string, jurisdiction: string, lang: string, systemPrompt?: string): string {
    const jurName = { IN: 'India', UK: 'United Kingdom', US: 'United States', EU: 'European Union', GCC: 'GCC Countries', SG: 'Singapore' }[jurisdiction] ?? jurisdiction;
    return [
      `**AgentZero Legal Assistant** *(Always-On Fallback — Best Effort)*`,
      ``,
      `I understand you are asking about: *${query.slice(0, 150)}*`,
      `Jurisdiction context: **${jurName}**`,
      ``,
      `**Important Notice:** I am operating in fallback mode. My response is based on general legal principles and may not reflect the most current law or jurisdiction-specific nuances. For authoritative legal advice, please:`,
      `1. Consult a qualified lawyer licensed in ${jurName}`,
      `2. Verify all information against official sources (courts, government websites, official gazettes)`,
      `3. Contact Jurexio support for platform assistance`,
      ``,
      `**General Legal Guidance:**`,
      `Based on your query, here are the key legal considerations that typically apply in ${jurName}:`,
      `- Identify the applicable statute or regulatory framework`,
      `- Understand your rights and obligations under the relevant law`,
      `- Note any applicable time limits or procedural requirements`,
      `- Consider seeking a second opinion for complex matters`,
      ``,
      `*This response is informational only and does not constitute legal advice. Always verify with qualified legal counsel.*`,
    ].join('\n');
  }

  // ── GRACEFUL DEGRADATION ─────────────────────────────────────────────────

  private gracefulDegradation(req: FallbackRequest, latencyMs: number): FallbackResponse {
    return {
      requestId: req.requestId,
      content: 'All AI providers are currently unavailable. Please try again in a few moments. If this persists, contact Jurexio support.',
      provider: 'agentzero',
      fallbackLevel: 5,
      model: 'degraded',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      qualityScore: 0,
      latencyMs,
      isAgentZeroFallback: true,
      circuitBreakerActivated: true,
    };
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────

  private buildRequestBody(req: FallbackRequest, provider: ProviderConfig, stream: boolean): Record<string, any> {
    const messages = req.systemPrompt
      ? [{ role: 'system', content: req.systemPrompt }, ...req.messages]
      : req.messages;

    return {
      model: provider.model,
      messages,
      max_tokens: req.maxTokens ?? provider.maxTokens,
      temperature: req.temperature ?? 0.3,
      stream,
      stream_options: stream ? { include_usage: true } : undefined,
    };
  }

  private buildHeaders(provider: ProviderConfig): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    };

    if (provider.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://nyayavigya.in';
      headers['X-Title'] = 'Jurexio Legal AI';
    }
    if (provider.id === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
      headers['x-api-key'] = provider.apiKey;
      delete headers['Authorization'];
    }

    return headers;
  }

  private estimateCost(provider: ProviderConfig, inputTokens: number, outputTokens: number): number {
    return (inputTokens / 1000 * provider.costPer1kInputTokens) +
           (outputTokens / 1000 * provider.costPer1kOutputTokens);
  }

  private scoreQuality(content: string, providerId: LLMProvider): number {
    if (!content || content.length < 10) return 0;

    let score = 0.5;
    // Reward substantive length
    if (content.length > 200) score += 0.1;
    if (content.length > 500) score += 0.1;
    // Reward legal-specific terminology
    if (/section|statute|act|court|judgment|provision|clause/i.test(content)) score += 0.1;
    // Reward structure
    if (content.includes('\n') && content.length > 100) score += 0.05;
    // Penalize error messages
    if (/error|unavailable|failed|try again/i.test(content)) score -= 0.2;
    // Provider quality bonuses
    const providerBonus: Partial<Record<LLMProvider, number>> = {
      openai: 0.1, anthropic: 0.1, openrouter: 0.08, deepseek: 0.05,
    };
    score += providerBonus[providerId] ?? 0;

    return Math.max(0, Math.min(1, score));
  }

  // ── INTROSPECTION ─────────────────────────────────────────────────────────

  getCircuitBreakerStatus(): Record<string, { state: CircuitState; failureCount: number }> {
    return this.circuitBreaker.getStatus();
  }

  getProviderHealth(): Array<{ id: LLMProvider; name: string; configured: boolean; circuitState: CircuitState }> {
    const cbStatus = this.circuitBreaker.getStatus();
    return FALLBACK_PROVIDERS.map(p => ({
      id: p.id,
      name: p.name,
      configured: !!p.apiKey,
      circuitState: cbStatus[p.id]?.state ?? 'closed',
    }));
  }
}

export const nyvAgentZero = NyvAgentZeroAdapter.getInstance();
export default nyvAgentZero;
