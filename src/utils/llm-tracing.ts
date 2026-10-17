/**
 * OpenTelemetry LLM-Specific Tracing Wrapper
 * Provides specialized tracing for LLM calls with token counts, costs, and provider metrics
 * Compatible with OTel format for future migration to full collector
 */

import { createLogger } from './logger.js';
import { startSpan, endSpan, Span, SpanAttributes } from './tracing.js';

const logger = createLogger('llm-tracing');

// ================================================================================================
// TYPES & INTERFACES
// ================================================================================================

/**
 * LLM call metrics
 */
export interface LLMMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  costUsd: number;
}

/**
 * LLM span result with metrics
 */
export interface LLMSpanResult {
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  cost: number;
  latencyMs: number;
  success: boolean;
  error?: string;
  model?: string;
  provider?: string;
}

/**
 * LLM trace data structure - OTel compatible
 */
export interface LLMTraceData {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  latency_ms: number;
  cost_usd: number;
  success: boolean;
  error?: string;
  timestamp: string;
  duration_seconds: number;
  tokens_per_second: number;
}

// ================================================================================================
// CONSTANTS
// ================================================================================================

/**
 * Estimated token costs per provider (USD per 1K tokens)
 * These are approximate and should be updated based on actual pricing
 */
const PROVIDER_COSTS: Record<string, { input: number; output: number }> = {
  'openai': { input: 0.0015, output: 0.006 },
  'openai_integrations': { input: 0.0, output: 0.0 }, // Proxy / integration credits
  'anthropic': { input: 0.003, output: 0.015 },
  'google': { input: 0.00075, output: 0.003 },
  'openrouter': { input: 0.0, output: 0.0 }, // Free tier available
  'groq': { input: 0.0, output: 0.0 }, // Free tier available
  'deepseek': { input: 0.000135, output: 0.00055 },
  'mistral': { input: 0.0005, output: 0.0015 },
  'together-ai': { input: 0.0005, output: 0.0015 },
  'cohere': { input: 0.0005, output: 0.0015 },
  'kimi-k2': { input: 0.0, output: 0.0 }, // Free tier available
  'sarvam': { input: 0.0, output: 0.0 }, // Free tier available
  'xai': { input: 0.0, output: 0.0 }, // Free tier for Grok
  'perplexity': { input: 0.0, output: 0.0 }, // Free tier available
};

// ================================================================================================
// CORE LLM TRACING FUNCTIONS
// ================================================================================================

/**
 * Create a span for an LLM call
 * Tracks provider, model, and prepares span for metrics collection
 *
 * @param provider - LLM provider name (openai, anthropic, google, etc.)
 * @param model - Model name being used
 * @param attributes - Optional additional attributes to attach
 * @returns Span object configured for LLM metrics
 */
export function createLLMSpan(
  provider: string,
  model: string,
  attributes?: SpanAttributes
): Span {
  // OTel GenAI semantic-convention span name: "{operation} {model}".
  const operation = String(attributes?.['gen_ai.operation.name'] || 'chat');
  const spanName = `${operation} ${model}`;

  const llmAttributes: SpanAttributes = {
    // Legacy llm.* attributes retained for back-compat with existing dashboards.
    'llm.provider': provider,
    'llm.model': model,
    'llm.system': 'nyayavigya',
    // OTel GenAI semantic conventions (gen_ai.*) — the current standard, so
    // spans line up with collectors/observability tooling out of the box.
    'gen_ai.system': provider,
    'gen_ai.operation.name': operation,
    'gen_ai.request.model': model,
    ...attributes,
  };

  return startSpan(spanName, llmAttributes);
}

/**
 * End an LLM span with result metrics
 * Calculates costs and token rates, logs structured LLM trace
 *
 * @param span - LLM span to end
 * @param result - LLM call result with token counts and cost
 */
export function endLLMSpan(span: Span, result: LLMSpanResult): void {
  const provider = String(span.attributes['llm.provider'] || 'unknown');
  const model = String(span.attributes['llm.model'] || 'unknown');

  // Calculate metrics
  const { tokens, cost, latencyMs, success, error } = result;
  const totalTokens = tokens.input + tokens.output;
  const tokensPerSecond = latencyMs > 0 ? (totalTokens / latencyMs) * 1000 : 0;
  const durationSeconds = latencyMs / 1000;

  // Update span with final attributes
  span.attributes['llm.tokens.input'] = tokens.input;
  span.attributes['llm.tokens.output'] = tokens.output;
  span.attributes['llm.tokens.total'] = totalTokens;
  span.attributes['llm.cost_usd'] = cost;
  span.attributes['llm.latency_ms'] = latencyMs;
  span.attributes['llm.tokens_per_second'] = Math.round(tokensPerSecond * 100) / 100;
  span.attributes['llm.success'] = success;

  // OTel GenAI usage conventions (gen_ai.usage.*) mirrored from the metrics so
  // the exported span is collector-native without losing the legacy llm.* set.
  if (result.model) span.attributes['gen_ai.response.model'] = result.model;
  span.attributes['gen_ai.usage.input_tokens'] = tokens.input;
  span.attributes['gen_ai.usage.output_tokens'] = tokens.output;
  span.attributes['gen_ai.usage.total_tokens'] = totalTokens;
  span.attributes['gen_ai.usage.cost'] = cost;

  if (error) {
    span.attributes['llm.error'] = error;
    span.attributes['error.type'] = error;
  }

  // End span with appropriate status. endSpan() (tracing.ts) performs the
  // single OTLP export for this span — it detects gen_ai.* attributes set above
  // and exports it as a CLIENT-kind LLM span, so we do NOT export again here.
  endSpan(span, success ? 'OK' : 'ERROR', error);

  // Log structured LLM trace
  const traceData: LLMTraceData = {
    provider,
    model,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    total_tokens: totalTokens,
    latency_ms: latencyMs,
    cost_usd: cost,
    success,
    error,
    timestamp: new Date().toISOString(),
    duration_seconds: durationSeconds,
    tokens_per_second: Math.round(tokensPerSecond * 100) / 100,
  };

  if (process.env.NODE_ENV === 'production') {
    // Production: structured JSON log compatible with OTel format
    const otelTrace = {
      resourceSpans: [
        {
          resource: {
            attributes: {
              'service.name': 'nyayavigya',
              'service.version': process.env.SERVICE_VERSION || '1.0.0',
              'service.namespace': 'ai-platform',
            },
          },
          scopeSpans: [
            {
              scope: {
                name: 'nyayavigya-llm-tracer',
                version: '1.0.0',
              },
              spans: [
                {
                  traceId: span.traceId,
                  spanId: span.spanId,
                  parentSpanId: span.parentSpanId,
                  name: span.name,
                  kind: 5, // SPAN_KIND_CLIENT
                  startTimeUnixNano: span.startTime * 1_000_000,
                  endTimeUnixNano: (span.endTime || Date.now()) * 1_000_000,
                  attributes: {
                    'llm.provider': provider,
                    'llm.model': model,
                    'llm.tokens.input': tokens.input,
                    'llm.tokens.output': tokens.output,
                    'llm.tokens.total': totalTokens,
                    'llm.latency_ms': latencyMs,
                    'llm.cost_usd': cost,
                    'llm.success': success,
                    'llm.tokens_per_second': tokensPerSecond,
                    ...span.attributes,
                  },
                  status: {
                    code: success ? 0 : 2, // 0=OK, 2=ERROR
                    message: error || '',
                  },
                  droppedAttributesCount: 0,
                  droppedEventsCount: 0,
                  droppedLinksCount: 0,
                },
              ],
            },
          ],
        },
      ],
    };

    logger.info('llm.trace', otelTrace);
  } else {
    // Development: human-readable trace info
    logger.debug('LLM Trace', {
      provider,
      model,
      tokens: {
        input: tokens.input,
        output: tokens.output,
        total: totalTokens,
      },
      metrics: {
        latency_ms: latencyMs,
        cost_usd: cost,
        tokens_per_second: Math.round(tokensPerSecond * 100) / 100,
      },
      success,
      error,
    });
  }
}

/**
 * Log a complete LLM call trace (convenience function)
 * Use this for direct logging without span management
 *
 * @param provider - LLM provider name
 * @param model - Model name
 * @param promptTokens - Number of input tokens
 * @param completionTokens - Number of output tokens
 * @param latencyMs - Latency in milliseconds
 * @param cost - Cost in USD
 * @param success - Whether the call was successful
 * @param error - Optional error message
 */
export function traceLLMCall(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  latencyMs: number,
  cost: number,
  success: boolean,
  error?: string
): void {
  const span = createLLMSpan(provider, model);

  endLLMSpan(span, {
    tokens: {
      input: promptTokens,
      output: completionTokens,
      total: promptTokens + completionTokens,
    },
    cost,
    latencyMs,
    success,
    error,
    provider,
    model,
  });
}

/**
 * Calculate cost for an LLM call based on tokens and provider
 * Uses estimated pricing from PROVIDER_COSTS
 *
 * @param provider - Provider name
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @returns Estimated cost in USD
 */
export function calculateLLMCost(
  provider: string,
  inputTokens: number,
  outputTokens: number
): number {
  const providerCost = PROVIDER_COSTS[provider];

  if (!providerCost) {
    logger.warn('unknown provider for cost calculation', {
      provider,
    });
    return 0;
  }

  const inputCost = (inputTokens / 1000) * providerCost.input;
  const outputCost = (outputTokens / 1000) * providerCost.output;

  return Math.round((inputCost + outputCost) * 10000) / 10000; // Round to 4 decimal places
}

/**
 * Update provider costs dynamically
 * Useful for real-time pricing updates
 *
 * @param provider - Provider name
 * @param inputCost - Cost per 1K input tokens
 * @param outputCost - Cost per 1K output tokens
 */
export function setProviderCost(
  provider: string,
  inputCost: number,
  outputCost: number
): void {
  PROVIDER_COSTS[provider] = {
    input: inputCost,
    output: outputCost,
  };

  logger.info('provider cost updated', {
    provider,
    inputCost,
    outputCost,
  });
}

/**
 * Get estimated cost for a provider
 * @param provider - Provider name
 * @returns Cost structure or null if provider unknown
 */
export function getProviderCost(
  provider: string
): { input: number; output: number } | null {
  return PROVIDER_COSTS[provider] || null;
}

/**
 * Create a batch LLM trace for multiple calls
 * Useful for tracking multiple LLM operations in a single request
 *
 * @param provider - Provider name
 * @param model - Model name
 * @param calls - Array of LLM call metrics
 */
export function traceLLMBatch(
  provider: string,
  model: string,
  calls: Array<{
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    success: boolean;
    error?: string;
  }>
): void {
  const totalInputTokens = calls.reduce((sum, c) => sum + c.promptTokens, 0);
  const totalOutputTokens = calls.reduce((sum, c) => sum + c.completionTokens, 0);
  const totalLatency = calls.reduce((sum, c) => sum + c.latencyMs, 0);
  const totalCost = calculateLLMCost(provider, totalInputTokens, totalOutputTokens);
  const successCount = calls.filter(c => c.success).length;

  const span = createLLMSpan(provider, model, {
    'llm.batch_size': String(calls.length),
    'llm.batch_success_rate': String(Math.round((successCount / calls.length) * 100)),
  });

  endLLMSpan(span, {
    tokens: {
      input: totalInputTokens,
      output: totalOutputTokens,
      total: totalInputTokens + totalOutputTokens,
    },
    cost: totalCost,
    latencyMs: totalLatency,
    success: successCount === calls.length,
    provider,
    model,
  });
}

export default {
  createLLMSpan,
  endLLMSpan,
  traceLLMCall,
  traceLLMBatch,
  calculateLLMCost,
  setProviderCost,
  getProviderCost,
};
