---
status: live
version: 5.0.1
audience: engineering, SRE, integration partners
last_updated: 2026-05-11 (Session-15 v13 — Phase 6 doc closure)
authority: NV-DOC-001 — canonical slim of `docs/v5.0.0/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md`
supersedes: nothing — this is the new canonical entry point; the 1,211-line long-form remains as the read-only reference
---

# Nyayavigya Platform — Technical (Slim Canonical)

> **One-sentence definition.** Nyayavigya v5.0.1 is a Standalone Legal AI SDK that exposes a single safety-ringed HTTP API surface to seven downstream products, orchestrated by the Nyayasiddhi Legal Reasoning Model over a 1,042-agent jurisdiction-aware registry, with deterministic cost-aware multi-provider LLM routing across 6 active providers and 113 May-2026 catalogue models.

The full 1,211-line long-form lives at `docs/v5.0.0/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md`. **This slim canonical exists so a new engineer can become productive in 30 minutes.** Cross-references back to the long-form are noted inline as `→ long §N`.

---

## 1 — Two-tier AI architecture

```
SDK request
  → tenant isolation
  → guardrails
  → Queen orchestration (callNyayavigya)
  → agent allocation (jurisdiction × practice-area)
  → 22-section Parlant prompt
  → 5-tier memory  +  multi-tier RAG  +  GraphRAG
  → CoT / ReAct / ToT planning
  → intelligent-router/orchestrateLLM (cost-aware)
  → response engineering
  → hallucination + citation + safety + HITL gate
  → audit hash chain
  → streaming response
```

This pipeline is **NV-ARCH-001** (no-bypass safety ring) — every LLM-emitting request must traverse all 11 stations. There are no direct LLM calls anywhere in the codebase; the single-router rule (NV-LLM-001) is CI-enforced via `scripts/nv-check-no-direct-llm-calls.sh`. → long §1, §3.

### Tier 1 — Jurisdiction-specific Small Legal Models (SLMs)

Per-jurisdiction SLM with focused legal corpora. Six active jurisdictions: IN, UK, US, GC (Gulf), EU, SG, plus a Default fallback. Each jurisdiction contributes 149 agents to the flat registry (Default contributes 148). Total agent population: **1,042**.

### Tier 2 — Nyayasiddhi Legal Reasoning Model (NS LRM)

The orchestration brain. Allocates the SLM, plans across the 22 ROMA L5 patterns, and arbitrates between agents in multi-agent flows. Falls back to PII-redacted LLM execution when an SLM has no answer (covered by `services/pii-redaction-service.ts` + `nv-pii-vault`).

---

## 2 — The 7 SDK packages

| Package | Audience | npm | Backend mount |
|---|---|---|---|
| `@nyayavigya/sdk-core` | shared HTTP client + typings | published | — |
| `@nyayavigya/nyayasiddhi-professional-sdk` (NSP) | Law firms | published | `/api/nv/sdk/nsp/*` |
| `@nyayavigya/nyayamitra-sdk` (NYM) | Citizen mobile | published | `/api/nv/sdk/nym/*` |
| `@nyayavigya/nyayasiddhi-institutional-sdk` (NSI) | Enterprise legal | published | `/api/nv/sdk/nsi/*` |
| `@nyayavigya/nyayasiddhi-ministry-sdk` (NSM) | Government | published | `/api/nv/sdk/nsm/*` |
| `@nyayavigya/nyayasiddhi-academy-sdk` (NSA) | Legal education | published | `/api/nv/sdk/nsa/*` |
| `@nyayavigya/jrx-sdk` | Embedded JRX | published | `/api/nv/sdk/jrx/*` |

Auth: `X-API-Key` header (canonical) or `Authorization: Bearer <key>` fallback — see NV-AUTH-HEADER-001 in `replit.md`. SDK keys live in `nv_schema.sdk_app_api_keys` (NOT in `src/config/nv-sdk-variants.ts`). → long §4, §5.

---

## 3 — Service inventory (counts verified 2026-05-11)

| Bucket | Count | Notes |
|---|---|---|
| `src/services/**.ts` | 266 | Core business logic |
| `src/packages/**.ts` | 99  | Internal capability packages |
| `src/orchestration/**.ts` | 21 | Queen orch + safety ring stations |
| `src/routes/**.ts` | 125 | HTTP route files |
| API mounts (`app.use('/api/...')`) | 93 | 91 unique prefixes |
| Console pages (`client/src/pages/**.tsx`) | 121 | 151 mounted routes |
| Active LLM providers | 6 | `anthropic`, `openai`, `google`, `openrouter`, `sarvam`, `bedrock` |
| Active LLM models in catalogue | 113 | Includes May-2026 GPT-5.x, Claude 4.x, Gemini 2.5, Grok 3, etc. |
| Agent registry total | 1,042 | 6 jurisdictions × 149 + Default × 148 |
| Practice areas | 27 | `corporate`, `litigation`, `tax`, `IP`, etc. |
| ROMA L5 patterns | 22 | CoT, ReAct, ToT, Reflexion, Maker-Checker, … |
| Swarm topologies | 107 | A2A collaboration patterns |

### Wired-orphan budget (NV-WIRING-BUDGET-001, Session-11 close)
**309 wired / 79 used-internal / 24 raw orphan / 0 effective orphan** (out of 412 files). All 24 raw orphans are allowlisted (KEEP-BARREL / KEEP-CLI / KEEP-CONTRACT / KEEP-DYNAMIC-IMPORT). Budget is locked at 0 effective orphans; CI fails on growth.

→ long §6, §7.

---

## 4 — Database (Postgres 16.6, RDS / Neon)

Two schemas:
- **`nv_schema.*`** — governance / audit / billing / observability (26 tables introspected 2026-04-29; mirrored in `shared/nv-schema-tables.ts` byte-for-byte).
- **`public.*`** — application data (users, organizations, conversations, documents, …).

Tables prefixed `nv_*`. Migrations in `drizzle/` (currently 0000–0008). Per-jurisdiction product schemas live in:
- `shared/nv-governance-schema.ts`
- `shared/nyayamitra-schema.ts`
- `shared/nyayasiddhi-institutional-schema.ts`
- `shared/nyayasiddhi-ministry-schema.ts`
- `shared/nyayasiddhi-academy-schema.ts`

### Standalone-script driver discipline (NV-DB-SCRIPT-001)
Scripts under `scripts/` MUST use `makePgSql()` from `scripts/_pg-pool.ts` (real `pg.Pool` + SSL + pooling). The `@neondatabase/serverless` HTTP driver silently drops writes on non-Neon hosts. Runtime is already driver-aware (picks `pg` vs neon-serverless by hostname). CI: `npm run guardrail:script-db`.

→ long §8.

---

## 5 — Cache & queues

- **Redis 7.1 (ElastiCache prod / Upstash dev)** — five-tier memory CMA2, prompt cache, multi-tier cache, rate limiters, token revocation.
- **Resolution**: `resolveRedisTcpUrl()` / `resolveRedisReadUrl()` in `src/utils/redis-tcp-url.ts` — single canonical entry point per NV-SECRETS-001.
- **Canonical secrets**: `NYV_REDIS_TCP_URL` (write), `NYV_REDIS_READ_URL` (read).
- **In-process queues**: bounded-concurrency dispatchers for doc-ai (`NYV_DOC_CONVERT_CONCURRENCY=4` default), batch agentic execution, and HITL pollers.

→ long §9.

---

## 6 — LLM routing (one-screen summary)

Full detail in canonical doc 05 (`05-llm-dedicated-2026-05-11.md`). One-line:

> Every LLM emission terminates at `intelligent-router/orchestrateLLM`. The router selects model by jurisdiction-fit × cost × latency × confidence × provider health, with deterministic fallback chains and Sarvam carve-out for 22 Indic languages.

→ long §10, §11.

---

## 7 — Deployment topology

| Env | URL | Compute | DB | Cache |
|---|---|---|---|---|
| **Replit dev** (this workspace) | `localhost:5000` (gateway) + `localhost:3004` (console) | tsx | Neon helium | Upstash Redis |
| **EC2 prod-dev** | `api.nyayasiddhi.online`, `console.nyayasiddhi.online`, `nym.nyayasiddhi.online` | Docker (per-deploy compose project) | RDS prod | ElastiCache `nyv-dev-edge-redis` |

**Per-deploy network bridge** (gotcha): every `docker compose up` from a fresh dir creates a NEW project-scoped network; legacy `nyv-console` (nginx) lives on `nyayavigya-platform-312_nyv-net`. Persistence: systemd unit `nyv-gateway-bridge.service`. Re-installer: `sudo bash /opt/nyayavigya/scripts/nv-bridge-systemd-install.sh`. → canonical doc 09 Appendix D.

---

## 8 — Hard architectural guardrails (CI-enforced)

The full text and history live in `replit.md` § "Hard architectural guardrails". The guardrails are:

| Code | Subject | CI script |
|---|---|---|
| `NV-ARCH-001` | No-bypass safety ring | (architectural — not script-checked) |
| `NV-LLM-001` | Single-router rule (7-file whitelist) | `scripts/nv-check-no-direct-llm-calls.sh` |
| `NV-NAMING-001` | Pre-flight grep before new files | (manual review) |
| `NV-WIRING-001` | Service complete only when imported by an entry point | `npm run audit:wiring` |
| `NV-DOC-001` | Active markdown only in `replit.md` + `README.md` + `docs/canonical/` | (manual review) |
| `NV-SECRETS-001` | Single canonical secret name per concept | (manual review) |
| `NV-CONTRACT-001` | Pre-flight grep on method/route/schema/env names | (manual review) |
| `NV-OWNERSHIP-001` | Every test failure → reproduce, trace, fix, regression-test | (manual review) |
| `NV-AUTH-HEADER-001` | One canonical SDK auth header (`X-API-Key`) | `npm run guardrail:auth-header` |
| `NV-DB-SCRIPT-001` | Scripts use `makePgSql()` | `npm run guardrail:script-db` |
| `NV-API-CONTRACT-001` | OpenAPI snapshot diff (additions OK; removals fail) | `npm run guardrail:api-contract` |
| `NV-WIRING-BUDGET-001` | 0 effective orphans | `npm run guardrail:no-new-orphans` (advisory) |
| `NV-AGENT-REGISTRY-FRESH-001` | Flat registry auto-generated from per-jurisdiction sources | `npm run guardrail:flat-registry` |
| `NV-TRACKER-FRESH-001` | Tracker block per session before merge | `npm run guardrail:tracker-fresh` |

Combined: `npm run guardrail` runs the full chain.

---

## 9 — Observability

- **Audit hash chain** — every safety-ring station appends to `nv_schema.nv_audit_logs_hash_chain`. Verifier: `services/hash-chain-verifier.ts`. Repair tolerance via `NYV_AUDIT_CHAIN_TOLERATE=1`.
- **Drift monitor** — `/api/nv/drift/agents` exposes per-agent latency / accuracy / cost deltas.
- **Router stats** — `/api/nv/observability/router-stats` exposes per-model `health[]` (used by cost-optimizer + provider-failover dashboard).
- **Per-batch trace** — canonical doc 11 walks each Batch A–J end-to-end through the safety ring.

---

## 10 — What this slim **does not** cover

- Full per-batch endpoint tables → `04-sdk-and-api-canonical-2026-05-07.md` §§ 11–17
- Per-batch agentic safety-ring traces → `11-agentic-architecture-2026-05-10.md`
- LLM provider activation recipe + cost matrix → `05-llm-dedicated-2026-05-11.md`
- Security & compliance posture → `07-security-dedicated-2026-05-11.md`
- UAT evidence (40/40 PASS) → `09-uat-and-compliance-2026-05-08.md`
- Tracker / changelog → `10-tracker-changelog-2026-05-07.md`

---

*End of slim canonical. For history, gotchas, and 1,200 lines of detail, open the long-form companion `docs/v5.0.0/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md`.*
