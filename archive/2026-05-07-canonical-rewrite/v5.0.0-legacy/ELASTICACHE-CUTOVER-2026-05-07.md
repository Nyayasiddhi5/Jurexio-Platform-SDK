---
status: COMPLETED
date: 2026-05-07T01:05:06Z
session: 8 (Upstash → ElastiCache dev cutover)
operator: replit-agent (driven by IAM user `developer`, account `789925699169`, region `ap-south-1`)
target: EC2 i-0df71e5ea1df8f588 (api.nyayasiddhi.online, 13.232.165.242)
---

# Upstash → ElastiCache cutover — dev EC2

> **Resolves** item #2 in `GO-LIVE-STATUS-2026-05-06.md §6` (OPS-DEFERRED:
> Upstash 500k quota cap) **for the EC2 dev gateway**.
> The Replit-hosted dev gateway in this workspace is still on Upstash —
> see §5 below.

## 1. What changed

| Before | After |
|---|---|
| `REDIS_URL=https://...upstash.io` (HTTPS REST, 500k req/mo cap, EXHAUSTED) | `# DISABLED-UPSTASH 20260507T010506Z: REDIS_URL=https://...` (commented out) |
| `NYV_REDIS_TCP_URL=` not present | `NYV_REDIS_TCP_URL=rediss://default:<token>@master.nyv-dev-edge-redis.4iynom.aps1.cache.amazonaws.com:6379` |
| `NYV_REDIS_WRITE_URL=` not present | `NYV_REDIS_WRITE_URL=rediss://default:<token>@master.nyv-dev-edge-redis.4iynom.aps1.cache.amazonaws.com:6379` |
| BullMQ `evalsha` → `ERR max requests limit exceeded` | All 10 queues registered cleanly; "Redis connected" + "Cache service initialized [mode: redis]" in logs |
| `/api/nv/health/full` → `redis:degraded` | `/api/nv/health/full` → `redis:healthy` |

File touched: `/opt/nyayavigya/secrets/.env.production`
Backup at: `/opt/nyayavigya/secrets/.env.production.preupstash-cutover-20260507T010506Z.bak`

## 2. ElastiCache target details (read-only reference)

| Property | Value |
|---|---|
| Replication group | `nyv-dev-edge-redis` |
| Node | `nyv-dev-edge-redis-001` |
| Engine / size | Redis, `cache.t4g.micro` |
| Mode | non-clustered (`ClusterMode=disabled`) |
| TLS in transit | enabled (`rediss://`) |
| At-rest encryption | enabled |
| AUTH token | enabled — stored in Secrets Manager `nyv-dev-edge-redis/redis/auth` |
| Primary endpoint | `master.nyv-dev-edge-redis.4iynom.aps1.cache.amazonaws.com:6379` |
| VPC | `vpc-0c1e86766f2a5bb65` (same as EC2) |
| Status | `available` |

## 3. Verification (live, 2026-05-07T01:05:32Z)

### 3.1 Local container health (from inside EC2)

```json
{
  "status": "degraded",
  "redis": { "status": "healthy" },
  "db":    { "status": "healthy" },
  "llm":   { "status": "healthy" }
}
```

(`status: degraded` is unchanged-from-baseline — payment, whatsapp,
and error_tracking are unrelated and were already degraded; redis is
the one that flipped from `degraded` → `healthy`.)

### 3.2 Public endpoint health (`https://api.nyayasiddhi.online`)

| Endpoint | Status |
|---|---|
| `GET /api/nv/health` | 200 (61 ms) |
| `GET /api/nv/health/full` → `top:degraded, db/redis/llm/agents/jwt: healthy` | 200 (101 ms) |
| `GET /api/nv/openapi.json` | 308 (redirect — different mount on prod EC2 build) |
| `GET /api/nv/drift/agents` | 404 (Session 7 endpoint not yet deployed to this EC2 build) |

### 3.3 Gateway log highlights post-restart

```
[redis-cache]      Redis connected
[redis-cache]      Redis cache service initialized
[index]            ✓ Cache service initialized [mode: redis]
[bullmq-queue]     queue registered  nyv-webhook-delivery
[bullmq-queue]     queue registered  nyv-doc-parse
[bullmq-queue]     queue registered  nyv-doc-summarize
[bullmq-queue]     queue registered  nyv-platform-relay
[bullmq-queue]     queue registered  nyv-pqc-sign
… (10 queues + 5 DLQs)
```

Zero `ERR max requests limit exceeded` messages since restart.

### 3.4 Known caveats from this cutover

- **PII vault Redis init race** (one-time on cold start):
  `[PiiVault] Redis init failed (Stream isn't writeable and
  enableOfflineQueue options is false) — DEGRADED: falling back to
  in-memory PII vault.` This happens because the PII-vault startup
  hook fired before the ioredis client finished its TLS handshake.
  **Impact:** single-instance dev unaffected. Multi-pod prod would
  not be able to detokenize cross-pod for the brief window before
  next reconciliation. Fix is to add a `await client.ping()` gate
  in `src/startup/nv-pii-vault-cleanup.ts` before the cleanup pass.
  Filed as a small follow-up for the EC2 prod deploy.

- **SDK key auth still 401 against EC2** (`gateway/agents`,
  `gateway/usage` with NSP key from Replit secrets) — the EC2 box
  has its own RDS database and different SDK keys than the Replit
  dev DB. Not a regression from this cutover; expected.

## 4. Rollback (≤30 s, fully reversible)

Run from any host with SSM permissions, or directly on the EC2 box:

```bash
sudo mv /opt/nyayavigya/secrets/.env.production.preupstash-cutover-20260507T010506Z.bak \
       /opt/nyayavigya/secrets/.env.production
sudo docker restart nyv-gateway
# Wait ~10s, then:
curl -fsS http://127.0.0.1:5000/api/nv/health/full | jq '.services.redis'
```

The Upstash REDIS_URL is preserved in the backup and will become
active again on restart. ElastiCache cluster remains running and idle
(billing is unaffected since it stays provisioned).

## 5. What this does NOT fix

The **Replit-hosted dev gateway in this workspace** (port 5000,
workflow `NYV Gateway`) is still on Upstash because Replit cannot
reach the private VPC ElastiCache endpoint. Three options to address:

| Option | Effort | Notes |
|---|---|---|
| **A. Bump Upstash dev plan** to next tier (≥5 M req/mo) | < 5 min, billing change | Cheapest; preserves the Replit dev workflow as-is. Recommended for the next 2-3 weeks until prod cutover. |
| **B. Make ElastiCache reachable from Replit** via a public Redis bastion (NAT'd EC2 with TLS+AUTH proxy or AWS Global Accelerator) | ~1 d, ops | Eliminates the second Redis. Higher risk surface. |
| **C. Accept Replit dev runs in-memory rate-limit fallback** and treat EC2 (`api.nyayasiddhi.online`) as the canonical dev environment for any test that exercises distributed state | 0, decision-only | Already supported by the codebase (`nv-rate-limit-middleware.ts` falls back gracefully). |

Recommendation: **A for now, plan C as the long-term posture.**

## 6. Re-run the test sweep

With the EC2 gateway healthy, you can now run the smoke harness against
the public endpoint to verify the 6 LLM-research timeouts have cleared:

```bash
bash nyayavigya-platform-312/scripts/nv-smoke-bash.sh https://api.nyayasiddhi.online
```

(Use SDK keys provisioned for the EC2 RDS database — not the Replit dev
keys; see §3.4.)

## 7. Audit trail

- SSM command id: `084c749e-a52d-4be3-a285-58c9cc924a0d` (sent by IAM
  user `developer`).
- Token transport: fetched locally via `aws secretsmanager get-secret-value`,
  base64-encoded into the cutover script, shredded on EC2 after run, never
  written to chat / command line / logs.
- Pre-cutover backup retained at the same path with `.bak` suffix; safe
  to delete after 7 days of stable operation.
