/**
 * Orchestration Concurrency Governor
 * NYV-ORCH-GOV-001 (Task #32)
 *
 * Process-wide concurrency caps that complement the per-plan
 * `maxConcurrentNodes` limits. Two independent dimensions are guarded:
 *
 *   1. PER-TENANT  — every tenant gets its own slot pool. Prevents one
 *      noisy tenant from saturating the worker (queue / DAG) on behalf
 *      of another.
 *   2. PER-PROVIDER — every upstream provider (e.g. `openai`,
 *      `anthropic`, `gemini`, `deepseek`, internal `nv-router`) gets its
 *      own slot pool. Prevents fan-out across plans from blowing past
 *      the provider's rate-limit budget.
 *
 * The governor exposes:
 *   - `withTenantSlot(tenantId, fn)`
 *   - `withProviderSlot(provider, fn)`
 *   - `withSlots({ tenantId?, provider? }, fn)` — both at once
 *
 * Limits come from environment variables (PROD-tunable, fail-loud on
 * absurd values), with safe defaults:
 *
 *   ORCH_TENANT_CONCURRENCY     (default 16)
 *   ORCH_PROVIDER_CONCURRENCY   (default 24)
 *
 * Used by Queen + DAG runners — every capability invocation routed
 * through the orchestration layer must pass through `withSlots`.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('concurrency-governor');

/**
 * Single-key counting semaphore. FIFO. Backpressure is provided by
 * making `acquire()` await until a slot is available; `release()` wakes
 * the next waiter.
 */
class Semaphore {
  private inFlight = 0;
  private queue: Array<() => void> = [];
  constructor(public readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`concurrency-governor: invalid semaphore limit ${limit}`);
    }
  }
  async acquire(): Promise<void> {
    if (this.inFlight < this.limit) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.inFlight++;
  }
  release(): void {
    this.inFlight--;
    const next = this.queue.shift();
    if (next) next();
  }
  get currentInFlight(): number { return this.inFlight; }
  get currentQueued(): number { return this.queue.length; }
}

function readPositiveInt(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
    throw new Error(
      `concurrency-governor: ${envName}='${raw}' must be a positive integer`,
    );
  }
  return n;
}

const TENANT_LIMIT = readPositiveInt('ORCH_TENANT_CONCURRENCY', 16);
const PROVIDER_LIMIT = readPositiveInt('ORCH_PROVIDER_CONCURRENCY', 24);

const tenantSems = new Map<string, Semaphore>();
const providerSems = new Map<string, Semaphore>();

function tenantSem(tenantId: string): Semaphore {
  let s = tenantSems.get(tenantId);
  if (!s) {
    s = new Semaphore(TENANT_LIMIT);
    tenantSems.set(tenantId, s);
  }
  return s;
}

function providerSem(provider: string): Semaphore {
  let s = providerSems.get(provider);
  if (!s) {
    s = new Semaphore(PROVIDER_LIMIT);
    providerSems.set(provider, s);
  }
  return s;
}

export async function withTenantSlot<T>(
  tenantId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const id = tenantId ?? 'system';
  const sem = tenantSem(id);
  await sem.acquire();
  try {
    return await fn();
  } finally {
    sem.release();
  }
}

export async function withProviderSlot<T>(
  provider: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!provider) return fn();
  const sem = providerSem(provider);
  await sem.acquire();
  try {
    return await fn();
  } finally {
    sem.release();
  }
}

/**
 * Acquire both tenant and provider slots in a stable order to avoid
 * deadlocks across many concurrent callers. We always acquire the
 * tenant slot first, then the provider slot — this matches the natural
 * direction of work (tenant decides → provider executes).
 */
export async function withSlots<T>(
  opts: { tenantId?: string; provider?: string },
  fn: () => Promise<T>,
): Promise<T> {
  return withTenantSlot(opts.tenantId, () => withProviderSlot(opts.provider, fn));
}

export interface GovernorSnapshot {
  tenantLimit: number;
  providerLimit: number;
  tenants: Array<{ tenantId: string; inFlight: number; queued: number }>;
  providers: Array<{ provider: string; inFlight: number; queued: number }>;
}

export function snapshotGovernor(): GovernorSnapshot {
  const tenants = Array.from(tenantSems.entries()).map(([tenantId, s]) => ({
    tenantId, inFlight: s.currentInFlight, queued: s.currentQueued,
  }));
  const providers = Array.from(providerSems.entries()).map(([provider, s]) => ({
    provider, inFlight: s.currentInFlight, queued: s.currentQueued,
  }));
  return { tenantLimit: TENANT_LIMIT, providerLimit: PROVIDER_LIMIT, tenants, providers };
}

/**
 * Test-only reset. NEVER call from production code paths.
 * Throws in PROD to make accidental misuse fail loud.
 */
export function __resetGovernorForTests(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__resetGovernorForTests must not be called in production');
  }
  if (tenantSems.size + providerSems.size > 0) {
    logger.warn('[Governor] resetting governor state (test-only)');
  }
  tenantSems.clear();
  providerSems.clear();
}
