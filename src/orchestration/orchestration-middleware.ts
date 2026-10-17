/**
 * Orchestration Middleware (NYV-ORCH-MW-001).
 *
 * Pre/post ring applied to every Queen plan.
 *   PRE  : memory recall → RAG enrich
 *   POST : hallucination → bias → citation → PII vault → consent
 *          → governance → HITL → memory store → metering
 *
 * PROD fail-loud: hallucination, citation, governance, HITL, metering throw.
 * PII: throws if vault fails on detected PII. Consent: throws on explicit
 * denial only. Bias and memory store remain best-effort (audit.ok=false).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { capabilityManifest, type CapabilityContext, type CapabilityTier } from './capability-manifest.js';
import { fanInMemoryRecall, type MemoryRecallSource } from './jrx-memory-fan-in.js';
import { createLogger } from '../utils/logger.js';
import { withSpan } from '../utils/nyv-tracer.js';

const logger = createLogger('orchestration-middleware');

/**
 * NV-QUEEN-STAGE-ATTRIBUTION-001 (2026-08-16) — make the safety ring's own
 * wall-clock cost measurable per node.
 *
 * Measured defect this exists to expose: a forced-Queen swarm on jrx-staging
 * (deploy 2026-08-16T0910Z) ran 366.1s wall while its LLM calls contributed
 * only 91.3s to the critical path. The existing span tree stopped at
 * `queen.agent` (98.5s per exploration leaf), so the remaining ~90s per leaf
 * could only be inferred by differencing adjacent log timestamps — the
 * `[MemoryFanIn] recall source failed` warn happened to land 90.4s after each
 * leaf started and immediately before that leaf's LLM call. Inference is not
 * measurement; these spans turn the same number into a directly reported
 * `durationMs`.
 *
 * Deliberately reuses `withSpan` from `utils/nyv-tracer.js` — the SAME helper
 * `nv-queen-orchestrator` already uses for `queen.orchestrate` / `queen.agent`
 * — rather than adding a second timing mechanism (NV-NO-DUPLICATE-001). Spans
 * auto-parent to the ambient ALS span, so a leaf's ring stages nest under its
 * `queen.agent` span for free and `spanLatenciesByTag` aggregates them without
 * any dashboard change.
 *
 * Always-on: `startSpan` already runs its JSONL path unconditionally at
 * `logger.info` level, and the added cost is one Date.now() pair plus one log
 * line per stage — negligible against stages measured in tens of seconds.
 * Gating it behind an env flag would guarantee it is off exactly when a
 * production latency incident needs it.
 */
const MW_SPAN_OP = 'queen.mw';

/**
 * NYV-ORCH-MW-003 (Task #34): recursion guard for the safety ring.
 *
 * `withMiddleware` is the single source of truth for "user-facing answer".
 * Queen ALWAYS wraps its dispatches with it — there is NO capability-id
 * exemption allowlist. Instead, this AsyncLocalStorage tracks whether the
 * current async context is already inside a `withMiddleware` execution.
 *
 * Why: middleware-internal calls in postMiddleware (hallucination check,
 * bias check, audit.safety-verdict, etc.) go directly to
 * `capabilityManifest.invoke(...)` and so do NOT re-enter `withMiddleware`
 * by their own code path. But if any future code path were to dispatch
 * a capability through `withMiddleware` from inside the middleware itself,
 * this guard prevents redundant pre/post stages — the inner call simply
 * runs the executor.
 *
 * It is exported (read-only) so tests can assert the recursion contract,
 * and `isInsideMiddleware()` is exposed for callers that need to make
 * dispatch-time decisions without wrapping again.
 */
const middlewareReentrancy = new AsyncLocalStorage<{ depth: number }>();

export function isInsideMiddleware(): boolean {
  return (middlewareReentrancy.getStore()?.depth ?? 0) > 0;
}

export interface MiddlewareInput {
  prompt: string;
  agentKey?: string;
  tier?: CapabilityTier;
  jurisdiction?: string;
  userId?: string;
  tenantId?: string;
  requestId?: string;
  /** Domain-classified risk: drives HITL gating */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  /**
   * When true, skip Auto-RAG in preMiddleware (Queen Step-0 already fused
   * context into the prompt — avoids double NYS/tenant retrieve).
   */
  skipRag?: boolean;
  /**
   * NV-COMPLETION-DRIVEN-001 — Queen Step-0 already ran memory fan-in.
   * Per-leaf PRE must not wait another breaker budget on the same stores.
   */
  skipMemory?: boolean;
  /**
   * Partner -fast / lean: safety checks still run, but a failed optional
   * check degrades instead of throwing after the answer exists.
   */
  failOpenSafety?: boolean;
}

/** A retrieved hit from memory or RAG. We keep the shape opaque at the
 * middleware boundary; callers can narrow if they need to inspect fields. */
export type RecalledItem = Record<string, unknown> | string;

/** Capability invocation results are arbitrary JSON-shaped payloads. */
export type CapabilityPayload = Record<string, unknown>;

export interface PreContext {
  recalledMemory: RecalledItem[];
  ragHits: RecalledItem[];
  enrichedPrompt: string;
  ctx: CapabilityContext;
}

export interface PostInput {
  output: string;
  ctx: CapabilityContext;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  inputText?: string;
  tokens?: { input: number; output: number };
  model?: string;
  provider?: string;
  costUsd?: number;
  latencyMs?: number;
  success?: boolean;
  failOpenSafety?: boolean;
}

export interface PostContext {
  hallucination?: CapabilityPayload;
  bias?: CapabilityPayload;
  citation?: CapabilityPayload;
  pii?: CapabilityPayload;
  consent?: CapabilityPayload;
  governance?: CapabilityPayload;
  hitl?: CapabilityPayload;
  audit?: { ok: boolean; persisted: boolean };
  /** Ordered list of post-stage names that actually executed (for audits). */
  stagesRun?: string[];
  /** Set when fail-open swallowed a safety invoke after the answer existed. */
  degraded?: boolean;
  /**
   * Aggregate safety verdict computed after the safety stages run.
   * status='pass'    → all checks clean
   * status='review'  → one or more checks flagged for review (allowed but logged)
   * status='reject'  → at least one check produced a hard-fail (refused in PROD
   *                    when NV_SAFETY_VERDICT_MODE=enforce, default in PROD)
   * verdictId        → the audit-log record id when the verdict was persisted.
   */
  verdict?: {
    status: 'pass' | 'review' | 'reject';
    reasons: string[];
    details: Record<string, unknown>;
    enforced: boolean;
    verdictId?: string;
  };
}

const PROD = process.env.NODE_ENV === 'production';

// ──────────────────────────────────────────────────────────────────────────────
// PRE
// ──────────────────────────────────────────────────────────────────────────────

export async function preMiddleware(input: MiddlewareInput): Promise<PreContext> {
  const ctx: CapabilityContext = {
    requestId: input.requestId,
    userId: input.userId,
    tenantId: input.tenantId,
    jurisdiction: input.jurisdiction,
    tier: input.tier,
    agentKey: input.agentKey,
  };

  let recalledMemory: RecalledItem[] = [];
  let ragHits: RecalledItem[] = [];
  let enrichedPrompt = input.prompt;

  // NV-MEMORY-UNIFY-001: single recall FAN-IN across every tier-exposed memory
  // source. NV-COMPLETION-DRIVEN-001: skip when Queen Step-0 already recalled.
  try {
    if (input.skipMemory) {
      recalledMemory = [];
    } else {
    const available = new Set(
      capabilityManifest.list({ tier: input.tier ?? 'lite' }).map((c) => c.id),
    );
    const recallSources: MemoryRecallSource[] = [];
    if (available.has('memory.tiered.recall')) {
      recallSources.push({
        id: 'memory.tiered.recall',
        label: 'tiered recall',
        run: (signal) => capabilityManifest.invoke('memory.tiered.recall', { query: input.prompt, limit: 5 }, { ...ctx, signal }).then(unwrapResults),
      });
    }
    if (available.has('memory.mem0.recall')) {
      recallSources.push({
        id: 'memory.mem0.recall',
        label: 'mem0 recall',
        run: (signal) => capabilityManifest.invoke('memory.mem0.recall', { query: input.prompt, limit: 5 }, { ...ctx, signal }).then(unwrapResults),
      });
    }
    if (available.has('memory.5tier.episodic')) {
      recallSources.push({
        id: 'memory.5tier.episodic',
        label: '5-tier episodic recall',
        run: (signal) => capabilityManifest.invoke('memory.5tier.episodic', { sessionId: input.requestId ?? input.userId, limit: 10 }, { ...ctx, signal }).then(unwrapResults),
      });
    }
    if (available.has('memory.social.context')) {
      recallSources.push({
        id: 'memory.social.context',
        label: 'social context recall',
        run: (signal) => capabilityManifest.invoke('memory.social.context', { userId: input.userId, agentKey: input.agentKey, orgId: input.tenantId }, { ...ctx, signal }).then(unwrapResults),
      });
    }
    recalledMemory = await withSpan(
      'queen.mw.pre.memory',
      {
        op: MW_SPAN_OP,
        tags: {
          agentKey: input.agentKey ?? 'unknown',
          tier: input.tier ?? 'lite',
          requestId: input.requestId ?? '',
          sourceCount: recallSources.length,
          sourceIds: recallSources.map((s) => s.id).join(','),
        },
      },
      async (span) => {
        const items = await fanInMemoryRecall({
          query: input.prompt,
          userId: input.userId,
          tenantId: input.tenantId,
          jurisdiction: input.jurisdiction,
          tier: input.tier,
          agentKey: input.agentKey,
          requestId: input.requestId,
          sources: recallSources,
        });
        span.setTag('recalledCount', items.length);
        return items;
      },
    );
    }
  } catch (e: unknown) {
    logger.warn('[Middleware] memory recall failed', { error: errorMessage(e) });
  }

  // Auto-RAG enrichment — unified tier-aware router (NV-AUTO-RAG-001).
  // Skip when Queen Step-0 already fused context (skipRag) or the prompt
  // already contains an Auto-RAG / middleware [RAG] block (belt-and-suspenders).
  const ragAlreadyInPrompt =
    input.prompt.includes('--- Relevant Legal Knowledge (Auto-RAG:') ||
    input.prompt.includes('\n\n[RAG]\n');
  if (!input.skipRag && !ragAlreadyInPrompt) {
    try {
      const { autoRagRetrieve } = await import('../services/jrx-auto-rag-router.js');
      const autoRag = await withSpan(
        'queen.mw.pre.rag',
        {
          op: MW_SPAN_OP,
          tags: {
            agentKey: input.agentKey ?? 'unknown',
            tier: input.tier ?? 'lite',
            requestId: input.requestId ?? '',
          },
        },
        () => autoRagRetrieve({
          query: input.prompt,
          jurisdiction: input.jurisdiction,
          tier: input.tier ?? 'lite',
          topK: 5,
          userId: input.userId,
          tenantId: input.tenantId,
        }),
      );
      ragHits = autoRag.chunks.map((c) => ({
        content: c.content,
        source: c.source,
        score: c.score,
        layer: c.layer,
      }));
    } catch (e: unknown) {
      logger.warn('[Middleware] auto-rag failed', { error: errorMessage(e) });
    }
  }

  // Compose context block (kept short — Queen can choose to use or ignore)
  const memoryBlock = recalledMemory.length
    ? '\n\n[MEMORY]\n' + recalledMemory.slice(0, 5).map((m) => `- ${stringify(m)}`).join('\n')
    : '';
  const ragBlock = ragHits.length
    ? '\n\n[RAG]\n' + ragHits.slice(0, 5).map((m) => `- ${stringify(m)}`).join('\n')
    : '';
  enrichedPrompt = `${input.prompt}${memoryBlock}${ragBlock}`;

  return { recalledMemory, ragHits, enrichedPrompt, ctx };
}

// ──────────────────────────────────────────────────────────────────────────────
// POST
// ──────────────────────────────────────────────────────────────────────────────

export async function postMiddleware(input: PostInput): Promise<PostContext> {
  const out: PostContext = { audit: { ok: true, persisted: false }, stagesRun: [] };
  const failOpen = input.failOpenSafety === true;

  // NV-COMPLETION-DRIVEN-001 — hallucination / bias / citation are independent
  // once the answer exists. Run them together; fail-open on -fast, fail-closed
  // on counsel only after all three have been attempted.
  const safetyJobs: Array<{ name: string; required: boolean; run: () => Promise<void> }> = [
    {
      name: 'hallucination',
      required: true,
      run: async () => {
        const r = await capabilityManifest.invoke(
          'safety.hallucination-check',
          { inputText: input.inputText, outputText: input.output },
          input.ctx,
        );
        out.hallucination = asPayload(r);
        out.stagesRun!.push('hallucination');
      },
    },
    {
      name: 'citation',
      required: true,
      run: async () => {
        const r = await capabilityManifest.invoke(
          'safety.citation-verify',
          { outputText: input.output },
          input.ctx,
        );
        out.citation = asPayload(r);
        out.stagesRun!.push('citation');
      },
    },
  ];
  if (isMitraPlus(input.ctx.tier)) {
    safetyJobs.push({
      name: 'bias',
      required: false,
      run: async () => {
        const r = await capabilityManifest.invoke(
          'safety.bias-check',
          { outputText: input.output },
          input.ctx,
        );
        out.bias = asPayload(r);
        out.stagesRun!.push('bias');
      },
    });
  }

  const safetySettled = await Promise.allSettled(safetyJobs.map((job) => job.run()));
  for (let i = 0; i < safetySettled.length; i++) {
    const settled = safetySettled[i];
    const job = safetyJobs[i];
    if (settled.status === 'fulfilled') continue;
    const err = settled.reason;
    logger.warn(`[Middleware] ${job.name} check failed`, { error: errorMessage(err) });
    if (!job.required) continue;
    if (failOpen) {
      out.degraded = true;
      continue;
    }
    if (PROD) {
      if (job.name === 'citation') {
        throw new Error(
          `[Middleware] safety.citation-verify failed in production — refusing to drop grounding check: ${errorMessage(err)}`,
        );
      }
      throw err;
    }
  }

  // 4. PII scan + vault tokenization (vault is mitra+).
  try {
    const piiMatches = scanForPii(input.output);
    if (piiMatches.length > 0 && isMitraPlus(input.ctx.tier)) {
      const tokenized: Array<{ piiType: string; token: unknown }> = [];
      let actuallyVaulted = 0;
      for (const m of piiMatches.slice(0, 25)) {
        const r = await capabilityManifest.invoke(
          'safety.pii-vault',
          { op: 'tokenize', piiType: m.type, value: m.value },
          input.ctx,
        );
        tokenized.push({ piiType: m.type, token: r });
        // NYV-ORCH-MW-003 (Task #34): only count this match as "tokenized"
        // when the vault actually returned a token (not a null/failed
        // tokenization). The verdict step uses the (matched - tokenized)
        // gap to detect un-vaulted PII and reject the answer in PROD.
        if (isVaultSuccess(r)) actuallyVaulted += 1;
      }
      out.pii = { matched: piiMatches.length, tokenized: actuallyVaulted, samples: tokenized.slice(0, 5) };
      out.stagesRun!.push('pii');
    } else if (piiMatches.length > 0) {
      out.pii = { matched: piiMatches.length, tokenized: 0, samples: [] };
      out.stagesRun!.push('pii');
    }
  } catch (e: unknown) {
    logger.warn('[Middleware] PII vault failed', { error: errorMessage(e) });
    if (PROD) throw new Error(
      `[Middleware] safety.pii-vault failed in production — refusing to release un-vaulted PII: ${errorMessage(e)}`,
    );
  }

  // 5. Consent re-check (when userId set). Throw on explicit denial only.
  if (input.ctx.userId) {
    try {
      const r = await capabilityManifest.invoke(
        'compliance.consent',
        { op: 'check', consentType: 'data-processing' },
        input.ctx,
      );
      out.consent = asPayload(r);
      out.stagesRun!.push('consent');
      const granted = isConsentGranted(out.consent);
      if (PROD && granted === false) {
        throw new Error(
          `[Middleware] compliance.consent denied for user=${input.ctx.userId} (data-processing) — refusing to release output`,
        );
      }
    } catch (e: unknown) {
      const msg = errorMessage(e);
      if (msg.startsWith('[Middleware] compliance.consent denied')) throw e;
      logger.warn('[Middleware] consent check failed', { error: msg });
      if (PROD) out.audit!.ok = false;
    }
  }

  // 6. Governance / model policy. NYV-ORCH-MW-002 (round 10c): runs uniformly
  // when EITHER model or provider is present. The capability itself fails
  // loud with a structured error if both are not supplied — middleware
  // no longer silently skips governance just because metadata is partial.
  if (input.model || input.provider) {
    try {
      const r = await capabilityManifest.invoke(
        'governance.model-policy',
        { model: input.model, provider: input.provider },
        input.ctx,
      );
      out.governance = asPayload(r);
      out.stagesRun!.push('governance');
    } catch (e: unknown) {
      logger.warn('[Middleware] governance.model-policy failed', { error: errorMessage(e) });
      if (PROD) throw new Error(
        `[Middleware] governance.model-policy failed in production — refusing un-verified model use: ${errorMessage(e)}`,
      );
    }
  }

  // 7. HITL on high/critical risk.
  try {
    const risk = input.riskLevel ?? 'medium';
    if (risk === 'high' || risk === 'critical') {
      const r = await capabilityManifest.invoke(
        'hitl.queue',
        { aiOutput: input.output, riskLevel: risk },
        input.ctx,
      );
      out.hitl = asPayload(r);
      out.stagesRun!.push('hitl');
    }
  } catch (e: unknown) {
    logger.warn('[Middleware] HITL gate failed', { error: errorMessage(e) });
    if (PROD) throw e;
  }

  // 8. Memory persist (best-effort).
  try {
    await capabilityManifest.invoke(
      'memory.tiered.store',
      { content: input.output, tier: 'episodic', metadata: { agentKey: input.ctx.agentKey } },
      input.ctx,
    );
    out.stagesRun!.push('memory-store');
  } catch (e: unknown) {
    logger.warn('[Middleware] memory store failed', { error: errorMessage(e) });
    out.audit!.ok = false;
  }

  // 9. Metering / usage log (mandatory).
  try {
    await capabilityManifest.invoke(
      'metering.usage-log',
      {
        source: 'orchestration',
        inputTokens: input.tokens?.input ?? 0,
        outputTokens: input.tokens?.output ?? 0,
        model: input.model,
        provider: input.provider,
        latencyMs: input.latencyMs ?? 0,
        success: input.success ?? true,
        costUsd: input.costUsd,
      },
      input.ctx,
    );
    out.audit!.persisted = true;
    out.stagesRun!.push('metering');
  } catch (e: unknown) {
    logger.error('[Middleware] metering failed', { error: errorMessage(e), prod: PROD });
    out.audit!.ok = false;
    if (PROD) {
      throw new Error(
        `[Middleware] metering.usage-log failed in production — refusing to drop audit record: ${errorMessage(e)}`,
      );
    }
  }

  // 10. Safety verdict aggregation + persistence (Task #34 — NYV-ORCH-MW-003).
  // Computes a single pass/review/reject verdict from the safety stages so
  // the audit log carries one canonical decision per answer (not just raw
  // signals). When NV_SAFETY_VERDICT_MODE='enforce' (default in PROD), a
  // 'reject' verdict throws BEFORE the answer is released — wiring real
  // hallucination/bias/PII/consent enforcement into every Queen-dispatched
  // answer. In 'observe' mode (default in dev/test, opt-in in PROD for the
  // 7-day review window) the verdict is recorded but never blocks.
  const verdict = computeSafetyVerdict(out, input);
  const enforce = isVerdictEnforced();
  out.verdict = { ...verdict, enforced: enforce };
  try {
    const verdictRecord = await capabilityManifest.invoke(
      'audit.safety-verdict',
      {
        verdict: verdict.status,
        reasons: verdict.reasons,
        details: verdict.details,
        enforced: enforce,
        outputHash: hashOutput(input.output),
        outputLength: input.output?.length ?? 0,
        agentKey: input.ctx.agentKey,
        model: input.model,
        provider: input.provider,
        stagesRun: out.stagesRun,
      },
      input.ctx,
    );
    out.stagesRun!.push('safety-verdict');
    const recordId = (verdictRecord as { id?: string } | undefined)?.id;
    if (recordId) out.verdict!.verdictId = recordId;
  } catch (e: unknown) {
    logger.error('[Middleware] audit.safety-verdict failed', {
      error: errorMessage(e),
      prod: PROD,
    });
    out.audit!.ok = false;
    if (PROD) {
      throw new Error(
        `[Middleware] audit.safety-verdict failed in production — refusing to release answer without recorded safety verdict: ${errorMessage(e)}`,
      );
    }
  }

  if (enforce && verdict.status === 'reject') {
    throw new Error(
      `[Middleware] safety verdict=reject — refusing to release unsafe answer (reasons: ${verdict.reasons.join('; ')})`,
    );
  }

  return out;
}

/**
 * Aggregate the per-stage safety signals into a single canonical verdict.
 * Verdict rules (kept conservative — adjust here, not at call sites):
 *   - hallucination.status='flagged'                       → reject
 *   - PII detected but not tokenized (vault skipped/failed) → reject
 *   - consent denied (granted=false / revoked / withdrawn) → reject
 *   - hallucination.status='review_recommended'            → review
 *   - bias.biasScore > 0.4                                 → review
 *   - citation.unverified > 0 and no verified              → review
 *   - HITL queued (required=true)                          → review
 *   - everything else                                      → pass
 */
function computeSafetyVerdict(
  ctx: PostContext,
  input: PostInput,
): { status: 'pass' | 'review' | 'reject'; reasons: string[]; details: Record<string, unknown> } {
  const reasons: string[] = [];
  const details: Record<string, unknown> = {};
  let level: 'pass' | 'review' | 'reject' = 'pass';
  const escalate = (next: 'review' | 'reject') => {
    if (next === 'reject') level = 'reject';
    else if (level !== 'reject') level = 'review';
  };

  const hStatus = readStringField(ctx.hallucination, 'status');
  const hScore = readNumberField(ctx.hallucination, 'score');
  if (hStatus !== undefined) details.hallucinationStatus = hStatus;
  if (hScore !== undefined) details.hallucinationScore = hScore;
  if (hStatus === 'flagged') {
    escalate('reject');
    reasons.push(`hallucination.status=flagged${hScore !== undefined ? ` (groundingScore=${hScore.toFixed(2)})` : ''}`);
  } else if (hStatus === 'review_recommended') {
    escalate('review');
    reasons.push('hallucination.status=review_recommended');
  }

  const piiMatched = readNumberField(ctx.pii, 'matched') ?? 0;
  const piiTokenized = readNumberField(ctx.pii, 'tokenized') ?? 0;
  if (piiMatched > 0) {
    details.piiMatched = piiMatched;
    details.piiTokenized = piiTokenized;
    if (piiTokenized < piiMatched) {
      escalate('reject');
      reasons.push(`pii detected (${piiMatched}) without full tokenization (${piiTokenized})`);
    } else {
      escalate('review');
      reasons.push(`pii detected and tokenized (${piiTokenized})`);
    }
  }

  const consentStatus = isConsentGranted(ctx.consent);
  if (consentStatus === false) {
    escalate('reject');
    reasons.push('compliance.consent denied');
    details.consent = 'denied';
  } else if (consentStatus === true) {
    details.consent = 'granted';
  }

  const biasScore = readNumberField(ctx.bias, 'biasScore');
  if (biasScore !== undefined) {
    details.biasScore = biasScore;
    if (biasScore > 0.4) {
      escalate('review');
      reasons.push(`bias.biasScore=${biasScore.toFixed(2)}`);
    }
  }

  const citationVerified = readNumberField(ctx.citation, 'verified');
  const citationUnverified = readNumberField(ctx.citation, 'unverified');
  if (citationVerified !== undefined || citationUnverified !== undefined) {
    details.citationVerified = citationVerified ?? 0;
    details.citationUnverified = citationUnverified ?? 0;
    if ((citationUnverified ?? 0) > 0 && (citationVerified ?? 0) === 0) {
      escalate('review');
      reasons.push('citation.unverified>0 with no verified citations');
    }
  }

  const hitlRequired = readBoolField(ctx.hitl, 'required');
  if (hitlRequired === true) {
    escalate('review');
    reasons.push('hitl.queue required=true');
    details.hitlReviewId = readStringField(ctx.hitl, 'reviewId') ?? null;
  }

  if (input.success === false) {
    escalate('review');
    reasons.push('upstream success=false');
  }

  return { status: level, reasons, details };
}

function isVerdictEnforced(): boolean {
  const mode = (process.env.NV_SAFETY_VERDICT_MODE ?? '').toLowerCase();
  if (mode === 'enforce') return true;
  if (mode === 'observe') return false;
  // Default: enforce in production, observe elsewhere.
  return PROD;
}

function readStringField(o: CapabilityPayload | undefined, key: string): string | undefined {
  if (!o || typeof o !== 'object') return undefined;
  const v = (o as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

function readNumberField(o: CapabilityPayload | undefined, key: string): number | undefined {
  if (!o || typeof o !== 'object') return undefined;
  const v = (o as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function readBoolField(o: CapabilityPayload | undefined, key: string): boolean | undefined {
  if (!o || typeof o !== 'object') return undefined;
  const v = (o as Record<string, unknown>)[key];
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * Treat the pii-vault response as a successful tokenization only when the
 * vault returned a non-empty token AND did not signal failure via a
 * `vaulted: false` / `success: false` / `error: …` marker. Conservative:
 * an unrecognised shape (e.g. raw string token) is also a success.
 */
function isVaultSuccess(r: unknown): boolean {
  if (r === null || r === undefined) return false;
  if (typeof r === 'string' && r.length > 0) return true;
  if (typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  if (o.vaulted === false || o.success === false) return false;
  if (typeof o.error === 'string' && o.error.length > 0) return false;
  if ('token' in o) {
    const tok = o.token;
    if (tok === null || tok === undefined) return false;
    if (typeof tok === 'string' && tok.length === 0) return false;
  }
  return true;
}

function hashOutput(s: string | undefined): string {
  if (!s) return 'sha256:empty';
  // Lightweight non-crypto fingerprint — enough to correlate two audit
  // entries for the same output without dragging in the crypto module
  // along the hot path. Cryptographic integrity of the audit chain is
  // already provided by appendAuditRecord's hash chain.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `djb2:${(h >>> 0).toString(16)}:${s.length}`;
}

const MITRA_PLUS_TIERS: ReadonlySet<CapabilityTier> = new Set(['mitra', 'enterprise', 'sovereign', 'white-label']);
function isMitraPlus(tier: CapabilityTier | undefined): boolean {
  return tier !== undefined && MITRA_PLUS_TIERS.has(tier);
}

// PII detection (PAN, Aadhaar, GSTIN, email, phone). Vault tokenizes matches.
const PII_PATTERNS: ReadonlyArray<{ type: string; re: RegExp }> = [
  { type: 'pan',     re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
  { type: 'aadhaar', re: /\b\d{4}\s?\d{4}\s?\d{4}\b/g },
  { type: 'gstin',   re: /\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/g },
  { type: 'email',   re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: 'phone',   re: /\b(?:\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}\b/g },
];

interface PiiMatch { type: string; value: string }

function scanForPii(text: string): PiiMatch[] {
  if (!text) return [];
  const out: PiiMatch[] = [];
  for (const { type, re } of PII_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({ type, value: m[0] });
      if (out.length >= 50) return out;
    }
  }
  return out;
}

function isConsentGranted(payload: CapabilityPayload | undefined): boolean | null {
  if (!payload || typeof payload !== 'object') return null;
  const granted = (payload as Record<string, unknown>).granted;
  if (typeof granted === 'boolean') return granted;
  const status = (payload as Record<string, unknown>).status;
  if (status === 'granted' || status === 'active') return true;
  if (status === 'denied' || status === 'revoked' || status === 'withdrawn') return false;
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────────

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v).slice(0, 240); } catch { return String(v); }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Normalise a capability invocation result to an array. Capabilities
 * commonly return either an array directly or `{ results: T[] }`. We
 * tolerate either shape without an `as any` cast.
 */
function unwrapResults(r: unknown): RecalledItem[] {
  if (Array.isArray(r)) return r as RecalledItem[];
  if (r && typeof r === 'object' && 'results' in (r as Record<string, unknown>)) {
    const inner = (r as { results?: unknown }).results;
    if (Array.isArray(inner)) return inner as RecalledItem[];
  }
  return [];
}

/**
 * Coerce any capability invocation return value into a `CapabilityPayload`
 * (a string-keyed record). Primitives are wrapped under a `value` key so
 * downstream consumers always get a uniform shape without an `as any` cast.
 */
function asPayload(r: unknown): CapabilityPayload {
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    return r as CapabilityPayload;
  }
  return { value: r };
}

/**
 * Convenience wrapper for callers (Queen, DAG) that want both halves around
 * a custom executor:
 *
 *   const out = await withMiddleware(in, async ({ enrichedPrompt, ctx }) => {
 *     return await callLLM(enrichedPrompt);
 *   });
 */
export async function withMiddleware(
  input: MiddlewareInput,
  exec: (pre: PreContext) => Promise<{ output: string; tokens?: { input: number; output: number }; model?: string; provider?: string; costUsd?: number }>,
): Promise<{ output: string; pre: PreContext; post: PostContext }> {
  // NYV-ORCH-MW-003 (Task #34): if we're already inside a withMiddleware
  // frame on this async chain, treat this as a no-op pass-through. This
  // is the recursion guard that lets Queen safely wrap EVERY dispatch
  // (including capabilities like safety.* / audit.* that postMiddleware
  // itself invokes) without double-running the safety ring or causing
  // infinite recursion.
  if (isInsideMiddleware()) {
    const ctx: CapabilityContext = {
      requestId: input.requestId,
      userId: input.userId,
      tenantId: input.tenantId,
      jurisdiction: input.jurisdiction,
      tier: input.tier,
      agentKey: input.agentKey,
    };
    const passThroughPre: PreContext = {
      recalledMemory: [],
      ragHits: [],
      enrichedPrompt: input.prompt,
      ctx,
    };
    const r = await exec(passThroughPre);
    return {
      output: r.output,
      pre: passThroughPre,
      post: { stagesRun: ['__reentrant_skip__'] },
    };
  }
  return middlewareReentrancy.run({ depth: 1 }, async () => {
    const start = Date.now();
    /* NV-QUEEN-STAGE-ATTRIBUTION-001 — split the ring into its three
     * accountable legs (pre / exec / post) so a node's wall clock can be
     * attributed without differencing log timestamps. `exec` is the only leg
     * that contains the LLM call, so `pre + post` is exactly the ring overhead
     * that `llm.latency_ms` never counts. */
    const pre = await withSpan(
      'queen.mw.pre',
      {
        op: MW_SPAN_OP,
        tags: {
          agentKey: input.agentKey ?? 'unknown',
          tier: input.tier ?? 'lite',
          requestId: input.requestId ?? '',
          skipRag: input.skipRag === true,
          skipMemory: input.skipMemory === true,
        },
      },
      () => preMiddleware(input),
    );
    const r = await withSpan(
      'queen.mw.exec',
      {
        op: MW_SPAN_OP,
        tags: { agentKey: input.agentKey ?? 'unknown', requestId: input.requestId ?? '' },
      },
      () => exec(pre),
    );
    const post = await withSpan(
      'queen.mw.post',
      {
        op: MW_SPAN_OP,
        tags: {
          agentKey: input.agentKey ?? 'unknown',
          tier: input.tier ?? 'lite',
          requestId: input.requestId ?? '',
        },
      },
      async (span) => {
        const p = await postMiddleware({
          output: r.output,
          ctx: pre.ctx,
          riskLevel: input.riskLevel,
          inputText: input.prompt,
          tokens: r.tokens,
          model: r.model,
          provider: r.provider,
          costUsd: r.costUsd,
          latencyMs: Date.now() - start,
          success: true,
          failOpenSafety: input.failOpenSafety === true,
        });
        span.setTag('stagesRun', (p.stagesRun ?? []).join(','));
        span.setTag('verdict', p.verdict?.status ?? 'none');
        return p;
      },
    );
    return { output: r.output, pre, post };
  });
}
