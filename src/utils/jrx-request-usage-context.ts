/**
 * NV per-request LLM usage accumulator (NV-AUDIT-TOKENS-001)
 * ─────────────────────────────────────────────────────────────────────────────
 * The activity event-bus writes one nv_schema.ai_activity row per /api/jrx/*
 * response, but the HTTP layer does not know how many tokens the request's LLM
 * calls consumed — so tokens_used was always 0 and the dashboards showed zero
 * token/cost totals.
 *
 * This module provides a request-scoped accumulator:
 *   - `nvRequestUsageContext` middleware creates a fresh accumulator, exposes it
 *     on `res.locals.nvUsage` (read by the activity publisher on `finish` and by
 *     the existing nvUsageMetering middleware), and runs the rest of the request
 *     inside an AsyncLocalStorage context.
 *   - Deep LLM services call `recordLlmUsage()` after each provider call; it adds
 *     to the current request's accumulator without any prop drilling.
 *
 * One row per HTTP request (the event-bus row); all LLM calls in that request are
 * summed into it. We do NOT insert per-call ai_activity rows (would double-count
 * request volume).
 *
 * NV-METER-WASTE-001 (2026-08-16): the accumulator also tracks *discarded* spend
 * separately (`wasted*`), so a call we paid for but threw away is visible without
 * ever being billed to the customer. See `RequestUsage`.
 */
import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

export interface RequestUsage {
  promptTokens: number;
  completionTokens: number;
  /** Anthropic/Bedrock prompt-cache read tokens (metered separately from non-cache input). */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  calls: number;
  model?: string;
  provider?: string;
  /**
   * NV-METER-WASTE-001 (2026-08-16) — spend that was incurred but whose output was
   * discarded: the losing leg of a hedge, a generation abandoned on a deadline, a
   * node whose answer a later gate replaced.
   *
   * Kept in SEPARATE counters, deliberately. `promptTokens` / `completionTokens` /
   * `costUsd` are what `nvAICreditEnforcer.record()` bills the customer for, and a
   * customer must never be charged for a call we chose to throw away. But if waste
   * is not counted *anywhere* it is invisible, which is exactly how the hedge ran
   * a full second paid call on every request for months without showing up.
   *
   * `wastedCalls` is also what makes the difference between "billed completions"
   * and "completions the answer actually used" auditable from the envelope, rather
   * than only by grepping provider log lines on the host.
   */
  wastedPromptTokens: number;
  wastedCompletionTokens: number;
  wastedCostUsd: number;
  wastedCalls: number;
  /**
   * NV-CREDIT-UNIVERSAL-001 — set once this request's spend has been written to
   * `nv_schema.ai_credit_usage` by a route-level helper (`recordOrchestrateCredit`
   * / `recordLegalChatCredit`).
   *
   * The response-finish recorder in `nv-usage-metering-middleware` is a backstop
   * for the surfaces that have no route-level helper. Both reading the same
   * accumulator means, without this marker, a request that already recorded would
   * be billed a second time — and double-billing a customer is a worse failure
   * than the under-billing this backstop exists to fix.
   */
  billed?: boolean;
  /**
   * NV-CREDIT-COST-DIM-001 — the portion of `costUsd` that came from paid spend with
   * no chat tokens (embeddings, STT, TTS, off-ring vision). Kept separately so a
   * cost overage can be attributed to a *dimension* rather than only to a total: a
   * $2 day that is all embeddings is a different operational story from a $2 day of
   * completions, and only the split can tell them apart.
   */
  auxCostUsd?: number;
  auxCalls?: number;
  /** Billable quantity in the driver's own unit (audio seconds, characters, pages). */
  auxUnits?: number;
  auxDriver?: string;
  /** NV-DRAFT-STRUCTURE-CHECKER-001 — at most one Sonnet structure pass per HTTP request. */
  draftStructureCheckerApplied?: boolean;
  /** NV-AI-COMPLETION-LOOP-001 — continuation segments executed this request. */
  completionLoopSegments?: number;
  /** Last provider finish reason (length / stop) for completion loop decisions. */
  lastLlmFinishReason?: string;
}

const usageStore = new AsyncLocalStorage<RequestUsage>();

export function getRequestUsage(): RequestUsage | undefined {
  return usageStore.getStore();
}

/**
 * NV-CREDIT-UNIVERSAL-001 — claim this request's spend for AI-credit accounting.
 *
 * Returns true if the caller now owns the billing for this request, false if
 * someone already claimed it. Callers MUST only write an `ai_credit_usage` row
 * when this returns true, so exactly one row exists per request.
 *
 * With NO accumulator (a worker, a cron job, or any non-HTTP caller) this returns
 * true: the response-finish backstop reads the very same object, so if there is
 * nothing to mark there is also nothing that could bill a second time. Returning
 * false here instead would silently stop off-request spend from ever being
 * recorded — which is the original no-op defect wearing a different hat.
 *
 * Works on `res.locals.nvUsage` too (same object), so a response-finish hook that
 * has lost the AsyncLocalStorage context can pass the accumulator explicitly.
 */
export function claimRequestUsageForBilling(acc?: RequestUsage): boolean {
  const target = acc ?? usageStore.getStore();
  if (!target) return true;
  if (target.billed) return false;
  target.billed = true;
  return true;
}

/**
 * Add one LLM call's usage to the current request's accumulator. No-op outside a
 * request context (e.g. cron jobs / workers without the middleware), so it is
 * always safe to call from deep in the safety ring.
 *
 * Pass `wasted: true` for spend whose output was discarded (see `RequestUsage`);
 * it accumulates into the `wasted*` counters and is excluded from the billable
 * totals.
 */
export function recordLlmUsage(p: {
  tokensIn?: number | null;
  tokensOut?: number | null;
  tokensCacheRead?: number | null;
  tokensCacheWrite?: number | null;
  costUsd?: number | null;
  model?: string | null;
  provider?: string | null;
  wasted?: boolean;
  finishReason?: string | null;
}): void {
  const acc = usageStore.getStore();
  if (!acc) return;
  const tokensIn = Math.max(0, Math.floor(Number(p.tokensIn) || 0));
  const tokensOut = Math.max(0, Math.floor(Number(p.tokensOut) || 0));
  const cacheRead = Math.max(0, Math.floor(Number(p.tokensCacheRead) || 0));
  const cacheWrite = Math.max(0, Math.floor(Number(p.tokensCacheWrite) || 0));
  const billableIn = tokensIn + cacheRead + cacheWrite;
  const costUsd = Math.max(0, Number(p.costUsd) || 0);

  if (p.wasted) {
    acc.wastedPromptTokens += billableIn;
    acc.wastedCompletionTokens += tokensOut;
    acc.wastedCostUsd += costUsd;
    acc.wastedCalls += 1;
    // Deliberately do NOT set acc.model/provider from a discarded call — those
    // fields name the model that produced the answer the user received.
    return;
  }

  acc.promptTokens += billableIn;
  acc.cacheReadTokens += cacheRead;
  acc.cacheWriteTokens += cacheWrite;
  acc.completionTokens += tokensOut;
  acc.costUsd += costUsd;
  acc.calls += 1;
  if (p.model) acc.model = p.model;
  if (p.provider) acc.provider = p.provider;
  if (p.finishReason) acc.lastLlmFinishReason = String(p.finishReason);
}

/**
 * NV-CREDIT-COST-DIM-001 — report paid spend that consumed no chat tokens:
 * embeddings, speech-to-text, text-to-speech, off-ring vision/OCR.
 *
 * These providers bill per input token at an embedding rate, per audio second, per
 * character or per image — none of which is a chat token. Writing a synthesised
 * token count would corrupt `tokens_used`, the number the daily *token* budget is
 * compared against, and would silently reprice three product lines. So this adds to
 * `costUsd` and `calls` only, and mirrors the amount into `auxCostUsd`/`auxCalls`
 * so "how much of today's bill was non-token spend" is answerable without joining
 * against provider invoices.
 *
 * `calls` IS incremented: it is the recorder's "a paid provider was invoked on this
 * request" signal, and an STT call is exactly that.
 */
export function recordAuxSpend(p: {
  costUsd?: number | null;
  driver?: string | null;
  provider?: string | null;
  model?: string | null;
  /** Billable quantity in the driver's own unit, for audit (seconds, chars, pages). */
  units?: number | null;
}): void {
  const acc = usageStore.getStore();
  if (!acc) return;
  const costUsd = Math.max(0, Number(p.costUsd) || 0);
  acc.costUsd += costUsd;
  acc.calls += 1;
  acc.auxCostUsd = (acc.auxCostUsd ?? 0) + costUsd;
  acc.auxCalls = (acc.auxCalls ?? 0) + 1;
  acc.auxUnits = (acc.auxUnits ?? 0) + Math.max(0, Number(p.units) || 0);
  if (p.driver) acc.auxDriver = p.driver;
  if (p.model) acc.model = p.model;
  if (p.provider) acc.provider = p.provider;
}

export function nvRequestUsageContext(_req: Request, res: Response, next: NextFunction): void {  const acc: RequestUsage = {
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    calls: 0,
    wastedPromptTokens: 0,
    wastedCompletionTokens: 0,
    wastedCostUsd: 0,
    wastedCalls: 0,
  };
  // Shared object: the activity publisher reads it on res 'finish', and the
  // existing nvUsageMetering middleware already reads res.locals.nvUsage.
  res.locals.nvUsage = acc;
  usageStore.run(acc, () => next());
}
