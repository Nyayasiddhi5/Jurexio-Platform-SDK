/**
 * NV-DOCPARSE-NSP-ATTACH-UNDERSTAND-001 — prompt-only understanding when local parse is partial.
 * Does NOT re-OCR or re-run full docparse; uses attach context from NSP orchestrator.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';

const logger = createLogger('./jrx-docparse-nsp-attach-understand');

const UNDERSTAND_SCHEMA = z.object({
  understanding: z.union([z.string(), z.number()]).transform(String),
  limitations: z.union([z.string(), z.number()]).transform(String),
  suggested_fields: z.record(z.string(), z.unknown()).optional(),
  follow_up_questions: z.array(z.union([z.string(), z.number()])).max(8).optional(),
});

function extractJsonObject(raw: string): string | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let depth = 0;
  let start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = cleaned.slice(start, i + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          start = -1;
        }
      }
    }
  }
  return null;
}

function normalizeSuggestedFields(
  input: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!input) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

export interface NspAttachContextInput {
  visibleText?: string;
  visualSummary?: string;
  parseQuality?: 'high' | 'medium' | 'low' | 'partial';
  docTypes?: string[];
  fields?: Record<string, unknown>;
  extractiveSummary?: string[];
  ingestRole?: string;
}

export interface NspAttachUnderstandRequest {
  userPrompt: string;
  attachContext: NspAttachContextInput;
  jurisdiction?: string;
  matterSummary?: string;
  actor?: string;
}

export interface NspAttachUnderstandResponse {
  mode: 'nsp-attach-understand';
  understanding: string;
  limitations: string;
  suggestedFields: Record<string, string>;
  followUpQuestions: string[];
  model?: string;
  promptVersion: string;
}

const PROMPT_VERSION = 'attach-understand-v1';

export async function runNspAttachUnderstand(
  req: NspAttachUnderstandRequest,
): Promise<NspAttachUnderstandResponse> {
  if (!isJrxFeatureOn('docparseAttachUnderstand')) {
    throw new Error('DOCPARSE_ATTACH_UNDERSTAND_DISABLED');
  }
  const prompt = (req.userPrompt ?? '').trim();
  if (!prompt) throw new Error('userPrompt required');

  const ctx = req.attachContext ?? {};
  const contextBlock = [
    ctx.parseQuality ? `parseQuality: ${ctx.parseQuality}` : '',
    ctx.ingestRole ? `ingestRole: ${ctx.ingestRole}` : '',
    ctx.docTypes?.length ? `docTypes: ${ctx.docTypes.join(', ')}` : '',
    ctx.visualSummary ? `visualSummary:\n${ctx.visualSummary.slice(0, 2000)}` : '',
    ctx.visibleText ? `visibleText:\n${ctx.visibleText.slice(0, 8000)}` : '',
    ctx.extractiveSummary?.length
      ? `extractiveSummary:\n${ctx.extractiveSummary.slice(0, 6).join('\n')}`
      : '',
    ctx.fields && Object.keys(ctx.fields).length
      ? `structuredFields:\n${JSON.stringify(ctx.fields).slice(0, 4000)}`
      : '',
    req.matterSummary ? `matterSummary:\n${req.matterSummary.slice(0, 1500)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const systemPrompt = [
    'You help Indian legal practitioners use ATTACHMENT CONTEXT for draft/chat.',
    'Use ONLY the provided attachment context — do not invent facts, parties, or dates.',
    'If context is partial, say so in limitations.',
    'Return JSON: understanding, limitations, suggested_fields (optional map), follow_up_questions (optional).',
  ].join(' ');

  const userMessage = `${prompt}\n\n--- ATTACHMENT CONTEXT ---\n${contextBlock || '(empty — say limitations clearly)'}`;

  const { realLLMService } = await import('./real-llm-service.js');
  const requestId = randomUUID();
  const baseRequest = {
    userId: 'system',
    maxTokens: 1200,
    temperature: 0,
    tier: 'plus' as const,
    taskKind: 'extraction' as const,
    jurisdiction: req.jurisdiction ?? 'IN',
    expectJson: true,
    maxCostUsd: Number(process.env.JRX_DOCPARSE_ATTACH_UNDERSTAND_MAX_COST_USD || 0.02),
    requirements: {
      complexity: 'medium' as const,
      domain: 'analytical' as const,
      priority: 'medium' as const,
      costBudget: 'minimal' as const,
      responseTime: 'fastest' as const,
      qualityLevel: 'professional' as const,
    },
    fallbackLevels: 1,
    timestamp: new Date(),
  };

  let lastModel: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const strictSystem =
      attempt === 0
        ? systemPrompt
        : `${systemPrompt}\n\nCRITICAL: Output ONLY one JSON object. Keys: understanding, limitations, suggested_fields (optional), follow_up_questions (optional). No markdown fences.`;
    const resp = await realLLMService.executeRequest({
      ...baseRequest,
      id: attempt === 0 ? requestId : `${requestId}-retry`,
      prompt: userMessage,
      systemPrompt: strictSystem,
    } as Parameters<typeof realLLMService.executeRequest>[0]);

    lastModel = resp?.model;
    const jsonStr = extractJsonObject(String(resp?.content ?? ''));
    if (!jsonStr) continue;
    const parsed = UNDERSTAND_SCHEMA.safeParse(JSON.parse(jsonStr));
    if (!parsed.success) {
      logger.warn('attach-understand schema miss', { attempt, issues: parsed.error.issues.length });
      continue;
    }

    logger.info('attach-understand done', {
      parseQuality: ctx.parseQuality,
      actor: req.actor,
      model: resp?.model,
      attempt,
    });

    return {
      mode: 'nsp-attach-understand',
      understanding: parsed.data.understanding.trim().slice(0, 4000),
      limitations: parsed.data.limitations.trim().slice(0, 1000),
      suggestedFields: normalizeSuggestedFields(parsed.data.suggested_fields),
      followUpQuestions: (parsed.data.follow_up_questions ?? []).map(String).slice(0, 5),
      model: resp?.model,
      promptVersion: PROMPT_VERSION,
    };
  }

  throw new Error('ATTACH_UNDERSTAND_SCHEMA_FAILED');
}
