---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Observability

Three layers, in priority order:

1. **Sentry** — application errors + traces, per-tenant.
2. **CloudWatch** — infrastructure metrics, logs, alarms, dashboards.
3. **Caddy access logs** — JSON, last 7 days × 50 MB rolled.

## Sentry

| Item | Detail |
|---|---|
| DSN secret | `nyayavigya/prod/gateway/sentry_dsn` |
| Release tag | the deploy id from `scripts/deploy-replit-direct.sh` |
| Environment | `prod` / `staging` |
| Per-tenant tag | `tenant=<organization_id>` set by middleware |
| Sample rate | 1.0 for errors, 0.1 for traces |

Project setup: a single project (`nyayavigya-gateway`) with environment-
based filtering. Every span carries `nyv.tenant`, `nyv.platform_code`,
`nyv.deploy_id` so you can filter "errors from NYM in the last hour" easily.

## CloudWatch logs

| Log group | Retention | Source |
|---|---|---|
| `/aws/nyayavigya/prod/gateway` | 30d | gateway-a, gateway-b |
| `/aws/nyayavigya/prod/console` | 30d | console |
| `/aws/nyayavigya/prod/caddy` | 30d | caddy |
| `/aws/nyayavigya/prod/{nym,nsp,nsi,nsa,nsm}` | 30d | each partner container |
| `/aws/nyayavigya/staging/*` | 30d | staging mirrors |

The `awslogs` Docker logging driver ships container stdout/stderr. The
gateway code logs in **JSON Lines** (`{ts, level, msg, ...}`) so you can use
CloudWatch Logs Insights filters like:

```
fields @timestamp, level, msg, tenant, route
| filter level = "error" and tenant = "nsp"
| sort @timestamp desc
| limit 100
```

## CloudWatch alarms

| Alarm | Threshold | Action |
|---|---|---|
| `nyv-prod-alb-5xx` | ALB 5xx > 10 / minute, 2 min sustained | SNS → email |
| `nyv-prod-target-5xx` | Target 5xx > 20 / min, 2 min | SNS → email |
| `nyv-prod-rds-cpu` | RDS CPU > 80%, 5 min | SNS → email |
| `nyv-prod-rds-storage-low` | Free < 5 GB | SNS → email |
| `nyv-prod-redis-cpu` | Redis EngineCPU > 75%, 5 min | SNS → email |

The SNS topic is `nyayavigya-prod-alarms`. The operator subscribes their
ops email via `var.alarm_email` in `terraform.tfvars`.

PagerDuty integration is documented but not provisioned — when needed, add a
`https` SNS subscription pointing at the PD inbound URL.

## CloudWatch dashboard

`Nyayavigya-prod` (also `-staging`). Four widgets:

1. ALB requests + 5xx (1-min sum)
2. ALB target latency p95
3. RDS CPU + connections
4. Redis CPU + bytes used

Add new widgets by editing `infra/terraform/modules/cloudwatch/main.tf` and
`terraform apply`.

## Caddy access logs

Format: JSON, written to `/var/log/caddy/access.log` inside the container,
mounted to the `caddy-logs` Docker volume. Rotated at 50 MB × 7.

For ad-hoc analysis:

```bash
ssh ubuntu@13.232.165.242 'docker exec nyv-caddy tail -n 1000 /var/log/caddy/access.log' \
  | jq 'select(.status >= 400) | {ts, host: .request.host, uri: .request.uri, status}'
```

## SLOs (initial — refine after 30 days of baseline)

| Service | SLI | Target |
|---|---|---|
| `api.nyayasiddhi.online` | success rate (non-5xx) | 99.5% |
| `api.nyayasiddhi.online` | p95 response time | < 1.2s for `/v1/chat`, < 250ms for `/v1/branding/*` |
| RDS | availability | 99.9% (multi-AZ guarantees this) |

## Health endpoints

| Endpoint | What it returns |
|---|---|
| `/health` | `200 ok` (process alive) |
| `/api/nv/health` | `{ db: ok, redis: ok, ts }` |
| `/api/nv/health/full` | full dependency map (slower; for status pages only) |

`status.nyayasiddhi.online` is wired to `/health` + `/metrics`. We do not
expose `/api/nv/health/full` publicly because it leaks dependency names.

---

## Task #28 — Operational reliability

### Circuit breakers (opossum)

Every outbound surface (LLM, queue enqueue, RAG retrieval) is wrapped by a
named opossum breaker registered through `src/services/circuit-breaker.ts`.
Policies live in `getBreakerPolicy(surface)`:

| Surface | Timeout | Error % | Volume threshold | Window | Reset |
|---|---|---|---|---|---|
| `outbound:llm` | 60s | 60% | 5 calls | 60s | 45s |
| `outbound:queue` | 10s | 50% | 5 | 30s | 30s |
| `outbound:rag` | 30s | 60% | 5 | 60s | 30s |

All four surfaces — `outbound:capability`, `outbound:llm`, `outbound:db`,
`outbound:http`, `outbound:integration`, `outbound:queue`, `outbound:rag`
— are first-class `BreakerSurface` values in `circuit-breaker.ts`, each
with a registered policy in `DEFAULT_POLICIES`.

LLM provider calls are routed through
`runWithRetryAndBreaker(`llm:${providerId}`, …, 'outbound:llm', { maxAttempts: 1 })`
on **both** the sync path (`executeWithProvider`) and the streaming path
(`executeStreamRequest` → `streamOpenAI` / `streamAnthropic` /
`streamOpenRouter`). The two surfaces share the same per-provider
breaker, so a degraded provider trips a single circuit and BOTH paths
start fast-failing with `Breaker is open` within ~5 seconds. We pin
`maxAttempts: 1` for streaming because retrying mid-stream would replay
the SSE chunks the caller already saw.

The fallback chain in `RealLLMService.executeWithFallback` rotates to the
next provider when a breaker rejects, so the user sees a successful
response from an alternative provider rather than a 500.

`listBreakers()` returns every registered name, and `getBreakerStats(name)`
returns `{ state: 'closed' | 'open' | 'halfOpen', stats: { fires, successes, failures, timeouts, rejects, errorPercentage } }`.

### Queue health

`isQueueEnabled` (from `src/services/queue/bullmq-queue.ts`) is false when
no usable Redis TCP URL is configured. In that mode every
`enqueue*` / `getQueue` / `getQueueEvents` / `registerWorker` call
short-circuits to `null` (or a `DisabledQueueResult` for enqueue) and the
gateway logs **one** `[BullMQ] Redis TCP disabled — reason: <…>` warning
on startup instead of the previous BullMQ retry loop spamming
`WRONGPASS invalid username-password pair` once per second.

In addition to the boot-time gate there is a **runtime auth gate**: the
shared ioredis client installs a `reconnectOnError` predicate plus an
`error` listener that detects `WRONGPASS` / `NOAUTH` replies, flips
`_runtimeDisabled = true`, disconnects the socket, and stops new
reconnect attempts. After that the same no-op semantics apply for the
rest of the process lifetime — there is **no** ioredis "Unhandled error
event" spam even when the URL parses but the password is wrong (which is
also what the rate-limit middleware does for its own ioredis client at
`src/middleware/nv-rate-limit-middleware.ts`).

The `/admin/health/full` queue snapshot is `{ enabled, reason,
bootEnabled }` — `bootEnabled` records the start-up decision so an
operator can tell "we never had Redis" from "we had Redis but it
auth-failed at runtime". When enabled, `getQueueHealth()` returns
`{ [queueName]: { waiting, active, completed, failed, delayed } }` and
`isQueueLive()` / `getQueueDisabledReason()` expose the same flags
programmatically.

### `/api/nv/admin/health/full`

Operator-facing alias of `/api/nv/health/full` (same router, same payload).
Live snapshot includes:

```jsonc
{
  "services": { /* db, redis, llm, agents, jwt, payments, whatsapp, sentry, … */ },
  "breakers": {
    "llm:openai":     { "state": "closed", "stats": { … } },
    "llm:openrouter": { "state": "open",   "stats": { … } }
  },
  "queues": { "enabled": false, "reason": "Redis TCP URL not configured" },
  "llm_providers": {
    "health":   [ { "providerId": "openrouter", "available": true, … } ],
    "breakers": { "openrouter": { "state": "open", "errorPercentage": 100 } }
  },
  "tracer": {
    "backend": "jsonl",          // or "sentry" if @sentry/node + DSN present
    "dsnConfigured": false,
    "spanLatencies": {
      "queen.orchestrate": { "count": 32, "p50Ms": 4120, "p95Ms": 9100, "p99Ms": 11200, "maxMs": 12404 },
      "queen.rag":         { "count": 32, "p50Ms":   18, "p95Ms":   42, … },
      "queen.decompose":   { … },
      "queen.agent":       { … },   // per-agent span, NYV-OPS-OBS-AGENT-001
      "queen.execute":     { … },
      "queen.synthesis":   { … }
    },
    "spanLatenciesByTag": {
      "queen.orchestrate": {
        "jurisdiction": { "IN": { "count": 28, "p50Ms": 4180, "p95Ms": 9100, "p99Ms": 11200, "maxMs": 12404 } },
        "tier":         { "standard": { "count": 28, … } }
      },
      "queen.agent": {
        "agentTier": {
          "executive":  { "count": 12, "p50Ms": 6210, … },
          "specialist": { "count": 18, "p50Ms": 4180, … }
        }
      }
    }
  },
  "rag":     { "total_chunks": 1240, "distinct_jurisdictions": 6, "total_tokens": "412334", "latest_ingested_at": "…" },
  "memory":  { "backend": "in-memory", "pressure": { "status": "ok", "heapPct": 0.42 }, "tiers": { "session": 4, "longterm": 0, "social": 0 } },
  "hitl_queue": { "pending": 2, "sla_breached": 0, "total": 47 },
  "requests": {
    "totalRequests": 4128, "totalErrors": 6, "rpsLastMinute": 0.17, "windowSeconds": 60,
    "errorClassHistogram": { "401": 4, "500": 2 },
    "recentErrors": [ { "ts": "…", "method": "POST", "path": "/api/nv/orchestrate", "status": 500, "err": "…" } ]
  },
  "dashboards": {
    "sentry":     "https://sentry.io/organizations/nyayavigya/dashboards/<id>/",
    "grafana":    "https://grafana.example.com/d/<dashboard>/",
    "cloudwatch": "https://console.aws.amazon.com/cloudwatch/home?region=ap-south-1#dashboards:name=nyayavigya-prod"
  }
}
```

The dashboard URLs are read from `NYV_SENTRY_DASHBOARD_URL`,
`NYV_GRAFANA_DASHBOARD_URL`, and `NYV_CLOUDWATCH_DASHBOARD_URL`. When
unset they appear as `null` in the snapshot — the keys are always
present so an operator UI can render "Configure dashboard URL" links
without conditional logic.

A future auth middleware can be applied to `/admin/*` without breaking the
public liveness/readiness probes mounted under `/api/nv/health`.

### Span schema (Queen lifecycle)

Spans flow through `src/utils/nyv-tracer.ts`. `@sentry/node` is now a
first-class dependency in `package.json`, so the only switch operators
need to flip is `NYV_SENTRY_DSN` (or the legacy `SENTRY_DSN`). When the
DSN is set, `initTracer()` calls `Sentry.init(...)` at boot and every
`startSpan(...)` is mirrored as a Sentry inactive span (root
`queen.orchestrate` becomes a transaction with `queen.rag`,
`queen.decompose`, `queen.execute`, `queen.synthesis` — and one
`queen.agent` span per agent — as children). Without a DSN, the tracer
falls back to JSONL log lines plus the 200-sample-per-name in-memory
ring buffer that powers `tracer.spanLatencies` on `/admin/health/full`.

#### Sentry-mode setup

1. **Set the DSN secret** on the gateway environment:
   ```bash
   # production
   NYV_SENTRY_DSN=https://<public-key>@o<org>.ingest.sentry.io/<project>
   # optional, defaults to 0.1
   NYV_SENTRY_TRACES_SAMPLE_RATE=0.1
   # optional, defaults to NODE_ENV
   NODE_ENV=production
   # optional, used as the Sentry release tag (defaults to nyv-<package version>)
   NYV_DEPLOY_ID=<deploy id from scripts/deploy-replit-direct.sh>
   ```
   The DSN secret is stored as `nyayavigya/prod/gateway/sentry_dsn` and
   pulled into the container via `scripts/secrets-sync.sh`.
2. **Restart the gateway.** During startup you should see
   `Tracer: Sentry backend active` in the logs (see step 3 of
   `src/index.ts`'s boot sequence). If the DSN is unset, the line will
   read `Tracer: NYV_SENTRY_DSN not set — using JSONL span fallback`.
3. **Verify the flip on the admin health endpoint:**
   ```bash
   curl -sS -H "Authorization: Bearer <admin token>" \
     https://api.nyayasiddhi.online/api/nv/admin/health/full \
     | jq '.tracer'
   # expected:
   # {
   #   "backend": "sentry",
   #   "dsnConfigured": true,
   #   "spanLatencies": { ... }
   # }
   ```
   If `backend` still reads `"jsonl"` after a restart, the DSN didn't
   make it into the process — check `printenv NYV_SENTRY_DSN` inside the
   container and re-run `secrets-sync.sh`.
4. **Run one orchestration** (e.g. via `scripts/nv-smoke-task28.ts` or
   any `/api/nv/orchestrate` call) and open the Sentry **Performance**
   tab. You should see a transaction named `queen.orchestrate` with
   five children — `queen.rag`, `queen.decompose`, `queen.execute`,
   `queen.synthesis`, and one `queen.agent` per agent invoked — each
   carrying the tags listed in the table below. Use the
   `orchestrationId` tag to join the trace back to the AG-UI event
   stream (NYV-ORCH-EVENT-CORRELATION-001).
5. **Sample-rate tuning.** Sentry only ingests `tracesSampleRate` of
   transactions (default `0.1` = 10%); raise temporarily to debug a
   slow tenant. JSONL fallback and the in-memory ring buffer are
   unaffected by the sample rate, so `tracer.spanLatencies` always
   reflects 100% of orchestrations.

#### Local smoke for the Sentry flip

`scripts/nv-smoke-task39-sentry-tracer.ts` is a black-box runner that
spawns the tracer twice — once without `NYV_SENTRY_DSN`, once with — and
asserts `getTracerStatus().backend` flips from `jsonl` to `sentry` and
that `startSpan(...).sentryBacked` is `true` in the second run. Use it
after any change to `src/utils/nyv-tracer.ts`:

```bash
cd nyayavigya-platform-312
npx tsx scripts/nv-smoke-task39-sentry-tracer.ts
# expect: "✓ Task #39 smoke PASSED — tracer flips between jsonl and sentry on demand"
```

Root span: `queen.orchestrate`. Children:

| Span | Tags |
|---|---|
| `queen.orchestrate` | `orchestrationId`, `jurisdiction`, `tier`, `orchestrationPattern`, `type`, `userId`, `totalMs`, `agentsUsed`, `totalTokens`, `outputChars` |
| `queen.rag`         | `orchestrationId`, `jurisdiction`, `chunkCount`, `retrievalMethod` |
| `queen.memory`      | `orchestrationId`, `jurisdiction`, `tier`, `pressureStatus` (`ok` / `elevated` / `critical`), `heapPct`, `sessionEntries`, `longtermEntries`, `socialEntries` — point-in-time snapshot at start of run |
| `queen.decompose`   | `orchestrationId`, `jurisdiction`, `tier`, `orchestrationPattern`, `subtaskCount`, `algorithm` |
| `queen.agent`       | `orchestrationId`, `agentId`, `agentTier` (`executive` / `senior` / `specialist` / …), `jurisdiction`, `subtaskId`, `tokens`, `latencyMs` |
| `queen.execute`     | `orchestrationId`, `jurisdiction`, `tier`, `orchestrationPattern`, `subtaskCount`, `executionCount`, `successCount` (also exports legacy `pattern` alias) |
| `queen.synthesis`   | `orchestrationId`, `jurisdiction`, `tier`, `orchestrationPattern`, `outputChars` |

Every span finishes with `status: 'ok' | 'error'` plus an `errorMessage`
tag on failure. Use `orchestrationId` to join span output back to the
AG-UI event stream (NYV-ORCH-EVENT-CORRELATION-001, Task #27).

The tracer also publishes a **tag-bucketed view** through
`getTaggedSpanLatencies()` (surfaced as `tracer.spanLatenciesByTag` on
`/admin/health/full`). The buckets are driven by `TRACKED_TAG_KEYS =
['orchestrationPattern', 'jurisdiction', 'tier', 'agentTier']` in
`src/utils/nyv-tracer.ts`, so a single GET tells you the p50/p95/p99/max
for "queen.orchestrate by jurisdiction=IN" or "queen.agent by
agentTier=executive vs specialist" without leaving the admin endpoint.

### Request metrics

`src/middleware/nyv-request-metrics.ts` is mounted at the top of the
gateway and tracks every HTTP request in a 60-second rolling window. The
snapshot under `requests.*` on `/admin/health/full` exposes:

| Field | Meaning |
|---|---|
| `totalRequests` / `totalErrors` | lifetime totals |
| `rpsLastMinute` | rolling RPS over the last 60s |
| `windowSeconds` | window length (always 60) |
| `errorClassHistogram` | count of `4xx` / `5xx` responses keyed by status |
| `recentErrors` | last 100 error rows: `{ ts, method, path, status, err }` |

This is intentionally lightweight (no Prometheus/CloudWatch dependency)
so the same JSON works in dev, replit, and prod without extra infra.

### Smoke test

Run after deploy or any change touching breakers/spans/queues:

```bash
cd nyayavigya-platform-312
NYV_GATEWAY_BASE=http://127.0.0.1:5000 \
  npx tsx scripts/nv-smoke-task28.ts
```

Registers a fresh user, fires 10 orchestrations, prints p50/p95/max, then
asserts that `breakers`, `queues`, `llm_providers`, and
`tracer.spanLatencies` are all present on `/admin/health/full`. To force a
breaker open end-to-end, restart the Gateway with
`OPENROUTER_API_KEY=BREAK_ME` and re-run.

## Operator dashboard KPIs (Task #28 round 11)

The reviewer flagged three KPIs as needing first-class fields rather
than being derivable from spans alone. Each maps directly to a
panel on the operator dashboard:

| Dashboard panel | Field on `/api/nv/admin/health/full` | Source |
|---|---|---|
| **LLM prompt-cache hit rate** | `prompt_cache.llm_prompt_cache.hitRate` (0–1, also `hits`, `misses`, `entries`, hot/warm/cold split, `evictionCount`, `estimatedLatencySavedMs`) | `lmCacheService.getStats()` |
| **KV cache hit rate** | `prompt_cache.kv_cache.hitRate` (string %), `mode` (`redis` / `in-memory-lru`) | `nvRedisCache.getStats()` |
| **RAG retrieval hit rate** | `rag_retrieval.hitRate` (0–1), `rag_retrieval.attempts`, `rag_retrieval.avgLatencyMs`, plus `rag_retrieval.byMethod[vector\|hybrid\|bm25\|none]` for "is vector search degrading?" | `getRagRetrievalStats()` in `src/services/rag-service.ts` (in-process counters, NYV-OBS-RAG-HITRATE-001) |
| **RAG recall latency (p50/p95)** | `tracer.spanLatencies['queen.rag']` end-to-end **and** `rag_retrieval.avgLatencyMs` for retrieval-only | tracer + RAG counter |
| **Memory recall hit rate** | `memory.tiers.session.hitRate` (0–1) | `nvMemoryManager.getStats().session.hitRate` |
| **LLM provider streaming fallback** | `llm_providers.health[].successRate` per provider; rotation logged at `WARN` as `stream provider 'X' failed (…); rotating to next provider` | `executeStreamRequest` walks `getFallbackProviders()` chain (NYV-OPS-LLM-STREAM-FALLBACK-001) |
| **Per-provider breaker state** | `llm_providers.breakers[provider]` (state `closed`/`open`/`halfOpen`, errorRate, lastFailure) | opossum via `getLlmProviderBreakerSnapshot()` |
| **All other named breakers** | `breakers[name]` (e.g. `llm:openai`, `llm:openrouter`, `outbound:llm`) | `listBreakers()` + `getBreakerStats()` |
| **Queue depths** | `queues.queues[name]` when `queues.enabled=true`, otherwise `queues.reason` (e.g. `Redis TCP URL not configured`) | `getQueueHealth()` |
| **Tracer pattern × jurisdiction × tier × agent-tier breakdown** | `tracer.spanLatenciesByTag[spanName][tagKey][tagValue]` p50/p95/p99/max | `getTaggedSpanLatencies()`; tags driven by `TRACKED_TAG_KEYS` |

### Streaming fallback chain

`executeStreamRequest` (in `src/services/real-llm-service.ts`) builds
the chain `[primary, ...getFallbackProviders(primary)]` and walks
each in order. Per-provider failure (open breaker, network error,
4xx/5xx, breaker timeout) is caught and logged at `WARN`; we move to
the next provider in the chain rather than surfacing `Error: …` to
the SSE client. A final terminal `Error: …` chunk is emitted **only**
after every provider in the chain has failed. Each provider call
runs through the same named opossum breaker (`llm:${providerId}`) as
the synchronous path, so a degraded provider trips one shared
circuit visible on both surfaces.

### What is *not* on `/admin/health/full`

By design, the public `/api/nv/health/full` path returns ONLY
`status / platform / services{name:{status}}` with all detail and
operator surfaces redacted (NYV-OBS-PUBLIC-REDACT-001). The full
detail above is admin-only and gated by
`authenticateToken + requireAdmin`.
