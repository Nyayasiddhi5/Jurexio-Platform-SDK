/**
 * NV-FAST-DELIVERY-POLISH-001 — fill structure-attach skeleton placeholders on
 * partner `-fast` / lean paths without a full Queen polish pass.
 *
 * Strategy A (default): deterministic merge from LLM body + structure metadata.
 * Strategy B (fallback): single Haiku pass when placeholders remain and
 * `NYV_FAST_DELIVERY_POLISH=1` (default ON). Max 512 tokens out, 8s budget.
 *
 * Never runs on counsel-grade bare `legal-draft` / `legal-chat` (Opus Queen path).
 */
import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger.js';
import {
  isPartnerExplicitFastAlias,
  isPartnerExplicitFastChatAlias,
  isPartnerExplicitFastDraftAlias,
  shouldSkipExpensiveDraftFastSteps,
} from '../utils/jrx-partner-platform.js';
import {
  applyDraftCompletionPolish,
  hasDraftClosingSections,
  type DraftStructureMarkers,
} from './jrx-draft-completion.js';
import { applyCitationPropositionSanitize } from './jrx-citation-proposition-gate.js';
import { applyRetrievalCitationVerify } from './jrx-citation-retrieval-verify.js';
import { enforceSourcesConsulted, type RetrievedSourceLine } from './jrx-sources-consulted-enforcer.js';
import { enforceDraftPlaceholders } from './jrx-draft-placeholder-enforcer.js';
import { resolveDraftDocumentType } from '../config/jrx-draft-length-registry.js';

const logger = createLogger('./jrx-fast-delivery-polish');

const ORCHESTRATOR_SKELETON_RE =
  /\[Orchestrator skeleton[^\]]*\]/gi;
const DRAFT_NUMBERED_SKELETON_RE =
  /\[Numbered paragraphs mapping[^\]]*\]/gi;
const RELIEF_PLACEHOLDER_RE =
  /\[SPECIFIC RELIEF MAPPED TO THE FACTS ABOVE\]/gi;
const COUNSEL_STRUCTURE_MARKER_RE =
  /---\s*\n\*Counsel structure \(NV-LEGAL-STRUCTURE-ATTACH-001[^*]*\*\s*\n*/gi;
const COUNSEL_COMPLETENESS_MARKER_RE =
  /---\s*\n\*Counsel completeness \(NV-LEGAL-COMPREHENSIVE-001\)\*\s*\n*/gi;
const OMITTED_HEADING_RE =
  /\*\*(ISSUE & SHORT ANSWER|FACTS ASSUMED \/ CONTEXT|APPLICABLE LAW & INGREDIENTS|ANALYSIS|AUTHORITIES|RISKS & CAVEATS|NEXT STEPS \/ PRAYER)\*\*\s*\n\[This heading was not separately produced[^\]]*\]/gi;

const IRAC_SECTION_FILLS: Array<{
  title: string;
  fill: (main: string, query?: string) => string;
}> = [
  {
    title: 'ISSUE & SHORT ANSWER',
    fill: (main) => {
      const sentences = main.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 12);
      if (sentences.length >= 2) {
        return `${sentences[0]!.trim()}\n\n${sentences[1]!.trim()}`;
      }
      if (sentences.length === 1) return sentences[0]!.trim();
      return 'See the analysis above for the issue and preliminary answer.';
    },
  },
  {
    title: 'FACTS ASSUMED / CONTEXT',
    fill: (main, query) => {
      const factLines = main
        .split('\n')
        .map((l) => l.trim())
        .filter((l) =>
          l.length > 20
          && /\b(FIR|police|station|accused|petitioner|complainant|dated|arrest|cheque|amount|contract|party|applicant|respondent|plaintiff|defendant)\b/i.test(l),
        );
      if (factLines.length) return factLines.slice(0, 5).join('\n');
      if (query?.trim()) {
        return `As stated in the request: ${query.trim().slice(0, 320)}. Further particulars to be confirmed from records.`;
      }
      return 'Facts are as summarised in the analysis above; verify against source documents.';
    },
  },
  {
    title: 'APPLICABLE LAW & INGREDIENTS',
    fill: (main) => {
      const statutes = main.match(
        /\b(?:BNS|BNSS|BSA|IPC|CrPC|CPC|NI Act|Companies Act|Contract Act|§\s*\d+|Section\s+\d+|s\.\s*\d+)[^\n.]*/gi,
      );
      if (statutes?.length) return [...new Set(statutes)].slice(0, 6).join('\n');
      return 'Applicable statutory framework is discussed in the analysis above.';
    },
  },
  {
    title: 'ANALYSIS',
    fill: (main) => {
      const trimmed = main.trim();
      if (trimmed.length > 80) return trimmed;
      return 'Analysis is set out in the preceding sections.';
    },
  },
  {
    title: 'AUTHORITIES',
    fill: (main) => {
      const cites =
        main.match(/\b(?:AIR|SCC|\(\d{4}\)\s+\d+\s+SCC|SC \d+|v\.\s|vs\.?\s)[^\n.]*/gi)
        ?? main.match(/\b(?:Sibbia|Maneka|Kesavananda|Mafatlal|Arnesh Kumar|Satender Kumar)[^\n.]*/gi);
      if (cites?.length) return [...new Set(cites)].slice(0, 8).join('\n');
      return 'Authorities cited in the analysis above; verify against primary sources before filing.';
    },
  },
  {
    title: 'RISKS & CAVEATS',
    fill: (main) => {
      const riskLines = main
        .split(/(?<=[.!?])\s+/)
        .filter((s) =>
          /\b(however|risk|caveat|limitation|barred|jurisdiction|condition|twin|may not|uncertain|unconfirmed|subject to)\b/i.test(s),
        );
      if (riskLines.length) return riskLines.slice(0, 4).join(' ');
      return 'Confirm forum competence, limitation, and special-statute bars before relying on this analysis.';
    },
  },
  {
    title: 'NEXT STEPS / PRAYER',
    fill: (main) => {
      const steps = main
        .split(/(?<=[.!?])\s+/)
        .filter((s) =>
          /\b(file|approach|consult|engage|next|recommend|should|apply|petition|sessions|high court|advocate)\b/i.test(s),
        );
      if (steps.length) return steps.slice(0, 3).join(' ');
      return 'Consult a qualified advocate for filing strategy and prayer drafting.';
    },
  },
];

export interface FastDeliveryPolishOpts {
  taskType?: string;
  query?: string;
  jurisdiction?: string;
  /** Orchestration lean path — same gate as explicit `-fast`. */
  partnerLean?: boolean;
  documentType?: string;
  parameters?: Record<string, unknown>;
  /** Pre-computed structure markers from checker pass (optional). */
  structureMarkers?: DraftStructureMarkers;
  /** Post-LLM citation retrieval verify — set citationVerified on result meta. */
  ragAttempted?: boolean;
  ragGrounded?: boolean;
  statutePrefetchApplied?: boolean;
  ragContextBlock?: string;
  retrievedSources?: RetrievedSourceLine[];
}

export interface PartnerFastPostProcessResult {
  content: string;
  citationVerified: boolean;
  sourcesAppended: boolean;
  structureMarkers?: DraftStructureMarkers;
}

export function isFastDeliveryPolishEnabled(): boolean {
  const v = String(process.env.NYV_FAST_DELIVERY_POLISH ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

/** Gate: only `-fast` aliases or explicit partnerLean — never bare counsel-grade draft/chat. */
export function shouldRunFastDeliveryPolish(opts: FastDeliveryPolishOpts = {}): boolean {
  if (!isFastDeliveryPolishEnabled()) return false;
  // NV-FAST-CHAT-SLA-001 — chat-fast skips structure attach; polish is draft-only.
  if (isPartnerExplicitFastChatAlias(opts.taskType)) return false;
  if (opts.partnerLean === true) return true;
  return isPartnerExplicitFastAlias(opts.taskType);
}

export function hasStructureSkeletonPlaceholders(content: string): boolean {
  if (!content?.trim()) return false;
  return (
    /\[Orchestrator skeleton[^\]]*\]/i.test(content)
    || /\[Numbered paragraphs mapping[^\]]*\]/i.test(content)
    || /\[SPECIFIC RELIEF MAPPED TO THE FACTS ABOVE\]/i.test(content)
    || /\[This heading was not separately produced/i.test(content)
    || /stored skeleton, not a new LLM pass/i.test(content)
  );
}

function extractMainBody(content: string): string {
  const markerIdx = content.search(/---\s*\n\*Counsel (?:structure|completeness)/i);
  if (markerIdx >= 0) return content.slice(0, markerIdx).trim();
  const iracIdx = content.search(/\n\*\*ISSUE & SHORT ANSWER\*\*\s*\n\[Orchestrator skeleton/i);
  if (iracIdx >= 0) return content.slice(0, iracIdx).trim();
  return content.trim();
}

function extractDraftFactBody(content: string): string {
  const showethIdx = content.search(/\*\*MOST RESPECTFULLY SHOWETH/i);
  if (showethIdx >= 0) return content.slice(0, showethIdx).trim();
  return extractMainBody(content);
}

function fillDraftNumberedParagraphs(main: string): string {
  const paras = main.split(/\n\n+/).map((p) => p.trim()).filter((p) => p.length > 30);
  if (paras.length) {
    return paras
      .slice(0, 8)
      .map((p, i) => `${i + 1}. ${p.replace(/^\d+\.\s*/, '').trim()}`)
      .join('\n\n');
  }
  return [
    '1. The facts stated above are incorporated herein.',
    '2. The statutory ingredients are mapped in the preceding analysis.',
  ].join('\n\n');
}

function fillReliefFromMain(main: string, query?: string): string {
  const reliefHint = main.match(/\b(bail|quash|injunction|damages|recovery|specific performance|anticipatory|regular bail)[^\n.]*/i);
  if (reliefHint?.[0]) return reliefHint[0].trim().slice(0, 200);
  if (query?.trim()) return `Relief as sought in: ${query.trim().slice(0, 180)}`;
  return 'Relief as mapped to the facts stated above';
}

function fillIracSectionBlocks(content: string, main: string, query?: string): string {
  let out = content;
  for (const section of IRAC_SECTION_FILLS) {
    const headingRe = new RegExp(
      `(\\*\\*${section.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*\\s*\\n)\\[Orchestrator skeleton[^\\]]*\\]`,
      'i',
    );
    out = out.replace(headingRe, `$1${section.fill(main, query)}`);
  }
  return out;
}

/**
 * Deterministic placeholder fill — no LLM. Idempotent when no skeletons remain.
 */
export function deterministicFastDeliveryPolish(
  content: string,
  opts: FastDeliveryPolishOpts = {},
): string {
  if (!content?.trim() || !hasStructureSkeletonPlaceholders(content)) {
    return stripInternalStructureMarkers(content);
  }

  const main = extractMainBody(content);
  let out = content;

  out = fillIracSectionBlocks(out, main, opts.query);
  out = out.replace(DRAFT_NUMBERED_SKELETON_RE, () =>
    fillDraftNumberedParagraphs(extractDraftFactBody(content)),
  );
  out = out.replace(RELIEF_PLACEHOLDER_RE, () => fillReliefFromMain(main, opts.query));
  out = out.replace(OMITTED_HEADING_RE, (match) => {
    const titleMatch = match.match(/\*\*([^*]+)\*\*/);
    const title = titleMatch?.[1]?.trim();
    const section = IRAC_SECTION_FILLS.find((s) => s.title === title);
    if (!section) return match;
    return `**${title}**\n${section.fill(main, opts.query)}`;
  });

  return stripInternalStructureMarkers(out);
}

function stripInternalStructureMarkers(content: string): string {
  if (!content) return content;
  return content
    .replace(COUNSEL_STRUCTURE_MARKER_RE, '\n\n')
    .replace(COUNSEL_COMPLETENESS_MARKER_RE, '\n\n')
    .replace(/\*Counsel structure \(NV-LEGAL-STRUCTURE-ATTACH-001[^*]*\*\s*\n*/gi, '')
    .replace(/\*Counsel completeness \(NV-LEGAL-COMPREHENSIVE-001\)\*\s*\n*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

async function haikuDeliveryPolish(content: string, opts: FastDeliveryPolishOpts): Promise<string> {
  const budgetMs = Number(process.env.NYV_FAST_DELIVERY_POLISH_BUDGET_MS || 8000);
  const { realLLMService } = await import('./real-llm-service.js');

  try {
    const llmPromise = realLLMService.executeRequest({
      id: randomUUID(),
      userId: 'system',
      prompt: [
        'Format this legal response for partner delivery.',
        'Remove skeleton/placeholder markers and internal orchestrator notes.',
        'Keep all citations and legal substance exactly as grounded.',
        'Do not invent new law, citations, or facts.',
        'Return clean markdown only.',
        '',
        content.slice(0, 12000),
      ].join('\n'),
      systemPrompt:
        'You are a legal delivery formatter. Output polished markdown for a partner API. Never add new citations.',
      maxTokens: 512,
      temperature: 0.2,
      tier: 'plus',
      taskKind: opts.taskType || 'legal-draft-fast',
      jurisdiction: opts.jurisdiction || 'IN',
      requirements: {
        complexity: 'simple',
        domain: 'analytical',
        priority: 'medium',
        costBudget: 'minimal',
        responseTime: 'fastest',
        qualityLevel: 'standard',
      },
      fallbackLevels: 1,
      timestamp: new Date(),
    } as Parameters<typeof realLLMService.executeRequest>[0]);

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), budgetMs);
    });
    const resp = await Promise.race([llmPromise, timeoutPromise]);
    if (!resp) {
      logger.warn('[NV-FAST-DELIVERY-POLISH-001] Haiku fallback timed out');
      return content;
    }

    const polished = String(resp.content || '').trim();
    if (polished.length > 40 && !hasStructureSkeletonPlaceholders(polished)) {
      return stripInternalStructureMarkers(polished);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[NV-FAST-DELIVERY-POLISH-001] Haiku fallback skipped: ${msg}`);
  }
  return content;
}

function contentHasCaseAuthorities(content: string): boolean {
  return /\bv\.?\s|(?:\(\d{4}\)\s+\d+\s+SCC|SCC\s+\d+|AIR\s+\d+)/i.test(String(content || ''));
}

/**
 * NV-PARTNER-FAST-POST-001 — citation retrieval verify + SOURCES CONSULTED for `-fast`.
 */
export async function applyPartnerFastPostProcess(
  content: string,
  opts: FastDeliveryPolishOpts = {},
): Promise<PartnerFastPostProcessResult> {
  const isFast = isPartnerExplicitFastAlias(opts.taskType) || opts.partnerLean === true;
  if (!isFast || !content?.trim()) {
    return { content, citationVerified: true, sourcesAppended: false };
  }

  let out = content;
  let citationVerified = true;
  let sourcesAppended = false;

  const authoritiesPresent = contentHasCaseAuthorities(out)
    || (opts.ragGrounded === true)
    || (opts.retrievedSources?.length ?? 0) > 0;

  if (authoritiesPresent) {
    try {
      const verified = await applyRetrievalCitationVerify(out, {
        hasAuthorities: authoritiesPresent,
        timeoutMs: Number(process.env.NYV_CITATION_RETRIEVAL_VERIFY_TIMEOUT_MS || 5000),
      });
      out = verified.content;
      citationVerified = verified.citationVerified;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[NV-PARTNER-FAST-POST-001] citation verify skipped: ${msg}`);
      citationVerified = false;
    }
  }

  if (isPartnerExplicitFastChatAlias(opts.taskType)) {
    const enforced = enforceSourcesConsulted(out, {
      ragAttempted: opts.ragAttempted,
      ragGrounded: opts.ragGrounded,
      statutePrefetchApplied: opts.statutePrefetchApplied,
      contextBlock: opts.ragContextBlock,
      retrievedSources: opts.retrievedSources,
    });
    out = enforced.content;
    sourcesAppended = enforced.appended;
  }

  if (isPartnerExplicitFastDraftAlias(opts.taskType)) {
    const documentType = resolveDraftDocumentType({
      documentType: opts.documentType,
      taskType: opts.taskType,
      prompt: opts.query,
      parameters: opts.parameters,
    });
    const placeholderEnforced = enforceDraftPlaceholders(out, {
      taskType: opts.taskType,
      query: opts.query,
      documentType,
      minPlaceholders: 3,
    });
    out = placeholderEnforced.content;
  }

  return { content: out, citationVerified, sourcesAppended };
}

/**
 * Full polish pipeline: deterministic merge first, optional Haiku when placeholders remain.
 */
export async function applyFastDeliveryPolish(
  content: string,
  opts: FastDeliveryPolishOpts = {},
): Promise<string> {
  const result = await applyFastDeliveryPolishWithMeta(content, opts);
  return result.content;
}

export async function applyFastDeliveryPolishWithMeta(
  content: string,
  opts: FastDeliveryPolishOpts = {},
): Promise<PartnerFastPostProcessResult> {
  if (!shouldRunFastDeliveryPolish(opts) || !content?.trim()) {
    return { content, citationVerified: true, sourcesAppended: false };
  }

  let out = deterministicFastDeliveryPolish(content, opts);
  const citationSanitized = applyCitationPropositionSanitize(out);
  out = citationSanitized.content;
  let postProcessed = await applyPartnerFastPostProcess(out, opts);
  out = postProcessed.content;

  let structureMarkers = opts.structureMarkers;
  if (!structureMarkers && isPartnerExplicitFastDraftAlias(opts.taskType)) {
    const { applyDraftStructureChecker } = await import('./jrx-draft-structure-checker.js');
    const checked = await applyDraftStructureChecker(out, {
      taskType: opts.taskType,
      documentType: opts.documentType,
      partnerLean: opts.partnerLean,
      parameters: opts.parameters,
      prompt: opts.query,
    });
    out = checked.content;
    structureMarkers = checked.structureMarkers;
  }

  if (!hasStructureSkeletonPlaceholders(out)) {
    out = applyDraftCompletionPolishForDelivery(out, opts);
    return { ...postProcessed, content: out, structureMarkers };
  }

  if (!isFastDeliveryPolishEnabled() || shouldSkipExpensiveDraftFastSteps(opts.taskType)) {
    out = applyDraftCompletionPolishForDelivery(out, opts);
    return { ...postProcessed, content: out };
  }

  logger.info('[NV-FAST-DELIVERY-POLISH-001] deterministic fill incomplete — Haiku fallback');
  out = await haikuDeliveryPolish(out, opts);
  out = deterministicFastDeliveryPolish(out, opts);
  postProcessed = await applyPartnerFastPostProcess(out, opts);
  out = postProcessed.content;
  out = applyDraftCompletionPolishForDelivery(out, opts);
  return { ...postProcessed, content: out, structureMarkers };
}

/** NV-DRAFT-COMPLETION-001 — append closure template or flag via downstream draftQuality. */
function applyDraftCompletionPolishForDelivery(
  content: string,
  opts: FastDeliveryPolishOpts,
): string {
  if (!isPartnerExplicitFastDraftAlias(opts.taskType) && opts.partnerLean !== true) return content;
  const documentType = resolveDraftDocumentType({
    documentType: opts.documentType,
    taskType: opts.taskType,
    prompt: opts.query,
    parameters: opts.parameters,
  });
  const result = applyDraftCompletionPolish(content, { documentType, appendClosure: true });
  return result.content;
}

export function draftDeliveryNeedsClosingSections(content: string, taskType?: string): boolean {
  if (!isPartnerExplicitFastDraftAlias(taskType)) return false;
  return !hasDraftClosingSections(content);
}
