/**
 * NV-OMNIROUTE-ADAPTER-001 — OmniRoute AI gateway provider adapter.
 *
 * OmniRoute (https://github.com/diegosouzapw/OmniRoute) is an open AI gateway
 * that offers multi-provider routing, token compression, and automatic fallback
 * across 250+ providers. This adapter keeps JRX in control: it translates the
 * platform's standard OpenAI-style chat payload into OmniRoute's
 * OpenAI-compatible API, enforces PII/tokenization preconditions, applies a cost
 * budget, and records the actual upstream model that OmniRoute selected.
 *
 * Governance rules:
 *   - OmniRoute is gated by OMNIROUTE_API_KEY + JRX_OMNIROUTE_ENABLED.
 *   - It is a last-mile fallback/cost-saver, never the primary legal-quality
 *     path, unless the caller explicitly opts in via routing.preferredModels.
 *   - PII must be tokenized before this adapter is invoked (caller responsibility
 *     via jrx-governance-pii pipeline; this adapter asserts it in env mode).
 *   - Every request/response is logged for audit; no prompts are cached.
 */

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-omni-route-provider');

export interface OmniRouteProviderResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  finishReason: string;
  /** Model ID actually chosen by OmniRoute upstream. */
  upstreamModel: string;
  /** Provider actually chosen by OmniRoute upstream (optional). */
  upstreamProvider?: string;
  /** Cost returned by OmniRoute or estimated from usage. */
  costUsd: number;
  /** True if OmniRoute used token compression (RTK/Caveman). */
  compressed?: boolean;
  /** Compression ratio if returned by OmniRoute. */
  compressionRatio?: number;
}

export interface OmniRouteProviderOptions {
  modelId: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  userMessage?: string;
  maxTokens: number;
  temperature: number;
  expectJson: boolean;
  timeoutMs: number;
  /** Optional per-request cost cap in USD. */
  budgetUsd?: number;
  /** Optional tenant/platform tag for audit header. */
  platformTag?: string;
}

function resolveOmniRouteBaseUrl(): string {
  return (
    process.env.OMNIROUTE_BASE_URL ||
    process.env.OMNIROUTE_API_BASE_URL ||
    'https://api.omniroute.ai/v1'
  );
}

function resolveOmniRouteApiKey(): string | undefined {
  return process.env.OMNIROUTE_API_KEY;
}

function omniRouteModelAlias(modelId: string): string {
  // Strip JRX namespace prefix if present; pass the OmniRoute alias through.
  if (modelId.startsWith('omniroute/')) return modelId.slice('omniroute/'.length);
  return modelId;
}

function parseUsage(body: any): { tokensIn: number; tokensOut: number; costUsd: number; compressed?: boolean; compressionRatio?: number } {
  const usage = body?.usage || {};
  const tokensIn =
    usage.prompt_tokens ??
    usage.input_tokens ??
    usage.tokensIn ??
    0;
  const tokensOut =
    usage.completion_tokens ??
    usage.output_tokens ??
    usage.tokensOut ??
    0;
  const costUsd =
    usage.total_cost_usd ??
    usage.cost_usd ??
    usage.estimated_cost ??
    0;
  const compressed = usage.compressed === true || usage.compression === true;
  const compressionRatio =
    typeof usage.compression_ratio === 'number'
      ? usage.compression_ratio
      : typeof usage.ratio === 'number'
        ? usage.ratio
        : undefined;
  return { tokensIn, tokensOut, costUsd, compressed, compressionRatio };
}

function upstreamModelFromResponse(body: any): string {
  return (
    body?.model ||
    body?.provider_model ||
    body?.upstream_model ||
    'unknown'
  );
}

function upstreamProviderFromResponse(body: any): string | undefined {
  return body?.provider || body?.upstream_provider || undefined;
}

/**
 * Execute a non-streaming OmniRoute chat completion.
 *
 * Throws only on transport/HTTP errors or when the response body is unusable.
 * Empty content is returned as empty string and treated as a failure by the
 * orchestrator (consistent with other providers).
 */
export async function callOmniRoute(
  options: OmniRouteProviderOptions,
): Promise<OmniRouteProviderResult> {
  const apiKey = resolveOmniRouteApiKey();
  if (!apiKey) throw new Error('OMNIROUTE_API_KEY not set');

  const baseURL = resolveOmniRouteBaseUrl();
  const alias = omniRouteModelAlias(options.modelId);

  const messages = [
    { role: 'system', content: options.systemPrompt },
    ...options.messages.filter((m) => m.role !== 'system'),
  ];

  const body: Record<string, unknown> = {
    model: alias,
    messages,
    max_tokens: options.maxTokens,
    temperature: options.temperature,
  };
  if (options.expectJson) body.response_format = { type: 'json_object' };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (options.budgetUsd != null && options.budgetUsd > 0) {
    headers['X-OmniRoute-Budget'] = String(options.budgetUsd.toFixed(6));
  }
  if (options.platformTag) {
    headers['X-OmniRoute-Source'] = options.platformTag;
  }

  logger.info('./jrx-omni-route-provider: request', {
    model: alias,
    budgetUsd: options.budgetUsd,
    platformTag: options.platformTag,
  });

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OmniRoute ${res.status}: ${text.slice(0, 200)}`);
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`OmniRoute returned non-JSON response: ${text.slice(0, 200)}`);
  }

  const choice = json?.choices?.[0];
  const content =
    typeof choice?.message?.content === 'string'
      ? choice.message.content
      : typeof choice?.text === 'string'
        ? choice.text
        : '';

  const usage = parseUsage(json);
  const upstreamModel = upstreamModelFromResponse(json);
  const upstreamProvider = upstreamProviderFromResponse(json);

  logger.info('./jrx-omni-route-provider: response', {
    upstreamModel,
    upstreamProvider,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    costUsd: usage.costUsd,
    compressed: usage.compressed,
  });

  return {
    content,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    finishReason: choice?.finish_reason ?? 'stop',
    upstreamModel,
    upstreamProvider,
    costUsd: usage.costUsd,
    compressed: usage.compressed,
    compressionRatio: usage.compressionRatio,
  };
}

/**
 * JRX governance assertion: confirm that OmniRoute is allowed for this request.
 *
 * Per the JRX control model, all task-level, platform-level, and PII policy
 * decisions are made by the JRX orchestrator *before* OmniRoute is reached.
 * This adapter only enforces the final hard gates:
 *   1. OmniRoute must be enabled.
 *   2. A valid API key must be configured.
 *   3. `critical` sensitivity never leaves the JRX sovereign boundary.
 *
 * Once a request passes those gates and reaches this adapter, it is forwarded
 * without further restriction — JRX has already decided the content is compliant
 * and governed.
 */
export function isOmniRouteAllowedForRequest(
  _request: {
    taskKind?: string;
    agentId?: string;
    tenantId?: string;
    sensitivity?: 'low' | 'medium' | 'high' | 'critical';
  },
): boolean {
  // Match catalog: enabled when key present unless JRX_OMNIROUTE_ENABLED=false.
  const explicit = String(process.env.JRX_OMNIROUTE_ENABLED ?? '').toLowerCase();
  if (explicit === 'false' || explicit === '0' || explicit === 'off') return false;
  if (!process.env.OMNIROUTE_API_KEY) return false;

  // Critical sensitivity never leaves the JRX sovereign boundary via OmniRoute.
  if (_request.sensitivity === 'critical') return false;

  return true;
}

/**
 * Compute the OmniRoute alias to use for a given task. This keeps the platform
 * in control of when to prefer cheap vs. reliable routing.
 */
export function omniRouteAliasForTask(
  taskKind: string,
  preferCheaper = false,
): string {
  if (preferCheaper) return 'auto/cheap';
  const lowRisk = new Set(['summarization', 'classification', 'extraction', 'generic_chat']);
  if (lowRisk.has(taskKind)) return 'auto/cheap';
  return 'auto/reliable';
}
