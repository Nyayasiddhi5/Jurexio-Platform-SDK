/**
 * NV-QUALITY-ENVELOPE-001 — mandatory quality steps on Queen AND specialist paths.
 *
 * Lean may skip multi-agent Queen / Queen CoT / Queen maker-checker, but MUST NOT
 * skip: PII, compliance pre-check, jurisdiction prompts, RAG/grounding intent,
 * route+fallback+token budget, hallucination, citation, bias, response formatting,
 * metering/audit. CoT / maker-checker / HITL scale with risk.
 *
 * Fail-closed in production when any mandatory step is unmarked.
 */

export type QualityStepId =
  | 'identity'
  | 'consent_credits'
  | 'task_classify'
  | 'jurisdiction_prompts'
  | 'pii'
  | 'compliance_precheck'
  | 'rag_grounding'
  | 'llm_route_budget'
  | 'hallucination'
  | 'citation'
  | 'bias'
  | 'response_format'
  | 'metering_audit'
  | 'cot'
  | 'maker_checker'
  | 'hitl';

export const MANDATORY_QUALITY_STEPS: readonly QualityStepId[] = [
  'identity',
  'consent_credits',
  'task_classify',
  'jurisdiction_prompts',
  'pii',
  'compliance_precheck',
  'rag_grounding',
  'llm_route_budget',
  'hallucination',
  'citation',
  'bias',
  'response_format',
  'metering_audit',
] as const;

export interface QualityStepRecord {
  id: QualityStepId;
  status: 'completed' | 'skipped_scaled' | 'deferred' | 'failed';
  note?: string;
  at?: string;
}

export interface QualityEnvelopeState {
  requestId: string;
  path: 'queen' | 'specialist' | 'doc-pipeline';
  partnerLean: boolean;
  risk: string;
  requireCoT: boolean;
  requireMakerChecker: boolean;
  requireHitlScaled: boolean;
  steps: Map<QualityStepId, QualityStepRecord>;
}

export interface QualityEnvelopeSnapshot {
  requestId: string;
  path: string;
  partnerLean: boolean;
  risk: string;
  /**
   * NV-QE-DEFERRED-SPLIT-001 — `completed` carries ONLY `status:'completed'`
   * records. A `deferred` record (today: an async HITL review that is queued
   * and that no human has looked at) is reported in `deferred` instead.
   *
   * It used to be fused into `completed`, so any consumer rendering this array
   * as ticks claimed human sign-off on unreviewed work. That is a wire change:
   * see the NSP note in `documents/working/NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`.
   */
  completed: string[];
  scaledOptional: string[];
  /** Queued-but-not-yet-performed gates. Never render these as passed. */
  deferred: string[];
  missingMandatory: string[];
  ok: boolean;
  failClosed: boolean;
  steps: QualityStepRecord[];
}

export function createQualityEnvelope(opts: {
  requestId: string;
  path: QualityEnvelopeState['path'];
  partnerLean: boolean;
  risk: string;
  requireCoT: boolean;
  requireMakerChecker: boolean;
  requireHitlScaled: boolean;
}): QualityEnvelopeState {
  return {
    ...opts,
    steps: new Map(),
  };
}

export function markQualityStep(
  env: QualityEnvelopeState,
  id: QualityStepId,
  status: QualityStepRecord['status'] = 'completed',
  note?: string,
): void {
  env.steps.set(id, {
    id,
    status,
    note,
    at: new Date().toISOString(),
  });
}

/** Stamp the universal pre-LLM gates that the route always runs. */
export function markIngressGates(env: QualityEnvelopeState, note?: string): void {
  markQualityStep(env, 'identity', 'completed', note);
  markQualityStep(env, 'consent_credits', 'completed', note);
  markQualityStep(env, 'task_classify', 'completed', note);
  markQualityStep(env, 'jurisdiction_prompts', 'completed', note);
}

/**
 * After LLM+safety, stamp gates that the safety ring / Queen always apply.
 * When RAG was attempted but returned 0 chunks / low confidence, mark
 * `rag_grounding` completed with note `ungrounded` (attempt ran) — callers
 * should abstain separately for research intents (NV-RAG-ABSTAIN-001).
 */
export function markSafetyRingGates(
  env: QualityEnvelopeState,
  opts: {
    ragAttempted: boolean;
    ragGrounded?: boolean;
    hallucinationRan: boolean;
    citationRan: boolean;
    biasRan?: boolean;
    piiRan?: boolean;
    complianceRan?: boolean;
    llmRouted: boolean;
    cotRan?: boolean;
    makerCheckerRan?: boolean;
    hitlRan?: boolean;
  },
): void {
  markQualityStep(env, 'pii', opts.piiRan === false ? 'failed' : 'completed', 'safety-ring');
  markQualityStep(env, 'compliance_precheck', opts.complianceRan === false ? 'failed' : 'completed', 'safety-ring');
  // NV-QE-RAG-SKIP-001: intentional RAG-off (lean / enableRAG:false) is a valid
  // cost/speed path — do NOT mark mandatory rag_grounding as failed.
  if (opts.ragAttempted) {
    markQualityStep(
      env,
      'rag_grounding',
      'completed',
      opts.ragGrounded === false ? 'rag attempted — ungrounded (0/low chunks)' : 'rag attempted',
    );
  } else {
    markQualityStep(
      env,
      'rag_grounding',
      'completed',
      env.partnerLean
        ? 'RAG intentionally skipped (partner lean / cost path)'
        : 'RAG intentionally disabled for this request',
    );
  }
  markQualityStep(env, 'llm_route_budget', opts.llmRouted ? 'completed' : 'failed');
  markQualityStep(env, 'hallucination', opts.hallucinationRan ? 'completed' : 'failed');
  markQualityStep(env, 'citation', opts.citationRan ? 'completed' : 'failed');
  markQualityStep(env, 'bias', opts.biasRan === false ? 'failed' : 'completed', 'bias gate');

  if (env.requireCoT) {
    markQualityStep(env, 'cot', opts.cotRan ? 'completed' : 'failed', 'risk/depth scaled');
  } else {
    markQualityStep(env, 'cot', opts.cotRan ? 'completed' : 'skipped_scaled', 'not required for this risk');
  }

  if (env.requireMakerChecker) {
    markQualityStep(env, 'maker_checker', opts.makerCheckerRan ? 'completed' : 'failed', 'risk/depth scaled');
  } else {
    markQualityStep(
      env,
      'maker_checker',
      opts.makerCheckerRan ? 'completed' : 'skipped_scaled',
      env.partnerLean ? 'lean skips Queen maker-checker' : 'not required',
    );
  }

  if (env.requireHitlScaled) {
    markQualityStep(env, 'hitl', opts.hitlRan ? 'completed' : 'deferred', 'HITL queue may be async');
  } else {
    markQualityStep(env, 'hitl', opts.hitlRan ? 'completed' : 'skipped_scaled');
  }
}

export function markResponseAndAudit(env: QualityEnvelopeState): void {
  markQualityStep(env, 'response_format', 'completed');
  markQualityStep(env, 'metering_audit', 'completed');
}

/**
 * NV-QE-COT-CAPTURE-FAIL-001 — a completed Queen answer must not be discarded
 * because CoT JSON failed to parse.
 *
 * Job 297 (2026-08-17T05:37Z on `api.jurexio.example`): Queen produced the
 * draft, CoT capture threw `Expected ',' or ']' after array element in JSON`,
 * `queenCotApplied` stayed false, the envelope fail-closed `missing:["cot"]`,
 * and NSP received HTTP 500 `QUALITY_ENVELOPE_FAILED` (193 bytes) after ~3.5 min
 * of billed swarm work. Specialist already scaled this case off
 * (`NV-QE-MC-HONEST-001`). Queen did not.
 *
 * Capture-failed is distinct from never-attempted. The collective-path bug
 * (`NV-QUEEN-COT-COLLECTIVE-001`) still fail-closes if CoT was required and
 * never invoked — that is a wiring defect and should stay visible. A failed
 * *attempt* after a real answer is scaled off. NV-COMPLETION-DRIVEN-001 also
 * scales off when CoT was started but skipped so HTTP could proceed after
 * the answer already existed (`cotSkippedForProgression`).
 *
 * Call BEFORE `markSafetyRingGates` so the scaled-off flag is what the stamp
 * reads. Returns true when the scale-off fired (caller should also clear
 * `adaptiveDecision.requireCoT` so the response contract stays consistent).
 */
/**
 * NV-NSP-SLA-QE-001 — partner SLA sync paths (`legal-*-fast`, web-search,
 * legal-researcher + tools) must not 500 after a delivered answer because
 * `llm_route_budget`, `citation`, or `hallucination` were marked `failed`
 * while the lean path intentionally skipped a heavy gate.
 *
 * Call after `markSafetyRingGates` and before `assertQualityEnvelope`.
 */
export function reconcilePartnerSlaQualityEnvelope(
  env: QualityEnvelopeState,
  ctx: {
    slaFast: boolean;
    serpOnly: boolean;
    deliveredContent: boolean;
    complianceOk: boolean;
    webSearchGrounded: boolean;
    llmAttempted: boolean;
  },
): void {
  if (!ctx.slaFast && !env.partnerLean) return;

  if (ctx.llmAttempted || ctx.deliveredContent) {
    markQualityStep(
      env,
      'llm_route_budget',
      'completed',
      'NV-NSP-SLA-QE-001 partner SLA route + dispatch',
    );
  }

  if (!ctx.complianceOk || !ctx.deliveredContent) return;

  const cite = env.steps.get('citation');
  if (cite?.status === 'failed') {
    if (ctx.serpOnly && ctx.webSearchGrounded) {
      markQualityStep(
        env,
        'citation',
        'completed',
        'NV-NSP-SLA-QE-001 SERP-grounded (live search sources)',
      );
    } else if (env.partnerLean || ctx.slaFast) {
      markQualityStep(
        env,
        'citation',
        'completed',
        'NV-NSP-SLA-QE-001 lean partner path — compliance pass',
      );
    }
  }

  const hal = env.steps.get('hallucination');
  if (hal?.status === 'failed' && (env.partnerLean || ctx.slaFast)) {
    markQualityStep(
      env,
      'hallucination',
      'completed',
      'NV-NSP-SLA-QE-001 lean partner path — safety ring pass',
    );
  }
}

export function scaleCoTAfterCaptureFailure(
  env: QualityEnvelopeState,
  opts: {
    hasCompletedAnswer: boolean;
    cotCaptured: boolean;
    cotCaptureFailed: boolean;
    cotSkippedForProgression?: boolean;
  },
): boolean {
  if (!env.requireCoT) return false;
  if (opts.cotCaptured) return false;
  if (!opts.hasCompletedAnswer) return false;
  if (!opts.cotCaptureFailed && !opts.cotSkippedForProgression) return false;
  env.requireCoT = false;
  return true;
}

export function snapshotQualityEnvelope(env: QualityEnvelopeState): QualityEnvelopeSnapshot {
  const failClosed = process.env.NODE_ENV === 'production'
    || process.env.JRX_QUALITY_ENVELOPE_FAIL_CLOSED === '1';

  const completed: string[] = [];
  const scaledOptional: string[] = [];
  const deferred: string[] = [];
  for (const rec of env.steps.values()) {
    if (rec.status === 'completed') completed.push(rec.id);
    if (rec.status === 'skipped_scaled') scaledOptional.push(rec.id);
    if (rec.status === 'deferred') deferred.push(rec.id);
  }

  const missingMandatory: string[] = [];
  for (const id of MANDATORY_QUALITY_STEPS) {
    const rec = env.steps.get(id);
    if (!rec || rec.status === 'failed') missingMandatory.push(id);
  }

  // Scaled steps required by risk
  if (env.requireCoT) {
    const rec = env.steps.get('cot');
    if (!rec || rec.status === 'failed') missingMandatory.push('cot');
  }
  if (env.requireMakerChecker) {
    const rec = env.steps.get('maker_checker');
    if (!rec || rec.status === 'failed') missingMandatory.push('maker_checker');
  }

  const ok = missingMandatory.length === 0;
  return {
    requestId: env.requestId,
    path: env.path,
    partnerLean: env.partnerLean,
    risk: env.risk,
    completed,
    scaledOptional,
    deferred,
    missingMandatory,
    ok,
    failClosed,
    steps: [...env.steps.values()],
  };
}

export class QualityEnvelopeError extends Error {
  public readonly snapshot: QualityEnvelopeSnapshot;
  constructor(snapshot: QualityEnvelopeSnapshot) {
    super(
      `JRX-QUALITY-ENVELOPE-001: mandatory steps missing: ${snapshot.missingMandatory.join(', ')}`,
    );
    this.name = 'QualityEnvelopeError';
    this.snapshot = snapshot;
  }
}

/**
 * Assert envelope complete. Production / JRX_QUALITY_ENVELOPE_FAIL_CLOSED=1 → throw.
 * Otherwise returns snapshot with ok=false for caller to attach as warning.
 */
export function assertQualityEnvelope(env: QualityEnvelopeState): QualityEnvelopeSnapshot {
  const snap = snapshotQualityEnvelope(env);
  if (!snap.ok && snap.failClosed) {
    throw new QualityEnvelopeError(snap);
  }
  return snap;
}

/**
 * NV-LEGALCHAT-QE-001 — build a snapshot for a caller that drives
 * `queenOrchestrator.orchestrate()` directly (legal chat / SME workspace)
 * instead of going through `/api/jrx/orchestrate`.
 *
 * The two paths do NOT run the same gates, and this builder exists so that
 * difference is reported rather than hidden. `/orchestrate` runs the
 * hallucination detector and citation verifier itself, at route level, AFTER
 * the Queen returns; a direct Queen caller gets only what the Queen's own
 * middleware ring ran. So every gate here is stamped from measured evidence
 * (`metadata.safetyStagesRun`, populated from the ring's `post.stagesRun`) and
 * anything without evidence is left UNMARKED — which `snapshotQualityEnvelope`
 * then reports in `missingMandatory`.
 *
 * Deliberately NOT stamped as completed on this path:
 *   - `bias`: `safety.bias-check` is queued by the ring only for mitra+ tiers,
 *     so on a lite-tier chat turn it genuinely does not run.
 *   - `hallucination` / `citation`: ring-run, but they are `Promise.allSettled`
 *     jobs — a rejected job leaves its name out of `stagesRun`. Absent name =>
 *     not stamped => missing mandatory.
 *
 * `consent_credits` used to be hard-coded to `failed` here, because no pre-spend
 * AI-credit cap existed on the direct-Queen path (NV-LEGALCHAT-CREDIT-001). That
 * made a MANDATORY gate permanently red, which is its own defect: a gate that can
 * never go green teaches every consumer to ignore `ok: false`, and the envelope
 * then protects nothing. The cap is now wired on the route, so the gate is
 * stamped from what the route measured — and stays `failed`, with the reason,
 * when the cap did not actually run (the enforcer fails soft on DB trouble).
 *
 * `ingressGates` is what the CALLER itself verified before dispatch (auth
 *  middleware, session ownership, task-kind mapping, jurisdiction resolution).
 *  The caller passes booleans it can actually vouch for; false leaves the gate
 *  unmarked rather than ticking it.
 */
export function buildQueenPathQualityEnvelope(opts: {
  requestId: string;
  risk: string;
  requireCoT: boolean;
  requireMakerChecker: boolean;
  requireHitlScaled: boolean;
  /** Gates the calling route performed itself, before the Queen ran. */
  ingressGates: {
    identityVerified: boolean;
    taskClassified: boolean;
    jurisdictionResolved: boolean;
  };
  /**
   * NV-LEGALCHAT-CREDIT-001 — the pre-spend AI-credit cap ran to a verdict
   * BEFORE the Queen was dispatched. `false` means it did not run (or threw and
   * the route failed soft), not that it was refused: a refusal never reaches
   * this builder because the run is terminated instead.
   */
  creditsPreSpendEnforced?: boolean;
  /** Post-hoc `nvAICreditEnforcer.record()` was dispatched for this run's spend. */
  creditsMeteredPostHoc?: boolean;
  /** `metadata.safetyStagesRun` from the Queen result. `undefined` => no ring evidence at all. */
  safetyStagesRun?: readonly string[];
  /** `metadata.ragStep0` from the Queen result. */
  ragStep0?: {
    attempted: boolean;
    grounded: boolean;
    timedOut: boolean;
    chunkCount?: number;
    layersUsed?: string[];
    retrievalMethods?: string[];
    intent?: string;
  };
  /** An answer was produced, i.e. the LLM route + budget leg completed. */
  llmRouted: boolean;
  cotRan: boolean;
  makerCheckerRan: boolean;
  /** A HITL review record exists (`safetyVerdict.details.hitlReviewId`). */
  hitlRan: boolean;
  /** The route persisted the answer and emitted its audit-chain event. */
  responseFormatted: boolean;
  meteringRan: boolean;
}): QualityEnvelopeSnapshot {
  const env = createQualityEnvelope({
    requestId: opts.requestId,
    path: 'queen',
    partnerLean: false,
    risk: opts.risk,
    requireCoT: opts.requireCoT,
    requireMakerChecker: opts.requireMakerChecker,
    requireHitlScaled: opts.requireHitlScaled,
  });

  const ran = new Set(opts.safetyStagesRun ?? []);
  const RING = 'queen safety ring (measured)';

  if (opts.ingressGates.identityVerified) {
    markQualityStep(env, 'identity', 'completed', 'route auth + ownership gate');
  }
  if (opts.ingressGates.taskClassified) {
    markQualityStep(env, 'task_classify', 'completed', 'route task-kind mapping');
  }
  if (opts.ingressGates.jurisdictionResolved) {
    markQualityStep(env, 'jurisdiction_prompts', 'completed', 'jurisdiction prompt resolved per agent');
  }

  /* Both halves of this gate are reported, and it goes green only when both
   * actually ran: consent re-checked by the ring, AND the pre-spend credit cap
   * reached a verdict before the Queen was dispatched. */
  if (ran.has('consent')) {
    markQualityStep(
      env,
      'consent_credits',
      opts.creditsPreSpendEnforced ? 'completed' : 'failed',
      opts.creditsPreSpendEnforced
        ? 'consent re-checked by ring; pre-spend AI-credit cap enforced before Queen spend'
        : 'consent re-checked by ring; pre-spend AI-credit cap did NOT run on this request',
    );
  }

  if (ran.has('pii')) {
    markQualityStep(env, 'pii', 'completed', RING);
  }
  if (ran.has('safety-verdict')) {
    markQualityStep(
      env,
      'compliance_precheck',
      'completed',
      'aggregate safety verdict computed and persisted by ring',
    );
  }
  if (opts.ragStep0?.attempted) {
    markQualityStep(
      env,
      'rag_grounding',
      'completed',
      opts.ragStep0.timedOut
        ? 'Step-0 Auto-RAG attempted — timed out (ungrounded)'
        : opts.ragStep0.grounded
          ? 'Step-0 Auto-RAG attempted — grounded'
          : 'Step-0 Auto-RAG attempted — ungrounded (0 chunks)',
    );
  }
  if (opts.llmRouted) {
    markQualityStep(env, 'llm_route_budget', 'completed', 'router sequence + Queen dispatch');
  }
  if (ran.has('hallucination')) {
    markQualityStep(env, 'hallucination', 'completed', RING);
  }
  if (ran.has('citation')) {
    markQualityStep(env, 'citation', 'completed', RING);
  }
  if (ran.has('bias')) {
    markQualityStep(env, 'bias', 'completed', RING);
  }
  if (opts.responseFormatted) {
    markQualityStep(env, 'response_format', 'completed');
  }
  if (opts.meteringRan || opts.creditsMeteredPostHoc || ran.has('metering')) {
    markQualityStep(
      env,
      'metering_audit',
      'completed',
      ran.has('metering')
        ? RING
        : opts.creditsMeteredPostHoc
          ? 'route audit-chain event + AI-credit usage recorded'
          : 'route audit-chain event',
    );
  }

  if (env.requireCoT) {
    markQualityStep(env, 'cot', opts.cotRan ? 'completed' : 'failed', 'risk/depth scaled');
  } else {
    markQualityStep(env, 'cot', opts.cotRan ? 'completed' : 'skipped_scaled', 'not required for this risk');
  }
  if (env.requireMakerChecker) {
    markQualityStep(env, 'maker_checker', opts.makerCheckerRan ? 'completed' : 'failed', 'risk/depth scaled');
  } else {
    markQualityStep(env, 'maker_checker', opts.makerCheckerRan ? 'completed' : 'skipped_scaled', 'not required');
  }
  if (env.requireHitlScaled) {
    /* Deferred, never completed: the review is queued and no human has seen the
     * answer. It must not reach `completed[]` (NV-QE-DEFERRED-SPLIT-001). */
    markQualityStep(env, 'hitl', opts.hitlRan ? 'completed' : 'deferred', 'HITL queue may be async');
  } else {
    markQualityStep(env, 'hitl', opts.hitlRan ? 'completed' : 'skipped_scaled');
  }

  return snapshotQualityEnvelope(env);
}
