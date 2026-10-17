import { createLogger } from '../utils/logger.js';
import { getBreakerPolicy } from '../services/circuit-breaker.js';
import { OPTIONAL_STAGE_GRACE_MS } from './jrx-completion-driven.js';

const logger = createLogger('./jrx-memory-fan-in');

/**
 * NV-MEM-FANIN-BOUND-001 (2026-08-16) — bound best-effort memory recall to the
 * budget its own transport already enforces.
 *
 * Measured on jrx-staging (deploy 2026-08-16T0910Z, forced-Queen swarm, 366.1s wall):
 * every one of the 4 `withMiddleware` legs spent 90.4s in this fan-in and
 * returned ZERO items. Derivation, from the live span tree + log timestamps:
 *
 *   queen.agent (exploration leaf) = 98.5s
 *     ├─ fan-in                    = 90.4s   → 0 items, warn "Timed out after 30000ms"
 *     └─ LLM (flash-lite)          =  7.7s   (llm.latency_ms)
 *
 * 90.4s ≈ 3 × 30s. `capabilityManifest.invoke` routes through
 * `runWithRetryAndBreaker(..., 'outbound:capability')`, whose breaker timeout is
 * 30_000ms and whose DEFAULT_RETRY is `maxAttempts: 3` with an `isRetryable`
 * predicate that matches `/timed?[- ]?out/`. So a source that exhausts its FULL
 * breaker budget is retried twice more, each retry certain to hit the same wall.
 * Nothing logs the retries, which is why the probe saw "zero retry/backoff log
 * lines" while paying for retry churn.
 *
 * The bound below is deliberately set to the breaker's own `timeoutMs` and not
 * to some new, smaller number. That makes it content-neutral BY CONSTRUCTION:
 * the breaker already guarantees no source can return a result after
 * `timeoutMs`, so capping the fan-in at `timeoutMs` cannot drop a recall that
 * would otherwise have arrived. The only thing removed is waiting on retries of
 * a call that already failed by timing out. This is why it needs no re-run of
 * the 40-prompt quality gate: the set of memory items reaching the prompt is
 * unchanged, only the time spent not getting them.
 *
 * Reading the live policy (rather than hardcoding 30_000) keeps this correct
 * when an SRE tunes `NYV_BREAKER_CAPABILITY_TIMEOUT_MS`.
 *
 * NV-COMPLETION-DRIVEN-001 (2026-08-17) — the bound is an UPPER limit for a
 * hung source, not the event that advances the leaf. Promise.allSettled used
 * to wait for the slowest source even after a sibling had already returned
 * items. First useful result now starts a short grace, then hangers are
 * aborted and the leaf proceeds.
 */
const FANIN_BUDGET_MS = getBreakerPolicy('outbound:capability').timeoutMs;

export type MemoryRecallItem = Record<string, unknown> | string;

export interface MemoryRecallSource {
  id: string;
  label: string;
  run: (signal?: AbortSignal) => Promise<MemoryRecallItem[]>;
}

export interface MemoryFanInContext {
  query: string;
  userId?: string;
  sessionId?: string;
  orgId?: string;
  tenantId?: string;
  agentKey?: string;
  jurisdiction?: string;
  tier?: string;
  requestId?: string;
  limit?: number;
  tiers?: Array<'session' | 'longterm' | 'social'>;
  sources?: MemoryRecallSource[];
}

export function getFanInBudgetMs(): number {
  return FANIN_BUDGET_MS;
}

export function getFanInGraceMs(): number {
  return OPTIONAL_STAGE_GRACE_MS;
}

function stringifyRecallItem(item: MemoryRecallItem): string {
  if (typeof item === 'string') return item;
  try {
    return JSON.stringify(item);
  } catch {
    return String(item);
  }
}

function dedupeRecallItems(items: MemoryRecallItem[]): MemoryRecallItem[] {
  const seen = new Set<string>();
  const deduped: MemoryRecallItem[] = [];
  for (const item of items) {
    const key = stringifyRecallItem(item).slice(0, 300);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

/**
 * Cap one recall source at the transport's own single-attempt budget — see
 * NV-MEM-FANIN-BOUND-001 above for why this cannot change what the model reads.
 * The losing timer is always cleared so a fast source does not keep the event
 * loop alive for the remainder of the budget.
 */
function withFanInBudget(
  p: Promise<MemoryRecallItem[]>,
  sourceId: string,
  signal?: AbortSignal,
): Promise<MemoryRecallItem[]> {
  return new Promise<MemoryRecallItem[]>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error(`[MemoryFanIn] aborted ${sourceId}`));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    const timer = setTimeout(
      () => reject(new Error(
        `[MemoryFanIn] recall budget exhausted for ${sourceId} after ${FANIN_BUDGET_MS}ms `
        + '(single breaker attempt; retries of an already-timed-out recall are not waited on)',
      )),
      FANIN_BUDGET_MS,
    );
    signal?.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

async function recallFromMemoryManager(ctx: MemoryFanInContext): Promise<MemoryRecallItem[]> {
  if (!ctx.userId && !ctx.sessionId) return [];
  const { nvMemoryManager } = await import('../services/jrx-memory-manager.js');
  const recalled = await nvMemoryManager.recall({
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    orgId: ctx.orgId ?? ctx.tenantId,
    agentId: ctx.agentKey,
    jurisdiction: ctx.jurisdiction,
    query: ctx.query,
    limit: ctx.limit ?? 8,
    tiers: ctx.tiers ?? ['session', 'longterm', 'social'],
  });
  return recalled.map((entry) => ({ ...entry } as Record<string, unknown>));
}

/**
 * Fan in memory recall from either explicit sources or the canonical
 * memory-manager fallback. Each source runs best-effort in parallel and the
 * merged result is deduped on stringified content.
 *
 * NV-QUEEN-STAGE-ATTRIBUTION-001 — every source reports its own durationMs.
 * NV-COMPLETION-DRIVEN-001 — proceed on first useful items + grace; do not
 * wait for hanging siblings to exhaust the breaker budget.
 */
export async function fanInMemoryRecall(ctx: MemoryFanInContext): Promise<MemoryRecallItem[]> {
  const sources = ctx.sources;

  if (Array.isArray(sources)) {
    if (sources.length === 0) return [];

    const ac = new AbortController();
    const merged: MemoryRecallItem[] = [];

    return new Promise<MemoryRecallItem[]>((resolve) => {
      let finished = false;
      let pending = sources.length;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = (reason: string) => {
        if (finished) return;
        finished = true;
        if (graceTimer) clearTimeout(graceTimer);
        clearTimeout(budgetTimer);
        ac.abort();
        const items = dedupeRecallItems(merged);
        logger.info('[MemoryFanIn] proceeding', {
          reason,
          requestId: ctx.requestId,
          itemCount: items.length,
          sourceCount: sources.length,
        });
        resolve(items);
      };

      const budgetTimer = setTimeout(() => finish('budget'), FANIN_BUDGET_MS);

      const onUseful = () => {
        if (graceTimer || finished) return;
        graceTimer = setTimeout(() => finish('first_useful_grace'), OPTIONAL_STAGE_GRACE_MS);
      };

      for (const source of sources) {
        const startedAt = Date.now();
        void withFanInBudget(source.run(ac.signal), source.id, ac.signal)
          .then((raw) => {
            const items = Array.isArray(raw) ? raw : raw ? [raw as MemoryRecallItem] : [];
            logger.info('[MemoryFanIn] recall source ok', {
              source: source.label,
              sourceId: source.id,
              requestId: ctx.requestId,
              durationMs: Date.now() - startedAt,
              itemCount: items.length,
            });
            if (items.length > 0) {
              merged.push(...items);
              onUseful();
            }
          })
          .catch((error: unknown) => {
            const err = error instanceof Error ? error : new Error(String(error));
            if (ac.signal.aborted && /aborted/i.test(err.message)) return;
            logger.warn('[MemoryFanIn] recall source failed', {
              source: source.label,
              sourceId: source.id,
              requestId: ctx.requestId,
              durationMs: Date.now() - startedAt,
              error: err.message,
            });
          })
          .finally(() => {
            pending -= 1;
            if (pending <= 0) finish('all_settled');
          });
      }
    });
  }

  try {
    return dedupeRecallItems(await recallFromMemoryManager(ctx));
  } catch (error: unknown) {
    logger.warn('[MemoryFanIn] memory-manager recall failed', {
      requestId: ctx.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
