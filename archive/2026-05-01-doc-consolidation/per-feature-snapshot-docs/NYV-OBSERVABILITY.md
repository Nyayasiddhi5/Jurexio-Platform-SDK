# NYV Observability — Task #28 Operational Reliability

**Platform:** Nyayavigya v3.1.2 (frozen pre-GA)
**Last updated:** 2026-04-25
**Scope:** Circuit breakers, queue health, BullMQ disable behaviour, `/admin/health/full` snapshot, span schema

This document describes the observability surfaces added under Task #28. All endpoints, metric names, and span tags below are grounded in code present on `main` — when the code changes, this doc must change with it.

---

## 1. Endpoints

| Path | Auth | Purpose |
|---|---|---|
| `GET /api/nv/health/live` | none | Kubernetes liveness — is the process running |
| `GET /api/nv/health/ready` | none | Kubernetes readiness — fails on P0 issues (DB unreachable, etc.) |
| `GET /api/nv/health/full` | none (PUBLIC, redacted) | Public status page — high-level component status, no secrets, no request IDs |
| `GET /api/nv/admin/health/full` | `authenticateToken + requireAdmin` | Operator full snapshot — breaker stats, queue depths, LLM provider health, p50/p95 latencies, RAG corpus stats |

Both `/health/full` paths share the **same router** (`src/routes/nv-health-full-routes.ts`); the `/admin/...` mount path triggers the un-redacted code path.

---

## 2. Circuit Breaker Section

The breaker registry lives in `src/services/circuit-breaker.ts`. Each named breaker is created lazily on first use via `runWithRetryAndBreaker(name, fn, surface, opts)`.

### Naming convention

| Surface | Name pattern | Example |
|---|---|---|
| Outbound LLM | `llm:<providerId>` | `llm:openai`, `llm:anthropic`, `llm:openrouter` |
| Outbound HTTP | `http:<host>` | `http:api.openai.com` |
| DB pool | `db:<poolName>` | `db:default` |

### `/admin/health/full` → `breakers` block

```json
{
  "breakers": {
    "llm:openai": {
      "state": "closed",          // closed | halfOpen | open
      "fires": 142,                // total invocations
      "successes": 138,
      "failures": 4,
      "rejects": 0,                // calls rejected because breaker was open
      "fallbacks": 0,
      "timeouts": 0,
      "openedAt": null,
      "errorRatePct": 2.8
    },
    "llm:anthropic": { "state": "open", "openedAt": "2026-04-25T11:42:13.118Z", ... }
  }
}
```

### Policy (per surface)

| Surface | errorThresholdPercentage | rollingCountTimeout | resetTimeout (half-open) | timeout |
|---|---|---|---|---|
| `outbound:llm` | 50% | 30s | 30s | 60s |
| `outbound:http` | 50% | 30s | 15s | 30s |
| `db:read` | 60% | 10s | 10s | 5s |

When a breaker opens, `runWithRetryAndBreaker` throws synchronously without invoking the wrapped function. In `real-llm-service.ts::executeWithFallback`, this is the signal to rotate to the next provider in `GLOBAL_FALLBACK_CHAIN` (see `src/services/ns-lrm-router.ts`).

---

## 3. Queue Health (BullMQ)

### Disable behaviour

BullMQ is **disabled at boot** when `NYV_REDIS_TCP_URL` is missing or invalid. The validator lives in `src/utils/redis-tcp-url.ts`:

- `isValidRedisTcpUrl(url)` — must start with `redis://` or `rediss://`
- `getValidRedisTcpUrl()` — returns the URL or `null`
- `getRedisDisabledReason()` — returns a human-readable reason (`"NYV_REDIS_TCP_URL not set"`, `"NYV_REDIS_TCP_URL set but does not start with redis:// or rediss://"`, etc.)

When disabled:

1. `bullmq-queue.ts` exports `isQueueEnabled = false`.
2. `enqueueJob`, `registerWorker`, `getQueue` become safe no-ops that return `null`/resolved promises — callers do not need to null-check `isQueueEnabled` first.
3. `queue-workers.ts::startWorkers()` early-returns.
4. **One** `WARN` line is emitted at boot per disabled subsystem (queue, rate-limiter), not per-call.

### `/admin/health/full` → `queues` block

```json
{
  "queues": {
    "enabled": false,
    "reason": "NYV_REDIS_TCP_URL set but does not start with redis:// or rediss://"
  }
}
```

When enabled and live:

```json
{
  "queues": {
    "enabled": true,
    "live": true,
    "queues": {
      "nyv-orchestration": { "waiting": 3, "active": 1, "completed": 1402, "failed": 12, "delayed": 0 },
      "nyv-document-processor": { "waiting": 0, "active": 0, "completed": 88, "failed": 0, "delayed": 0 }
    }
  }
}
```

---

## 4. WRONGPASS Spam Suppression

**Symptom (pre-fix):** logs filled with `[ioredis] Unhandled error event: WRONGPASS invalid username-password pair` several times per second.

**Fix (T001):**

- `src/middleware/nv-redis-platform-rate-limiter.ts` detects `WRONGPASS`/`NOAUTH` on the first attempt, logs **once** (`WARN [RateLimit] ioredis auth failed (WRONGPASS) — falling back to in-memory rate limiting`), flips `_runtimeDisabled = true`, calls `client.disconnect()`, and never re-creates the client until process restart.
- `src/routes/nv-health-full-routes.ts::checkRedis()` attaches `client.on('error', () => {})` **before** `connect()` so probe-time auth failures don't surface as unhandled events.

**Expected steady-state log noise:** exactly two boot-time WARN lines per Gateway start — no per-request spam.

---

## 5. LLM Provider Stats

Source: `RealLLMService.getProviderHealth()` (in-memory rolling counters).

### `/admin/health/full` → `llmProviders` block

```json
{
  "llmProviders": [
    { "providerId": "openai",    "enabled": true,  "healthy": true,  "consecutiveFailures": 0, "lastSuccess": "2026-04-25T11:43:02Z", "rps": 1.4 },
    { "providerId": "anthropic", "enabled": true,  "healthy": false, "consecutiveFailures": 5, "lastError": "401 Unauthorized" },
    { "providerId": "deepseek",  "enabled": false, "reason": "provider disabled in BUILT_IN_PROVIDERS" }
  ],
  "llmBreakers": {
    "llm:openai":    { "state": "closed", "errorRatePct": 0.7 },
    "llm:anthropic": { "state": "open",   "errorRatePct": 100 }
  }
}
```

Provider enable/disable is sourced from `src/config/nyv-dynamic-model-registry.ts::BUILT_IN_PROVIDERS`. To flip a provider, edit that file's `enabled` flag and restart — no per-model config needed.

---

## 6. Span Schema (Tracer)

The tracer (`src/utils/nyv-tracer.ts`) backs onto `@sentry/node` when `NYV_SENTRY_DSN` is set, otherwise emits **JSONL spans** via the structured logger. Both backends produce the same span shape so dashboards and queries are portable.

### Span lifecycle

```ts
import { startSpan, withSpan } from '../utils/nyv-tracer.js';

const root = startSpan('queen.orchestrate', {
  op: 'queen.orchestrate',
  attributes: { orchestrationId, jurisdiction, tier, subtaskCount },
});
try {
  await withSpan('queen.rag', { parent: root }, async (child) => { ... });
  await withSpan('queen.decompose', { parent: root }, async (child) => { ... });
  await withSpan('queen.execute', { parent: root }, async (child) => { ... });
  await withSpan('queen.synthesis', { parent: root }, async (child) => { ... });
  root.setStatus('ok');
} catch (e) {
  root.setStatus('error');
  throw e;
} finally {
  root.finish();
}
```

### Queen lifecycle spans (instrumented in `src/orchestration/nv-queen-orchestrator.ts`)

| Span name | Where | Tags |
|---|---|---|
| `queen.orchestrate` | root, line 799 | `orchestrationId`, `jurisdiction`, `tier`, `subtaskCount`, `durationMs`, `status` |
| `queen.rag` | line 837 | `parent=queen.orchestrate`, `chunksRetrieved`, `latencyMs` |
| `queen.memory` | line 929 | `parent=queen.orchestrate`, `tier` (L1–L5), `hits`, `misses` |
| `queen.decompose` | line 955 | `parent=queen.orchestrate`, `pattern`, `subtaskCount` |
| `queen.execute` | line 1030 | `parent=queen.orchestrate`, `pattern`, `agentCount`, `failedCount` |
| `queen.synthesis` | line 1059 | `parent=queen.orchestrate`, `outputTokens` |
| `queen.agent` | line 2096 | `parent=queen.execute`, `agentId`, `agentTier`, `model`, `provider` |

### `/admin/health/full` → `tracer` block

```json
{
  "tracer": {
    "backend": "sentry",            // or "jsonl"
    "dsnConfigured": true,
    "spanLatencies": {
      "queen.orchestrate": { "count": 142, "p50Ms": 1840, "p95Ms": 4120, "p99Ms": 7800 },
      "queen.rag":         { "count": 142, "p50Ms":  220, "p95Ms":  580, "p99Ms": 1100 },
      "queen.execute":     { "count": 142, "p50Ms":  920, "p95Ms": 2400, "p99Ms": 5200 }
    },
    "spanLatenciesByTag": {
      "queen.orchestrate": {
        "jurisdiction": {
          "IN": { "count": 88, "p50Ms": 1720, "p95Ms": 3900 },
          "UK": { "count": 41, "p50Ms": 2010, "p95Ms": 4400 }
        },
        "tier": {
          "1": { "count": 12, "p50Ms": 4200 },
          "2": { "count": 67, "p50Ms": 1900 },
          "3": { "count": 63, "p50Ms": 1340 }
        }
      }
    }
  }
}
```

The latency ring buffer is in-memory (last 256 samples per `name × tag-key × tag-value`) and resets on Gateway restart. For long-horizon analysis, set `NYV_SENTRY_DSN` and use Sentry Performance.

---

## 7. Smoke Test

```bash
cd nyayavigya-platform-312
NYV_API_BASE=http://localhost:5000 npx tsx scripts/nv-smoke-task28.ts
```

The script:
1. Registers a fresh user, captures JWT.
2. Fires 10 sequential `POST /api/nv/orchestrate` calls.
3. Snapshots `/api/nv/admin/health/full` and asserts `breakers`, `queues`, `llmProviders`, `tracer.spanLatencies` are all present.
4. Verifies at least one `llm:<provider>` breaker has `fires > 0`.

To force-open a breaker (manual test only):

```bash
OPENROUTER_API_KEY=BREAK_ME bash scripts/nv-start-dev.sh
# in another shell
npx tsx scripts/nv-smoke-task28.ts
# then: curl localhost:5000/api/nv/admin/health/full | jq '.breakers."llm:openrouter"'
# expect: { "state": "open", "openedAt": "2026-04-25T..." }
```

---

## 8. Operator Runbook — common conditions

| Condition (in `/admin/health/full`) | Likely cause | Action |
|---|---|---|
| `redis.status = degraded`, `setup_required = true` | `NYV_REDIS_TCP_URL` not set or malformed | Set a `rediss://` Upstash URL in secrets, restart |
| `queues.enabled = false` | Same as above (BullMQ refuses to start without valid TCP URL) | Same |
| `breakers["llm:<X>"].state = open` | Provider returning 5xx/401 above 50% in last 30s | Check provider status page; rotate API key; flip `BUILT_IN_PROVIDERS[<X>].enabled = false` to remove from rotation |
| `llmProviders[].consecutiveFailures > 5` and breaker still `closed` | Failure mode below threshold or new failures | Inspect `lastError`; check key validity |
| `tracer.spanLatencies["queen.orchestrate"].p95Ms > 8000` | Slow RAG / slow LLM / DB contention | Drill into `spanLatenciesByTag` to find which jurisdiction/tier is slow; check `db.query.p95Ms` |
| Logs contain `WRONGPASS` more than 2x per boot | The warn-once latch is not engaging | Check `nv-redis-platform-rate-limiter.ts` for regression |

---

## 9. Change history

- **2026-04-25** — Initial commit (Task #28). Document T001 (Redis URL validator), T002 (LLM opossum breakers), T003 (Queen lifecycle spans), T004 (`/admin/health/full`).
