/**
 * nv-credit-cap-observe.ts — NV-CREDIT-OBSERVE-001
 *
 * Decides whether a *newly added* pre-spend AI-credit cap may refuse traffic, and
 * emits the structured near-miss line that will tune the budgets.
 *
 * WHY OBSERVE MODE EXISTS
 * ───────────────────────
 * The 40 caps added by NV-CREDIT-UNIVERSAL-001 have never fired in production —
 * not because they were tuned and found sufficient, but because `enforce()` reads
 * `getUsedToday()`, which sums `nv_schema.ai_credit_usage`, and until the universal
 * recorder shipped almost nothing wrote that table. `usedToday` was structurally 0.
 *
 * So the budgets those caps enforce have never been compared to real consumption.
 * Turning the recorder and the refusals on in the same deploy would begin refusing
 * partner work against numbers nobody has validated: a budget set too low refuses
 * legitimate work, which is a worse and far more visible failure than the current
 * over-permissiveness. Record first, watch the near-misses, then refuse.
 *
 * THE RECORDER IS NOT GATED BY THIS MODULE — deliberately.
 * `nv-credit-usage-recorder.ts` stays fully live. Observing without recording would
 * observe a counter that is still 0, i.e. it would reproduce the original defect and
 * call it caution.
 *
 * SCOPE — this module is imported ONLY by `nv-ai-credit-cap-middleware.ts`.
 * The pre-existing enforcement inlined in `/orchestrate`, `/orchestrate/stream` and
 * `/legal-chat/send` does not consult it and is unaffected. Those surfaces carry
 * live partner traffic and established refusal behaviour; routing them through a
 * default-observe switch would *reduce* safety, which is the opposite of this task.
 *
 * NV-SECRETS-001: the log line carries a key *id* and a tier, never a key value.
 */

import { createLogger } from '../utils/logger.js';
import type { CreditCheckResult } from '../services/jrx-ai-credit-enforcer.js';

const logger = createLogger('./jrx-credit-cap-observe');

/** Grep anchor for counting near-misses in gateway logs. */
export const CREDIT_CAP_OBSERVE_MARKER = 'NV-CREDIT-CAP-OBSERVE';

export type NvCreditCapMode = 'observe' | 'enforce';

/**
 * Resolve the mode for the newly-added caps.
 *
 * Default is `observe` on purpose: a deploy that forgets to set anything must not
 * start refusing. Only an explicit opt-in flips it, and `NYV_CREDIT_ENFORCE=0`
 * (the pre-existing global escape) still wins over both — an operator who has
 * switched credit enforcement off entirely has not asked for refusals here either.
 */
export function resolveCreditCapMode(): NvCreditCapMode {
  const globalOff = String(process.env.NYV_CREDIT_ENFORCE ?? '1').trim().toLowerCase();
  if (globalOff === '0' || globalOff === 'false' || globalOff === 'off') return 'observe';

  const v = String(process.env.NYV_CREDIT_CAP_MODE ?? '').trim().toLowerCase();
  if (v === 'enforce' || v === '1' || v === 'true' || v === 'on' || v === 'yes') return 'enforce';
  return 'observe';
}

export interface CreditCapObserveSubject {
  /** Billing subject as the enforcer sees it (user id, or `sdk_app_<id>`). */
  userId: string;
  orgId?: string;
  /** Partner API-key *identifier* — never the key material. */
  apiKeyId?: string;
  /** Partner application id, the attributable unit for SDK traffic. */
  appId?: string;
  tier: string;
}

export interface CreditCapObserveEvent {
  /** Route path — the surface whose budget is being tuned. */
  surface: string;
  /** `agentKey` passed to the enforcer, i.e. the logical cap group. */
  agentKey: string;
  subject: CreditCapObserveSubject;
  /** Pre-spend token estimate the cap priced this request at. */
  estimatedTokens: number;
  /** Pre-spend money estimate in micro-USD; 0 when not measurable pre-spend. */
  estimatedCostMicroUsd?: number;
  check: CreditCheckResult;
}

/**
 * Structured near-miss record. Every field an operator needs to answer "which key,
 * on which surface, by how much, against which budget" without a second query.
 *
 * `overBy` is the whole point: a cap that would have refused by 200 tokens is a
 * budget that is very slightly too small, while one that would have refused by 4M
 * is a runaway caller. Counting refusals alone cannot tell those apart.
 */
export interface CreditCapObserveRecord {
  marker: typeof CREDIT_CAP_OBSERVE_MARKER;
  decision: 'would_refuse';
  mode: NvCreditCapMode;
  surface: string;
  agentKey: string;
  tier: string;
  userId: string;
  orgId?: string;
  apiKeyId?: string;
  appId?: string;
  limit: string;
  estimatedTokens: number;
  usedToday: number;
  budgetLimit: number;
  /** Units of `limit`: tokens, micro-USD, or requests. */
  overBy: number;
  estimatedCostMicroUsd?: number;
  costUsedTodayMicroUsd?: number;
  costBudgetMicroUsd?: number;
  hourlyRequests?: number;
  hourlyLimit?: number;
}

/**
 * How far past the limit this request would have pushed the subject, in the units
 * of the limit that actually tripped. Mixing token overage with request-count
 * overage into one number would make the aggregate meaningless.
 */
function computeOverBy(ev: CreditCapObserveEvent): number {
  const { check } = ev;
  switch (check.limit) {
    case 'hourly_requests':
      return Math.max(0, Number(check.hourlyRequests ?? 0) - Number(check.hourlyLimit ?? 0) + 1);
    case 'daily_cost':
      return Math.max(
        0,
        Number(check.costUsedTodayMicroUsd ?? 0)
          + Number(ev.estimatedCostMicroUsd ?? 0)
          - Number(check.costBudgetMicroUsd ?? 0),
      );
    case 'daily_tokens':
    case undefined:
      return Math.max(0, check.usedToday + ev.estimatedTokens - check.budgetLimit);
    default: {
      const exhaustive: never = check.limit;
      return Number(exhaustive);
    }
  }
}

export function buildCreditCapObserveRecord(
  ev: CreditCapObserveEvent,
  mode: NvCreditCapMode,
): CreditCapObserveRecord {
  const { check, subject } = ev;
  const rec: CreditCapObserveRecord = {
    marker: CREDIT_CAP_OBSERVE_MARKER,
    decision: 'would_refuse',
    mode,
    surface: ev.surface,
    agentKey: ev.agentKey,
    tier: String(check.tier ?? subject.tier),
    userId: subject.userId,
    limit: String(check.limit ?? 'daily_tokens'),
    estimatedTokens: ev.estimatedTokens,
    usedToday: check.usedToday,
    budgetLimit: check.budgetLimit,
    overBy: computeOverBy(ev),
  };
  if (subject.orgId) rec.orgId = subject.orgId;
  if (subject.apiKeyId) rec.apiKeyId = subject.apiKeyId;
  if (subject.appId) rec.appId = subject.appId;
  if (typeof ev.estimatedCostMicroUsd === 'number') rec.estimatedCostMicroUsd = ev.estimatedCostMicroUsd;
  if (typeof check.costUsedTodayMicroUsd === 'number') rec.costUsedTodayMicroUsd = check.costUsedTodayMicroUsd;
  if (typeof check.costBudgetMicroUsd === 'number') rec.costBudgetMicroUsd = check.costBudgetMicroUsd;
  if (typeof check.hourlyRequests === 'number') rec.hourlyRequests = check.hourlyRequests;
  if (typeof check.hourlyLimit === 'number') rec.hourlyLimit = check.hourlyLimit;
  return rec;
}

/**
 * Log a would-be refusal and report whether the request must actually be refused.
 *
 * Returns `true` when the caller should refuse (mode `enforce`), `false` when the
 * request is to be admitted after logging (mode `observe`). Logged at `warn` in
 * BOTH modes: a real refusal is at least as interesting as a hypothetical one, and
 * a single grep anchor across both means the count does not reset when the flag
 * flips.
 */
export function observeCreditCapRefusal(ev: CreditCapObserveEvent): boolean {
  const mode = resolveCreditCapMode();
  const record = buildCreditCapObserveRecord(ev, mode);
  logger.warn(
    mode === 'enforce'
      ? `[${CREDIT_CAP_OBSERVE_MARKER}] refusing (enforce mode)`
      : `[${CREDIT_CAP_OBSERVE_MARKER}] would refuse (observe mode — request admitted)`,
    record as unknown as Record<string, unknown>,
  );
  return mode === 'enforce';
}
