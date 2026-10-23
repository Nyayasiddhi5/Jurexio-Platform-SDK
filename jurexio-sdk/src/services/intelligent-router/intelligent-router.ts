import type {
  AgentClass,
  JurisdictionCode,
  ModelEntry,
  RouterDecision,
  RouterRequest,
  Sanitized,
  ScoredCandidate,
  TaskKind,
  TierLevel,
} from './router-types.js';
import { getEmaBoostSync as getSmeEmaBoostSync } from '../jrx-sme/jrx-sme-grpo-redis-queue.js';
import { resolveGrpoOnlineNudge } from '../jrx-grpo-online-policy.js';
import { bedrockAffinityBoost, applyRoutingPolicy } from '../../config/jrx-llm-routing-policy.js';
import { getLlmCascadeLeadOverride } from '../../config/jrx-llm-cascade-config.js';
import { MODEL_CATALOG, getModel, isProviderAvailable } from './model-catalog.js';
import { defaultSequenceFor, ultimateFallbackSequence } from './default-sequences.js';
import { getHealthScore } from './health-tracker.js';

const TIER_SET: ReadonlySet<TierLevel> = new Set([
  'free', 'solo', 'plus', 'pro', 'enterprise', 'superadmin',
]);
const JUR_SET: ReadonlySet<JurisdictionCode> = new Set([
  'IN', 'UK', 'US', 'EU', 'GC', 'SG', 'GLOBAL',
]);
const TASK_SET: ReadonlySet<TaskKind> = new Set([
  'legal_drafting', 'legal_research', 'contract_analysis', 'litigation_strategy',
  'compliance_review', 'chain_of_thought', 'summarization', 'classification',
  'extraction', 'generic_chat', 'vision', 'json_structured',
]);

function sanitizeInputs(req: RouterRequest): Sanitized {
  const tierRaw = (req.tier ?? '').toString().toLowerCase();
  const tier: TierLevel = (TIER_SET.has(tierRaw as TierLevel) ? tierRaw : 'free') as TierLevel;

  const agentClass: AgentClass = inferAgentClass(req);

  const jurRaw = (req.jurisdiction ?? '').toString().toUpperCase();
  // Accept legacy 'GCC' alias from older callers and normalize to canonical 'GC'.
  const jurNorm = jurRaw === 'GCC' ? 'GC' : jurRaw;
  const jurisdiction: JurisdictionCode = (JUR_SET.has(jurNorm as JurisdictionCode) ? jurNorm : 'GLOBAL') as JurisdictionCode;

  const taskKind: TaskKind = inferTaskKind(req);

  const promptTokens = req.promptTokens ?? 1500;
  const expectedOutputTokens = req.expectedOutputTokens ?? 1500;
  const preferCheaper = !!req.preferCheaper || tier === 'free' || tier === 'solo';

  const hasMissingInputs =
    !req.tier || !req.jurisdiction || (!req.taskKind && !req.patternKey && !req.agentId);

  return {
    tier,
    agentClass,
    taskKind,
    jurisdiction,
    preferCheaper,
    promptTokens,
    expectedOutputTokens,
    hasMissingInputs,
  };
}

function inferAgentClass(req: RouterRequest): AgentClass {
  if (req.agentClass) return req.agentClass;
  const id = (req.agentId ?? '').toLowerCase();
  if (!id) return 'standard';
  if (id.includes('chief') || id.includes('officer') || id.includes('general-counsel') || id.includes('partner')) return 'executive';
  if (id.includes('senior') || id.includes('lead')) return 'senior';
  if (id.includes('specialist') || id.includes('drafter') || id.includes('strategist')) return 'specialist';
  if (id.includes('support') || id.includes('intake') || id.includes('triage')) return 'support';
  if (id.includes('calculator') || id.includes('formatter') || id.includes('classifier')) return 'utility';
  return 'standard';
}

function inferTaskKind(req: RouterRequest): TaskKind {
  if (req.taskKind && TASK_SET.has(req.taskKind)) return req.taskKind;
  /* NV-PARTNER-TASKTYPE-001 (2026-08-21): `/orchestrate` forwards partner
   * `taskType` strings (`legal-draft-fast`, `legal_research`, …) as
   * `taskKind`. Without this map they fell through to `generic_chat`, so draft
   * paths never got Opus-first cascade policy or deep attempt budgets. */
  if (req.taskKind) {
    const tk = String(req.taskKind).trim().toLowerCase();
    if (/legal[_-]?draft|doc[_-]?draft|document[_-]?draft|legal[_-]?drafting|^drafting$/i.test(tk)) {
      return 'legal_drafting';
    }
    if (/legal[_-]?research|legal[_-]?work/i.test(tk)) return 'legal_research';
    if (/legal[_-]?chat/i.test(tk)) return 'generic_chat';
    if (/litigation/i.test(tk)) return 'litigation_strategy';
    if (/compliance/i.test(tk)) return 'compliance_review';
    if (/contract/i.test(tk)) return 'contract_analysis';
  }
  if (req.requireVision) return 'vision';
  if (req.requireReasoning) return 'chain_of_thought';
  if (req.requireJson) return 'json_structured';
  const id = (req.agentId ?? '').toLowerCase();
  const pattern = (req.patternKey ?? '').toLowerCase();
  const blob = `${id} ${pattern}`;
  if (blob.includes('draft') || blob.includes('contract')) return 'legal_drafting';
  if (blob.includes('research') || blob.includes('precedent') || blob.includes('case-law')) return 'legal_research';
  if (blob.includes('litigation')) return 'litigation_strategy';
  if (blob.includes('compliance') || blob.includes('regulator')) return 'compliance_review';
  if (blob.includes('summary') || blob.includes('summarize')) return 'summarization';
  if (blob.includes('classif')) return 'classification';
  if (blob.includes('extract')) return 'extraction';
  return 'generic_chat';
}

function ctxFitScore(model: ModelEntry, promptTokens: number, expectedOutputTokens: number): number {
  const need = promptTokens + expectedOutputTokens;
  if (model.contextWindow < need) return -1000;
  const headroom = model.contextWindow - need;
  return Math.min(20, Math.log10(headroom + 10) * 5);
}

function costFitScore(model: ModelEntry, promptTokens: number, expectedOutputTokens: number, maxCostUsd?: number): number {
  const estCost =
    ((promptTokens * model.costInPer1M) + (expectedOutputTokens * model.costOutPer1M)) / 1_000_000;
  if (maxCostUsd != null && estCost > maxCostUsd) return -1000;
  if (estCost === 0) return 5;
  if (estCost < 0.005) return 4;
  if (estCost < 0.02) return 3;
  if (estCost < 0.1) return 1;
  return -2;
}

function jurisdictionFitScore(model: ModelEntry, jurisdiction: JurisdictionCode): number {
  const fit = model.jurisdictionFit?.[jurisdiction] ?? model.jurisdictionFit?.GLOBAL ?? 70;
  return (fit - 70) / 5;
}

function tierFitScore(model: ModelEntry, tier: TierLevel, preferCheaper: boolean): number {
  const isPaid = !model.isFree;
  if (tier === 'superadmin' || tier === 'enterprise') {
    return isPaid ? 8 : -2;
  }
  if (tier === 'pro') {
    return isPaid ? 6 : -1;
  }
  if (tier === 'plus') {
    if (preferCheaper) return isPaid && model.costInPer1M < 1 ? 4 : isPaid ? 1 : 2;
    return isPaid ? 4 : 1;
  }
  if (tier === 'solo') {
    return model.isFree ? 3 : (model.costInPer1M < 1 ? 5 : 0);
  }
  return model.isFree ? 6 : -3;
}

function legalAffinityScore(model: ModelEntry, taskKind: TaskKind, agentClass: AgentClass, tier: TierLevel): number {
  const isLegalHeavy =
    taskKind === 'legal_drafting' ||
    taskKind === 'legal_research' ||
    taskKind === 'litigation_strategy' ||
    taskKind === 'contract_analysis' ||
    taskKind === 'compliance_review' ||
    taskKind === 'chain_of_thought';

  const seniorish = agentClass === 'executive' || agentClass === 'senior' || agentClass === 'specialist';
  const proPlus = tier === 'pro' || tier === 'enterprise' || tier === 'superadmin';

  let score = 0;
  if (isLegalHeavy) {
    score += (model.legalQuality - 80) / 4;
    if (model.provider === 'anthropic') score += proPlus ? 12 : 6;
    if (model.provider === 'openai' && (model.id === 'o3' || model.id === 'o4-mini')) score += 4;
  } else {
    score += (model.generalQuality - 80) / 5;
  }

  if (seniorish && proPlus && model.provider === 'anthropic') score += 4;
  if (model.provider === 'bedrock') score += bedrockAffinityBoost(model, tier, taskKind);
  if (model.preferredFor?.includes(taskKind)) score += 5;
  return score;
}

function capabilityScore(model: ModelEntry, req: RouterRequest): number {
  let score = 0;
  if (req.requireVision) score += model.capabilities.vision ? 6 : -1000;
  if (req.requireJson) score += model.capabilities.json ? 3 : -10;
  if (req.requireStreaming) score += model.capabilities.streaming ? 1 : -3;
  if (req.requireReasoning) score += model.capabilities.reasoning ? 6 : -8;
  return score;
}

function preferredListBoost(model: ModelEntry, req: RouterRequest): number {
  let score = 0;
  if (req.preferredModels?.includes(model.id)) score += 8;
  if (req.fallbackModels?.includes(model.id)) score += 2;
  return score;
}

function speedScore(model: ModelEntry, preferCheaper: boolean): number {
  return preferCheaper ? (model.speedScore - 70) / 8 : (model.speedScore - 70) / 14;
}

/**
 * Health weighting.
 *
 * Range:
 *   healthy (score=1.0)         → +8
 *   neutral (score=0.5, no data)→  0
 *   degraded (score=0.4)        → -1.6
 *   sick     (score≤0.2)        → -100  ← circuit-breaker; cannot win as primary
 *
 * Without the hard penalty, a Claude/GPT-4 with a +12 legal-affinity boost
 * could still outrank a healthy GPT-4.1-mini even while failing 50%+ of
 * recent requests. The hard penalty kicks in only when health-tracker has
 * decided the model is in failure mode (≥50% failure in last 5 min and the
 * 60s recovery probe has not yet reset it). The model still stays in the
 * sequence as a late-position fallback — only the primary slot is blocked.
 */
function healthBoost(model: ModelEntry): number {
  const score = getHealthScore(model.id);
  if (score <= 0.2) return -100;
  return (score - 0.5) * 16;
}

function score(model: ModelEntry, req: RouterRequest, sanitized: Sanitized): ScoredCandidate {
  const reasons: string[] = [];

  if (req.forbiddenModels?.includes(model.id)) {
    return { model, score: -1e9, reasons: ['forbidden by request'] };
  }
  if (!isProviderAvailable(model.provider)) {
    return { model, score: -1e9, reasons: [`provider ${model.provider} not configured`] };
  }

  let total = 0;

  const ctx = ctxFitScore(model, sanitized.promptTokens, sanitized.expectedOutputTokens);
  if (ctx <= -1000) return { model, score: -1e9, reasons: ['context too small'] };
  total += ctx; reasons.push(`ctx:${ctx.toFixed(1)}`);

  const cost = costFitScore(model, sanitized.promptTokens, sanitized.expectedOutputTokens, req.maxCostUsd);
  if (cost <= -1000) return { model, score: -1e9, reasons: ['exceeds maxCostUsd'] };
  total += cost; reasons.push(`cost:${cost.toFixed(1)}`);

  const cap = capabilityScore(model, req);
  if (cap <= -1000) return { model, score: -1e9, reasons: ['missing required capability'] };
  total += cap; reasons.push(`cap:${cap.toFixed(1)}`);

  const jur = jurisdictionFitScore(model, sanitized.jurisdiction);
  total += jur; reasons.push(`jur:${jur.toFixed(1)}`);

  const tier = tierFitScore(model, sanitized.tier, sanitized.preferCheaper);
  total += tier; reasons.push(`tier:${tier.toFixed(1)}`);

  const legal = legalAffinityScore(model, sanitized.taskKind, sanitized.agentClass, sanitized.tier);
  total += legal; reasons.push(`legal:${legal.toFixed(1)}`);

  const pref = preferredListBoost(model, req);
  if (pref) reasons.push(`prefList:${pref.toFixed(1)}`);
  total += pref;

  const spd = speedScore(model, sanitized.preferCheaper);
  total += spd; reasons.push(`speed:${spd.toFixed(1)}`);

  const hp = healthBoost(model);
  total += hp; reasons.push(`health:${hp.toFixed(1)}`);

  return { model, score: total, reasons };
}

export function pickSequence(req: RouterRequest): RouterDecision {
  const sanitized = sanitizeInputs(req);

  const scored: ScoredCandidate[] = MODEL_CATALOG
    .map((m) => score(m, req, sanitized))
    .filter((s) => s.score > -1e8);

  // Task #156 — SME GRPO EMA tie-breaker. Bounded ±0.04 nudge applied
  // ONLY when the top two pre-EMA candidates are within an epsilon
  // window (0.05). This preserves the dominant scoring signal in clear-
  // winner cases and lets the SME-learned preference resolve ties.
  // Sync read from a small in-process LRU; first call returns 0 and
  // triggers async refresh (see sme-grpo-redis-queue.getEmaBoostSync).
  // Never blocks; never throws.
  const TIE_EPSILON = 0.05;
  try {
    const sortedPre = scored.slice().sort((a, b) => b.score - a.score);
    const top = sortedPre[0]?.score ?? 0;
    const second = sortedPre[1]?.score ?? top;
    const isNearTie = Math.abs(top - second) <= TIE_EPSILON;
    if (isNearTie) {
      const j = String(sanitized.jurisdiction || 'GLOBAL');
      const tk = String(sanitized.taskKind || 'general');
      for (const s of scored) {
        const boost = getSmeEmaBoostSync(j, tk, s.model.id);
        if (boost !== 0) {
          s.score += boost;
          s.reasons.push(`smeEma:${boost.toFixed(3)}(tie)`);
        }
      }
    }
  } catch { /* router must never throw */ }

  // NV-GRPO-ONLINE-001 — cost/quality nudge from SME EMA (not weight training)
  try {
    const nudge = resolveGrpoOnlineNudge({
      jurisdiction: String(sanitized.jurisdiction || 'IN'),
      taskKind: String(sanitized.taskKind || 'legal_research'),
    });
    if (nudge.source === 'ema') {
      for (const s of scored) {
        const cost = Number((s.model as any).costPer1k ?? (s.model as any).costTier ?? 1);
        if (nudge.preferFastModel && cost <= 1) {
          s.score += 0.02;
          s.reasons.push('grpoOnline:preferFast');
        }
        if (nudge.preferHighQuality && cost >= 2) {
          s.score += 0.02;
          s.reasons.push('grpoOnline:preferQuality');
        }
      }
    }
  } catch { /* never throw */ }

  scored.sort((a, b) => b.score - a.score);

  // NV-LLM-LATENCY-001 (2026-06-29): keep Sarvam Indic rails OUT of the
  // PRIMARY slot when a comparable non-Sarvam candidate exists. Sarvam
  // (sarvam-105b/30b/m) earns a high IN-jurisdiction + legal-affinity score,
  // so for IN legal-heavy free/citizen tiers (NYM/NSA) it frequently wins the
  // lead by a small margin. But Sarvam returns HTTP-200 blank bodies for
  // English analyse/summarise tasks (the exact NV-LLM-EMPTY-001 failure mode)
  // and the router has no per-request language signal to tell an Indic prompt
  // from an English one. Leading with Sarvam therefore burns a full provider
  // round-trip + the per-attempt timeout before the cascade advances to a
  // model that actually returns content. This mirrors the curated
  // default-sequences policy (INDIC_LEGAL already demotes Sarvam below the
  // strong analytical models). Correctness is unaffected: Sarvam stays as the
  // immediate fallback right behind the promoted lead, so Indic/Hindi queries
  // still reach it and get a Devanagari answer (and modern frontier minis
  // handle Devanagari natively too). Bounded by a score window + a health
  // gate, env-overridable, and fully reversible (set the window to 0).
  const SARVAM_PRIMARY_DEMOTE_WINDOW = Number(process.env.JRX_ROUTER_SARVAM_DEMOTE_WINDOW) || 12;
  if (
    SARVAM_PRIMARY_DEMOTE_WINDOW > 0 &&
    scored.length > 1 &&
    scored[0]?.model.provider === 'sarvam'
  ) {
    const topScore = scored[0].score;
    const altIdx = scored.findIndex(
      (s) =>
        s.model.provider !== 'sarvam' &&
        topScore - s.score <= SARVAM_PRIMARY_DEMOTE_WINDOW &&
        getHealthScore(s.model.id) > 0.2,
    );
    if (altIdx > 0) {
      const [alt] = scored.splice(altIdx, 1);
      scored.unshift(alt);
      alt.reasons.push('sarvamPrimaryDemotion:promoted-reliable-lead');
    }
  }

  let sequence: ModelEntry[] = scored.map((s) => s.model);

  if (sequence.length < 3 || sanitized.hasMissingInputs) {
    const defaults = defaultSequenceFor(sanitized.tier, sanitized.agentClass, sanitized.taskKind, {
      requireVision: req.requireVision,
      requireReasoning: req.requireReasoning,
      jurisdiction: req.jurisdiction || sanitized.jurisdiction,
    });
    sequence = mergeUnique(sequence, defaults);
  }

  sequence = mergeUnique(sequence, ultimateFallbackSequence());

  // NV-LLM-CASCADE-CONFIG-001: optional env lead prepend (ops-managed).
  const leadOverride = getLlmCascadeLeadOverride();
  if (leadOverride.length) {
    const leadModels = leadOverride
      .map((id) => getModel(id))
      .filter((m): m is ModelEntry => !!m);
    sequence = mergeUnique(leadModels, sequence);
  }

  sequence = applyRoutingPolicy(sequence, req, sanitized.tier, sanitized.taskKind);

  // Force AgentZero as terminal never-fail fallback regardless of scoring position.
  const az = getModel('agentzero');
  if (az) {
    sequence = sequence.filter((m) => m.id !== 'agentzero');
    sequence.push(az);
  }

  if (sequence.length === 0 && az) {
    sequence = [az];
  }

  const reasonsByModel: Record<string, string[]> = {};
  for (const s of scored) reasonsByModel[s.model.id] = s.reasons;
  for (const m of sequence) {
    if (!reasonsByModel[m.id]) reasonsByModel[m.id] = ['default-sequence-fallback'];
  }

  return { primary: sequence[0], sequence, reasonsByModel, inputs: sanitized };
}

function mergeUnique(a: ModelEntry[], b: ModelEntry[]): ModelEntry[] {
  const seen = new Set<string>();
  const out: ModelEntry[] = [];
  for (const m of [...a, ...b]) {
    if (seen.has(m.id)) continue;
    if (!isProviderAvailable(m.provider) && m.provider !== 'agentzero') continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

export type { RouterRequest, RouterDecision } from './router-types.js';
