---
status: live
version: 5.0.1
audience: architects, SRE, security reviewers
last_updated: 2026-05-11 (Session-15 v13 — Phase 6 doc closure)
authority: NV-DOC-001 — canonical slim of `docs/v5.0.0/NYV-PLATFORM-DEEP-AUDIT-2026-05-07.md`
companion: `02-technical-slim-2026-05-11.md` (technical), `11-agentic-architecture-2026-05-10.md` (per-batch traces)
---

# Nyayavigya Platform — Architecture (Slim Canonical)

> **One-page architecture map.** This document gives an architect a complete mental model of the Nyayavigya platform in under 20 minutes. The 442-line long-form deep audit (`docs/v5.0.0/NYV-PLATFORM-DEEP-AUDIT-2026-05-07.md`) remains as the historical reference with the full 6-phase plan.

---

## 1 — System diagram (logical)

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │                           DOWNSTREAM CLIENTS                          │
   │  ┌──────┐ ┌──────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐        │
   │  │ NSP  │ │ NSPM │ │ NSI │ │ NSM │ │ NSA │ │ NYM │ │ JRX │        │
   │  └──┬───┘ └──┬───┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘        │
   └─────┼────────┼────────┼───────┼───────┼───────┼───────┼─────────────┘
         │ HTTPS  │        │       │       │       │       │
         │  X-API-Key (canonical) / Authorization: Bearer <key>           │
         └────────┴────────┴───────┴───────┴───────┴───────┘
                                  │
              ┌───────────────────▼────────────────────┐
              │        EDGE (nginx / ALB)              │
              │  TLS termination, sticky sessions,     │
              │  per-tenant rate limit (sdkApiKeyRL)   │
              └───────────────────┬────────────────────┘
                                  │
              ┌───────────────────▼────────────────────┐
              │       NYV GATEWAY (Express 5)          │
              │  ┌──────────────────────────────────┐  │
              │  │ NV-ARCH-001 SAFETY RING (11 stations)│
              │  │  1. tenant isolation             │  │
              │  │  2. guardrails                   │  │
              │  │  3. Queen orchestration          │  │
              │  │  4. agent allocation             │  │
              │  │  5. 22-section Parlant prompt    │  │
              │  │  6. 5-tier memory + RAG + Graph  │  │
              │  │  7. CoT / ReAct / ToT planning   │  │
              │  │  8. orchestrateLLM (NV-LLM-001)  │  │
              │  │  9. response engineering         │  │
              │  │ 10. halluc/citation/HITL gate    │  │
              │  │ 11. audit hash chain → stream    │  │
              │  └──────────────────────────────────┘  │
              └───┬─────────────┬──────────────┬───────┘
                  │             │              │
        ┌─────────▼──┐    ┌─────▼─────┐  ┌─────▼─────┐
        │ Postgres   │    │  Redis     │  │  LLM      │
        │ nv_schema  │    │  CMA2      │  │  providers│
        │ + public   │    │  cache     │  │  (6 live) │
        └────────────┘    └────────────┘  └───────────┘
```

→ long §1, §2.

---

## 2 — Layering

| Layer | Path | Purpose |
|---|---|---|
| **Edge** | nginx (EC2) / Vite proxy (dev) | TLS, host-based routing, rate limits |
| **HTTP routes** | `src/routes/**.ts` (125 files) | Per-feature Express routers, ALL behind `authenticateToken` or `extractSdkApiKey` |
| **Orchestration** | `src/orchestration/**.ts` (21 files) | Queen + safety-ring stations + V9 unified core |
| **Services** | `src/services/**.ts` (266 files) | Business logic, no direct HTTP I/O |
| **Packages** | `src/packages/**.ts` (99 files) | Internal capability packages (multimodal, voice, etc.) |
| **DB layer** | `src/db/**.ts` + `shared/*-schema.ts` | Drizzle ORM + raw SQL escape hatch |
| **Middleware** | `src/middleware/**.ts` | Auth (`nv-auth.ts`), tenant isolation, guardrails, rate limits |
| **Config** | `src/config/**.ts` | Master config, SDK variants, API versions |

→ long §3.

---

## 3 — Multi-tenancy model

**3 isolation rings**, in order of evaluation per request:

1. **`tenantIsolation` middleware** (`src/middleware/nv-tenant-isolation.ts`) — populates `req.tenantContext.tenantId` from JWT or SDK key, then 403s any request whose body claims a different tenant.
2. **Postgres RLS** (`drizzle/0004_enable_rls_for_tenant_tables.sql`) — RLS policies on every multi-tenant table filter by `current_setting('app.current_tenant')`.
3. **Per-tenant rate limit** (`sdkApiKeyRateLimit`) — distributed Redis-backed token bucket per `apiKeyHash`.

Cross-tenant attack model: even if an attacker forges a JWT for tenant A, RLS prevents them from seeing tenant B rows; even if they bypass RLS with a raw SQL injection (defended by Drizzle parameterised queries), the Express layer 403s on `tenantId` mismatch.

→ long §4.

---

## 4 — Trust boundaries

```
   external internet  →  edge  →  gateway  →  service layer  →  DB / cache / LLM
   ─────────────────     ────     ───────     ─────────────     ─────────────
   untrusted             TLS+     X-API-Key   tenant context    parameterised
                         WAF      JWT         + RBAC            queries; LLM
                                  rate-lim.   + safety ring     emissions
                                                                 audited
```

| Boundary | Auth artefact | Failure mode |
|---|---|---|
| internet → edge | TLS (LetsEncrypt + ACM) | 525/526 = TLS misconfig |
| edge → gateway | none (private network) | private subnet only |
| gateway → service | in-process, with `req.user`/`req.tenantContext` | TS types enforce |
| gateway ↔ gateway (east-west) | `X-NV-API-Key` (`nv-inter-service-auth`) | 401 |
| service → LLM provider | provider API key (vault / env) | provider 401/429 |
| service → DB | Postgres role + RLS | per-row deny |
| service → Redis | TCP + ACL token | per-namespace deny |

**Auth header discipline (NV-AUTH-HEADER-001)**: external SDK callers use **`X-API-Key`** (with `Authorization: Bearer <key>` fallback). East-west traffic uses **`X-NV-API-Key`** exclusively. Inventing new headers fails CI.

→ long §5.

---

## 5 — The safety ring (NV-ARCH-001)

Every LLM-emitting request traverses 11 stations in order. **There are no direct LLM calls anywhere in the codebase** — the single-router rule (NV-LLM-001) restricts `realLLMService.executeRequest|new RealLLMService(` to a 7-file whitelist (full list in `replit.md` § NV-LLM-001).

| # | Station | File |
|---|---|---|
| 1 | Tenant isolation | `src/middleware/nv-tenant-isolation.ts` |
| 2 | Guardrails | `src/middleware/orchestration-guardrails.ts` |
| 3 | Queen orchestration | `src/orchestration/nv-queen-orchestrator.ts` |
| 4 | Agent allocation | `src/services/nv-runtime-agent-factory.ts` |
| 5 | 22-section Parlant prompt | `src/orchestration/nv-prompt-engineering-pipeline.ts` |
| 6 | 5-tier memory + RAG + GraphRAG | `services/mem0-persistence-service.ts` + `services/rag/*` + `nv-graph-store.ts` |
| 7 | CoT / ReAct / ToT planner | `src/orchestration/nv-orchestration-core-v9.ts` (real V9, NOT the archived stub) |
| 8 | `orchestrateLLM` (single router) | `src/services/intelligent-router/orchestrate-llm.ts` |
| 9 | Response engineering | `src/orchestration/response-engineering-pipeline.ts` |
| 10 | Hallucination + citation + safety + HITL | `services/hallucination-checker.ts` + `nv-hitl-workflow-service.ts` |
| 11 | Audit hash chain → streaming | `services/hash-chain-audit.ts` |

Per-batch traces (Batch A–J) walk each `/api/nv5/*` namespace end-to-end through these 11 stations — see canonical doc 11.

→ long §6, §7.

---

## 6 — LLM routing fork

Inside station 8 (`orchestrateLLM`):

```
                 ┌─────────────────────────────────────────────┐
                 │         orchestrateLLM(req)                  │
                 └─────────────────────┬───────────────────────┘
                                       │
                  ┌────────────────────▼────────────────────┐
                  │  intelligent-router selection function   │
                  │  inputs: jurisdiction, taskType, budget, │
                  │          latency target, agent hints,    │
                  │          provider health[], cost cache   │
                  └────────────────────┬────────────────────┘
                                       │
        ┌──────────┬──────────┬────────┼────────┬──────────┬──────────┐
        ▼          ▼          ▼        ▼        ▼          ▼          ▼
     anthropic  openai    google  openrouter sarvam   bedrock   (fallback)
     (Claude)   (GPT)     (Gem.)  (multiplex)(Indic)  (Titan…)
```

Cost-aware fallback chain is deterministic (NOT LLM-driven) — full algorithm in canonical doc 05 § 4.

→ long §8.

---

## 7 — Storage layout

```
   Postgres
   ├── nv_schema (governance)
   │   ├── nv_audit_logs                  (append-only, hash-chained)
   │   ├── nv_audit_logs_hash_chain
   │   ├── nv_pii_vault                   (AES-256-GCM, key from NV_PII_ENCRYPTION_KEY)
   │   ├── nv_org_memory_entries          (5-tier memory persistence)
   │   ├── sdk_app_api_keys               (source of truth for SDK key scopes)
   │   ├── nv_billing_*                   (5 tables)
   │   ├── nv_agent_marketplace_listings
   │   ├── nv_data_lineage_*              (2 tables)
   │   ├── nv_rag_relevance_feedback
   │   ├── nv_runtime_flag_overrides      (Task #114 — feature flag overlay)
   │   ├── nv_org_console_layout          (Phase 5 — per-org overlay)
   │   └── ...26 governance tables total
   │
   └── public (application)
       ├── nv_users  / nv_organizations / nv_sdk_applications
       ├── nv_agents (1,042 rows from flat registry)
       ├── nv_conversations / nv_messages
       ├── nv_documents / nv_document_ingest_status
       ├── nv_grpo_episodes / nv_grpo_agent_stats / nv_grpo_suggestions
       └── ...

   Redis (CMA2 5-tier)
   ├── L1 — request-local in-process    (nv-multi-tier-cache)
   ├── L2 — per-tenant Redis namespace
   ├── L3 — cross-tenant prompt cache   (nv-prompt-cache)
   ├── L4 — vector search cache          (nv-vector-store)
   └── L5 — rate-limit + token revocation
```

→ long §9.

---

## 8 — Failure model

| Failure | Detector | Response | Recovery |
|---|---|---|---|
| LLM provider 5xx | `provider-registry` health probe | switch to next provider in fallback chain | auto |
| LLM provider 429 | per-key bucket + 429 catch | 503 to caller after exhausting chain | manual top-up |
| Postgres pool exhaustion | `pg-pool` driver event | 503 to caller, log structured event | auto-reconnect |
| Redis disconnect | `redis-client` retry strategy | degrade to in-process cache only | auto |
| Audit chain hash mismatch | `services/hash-chain-verifier.ts` | flag in `/api/nv/admin/audit/integrity` | `NYV_AUDIT_CHAIN_TOLERATE=1` + psql repair |
| HITL escalation needed | station 10 | response holds, item appears in `/hitl-decision-cards` | operator approves |
| Tenant isolation violation | `tenantIsolation` middleware | 403 + structured log | n/a (attack) |
| Type drift between tiers | TS strict mode + `npm run type-check` | CI fails | fix at source |

→ long §10.

---

## 9 — What this slim **does not** cover

- Full 6-phase audit plan (still relevant for phase tracking) → `docs/v5.0.0/NYV-PLATFORM-DEEP-AUDIT-2026-05-07.md`
- Per-batch deep traces of every `/api/nv5/*` namespace → `11-agentic-architecture-2026-05-10.md`
- Specific LLM model selection algorithm → `05-llm-dedicated-2026-05-11.md`
- STRIDE-style threat model → `07-security-dedicated-2026-05-11.md`
- Live UAT evidence → `09-uat-and-compliance-2026-05-08.md`

---

*End of slim canonical.*
