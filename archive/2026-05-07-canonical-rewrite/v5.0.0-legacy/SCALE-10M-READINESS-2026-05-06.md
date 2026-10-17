# Nyayavigya Scale Readiness — Path to 10M Rows

**Date**: 2026-05-06
**Status**: Pre-EC2-deploy assessment
**Target**: 10M rows in `ns_parsed_documents`, `ns_rag_document_chunks`, `sdk_usage_metrics`, `nv_audit_chain` within 18 months

---

## 1. Per-table scale readiness (top 10 hot tables)

| Table | Current row count | Projected 18mo | Has indexes? | Partition strategy | Verdict |
|---|---|---|---|---|---|
| `ns_parsed_documents` | <10K | 10M | ✅ `(org, doc)`, uniq `(job)` | Range-partition by `created_at` (monthly) | 🟢 Ready w/ partition plan |
| `ns_rag_document_chunks` | <100K | 200M (20× docs) | (verify) | Hash-partition by `org_id` (16 shards) | 🟠 Needs partition before 1M |
| `sdk_usage_metrics` | <50K | 50M (every API call) | (verify) | Range-partition by `created_at` (weekly) + drop after 90d | 🔴 Critical — no partition yet |
| `nv_audit_chain` | <10K | 100M | (verify) | Append-only, monthly partition + cold-tier S3 archive >12mo | 🔴 Critical — hash chain needs careful partition |
| `ns_doc_processing_jobs` | transient | 1M concurrent | ✅ `(status, prio, created)` poller idx | Drop completed >7d via partition swap | 🟠 Add TTL worker |
| `nv_agent_executions` | <50K | 500M | (verify) | Range-partition by `created_at` (daily) | 🔴 Critical |
| `hitl_decisions` | <10K | 5M | (verify) | None needed | 🟢 |
| `nv_llm_usage` | <50K | 100M | (verify) | Range-partition + hot/cold | 🔴 Critical |
| `nv_pii_redaction_log` | <10K | 50M | (verify) | Drop >180d (DPDPA) | 🟠 |
| `nv_routing_decisions` | <10K | 100M | (verify) | Drop >30d, summary rolled up | 🔴 Critical |

---

## 2. Connection pool & concurrency

- **Current**: `@neondatabase/serverless` HTTP-fetch transport (no native pool, each query = HTTP round-trip)
- **At 10M scale**: switch to `@neondatabase/serverless` WebSocket transport OR migrate to `pg` with `pg-pool` against AWS RDS Proxy
- **RDS Proxy**: required at >100 concurrent gateway instances (each Express worker)
- **Recommended pool size**: `max=20` per worker; RDS Proxy multiplexes to ~50 backend connections per RDS instance

---

## 3. Read replica strategy

| Workload | Target replica | Notes |
|---|---|---|
| Analytics dashboards (`/superadmin/*`) | `read-replica-1` | Eventual consistency OK |
| RAG search (`ns_rag_document_chunks` SELECT) | `read-replica-2` (with pgvector) | Latency-critical; co-locate with gateway AZ |
| Audit chain reads (compliance reports) | `read-replica-3` | Cold; cross-AZ OK |
| All writes | Primary | Single writer, never to replica |

---

## 4. Caching layer (Redis)

| Cache key pattern | TTL | Source of truth | Used by |
|---|---|---|---|
| `nv:agent:registry:{jurisdiction}` | 1h | `Nyayavigya-Legal-registry-*.json` | Agent execution |
| `nv:sdk:key:{keyHash}` | 5m | `sdk_app_api_keys` | Auth middleware |
| `nv:rate:{platform}:{tier}:{identity}` | 60s | computed | Rate limiter |
| `nv:org:settings:{orgId}` | 10m | `nv_org_settings` | Per-request config |
| `nv:llm:budget:{orgId}:{model}` | 30s | `nv_llm_budgets` | LLM router |
| `nv:doc:status:{docId}` | until terminal | `ns_doc_processing_jobs` | Status polling |

---

## 5. Vector search at scale

- **Current**: `nv_document_embeddings.embedding: doublePrecision[]` — array column, no vector index. Sequential scan beyond 100K rows.
- **Required for 10M**:
  1. Add `pgvector` extension to RDS (`CREATE EXTENSION vector;`)
  2. Convert column type: `embedding vector(1536)` (OpenAI ada-002 dim)
  3. Build HNSW index: `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);`
  4. Hash-partition `ns_rag_document_chunks` by `org_id` so each org's vectors stay in the same shard
  5. For ANN at 100M+ scale: consider managed vector DB (Pinecone, Weaviate, Qdrant) as offload target

---

## 6. Object storage (S3)

- **Current**: `s3://nyv-documents/orgs/{orgId}/{platform}/users/{userId}/...` (Mumbai)
- **At 10M docs**: enable S3 Intelligent-Tiering on bucket (auto-tiers to IA after 30d, Glacier after 90d → 70% cost savings)
- **Lifecycle policy**: per `nv_org_retention_policies.retain_days` → auto-delete via S3 Lifecycle rules tagged with `org-{orgId}-retain-{days}`
- **Multipart cleanup**: abort incomplete multipart uploads after 7d

---

## 7. Background workers

| Worker | Schedule | Responsibility |
|---|---|---|
| `startJobPoller` (doc-processor) | every 3s | Pick `queued` → `processing`; current ✅ |
| `nv-esign-expiry-worker` (planned) | every 1h | Expire pending sign sessions past `expires_at` |
| `nv-retention-purge-worker` (planned) | daily 02:00 IST | Soft-delete docs past `retain_until`; hard-delete 30d after soft |
| `nv-webhook-dispatcher` (planned) | every 5s | Pick pending webhooks, deliver, retry with backoff |
| `nv-llm-budget-rollup` (planned) | every 1m | Aggregate `nv_llm_usage` → `nv_llm_budgets.consumed_usd` |
| `nv-audit-chain-validator` (planned) | every 6h | Walk last 1000 records, verify hash chain integrity, alert on break |

---

## 8. Pre-deploy checklist (for EC2 launch)

| Item | Status |
|---|---|
| RDS instance sized for 10M rows (db.r6g.xlarge or larger) | ⬜ |
| RDS Proxy enabled | ⬜ |
| pgvector extension installed | ⬜ |
| ElastiCache Redis (cluster mode for >50K rps) | ⬜ |
| S3 bucket lifecycle policies configured | ⬜ |
| Background workers wired into PM2 / systemd | ⬜ |
| Partition tables created for top-5 hot tables | ⬜ |
| Read replica configured | ⬜ |
| CloudWatch alarms on slow query log | ⬜ |
| Per-table row count daily snapshot to `nv_system_health_snapshots` | ⬜ |

---

## 9. Performance budgets (SLOs)

| Operation | p50 | p95 | p99 |
|---|---|---|---|
| `POST /api/nv/sdk/docs-pipeline/documents/parse` (1MB PDF) | <2s | <5s | <10s |
| `POST /api/nv/sdk/docs-pipeline/documents/intelligence` | <3s | <8s | <15s |
| `POST /api/nv/sdk/docs-pipeline/documents/embeddings` (10 chunks) | <1s | <3s | <6s |
| `POST /api/nv/sdk/docs-pipeline/documents/search` (vector ANN over 1M chunks) | <300ms | <800ms | <2s |
| `POST /api/nv/orchestrate` (5-agent flow) | <5s | <12s | <25s |
| `GET /api/nv/health` | <50ms | <150ms | <500ms |
| Auth middleware (cached SDK key) | <5ms | <20ms | <100ms |
| Auth middleware (cold SDK key, DB lookup) | <50ms | <150ms | <500ms |

---

**Owner**: Platform team
**Review cadence**: monthly until 1M rows, weekly thereafter
