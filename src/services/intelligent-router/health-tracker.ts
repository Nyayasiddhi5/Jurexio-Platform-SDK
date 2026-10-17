interface HealthBucket {
  ok: number;
  fail: number;
  latencies: number[];
  lastFailureAt: number;
  lastSuccessAt: number;
}

const WINDOW_MS = 5 * 60 * 1000;
const FAILURE_THRESHOLD = 0.5;
const MAX_LATENCY_SAMPLES = 50;
const RECOVERY_PROBE_MS = 60_000;

const health = new Map<string, HealthBucket>();

function getOrInit(modelId: string): HealthBucket {
  let b = health.get(modelId);
  if (!b) {
    b = { ok: 0, fail: 0, latencies: [], lastFailureAt: 0, lastSuccessAt: 0 };
    health.set(modelId, b);
  }
  return b;
}

export function recordSuccess(modelId: string, latencyMs: number): void {
  const b = getOrInit(modelId);
  b.ok += 1;
  b.lastSuccessAt = Date.now();
  b.latencies.push(latencyMs);
  if (b.latencies.length > MAX_LATENCY_SAMPLES) {
    b.latencies = b.latencies.slice(-MAX_LATENCY_SAMPLES);
  }
}

export function recordFailure(modelId: string, _errorMessage?: string): void {
  const b = getOrInit(modelId);
  b.fail += 1;
  b.lastFailureAt = Date.now();
}

export function getHealthScore(modelId: string): number {  const b = health.get(modelId);
  if (!b) return 1;
  const now = Date.now();
  const total = b.ok + b.fail;
  if (total === 0) return 1;
  const failureRate = b.fail / total;
  const stale = now - b.lastSuccessAt > WINDOW_MS && b.fail > 0;
  if (stale && now - b.lastFailureAt > RECOVERY_PROBE_MS) {
    return 0.7;
  }
  if (failureRate >= FAILURE_THRESHOLD) {
    if (now - b.lastFailureAt < RECOVERY_PROBE_MS) {
      return 0.05;
    }
    return 0.4;
  }
  return Math.max(0.5, 1 - failureRate);
}

export function getHealthSnapshot(): Array<{
  modelId: string;
  ok: number;
  fail: number;
  failureRate: number;
  p50: number;
  p95: number;
  healthScore: number;
  lastFailureAt: number;
  lastSuccessAt: number;
}> {
  const out: ReturnType<typeof getHealthSnapshot> = [];
  for (const [modelId, b] of health.entries()) {
    const total = b.ok + b.fail;
    const sorted = [...b.latencies].sort((a, b) => a - b);
    const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0;
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    out.push({
      modelId,
      ok: b.ok,
      fail: b.fail,
      failureRate: total ? b.fail / total : 0,
      p50,
      p95,
      healthScore: getHealthScore(modelId),
      lastFailureAt: b.lastFailureAt,
      lastSuccessAt: b.lastSuccessAt,
    });
  }
  return out.sort((a, b) => a.modelId.localeCompare(b.modelId));
}

export function resetHealth(modelId?: string): void {
  if (modelId) health.delete(modelId);
  else health.clear();
}

/**
 * NV-LLM-DEADLINE-001 — measured p50 latency for a model, or undefined when we
 * have too few samples to be meaningful.
 *
 * Used to SKIP a rung whose typical latency already exceeds the time the request
 * has left, so the cascade degrades to a faster tier instead of opening a call
 * that is certain to be cut (and billed). `MIN_SAMPLES` guards against a single
 * cold-start outlier permanently blacklisting a healthy model.
 */
const MIN_P50_SAMPLES = 3;

export function getModelP50Ms(modelId: string): number | undefined {
  const b = health.get(modelId);
  if (!b || b.latencies.length < MIN_P50_SAMPLES) return undefined;
  const sorted = [...b.latencies].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length * 0.5)];
}
