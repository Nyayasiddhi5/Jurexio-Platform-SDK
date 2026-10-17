/**
 * NV-PARTNER-PLATFORM-001 — Resolve ecosystem partner platform codes from SDK context.
 * NSP / NYM are India-only products: jurisdiction surfaces must stay IN.
 */

import type { Request } from 'express';
import {
  isPartnerDraftTaskType,
  partnerBodyHasDraftAttachments,
  resolveDraftDocumentType,
  resolveDraftDocumentTypeWithMeta,
  DRAFT_TIER_TOKEN_BANDS,
  resolveDraftAttachmentTokenBump,
  resolveDraftFastSlaTokenCapForDocument,
  resolveDraftOutputTokens,
  type DraftDocumentType,
  type DraftDocumentTypeResolution,
  type DraftLengthTier,
} from '../config/jrx-draft-length-registry.js';
import { createLogger } from './logger.js';
import { platformFromAppType } from '../services/jrx-ecosystem-document-job-contract.js';
import { isTransactionalDraftDocumentType } from '../services/jrx-indian-draft-structure-registry.js';
import {
  betaPartnerChatFastFloor,
  betaPartnerChatFloor,
  betaPartnerDraftFastFloor,
  betaPartnerFastFloor,
  betaPartnerMaxTokensFloor,
  isBetaQualityFirst,
} from '../config/jrx-beta-quality-profile.js';

const logger = createLogger('./jrx-partner-platform');

/** Platforms that must only see / use Indian jurisdiction content. */
export const INDIA_ONLY_PARTNER_CODES: ReadonlySet<string> = new Set(['NSP', 'NYM']);

/**
 * Ecosystem platforms that depend on NYV for all AI tasks — always get full
 * Queen depth (CoT + maker-checker + multi-agent) unless caller opts into
 * partnerSyncLean for a narrow sync extract.
 */
export const NYV_DEPENDENT_PLATFORM_CODES: ReadonlySet<string> = new Set([
  'NSP', 'NYM', 'NSI', 'NSA', 'NSM', 'NSPM', 'NYV',
]);

export function resolvePartnerPlatformCode(req: Request): string | null {
  const ctx = (req as Request & { sdkContext?: Record<string, unknown> }).sdkContext;
  if (!ctx) {
    return resolvePartnerPlatformHintFromHeadersOnly(req);
  }

  const explicit = ctx.partnerPlatformCode != null ? String(ctx.partnerPlatformCode).trim().toUpperCase() : '';
  if (explicit) return explicit;

  const uat = ctx.platformUatLabel != null ? String(ctx.platformUatLabel).trim().toUpperCase() : '';
  if (uat) return uat;

  const fromType = platformFromAppType(ctx.appType != null ? String(ctx.appType) : undefined);
  if (fromType && INDIA_ONLY_PARTNER_CODES.has(fromType.toUpperCase())) {
    return fromType.toUpperCase();
  }
  if (fromType && ['NSI', 'NSA', 'NSM', 'NSPM', 'JRX', 'NYV'].includes(fromType.toUpperCase())) {
    return fromType.toUpperCase();
  }

  const name = String(ctx.appName || '').toUpperCase();
  if (name.includes('NYAYAMITRA') || /\bNYM\b/.test(name)) return 'NYM';
  if (name.includes('NYAYASIDDHI') || name.includes('PROFESSIONAL') || /\bNSP\b/.test(name)) return 'NSP';
  return fromType ? fromType.toUpperCase() : resolvePartnerPlatformHintFromHeadersOnly(req);
}

function resolvePartnerPlatformHintFromHeadersOnly(req: Request): string | null {
  const headerCandidates = [
    req.headers['x-nyv-platform'],
    req.headers['x-platform-id'],
    req.headers['x-platform-name'],
    req.headers['x-client-id'],
    req.headers['x-nyv-client'],
  ];
  for (const raw of headerCandidates) {
    const v = String(Array.isArray(raw) ? raw[0] : raw || '')
      .trim()
      .toUpperCase();
    if (!v) continue;
    if (v === 'NSP' || v.startsWith('NSP') || v.includes('PROFESSIONAL')) return 'NSP';
    if (v === 'NYM' || v.includes('NYAYAMITRA') || v.includes('MITRA')) return 'NYM';
    if (['NSI', 'NSA', 'NSM', 'NSPM', 'JRX', 'NYV'].includes(v)) return v;
  }
  const nspClient = String(req.headers['x-nsp-client'] || '').toLowerCase();
  if (nspClient.includes('nyayasiddhi') || nspClient.includes('nsp') || nspClient.includes('professional')) {
    return 'NSP';
  }
  return null;
}

/**
 * Early platform hint (headers / UAT label / sdkContext) — safe before or after SDK auth.
 * Used so NSP rate-limit skips work for *any* NSP user key, not only env UAT fingerprints.
 */
export function resolvePartnerPlatformHint(req: Request): string | null {
  const fromCtx = resolvePartnerPlatformCode(req);
  if (fromCtx) return fromCtx;
  return resolvePartnerPlatformHintFromHeadersOnly(req);
}

/**
 * NV-PARTNER-PROMPT-ALIAS-001 — NSP Legal Chat / voice copy-resend.
 * STT returns `{ data: { text } }`; partners often POST `message` / `text` /
 * `transcript` / chat `messages[]` instead of `prompt`. Whitespace-only and
 * copied NBSP/BOM must not look like a missing prompt.
 */
const PARTNER_PROMPT_KEYS = [
  'prompt',
  'query',
  'message',
  'text',
  'transcript',
  'content',
  'question',
  'input',
  'userMessage',
  'user_message',
] as const;

export function sanitizeCopiedPartnerPrompt(raw: string): string {
  return raw
    .replace(/\uFEFF/g, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\u202F/g, ' ')
    .trim();
}

function coercePromptValue(value: unknown, unwrapJson = true): string {
  if (typeof value === 'string') {
    const cleaned = sanitizeCopiedPartnerPrompt(value);
    if (!cleaned) return '';
    if (unwrapJson && cleaned.startsWith('{') && cleaned.endsWith('}')) {
      try {
        const parsed = JSON.parse(cleaned) as unknown;
        const inner = resolvePartnerPrompt(parsed);
        if (inner) return inner;
      } catch {
        /* keep original copied JSON string */
      }
    }
    return cleaned;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of ['text', 'transcript', 'prompt', 'message', 'content', 'query']) {
      const nested = coercePromptValue(obj[key], false);
      if (nested) return nested;
    }
  }
  return '';
}

function lastUserMessageContent(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i];
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const role = String(row.role || row.author || 'user').toLowerCase();
    if (role !== 'user' && role !== 'human') continue;
    const text = coercePromptValue(row.content ?? row.text ?? row.message ?? row.prompt, false);
    if (text) return text;
  }
  return '';
}

/** Resolve partner chat text from prompt aliases, STT envelopes, or messages[]. */
export function resolvePartnerPrompt(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as Record<string, unknown>;
  for (const key of PARTNER_PROMPT_KEYS) {
    const text = coercePromptValue(record[key]);
    if (text) return text;
  }
  if (record.data && typeof record.data === 'object') {
    const nested = resolvePartnerPrompt(record.data);
    if (nested) return nested;
  }
  return lastUserMessageContent(record.messages) || lastUserMessageContent(record.previousMessages);
}

/** Write canonical `body.prompt` when a partner alias is present. */
export function applyPartnerPromptAlias(body: unknown): string {
  const prompt = resolvePartnerPrompt(body);
  if (prompt && body && typeof body === 'object' && !Array.isArray(body)) {
    (body as Record<string, unknown>).prompt = prompt;
  }
  return prompt;
}

export function isIndiaOnlyPartner(req: Request): boolean {
  const code = resolvePartnerPlatformCode(req);
  return code != null && INDIA_ONLY_PARTNER_CODES.has(code);
}

export function isNyvDependentPlatform(req: Request): boolean {
  const code = resolvePartnerPlatformCode(req);
  if (code != null && NYV_DEPENDENT_PLATFORM_CODES.has(code)) return true;
  // Any authenticated SDK partner without an explicit non-dependent code
  // (e.g. missing UAT label) still depends on NYV for AI when sdkContext exists.
  const ctx = (req as Request & { sdkContext?: Record<string, unknown> }).sdkContext;
  if (!ctx) return false;
  if (code === 'JRX') return false; // JRX may use NYV selectively — not force full Queen
  return true;
}

/** NSP Professional + NYM Mitra — always receive max legal AI depth on NYV. */
export function isNspOrNymPartner(req: Request): boolean {
  return isIndiaOnlyPartner(req);
}

/**
 * NV-ECOSYSTEM-BEST-OUTCOME-001 — All NYV-dependent Jurexio platforms
 * (NSP, NYM, NSI, NSA, NSM, NSPM, NYV, and authenticated SDK partners except JRX)
 * receive max legal AI depth. Escape: NYV_ECOSYSTEM_BEST_OUTCOME=0
 * (legacy alias NYV_NSP_NYM_BEST_OUTCOME=0 also disables).
 *
 * Formerly NSP/NYM-only; expanded 2026-08-03 so every ecosystem request gets
 * Queen depth + quality gates + India-grade drafting polish when jurisdiction=IN.
 */
export function wantsNspNymBestOutcome(req: Request): boolean {
  if (!isNyvDependentPlatform(req)) return false;
  const off = String(
    process.env.NYV_ECOSYSTEM_BEST_OUTCOME ?? process.env.NYV_NSP_NYM_BEST_OUTCOME ?? '1',
  )
    .trim()
    .toLowerCase();
  return !(off === '0' || off === 'false' || off === 'off');
}

/** @deprecated alias — same as wantsNspNymBestOutcome (ecosystem-wide). */
export function wantsEcosystemBestOutcome(req: Request): boolean {
  return wantsNspNymBestOutcome(req);
}

export interface PartnerBestOutcomeQuality {
  forceLegalBestOutcome: boolean;
  enableRAG: boolean;
  enableCitationVerification: boolean;
  enableHallucinationCheck: boolean;
  enableExplainability: boolean;
  enableMemory: boolean;
  enableCoT: boolean;
}

/** True when taskType is Legal Chat / counsel draft (not Hub web-search / workflow). */
export function isPartnerCounselOrDraftTask(taskType?: string): boolean {
  const tt = String(taskType || '').trim();
  if (!tt) return false;
  // NV-LEGAL-DRAFT-AGENTIC-001 — `-agentic` D1 tier is counsel work (full Queen).
  return /^(legal[_-]?chat([_-]?fast)?|legal[_-]?draft([_-]?fast|[_-]?agentic)?|doc[_-]?draft([_-]?fast|[_-]?agentic)?|document[_-]?draft(ing|[_-]?agentic)?|legal[_-]?drafting|drafting|legal[_-]?advice|legal[_-]?research|legal[_-]?work)$/i.test(tt);
}

/**
 * NV-DRAFT-FAST-SLA-001 — the caller explicitly asked for the fast SLA.
 *
 * `legal-chat-fast` / `legal-draft-fast` / `doc-draft-fast` are not synonyms of
 * their bare forms: the `-fast` suffix is the partner stating a latency
 * contract, exactly as `-deep` states the opposite. NSP sends `-fast` on the
 * Written-Statement drafting surface specifically to stay inside its sync
 * budget instead of hanging for minutes.
 *
 * Kept separate from `isPartnerCounselOrDraftTask` because that predicate answers
 * "is this counsel work?" (yes — a fast draft is still drafting) whereas this one
 * answers "did the caller pin a latency budget?". Conflating them is what caused
 * the defect below.
 */
export function isPartnerExplicitFastAlias(taskType?: string): boolean {
  const tt = String(taskType || '').trim();
  if (!tt) return false;
  return /^(legal[_-]?chat|legal[_-]?draft|doc[_-]?draft|document[_-]?draft)[_-]fast$/i.test(tt);
}

/** Explicit SLA fast chat alias only (not draft — draft may keep minimal RAG for citations). */
export function isPartnerExplicitFastChatAlias(taskType?: string): boolean {
  const tt = String(taskType || '').trim();
  if (!tt) return false;
  return /^legal[_-]?chat[_-]fast$/i.test(tt);
}

/** Explicit SLA fast draft alias — tighter token floor, fast model cascade. */
export function isPartnerExplicitFastDraftAlias(taskType?: string): boolean {
  const tt = String(taskType || '').trim();
  if (!tt) return false;
  return /^(legal[_-]?draft|doc[_-]?draft|document[_-]?draft)[_-]fast$/i.test(tt);
}

/**
 * NV-DRAFT-FAST-SLA-001 — partner `-fast` draft latency contract (default ON).
 * When enabled: cap completion tokens below registry counsel floors and skip
 * expensive post-LLM passes (statute QA, Haiku delivery polish).
 * Escape: `NYV_DRAFT_FAST_SLA=0` for full registry length on `-fast`.
 */
export function isDraftFastSlaEnabled(): boolean {
  const v = String(process.env.NYV_DRAFT_FAST_SLA ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

type DraftFastSlaCapInput =
  | DraftLengthTier
  | { tier?: DraftLengthTier; documentType?: DraftDocumentType };

function normalizeDraftFastSlaCapInput(
  input: DraftFastSlaCapInput = 'medium',
): { tier: DraftLengthTier; documentType?: DraftDocumentType } {
  if (typeof input === 'string') return { tier: input };
  return { tier: input.tier ?? 'medium', documentType: input.documentType };
}

/** Per-tier SLA completion caps — document-type-aware when `documentType` is supplied (NV-DRAFT-FAST-SLA-002). */
export function resolveDraftFastSlaTokenCap(input: DraftFastSlaCapInput = 'medium'): number {
  const { tier, documentType } = normalizeDraftFastSlaCapInput(input);
  if (documentType) {
    return resolveDraftFastSlaTokenCapForDocument({ documentType, tier });
  }
  const medium = envPartnerToken('NYV_DRAFT_FAST_SLA_MAX_TOKENS', 8_192);
  const low = envPartnerToken('NYV_DRAFT_FAST_SLA_MAX_TOKENS_LOW', 4_096);
  const comprehensive = envPartnerToken('NYV_DRAFT_FAST_SLA_MAX_TOKENS_COMPREHENSIVE', 16_384);
  switch (tier) {
    case 'low':
      return low;
    case 'comprehensive':
      return comprehensive;
    default:
      return medium;
  }
}

/** Skip statute QA + Haiku delivery polish on SLA `-fast` draft paths. */
export function shouldSkipExpensiveDraftFastSteps(taskType?: string): boolean {
  return isDraftFastSlaEnabled() && isPartnerExplicitFastDraftAlias(taskType);
}

/** Partner sync budget ceiling (ms) — bare counsel aliases route to -fast at or below this. */
const PARTNER_SYNC_BUDGET_MS = Number(process.env.NYV_PARTNER_SYNC_BUDGET_MS || 90_000);

/**
 * NV-PARTNER-SYNC-TASKTYPE-001 — detect interactive sync timeout budget from partner
 * headers/body. Used to upgrade bare `legal-chat` / `legal-draft` to `-fast` aliases.
 */
export function hasPartnerSyncTimeoutBudget(req: Request): boolean {
  const body = (req.body || {}) as Record<string, unknown>;
  const headerRaw = req.headers['x-nyv-partner-sync-timeout-ms']
    ?? req.headers['x-nyv-sync-timeout-ms']
    ?? req.headers['x-client-timeout-ms'];
  const headerMs = Number(Array.isArray(headerRaw) ? headerRaw[0] : headerRaw);
  const bodyMs = Number(body.syncTimeoutMs ?? body.clientTimeoutMs ?? body.timeoutMs ?? 0);
  const routingMode = String(body.routingMode ?? req.headers['x-nyv-routing-mode'] ?? '').toLowerCase();
  if (routingMode === 'fast' || routingMode === 'sla' || routingMode === 'sync') return true;
  const ms = Number.isFinite(headerMs) && headerMs > 0 ? headerMs
    : Number.isFinite(bodyMs) && bodyMs > 0 ? bodyMs : 0;
  return ms > 0 && ms <= PARTNER_SYNC_BUDGET_MS;
}

/** Read partner draftLength from body.options / body / parameters. */
export function resolvePartnerDraftLength(req: Request): DraftLengthTier | undefined {
  const body = (req.body || {}) as Record<string, unknown>;
  const options = body.options && typeof body.options === 'object'
    ? (body.options as Record<string, unknown>)
    : {};
  const raw = String(
    options.draftLength
    ?? body.draftLength
    ?? (body.parameters as Record<string, unknown> | undefined)?.draftLength
    ?? '',
  ).toLowerCase();
  if (raw === 'low' || raw === 'medium' || raw === 'comprehensive') return raw;
  return undefined;
}

/**
 * True when the caller explicitly requested counsel / Queen quality (must NOT auto-route to -fast).
 */
export function wantsPartnerQualityQueenPath(req: Request, taskType?: string): boolean {
  const body = (req.body || {}) as Record<string, unknown>;
  const tt = String(taskType || body.taskType || '');
  if (/-deep$/i.test(tt) || /[_-]deep$/i.test(tt)) return true;
  const qm = String(body.qualityMode ?? req.headers['x-nyv-quality-mode'] ?? '').toLowerCase();
  if (['counsel', 'queen', 'quality', 'deep', 'full'].includes(qm)) return true;
  if (resolvePartnerDraftLength(req) === 'comprehensive') return true;
  if (body.forceQueenMode === true || body.engageQueen === true) return true;
  const orchMode = String(body.orchestrationMode ?? '');
  if (orchMode && !/^(single|single[_-]?agent)$/i.test(orchMode)) return true;
  if (body.enableCoT === true && qm === 'quality') return true;
  return false;
}

/**
 * NV-NSP-COUNSEL-UPGRADE-001 — upgrade `-fast` to bare counsel path when
 * comprehensive depth or qualityMode=counsel is requested (Queen/Opus async).
 */
export function applyPartnerCounselUpgradeTaskType(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object') return '';
  const original = String(body.taskType || '').trim();
  if (!original || !isPartnerExplicitFastDraftAlias(original)) return original;
  if (!wantsPartnerQualityQueenPath(req, original)) return original;
  const upgraded = /^doc[_-]?draft[_-]fast$/i.test(original) ? 'doc-draft' : 'legal-draft';
  body._nyvTaskTypeUpgradedFrom = original;
  body.taskType = upgraded;
  return upgraded;
}

function isComprehensiveAgenticUpgradeEnabled(): boolean {
  const v = String(process.env.NYV_DRAFT_COMPREHENSIVE_AGENTIC ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

/** R-DRAFT-NSP-QUALITY P2 — single-shot Opus counsel beats agentic Queen on these instruments. */
const SINGLE_SHOT_COMPREHENSIVE_LITIGATION: ReadonlySet<DraftDocumentType> = new Set([
  'review_petition',
  'execution_petition',
  'interlocutory_application',
]);

export function isSpecialLeavePetitionDraftContext(input: {
  documentType?: DraftDocumentType | string;
  prompt?: string;
  instruction?: string;
  parameters?: Record<string, unknown>;
}): boolean {
  const blob = [
    input.documentType,
    input.prompt,
    input.instruction,
    JSON.stringify(input.parameters ?? {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /\bslp\b|\bspecial[\s_-]+leave[\s_-]+(petition|to[\s_-]+appeal)\b|\barticle\s*136\b/.test(blob);
}

/**
 * Whether comprehensive counsel should upgrade to `legal-draft-agentic` (P1-b mesh).
 * P2: SLP-on-writ_petition and review/exec/IA stay single-shot `legal-draft`.
 */
export function shouldUpgradeComprehensiveDraftToAgentic(input: {
  documentType: DraftDocumentType;
  prompt?: string;
  instruction?: string;
  parameters?: Record<string, unknown>;
}): boolean {
  if (isTransactionalDraftDocumentType(input.documentType)) return false;
  if (SINGLE_SHOT_COMPREHENSIVE_LITIGATION.has(input.documentType)) return false;
  if (
    input.documentType === 'writ_petition'
    && isSpecialLeavePetitionDraftContext(input)
  ) {
    return false;
  }
  return true;
}

/**
 * NV-LEGAL-DRAFT-AGENTIC-001 / R-DRAFT-NSP-QUALITY P1-b — comprehensive counsel
 * drafts on litigation instruments use the agentic taskType (plan→research→draft).
 * Notices/agreements stay on bare `legal-draft` (Sonnet-first transactional path).
 */
export function applyPartnerComprehensiveAgenticUpgradeTaskType(req: Request): string {
  if (!isComprehensiveAgenticUpgradeEnabled()) return String((req.body as Record<string, unknown>)?.taskType || '');
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object') return '';
  const tt = String(body.taskType || '').trim();
  if (!tt || /agentic$/i.test(tt)) return tt;
  if (!wantsPartnerQualityQueenPath(req, tt)) return tt;
  if (!/^(legal[_-]?draft|doc[_-]?draft|document[_-]?draft)$/i.test(tt)) return tt;

  const params = body.parameters && typeof body.parameters === 'object'
    ? (body.parameters as Record<string, unknown>)
    : {};
  const prompt = String(body.prompt || params.instruction || '');
  let docType: DraftDocumentType | undefined;
  try {
    docType = resolveDraftDocumentType({
      documentType: params.documentType ?? body.documentType,
      taskType: tt,
      prompt,
      parameters: params,
    });
  } catch {
    return tt;
  }

  if (!shouldUpgradeComprehensiveDraftToAgentic({ documentType: docType, prompt, parameters: params })) {
    return tt;
  }

  const upgraded = /^doc[_-]?draft$/i.test(tt) ? 'doc-draft-agentic' : 'legal-draft-agentic';
  body._nyvTaskTypeUpgradedToAgenticFrom = tt;
  body.taskType = upgraded;
  return upgraded;
}

/**
 * R-DRAFT-NSP-QUALITY P2/P3 — resolve transactional notice/agreement docType from
 * partner request state (after {@link applyPartnerDraftDocumentTypeInference}).
 */
export function resolvePartnerTransactionalCounselDocumentType(
  req: Request,
  taskType?: string,
): DraftDocumentType | null {
  const tt = String(taskType || (req.body as Record<string, unknown>)?.taskType || '').trim();
  if (!isPartnerDraftTaskType(tt)) return null;
  let docType: DraftDocumentType;
  try {
    const resolution = getPartnerDraftDocumentTypeResolution(req);
    const body = (req.body || {}) as Record<string, unknown>;
    const params = body.parameters && typeof body.parameters === 'object'
      ? (body.parameters as Record<string, unknown>)
      : {};
    docType = resolution?.documentType ?? resolveDraftDocumentType({
      documentType: params.documentType ?? body.documentType,
      taskType: tt,
      prompt: String(body.prompt || params.instruction || ''),
      parameters: params,
    });
  } catch {
    return null;
  }
  return isTransactionalDraftDocumentType(docType) ? docType : null;
}

/**
 * R-DRAFT-NSP-QUALITY P2 notice + P3 agreement — transactional comprehensive counsel
 * stays on single-shot specialist (Sonnet-first, transactional prompts), not Queen swarm.
 */
export function shouldSkipQueenForTransactionalCounselDraft(
  req: Request,
  taskType?: string,
): boolean {
  const tt = String(taskType || (req.body as Record<string, unknown>)?.taskType || '').trim();
  if (!isPartnerCounselOrDraftTask(tt)) return false;
  if (isPartnerExplicitFastAlias(tt)) return false;
  if (/agentic$/i.test(tt)) return false;
  if (!resolvePartnerTransactionalCounselDocumentType(req, tt)) return false;
  return wantsPartnerQualityQueenPath(req, tt) || wantsNspNymBestOutcome(req);
}

/** Validate documentType on partner draft taskTypes — returns error message or null. */
export function validatePartnerDraftDocumentType(req: Request, taskType?: string): string | null {
  applyPartnerDraftDocumentTypeInference(req, taskType);
  return null;
}

type PartnerDraftDocumentTypeRequest = Request & {
  _nyvDraftDocumentTypeResolution?: DraftDocumentTypeResolution;
};

/**
 * NV-DOCUMENT-TYPE-INFERENCE-001 — resolve missing/unknown partner documentType
 * instead of HTTP 400. Mutates `parameters.documentType` on the request body.
 */
export function applyPartnerDraftDocumentTypeInference(
  req: Request,
  taskType?: string,
): DraftDocumentTypeResolution | null {
  const tt = String(taskType || (req.body as Record<string, unknown>)?.taskType || '');
  if (!isPartnerDraftTaskType(tt)) return null;

  const body = (req.body || {}) as Record<string, unknown>;
  const params = body.parameters && typeof body.parameters === 'object'
    ? (body.parameters as Record<string, unknown>)
    : {};

  const resolution = resolveDraftDocumentTypeWithMeta({
    documentType: params.documentType ?? body.documentType,
    draftType: params.draftType ?? body.draftType,
    template: params.template ?? body.template,
    taskType: tt,
    prompt: String(body.prompt || params.instruction || ''),
    parameters: params,
  });

  if (!body.parameters || typeof body.parameters !== 'object') {
    body.parameters = {};
  }
  (body.parameters as Record<string, unknown>).documentType = resolution.documentType;
  (req as PartnerDraftDocumentTypeRequest)._nyvDraftDocumentTypeResolution = resolution;

  if (resolution.wasInferred) {
    logger.info('NV-DOCUMENT-TYPE-INFERENCE-001 documentType inferred', {
      taskType: tt,
      source: resolution.source,
      documentType: resolution.documentType,
      rawInputLen: resolution.rawInput ? resolution.rawInput.length : 0,
    });
  }

  return resolution;
}

export function getPartnerDraftDocumentTypeResolution(
  req: Request,
): DraftDocumentTypeResolution | undefined {
  return (req as PartnerDraftDocumentTypeRequest)._nyvDraftDocumentTypeResolution;
}

/**
 * NV-PARTNER-AI-LOG-001 — secret-free per-request partner-AI audit fields.
 *
 * Reads only already-resolved request state (taskType, the doc-type resolution
 * stashed by {@link applyPartnerDraftDocumentTypeInference}, filing provenance,
 * platform code). NV-SECRETS-001: never includes the prompt body. Consumed by
 * the usage-metering middleware to enrich the durable `sdk_usage_metering` row.
 *
 * Returns `undefined` when there is nothing partner-AI-specific to log (keeps
 * non-partner rows lean).
 */
export function buildPartnerAiRequestMeta(
  req: Request,
): Record<string, unknown> | undefined {
  const body = (req.body || {}) as Record<string, unknown>;
  const taskType = String(body.taskType || '').trim();
  const resolution = getPartnerDraftDocumentTypeResolution(req);
  const platformCode = resolvePartnerPlatformHint(req);

  // Only emit for partner counsel/draft work or when a doc-type was resolved.
  const isPartnerAi = !!resolution || isPartnerCounselOrDraftTask(taskType);
  if (!isPartnerAi) return undefined;

  const params = body.parameters && typeof body.parameters === 'object'
    ? (body.parameters as Record<string, unknown>)
    : {};
  const filingContext = params.filingContext && typeof params.filingContext === 'object'
    ? (params.filingContext as Record<string, unknown>)
    : {};
  const filingBookRowId =
    (typeof body.filingBookRowId === 'string' && body.filingBookRowId)
    || (typeof params.filingBookRowId === 'string' && params.filingBookRowId)
    || (typeof filingContext.filingBookRowId === 'string' && filingContext.filingBookRowId)
    || null;

  const url = req.originalUrl || req.url || '';
  const mode = /\/stream(\b|\/|$)/.test(url) ? 'stream' : 'sync';

  const meta: Record<string, unknown> = {
    taskType: taskType || null,
    partnerPlatformCode: platformCode,
    mode,
    filingBookRowId,
  };
  if (resolution) {
    meta.resolvedDocType = resolution.documentType;
    meta.intentSource = resolution.source;
    meta.intentConfidence = resolution.confidence;
    meta.wasInferred = resolution.wasInferred;
    if (resolution.nvTemplateKey) meta.nvTemplateKey = resolution.nvTemplateKey;
  }
  return meta;
}

/**
 * NV-PARTNER-SYNC-TASKTYPE-001 — when NSP/partner sends bare counsel taskType with a sync
 * budget, route to the matching `-fast` specialist alias. Queen / `-deep` paths unchanged.
 */
export function resolvePartnerTaskTypeForSyncBudget(req: Request, taskType?: string): string {
  const tt = String(taskType || (req.body as Record<string, unknown>)?.taskType || '').trim();
  if (!tt || isPartnerExplicitFastAlias(tt) || wantsPartnerQualityQueenPath(req, tt)) return tt;
  if (!hasPartnerSyncTimeoutBudget(req)) return tt;
  if (/^legal[_-]?chat$/i.test(tt)) return 'legal-chat-fast';
  if (/^legal[_-]?draft$/i.test(tt)) return 'legal-draft-fast';
  if (/^doc[_-]?draft$/i.test(tt)) return 'doc-draft-fast';
  if (/^document[_-]?draft(?:ing)?$/i.test(tt)) return 'document-draft-fast';
  return tt;
}

/** Mutates req.body.taskType when sync budget implies a -fast alias; returns effective taskType. */
export function applyPartnerSyncTaskTypeAlias(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object') return '';
  const original = String(body.taskType || '').trim();
  const resolved = resolvePartnerTaskTypeForSyncBudget(req, original);
  if (resolved && resolved !== original) {
    body._nyvTaskTypeRoutedFrom = original;
    body.taskType = resolved;
  }
  return String(body.taskType || original);
}

/**
 * NV-FAST-CHAT-NORAG-001 — skip vector RAG on `-fast` chat when the caller
 * attached no documents and did not explicitly opt into RAG.
 */
export function shouldSkipRagForPartnerFastChat(
  taskType: string | undefined,
  hasDocumentPayload: boolean,
  enableRAG?: boolean,
): boolean {
  if (!isPartnerExplicitFastChatAlias(taskType)) return false;
  if (hasDocumentPayload) return false;
  if (enableRAG === true) return false;
  return true;
}

/**
 * NV-FAST-DRAFT-NORAG-001 — skip vector RAG on `-fast` draft when the caller
 * attached no documents and did not explicitly opt into RAG. Doc-less draft
 * prompts (Describe & Generate, one-line prayers) were paying the partner RAG
 * floor (~8–45s) for citations that cannot exist without a source document.
 */
export function shouldSkipRagForPartnerFastDraft(
  taskType: string | undefined,
  hasDocumentPayload: boolean,
  enableRAG?: boolean,
  draftLength?: string,
): boolean {
  if (!isPartnerExplicitFastDraftAlias(taskType)) return false;
  if (hasDocumentPayload) return false;
  if (enableRAG === true) return false;
  if (String(draftLength || '').toLowerCase() === 'comprehensive') return false;
  return true;
}

/**
 * NV-FAST-COT-OFF-001 — explicit `-fast` aliases force CoT off. A partner
 * sending `enableCoT: true` on `legal-draft-fast` must not re-enable the
 * multi-minute reasoning path the alias exists to avoid.
 */
export function resolvePartnerDispatchEnableCoT(
  taskType: string | undefined,
  bestQualityEnableCoT: boolean,
  adaptiveRequireCoT?: boolean,
): boolean {
  if (isPartnerExplicitFastAlias(taskType)) return false;
  return !!(adaptiveRequireCoT || bestQualityEnableCoT);
}

/**
 * NV-FAST-SERVING-TIER-001 — `-fast` aliases route to lite/plus cascade (Haiku-first)
 * instead of enterprise Sonnet-first, while bare counsel tasks keep enterprise depth.
 */
export function resolvePartnerFastLlmTier(req: Request, taskType?: string): string | null {
  if (!isPartnerExplicitFastAlias(taskType)) return null;
  const tier = String(process.env.NYV_PARTNER_FAST_SERVING_TIER || 'plus').trim() || 'plus';
  return tier;
}

/**
 * NV-SLA-FAST-TASKTYPE-001 — taskType-only SLA fast detector (no Request).
 * Used by nv-client context budgets and token floors where `req` is unavailable.
 */
export function isSlaFastTaskType(taskType?: string): boolean {
  const tt = String(taskType || '').trim();
  if (!tt) return false;
  if (isPartnerExplicitFastAlias(tt)) return true;
  return /^(web[_-]?search|trending|market[_-]?intel(?:ligence)?|workflow[_-]?suggest|workflow|task[_-]?assist|project[_-]?manag(?:er|ement)?|evaluate[_-]?draft|scorecard|drafting)$/i.test(tt);
}

/**
 * NV-NSP-COUNSEL-QUEEN-001 — NSP/NYM Legal Chat + drafts use Queen + CoT +
 * maker-checker (comprehensive counsel). Default ON.
 * Escape: NYV_NSP_COUNSEL_QUEEN=0 restores grounded-fast (~15–45s, no Queen).
 */
export function wantsNspCounselQueen(req: Request): boolean {
  if (!wantsNspNymBestOutcome(req)) return false;
  const v = String(process.env.NYV_NSP_COUNSEL_QUEEN ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

/**
 * SLA sync surfaces (Hub web-search, workflow ai-suggest, trending) must not
 * burn Queen + full RAG under partner sync budgets (~60–90s). Detected from
 * taskType / tools / body flags.
 *
 * NV-NSP-COUNSEL-QUEEN-001: legal-chat / legal-draft are NOT SLA-fast when
 * counsel-Queen is ON (default). Escape NYV_NSP_COUNSEL_QUEEN=0 to restore
 * grounded-fast. Deep aliases `legal-draft-deep` / `doc-draft-deep` always Queen.
 */
export function isPartnerSlaFastTask(
  req: Request,
  opts?: { taskType?: string; agentKey?: string },
): boolean {
  const body = (req.body || {}) as Record<string, unknown>;
  const tt = String(opts?.taskType ?? body.taskType ?? '');
  const toolsRaw = body.tools;
  const tools = Array.isArray(toolsRaw)
    ? toolsRaw.map((t) => String(t).toLowerCase())
    : typeof toolsRaw === 'string'
      ? [toolsRaw.toLowerCase()]
      : [];
  if (tools.some((t) => /web[-_]?search|legal[-_]?database|serp|tavily/.test(t))) return true;
  /**
   * NV-DRAFT-FAST-SLA-001 — an explicit `-fast` alias is a caller contract and
   * must be honoured before the counsel-Queen default is applied.
   *
   * The defect this fixes: `isPartnerCounselOrDraftTask()` matches the `-fast`
   * variants too (`legal[_-]?draft([_-]?fast)?`), so the guard below returned
   * false for `legal-draft-fast` and the explicit SLA was discarded. The request
   * then took the full best-outcome depth — measured at 84.8s on jrx-staging for a
   * Written Statement — while NSP was asking for `-fast` precisely to stay inside
   * its sync budget. NSP surfaced the overrun as
   * "Draft generation timed out. Please retry."
   *
   * Note the regex on the line after the guard already lists
   * `legal[_-]?chat[_-]?fast|legal[_-]?draft[_-]?fast|doc[_-]?draft(?:[_-]?fast)?`
   * as SLA-fast — those alternatives were unreachable dead branches, because the
   * counsel guard returned first. That dead code is the evidence the original
   * intent was for `-fast` to be fast; only the ordering was wrong.
   *
   * This follows the existing NV-CALLER-FLAG-CONTRACT-001 principle: best-outcome
   * raises defaults for callers that said nothing, but must not overrule a caller
   * that stated an explicit choice. Bare `legal-draft` / `legal-chat` are
   * unchanged and still get full Queen + CoT; `-deep` still always gets Queen.
   */
  if (isPartnerExplicitFastAlias(tt)) return true;
  if (wantsNspCounselQueen(req) && isPartnerCounselOrDraftTask(tt)) {
    return false;
  }
  /* Hub / scorecard SLA. Counsel/draft only match when counsel-Queen is OFF. */
  if (/^(web[_-]?search|trending|market[_-]?intel(?:ligence)?|workflow[_-]?suggest|workflow|task[_-]?assist|project[_-]?manag(?:er|ement)?|evaluate[_-]?draft|scorecard|legal[_-]?chat[_-]?fast|legal[_-]?draft[_-]?fast|doc[_-]?draft(?:[_-]?fast)?|drafting)$/i.test(tt)) {
    return true;
  }
  /* Bare partnerSyncLean is handled by wantsPartnerSyncLean (+ NYV_ALLOW_NSP_NYM_LEAN).
   * Do not treat the flag alone as SLA here — that would bypass best-outcome Queen for all lean opts. */
  const agent = String(opts?.agentKey ?? body.agentKey ?? '').toLowerCase();
  if (agent === 'legal-project-manager' && /workflow|suggest|intake/i.test(tt + String(body.prompt || '').slice(0, 80))) {
    return true;
  }
  if (agent === 'legal-researcher' && /^(web[_-]?search|legal[_-]?research|research)$/i.test(tt)) {
    return true;
  }
  return false;
}

/**
 * Pure SERP / Hub sync tasks — skip vector RAG (live search replaces it).
 * Counsel, draft, summarize, legal-chat-fast are NOT serp-only.
 */
export function isPartnerSerpOnlyFastTask(
  req: Request,
  opts?: { taskType?: string; agentKey?: string },
): boolean {
  const body = (req.body || {}) as Record<string, unknown>;
  const tt = String(opts?.taskType ?? body.taskType ?? '');
  const toolsRaw = body.tools;
  const tools = Array.isArray(toolsRaw)
    ? toolsRaw.map((t) => String(t).toLowerCase())
    : typeof toolsRaw === 'string'
      ? [toolsRaw.toLowerCase()]
      : [];
  if (tools.some((t) => /web[-_]?search|legal[-_]?database|serp|tavily/.test(t))) return true;
  if (/^(web[_-]?search|trending|market[_-]?intel(?:ligence)?|workflow[_-]?suggest|workflow|task[_-]?assist|project[_-]?manag(?:er|ement)?|evaluate[_-]?draft|scorecard)$/i.test(tt)) {
    return true;
  }
  return false;
}

/**
 * Force quality / intelligence flags for NSP/NYM.
 *
 * NV-CALLER-FLAG-CONTRACT-001 (2026-08): best-outcome raises *defaults* for
 * callers that said nothing; it must NOT overrule a caller that explicitly said
 * `false`. Measured defect: a partner sending `enableRAG: false` still had RAG,
 * memory, CoT and explainability forced on — so an opt-out made the request
 * slower and the prompt LARGER than the default path. An explicit boolean from
 * the caller is now a contract on every gate below. Callers that omit a flag
 * still get the full best-outcome envelope.
 *
 * Memory stays gated on a resolvable userId.
 *
 * Two SLA modes:
 * - SERP-only (web-search / workflow-suggest): no RAG/memory/CoT — live search budget.
 * - Grounded-fast (only when NYV_NSP_COUNSEL_QUEEN=0): legal-chat-fast / legal-draft-fast
 *   keep RAG + citations + memory; skip CoT/Queen (~15–45s).
 * Default: counsel/draft use full Queen + CoT (NV-NSP-COUNSEL-QUEEN-001).
 */
export function resolveNspNymBestOutcomeQuality(
  req: Request,
  opts: {
    userId?: string;
    enableRAG?: boolean;
    enableCitationVerification?: boolean;
    enableHallucinationCheck?: boolean;
    enableExplainability?: boolean;
    enableMemory?: boolean;
    enableCoT?: boolean;
    /** When true (SLA / partnerSyncLean), do not force heavy Queen-adjacent gates. */
    partnerLean?: boolean;
    taskType?: string;
    agentKey?: string;
    /** Inline doc / ragDocumentIds / filePath — when false, chat-fast may skip RAG. */
    hasDocumentPayload?: boolean;
    draftLength?: string;
  },
): PartnerBestOutcomeQuality {
  const slaFast =
    opts.partnerLean === true
    || isPartnerSlaFastTask(req, { taskType: opts.taskType, agentKey: opts.agentKey });
  const serpOnly = isPartnerSerpOnlyFastTask(req, { taskType: opts.taskType, agentKey: opts.agentKey });
  const force = wantsNspNymBestOutcome(req);

  /**
   * Only an explicit `false` overrides; `undefined` keeps the forced default.
   * Hallucination + citation verification are deliberately NOT opt-outable —
   * they are output-safety gates on a legal answer, they do not enlarge the
   * prompt, and disabling them would trade correctness for nothing.
   */
  const optedOut = (v: boolean | undefined): boolean => v === false;

  if (!force) {
    return {
      forceLegalBestOutcome: false,
      enableRAG: opts.enableRAG !== undefined ? !!opts.enableRAG : !serpOnly,
      enableCitationVerification:
        opts.enableCitationVerification !== undefined ? !!opts.enableCitationVerification : true,
      enableHallucinationCheck:
        opts.enableHallucinationCheck !== undefined ? !!opts.enableHallucinationCheck : true,
      enableExplainability: opts.enableExplainability !== undefined ? !!opts.enableExplainability : false,
      enableMemory: opts.enableMemory !== undefined ? !!opts.enableMemory && !!opts.userId : false,
      enableCoT: !!opts.enableCoT,
    };
  }
  if (slaFast) {
    /* Grounded-fast: draft-fast keeps minimal RAG for citations; chat-fast with no
     * attached documents skips RAG entirely (NV-FAST-CHAT-NORAG-001). */
    const skipChatRag = shouldSkipRagForPartnerFastChat(
      opts.taskType,
      opts.hasDocumentPayload === true,
      opts.enableRAG,
    );
    const draftLength = opts.draftLength ?? resolvePartnerDraftLength(req);
    const skipDraftRag = shouldSkipRagForPartnerFastDraft(
      opts.taskType,
      opts.hasDocumentPayload === true,
      opts.enableRAG,
      draftLength,
    );
    const keepRag = !serpOnly && !optedOut(opts.enableRAG) && !skipChatRag && !skipDraftRag;
    // NV-MEM-FAST-NORAG-001 — memory is not RAG. NV-FAST-CHAT-NORAG-001 correctly
    // skips vector retrieval on doc-less chat-fast, but coupling enableMemory to
    // keepRag silently dropped partner `enableMemory:true` (recall_hit=False on
    // NV-MEM-PARTNER-USER-001 probe). Explicit true/false stays a contract; when
    // the caller omits the flag, lean SLA paths keep memory off with RAG.
    const enableMemory = !!opts.userId && (
      opts.enableMemory === true ? true
        : optedOut(opts.enableMemory) ? false
          : keepRag
    );
    return {
      forceLegalBestOutcome: true,
      enableRAG: keepRag,
      enableCitationVerification: true,
      enableHallucinationCheck: true,
      enableExplainability: false,
      enableMemory,
      enableCoT: false,
    };
  }
  return {
    forceLegalBestOutcome: true,
    enableRAG: !optedOut(opts.enableRAG),
    enableCitationVerification: true,
    enableHallucinationCheck: true,
    enableExplainability: !optedOut(opts.enableExplainability),
    enableMemory: !!opts.userId && !optedOut(opts.enableMemory),
    enableCoT: !optedOut(opts.enableCoT),
  };
}

/**
 * Opt-in lean sync path: body.partnerSyncLean / header X-NYV-Partner-Sync-Lean=1
 * plus extract/analyze-style taskType. Default for NYV-dependent platforms is FULL Queen.
 * SLA fast tasks (web-search / workflow-suggest) always lean — even for NSP/NYM —
 * so Hub / workflows never burn 90s+ on Queen+RAG.
 * Other lean opts still need NYV_ALLOW_NSP_NYM_LEAN=1 under best-outcome.
 */
export function wantsPartnerSyncLean(
  req: Request,
  opts: { explicitAgentKey?: string; taskType?: string },
): boolean {
  if (isPartnerSlaFastTask(req, { taskType: opts.taskType, agentKey: opts.explicitAgentKey })) {
    return true;
  }
  if (wantsNspNymBestOutcome(req)) {
    const allowLean = String(process.env.NYV_ALLOW_NSP_NYM_LEAN || '0').trim() === '1';
    if (!allowLean) return false;
  }
  const body = req.body as Record<string, unknown> | undefined;
  const header = String(req.headers['x-nyv-partner-sync-lean'] ?? '').toLowerCase();
  const opted =
    body?.partnerSyncLean === true
    || header === '1'
    || header === 'true';
  if (!opted) return false;
  if (!opts.explicitAgentKey) return false;
  const tt = String(opts.taskType || '');
  return !tt || /extract|analysis|analy[sz]e|clause|classify|summar|case|document/i.test(tt);
}

/** True when this request is from Jurexio Professional (NSP / NSPM). */
export function isNspPlatformRequest(req: Request): boolean {
  const code = resolvePartnerPlatformHint(req);
  return code === 'NSP' || code === 'NSPM';
}

/**
 * NV-NSP-UNLIMITED-001 — NSP (any user / any org SDK key) skips product RPM,
 * org AI rate limits, credit/hourly caps, and daily token budgets.
 * Default ON. Escape: NYV_NSP_UNLIMITED=0. Safety ring / consent unchanged.
 */
export function wantsNspUnlimited(req: Request): boolean {
  if (!isNspPlatformRequest(req)) return false;
  const v = String(process.env.NYV_NSP_UNLIMITED ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

/**
 * NV-PARTNER-DEMO-UNLIMITED-001 — Ecosystem partners skip product credit/hourly
 * caps and get a high maxTokens floor. NSP is always included via NV-NSP-UNLIMITED-001.
 * Default ON when best-outcome is active. Escape: NYV_PARTNER_DEMO_UNLIMITED=0
 * (does not disable NSP unlimited unless NYV_NSP_UNLIMITED=0).
 * Safety ring / consent / secrets guards remain enforced.
 */
export function wantsPartnerDemoUnlimited(req: Request): boolean {
  if (wantsNspUnlimited(req)) return true;
  if (!wantsNspNymBestOutcome(req)) return false;
  const v = String(process.env.NYV_PARTNER_DEMO_UNLIMITED ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

/**
 * HTTP middleware / SDK gateway: skip rate-limit enforcement for NSP (and
 * partner demo-unlimited when sdkContext already identifies the platform).
 */
/** Caselaw-worker → NYV gateway (CNR SSOT); uses X-NYV-Platform: nys + server SDK key. */
export function isNyayasearchGatewayRequest(req: Request): boolean {
  const platform = String(req.headers['x-nyv-platform'] || '').trim().toLowerCase();
  if (platform !== 'nys' && !platform.includes('nyayasearch')) return false;
  const key = String(req.headers['x-api-key'] || '').trim();
  return key.length > 8;
}

export function shouldSkipPartnerProductRateLimits(req: Request): boolean {
  return (
    wantsNspUnlimited(req)
    || wantsPartnerDemoUnlimited(req)
    || isNyayasearchGatewayRequest(req)
  );
}

export interface PartnerServingProfile {
  demoUnlimited: boolean;
  /** Floor for completion tokens when body omits or under-asks maxTokens. */
  maxTokensFloor: number;
  /** Preferred SDK/LLM tier stamp for routing budgets. */
  effectiveTier: string;
}

/**
 * Token + serving profile for NSP/NYM/ecosystem AI (quality-first demo mode).
 * Env: NYV_PARTNER_MAX_TOKENS_FLOOR (default 16384), NYV_PARTNER_SERVING_TIER (default enterprise).
 */
export function resolvePartnerServingProfile(req: Request): PartnerServingProfile {
  const demoUnlimited = wantsPartnerDemoUnlimited(req);
  const floorRaw = Number(process.env.NYV_PARTNER_MAX_TOKENS_FLOOR || 16_384);
  const maxTokensFloor = Number.isFinite(floorRaw) && floorRaw > 0
    ? Math.min(128_000, Math.max(2_048, Math.floor(floorRaw)))
    : 16_384;
  const tier = String(process.env.NYV_PARTNER_SERVING_TIER || 'enterprise').trim() || 'enterprise';
  const betaFloor = betaPartnerMaxTokensFloor();
  const ecosystem = demoUnlimited || wantsNspNymBestOutcome(req);
  const partnerFloor = isBetaQualityFirst()
    ? Math.max(betaFloor, ecosystem ? maxTokensFloor : betaFloor)
    : ecosystem
      ? maxTokensFloor
      : 2_048;
  return {
    demoUnlimited,
    maxTokensFloor: partnerFloor,
    effectiveTier: demoUnlimited || isBetaQualityFirst() ? tier : 'pro',
  };
}

/**
 * NV-MEM-PARTNER-USER-001 — resolve a durable numeric user id for 5-tier memory.
 * SDK partners often omit customerUserId; fall back to body.userId / headers without
 * silently writing userId=0 to Postgres.
 */
export function resolvePartnerMemoryUserId(
  req: Request,
  body?: Record<string, unknown>,
): { userId: string | undefined; numericUserId: number | null; orgId: string | undefined } {
  const record = body && typeof body === 'object' ? body : ((req.body || {}) as Record<string, unknown>);
  const sdkCtx = (req as Request & { sdkContext?: Record<string, unknown> }).sdkContext;
  const authUser = (req as Request & { user?: { id?: string | number; userId?: string | number; orgId?: string | number; organizationId?: string | number } }).user;

  const headerUser = String(
    req.headers['x-nyv-user-id']
    ?? req.headers['x-nv-user-id']
    ?? req.headers['x-customer-user-id']
    ?? req.headers['x-user-id']
    ?? '',
  ).trim();

  const candidates: unknown[] = [
    sdkCtx?.customerUserId,
    authUser?.id,
    authUser?.userId,
    record.userId,
    headerUser || undefined,
  ];

  let userId: string | undefined;
  let numericUserId: number | null = null;
  for (const raw of candidates) {
    if (raw === undefined || raw === null || raw === '') continue;
    const str = String(raw).trim();
    if (!str || str.startsWith('sdk:')) continue;
    const n = typeof raw === 'number' ? raw : parseInt(str, 10);
    if (Number.isFinite(n) && n > 0) {
      numericUserId = n;
      userId = String(n);
      break;
    }
    if (/^\d+$/.test(str)) {
      numericUserId = parseInt(str, 10);
      userId = str;
      break;
    }
    if (!userId) userId = str;
  }

  const orgIdRaw = sdkCtx?.customerOrgId
    ?? authUser?.orgId
    ?? authUser?.organizationId
    ?? record.orgId
    ?? record.tenantId;
  const orgId = orgIdRaw === undefined || orgIdRaw === null ? undefined : String(orgIdRaw);

  return { userId, numericUserId, orgId };
}

/**
 * NV-DRAFT-LENGTH-REGISTRY-001 — per-document-type max output tokens for partner drafts.
 * Medium = registry default; low/comprehensive = range min/max. Chat-fast stays 768.
 */
export function resolvePartnerMaxOutputTokens(req: Request, requested?: number | null): number {
  const profile = resolvePartnerServingProfile(req);
  const asked = typeof requested === 'number' && Number.isFinite(requested) ? Math.floor(requested) : 0;
  if (!wantsNspNymBestOutcome(req) && !profile.demoUnlimited && !isBetaQualityFirst()) {
    return asked > 0 ? asked : 2_048;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const tt = String(optsTaskType(req) || body.taskType || '');
  const params = body.parameters && typeof body.parameters === 'object'
    ? (body.parameters as Record<string, unknown>)
    : {};
  const options = body.options && typeof body.options === 'object'
    ? (body.options as Record<string, unknown>)
    : {};

  if (isPartnerExplicitFastChatAlias(tt)) {
    const chatFastFloor = isBetaQualityFirst()
      ? betaPartnerChatFastFloor()
      : envPartnerToken('NYV_PARTNER_MAX_TOKENS_CHAT_FAST', 768);
    return Math.max(asked > 0 ? asked : 0, chatFastFloor);
  }

  if (isPartnerDraftTaskType(tt)) {
    const hasAttachments = partnerBodyHasDraftAttachments(body);
    const resolution = resolveDraftOutputTokens({
      documentType: params.documentType ?? body.documentType,
      draftType: params.draftType ?? body.draftType,
      draftLength: options.draftLength ?? body.draftLength,
      template: params.template ?? body.template,
      taskType: tt,
      prompt: String(body.prompt || resolvePartnerPrompt(body) || ''),
      parameters: params,
      options,
      body,
      hasAttachments,
    });
    const registryFloor = resolution.tokens;
    if (isPartnerExplicitFastDraftAlias(tt) && isDraftFastSlaEnabled()) {
      const draftLength = resolvePartnerDraftLength(req);
      const counselDepth = wantsPartnerQualityQueenPath(req, tt)
        || draftLength === 'comprehensive'
        || resolution.tier === 'comprehensive';
      if (counselDepth) {
        return Math.max(asked > 0 ? asked : 0, registryFloor);
      }
      let slaCap = resolveDraftFastSlaTokenCap({
        tier: resolution.tier,
        documentType: resolution.documentType,
      });
      if (resolution.attachmentBump > 0 && resolution.tier === 'medium') {
        slaCap = Math.min(
          DRAFT_TIER_TOKEN_BANDS.medium.ceiling,
          slaCap + resolution.attachmentBump,
        );
      }
      /** R-DRAFT-TOKEN-TRUTH-001 — slaCap already includes beta medium rails; do not re-clamp with min(beta, sla). */
      const floor = isBetaQualityFirst()
        ? Math.max(registryFloor, slaCap)
        : Math.min(registryFloor, slaCap);
      return Math.max(asked > 0 ? asked : 0, floor);
    }
    const envCap = isPartnerExplicitFastDraftAlias(tt)
      ? envPartnerToken('NYV_PARTNER_MAX_TOKENS_DRAFT_FAST', registryFloor)
      : registryFloor;
    const floor = Math.max(registryFloor, envCap);
    return Math.max(asked > 0 ? asked : 0, floor);
  }

  const fast =
    isPartnerSerpOnlyFastTask(req, { taskType: tt })
    || isPartnerExplicitFastAlias(tt)
    || /^(extract|summar(?:y|ize|ise)|classif(?:y|ication)|ocr|embed|parse)$/i.test(tt);
  const draft = /draft|document-draft|pleading|petition|notice|affidavit|paper-book/i.test(tt);
  const chatFloor = isBetaQualityFirst()
    ? betaPartnerChatFloor()
    : envPartnerToken('NYV_PARTNER_MAX_TOKENS_CHAT', 8_192);
  const fastFloor = isBetaQualityFirst()
    ? betaPartnerFastFloor()
    : envPartnerToken('NYV_PARTNER_MAX_TOKENS_FAST', 2_048);
  const draftFastFloor = isBetaQualityFirst()
    ? betaPartnerDraftFastFloor()
    : envPartnerToken('NYV_PARTNER_MAX_TOKENS_DRAFT_FAST', 4_096);
  const chatFastFloor = isBetaQualityFirst()
    ? betaPartnerChatFastFloor()
    : envPartnerToken('NYV_PARTNER_MAX_TOKENS_CHAT_FAST', 768);
  const floor = isPartnerExplicitFastDraftAlias(tt)
    ? draftFastFloor
    : isPartnerExplicitFastChatAlias(tt)
      ? chatFastFloor
      : fast
        ? fastFloor
        : draft
          ? profile.maxTokensFloor
          : chatFloor;
  return Math.max(asked > 0 ? asked : 0, floor);
}

/** Apply maxTokens floor for partner best-outcome / demo (never lower a higher client ask). */
export function applyPartnerMaxTokensFloor(req: Request, requested?: number | null): number {
  return resolvePartnerMaxOutputTokens(req, requested);
}

function envPartnerToken(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.min(128_000, Math.max(256, Math.floor(n))) : fallback;
}

function optsTaskType(req: Request): string {
  return String((req.body as Record<string, unknown> | undefined)?.taskType || '');
}

/**
 * NV-QUEEN-NEVER-MISS-001 — partner-facing fallback when specialist/lean path
 * returns blank content (sync unary or stream). Prevents NSP durable-worker
 * fallback on empty fast-path responses.
 */
export function buildPartnerNeverMissReply(prompt: string): string {
  return [
    'Jurexio completed this request on the resilient specialist path.',
    'Primary multi-agent synthesis was unavailable or empty; please retry for full Queen depth if needed.',
    String(prompt || '').trim() ? `Request focus: ${String(prompt).trim().slice(0, 400)}` : '',
    'This is an informational legal-AI response and not a substitute for advice from a qualified advocate.',
  ].filter(Boolean).join('\n');
}

export function ensurePartnerNeverMissContent(
  content: string,
  prompt: string,
  req: Request,
): string {
  if (String(content || '').trim()) return content;
  if (!wantsNspNymBestOutcome(req)) return content;
  return buildPartnerNeverMissReply(prompt);
}

/** Force IN on mutable query/body for India-only partners. */
export function applyIndiaOnlyScopeToRequest(req: Request): void {
  if (!isIndiaOnlyPartner(req)) return;

  const ctx = (req as Request & { sdkContext?: { jurisdiction?: string; partnerPlatformCode?: string } }).sdkContext;
  if (ctx) {
    ctx.jurisdiction = 'IN';
    const code = resolvePartnerPlatformCode(req);
    if (code) ctx.partnerPlatformCode = code;
  }

  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    (req.body as Record<string, unknown>).jurisdiction = 'IN';
    delete (req.body as Record<string, unknown>).includeNonIndia;
  }

  // Express query is often a getter; mutate in place when possible.
  const q = req.query as Record<string, unknown>;
  if (q && typeof q === 'object') {
    q.jurisdiction = 'IN';
    delete q.includeNonIndia;
  }
}
