/**
 * Single consolidated LLM orchestration entrypoint.
 *
 * Every outbound LLM call in the platform must go through `orchestrateLLM`.
 * Steps:
 *   1. Sanitize inputs (tier/jurisdiction/agentClass/taskKind defaults).
 *   2. Build enriched system prompt (jurisdiction + template mode injection).
 *   3. Call IntelligentRouter.pickSequence to get a ranked candidate list.
 *   4. Iterate the sequence, calling each model's provider; never throws.
 *   5. Record health + stats for every attempt.
 *   6. Final fallback returns a flagged minimal response (isSimulation = true).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createLogger } from '../../utils/logger.js';
import { buildPlatformTemporalContextBlock } from '../../utils/jrx-platform-temporal-context.js';
import {
  pickSequence,
  type RouterDecision,
  type RouterRequest,
} from './intelligent-router.js';
import { recordSuccess, recordFailure, getModelP50Ms } from './health-tracker.js';
import { recordDecision } from './router-stats.js';
import { recordLlmUsage } from '../../utils/jrx-request-usage-context.js';
import { traceLLMCall } from '../../utils/llm-tracing.js';
import type { JurisdictionCode, ModelEntry, Provider } from './router-types.js';
import { isProviderAvailable } from './model-catalog.js';
import { callOmniRoute, isOmniRouteAllowedForRequest } from './jrx-omni-route-provider.js';
import { toGeminiApiModelId } from '../../config/jrx-gemini-models.js';
import { getBedrockRegionOrder } from '../../config/jrx-llm-cascade-config.js';
import { isPartnerLegalQualityTask } from '../../config/jrx-llm-routing-policy.js';
import {
  loadProviderGates,
  recordProviderFailure,
  recordProviderSuccess,
  tryHalfOpenProbe,
  type ProviderGate,
} from './jrx-provider-breaker.js';
import {
  classifyAndDecide,
  MAX_RETRIES_PER_RUNG,
  sleepWithSignal,
} from './jrx-llm-retry-policy.js';
import {
  attemptBudgetMs,
  startRequestDeadline,
  timeRemainingMs,
  NV_TASK_TIER_TIMEOUTS,
  type LlmAttemptTier,
  type RequestDeadline,
} from '../../config/jrx-timeout-policy.js';

const logger = createLogger('llm-orchestrator');

// NV-LLM-LATENCY-001 (2026-06-29): per-attempt provider HTTP timeouts.
// Previously every non-streaming provider call used a hard 90s AbortSignal
// and every streaming call used 120s. On the sequential fallback cascade a
// single hung/slow provider therefore blocked the whole chain for up to 90s
// before the next candidate was tried — the dominant tail-latency cause for
// POST /api/jrx/orchestrate (observed 90–230s on EC2). Tightening the
// non-streaming per-attempt budget to ~35s lets the cascade advance quickly
// while still leaving comfortable headroom for legitimately slow frontier
// completions (a healthy provider answers a 2–4k-token legal response well
// under 35s). Streaming keeps a longer budget because tokens flow
// incrementally and the client sees first-byte latency, not total. Both are
// env-overridable so EC2/ops can retune without a code change. Values are
// clamped to a sane floor so a typo can never set a 0ms (instant-abort)
// timeout that would break every provider call.
// NV-TIMEOUT-POLICY-001: quality-first defaults (45s / 120s). Partner lean
 // sync still gets fast cascade via quarantine; raise via env for deep research.
import { NV_TIMEOUTS } from '../../config/jrx-timeout-policy.js';
const LLM_PROVIDER_TIMEOUT_MS = Math.max(5_000, NV_TIMEOUTS.llmProviderMs);
const LLM_PROVIDER_STREAM_TIMEOUT_MS = Math.max(10_000, NV_TIMEOUTS.llmProviderStreamMs);

// NV-LLM-QUARANTINE-001 → NV-LLM-BREAKER-SHARED-001: the process-level
// quarantine Map has been replaced by the shared, Redis-backed provider gate in
// `jrx-provider-breaker.ts`. That module keeps an in-process mirror, so a Redis
// outage degrades to exactly the previous per-pod behaviour, while the streaming
// path (which used to keep its own per-invocation Set and therefore re-hit
// providers already known to return 402) now consults the same state.

// NV-LLM-HEDGE-CANCEL-001 — compose the per-attempt provider timeout with an
// optional caller cancellation signal.
//
// Measured defect this enables fixing: the hedge fires on every request, but
// `callModel` accepted no caller signal, so the losing branch ran to completion
// and was billed in full while its output was discarded. Provider spend was
// therefore ~2× the metered figure on hedged traffic.
//
// NV-LLM-DEADLINE-001 — the effective timeout is now the per-attempt budget
// (min of task-tier cap and remaining request deadline) rather than one flat
// 45s for every request shape. It is carried in AsyncLocalStorage so all
// fourteen provider functions inherit it without threading an extra parameter
// through each signature — there is still exactly ONE budget source, and a call
// made outside an attempt scope falls back to the previous flat behaviour.
const attemptBudgetStore = new AsyncLocalStorage<{ timeoutMs: number }>();

function currentAttemptTimeoutMs(fallbackMs: number): number {
  return attemptBudgetStore.getStore()?.timeoutMs ?? fallbackMs;
}

function attemptSignal(timeoutMs: number, caller?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(currentAttemptTimeoutMs(timeoutMs));
  if (!caller) return timeout;
  return AbortSignal.any([timeout, caller]);
}

/**
 * Provider-gate helper over the shared breaker.
 *
 * A gated provider is skipped without a network call. When the gate is OPEN (as
 * opposed to hard-quarantined) exactly one request cluster-wide is allowed
 * through as a half-open probe, so a recovering provider is rediscovered without
 * every pod stampeding it the moment the cooldown lapses.
 */
async function isProviderAllowed(
  provider: string,
  gates: Map<string, ProviderGate>,
): Promise<{ allowed: boolean; reason?: string }> {
  const gate = gates.get(provider);
  if (!gate || gate.allowed) return { allowed: true };
  if (gate.state === 'open' && (await tryHalfOpenProbe(provider))) {
    logger.info('llm-orchestrator: half-open probe', { provider });
    return { allowed: true, reason: 'half_open_probe' };
  }
  return { allowed: false, reason: `${gate.state}:${provider}` };
}

/**
 * NV-LLM-HEDGE-001 — delayed parallel fallback so a slow Bedrock primary does
 * not burn the full provider timeout before Gemini/OmniRoute starts.
 * Set JRX_LLM_HEDGE_MS (e.g. 3000). Default 2500 when unset so slow Bedrock
 * primary does not burn the full attempt budget before cascade/OpenRouter free.
 */
const LLM_HEDGE_MS = Math.max(
  0,
  Number(
    process.env.JRX_LLM_HEDGE_MS != null && process.env.JRX_LLM_HEDGE_MS !== ''
      ? process.env.JRX_LLM_HEDGE_MS
      : 2500,
  ) || 0,
);

/** NV-GEMINI-KEY-POOL-001: rotate across GEMINI_API_KEYS + primary env vars. */
function resolveGeminiApiKeys(): string[] {
  const pool = String(process.env.GEMINI_API_KEYS || '')
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const singles = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GOOGLE_AI_API_KEY,
    process.env.JRX_GOOGLE_API_KEY,
  ].filter((k): k is string => !!k && !!String(k).trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of [...pool, ...singles]) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function isGeminiKeyRetryable(errMsg: string): boolean {
  return /\b429\b|\b403\b|quota|resource.?exhausted|rate.?limit|billing|permission.?denied|API_KEY_INVALID|API key not valid/i.test(
    errMsg,
  );
}

function neverEmptyFallback(userMessage: string, requestId: string): string {
  const q = String(userMessage || '').trim().slice(0, 500);
  return [
    'I can help with this legal task using Jurexio’s fallback intelligence path.',
    q ? `Request focus: ${q}` : 'Please restate the parties, jurisdiction, and the specific question.',
    '',
    'Recommended next steps:',
    '1. Confirm jurisdiction (IN/UK/US/EU/SG) and document type.',
    '2. Provide the key facts or paste the clause/section to analyse.',
    '3. Retry — primary Gemini / Bedrock Nova routes will resume when providers recover.',
    '',
    'This response is informational and does not constitute legal advice. Consult a qualified advocate for formal advice.',
    `requestId=${requestId}`,
  ].join('\n');
}

export type TemplateMode = 'STRICT' | 'GUIDED' | 'MENTOR';

export interface OrchestrationInput {
  requestId: string;
  systemPrompt: string;
  userMessage: string;
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  routing: RouterRequest;
  templateMode?: TemplateMode;
  expectJson?: boolean;
  jsonSchema?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  /**
   * NV-LLM-DEADLINE-001 — absolute epoch-ms wall-clock deadline for the WHOLE
   * cascade, propagated from an outer scope (e.g. a Queen node that already
   * holds `queenTimeRemainingMs`). Every attempt receives
   * `remaining = deadline - now`, and a rung whose measured p50 exceeds that is
   * skipped rather than started and cut. Callers may pass `deadlineMs` (a
   * relative budget) instead when they do not track an absolute deadline.
   */
  deadlineAt?: number;
  deadlineMs?: number;
}

export interface OrchestrationOutput {
  content: string;
  model: string;
  provider: Provider;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  fallbackLevel: number;
  isSimulation: boolean;
  finishReason: string;
  requestId: string;
  costUsd: number;
  routerDecision: {
    primary: string;
    sequence: string[];
    inputs: RouterDecision['inputs'];
  };
  attempts: Array<{ modelId: string; ok: boolean; latencyMs: number; error?: string }>;
}

const JURISDICTION_INJECTIONS: Record<JurisdictionCode, string> = {
  IN: `JURISDICTION: India. Use Indian law ONLY.
Currency: INR (₹). Court hierarchy: Supreme Court → High Courts → District Courts → Magistrate Courts.
Statute references: Use current Acts only. Criminal law: BNS 2023, BNSS 2023, BSA 2023 (effective July 1, 2024).
DO NOT reference IPC, CrPC, or Indian Evidence Act for matters after July 1, 2024.
Civil: CPC 1908, Specific Relief Act 1963, Transfer of Property Act 1882.
Commercial: Companies Act 2013, SEBI regulations, RBI guidelines, GST Act 2017.
Data: DPDP Act 2023, IT Act 2000 (amended).`,
  UK: `JURISDICTION: United Kingdom (England & Wales unless specified).
Currency: GBP (£). Court hierarchy: Supreme Court → Court of Appeal → High Court → Crown/County Courts.
Key Acts: Contracts Act 1999, Companies Act 2006, Employment Rights Act 1996, GDPR/UK GDPR/DPA 2018,
Equality Act 2010, Consumer Rights Act 2015, Misrepresentation Act 1967.
Citation format: OSCOLA. Use neutral citation where available.`,
  US: `JURISDICTION: United States (specify state if applicable).
Currency: USD ($). Court system: SCOTUS → Circuit Courts → District Courts → State courts.
Key law: Federal Constitution, UCC, ERISA, Sherman Act, FCRA, CCPA (CA), ADA, FLSA.
Citation: Bluebook format. Check for circuit splits. Cite most recent controlling authority.`,
  EU: `JURISDICTION: European Union.
Currency: EUR (€). Court: CJEU → national courts.
Key regulations: GDPR, AI Act 2024, Digital Markets Act, Digital Services Act, CSRD, ePrivacy Directive.
Data: GDPR — controller/processor distinction, lawful basis, data subject rights, DPIAs.
AI Act: High-risk AI systems under Article 6; conformity assessment; prohibited AI practices.`,
  GC: `JURISDICTION: Gulf Cooperation Council (specify country: UAE, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman).
Currency: AED/SAR/QAR/KWD/BHD/OMR. Use civil-law tradition with Sharia overlays.
Cite federal + emirate/kingdom-level laws explicitly.`,
  GCC: `JURISDICTION: Gulf Cooperation Council (specify country: UAE, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman).
Currency: AED/SAR/QAR (specify). Dual legal system: civil law + Sharia principles.
UAE: Federal laws + DIFC/ADGM common law. KSA: Vision 2030 reforms, VAT 2018, Labour Reform Initiative.
Contracts: must consider riba prohibition, halal compliance, mandatory dispute resolution clauses.`,
  SG: `JURISDICTION: Singapore.
Currency: SGD (S$). Court hierarchy: Court of Appeal → Appellate Division → High Court → State Courts.
Key Acts: Companies Act (Cap. 50), Employment Act, PDPA 2012 (amended 2021), Contract Act.
Key: Singapore follows English common law principles. Strong IP protection, international arbitration hub (SIAC).`,
  GLOBAL: '',
};

const TEMPLATE_MODE_INJECTIONS: Record<TemplateMode, string> = {
  STRICT: `TEMPLATE MODE: STRICT. Do NOT restructure, reorder, rename, or remove any section. Only fill designated fields.`,
  GUIDED: `TEMPLATE MODE: GUIDED. You may suggest structural alternatives but mark each as [SUGGESTED CHANGE: reason].`,
  MENTOR: `TEMPLATE MODE: MENTOR. Explain structural improvements as [MENTOR NOTE: ...] but do NOT apply them.`,
};

function buildSystemPrompt(input: OrchestrationInput, jurisdiction: JurisdictionCode): string {
  let sp = input.systemPrompt ?? '';
  const injection = JURISDICTION_INJECTIONS[jurisdiction];
  // NV-TOKEN-BUDGET-001 — the jurisdiction block is ~134 tokens of statute
  // mapping that the caller's system prompt has usually ALREADY stated (the
  // legal-intelligence overlay names BNS/BNSS/BSA and the court hierarchy in its
  // first ten lines). Restating it verbatim taught the model nothing and cost
  // tokens on every request, so it is appended only when the assembled prompt
  // does not already carry that grounding. This is redundancy removal, not a
  // reduction in grounding: when the caller says nothing, the full block is
  // still injected exactly as before.
  if (injection && !hasJurisdictionGrounding(sp, jurisdiction)) {
    sp += `\n\n${injection}`;
  }
  if (!/PLATFORM REFERENCE DATE/i.test(sp)) {
    sp += `\n\n${buildPlatformTemporalContextBlock()}`;
  }
  if (input.templateMode) sp += `\n\n${TEMPLATE_MODE_INJECTIONS[input.templateMode]}`;
  if (input.expectJson) sp += `\n\nRESPONSE FORMAT: Respond ONLY with valid JSON. No markdown, no prose outside JSON.`;
  if (input.jsonSchema) sp += `\n\nJSON SCHEMA: ${input.jsonSchema}`;
  return sp;
}

/**
 * Cheap, conservative probe for jurisdiction grounding already present upstream.
 * Deliberately requires TWO independent signals (the statute set AND the forum
 * vocabulary) before suppressing the injection — a false positive would drop
 * real grounding, which is the one outcome we must not risk for tokens.
 */
function hasJurisdictionGrounding(systemPrompt: string, jurisdiction: JurisdictionCode): boolean {
  const sp = String(systemPrompt || '');
  if (sp.length < 200) return false;
  switch (jurisdiction) {
    case 'IN':
      return /\bBNSS?\b/.test(sp) && /\bBSA\b|Bharatiya|High Court|Sessions/i.test(sp);
    case 'UK':
      return /OSCOLA|Companies Act 2006|Employment Rights Act/i.test(sp)
        && /England|Wales|Court of Appeal|Crown Court/i.test(sp);
    case 'US':
      return /Bluebook|SCOTUS|UCC\b/i.test(sp) && /Circuit|District Court/i.test(sp);
    case 'EU':
      return /GDPR/i.test(sp) && /CJEU|AI Act|Digital (Markets|Services) Act/i.test(sp);
    case 'SG':
      return /PDPA/i.test(sp) && /SIAC|State Courts|Court of Appeal/i.test(sp);
    case 'GC':
    case 'GCC':
      return /Sharia/i.test(sp) && /DIFC|ADGM|UAE|KSA|Saudi/i.test(sp);
    case 'GLOBAL':
      return true;
    default: {
      // Exhaustiveness: a new JurisdictionCode must be handled explicitly rather
      // than silently losing (or silently duplicating) its grounding block.
      const _exhaustive: never = jurisdiction;
      void _exhaustive;
      return false;
    }
  }
}

/**
 * NV-LLM-DUP-SYSTEM-001 — build the provider message array exactly once.
 *
 * Defect: `messagesForOpenAIStyle` unconditionally prepended
 * `{ role: 'system', content: systemPrompt }` to `input.messages`. Callers on
 * the live specialist path (`jrx-client.ts`) already build `messages` with the
 * system prompt as element 0, so OpenAI-style providers received the SAME system
 * prompt twice — once from the prepend and once from the caller's array.
 *
 * Honest impact: the providers that actually win today (Google, Bedrock) filter
 * or relocate the system turn — `callGoogle` and `bedrock-request-builder` both
 * drop `role: 'system'` entries from the contents/messages array and pass the
 * prompt through `systemInstruction` / `system` instead — so the duplicate was
 * NOT being billed on the winning path and the token saving today is ~0. It was
 * still a real defect: OpenAI, OpenRouter, Sarvam and any OpenAI-compatible
 * bridge pass the array through verbatim, so the moment routing shifts to one of
 * them (a Gemini quota event is enough) the system prompt — the single largest
 * component of the prompt — would have been paid for twice.
 */
function buildProviderMessages(
  input: OrchestrationInput,
  systemPrompt: string,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const supplied = input.messages;
  if (!supplied || supplied.length === 0) {
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input.userMessage },
    ];
  }
  // Drop caller-supplied system turns: `systemPrompt` is the enriched superset
  // (caller prompt + jurisdiction + template mode + JSON contract), so keeping
  // both would send the same instructions twice.
  const nonSystem = supplied.filter((m) => m.role !== 'system');
  return [{ role: 'system', content: systemPrompt }, ...nonSystem];
}

interface ProviderCallResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  finishReason: string;
  /** Prompt-cache read tokens (Anthropic/Bedrock); billed separately from tokensIn. */
  tokensCacheRead?: number;
  /** Prompt-cache write tokens (Anthropic/Bedrock). */
  tokensCacheWrite?: number;
  /** Optional actual cost returned by the provider (e.g., OmniRoute). */
  costUsd?: number;
  /** Optional upstream model actually invoked by a gateway provider. */
  upstreamModel?: string;
}

function billableInputTokens(r: Pick<ProviderCallResult, 'tokensIn' | 'tokensCacheRead' | 'tokensCacheWrite'>): number {
  return r.tokensIn + (r.tokensCacheRead ?? 0) + (r.tokensCacheWrite ?? 0);
}

async function callAnthropicDirect(
  modelId: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
  callerSignal?: AbortSignal
): Promise<ProviderCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const userMessages = messages.filter((m) => m.role !== 'system');
  /* NV-PROMPT-CACHE-001 — same stable-prefix caching as the Bedrock path
   * (bedrock-request-builder.ts). Reads bill at 0.1x, writes at 1.25x, so the floor
   * exists to avoid paying the write premium below the provider's ~1,024-token minimum
   * where no cache entry is created. Unrecognised fields are ignored by the API, so the
   * worst case is no saving rather than a failed call. */
  const cacheEnabled = String(process.env.JRX_PROMPT_CACHE ?? '1') !== '0';
  const minChars = Number(process.env.JRX_PROMPT_CACHE_MIN_CHARS || 4000);
  const useCache = cacheEnabled && !!systemPrompt && systemPrompt.length >= minChars;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxTokens,
      system: useCache
        ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
        : systemPrompt,
      messages: userMessages,
      temperature,
    }),
    signal: attemptSignal(LLM_PROVIDER_TIMEOUT_MS, callerSignal),
  });
  if (res.ok === false) {
    const txt = await res.text();
    throw new Error(`Anthropic ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    stop_reason?: string;
  };
  const text = (json.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');
  const tokensCacheRead = json.usage?.cache_read_input_tokens ?? 0;
  const tokensCacheWrite = json.usage?.cache_creation_input_tokens ?? 0;
  return {
    content: text,
    tokensIn: json.usage?.input_tokens ?? 0,
    tokensOut: json.usage?.output_tokens ?? 0,
    tokensCacheRead: tokensCacheRead || undefined,
    tokensCacheWrite: tokensCacheWrite || undefined,
    finishReason: json.stop_reason ?? 'end_turn',
  };
}

async function callOpenAIDirect(
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
  expectJson: boolean,
  callerSignal?: AbortSignal
): Promise<ProviderCallResult> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (expectJson) body.response_format = { type: 'json_object' };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: attemptSignal(LLM_PROVIDER_TIMEOUT_MS, callerSignal),
  });
  if (res.ok === false) {
    const txt = await res.text();
    throw new Error(`OpenAI ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string }; finish_reason: string }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  return {
    content: json.choices?.[0]?.message?.content ?? '',
    tokensIn: json.usage?.prompt_tokens ?? 0,
    tokensOut: json.usage?.completion_tokens ?? 0,
    finishReason: json.choices?.[0]?.finish_reason ?? 'stop',
  };
}

async function callGoogle(
  modelId: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
  callerSignal?: AbortSignal
): Promise<ProviderCallResult> {
  const keys = resolveGeminiApiKeys();
  if (!keys.length) throw new Error('GOOGLE_API_KEY / GEMINI_API_KEY / GEMINI_API_KEYS not set');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  };
  if (systemPrompt) body.systemInstruction = { role: 'system', parts: [{ text: systemPrompt }] };

  const apiModelId = toGeminiApiModelId(modelId);

  let lastErr: Error | null = null;
  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      apiModelId
    )}:generateContent?key=${apiKey}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: attemptSignal(LLM_PROVIDER_TIMEOUT_MS, callerSignal),
      });
      if (res.ok === false) {
        const txt = await res.text();
        const err = new Error(`Google ${res.status}: ${txt.slice(0, 200)}`);
        lastErr = err;
        if (i < keys.length - 1 && isGeminiKeyRetryable(`${res.status} ${txt}`)) {
          logger.warn('llm-orchestrator: Gemini key failed — rotating pool', {
            keyIndex: i,
            status: res.status,
          });
          continue;
        }
        throw err;
      }
      const json = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          /*
           * NV-GEMINI-CACHE-001 (2026-08-18) — observe Gemini's implicit context cache.
           *
           * Anthropic caching is explicit (`cache_control: ephemeral`), which is why that
           * work was a code change. Gemini 2.5+/3.x caches a repeated prompt PREFIX
           * automatically on `generateContent` — no request field to set — and reports the
           * hit as `cachedContentTokenCount`. Cached prefix tokens bill at a fraction of
           * the normal input rate.
           *
           * We were therefore already eligible for the saving and simply could not see it,
           * so the flash rail's true cost has been over-reported and no one could tell
           * whether the platform's stable prefix (overlay + registry) was being reused.
           * Capturing it makes the saving measurable, which is the prerequisite for
           * claiming it — the cost benchmark reads these counts.
           *
           * NOTE: the biggest lever for a cache HIT is prefix STABILITY. Anything that
           * varies early in the system prompt (a timestamp, a request id, a shuffled
           * section) defeats it for the whole call. That is a separate audit, recorded
           * rather than guessed at here.
           */
          cachedContentTokenCount?: number;
        };
      };
      const text = (json.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join('');
      /*
       * NV-GEMINI-CACHE-001 — surface the implicit cache hit.
       *
       * `promptTokenCount` already INCLUDES cached tokens, so we must not add them to
       * `tokensIn` (that would double-count and inflate the very cost figure this is meant
       * to make honest). Logged instead, at info, so the benchmark's provider-log parser and
       * a human reading the log can both see how much of the prefix was reused.
       */
      const cachedTok = json.usageMetadata?.cachedContentTokenCount ?? 0;
      if (cachedTok > 0) {
        const promptTok = json.usageMetadata?.promptTokenCount ?? 0;
        logger.info('llm-orchestrator: gemini implicit cache hit', {
          model: apiModelId,
          cachedTokens: cachedTok,
          promptTokens: promptTok,
          cachedPct: promptTok > 0 ? Math.round((cachedTok / promptTok) * 100) : 0,
        });
      }
      return {
        content: text,
        tokensIn: json.usageMetadata?.promptTokenCount ?? 0,
        tokensOut: json.usageMetadata?.candidatesTokenCount ?? 0,
        finishReason: json.candidates?.[0]?.finishReason ?? 'STOP',
      };
    } catch (e: any) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (i < keys.length - 1 && isGeminiKeyRetryable(lastErr.message)) {
        logger.warn('llm-orchestrator: Gemini key exception — rotating pool', {
          keyIndex: i,
          err: lastErr.message.slice(0, 120),
        });
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr ?? new Error('Google: all Gemini keys exhausted');
}

async function callOpenRouter(
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
  expectJson: boolean
): Promise<ProviderCallResult> {
  const apiKey =
    process.env.OPENROUTER_API_KEY ?? process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (expectJson) body.response_format = { type: 'json_object' };
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://jurexio.com',
      'X-Title': 'Jurexio Enterprise Platform 3.1.2',
    },
    body: JSON.stringify(body),
    signal: attemptSignal(LLM_PROVIDER_TIMEOUT_MS),
  });
  if (res.ok === false) {
    const txt = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string }; finish_reason: string }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  return {
    content: json.choices?.[0]?.message?.content ?? '',
    tokensIn: json.usage?.prompt_tokens ?? 0,
    tokensOut: json.usage?.completion_tokens ?? 0,
    finishReason: json.choices?.[0]?.finish_reason ?? 'stop',
  };
}

async function callSarvam(
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
  expectJson: boolean
): Promise<ProviderCallResult> {
  const apiKey = process.env.SARVAM_API_KEY ?? process.env.JRX_SARVAM_API_KEY;
  if (!apiKey) throw new Error('SARVAM_API_KEY not set');
  const baseUrl = process.env.JRX_SARVAM_BASE_URL ?? 'https://api.sarvam.ai';
  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (expectJson) body.response_format = { type: 'json_object' };
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Sarvam-M chat-completions endpoint accepts both styles. We send
      // both so it works regardless of the account's auth mode.
      Authorization: `Bearer ${apiKey}`,
      'API-Subscription-Key': apiKey,
    },
    body: JSON.stringify(body),
    signal: attemptSignal(LLM_PROVIDER_TIMEOUT_MS),
  });
  if (res.ok === false) {
    const txt = await res.text();
    throw new Error(`Sarvam ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    content: json.choices?.[0]?.message?.content ?? '',
    tokensIn: json.usage?.prompt_tokens ?? 0,
    tokensOut: json.usage?.completion_tokens ?? 0,
    finishReason: json.choices?.[0]?.finish_reason ?? 'stop',
  };
}

/**
 * NV-BEDROCK-NO-GLOBAL-ENV-001 — per-client Bedrock credentials.
 *
 * Prefer Bedrock API keys with us-east-1 primary (widest Marketplace model set)
 * → ap-south-1 failover for India residency; fall back to IAM/instance role when
 * bearer tokens are unset. Env is READ here, never written.
 */
function bedrockRegionAttempts(realModelId: string): Array<{ region: string; token?: string }> {
  const usEastToken =
    process.env.AWS_BEARER_TOKEN_BEDROCK_US_EAST_1
    || process.env.BEDROCK_API_KEY_US_EAST_1
    || process.env.AWS_BEARER_TOKEN_BEDROCK
    || process.env.BEDROCK_API_KEY
    || '';
  const apSouthToken =
    process.env.AWS_BEARER_TOKEN_BEDROCK_AP_SOUTH_1
    || process.env.BEDROCK_API_KEY_AP_SOUTH_1
    || process.env.AWS_BEARER_TOKEN_BEDROCK
    || process.env.BEDROCK_API_KEY
    || '';
  const tokenFor = (region: string) =>
    region === 'us-east-1' ? (usEastToken || undefined) : (apSouthToken || usEastToken || undefined);
  const attempts: Array<{ region: string; token?: string }> = [];
  const seenRegion = new Set<string>();
  const usOrGlobal = /^(us|global)\./i.test(realModelId);
  for (const region of getBedrockRegionOrder()) {
    if (usOrGlobal && region !== 'us-east-1' && !realModelId.startsWith('apac.')) continue;
    if (seenRegion.has(region)) continue;
    seenRegion.add(region);
    attempts.push({ region, token: tokenFor(region) });
  }
  return attempts;
}

/**
 * Build per-client config so a bearer token never leaves the client that uses it.
 *
 * The previous implementation assigned `process.env.AWS_BEARER_TOKEN_BEDROCK`
 * before constructing the client and restored it in `finally`. Under concurrency
 * — and this cascade hedges by design — two in-flight requests interleaved their
 * assignment and restore, so a request could sign with another region's token or
 * with a token that had already been deleted. `token` + `authSchemePreference`
 * are the SDK's per-client equivalent of that env var
 * (`smithy.api#httpBearerAuth` ← `config.token`).
 */
function bedrockClientConfig(region: string, token?: string): Record<string, unknown> {
  if (!token) return { region };
  return {
    region,
    token: { token },
    authSchemePreference: ['httpBearerAuth'],
  };
}

async function callBedrock(
  modelId: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
  callerSignal?: AbortSignal
): Promise<ProviderCallResult> {
  let BedrockRuntimeClient: any, InvokeModelCommand: any;
  try {
    const mod: any = await import('@aws-sdk/client-bedrock-runtime');
    BedrockRuntimeClient = mod.BedrockRuntimeClient;
    InvokeModelCommand = mod.InvokeModelCommand;
  } catch {
    throw new Error('Bedrock SDK not installed (@aws-sdk/client-bedrock-runtime)');
  }
  const { buildBedrockRequest, stripBedrockModelId } = await import('./bedrock-request-builder.js');
  const { realModelId } = stripBedrockModelId(modelId);
  const built = buildBedrockRequest(modelId, systemPrompt, messages, maxTokens, temperature);
  const attempts = bedrockRegionAttempts(realModelId);

  let lastErr: Error | null = null;
  for (const attempt of attempts) {
    try {
      const client = new BedrockRuntimeClient(bedrockClientConfig(attempt.region, attempt.token));
      const cmd = new InvokeModelCommand({
        modelId: realModelId,
        body: JSON.stringify(built.body),
        contentType: 'application/json',
        accept: 'application/json',
      });
      const out = await client.send(cmd, {
        abortSignal: attemptSignal(LLM_PROVIDER_TIMEOUT_MS, callerSignal),
      });
      const decoded = new TextDecoder().decode(out.body as Uint8Array);
      const parsed = JSON.parse(decoded) as Record<string, unknown>;
      const result = built.parseResponse(parsed);
      return {
        content: result.content,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        finishReason: result.finishReason,
      };
    } catch (e: any) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      logger.warn('[Bedrock] attempt failed', {
        region: attempt.region,
        model: realModelId,
        error: String(lastErr.message || lastErr).slice(0, 160),
      });
    }
  }
  throw lastErr || new Error('Bedrock invoke failed');
}

let _vertexAccessTokenCache: { token: string; expires: number } | null = null;
async function vertexAccessToken(): Promise<string> {
  if (_vertexAccessTokenCache && _vertexAccessTokenCache.expires > Date.now() + 60_000) {
    return _vertexAccessTokenCache.token;
  }
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    // GOOGLE_APPLICATION_CREDENTIALS = path to service-account JSON, OR
    // GCP_SA_KEY_JSON = inline JSON string (we accept both for portability).
    credentials: process.env.GCP_SA_KEY_JSON
      ? JSON.parse(process.env.GCP_SA_KEY_JSON)
      : undefined,
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse.token;
  if (!token) throw new Error('Vertex: failed to acquire access token');
  _vertexAccessTokenCache = { token, expires: Date.now() + 50 * 60_000 };
  return token;
}

async function callVertex(
  modelId: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number
): Promise<ProviderCallResult> {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error('GCP_PROJECT_ID not set');
  const region = process.env.GCP_VERTEX_REGION ?? 'asia-south1';
  const realModelId = modelId.replace(/-vertex$/, '');
  const token = await vertexAccessToken();
  const url =
    `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}` +
    `/publishers/google/models/${encodeURIComponent(realModelId)}:generateContent`;
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  };
  if (systemPrompt) body.systemInstruction = { role: 'system', parts: [{ text: systemPrompt }] };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: attemptSignal(LLM_PROVIDER_TIMEOUT_MS),
  });
  if (res.ok === false) {
    const txt = await res.text();
    throw new Error(`Vertex ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as any;
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p: any) => p.text ?? '')
    .join('');
  return {
    content: text,
    tokensIn: json.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: json.usageMetadata?.candidatesTokenCount ?? 0,
    finishReason: json.candidates?.[0]?.finishReason ?? 'STOP',
  };
}

async function callAgentZero(
  systemPrompt: string,
  userMessage: string
): Promise<ProviderCallResult> {
  const reply =
    `[AGENTZERO SOVEREIGN FALLBACK]\n\n` +
    `All upstream LLM providers failed or are unavailable. AgentZero is operating as a deterministic ` +
    `local responder so the platform never breaks mid-execution.\n\n` +
    `Acknowledged request: "${userMessage.slice(0, 240)}${userMessage.length > 240 ? '…' : ''}"\n\n` +
    `Recommendation: retry shortly, or escalate to a human reviewer. Routing context preserved.`;
  return {
    content: reply,
    tokensIn: Math.ceil((systemPrompt.length + userMessage.length) / 4),
    tokensOut: Math.ceil(reply.length / 4),
    finishReason: 'agentzero_fallback',
  };
}

async function callPerplexityDirect(
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
): Promise<ProviderCallResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error('PERPLEXITY_API_KEY not set');
  const model = modelId.startsWith('sonar') ? modelId : 'sonar-pro';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), currentAttemptTimeoutMs(LLM_PROVIDER_TIMEOUT_MS));
  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
      signal: controller.signal,
    });
    if (response.ok === false) {
      const body = await response.text().catch(() => '');
      throw new Error(`Perplexity ${response.status}: ${body.slice(0, 300)}`);
    }
    const data: any = await response.json();
    const content = String(data?.choices?.[0]?.message?.content ?? '');
    return {
      content,
      tokensIn: Number(data?.usage?.prompt_tokens ?? 0),
      tokensOut: Number(data?.usage?.completion_tokens ?? 0),
      finishReason: String(data?.choices?.[0]?.finish_reason ?? 'stop'),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Map direct-provider catalog ids onto OpenRouter when native callModel is missing. */
function openRouterBridgeId(model: ModelEntry): string {
  if (model.id.includes('/')) return model.id;
  if (model.provider === 'perplexity') {
    if (model.id.includes('reasoning')) return 'perplexity/sonar-reasoning-pro';
    return 'perplexity/sonar-pro';
  }
  if (model.provider === 'deepseek') return `deepseek/${model.id}`;
  if (model.provider === 'mistral') return `mistralai/${model.id}`;
  if (model.provider === 'xai') return `x-ai/${model.id}`;
  if (model.provider === 'groq') return `groq/${model.id}`;
  if (model.provider === 'cohere') return `cohere/${model.id}`;
  return `${model.provider}/${model.id}`;
}

async function callModel(
  model: ModelEntry,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  userMessage: string,
  maxTokens: number,
  temperature: number,
  expectJson: boolean,
  routing?: RouterRequest,
  requestId?: string,
  /**
   * NV-LLM-HEDGE-CANCEL-001 — abort this provider call when the caller no longer
   * needs the result (losing hedge branch). Providers that support it stop
   * generating, which is the difference between paying for one completion and
   * paying for two.
   */
  callerSignal?: AbortSignal
): Promise<ProviderCallResult> {
  maxTokens = effectiveMaxTokensForModel(model, maxTokens);
  switch (model.provider) {
    case 'anthropic':
      return callAnthropicDirect(model.id, systemPrompt, messages, maxTokens, temperature, callerSignal);
    case 'openai':
      return callOpenAIDirect(model.id, messages, maxTokens, temperature, expectJson, callerSignal);
    case 'google':
      return callGoogle(model.id, systemPrompt, messages, maxTokens, temperature, callerSignal);
    case 'openrouter':
      return callOpenRouter(model.id, messages, maxTokens, temperature, expectJson);
    case 'sarvam':
      return callSarvam(model.id, messages, maxTokens, temperature, expectJson);
    case 'bedrock':
      return callBedrock(model.id, systemPrompt, messages, maxTokens, temperature, callerSignal);
    case 'vertex':
      return callVertex(model.id, systemPrompt, messages, maxTokens, temperature);
    case 'perplexity': {
      if (process.env.PERPLEXITY_API_KEY) {
        return callPerplexityDirect(model.id, messages, maxTokens, temperature);
      }
      // Prefer OpenRouter Perplexity when direct key missing (still web-grounded).
      if (isProviderAvailable('openrouter')) {
        return callOpenRouter(openRouterBridgeId(model), messages, maxTokens, temperature, expectJson);
      }
      throw new Error('Perplexity unavailable — set PERPLEXITY_API_KEY or OPENROUTER_API_KEY');
    }
    case 'omniroute': {
      if (
        !isOmniRouteAllowedForRequest({
          taskKind: routing?.taskKind,
          agentId: routing?.agentId,
          tenantId: routing?.organizationId,
          sensitivity: routing?.sensitivity as 'low' | 'medium' | 'high' | 'critical' | undefined,
        })
      ) {
        throw new Error('OmniRoute skipped by governance policy (key missing, disabled, or sensitivity/policy)');
      }
      const omni = await callOmniRoute({
        modelId: model.id,
        systemPrompt,
        messages,
        userMessage,
        maxTokens,
        temperature,
        expectJson,
        timeoutMs: Math.min(
          LLM_PROVIDER_TIMEOUT_MS,
          Math.max(5_000, Number(process.env.JRX_OMNIROUTE_TIMEOUT_MS) || 12_000),
        ),
        budgetUsd: routing?.maxCostUsd,
        platformTag: routing?.app || requestId,
      });
      return {
        content: omni.content,
        tokensIn: omni.tokensIn,
        tokensOut: omni.tokensOut,
        finishReason: omni.finishReason,
        costUsd: omni.costUsd,
        upstreamModel: omni.upstreamModel,
      };
    }
    case 'agentzero':
      return callAgentZero(systemPrompt, userMessage);
    case 'simulation':
      return callAgentZero(systemPrompt, userMessage);
    default: {
      // Bridge DeepSeek / Mistral / Groq / xAI / Cohere via OpenRouter when
      // native SDK path is not implemented — keeps cascade from dead-ending.
      if (isProviderAvailable('openrouter')) {
        return callOpenRouter(openRouterBridgeId(model), messages, maxTokens, temperature, expectJson);
      }
      throw new Error(`Provider ${model.provider} not implemented in orchestrator`);
    }
  }
}

function estimateCostUsd(model: ModelEntry, tokensIn: number, tokensOut: number): number {
  return (tokensIn * model.costInPer1M + tokensOut * model.costOutPer1M) / 1_000_000;
}

/**
 * NV-LLM-DEADLINE-001 — map the request to a per-attempt latency tier.
 *
 * A classification / one-line FAQ has no business holding a provider connection
 * for 45s; a drafting request legitimately needs minutes. Explicit caller
 * signals (`requireReasoning`, a large `expectedOutputTokens`) always win over
 * the taskKind heuristic so we never starve genuinely deep work.
 */
function resolveAttemptTier(input: OrchestrationInput): LlmAttemptTier {
  const routing = input.routing ?? ({} as RouterRequest);
  const task = String(routing.taskKind || '').toLowerCase();
  const outTokens = input.maxTokens ?? routing.expectedOutputTokens ?? 0;

  if (/legal[_-]?chat[_-]fast|legal[_-]?draft[_-]fast|doc[_-]?draft[_-]fast/.test(task)) {
    return outTokens <= 1_200 ? 'fast' : 'standard';
  }
  if (routing.requireReasoning || /drafting|litigation|chain_of_thought|research/.test(task)) {
    return 'deep';
  }
  if (outTokens >= 4_000) return 'deep';
  if (/classification|extraction|json_structured|summarization/.test(task) && outTokens <= 1_200) {
    return 'micro';
  }
  if (outTokens > 0 && outTokens <= 1_000) return 'fast';
  return 'standard';
}

/**
 * NV-LLM-DEADLINE-002 — deep counsel-grade cascades need a master budget large
 * enough for at least two full Bedrock attempts. Measured on jrx-staging (2026-08-21):
 * llmMasterMs=90s with a 58-rung ladder starved late rungs to the 3s floor and
 * every provider failed → AgentZero 1045-char stub returned as HTTP 200.
 */
function resolveMasterDeadlineMs(input: OrchestrationInput, attemptTier: LlmAttemptTier): number {
  const configured = input.deadlineMs ?? NV_TIMEOUTS.llmMasterMs;
  const rawTask = String(input.routing?.taskKind || '').toLowerCase();
  const slaFastLegal = /legal[_-]?chat[_-]fast|legal[_-]?draft[_-]fast|doc[_-]?draft[_-]fast/.test(rawTask);
  const needsExtended =
    !slaFastLegal
    && (attemptTier === 'deep'
    || isPartnerLegalQualityTask(input.routing?.taskKind)
    || (input.maxTokens ?? 0) >= 4_000);
  if (!needsExtended) return configured;
  const envPartner = Number(process.env.JRX_LLM_PARTNER_DRAFT_TIMEOUT_MS);
  const partnerFloor = Number.isFinite(envPartner) && envPartner >= 60_000 ? envPartner : 0;
  const deepFloor = Math.max(NV_TASK_TIER_TIMEOUTS.deep * 2, partnerFloor);
  return Math.max(configured, deepFloor);
}

/** Clamp requested max_tokens to what the provider/model can actually accept. */
function effectiveMaxTokensForModel(model: ModelEntry, requested: number): number {
  let cap = model.maxOutput > 0 ? model.maxOutput : requested;
  if (model.provider === 'sarvam') {
    const sarvamCap = Number(process.env.JRX_SARVAM_MAX_OUTPUT_TOKENS);
    cap = Number.isFinite(sarvamCap) && sarvamCap > 0 ? sarvamCap : 4_096;
  }
  return Math.max(1, Math.min(requested, cap));
}

/**
 * Skip a rung whose measured p50 already exceeds what the request has left.
 *
 * The point of a fallback is to be FASTER than the rung that just failed (plan
 * §8.4a ladder-ordering rule). Opening a call we know statistically cannot
 * finish inside the deadline guarantees a timeout AND a bill, so we degrade to a
 * faster tier instead. Models with too few samples are never skipped —
 * unmeasured is not the same as slow.
 */
function shouldSkipForDeadline(
  model: ModelEntry,
  remainingMs: number | undefined,
): { skip: boolean; p50?: number } {
  if (remainingMs == null) return { skip: false };
  if (model.provider === 'agentzero' || model.provider === 'simulation') return { skip: false };
  const p50 = getModelP50Ms(model.id);
  if (p50 == null) return { skip: false };
  // 1.15× headroom: p50 means half the calls are slower, so requiring only
  // exactly p50 of remaining time would still time out about half the time.
  return { skip: p50 * 1.15 > remainingMs, p50 };
}

export async function orchestrateLLM(input: OrchestrationInput): Promise<OrchestrationOutput> {
  const start = Date.now();
  const decision = pickSequence(input.routing);
  const jurisdiction = decision.inputs.jurisdiction;
  const systemPrompt = buildSystemPrompt(input, jurisdiction);

  const messagesForOpenAIStyle = buildProviderMessages(input, systemPrompt);

  const maxTokens = input.maxTokens ?? 4096;
  const temperature = input.temperature ?? 0.3;
  const expectJson = !!input.expectJson;

  // NV-LLM-DEADLINE-001 — record the deadline ONCE, exactly as
  // NV-QUEEN-DEADLINE-001 does for Queen nodes, then derive every attempt's
  // budget from what is actually left. Without a caller-supplied deadline we
  // still bound the cascade by the master LLM budget, so a five-rung ladder can
  // no longer spend `rungs × per-attempt-timeout`.
  const attemptTier = resolveAttemptTier(input);
  const deadline: RequestDeadline = input.deadlineAt != null
    ? { deadlineAt: input.deadlineAt }
    : startRequestDeadline(resolveMasterDeadlineMs(input, attemptTier), start);

  const attempts: OrchestrationOutput['attempts'] = [];
  let fallbackLevel = -1;

  // One batched read of shared breaker state for the whole ladder, rather than a
  // Redis round trip per rung per request.
  const gates = await loadProviderGates(decision.sequence.map((m) => m.provider));

  const eligible: ModelEntry[] = [];
  for (const m of decision.sequence) {
    const gate = await isProviderAllowed(m.provider, gates);
    if (gate.allowed) eligible.push(m);
  }

  /**
   * Run one provider attempt inside the attempt-budget scope, retrying the SAME
   * rung with jittered backoff only for retryable classes (NV-LLM-RETRY-001).
   * A 4xx / auth / content-filter / payment failure fails over immediately.
   */
  const runAttempt = async (
    model: ModelEntry,
    callerSignal?: AbortSignal,
  ): Promise<{ result: Awaited<ReturnType<typeof callModel>>; retries: number }> => {
    let retries = 0;
    for (;;) {
      const remaining = timeRemainingMs(deadline);
      const budget = attemptBudgetMs(attemptTier, remaining);
      try {
        const result = await attemptBudgetStore.run({ timeoutMs: budget }, () =>
          callModel(
            model,
            systemPrompt,
            messagesForOpenAIStyle,
            input.userMessage,
            maxTokens,
            temperature,
            expectJson,
            input.routing,
            input.requestId,
            callerSignal,
          ),
        );
        if (model.provider !== 'agentzero' && model.provider !== 'simulation') {
          if (!(result.content ?? '').trim()) {
            throw new Error(
              `model ${model.id} returned empty content ` +
              `(finishReason=${result.finishReason ?? 'n/a'}, tokensOut=${result.tokensOut ?? 0})`,
            );
          }
        }
        recordProviderSuccess(model.provider);
        return { result, retries };
      } catch (err) {
        const decisionRetry = classifyAndDecide(err, retries, timeRemainingMs(deadline));
        recordProviderFailure(model.provider, {
          message: err instanceof Error ? err.message : String(err),
          retryable: decisionRetry.retryable,
        });
        if (!decisionRetry.retryable) throw err;
        retries += 1;
        logger.warn('llm-orchestrator: retryable failure — backing off on same rung', {
          requestId: input.requestId,
          model: model.id,
          errorClass: decisionRetry.errorClass,
          attempt: retries,
          delayMs: decisionRetry.delayMs,
          maxRetries: MAX_RETRIES_PER_RUNG,
        });
        await sleepWithSignal(decisionRetry.delayMs, callerSignal);
        if (callerSignal?.aborted) throw err;
      }
    }
  };

  // NV-LLM-HEDGE-001: start primary immediately; after HEDGE_MS start secondary in parallel.
  // NV-OPUS-DRAFT-HEDGE-001 (2026-08-21): counsel-grade tasks must finish on Bedrock
  // Opus/Sonnet — hedging against Gemini after 2.5s caused "Request aborted" on the
  // primary and Gemini 3.7-flash winning every heavy draft/research path.
  const hedgeEligible =
    LLM_HEDGE_MS > 0
    && eligible.length >= 2
    && !isPartnerLegalQualityTask(decision.inputs.taskKind);
  if (hedgeEligible) {
    const primary = eligible[0]!;
    const secondary = eligible.find((m) => m.provider !== primary.provider) ?? eligible[1]!;
    const attemptStart = Date.now();
    // NV-LLM-HEDGE-CANCEL-001 — one controller per branch so that as soon as a
    // winner is known the loser's provider call is aborted instead of running to
    // completion and being billed for output nobody reads.
    const primaryAbort = new AbortController();
    const secondaryAbort = new AbortController();
    let secondaryStarted = false;
    let secondaryTimer: NodeJS.Timeout | undefined;
    try {
      const runOne = async (model: ModelEntry, signal: AbortSignal) => {
        const { result } = await runAttempt(model, signal);
        return { model, result };
      };
      const primaryP = runOne(primary, primaryAbort.signal).then(
        (ok) => ({ ok: true as const, ...ok }),
        (err) => ({ ok: false as const, model: primary, err }),
      );
      const secondaryP = new Promise<
        | { ok: true; model: ModelEntry; result: Awaited<ReturnType<typeof callModel>> }
        | { ok: false; model: ModelEntry; err: unknown }
      >((resolve) => {
        secondaryTimer = setTimeout(() => {
          // The primary may already have won during the hedge delay — starting a
          // second billable call at that point is pure waste.
          if (secondaryAbort.signal.aborted) {
            resolve({ ok: false, model: secondary, err: new Error('hedge secondary not needed') });
            return;
          }
          secondaryStarted = true;
          runOne(secondary, secondaryAbort.signal).then(
            (ok) => resolve({ ok: true, ...ok }),
            (err) => resolve({ ok: false, model: secondary, err }),
          );
        }, LLM_HEDGE_MS);
      });
      const winner = await Promise.race([
        primaryP.then(async (r) => {
          if (r.ok) return r;
          // Primary failed fast — await secondary (already scheduled or soon).
          return secondaryP;
        }),
        secondaryP.then(async (r) => {
          if (r.ok) return r;
          return primaryP;
        }),
      ]);
      if (winner.ok) {
        // Cancel the branch that did not win, and suppress a secondary that has
        // not started yet. This is the whole point of NV-LLM-HEDGE-CANCEL-001.
        const loserWasInFlight = winner.model.id === primary.id ? secondaryStarted : true;
        if (winner.model.id === primary.id) {
          if (secondaryTimer) clearTimeout(secondaryTimer);
          secondaryAbort.abort();
        } else {
          primaryAbort.abort();
        }
        if (loserWasInFlight) {
          logger.info('llm-orchestrator: hedge loser cancelled', {
            requestId: input.requestId,
            winner: winner.model.id,
            cancelled: winner.model.id === primary.id ? secondary.id : primary.id,
          });

          /* NV-METER-WASTE-001 (2026-08-16) — the loser was a real, billable
           * provider call. NV-LLM-HEDGE-CANCEL-001 stops it *generating*, but a
           * cancelled request is still charged for whatever it produced before the
           * abort landed (prefill always; some output usually). Until now nothing
           * recorded that at all: only `winner.result` reached recordLlmUsage, which
           * is precisely why a second paid call on every hedged request stayed
           * invisible long enough to be discovered by grepping provider logs.
           *
           * Deliberately fire-and-forget: the user's response must not wait on a
           * branch we just abandoned. It lands in the `wasted*` counters, so it is
           * never billed to the customer — the point is visibility, not revenue.
           * Consequence of not awaiting: if the loser settles after `res.finish`
           * this misses the envelope and the activity row. That is acceptable
           * (aborted calls normally reject within milliseconds) and is still
           * strictly better than the previous silence. */
          const loserP = winner.model.id === primary.id ? secondaryP : primaryP;
          const loserModel = winner.model.id === primary.id ? secondary : primary;
          void loserP
            .then((loser) => {
              if (loser.ok === false) return; // aborted before any usage was reported
              const wastedCost =
                loser.result.costUsd ??
                estimateCostUsd(
                  loserModel,
                  billableInputTokens(loser.result),
                  loser.result.tokensOut,
                );
              recordLlmUsage({
                tokensIn: loser.result.tokensIn,
                tokensOut: loser.result.tokensOut,
                tokensCacheRead: loser.result.tokensCacheRead,
                tokensCacheWrite: loser.result.tokensCacheWrite,
                costUsd: wastedCost,
                model: loserModel.id,
                provider: loserModel.provider,
                wasted: true,
              });
              logger.info('llm-orchestrator: hedge loser spend recorded as waste', {
                requestId: input.requestId,
                model: loserModel.id,
                tokensOut: loser.result.tokensOut,
                costUsd: wastedCost,
              });
            })
            .catch(() => { /* the loser rejecting is the expected, cheapest case */ });
        }
        const latencyMs = Date.now() - attemptStart;
        recordSuccess(winner.model.id, latencyMs);
        attempts.push({ modelId: winner.model.id, ok: true, latencyMs });
        const cost =
          winner.result.costUsd ??
          estimateCostUsd(winner.model, billableInputTokens(winner.result), winner.result.tokensOut);
        const hedgeLevel = winner.model.id === primary.id ? 0 : 1;
        const out: OrchestrationOutput = {
          content: winner.result.content,
          model: winner.model.id,
          provider: winner.model.provider,
          tokensIn: billableInputTokens(winner.result),
          tokensOut: winner.result.tokensOut,
          latencyMs: Date.now() - start,
          fallbackLevel: hedgeLevel,
          isSimulation:
            winner.model.provider === 'agentzero' || winner.model.provider === 'simulation',
          finishReason: winner.result.finishReason ?? 'stop',
          requestId: input.requestId,
          costUsd: cost,
          routerDecision: {
            primary: decision.primary.id,
            sequence: decision.sequence.map((m) => m.id),
            inputs: decision.inputs,
          },
          attempts,
        };
        recordLlmUsage({
          tokensIn: winner.result.tokensIn,
          tokensOut: winner.result.tokensOut,
          tokensCacheRead: winner.result.tokensCacheRead,
          tokensCacheWrite: winner.result.tokensCacheWrite,
          costUsd: cost,
          model: winner.model.id,
          provider: winner.model.provider,
          finishReason: winner.result.finishReason,
        });
        try {
          traceLLMCall(
            winner.model.provider,
            winner.model.id,
            winner.result.tokensIn,
            winner.result.tokensOut,
            out.latencyMs,
            cost,
            true,
          );
        } catch { /* tracing best-effort */ }
        recordDecision({
          ts: Date.now(),
          requestId: input.requestId,
          agentId: input.routing.agentId,
          tier: decision.inputs.tier,
          jurisdiction: decision.inputs.jurisdiction,
          taskKind: decision.inputs.taskKind,
          primaryModelId: decision.primary.id,
          pickedModelId: winner.model.id,
          pickedProvider: winner.model.provider,
          fallbackLevel: hedgeLevel,
          ok: true,
          latencyMs: out.latencyMs,
          costUsd: cost,
          tokensIn: winner.result.tokensIn,
          tokensOut: winner.result.tokensOut,
        });
        logger.info('llm-orchestrator: hedge success', {
          requestId: input.requestId,
          model: winner.model.id,
          provider: winner.model.provider,
          hedgeMs: LLM_HEDGE_MS,
          latencyMs: out.latencyMs,
        });
        return out;
      }
      attempts.push({
        modelId: primary.id,
        ok: false,
        latencyMs: Date.now() - attemptStart,
        error: String((winner as any).err?.message || (winner as any).err || 'hedge-miss'),
      });
    } catch (hedgeErr: any) {
      logger.warn('llm-orchestrator: hedge race failed — continuing sequential cascade', {
        err: hedgeErr?.message,
      });
    } finally {
      // NV-LLM-HEDGE-CANCEL-001 — never leave a pending hedge timer or an
      // in-flight branch alive once we leave the race: on the failure path the
      // sequential cascade below takes over, and an orphaned secondary would be
      // billed for a result no one awaits.
      if (secondaryTimer) clearTimeout(secondaryTimer);
      if (!secondaryAbort.signal.aborted) secondaryAbort.abort();
      if (!primaryAbort.signal.aborted) primaryAbort.abort();
    }
  }

  for (const model of decision.sequence) {
    fallbackLevel += 1;
    const gate = await isProviderAllowed(model.provider, gates);
    if (!gate.allowed) {
      attempts.push({
        modelId: model.id,
        ok: false,
        latencyMs: 0,
        error: `skipped:${gate.reason ?? `${model.provider}-gated`}`,
      });
      continue;
    }
    // Skip models already tried in a failed hedge (avoid double-bill on known empty).
    if (LLM_HEDGE_MS > 0 && attempts.some((a) => a.modelId === model.id && a.ok === false)) {
      continue;
    }
    // NV-LLM-DEADLINE-001 — degrade to a faster rung rather than starting a call
    // whose measured p50 already exceeds the time this request has left.
    const remaining = timeRemainingMs(deadline);
    const skip = shouldSkipForDeadline(model, remaining);
    if (skip.skip) {
      attempts.push({
        modelId: model.id,
        ok: false,
        latencyMs: 0,
        error: `skipped:p50-${skip.p50}ms-exceeds-remaining-${remaining}ms`,
      });
      logger.info('llm-orchestrator: rung skipped on deadline', {
        requestId: input.requestId,
        model: model.id,
        p50Ms: skip.p50,
        remainingMs: remaining,
      });
      continue;
    }
    const attemptStart = Date.now();
    try {
      const { result } = await runAttempt(model);
      // NV-LLM-EMPTY-001 (2026-06-26): a provider returning HTTP 200 with
      // empty / whitespace-only content is NOT a success — `runAttempt` raises
      // for that case so the cascade advances to the next provider. AgentZero /
      // simulation terminal fallbacks are exempt: their content is synthesised
      // in-process and non-empty by construction, and they are the last line of
      // defence we must never reject.
      // NV-ROUTER-001: when caller demands JSON, treat unparseable content
      // as a failure and cascade to the next candidate. Otherwise downstream
      // callers (Queen, GraphRAG) crash on malformed responses without ever
      // reaching AgentZero.
      if (expectJson && model.provider !== 'agentzero' && model.provider !== 'simulation') {
        const trimmed = (result.content ?? '').trim();
        let parseable = false;
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try { JSON.parse(trimmed); parseable = true; } catch {}
        }
        if (!parseable) {
          // Try to extract a JSON block from anywhere in the content.
          const m = trimmed.match(/[\{\[][\s\S]*[\}\]]/);
          if (m) {
            try { JSON.parse(m[0]); parseable = true; } catch {}
          }
        }
        if (!parseable) {
          throw new Error(`expected JSON but model ${model.id} returned non-JSON content`);
        }
      }
      const latencyMs = Date.now() - attemptStart;
      recordSuccess(model.id, latencyMs);
      attempts.push({ modelId: model.id, ok: true, latencyMs });

      const cost =
        result.costUsd ?? estimateCostUsd(model, billableInputTokens(result), result.tokensOut);
      const out: OrchestrationOutput = {
        content: result.content,
        model: model.id,
        provider: model.provider,
        tokensIn: billableInputTokens(result),
        tokensOut: result.tokensOut,
        latencyMs: Date.now() - start,
        fallbackLevel,
        isSimulation: model.provider === 'agentzero' || model.provider === 'simulation',
        finishReason: result.finishReason,
        requestId: input.requestId,
        costUsd: cost,
        routerDecision: {
          primary: decision.primary.id,
          sequence: decision.sequence.map((m) => m.id),
          inputs: decision.inputs,
        },
        attempts,
      };
      // NV-AUDIT-TOKENS-001 — accumulate real token/cost usage into the current
      // request's accumulator so the activity row carries non-zero totals.
      recordLlmUsage({
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        tokensCacheRead: result.tokensCacheRead,
        tokensCacheWrite: result.tokensCacheWrite,
        costUsd: cost,
        model: model.id,
        provider: model.provider,
        finishReason: result.finishReason,
      });
      // NV-OTEL-GENAI-001 — emit an OTel GenAI span for this LLM call. Fail-safe:
      // tracing/export must never affect the orchestration result.
      try {
        traceLLMCall(model.provider, model.id, result.tokensIn, result.tokensOut, out.latencyMs, cost, true);
      } catch { /* tracing is best-effort */ }
      recordDecision({
        ts: Date.now(),
        requestId: input.requestId,
        agentId: input.routing.agentId,
        tier: decision.inputs.tier,
        jurisdiction: decision.inputs.jurisdiction,
        taskKind: decision.inputs.taskKind,
        primaryModelId: decision.primary.id,
        pickedModelId: model.id,
        pickedProvider: model.provider,
        fallbackLevel,
        ok: true,
        latencyMs: out.latencyMs,
        costUsd: cost,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      });
      logger.info('llm-orchestrator: success', {
        requestId: input.requestId,
        agentId: input.routing.agentId,
        tier: decision.inputs.tier,
        jurisdiction: decision.inputs.jurisdiction,
        taskKind: decision.inputs.taskKind,
        model: model.id,
        provider: model.provider,
        fallbackLevel,
        latencyMs: out.latencyMs,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: cost,
      });
      return out;
    } catch (err: any) {
      const latencyMs = Date.now() - attemptStart;
      const message = (err as Error).message?.slice(0, 200) ?? String(err);
      recordFailure(model.id, message);
      attempts.push({ modelId: model.id, ok: false, latencyMs, error: message });
      logger.warn('llm-orchestrator: model failed, advancing fallback', {
        requestId: input.requestId,
        model: model.id,
        provider: model.provider,
        fallbackLevel,
        error: message,
      });
      // Gate state (quarantine / breaker-open) is recorded inside `runAttempt`
      // via the shared breaker, so both the sync and stream paths converge on
      // one mechanism instead of each keeping a private set.
      // Refresh this request's view so later rungs on the same provider are
      // skipped without another network call.
      const refreshed = await loadProviderGates([model.provider]);
      const g = refreshed.get(model.provider);
      if (g) gates.set(model.provider, g);
    }
  }

  // NV-NEVER-EMPTY-001: never hand partners an empty/degraded stub. Prefer
  // AgentZero if still in sequence; otherwise return a structured helpful reply.
  let terminalContent = '';
  try {
    const az = decision.sequence.find((m) => m.provider === 'agentzero');
    if (az) {
      const azResult = await callModel(
        az,
        systemPrompt,
        messagesForOpenAIStyle,
        input.userMessage,
        maxTokens,
        temperature,
        expectJson,
        input.routing,
        input.requestId
      );
      if ((azResult.content ?? '').trim()) {
        terminalContent = azResult.content;
        recordSuccess(az.id, 0);
        return {
          content: terminalContent,
          model: az.id,
          provider: 'agentzero',
          tokensIn: azResult.tokensIn,
          tokensOut: azResult.tokensOut,
          latencyMs: Date.now() - start,
          fallbackLevel: decision.sequence.length,
          isSimulation: true,
          finishReason: 'agentzero_fallback',
          requestId: input.requestId,
          costUsd: 0,
          routerDecision: {
            primary: decision.primary?.id ?? 'none',
            sequence: decision.sequence.map((m) => m.id),
            inputs: decision.inputs,
          },
          attempts,
        };
      }
    }
  } catch (azErr: any) {
    logger.warn('llm-orchestrator: agentzero terminal failed', { err: azErr?.message });
  }
  terminalContent = neverEmptyFallback(input.userMessage, input.requestId);

  const finalContent = terminalContent;
  recordDecision({
    ts: Date.now(),
    requestId: input.requestId,
    agentId: input.routing.agentId,
    tier: decision.inputs.tier,
    jurisdiction: decision.inputs.jurisdiction,
    taskKind: decision.inputs.taskKind,
    primaryModelId: decision.primary?.id ?? 'none',
    pickedModelId: 'none',
    pickedProvider: 'none',
    fallbackLevel: decision.sequence.length,
    ok: false,
    latencyMs: Date.now() - start,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    errorMessage: `all ${attempts.length} candidates failed: ${attempts.slice(-3).map((a) => `${a.modelId}(${a.error ?? 'ok'})`).join('; ')}`.slice(0, 1000),
  });
  logger.warn('llm-orchestrator: ALL paid providers failed — returning never-empty fallback', {
    requestId: input.requestId,
    attempts: attempts.slice(-5),
  });
  return {
    content: finalContent,
    model: 'jrx-never-empty-fallback',
    provider: 'simulation',
    tokensIn: 0,
    tokensOut: Math.ceil(finalContent.length / 4),
    latencyMs: Date.now() - start,
    fallbackLevel: decision.sequence.length,
    isSimulation: true,
    finishReason: 'never_empty_fallback',
    requestId: input.requestId,
    costUsd: 0,
    routerDecision: {
      primary: decision.primary?.id ?? 'none',
      sequence: decision.sequence.map((m) => m.id),
      inputs: decision.inputs,
    },
    attempts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// True provider-side streaming
// ─────────────────────────────────────────────────────────────────────────────

async function* sseLines(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf.trim();
}

/**
 * NV-METER-STREAM-USAGE-001 (2026-08-16) — out-of-band channel for real provider
 * token counts on the streaming path.
 *
 * `streamFromModel` and its per-provider helpers are `AsyncGenerator<string>`:
 * they yield text, so there is no return channel for a usage object. That is why
 * `streamLLM` fell back to `chars / 4` — a character heuristic, not tokenisation,
 * which misestimates on exactly the content we serve (statute citations,
 * Devanagari, section symbols, JSON) and understated streamed spend everywhere.
 *
 * Rather than change every yield type, callers pass a mutable sink the helper
 * fills in when the provider reports usage. Every provider here does report it —
 * Anthropic in `message_start`/`message_delta`, OpenAI-compat via
 * `stream_options.include_usage`, Google in `usageMetadata` — we simply were not
 * reading it.
 */
interface StreamUsageSink {
  tokensIn?: number;
  tokensOut?: number;
}

async function* streamAnthropic(
  modelId: string, systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number, temperature: number,
  usageSink?: StreamUsageSink,
): AsyncGenerator<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const userMessages = messages.filter((m) => m.role !== 'system');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: modelId, max_tokens: maxTokens, system: systemPrompt,
      messages: userMessages, temperature, stream: true,
    }),
    signal: AbortSignal.timeout(LLM_PROVIDER_STREAM_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Anthropic stream ${res.status}: ${txt.slice(0, 200)}`);
  }
  for await (const line of sseLines(res)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const evt = JSON.parse(payload);
      // Explicit error event from Anthropic SSE — surface so cascade fires.
      if (evt.type === 'error') {
        const detail = evt.error?.message ?? evt.error?.type ?? 'unknown anthropic error';
        throw new Error(`anthropic stream error: ${detail}`);
      }
      /* Anthropic reports input tokens once in `message_start` and the running
       * output count in each `message_delta`; the last one wins. */
      if (usageSink) {
        const startUsage = evt.type === 'message_start' ? evt.message?.usage : undefined;
        if (startUsage?.input_tokens != null) {
          usageSink.tokensIn = Number(startUsage.input_tokens) || 0;
        }
        if (startUsage?.output_tokens != null) {
          usageSink.tokensOut = Number(startUsage.output_tokens) || 0;
        }
        if (evt.type === 'message_delta' && evt.usage?.output_tokens != null) {
          usageSink.tokensOut = Number(evt.usage.output_tokens) || 0;
        }
      }
      // Stop reason that indicates non-output (e.g. content filter).
      if (evt.type === 'message_delta' && evt.delta?.stop_reason === 'refusal') {
        throw new Error('anthropic refused: stop_reason=refusal');
      }
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        if (evt.delta.text) yield evt.delta.text;
      }
    } catch (e) {
      // Re-throw real errors; swallow only JSON parse failures on malformed lines.
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }
}

async function* streamOpenAICompat(
  url: string, apiKey: string, modelId: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number, temperature: number, expectJson: boolean,
  extraHeaders: Record<string, string> = {},
  usageSink?: StreamUsageSink,
): AsyncGenerator<string> {
  const body: Record<string, unknown> = {
    model: modelId, messages, max_tokens: maxTokens, temperature, stream: true,
  };
  // NV-METER-STREAM-USAGE-001: opt in to the terminal usage chunk. Providers that
  // ignore this field simply never send it and we fall back to the estimate.
  if (usageSink) body.stream_options = { include_usage: true };
  if (expectJson) body.response_format = { type: 'json_object' };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      Accept: 'text/event-stream',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LLM_PROVIDER_STREAM_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    throw new Error(`stream ${res.status}: ${txt.slice(0, 200)}`);
  }
  for await (const line of sseLines(res)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const evt = JSON.parse(payload);
      // OpenAI / OpenRouter / Groq surface in-stream errors as a top-level
      // `error` key. Surface so the orchestrator cascades to the next model.
      if (evt.error) {
        const detail = evt.error.message ?? evt.error.code ?? 'unknown stream error';
        throw new Error(`openai-compat stream error: ${detail}`);
      }
      /* The usage chunk arrives after the finish_reason chunk and carries an empty
       * `choices` array, so it must be read before any early exit. */
      if (usageSink && evt.usage) {
        if (evt.usage.prompt_tokens != null) usageSink.tokensIn = Number(evt.usage.prompt_tokens) || 0;
        if (evt.usage.completion_tokens != null) usageSink.tokensOut = Number(evt.usage.completion_tokens) || 0;
      }
      const delta = evt.choices?.[0]?.delta?.content;
      const finish = evt.choices?.[0]?.finish_reason;
      if (finish === 'content_filter') {
        throw new Error('openai-compat refused: finish_reason=content_filter');
      }
      if (typeof delta === 'string' && delta.length > 0) yield delta;
    } catch (e) {
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }
}

async function* streamGoogle(
  modelId: string, systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number, temperature: number,
  usageSink?: StreamUsageSink,
): AsyncGenerator<string> {
  const keys = resolveGeminiApiKeys();
  if (!keys.length) throw new Error('GOOGLE_API_KEY / GEMINI_API_KEY / GEMINI_API_KEYS not set');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body: Record<string, unknown> = {
    contents, generationConfig: { maxOutputTokens: maxTokens, temperature },
  };
  if (systemPrompt) body.systemInstruction = { role: 'system', parts: [{ text: systemPrompt }] };

  let res: Response | null = null;
  let lastErr = '';
  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}` +
      `:streamGenerateContent?alt=sse&key=${apiKey}`;
    const attempt = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LLM_PROVIDER_STREAM_TIMEOUT_MS),
    });
    if (attempt.ok && attempt.body) {
      res = attempt;
      break;
    }
    const txt = await attempt.text().catch(() => '');
    lastErr = `Google stream ${attempt.status}: ${txt.slice(0, 200)}`;
    if (i < keys.length - 1 && isGeminiKeyRetryable(`${attempt.status} ${txt}`)) {
      logger.warn('llm-orchestrator: Gemini stream key failed — rotating', { keyIndex: i });
      continue;
    }
    throw new Error(lastErr);
  }
  if (!res?.body) throw new Error(lastErr || 'Google stream: all Gemini keys exhausted');
  for await (const line of sseLines(res)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const evt = JSON.parse(payload);
      // Surface explicit Google-side errors / safety blocks so we cascade.
      if (evt.error) {
        const detail = evt.error.message ?? evt.error.code ?? 'unknown google error';
        throw new Error(`google stream error: ${detail}`);
      }
      const block = evt.promptFeedback?.blockReason;
      if (block) {
        throw new Error(`google blocked: ${block}`);
      }
      /* Gemini repeats `usageMetadata` on each SSE frame with running totals; the
       * final frame carries the authoritative count, so last-write-wins. Note
       * `candidatesTokenCount` excludes thinking tokens, which Google bills
       * separately — add them so the ledger matches the invoice. */
      if (usageSink && evt.usageMetadata) {
        const um = evt.usageMetadata;
        if (um.promptTokenCount != null) usageSink.tokensIn = Number(um.promptTokenCount) || 0;
        const out = (Number(um.candidatesTokenCount) || 0) + (Number(um.thoughtsTokenCount) || 0);
        if (out > 0) usageSink.tokensOut = out;
      }
      const finish = evt.candidates?.[0]?.finishReason;
      if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS' && finish !== 'FINISH_REASON_UNSPECIFIED') {
        // SAFETY / RECITATION / OTHER → no usable output.
        throw new Error(`google refused: finishReason=${finish}`);
      }
      const parts = evt.candidates?.[0]?.content?.parts ?? [];
      for (const p of parts) {
        if (typeof p.text === 'string' && p.text.length > 0) yield p.text;
      }
    } catch (e) {
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }
}

async function* streamFromModel(
  model: ModelEntry, systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  userMessage: string,
  maxTokens: number, temperature: number, expectJson: boolean,
  usageSink?: StreamUsageSink,
): AsyncGenerator<string> {
  switch (model.provider) {
    case 'anthropic':
      yield* streamAnthropic(model.id, systemPrompt, messages, maxTokens, temperature, usageSink);
      return;
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY not set');
      yield* streamOpenAICompat(
        'https://api.openai.com/v1/chat/completions',
        apiKey, model.id, messages, maxTokens, temperature, expectJson, {}, usageSink
      );
      return;
    }
    case 'openrouter': {
      const apiKey =
        process.env.OPENROUTER_API_KEY ?? process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
      yield* streamOpenAICompat(
        'https://openrouter.ai/api/v1/chat/completions',
        apiKey, model.id, messages, maxTokens, temperature, expectJson,
        { 'HTTP-Referer': 'https://jurexio.com', 'X-Title': 'Jurexio Enterprise Platform 3.1.2' },
        usageSink
      );
      return;
    }
    case 'google':
      yield* streamGoogle(model.id, systemPrompt, messages, maxTokens, temperature, usageSink);
      return;
    case 'sarvam': {
      const apiKey = process.env.SARVAM_API_KEY ?? process.env.JRX_SARVAM_API_KEY;
      if (!apiKey) throw new Error('SARVAM_API_KEY not set');
      const baseUrl = process.env.JRX_SARVAM_BASE_URL ?? 'https://api.sarvam.ai';
      // Sarvam-M chat-completions is OpenAI-SSE-compatible.
      yield* streamOpenAICompat(
        `${baseUrl}/v1/chat/completions`,
        apiKey, model.id, messages, maxTokens, temperature, expectJson,
        { 'API-Subscription-Key': apiKey },
        usageSink
      );
      return;
    }
    case 'bedrock': {
      let mod: any;
      try { mod = await import('@aws-sdk/client-bedrock-runtime'); }
      catch { throw new Error('Bedrock SDK not installed'); }
      const { buildBedrockRequest, stripBedrockModelId } = await import('./bedrock-request-builder.js');
      const { realModelId } = stripBedrockModelId(model.id);
      const built = buildBedrockRequest(model.id, systemPrompt, messages, maxTokens, temperature);
      let lastStreamErr: Error | null = null;
      // Same per-client credential path as callBedrock — the streaming branch
      // previously created a client with no token at all, so it only worked via
      // ambient env/IAM and silently ignored the per-region Bedrock API keys.
      for (const attempt of bedrockRegionAttempts(realModelId)) {
        try {
          const client = new mod.BedrockRuntimeClient(
            bedrockClientConfig(attempt.region, attempt.token),
          );
          const cmd = new mod.InvokeModelWithResponseStreamCommand({
            modelId: realModelId,
            body: JSON.stringify(built.body),
            contentType: 'application/json',
            accept: 'application/json',
          });
          const resp = await client.send(cmd);
          const decoder = new TextDecoder();
          for await (const event of resp.body as any) {
            if (!event?.chunk?.bytes) continue;
            const decoded = decoder.decode(event.chunk.bytes);
            try {
              const parsed = JSON.parse(decoded) as Record<string, unknown>;
              /* NV-METER-STREAM-USAGE-001 (2026-08-16): Bedrock attaches
               * `amazon-bedrock-invocationMetrics` to its terminal frame — the same
               * frame carrying `message_stop`, which this loop returns from. Read it
               * BEFORE the return or the real counts are discarded and we fall back
               * to `chars / 4`. Measured on jrx-staging: Bedrock (Sonnet 5) is the actual
               * streaming provider on the Queen synthesis path, so this was the one
               * that mattered and the OpenAI/Google sinks alone changed nothing.
               *
               * Anthropic-on-Bedrock additionally reports incremental usage in
               * `message_start` / `message_delta`, kept as a secondary source for
               * models whose final frame omits the metrics block. */
              if (usageSink) {
                const metrics = parsed['amazon-bedrock-invocationMetrics'] as
                  | { inputTokenCount?: number; outputTokenCount?: number }
                  | undefined;
                if (metrics) {
                  if (metrics.inputTokenCount != null) usageSink.tokensIn = Number(metrics.inputTokenCount) || 0;
                  if (metrics.outputTokenCount != null) usageSink.tokensOut = Number(metrics.outputTokenCount) || 0;
                }
                const anthropicUsage = (parsed.usage ?? (parsed.message as { usage?: unknown } | undefined)?.usage) as
                  | { input_tokens?: number; output_tokens?: number }
                  | undefined;
                if (anthropicUsage) {
                  if (anthropicUsage.input_tokens != null) {
                    usageSink.tokensIn = Number(anthropicUsage.input_tokens) || 0;
                  }
                  if (anthropicUsage.output_tokens != null) {
                    usageSink.tokensOut = Number(anthropicUsage.output_tokens) || 0;
                  }
                }
              }
              const chunk = built.parseStreamChunk(parsed);
              if (chunk) yield chunk;
              if (parsed.type === 'message_stop') return;
            } catch {
              /* ignore non-JSON stream frames */
            }
          }
          return;
        } catch (e: any) {
          lastStreamErr = e instanceof Error ? e : new Error(String(e));
          logger.warn('[Bedrock] stream attempt failed', {
            region: attempt.region,
            model: realModelId,
            error: String(lastStreamErr.message || lastStreamErr).slice(0, 160),
          });
        }
      }
      throw lastStreamErr || new Error('Bedrock stream failed');
    }
    case 'vertex': {
      const projectId = process.env.GCP_PROJECT_ID;
      if (!projectId) throw new Error('GCP_PROJECT_ID not set');
      const region = process.env.GCP_VERTEX_REGION ?? 'asia-south1';
      const realModelId = model.id.replace(/-vertex$/, '');
      const token = await vertexAccessToken();
      const url =
        `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}` +
        `/publishers/google/models/${encodeURIComponent(realModelId)}:streamGenerateContent?alt=sse`;
      const contents = messages.filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const body: Record<string, unknown> = {
        contents, generationConfig: { maxOutputTokens: maxTokens, temperature },
      };
      if (systemPrompt) body.systemInstruction = { role: 'system', parts: [{ text: systemPrompt }] };
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(LLM_PROVIDER_STREAM_TIMEOUT_MS),
      });
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Vertex stream ${res.status}: ${txt.slice(0, 200)}`);
      }
      for await (const line of sseLines(res)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.error) throw new Error(`vertex stream error: ${evt.error.message ?? 'unknown'}`);
          const parts = evt.candidates?.[0]?.content?.parts ?? [];
          for (const p of parts) {
            if (typeof p.text === 'string' && p.text.length > 0) yield p.text;
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
      return;
    }
    case 'agentzero':
    case 'simulation': {
      // Deterministic fallback: chunk the synchronous AgentZero reply.
      const r = await callAgentZero(systemPrompt, userMessage);
      const chunkSize = 64;
      for (let i = 0; i < r.content.length; i += chunkSize) {
        yield r.content.slice(i, i + chunkSize);
      }
      return;
    }
    default:
      throw new Error(`streaming not implemented for provider ${model.provider}`);
  }
}

/**
 * True provider-side streaming with cascading fallback.
 *
 * Behavior:
 *   - Calls each candidate model in the router sequence with native SSE.
 *   - If a model fails BEFORE emitting any token, advances to the next.
 *   - If a model fails AFTER emitting tokens, ends the stream cleanly with
 *     a `[STREAM_INTERRUPTED:<modelId>]` marker so the client can recover —
 *     resuming mid-stream from a fresh model would garble the answer.
 *   - AgentZero is always reachable as the last entry, guaranteeing the
 *     never-fail contract.
 */
// Internal: track per-attempt failures inside streamLLM so the terminal
// failure record can carry the same diagnostic detail as the non-stream
// path. Shape mirrors the `attempts[]` array used by `orchestrateLLM`.
interface StreamAttempt { modelId: string; ok: boolean; error?: string }

export async function* streamLLM(input: OrchestrationInput): AsyncGenerator<string> {
  const start = Date.now();
  const decision = pickSequence(input.routing);
  const jurisdiction = decision.inputs.jurisdiction;
  const systemPrompt = buildSystemPrompt(input, jurisdiction);
  const messagesForOpenAIStyle = buildProviderMessages(input, systemPrompt);
  const maxTokens = input.maxTokens ?? 4096;
  const temperature = input.temperature ?? 0.3;
  const expectJson = !!input.expectJson;

  /* NV-AUDIT-TOKENS-002 / NV-METER-STREAM-USAGE-001: the stream path used to record
   * tokensIn=0 and cost=0, so streaming-heavy dashboards (LegalChat) showed
   * near-zero cost. It then approximated both sides from character counts. Real
   * provider usage is now read out-of-band via `StreamUsageSink` where the provider
   * reports it; `estTokensIn` below remains the fallback for providers that do not
   * (currently Bedrock's streaming path). */
  const promptChars = messagesForOpenAIStyle.reduce((n, m) => n + (m.content?.length || 0), 0)
    + (input.userMessage?.length || 0);
  const estTokensIn = Math.ceil(promptChars / 4);

  // NV-LLM-DEADLINE-001 — streaming gets its own (longer) master budget, but it
  // is still a bounded deadline rather than `rungs × stream timeout`.
  const attemptTier = resolveAttemptTier(input);
  const streamMasterMs = Math.max(
    input.deadlineMs ?? NV_TIMEOUTS.llmMasterStreamMs,
    resolveMasterDeadlineMs(input, attemptTier),
  );
  const deadline: RequestDeadline = input.deadlineAt != null
    ? { deadlineAt: input.deadlineAt }
    : startRequestDeadline(streamMasterMs, start);

  let fallbackLevel = -1;
  const attempts: StreamAttempt[] = [];
  /* NV-LLM-BREAKER-SHARED-001 — this path used to keep a `quarantinedProviders`
   * Set local to ONE invocation, so a provider that had just returned 402 was
   * re-attempted on the very next stream (and by every other pod). It now reads
   * the same shared gate as `orchestrateLLM`. */
  const gates = await loadProviderGates(decision.sequence.map((m) => m.provider));

  for (const model of decision.sequence) {
    fallbackLevel += 1;
    const gate = await isProviderAllowed(model.provider, gates);
    if (!gate.allowed) {
      attempts.push({ modelId: model.id, ok: false, error: `skipped:${gate.reason ?? 'gated'}` });
      continue;
    }
    const remaining = timeRemainingMs(deadline);
    const skip = shouldSkipForDeadline(model, remaining);
    if (skip.skip) {
      attempts.push({
        modelId: model.id,
        ok: false,
        error: `skipped:p50-${skip.p50}ms-exceeds-remaining-${remaining}ms`,
      });
      continue;
    }
    const attemptStart = Date.now();
    let emittedAny = false;
    let charCount = 0;
    /* NV-METER-STREAM-USAGE-001: per-attempt sink. The provider fills this in if it
     * reports usage; the char estimate below is used only when it does not. */
    const usageSink: StreamUsageSink = {};
    const streamBudgetMs = attemptBudgetMs(attemptTier, remaining, true);
    try {
      // The generator is created inside the budget scope so every provider's
      // fetch/SDK call inherits the deadline-derived timeout.
      const iterator = attemptBudgetStore.run({ timeoutMs: streamBudgetMs }, () =>
        streamFromModel(
          model, systemPrompt, messagesForOpenAIStyle, input.userMessage,
          maxTokens, temperature, expectJson, usageSink,
        ),
      );
      for await (const chunk of iterator) {
        emittedAny = true;
        charCount += chunk.length;
        yield chunk;
      }
      // The provider returned cleanly. Two sub-cases:
      //  (a) emittedAny=true → genuine success.
      //  (b) emittedAny=false → the provider closed the SSE stream without
      //      emitting any text content (filtered, blocked, empty, or a
      //      silent provider-side error we did not throw). Treat as failure
      //      and cascade — otherwise the caller silently gets an empty
      //      response from what looked like a "successful" model.
      if (!emittedAny) {
        throw new Error('empty stream — provider returned no text content');
      }
      const latencyMs = Date.now() - attemptStart;
      recordSuccess(model.id, latencyMs);
      recordProviderSuccess(model.provider);
      /* Real provider counts when we have them, char heuristic otherwise. This is
       * the whole point of the sink: `charCount / 4` systematically misestimates
       * legal output (citations, Devanagari, section symbols) and, for Gemini,
       * cannot see thinking tokens at all — which are billed. */
      const streamTokensIn = usageSink.tokensIn ?? estTokensIn;
      const streamTokensOut = usageSink.tokensOut ?? Math.ceil(charCount / 4);
      const usageMetered = usageSink.tokensOut != null;
      const streamCost = estimateCostUsd(model, streamTokensIn, streamTokensOut);
      recordDecision({
        ts: Date.now(),
        requestId: input.requestId,
        agentId: input.routing.agentId,
        tier: decision.inputs.tier,
        jurisdiction: decision.inputs.jurisdiction,
        taskKind: decision.inputs.taskKind,
        primaryModelId: decision.primary.id,
        pickedModelId: model.id,
        pickedProvider: model.provider,
        fallbackLevel,
        ok: true,
        latencyMs: Date.now() - start,
        costUsd: streamCost,
        tokensIn: streamTokensIn,
        tokensOut: streamTokensOut,
      });
      // NV-AUDIT-TOKENS-002 — record input+output tokens and a real cost (from
      // model pricing) so streaming requests carry non-zero ledger totals on the
      // dashboards and the tamper-evident SDK chain.
      recordLlmUsage({
        tokensIn: streamTokensIn,
        tokensOut: streamTokensOut,
        costUsd: streamCost,
        model: model.id,
        provider: model.provider,
      });
      // NV-OTEL-GENAI-001 — emit an OTel GenAI span for the streaming call too.
      try {
        traceLLMCall(model.provider, model.id, streamTokensIn, streamTokensOut, Date.now() - start, streamCost, true);
      } catch { /* tracing is best-effort */ }
      logger.info('llm-orchestrator: stream success', {
        requestId: input.requestId, model: model.id, fallbackLevel,
        latencyMs: Date.now() - start, chars: charCount,
        // Distinguishes a measured ledger entry from an estimated one, so the
        // share of streamed spend that is still guessed is itself measurable.
        usageSource: usageMetered ? 'provider' : 'estimate',
        tokensIn: streamTokensIn, tokensOut: streamTokensOut,
      });
      return;
    } catch (err: any) {
      const message = (err as Error).message?.slice(0, 200) ?? String(err);
      recordFailure(model.id, message);
      attempts.push({ modelId: model.id, ok: false, error: message });
      logger.warn('llm-orchestrator: stream failed', {
        requestId: input.requestId, model: model.id, fallbackLevel,
        emittedAny, error: message,
      });
      // NV-LLM-RETRY-001 — classify before recording so a 429 opens the breaker
      // gradually while a 402 / bad key quarantines the provider immediately.
      // Mid-stream we do NOT retry the same rung: bytes already reached the
      // client, and re-running the prompt would duplicate or garble the answer.
      const retryInfo = classifyAndDecide(err, MAX_RETRIES_PER_RUNG, timeRemainingMs(deadline));
      recordProviderFailure(model.provider, { message, retryable: false });
      if (retryInfo.hardFault) {
        const refreshed = await loadProviderGates([model.provider]);
        const g = refreshed.get(model.provider);
        if (g) gates.set(model.provider, g);
      }
      if (emittedAny) {
        // Cannot safely splice mid-stream; surface a clean marker and stop.
        yield `\n\n[STREAM_INTERRUPTED:${model.id}]`;
        return;
      }
      // No bytes yet — try the next candidate.
    }
  }
  // Terminal failure on the streaming path: all candidates failed before
  // emitting a single byte. Persist this so the audit trail is complete.
  recordDecision({
    ts: Date.now(),
    requestId: input.requestId,
    agentId: input.routing.agentId,
    tier: decision.inputs.tier,
    jurisdiction: decision.inputs.jurisdiction,
    taskKind: decision.inputs.taskKind,
    primaryModelId: decision.primary?.id ?? 'none',
    pickedModelId: 'none',
    pickedProvider: 'none',
    fallbackLevel: decision.sequence.length,
    ok: false,
    latencyMs: Date.now() - start,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    errorMessage:
      `stream: all ${decision.sequence.length} candidates failed before first token; ` +
      `last attempts: ${attempts.slice(-3).map((a) => `${a.modelId}(${a.error ?? 'ok'})`).join('; ')}`
        .slice(0, 1000),
  });
  yield `\n[ORCHESTRATOR_DEGRADED] All ${decision.sequence.length} candidates failed before first token.`;
}
