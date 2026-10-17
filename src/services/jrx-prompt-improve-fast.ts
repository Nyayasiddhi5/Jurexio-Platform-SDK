/**
 * NV-PROMPT-IMPROVE-FAST-001 — lightweight partner prompt improvement.
 *
 * Deterministic fast path: analyzePrompt lite + user-facing brief enrichment.
 * No Queen, no RAG, no LLM round-trip, no internal system overlays in output.
 * Target: <100 ms warm cache hit, <200 ms cold.
 */
import crypto from 'crypto';
import { queenOrchestrator } from '../orchestration/jrx-queen-orchestrator.js';
import {
  detectLegalIntelTaskKind,
  type LegalIntelTaskKind,
} from './jrx-legal-intelligence-overlay.js';
import { lmCacheService } from './lm-cache-service.js';

export interface PromptImproveInput {
  prompt: string;
  taskType?: string;
  jurisdiction?: string;
  context?: Record<string, unknown>;
}

export interface PromptImproveResult {
  improvedPrompt: string;
  metadata: {
    enhancementsApplied: string[];
    model: string;
    latencyMs: number;
    cacheHit?: boolean;
    complexity?: string;
    intent?: string;
    agentId?: string;
    originalLength: number;
    improvedLength: number;
  };
}

const CACHE_NAMESPACE = 'prompt-improve-fast';

/** Must never appear in partner-facing improvedPrompt (NV-PROMPT-IMPROVE-USER-001). */
export const INTERNAL_IMPROVE_PROMPT_MARKERS = [
  'NV-LEGAL-INTEL-FORCE',
  'NV-LEGAL-CHAT-STRUCTURE',
  'NON-NEGOTIABLE',
  'GROUNDING DISCIPLINE',
  'Domain Context:',
  'Agent constitution binding:',
  'You are Jurexio (Jurexio legal AI) answering as a practising Indian advocate',
  'You are operating inside Jurexio',
  'INDIAN LEGAL CORPUS',
  'CORPUS: Indian judgments',
] as const;

function cacheKey(input: PromptImproveInput): string {
  const payload = JSON.stringify({
    p: input.prompt,
    t: input.taskType || 'general',
    j: input.jurisdiction || 'IN',
    c: input.context || {},
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function taskTypeToIntelKind(taskType: string | undefined, prompt: string): LegalIntelTaskKind {
  const t = String(taskType || '').toLowerCase();
  if (t.includes('draft')) return 'draft';
  if (t.includes('chat')) return 'chat';
  if (t.includes('research')) return 'research';
  if (t.includes('analy')) return 'analysis';
  return detectLegalIntelTaskKind(prompt);
}

/** Strip pipeline/system config that must not reach NSP Improve UI (defense in depth). */
export function sanitizeUserFacingImprovedPrompt(text: string): string {
  let out = String(text || '').trim();
  if (!out) return out;

  const requestMatch = out.match(/^Context:[\s\S]*?\n\nRequest:\n([\s\S]+)$/i);
  if (requestMatch) out = requestMatch[1].trim();

  out = out.replace(/\n\n(?:Please provide your response|Organize your response with clear sections|Format your response in Markdown)[\s\S]*$/i, '').trim();

  if (INTERNAL_IMPROVE_PROMPT_MARKERS.some((marker) => out.includes(marker))) {
    const briefIdx = out.indexOf('User brief:');
    if (briefIdx >= 0) {
      out = out.slice(briefIdx + 'User brief:'.length).trim();
    }
  }

  return out.trim();
}

/** Deterministic user-safe brief — no internal NYV overlays or registry bindings. */
export function buildUserFacingPromptBrief(
  prompt: string,
  opts: {
    jurisdiction: string;
    taskKind: LegalIntelTaskKind;
  },
): string {
  const text = prompt.trim();
  if (!text) return text;

  if (text.length > 420) {
    if (!/\b(IN|India|Indian)\b/i.test(text) && opts.jurisdiction) {
      return `${text}\n\n(Jurisdiction: ${opts.jurisdiction})`;
    }
    return text;
  }

  const jurisdiction = opts.jurisdiction || 'IN';
  const prefixByKind: Record<LegalIntelTaskKind, string> = {
    draft: `Prepare an Indian legal draft (${jurisdiction}). Include parties and capacity, court/forum, key facts, applicable law, and relief or prayer sought.`,
    chat: `Answer as Indian legal counsel (${jurisdiction}). Be precise, practical, and jurisdiction-correct.`,
    research: `Research under Indian law (${jurisdiction}). Cite only verifiable authorities; do not invent citations.`,
    analysis: `Analyze under Indian law (${jurisdiction}). Identify risks, gaps, and practical next steps.`,
    advice: `Provide Indian legal advice (${jurisdiction}). Map law to facts and state caveats clearly.`,
    general: `Legal request (${jurisdiction}). State parties, forum, facts, and relief sought where applicable.`,
  };

  return `${prefixByKind[opts.taskKind]}\n\nUser brief: ${text}`;
}

export async function improvePromptFast(input: PromptImproveInput): Promise<PromptImproveResult> {
  const start = Date.now();
  const prompt = String(input.prompt || '').trim();
  if (!prompt) {
    throw new Error('prompt is required');
  }

  const jurisdiction = String(input.jurisdiction || 'IN').toUpperCase();
  const taskType = input.taskType || 'general';
  const key = cacheKey(input);

  const cached = await lmCacheService.get(key, CACHE_NAMESPACE);
  if (cached.hit && cached.entry?.value) {
    try {
      const parsed = JSON.parse(String(cached.entry.value)) as PromptImproveResult;
      return {
        ...parsed,
        metadata: {
          ...parsed.metadata,
          latencyMs: Date.now() - start,
          cacheHit: true,
        },
      };
    } catch {
      /* fall through to recompute */
    }
  }

  const analysis = queenOrchestrator.assessPromptComplexity(prompt);
  const taskKind = taskTypeToIntelKind(taskType, prompt);
  const enhancementsApplied: string[] = ['analyzePrompt-lite', 'user-facing-brief-enrichment'];

  const improvedPrompt = sanitizeUserFacingImprovedPrompt(
    buildUserFacingPromptBrief(prompt, { jurisdiction, taskKind }),
  );

  const result: PromptImproveResult = {
    improvedPrompt,
    metadata: {
      enhancementsApplied,
      model: 'deterministic-v1',
      latencyMs: Date.now() - start,
      cacheHit: false,
      complexity: analysis.complexity,
      intent: analysis.intent,
      originalLength: prompt.length,
      improvedLength: improvedPrompt.length,
    },
  };

  await lmCacheService.set(key, JSON.stringify(result), {
    namespace: CACHE_NAMESPACE,
    model: 'deterministic-v1',
    tags: [taskType, jurisdiction],
  });

  return result;
}
