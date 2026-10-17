---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Redis + Mem0 setup

## Redis (ElastiCache 7.1)

| Setting | Value |
|---|---|
| Engine | Redis 7.1 |
| Node type | `cache.t4g.small` (prod) / `cache.t4g.micro` (staging) |
| Replicas | 1 (prod, multi-AZ failover) / 0 (staging) |
| In-transit encryption | enabled (TLS) |
| At-rest encryption | enabled |
| AUTH token | random 40-char, stored at `nyv-prod-redis/redis/auth` |
| Snapshot retention | 7 days |
| Snapshot window | 18:30-19:30 UTC (00:00-01:00 IST) |
| Maintenance | Sun 19:30-20:30 UTC |

### Connecting from the gateway

The container reads:

```
REDIS_URL=rediss://:<auth-token>@<primary-endpoint>:6379/0
```

The auth token is resolved at container start by `secrets-entrypoint.sh`
from `nyv-prod-redis/redis/auth`. The gateway uses `db 0` for caching +
session storage; the staging compose pins `NYV_REDIS_DB=1` so dev traffic
never collides with prod even on the same physical Redis (the staging RDS
and Redis are still separate instances; the `db 1` pinning is belt-and-
braces).

### Sizing notes

`cache.t4g.small` = 1.55 GiB. For ~1M sessions with average 2 KB payload,
memory usage is around 2 GB *if* every session is hot. In practice, the
gateway sets a 30-day TTL and only ~10% are hot, so we comfortably fit in
the small node. Bump to `cache.t4g.medium` (3.09 GiB) once `BytesUsedForCache`
metric stays above 80% for a week.

## Mem0

Mem0 is the long-term memory layer. It does NOT use Redis for primary
storage — it persists into Postgres (`nyv_mem0` schema, `pgvector`-backed).

### Why Postgres + pgvector instead of a separate vector DB?

- We already pay for RDS multi-AZ and PITR, so embeddings inherit those
  guarantees for free.
- Vectors live next to the relational data they describe — no two-system
  consistency problem.
- pgvector with HNSW index is fast enough for our workload (≤ 1M vectors).

### Schema

```sql
CREATE SCHEMA IF NOT EXISTS nyv_mem0;
SET search_path TO nyv_mem0;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      TEXT NOT NULL,
  user_id     TEXT,
  agent_id    TEXT,
  content     TEXT NOT NULL,
  embedding   VECTOR(1536) NOT NULL,
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ
);

CREATE INDEX memory_org_idx     ON memory (org_id);
CREATE INDEX memory_user_idx    ON memory (org_id, user_id);
CREATE INDEX memory_embedding   ON memory USING hnsw (embedding vector_l2_ops);
CREATE INDEX memory_expires_idx ON memory (expires_at) WHERE expires_at IS NOT NULL;
```

### Embedding model

Default: `openai-text-embedding-3-small` (1536 dims, $0.02 / 1M tokens).
Configurable per tenant via gateway settings. For Indian-languages-heavy
tenants we recommend `cohere-embed-multilingual-v3.0`.

### Tenant isolation

Every Mem0 row carries `org_id`. The gateway service that writes/reads Mem0
ALWAYS scopes by `org_id` taken from the authenticated SDK context — never
from user input. This is what the `nv-tenant-isolation` middleware enforces
upstream.

### Retention

Default expiration: 90 days for episodic memories, indefinite for facts. A
nightly cron inside the gateway runs:

```sql
DELETE FROM nyv_mem0.memory WHERE expires_at IS NOT NULL AND expires_at < now();
```

Operator can override per-tenant via `nyayavigya/<env>/gateway/mem0_retention_days`.
