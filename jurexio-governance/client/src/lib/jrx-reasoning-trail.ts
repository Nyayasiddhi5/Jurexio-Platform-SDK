/**
 * NV-REASONING-TRAIL-001 — client projection of the server `qualityEnvelope`.
 *
 * Source of truth for the wire shape: `src/orchestration/jrx-quality-envelope.ts`
 * (`QualityEnvelopeSnapshot`, `QualityStepRecord`) surfaced by
 * `buildUnifiedOrchestrationContract` in
 * `src/orchestration/jrx-orchestration-response-contract.ts`.
 *
 * Everything here is deliberately pure so the four-state decision can be unit
 * tested and mutated without a DOM.
 *
 * Two properties of the real payload drive the whole design (both confirmed by
 * running the server module, not by reading it):
 *
 *  1. `completed[]` FUSES `completed` and `deferred` records
 *     (`snapshotQualityEnvelope` pushes both). A UI that ticks everything in
 *     `completed[]` therefore reports an async HITL review that has NOT
 *     happened as a passed gate. `steps[]` is the only honest source, so it is
 *     consulted first and the arrays are used only as a record-less fallback.
 *  2. A mandatory gate that never ran leaves NO record at all — it appears only
 *     in `missingMandatory[]`. Absence of evidence must therefore render as
 *     "not captured" / "missing", never as a pass.
 */

/** Wire statuses stamped by `markQualityStep`. */
export type NvQualityStepStatus = 'completed' | 'skipped_scaled' | 'deferred' | 'failed';

export interface NvQualityStepRecord {
  id: string;
  status: NvQualityStepStatus | string;
  note?: string;
  at?: string;
}

export interface NvQualityEnvelope {
  requestId?: string;
  path?: string;
  partnerLean?: boolean;
  risk?: string;
  completed?: string[];
  scaledOptional?: string[];
  missingMandatory?: string[];
  ok?: boolean;
  failClosed?: boolean;
  steps?: NvQualityStepRecord[];
}

export interface NvTrustBlock {
  grounded?: boolean;
  citationsPresent?: boolean;
  /** NV-CITE-GROUND-001 — count behind `citationsPresent`; absent on older tasks. */
  authoritiesDelivered?: number;
  qualityOk?: boolean;
  compliancePassed?: boolean;
}

/**
 * The subset of the unified orchestration contract this panel reads. Every
 * field is optional because older tasks, the legal-chat SSE wire and the
 * truncated-JSON repair path all legitimately omit parts of it.
 */
export interface NvReasoningTrailSource {
  qualityEnvelope?: NvQualityEnvelope | null;
  routing?: {
    path?: string;
    reason?: string;
    complexity?: string;
    risk?: string;
  } | null;
  layersUsed?: string[] | null;
  trust?: NvTrustBlock | null;
  riskBadge?: string | null;
  auditHash?: string | null;
  requestPhase?: string | null;
  chainOfThought?: unknown;
  model?: string | null;
  provider?: string | null;
  latencyMs?: number | null;
}

/**
 * Five rendering states, not four.
 *
 * `deferred` is split out from `passed` on purpose: HITL is stamped `deferred`
 * when the human review is queued asynchronously, and the server folds that
 * into `completed[]`. Collapsing it into `passed` would tell a reviewing lawyer
 * that a human signed off on work no human has looked at yet.
 */
export type NvStageState =
  | 'passed'
  | 'scaled_off'
  | 'deferred'
  | 'failed'
  | 'missing_mandatory'
  | 'not_captured';

export interface NvTrailStage {
  id: string;
  label: string;
  state: NvStageState;
  /** Mandatory per `MANDATORY_QUALITY_STEPS`, or promoted by risk (cot / maker_checker). */
  mandatory: boolean;
  note?: string;
  at?: string;
}

/** Mirrors `MANDATORY_QUALITY_STEPS` + the three risk-scaled optionals, in wire order. */
const CANONICAL_STAGES: ReadonlyArray<{ id: string; label: string; mandatory: boolean }> = [
  { id: 'identity', label: 'Identity', mandatory: true },
  { id: 'consent_credits', label: 'Consent & credits', mandatory: true },
  { id: 'task_classify', label: 'Task classification', mandatory: true },
  { id: 'jurisdiction_prompts', label: 'Jurisdiction prompts', mandatory: true },
  { id: 'pii', label: 'PII redaction', mandatory: true },
  { id: 'compliance_precheck', label: 'Compliance pre-check', mandatory: true },
  { id: 'rag_grounding', label: 'RAG grounding', mandatory: true },
  { id: 'llm_route_budget', label: 'Route & token budget', mandatory: true },
  { id: 'hallucination', label: 'Hallucination check', mandatory: true },
  { id: 'citation', label: 'Citation verification', mandatory: true },
  { id: 'bias', label: 'Bias gate', mandatory: true },
  { id: 'response_format', label: 'Response formatting', mandatory: true },
  { id: 'metering_audit', label: 'Metering & audit', mandatory: true },
  { id: 'cot', label: 'Chain of thought', mandatory: false },
  { id: 'maker_checker', label: 'Maker-checker', mandatory: false },
  { id: 'hitl', label: 'Human in the loop', mandatory: false },
];

const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  CANONICAL_STAGES.map((s) => [s.id, s.label]),
);

function humanizeStageId(id: string): string {
  const known = STAGE_LABELS[id];
  if (known) return known;
  return id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Resolve one stage to a rendering state.
 *
 * Precedence is load-bearing:
 *  - `missingMandatory` outranks any record, because it is the server's own
 *    verdict about a gate it required. A `failed` record for a mandatory gate
 *    is the same event seen from the other side, and "missing mandatory" is the
 *    label a reviewer needs.
 *  - a record's own `status` outranks the summary arrays (see `completed[]`
 *    fusing `deferred`).
 *  - `scaledOptional` is checked BEFORE the `completed[]` fallback so a
 *    deliberately skipped optional can never fall through to a tick.
 *  - no evidence at all => `not_captured`. Never `passed`.
 */
export function resolveStageState(
  id: string,
  envelope: NvQualityEnvelope | null | undefined,
): NvStageState {
  if (!envelope) return 'not_captured';

  if (asStringArray(envelope.missingMandatory).includes(id)) return 'missing_mandatory';

  const record = (Array.isArray(envelope.steps) ? envelope.steps : []).find((s) => s?.id === id);
  if (record) {
    switch (record.status) {
      case 'completed':
        return 'passed';
      case 'skipped_scaled':
        return 'scaled_off';
      case 'deferred':
        return 'deferred';
      case 'failed':
        return 'failed';
      default:
        return 'not_captured';
    }
  }

  if (asStringArray(envelope.scaledOptional).includes(id)) return 'scaled_off';
  if (asStringArray(envelope.completed).includes(id)) return 'passed';
  return 'not_captured';
}

/**
 * Canonical stages first (so a partial envelope still shows every gate a
 * reviewer expects, as "not captured"), then any unrecognised id present on the
 * wire — a stage the server added but this build does not know about must not
 * silently vanish from an audit view.
 */
export function buildTrailStages(envelope: NvQualityEnvelope | null | undefined): NvTrailStage[] {
  const known = new Set(CANONICAL_STAGES.map((s) => s.id));
  const extraIds: string[] = [];
  const seen = new Set<string>();
  for (const id of [
    ...(Array.isArray(envelope?.steps) ? envelope!.steps.map((s) => s?.id) : []),
    ...asStringArray(envelope?.completed),
    ...asStringArray(envelope?.scaledOptional),
    ...asStringArray(envelope?.missingMandatory),
  ]) {
    if (typeof id !== 'string' || known.has(id) || seen.has(id)) continue;
    seen.add(id);
    extraIds.push(id);
  }

  const rows: NvTrailStage[] = CANONICAL_STAGES.map((s) => s).concat(
    extraIds.map((id) => ({ id, label: humanizeStageId(id), mandatory: false })),
  ).map((s) => {
    const record = (Array.isArray(envelope?.steps) ? envelope!.steps : []).find((r) => r?.id === s.id);
    return {
      id: s.id,
      label: s.label,
      mandatory: s.mandatory || asStringArray(envelope?.missingMandatory).includes(s.id),
      state: resolveStageState(s.id, envelope),
      note: record?.note,
      at: record?.at,
    };
  });

  return rows;
}

export interface NvTrailSummary {
  hasEnvelope: boolean;
  passed: number;
  scaledOff: number;
  deferred: number;
  failed: number;
  missingMandatory: number;
  notCaptured: number;
  total: number;
}

export function summarizeTrail(stages: NvTrailStage[], hasEnvelope: boolean): NvTrailSummary {
  const count = (s: NvStageState) => stages.filter((x) => x.state === s).length;
  return {
    hasEnvelope,
    passed: count('passed'),
    scaledOff: count('scaled_off'),
    deferred: count('deferred'),
    failed: count('failed'),
    missingMandatory: count('missing_mandatory'),
    notCaptured: count('not_captured'),
    total: stages.length,
  };
}

export interface NvAuthoritiesReadout {
  /** `true` only when a count was delivered AND it is > 0. */
  present: boolean;
  count: number | null;
  label: string;
  /** `true` when the wire carried no count, so no claim can be made either way. */
  unknown: boolean;
}

/**
 * Prefer the count over the boolean.
 *
 * `trust.citationsPresent` returned `true` for answers carrying zero
 * authorities until NV-CITE-GROUND-001 landed, so a panel that renders the
 * boolean would keep repeating that claim for every task produced before the
 * fix. When the count is absent we say so instead of trusting the boolean.
 */
export function readAuthorities(trust: NvTrustBlock | null | undefined): NvAuthoritiesReadout {
  const raw = trust?.authoritiesDelivered;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const count = Math.max(0, Math.trunc(raw));
    return {
      present: count > 0,
      count,
      unknown: false,
      label: count === 0
        ? 'No authorities delivered'
        : `${count} ${count === 1 ? 'authority' : 'authorities'} delivered`,
    };
  }
  return {
    present: false,
    count: null,
    unknown: true,
    label: 'Authority count not captured',
  };
}

/**
 * `layersUsed` reading. `unified-base` is the always-on prompt layer; when it is
 * the ONLY layer no corpus was consulted, which a reviewing lawyer must be able
 * to see before relying on the answer.
 */
export function readLayers(layersUsed: string[] | null | undefined): {
  layers: string[];
  captured: boolean;
  corpusConsulted: boolean;
} {
  const layers = asStringArray(layersUsed);
  const captured = Array.isArray(layersUsed);
  return {
    layers,
    captured,
    corpusConsulted: layers.some((l) => l !== 'unified-base'),
  };
}

/**
 * `routing.reason` is rewritten to the literal `'processed'` by
 * `sanitizeOrchestrationPayloadForClient` unless
 * `JRX_EXPOSE_ORCHESTRATION_DIAGNOSTICS=1`. Rendering that string as if it were
 * the router's reasoning would be a fabricated explanation, so it is reported
 * as withheld.
 */
export function readRoutingReason(reason: string | null | undefined): {
  text: string;
  disclosed: boolean;
} {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (!r) return { text: 'Not captured', disclosed: false };
  if (r === 'processed') return { text: 'Withheld on this wire (sanitised)', disclosed: false };
  return { text: r, disclosed: true };
}

/**
 * Fail-closed posture.
 *
 * `failClosed` is the ENFORCEMENT MODE (production, or
 * `JRX_QUALITY_ENVELOPE_FAIL_CLOSED=1`) — not a statement that this request was
 * refused. A refused request throws `QualityEnvelopeError` and never reaches a
 * UI, so on any rendered task `failClosed && ok` means "armed, nothing to
 * refuse". Labelling it "refused" would invent an event.
 */
export function readFailClosed(envelope: NvQualityEnvelope | null | undefined): {
  armed: boolean | null;
  ok: boolean | null;
  headline: string;
  detail: string;
  severity: 'ok' | 'warn' | 'bad';
} {
  if (!envelope) {
    return {
      armed: null,
      ok: null,
      headline: 'Fail-closed posture not captured',
      detail: 'No quality envelope was returned for this task.',
      severity: 'warn',
    };
  }
  const armed = envelope.failClosed === true;
  const ok = envelope.ok === undefined ? null : envelope.ok !== false;

  if (ok === false) {
    return armed
      ? {
          armed,
          ok,
          headline: 'Fail-closed: armed — mandatory gate missing',
          detail: 'Enforcement is armed and a mandatory gate is unmet: this task would be refused rather than degraded silently.',
          severity: 'bad',
        }
      : {
          armed,
          ok,
          headline: 'Advisory mode — delivered with a mandatory gate unmet',
          detail: 'Enforcement is NOT armed, so the task was delivered even though a mandatory gate is unmet.',
          severity: 'bad',
        };
  }
  return armed
    ? {
        armed,
        ok,
        headline: 'Fail-closed: armed',
        detail: 'A missing mandatory gate would have refused this task instead of degrading silently.',
        severity: 'ok',
      }
    : {
        armed,
        ok,
        headline: 'Fail-closed: not armed (advisory)',
        detail: 'Mandatory gates are reported but not enforced in this environment.',
        severity: 'warn',
      };
}

/** `chainOfThought` is genuinely absent when CoT capture hit truncated JSON. */
export function hasChainOfThought(cot: unknown): boolean {
  if (cot == null) return false;
  if (typeof cot === 'string') return cot.trim().length > 0;
  if (Array.isArray(cot)) return cot.length > 0;
  if (typeof cot === 'object') return Object.keys(cot as object).length > 0;
  return true;
}

export const NV_STAGE_STATE_LABEL: Record<NvStageState, string> = {
  passed: 'Completed',
  scaled_off: 'Scaled off',
  deferred: 'Deferred',
  failed: 'Failed',
  missing_mandatory: 'Missing (mandatory)',
  not_captured: 'Not captured',
};

/**
 * Pull a trail source out of an arbitrary run payload.
 *
 * Shared by every host so there is one parser rather than one per page. Accepts
 * both the bare unified contract and the `{ success, data }` envelope the
 * `/api/jrx/orchestrate` route wraps it in. Returns `null` when no
 * `qualityEnvelope` is present — the caller renders "not captured"; it must NOT
 * fabricate one from the neighbouring fields, because `trust`/`layersUsed`
 * being present says nothing about which gates ran.
 */
export function extractReasoningTrail(raw: unknown): NvReasoningTrailSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const top = raw as Record<string, unknown>;
  const body = (top.data && typeof top.data === 'object' ? top.data : top) as Record<string, unknown>;

  const envelope = body.qualityEnvelope;
  if (!envelope || typeof envelope !== 'object') return null;

  const cost = (body.cost && typeof body.cost === 'object' ? body.cost : {}) as Record<string, unknown>;
  return {
    qualityEnvelope: envelope as NvQualityEnvelope,
    routing: (body.routing && typeof body.routing === 'object'
      ? body.routing as NvReasoningTrailSource['routing']
      : null),
    layersUsed: Array.isArray(body.layersUsed) ? asStringArray(body.layersUsed) : null,
    trust: (body.trust && typeof body.trust === 'object' ? body.trust as NvTrustBlock : null),
    riskBadge: typeof body.riskBadge === 'string' ? body.riskBadge : null,
    auditHash: typeof body.auditHash === 'string' ? body.auditHash : null,
    requestPhase: typeof body.requestPhase === 'string' ? body.requestPhase : null,
    chainOfThought: body.chainOfThought,
    model: typeof cost.model === 'string' ? cost.model : null,
    provider: typeof cost.provider === 'string' ? cost.provider : null,
    latencyMs: typeof cost.latencyMs === 'number' ? cost.latencyMs : null,
  };
}
