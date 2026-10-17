/**
 * NV-PARTNER-HUMAN-POLISH-001 — deterministic post-processor for partner `-fast`
 * paths. Strips chatbot / AI preamble markers so draft output reads like counsel
 * prose, not an assistant reply.
 *
 * Runs after LLM + fast-delivery polish; never on counsel-grade Queen paths.
 * Skips Nyayamitra agents — their disclaimer flow is owned by the Mitra backend.
 */
import {
  isPartnerExplicitFastAlias,
  isPartnerCounselOrDraftTask,
} from './jrx-partner-platform.js';

/** Preamble / filler the model sometimes emits despite prompt bans. */
export const PARTNER_AI_MARKER_PATTERNS: RegExp[] = [
  /^\s*As an AI(?: language model)?[,:\s][^\n]*\n+/gim,
  /^\s*I(?:'m| am) an AI(?: assistant| language model)?[,:\s][^\n]*\n+/gim,
  /^\s*Certainly[!,.]?\s*\n*/gim,
  /^\s*Of course[!,.]?\s*\n*/gim,
  /^\s*Sure[!,.]?\s*\n*/gim,
  /^\s*Here(?:'s| is) (?:a |the )?(?:draft|response|answer|legal (?:draft|analysis|memo))[:,\s]*\n*/gim,
  /^\s*Below is (?:a |the )?(?:draft|response|answer)[:,\s]*\n*/gim,
  /^\s*In conclusion[,:\s]+/gim,
  /^\s*To summarize[,:\s]+/gim,
  /^\s*I hope this helps[!.]?\s*\n*/gim,
  /^\s*Please note that (?:I am|this is) (?:an AI|not (?:a )?(?:substitute for )?legal advice)[^\n]*\n+/gim,
  /^\s*Let me (?:know if|help you)[^\n]*\n+/gim,
];

/** Detect AI-marker hits without mutating (for draftQuality.voiceOk). */
export function countPartnerAiMarkerHits(content: string): number {
  const text = String(content ?? '');
  if (!text.trim()) return 0;
  let hits = 0;
  for (const re of PARTNER_AI_MARKER_PATTERNS) {
    const clone = new RegExp(re.source, re.flags);
    const matches = text.match(clone);
    if (matches?.length) hits += matches.length;
  }
  return hits;
}

/** Bracket / mustache placeholders NSP should fill or flag. */
export function countPartnerPlaceholders(content: string): number {
  const text = String(content ?? '');
  if (!text.trim()) return 0;
  const bracket = text.match(/\[[^\]]{1,120}\]/g) ?? [];
  const mustache = text.match(/\{\{[^}]+\}\}/g) ?? [];
  return bracket.length + mustache.length;
}

export interface PartnerHumanPolishOpts {
  taskType?: string;
  /** Resolved agent key — skip Nyayamitra paths. */
  agentKey?: string;
  partnerLean?: boolean;
  /** When true, preserve disclaimer blocks (Mitra backend appends canonical copy). */
  includeDisclaimer?: boolean;
}

const MITRA_AGENTS = new Set(['mitra-conversational', 'clause-classifier', 'case-brief-generator']);

export function shouldRunPartnerHumanPolish(opts: PartnerHumanPolishOpts = {}): boolean {
  if (opts.agentKey && MITRA_AGENTS.has(opts.agentKey)) return false;
  if (opts.partnerLean === true) return true;
  return isPartnerExplicitFastAlias(opts.taskType);
}

/**
 * Strip AI preamble markers. Idempotent. Preserves disclaimer blocks when
 * `includeDisclaimer` is true (default).
 */
export function stripPartnerAiMarkers(
  content: string,
  opts: PartnerHumanPolishOpts = {},
): string {
  if (!content?.trim()) return content;

  /* Split off trailing disclaimer so preamble rules do not touch it. */
  const disclaimerSplit = opts.includeDisclaimer !== false
    ? content.match(/^([\s\S]*?)(\n---\n\*Disclaimer:[\s\S]*)$/i)
    : null;
  let body = disclaimerSplit ? disclaimerSplit[1]! : content;
  const disclaimerTail = disclaimerSplit ? disclaimerSplit[2]! : '';

  for (const re of PARTNER_AI_MARKER_PATTERNS) {
    body = body.replace(re, '');
  }

  body = body.replace(/\n{3,}/g, '\n\n').trimStart();
  return disclaimerTail ? `${body}${disclaimerTail}` : body;
}

export function applyPartnerHumanPolish(
  content: string,
  opts: PartnerHumanPolishOpts = {},
): string {
  if (!shouldRunPartnerHumanPolish(opts) || !content?.trim()) return content;
  return stripPartnerAiMarkers(content, opts);
}

export function isCounselOrDraftTaskType(taskType?: string): boolean {
  return isPartnerCounselOrDraftTask(taskType);
}
