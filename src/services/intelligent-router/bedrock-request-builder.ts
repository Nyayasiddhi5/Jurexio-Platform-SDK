import {
  isBedrockHaiku55FastEnabled,
  isClaude55BedrockModelId,
  isClaude55HaikuModelId,
  resolvePromptCacheMinCharsForModel,
} from '../../config/jrx-bedrock-claude55-policy.js';

/**
 * NV-BEDROCK-REQUEST-001 — unified Bedrock InvokeModel body builder for all families.
 *
 * Live ap-south-1 (2026-07-24):
 *   - Amazon Nova on-demand requires inference-profile ids (e.g. apac.amazon.nova-pro-v1:0)
 *   - Anthropic needs AWS Marketplace use-case form (quarantine until submitted)
 *   - DeepSeek / Qwen / Mistral Large 3 / Kimi / GLM use OpenAI-compatible chat bodies
 * Billing: all Bedrock invoke traffic draws from the AWS account credit program.
 */

export interface BedrockMessage {
  role: string;
  content: string;
}

export interface AnthropicTokenUsage {
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead?: number;
  tokensCacheWrite?: number;
  finishReason: string;
}

/** Split Anthropic/Bedrock usage for metering (NV-USAGE-CACHE-SPLIT-001). */
export function parseAnthropicTokenUsage(
  usage: Record<string, unknown> | undefined,
  finishReason: string,
): AnthropicTokenUsage {
  const u = usage ?? {};
  const tokensCacheRead = Number((u as any).cache_read_input_tokens ?? 0) || 0;
  const tokensCacheWrite = Number((u as any).cache_creation_input_tokens ?? 0) || 0;
  return {
    tokensIn: Number((u as any).input_tokens ?? 0) || 0,
    tokensOut: Number((u as any).output_tokens ?? 0) || 0,
    tokensCacheRead: tokensCacheRead || undefined,
    tokensCacheWrite: tokensCacheWrite || undefined,
    finishReason,
  };
}

export function billableAnthropicInputTokens(usage: AnthropicTokenUsage): number {
  return usage.tokensIn + (usage.tokensCacheRead ?? 0) + (usage.tokensCacheWrite ?? 0);
}

export interface BedrockRequestBody {
  body: Record<string, unknown>;
  parseResponse: (parsed: Record<string, unknown>) => AnthropicTokenUsage & { content: string };
  parseStreamChunk: (parsed: Record<string, unknown>) => string | null;
}

const REGION_PREFIX_RE = /^(global|us|usgov|eu|apac|apne\d|apse\d|use\d|usw\d|euc\d|euw\d)\./;

/** Families that accept OpenAI chat-completions shaped bodies on Bedrock. */
const OPENAI_COMPAT_PREFIXES = [
  'deepseek.',
  'qwen.',
  'moonshot.',
  'moonshotai.',
  'zai.',
  'minimax.',
  'openai.',
  'nvidia.',
  'google.gemma',
];

export function stripBedrockModelId(modelId: string): { realModelId: string; familyId: string } {
  const realModelId = modelId.replace(/-bedrock$/, '');
  const familyId = realModelId.replace(REGION_PREFIX_RE, '');
  return { realModelId, familyId };
}

function isOpenAiCompatFamily(familyId: string): boolean {
  if (OPENAI_COMPAT_PREFIXES.some((p) => familyId.startsWith(p))) return true;
  // Mistral Large 3 / Magistral / Ministral 3 on Bedrock use OAI chat; older Mixtral uses different.
  if (familyId.startsWith('mistral.mistral-large-3')) return true;
  if (familyId.startsWith('mistral.ministral-3')) return true;
  if (familyId.startsWith('mistral.magistral')) return true;
  if (familyId.startsWith('mistral.devstral')) return true;
  return false;
}

function toNovaMessages(messages: BedrockMessage[], systemPrompt: string) {
  const msgs = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{ text: m.content }],
    }));
  const body: Record<string, unknown> = {
    schemaVersion: 'messages-v1',
    messages: msgs,
    inferenceConfig: {},
  };
  if (systemPrompt) {
    body.system = [{ text: systemPrompt }];
  }
  return body;
}

function setInferenceConfig(body: Record<string, unknown>, maxTokens: number, temperature: number) {
  body.inferenceConfig = {
    maxNewTokens: maxTokens,
    temperature,
  };
}

function toOpenAiChatBody(
  messages: BedrockMessage[],
  systemPrompt: string,
  maxTokens: number,
  temperature: number,
): Record<string, unknown> {
  const chat: Array<{ role: string; content: string }> = [];
  if (systemPrompt) chat.push({ role: 'system', content: systemPrompt });
  for (const m of messages) {
    if (m.role === 'system') continue;
    chat.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    });
  }
  return {
    messages: chat,
    max_tokens: maxTokens,
    temperature,
  };
}

function parseOpenAiChat(parsed: Record<string, unknown>) {
  const choices = (parsed.choices as any[]) ?? [];
  const msg = choices[0]?.message;
  let content = '';
  if (typeof msg?.content === 'string') content = msg.content;
  else if (Array.isArray(msg?.content)) {
    content = msg.content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('');
  } else if (typeof parsed.generation === 'string') {
    content = parsed.generation;
  } else if (typeof parsed.text === 'string') {
    content = parsed.text;
  }
  const usage = (parsed.usage as any) ?? {};
  return {
    content: String(content ?? ''),
    tokensIn: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
    tokensOut: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
    finishReason: String(choices[0]?.finish_reason ?? parsed.stop_reason ?? 'stop'),
  };
}

export function buildBedrockRequest(
  modelId: string,
  systemPrompt: string,
  messages: BedrockMessage[],
  maxTokens: number,
  temperature: number,
): BedrockRequestBody {
  const { realModelId, familyId } = stripBedrockModelId(modelId);

  if (familyId.startsWith('anthropic.')) {
    // Claude Sonnet 5 on Bedrock rejects `temperature` (deprecated) — omit it.
    const omitTemperature =
      /claude-sonnet-5/i.test(familyId) ||
      /claude-opus-4/i.test(familyId) ||
      /claude-opus-5/i.test(familyId) ||
      isClaude55BedrockModelId(familyId) ||
      process.env.NYV_BEDROCK_OMIT_TEMPERATURE === '1';

    /* NV-PROMPT-CACHE-001 — mark the system prompt as a cacheable prefix.
     *
     * Our system prompts are large and highly repetitive: the layered agent prompt runs
     * 1.2k–8.6k tokens (NV-AGENT-PROMPT-DEPTH-001) and the same registry constitution is
     * re-sent on every request for a given agent. Anthropic prompt caching bills a cache
     * WRITE at 1.25x input and a cache READ at 0.1x, so a repeated system prefix costs
     * ~10% instead of 100% — the single largest cost lever the audit found, and it changes
     * no wording, so answer quality is unaffected by construction.
     *
     * Applied ONLY to the system block, deliberately:
     *   - The system prompt is the stable prefix. User turns differ every request, so
     *     marking them would pay 1.25x writes for reads that never hit.
     *   - Cache breakpoints are positional; a marker after variable content is useless.
     *
     * `system` becomes the structured block form, which the Bedrock Anthropic API accepts
     * in place of a bare string. Guarded by a minimum length because a cache write costs
     * MORE than a plain call — below the provider's ~1,024-token minimum the entry is
     * silently not created and we would just pay the 1.25x premium. 4,000 chars ≈ 1,000
     * tokens is the conservative floor.
     *
     * Default ON, with `NYV_PROMPT_CACHE=0` as the escape hatch: a provider that ignores
     * `cache_control` simply drops the field, so the failure mode is "no saving", never a
     * broken request. */
    const cacheEnabled = String(process.env.NYV_PROMPT_CACHE ?? '1') !== '0';
    const MIN_CACHEABLE_CHARS = resolvePromptCacheMinCharsForModel(modelId);
    const useCache = cacheEnabled && !!systemPrompt && systemPrompt.length >= MIN_CACHEABLE_CHARS;

    const body: Record<string, unknown> = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      system: useCache
        ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
        : (systemPrompt || undefined),
      messages: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content })),
    };
    if (!omitTemperature) {
      body.temperature = temperature;
    }
    // NV-BEDROCK-CLAUDE55-001 — Haiku 5.5 defaults adaptive thinking ON; disable on `-fast` SLA path.
    if (isClaude55HaikuModelId(familyId) && isBedrockHaiku55FastEnabled()) {
      const thinkingOn = String(process.env.NYV_BEDROCK_HAIKU55_THINKING ?? '0') === '1';
      if (!thinkingOn) {
        body.thinking = { type: 'disabled' };
      }
      const effort = String(process.env.NYV_BEDROCK_HAIKU55_EFFORT ?? 'low').trim();
      if (effort) {
        body.output_config = { effort };
      }
    }
    if (
      String(process.env.NYV_BEDROCK_BATCH_FLEX ?? '0') === '1'
      && isClaude55BedrockModelId(familyId)
    ) {
      body.service_tier = 'flex';
    }
    return {
      body,
      parseResponse: (parsed) => {
        const tok = parseAnthropicTokenUsage(
          parsed.usage as Record<string, unknown> | undefined,
          String(parsed.stop_reason ?? 'end_turn'),
        );
        return {
          content: ((parsed.content as unknown[]) ?? [])
            .map((c: any) => (c?.type === 'text' ? c.text : ''))
            .join(''),
          ...tok,
        };
      },
      parseStreamChunk: (parsed) => {
        if (parsed.type === 'content_block_delta' && (parsed.delta as any)?.type === 'text_delta') {
          return (parsed.delta as any).text ?? null;
        }
        return null;
      },
    };
  }

  if (familyId.startsWith('meta.')) {
    const prompt =
      (systemPrompt ? `System: ${systemPrompt}\n` : '') +
      messages.map((m) => `${m.role}: ${m.content}`).join('\n') +
      '\nassistant:';
    const body = { prompt, max_gen_len: maxTokens, temperature };
    return {
      body,
      parseResponse: (parsed) => ({
        content: String(parsed.generation ?? ''),
        tokensIn: Number(parsed.prompt_token_count ?? 0),
        tokensOut: Number(parsed.generation_token_count ?? 0),
        finishReason: String(parsed.stop_reason ?? 'stop'),
      }),
      parseStreamChunk: (parsed) => (parsed.generation ? String(parsed.generation) : null),
    };
  }

  if (isOpenAiCompatFamily(familyId)) {
    return {
      body: toOpenAiChatBody(messages, systemPrompt, maxTokens, temperature),
      parseResponse: parseOpenAiChat,
      parseStreamChunk: (parsed) => {
        const choices = (parsed.choices as any[]) ?? [];
        const delta = choices[0]?.delta?.content;
        if (typeof delta === 'string' && delta) return delta;
        const msg = choices[0]?.message?.content;
        if (typeof msg === 'string' && msg) return msg;
        return null;
      },
    };
  }

  if (familyId.startsWith('amazon.')) {
    const body = toNovaMessages(messages, systemPrompt);
    // Nova rejects very small maxNewTokens (live us-east-1 400 on 16).
    setInferenceConfig(body, Math.max(128, maxTokens), temperature);
    return {
      body,
      parseResponse: (parsed) => {
        const output = parsed.output as any;
        const text =
          output?.message?.content?.map((c: any) => c.text ?? '').join('') ??
          output?.text ??
          '';
        const usage = parsed.usage as any;
        return {
          content: String(text),
          tokensIn: Number(usage?.inputTokens ?? usage?.input_tokens ?? 0),
          tokensOut: Number(usage?.outputTokens ?? usage?.output_tokens ?? 0),
          finishReason: String(parsed.stopReason ?? 'end_turn'),
        };
      },
      parseStreamChunk: (parsed) => {
        const delta = (parsed.contentBlockDelta as any)?.delta?.text;
        if (delta) return String(delta);
        const text = (parsed.delta as any)?.text;
        return text ? String(text) : null;
      },
    };
  }

  // Legacy Mistral / Cohere fallback (older Mixtral-style)
  if (familyId.startsWith('mistral.') || familyId.startsWith('cohere.')) {
    const body = toOpenAiChatBody(messages, systemPrompt, maxTokens, temperature);
    return {
      body,
      parseResponse: (parsed) => {
        try {
          return parseOpenAiChat(parsed);
        } catch {
          const outputs = parsed.outputs as any[];
          const text = outputs?.[0]?.text ?? parsed.generation ?? parsed.text ?? '';
          return {
            content: String(text),
            tokensIn: 0,
            tokensOut: 0,
            finishReason: 'stop',
          };
        }
      },
      parseStreamChunk: (parsed) => {
        const t = (parsed.outputs as any[])?.[0]?.text ?? (parsed.delta as any)?.text;
        return t ? String(t) : null;
      },
    };
  }

  throw new Error(`Bedrock model family not supported: ${realModelId}`);
}
