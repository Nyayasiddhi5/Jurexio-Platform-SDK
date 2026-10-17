---
status: live
version: 3.1.2
superseded_by: null
last_verified: 2026-04-27
---

# Nyayavigya — Technical Product Note (v3.1.2)

> **Status: LIVE.** Nyayavigya Platform 3.1.2 is in production in `ap-south-1` (Mumbai, AWS account `789925699169`) on the `nv-dev-edge` topology described in §10. The gateway runs Node 22 / Express 5 behind a Caddy reverse proxy on a single EC2 host, with managed RDS PostgreSQL 16 and ElastiCache Redis 7.1. All five Nyayasiddhi partner platforms (NyayaMitra, NSP, NSI, NSA, NSM) are provisioned end-to-end with separated live + test SDK keys; the 1,042 ROMA L5 prompts are loaded across seven jurisdiction registries; the multi-LLM router fronts seventeen providers; and the hash-chained audit log is operational. **GA is locked for May 15, 2026.**
>
> **Open engineering work** that downstream sections refer to is tracked separately in the project task queue and in [`NYV-AGENT-SUGGESTED-FOLLOWUPS.md`](../pending_implementation_docs/NYV-AGENT-SUGGESTED-FOLLOWUPS.md). The four areas a reader of this doc should know are still in motion:
> - **Schema reconcile** between `shared/schema.ts` and the live RDS `information_schema` is documented — see [`NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md`](../NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md). A live column-level inventory follow-up (Task #92) was filed against this note and is currently CANCELLED in the queue; pick up the inventory on the next schema change.
> - **MCP-tool registry** — `protocol_registry` is the canonical source-of-truth for tool definitions; counts reported elsewhere should be read against that table.
> - **Per-orchestrate audit-write** — every `/api/nv/orchestrate` call is intended to write one row into `nv_audit_logs` (chained); the wire-up is tracked as an open follow-up against §15 of this doc.
> - **Container image bake-out** — the canonical Docker image used by the production EC2 host should be the source-of-truth for gateway code; ensure CI rebuilds the image on every gateway PR before promotion.
>
> Each line above maps to a section of this document where the technical detail lives. The full engineering-follow-up surface lives in: the Q2-Q4 2026 roadmap ([`NYV-ROADMAP-Q2-Q4-2026.md`](../pending_implementation_docs/NYV-ROADMAP-Q2-Q4-2026.md)), the consolidated agent-suggested follow-ups doc ([`NYV-AGENT-SUGGESTED-FOLLOWUPS.md`](../pending_implementation_docs/NYV-AGENT-SUGGESTED-FOLLOWUPS.md)), the live-audit gap report ([`NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md`](../NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md)), and the schema-migration confirmation ([`NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md`](../NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md)).

**Audience:** Engineering, Site Reliability, Security, Partner-Integration teams
**Author:** Platform Engineering
**Version:** 3.1.2 (SDK v6.0.0) | **Date:** April 25, 2026
**Classification:** Internal — confidential
**Companion to:** [`NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md`](./NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md)

> **How to read this doc.** Sections 1–9 mirror the business product note section-for-section, but every claim is grounded in a file path, endpoint, environment variable name, or migration so a reviewer can verify it. Sections 10–28 are technical-only: deployment topology, database schema, Redis, LLM orchestration, Queen internals, agent prompts, reasoning frameworks, RAG, memory, multi-tenant model, admin features, SDK architecture, context management, security & compliance, observability, operational SOPs, the 10 M MAU roadmap, pending production-scale work, and a glossary. Where a claim depends on a follow-up that has not landed, the line is marked `> **TBD** — pending Task #N`.

> **Forbidden values.** This document references environment-variable *names* (e.g. `OPENROUTER_API_KEY`, `NYV_FIELD_ENCRYPTION_KEY`) and Secrets Manager paths (e.g. `nyayavigya/prod/gateway/sentry_dsn`) freely. It contains **zero** literal secret values, even truncated. The CI scrub `rg -n 'sk-[A-Za-z0-9]|AKIA[0-9A-Z]|password\s*=' docs/v3.1.2/completed_docs/NYV-PRODUCT-NOTE-TECHNICAL-v3.1.2.md` must return zero hits.

---

## 1. Executive Summary (Engineering View)

Nyayavigya is the legal-AI intelligence layer behind the five-platform Nyayasiddhi ecosystem. Concretely it is a **Node.js / TypeScript Express gateway** plus an **administration console** (Next.js / Vite) that fronts a multi-jurisdiction agent registry, a Queen orchestrator, a multi-LLM router, a hybrid RAG layer, a five-tier memory subsystem, a hash-chained audit log, and a published SDK (web + mobile + server). The gateway is mounted under one canonical URL prefix — `/api/nv/` — and everything else (partner brand routes, edge HTML, administrative tooling) lives outside that prefix. The platform code is `NYV`; the SDK live-key prefix is `nyv_live_sk_` and the test-key prefix is `nyv_test_sk_`. These are platform invariants enforced at boot and in tests.

The system runs **1,042 ROMA Level-5 system prompts** (`6 × 149 + 148`) split across six jurisdiction registries (`IN`, `UK`, `US`, `GCC`, `SG`, `EU`) plus a 148-agent jurisdiction-neutral `DEFAULT` registry — the Queen herself (`ns-queen`) was removed from `DEFAULT` in April 2026 because she never selects herself. Each prompt is a 22-section, ~20 KB document covering role, jurisdiction, statutes, procedural rules, guardrails, tool affinities, escalation paths, and audit hooks. The prompt resolver eager-loads all seven registries (~22 MB) into a `Map<JurisdictionCode, Map<originalAgentId, prompt>>` at boot and refuses to start if the count is wrong (`src/startup/nv-jurisdiction-prompt-validator.ts`, `process.exit(1)` in production).

Production today runs in `ap-south-1` (Mumbai), AWS account `789925699169`, on a single `t3.large` EC2 host (`13.232.165.242`, instance id `i-0df71e5ea1df8f588`) behind an ALB with an ACM-issued TLS certificate, fronted by Caddy as a per-host reverse proxy into a docker-compose ecosystem (`gateway-a`, `gateway-b`, `console`, plus per-partner front-ends `nym`, `nsp`, `nsi`, `nsa`, `nsm`). RDS PostgreSQL 16 (`db.t4g.small`, multi-AZ in prod, single-AZ in dev-edge) is the primary store; ElastiCache Redis 7.1 (`cache.t4g.micro`) is the cache / lock / queue layer. Secrets Manager holds every credential; CloudWatch holds logs and alarms; Sentry receives application errors and traces.

**Capacity envelope today.** A single `t3.large` (2 vCPU / 8 GB) running both gateways plus Caddy plus the console plus five partner apps comfortably handles low-thousands RPM with p95 well under the SLOs defined in §24. The path from "today" to **10 M MAU** runs through EKS + multi-AZ RDS sizing + ElastiCache cluster mode + multi-region; the steps are scoped in §26 and the explicit blockers are listed in §27.

**Design north stars** the rest of this document constantly comes back to:

1. **One canonical API prefix** — `/api/nv/`. Anything else is a brand-front route.
2. **Jurisdiction precedence is sacrosanct** — `explicit → user → tenant → DEFAULT('IN')`. `agent.jurisdiction` is **never** consulted by the dispatcher (§5.3, §16).
3. **Multi-tenant isolation is enforced at three layers** — gateway middleware, agent dispatcher namespace, and database (RLS migration `0004` once `NYV_RLS_ENFORCE=true`).
4. **Audit-first** — every request, agent call, tool invocation, and cache invalidation lands in a hash-chained `nv_schema.nv_audit_logs` row with `previous_hash` linkage and a Redis-coordinated cross-pod chain lock.
5. **Fail loud, never swallow** — safety, HITL, audit, and migration failures throw in production. Fallbacks are explicit and observable.

---

## 2. The Problem We Solve (Technical Restatement)

The five business failure modes from §2 of the business note translate to five concrete engineering invariants:

| Business failure | Engineering invariant | Where enforced |
|---|---|---|
| **Hallucination → liability** | Citation verification + grounded hallucination detector + multi-agent reviewer pass + refusal path | `src/services/hallucination-checker.ts`, `src/services/safety/`, `OrchestrationMiddleware.postCheck` (`src/orchestration/orchestration-middleware.ts`); fail-loud in production |
| **Jurisdictional ignorance** | Post-2023 Indian codes (BNS, BNSS, BSA) are the only Indian criminal-law content in the prompt registries; older codes appear only in a mapped history block; jurisdiction precedence enforced at the Queen | `Nyayavigya-Legal-registry-IN.json` (and the six other registries); `src/utils/jurisdiction-resolver.ts` |
| **Single-LLM fragility** | 17 model providers behind one router, with opossum circuit breakers per provider and a streaming fallback chain that walks `[primary, ...getFallbackProviders(primary)]` | `src/services/real-llm-service.ts` (`executeStreamRequest`, `executeWithFallback`); `src/services/circuit-breaker.ts` |
| **Cost at enterprise scale** | Cost-aware router selects the smallest model that can answer; per-agent prompt cache short-circuits on cache hit; admin can clear caches and re-tune routing weights | `src/services/cost-aware-router.ts`, `src/services/lm-cache-service.ts` (Tasks #38 / #66 / #67); `GET /api/nv/routing/weights`, admin `GET /api/nv/admin/routing-weights` (Task #69) |
| **Compliance is non-negotiable** | Hash-chained audit log + RLS + field-level pgcrypto encryption + DPDP / GDPR endpoints | Migration `drizzle/0004_enable_rls_for_tenant_tables.sql`; `src/middleware/nv-sdk-tracking-middleware.ts` (`appendAuditRecord`); `src/services/audit-chain-lock.ts`; `src/services/field-encryption-service.ts`; consent + data-subject-request routes under `/api/nv/consent/*` and `/api/nv/compliance/*` |

Every claim above maps to a test in `tests/unit/security/`, `tests/orchestration/`, or `tests/unit/ai/`. The same claims appear in [`NYV-COMPLIANCE-ATTESTATION.md`](./NYV-COMPLIANCE-ATTESTATION.md) as auditor-facing rows.

---

## 3. The Nyayasiddhi Ecosystem (Wiring View)

Each end-user platform is a separate front-end that holds **only** a `nyv_live_sk_<partner>_…` API key and talks to the Nyayavigya gateway through the SDK. The gateway holds the agents, orchestration, retrieval, safety, audit, and multi-jurisdiction reasoning. There is one single intelligence layer; there are five brands consuming it.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        END-USER EXPERIENCES (5)                          │
│  Nyayamitra (citizens)    NSP (lawyers)    NSI (institutions)            │
│  NSA (academy)            NSM (ministry)                                 │
└──────────────────────────────────────────────────────────────────────────┘
            │           │           │            │           │
   nyv_live_sk_nym_*  ...nsp_*  ...nsi_*    ...nsa_*    ...nsm_*
            │           │           │            │           │
            └───────────┴────┬──────┴────────────┴───────────┘
                             │  HTTPS, /api/nv/*
                             ▼
        ┌────────────────────────────────────────────┐
        │            NYAYAVIGYA GATEWAY               │
        │  Auth · Tenant · Routing · Queen · RAG ·    │
        │  Memory · Safety · Audit · Streaming · SDK   │
        └────────────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
            RDS         ElastiCache    LLM providers (17)
        Postgres 16     Redis 7.1     OpenAI / Anthropic /
       (multi-tenant)  (cache + lock   OpenRouter / Sarvam /
                        + queue)       per-region partners
```

| Partner | Tier | Live key prefix | DB schema notes |
|---|---|---|---|
| **Nyayamitra (NyM)** | `plus` | `nyv_live_sk_nym_*` | Citizen Q&A; multilingual voice via Sarvam (Indian) + global STT/TTS for 25 langs; WhatsApp entry. Schema: `shared/nyayamitra-schema.ts`. |
| **NSP (Professional)** | `pro` | `nyv_live_sk_nsp_*` | Lawyer drafting + matter-management + e-discovery. HITL gate enabled by default for court-pleading patterns. |
| **NSI (Institutional)** | `enterprise` | `nyv_live_sk_nsi_*` | Bulk compliance review, multi-tenant fan-out, sovereign-tier upgrade path. Schema: `shared/nyayasiddhi-institutional-schema.ts`. |
| **NSA (Academy)** | `pro` | `nyv_live_sk_nsa_*` | Mentor-mode (P10), Socratic tutoring; refuses to write a student's paper. Schema: `shared/nyayasiddhi-academy-schema.ts`. |
| **NSM (Ministry)** | `government` | `nyv_live_sk_nsm_*` | Sovereign tier, IN-only, hash-chain audit suitable for parliamentary record. Schema: `shared/nyayasiddhi-ministry-schema.ts`. |

All five are provisioned end-to-end by `scripts/nv-provision-ecosystem.ts`, which writes raw SQL into the live `nv_*` tables (the legacy `shared/schema.ts.sdkApplications` def is unrelated to the production tables and has been retired from this script — see `replit.md` "SDK Ecosystem Provisioning Status" for the live table layout).

---

## 4. Core Capabilities by Module (Pointer Table)

The business note describes what each module does. This table maps each module to its code, its primary endpoint, and its observability surface.

| Module | Code root | Primary endpoint(s) | Observability |
|---|---|---|---|
| **4.1 Multi-jurisdiction agent catalogue** | `src/services/agent-registry-service.ts` + `Nyayavigya-Legal-registry-*.json` (7 files) | `GET /api/nv/agents`, `GET /api/nv/agents/:id` | Boot count assertion (`nv-jurisdiction-prompt-validator.ts`) |
| **4.2 Queen orchestration** | `src/orchestration/nv-queen-orchestrator.ts` | `POST /api/nv/orchestrate`, `POST /api/nv/agui/stream` | `tracer.spanLatencies['queen.orchestrate']` |
| **4.3 22 patterns (P1–P22)** | `src/orchestration/orchestration-policy.ts`, `src/services/dag-orchestration-service.ts` | `?pattern=` query, response header `X-NYV-Pattern-Used` | `tracer.spanLatenciesByTag['queen.orchestrate'].orchestrationPattern` |
| **4.4 CoT / ReAct / ToT** | `src/services/chain-of-thought-service.ts`, `src/services/agent-orchestration.ts` | composed by Queen; not user-selectable | `queen.execute` span tags |
| **4.5 RAG (NyayaRAG)** | `src/services/rag-service.ts`, `src/services/document-pipeline/` | `POST /api/nv/rag/search`, `POST /api/nv/rag/ingest` | `rag_retrieval.hitRate`, `tracer.spanLatencies['queen.rag']` |
| **4.6 5-tier memory** | `src/services/memory/nv-5tier-memory-service.ts` | `GET /api/nv/memory/:userId`, `POST /api/nv/memory/recall` | `memory.tiers.session.hitRate`, `queen.memory` span |
| **4.7 Safety & guardrails** | `src/services/safety/`, `src/services/hallucination-checker.ts` | applied inside orchestration middleware | `breakers['outbound:llm']`, `recentErrors[]` |
| **4.8 Multi-tenant isolation** | `src/middleware/tenantIsolation.ts`, `src/middleware/nv-org-rls-middleware.ts`, migration `0004` | every authenticated route | `requests.errorClassHistogram['403']` |
| **4.9 SDK (web + mobile + server)** | `packages/client-sdk/`, `packages/react-hooks/`, `packages/types/`, mobile guides | `GET /api/nv/sdk/console/*` | `prompt_cache.llm_prompt_cache.hitRate` per partner namespace |
| **4.10 Admin console** | `nv-routing-weights-routes.ts`, `nv-roma-l5-admin-routes.ts`, `nv-feature-flags-routes.ts`, etc. | `/api/nv/admin/*` (gated by `authenticateToken + requireAdmin`) | `tracer`, `breakers`, `requests` snapshots |
| **4.11 Voice & multilingual** | `src/services/voice/` + Sarvam integration | `/api/nv/voice/stt`, `/api/nv/voice/tts` | per-call latency in audit log |
| **4.12 Compliance** | `src/services/compliance/`, `src/services/eu-ai-act-compliance-service.ts`, `src/services/consent-management-service.ts` | `/api/nv/consent/*`, `/api/nv/compliance/*` | hash-chained audit; `nv_schema.nv_audit_logs.previous_hash` |

Each entry is intentionally one row — the deep dive happens in §10–§28 below.

---

## 5. Agent Orchestration and Swarm Topologies (Internals)

### 5.1 The Queen — `src/orchestration/nv-queen-orchestrator.ts`

`QueenOrchestrator.orchestrate(req, ctx)` is the single entry point. The lifecycle:

1. **Resolve jurisdiction** via `src/utils/jurisdiction-resolver.ts` (precedence: explicit → user → tenant → `DEFAULT='IN'`). `agent.jurisdiction` is intentionally absent from the resolver.
2. **Decompose** the task into subtasks (`queen.decompose` span).
3. **RAG** the per-subtask context (`queen.rag` span).
4. **Memory** snapshot at start of run (`queen.memory` span: tiers + heap pressure).
5. **Pick pattern + agents** via `hierarchicalTaskAllocator` scoring (§5.2).
6. **Execute** the DAG via `dagOrchestrationService` bound to the capability manifest (`queen.execute` span; one `queen.agent` child span per agent).
7. **Synthesise** the per-agent outputs via `OrchestrationMiddleware.synthesize` (`queen.synthesis` span).
8. **Verify and audit** — safety post-checks; chain a record into `nv_schema.nv_audit_logs` via `appendAuditRecord` (Redis lock + per-process mutex + DB unique index, §23).

Every span carries `orchestrationId` so the trace can be joined to the AG-UI event stream (§14, §22). The Queen never selects herself; `ns-queen` was removed from the `DEFAULT` registry (see `replit.md` "Jurisdiction Prompt Resolver").

### 5.2 Hierarchical task allocator — composite scoring

`src/services/hierarchical-task` `‑allocator.ts` (the hierarchical task allocator service) ranks candidate agents with a composite score that blends static fit with **live signals** from `src/services/agent-performance-tracker.ts`:

```
score(agent, task) =
      jurisdictionMatch       // 0.0–1.0, exact match wins
    × tierProximity            // closer to user tier scores higher
    × successRate              // rolling EWMA from perf tracker
    × latencyFactor            // inverse of P95 ms from perf tracker
    × concurrencyPenalty       // 1.0 → 0.0 as agent saturates
    × jurisdictionOutcomeBias  // per-jurisdiction proven-win factor
```

Coalition formation favours agents with proven jurisdiction wins from the metering log; the lead role in a coalition goes to the highest-scoring member. The full breakdown is exposed at `GET /api/nv/routing/weights` (params `capability`, `jurisdiction`, `preferredTier`, `limit`) and rendered as an admin HTML dashboard at `GET /api/nv/admin/routing-weights` (Task #69; mounted behind `authenticateToken + requireAdmin`). Concurrency is incremented before the LLM call in `callAgentInner` and decremented in a `finally` block, so saturated agents are deprioritized in real time (Task #33; tests in `tests/orchestration/allocator-live-signals.test.ts`).

### 5.3 Jurisdiction-aware routing — non-negotiable

The resolver chain in `src/utils/jurisdiction-resolver.ts`:

1. `req.jurisdiction` (explicit field on the request body or query string).
2. `req.user.jurisdiction` (resolved from the SDK key → user profile → org default upstream of Queen).
3. `req.tenant.defaultJurisdiction` (org-level default).
4. `'IN'` (the documented platform default; emitted with a `WARN` log so it's visible in CloudWatch Logs Insights).

`agent.jurisdiction` is never consulted. The capability manifest's `supportedJurisdictions` is used **only for filtering** candidate agents — never to override the resolved jurisdiction. This rule is enforced by the agent dispatcher and asserted by `tests/orchestration/allocator-live-signals.test.ts` "jurisdiction-precedence".

### 5.4 Ensemble vs single-agent vs HITL

- **Single-agent (P1, P14, P15, P18).** Cheap, fast, default for free / `lite` tier. One LLM call, wrapped by the per-provider `llm:${providerId}` opossum breaker.
- **Ensemble (P5, P6, P7).** Multi-agent or multi-LLM; the Queen reconciles. Default for high-stakes patterns and for `enterprise` / `sovereign` tiers. `runWithConcurrency` from the per-tier policy bounds the parallel fan-out.
- **HITL gate.** `src/services/hitl-workflow-service.ts` blocks delivery on any orchestration whose risk score exceeds the tier's threshold (`mitra` and above). Pending items are exposed at `GET /api/nv/hitl/queue` and `hitl_queue.pending` on `/admin/health/full`.

### 5.5 Swarm topologies

There are **107 named swarm topologies** in the platform (star, chain, mesh, tree, layered, with different fan-out and fan-in rules). The Queen picks the topology to match the pattern and the question; operators can override at the request level via `body.topology`. Topology selection is opaque to the SDK consumer — the response header `X-NYV-Pattern-Used` only surfaces the pattern, not the topology, by design.

---

## 6. AI Protocols Supported

Four protocols sit on top of the orchestration layer.

- **AG-UI streaming.** Server-Sent Events from the gateway to the partner UI. Endpoint: `POST /api/nv/agui/stream` and `GET /api/nv/agui/stream/:orchestrationId/replay` (replay from the event log). Six lifecycle events per orchestration — see §14. Implementation: `src/routes/nv-agui-stream-routes.ts` (~938 lines), with **per-request emitters** (Task #64) so cross-tenant event leakage is structurally impossible. Cross-tenant regression: `tests/streaming/agui-no-cross-leak.test.ts` (Task #36).

- **A2A (agent-to-agent).** Standardised messaging between agents — including a partner's own agents registered as A2A peers. The Queen treats an A2A peer like a native agent in the registry; the dispatcher serialises the same context object regardless of whether the next hop is local or remote. Code root: `src/services/automateai/` plus the protocol registry capability (`category: 'protocol'`, tier visibility `enterprise+` per [`orchestration-map.md`](./orchestration-map.md) §2).

- **BMAD (multi-agent deployment).** A coordination protocol for clusters of agents that share a context set. Used by patterns that fan-out parallel reads on the same documents (e.g. P12 DISPATCHER on a 312-contract DPDP review). The shared-context plane is backed by the `nv_matter_memory` table (`content_enc` field-encrypted under `app.field_encryption_key` — see §18).

- **Parlant.** A conversational protocol carrying disclaimer obligations, jurisdiction bindings, refusal conditions, and escalation triggers across multi-turn dialogue. Wired into `buildAgentPrompt()` in the Queen orchestrator (§15) so a long NyayaMitra conversation does not lose its constraints over time.

In one line per protocol: AG-UI for the user interface, A2A for the partner's own agents, BMAD for keeping agent clusters in sync on shared context, Parlant for keeping legal conversations on the rails.

---

## 7. End-User Request Journeys (Wire-Level Trace)

The six journeys in §7 of the business note all funnel through the same wire shape:

```
Partner UI ──HTTPS POST /api/nv/agui/stream──> Gateway
                                                  │
                                                  ▼
   tenantIsolation + nv-rate-limit + nv-sdk-tracking-middleware
                                                  │
                                                  ▼
                                      QueenOrchestrator.orchestrate()
                                                  │
       ┌──────────────────────────┬───────────────┼───────────────┬────────────────────┐
       ▼                          ▼               ▼               ▼                    ▼
   queen.rag              queen.decompose    queen.execute    queen.synthesis    appendAuditRecord
  (rag-service)         (capability mfst)  (DAG + agents)   (orch middleware)   (chain + Redis lock)
                                                  │
                                                  ▼
                                       AG-UI SSE events to UI
                                       (6 lifecycle events, §14)
```

Concretely, journey 7.1 (Sita + landlord deposit, voice in Kannada):

1. Mobile UI → `POST /api/nv/voice/stt` with the audio blob → returns `{ text, lang: 'kn' }`.
2. Mobile UI → `POST /api/nv/agui/stream` with `{ text, jurisdiction: 'IN', tier: 'plus' }`.
3. Gateway resolves `tenant = nym`, `userId = sita`, runs the orchestration, streams six AG-UI events back, hits `appendAuditRecord` with `event_type = "orchestration.completed"`.
4. Mobile UI → `POST /api/nv/voice/tts` with the synthesised answer (Kannada) for playback.
5. The whole interaction is one orchestration ID; the audit chain row is `previous_hash`-linked to the prior NyayaMitra row for that tenant.

The other journeys (lawyer drafting, institutional bulk review, ministry analytics, GST voice query, student research) follow the same shape — only the pattern, agent set, and HITL gate differ.

---

## 8. UI / UX Surfaces (Code Locations)

| Surface | Code root | Build artifact |
|---|---|---|
| **8.1 SDK Console** | `console/` (Next.js) | published as `app.nyayavigya.in/console` via the `console` container in `docker-compose.ecosystem.yml` |
| **8.2 Partner UIs** | `examples/nsp-web-quickstart/` (reference Next.js), `examples/nyayamitra-rn/` (RN), and per-partner forks for nym/nsp/nsi/nsa/nsm | each runs as its own container behind Caddy host-routing |
| **8.3 Administration dashboard** | `src/routes/nv-roma-l5-admin-routes.ts`, `src/routes/nv-routing-weights-routes.ts`, `src/routes/nv-feature-flags-routes.ts`, `src/routes/nv-enterprise-admin-routes.ts` | server-rendered HTML mounted under `/api/nv/admin/*` (no SPA dependency) |

The partner UIs use the SDK's React components from `packages/react-hooks/` (streaming-response panel, citation chips, confidence band, "explain further" CTA, single-tap export). The same SDK hook surface drives every partner.

---

## 9. Why We Win (Engineering View)

A re-statement of the eight differentiators with the engineering proof:

1. **Indian-first, deeply** — `Nyayavigya-Legal-registry-IN.json` is post-2023 native (BNS / BNSS / BSA); the older codes appear only as a mapped-history block in the `system-prompts` text.
2. **Multi-jurisdiction without translation** — six full registries plus DEFAULT; eager-loaded at boot; count assertion is a hard process-exit in production.
3. **1,042 specialist prompts** — counted at boot; if the count drifts, the gateway refuses to start (`src/startup/nv-jurisdiction-prompt-validator.ts`).
4. **ROMA Level-5 specialisation** — every prompt has 22 sections; the structure is a contract enforced by `tests/nv-jurisdiction-prompt-resolver.test.ts`.
5. **Multi-LLM cost routing** — `src/services/cost-aware-router.ts` + `src/services/real-llm-service.ts.executeWithFallback` walk the provider chain; each provider has its own opossum breaker and its own JSON catalogue entry.
6. **Real audit chain** — `appendAuditRecord` + `audit-chain-lock.ts` + migration `0004` unique-index on `previous_hash`. Tests in `tests/unit/security/hash-chain.test.ts`.
7. **Partner-embeddable SDK** — three variants (web, mobile, server) × three tiers (Lite, Mitra, Enterprise / Sovereign). Published per [`NYV-SDK-v6-INTEGRATION-GUIDE.md`](./NYV-SDK-v6-INTEGRATION-GUIDE.md). v5 receives security patches only per [`superseded/NYV-SDK-v5-DEPRECATION-POLICY.md`](../superseded/NYV-SDK-v5-DEPRECATION-POLICY.md).
8. **Production-grade observability** — Sentry traces (Task #39), structured spans (Task #28), opossum breaker stats, queue depths, LLM provider stats, P50 / P95 / P99 / max latency rings, audit metrics, all surfaced on `GET /api/nv/admin/health/full` (§24).

Plus the boring discipline: banned `Math.random()` in security paths, mandatory storage-path resolution, one canonical API prefix, one canonical key prefix, one canonical Sentry project, one canonical Secrets Manager prefix per env. These are the rules that prevent the kind of incidents that destroy legal-AI vendor reputations.

---

## 10. Deployment Architecture

### 10.1 Production topology (today, single-region, single-host)

```
                          ┌──────────────┐
                          │   BigRock    │  registrar — owns the nameservers
                          │  nyayasiddhi │  → 4 AWS NS records (see §10.4)
                          │   .online    │
                          └──────┬───────┘
                                 │ NS delegation
                                 ▼
                       ┌──────────────────┐
                       │   Route 53       │  Z04530691JKS1594B5M2E
                       │  (10 alias rec)  │  (api/console/docs/status/
                       └──────┬───────────┘   ace/ins/min/nym/pro + apex + www)
                              │ ALIAS
                              ▼
                       ┌──────────────────┐
                       │   ACM cert       │  arn:aws:acm:ap-south-1:…/4fec415f…
                       │  (TLS 1.3)       │  ISSUED, valid through 2026-11-07
                       └──────┬───────────┘
                              │
                       ┌──────▼───────────┐    AWS WAF (count-only today;
                       │   ALB            │◄── follow-up #19 to flip → block)
                       │  nyv-dev-edge-   │
                       │     alb          │
                       │  (HTTP→HTTPS     │
                       │   redirect)      │
                       └──────┬───────────┘
                              │ port 80, ALB SG → nysdev SG
                              ▼
                  ┌──────────────────────────┐
                  │   EC2 t3.large           │  i-0df71e5ea1df8f588
                  │   13.232.165.242         │  ap-south-1
                  │   (the "nysdev" host)    │  (Ubuntu 22.04)
                  └──────┬───────────────────┘
                         │  Docker daemon
                         ▼
        ┌───────────────────────────────────────────────────────┐
        │   docker-compose.ecosystem.yml (single host today)     │
        │                                                        │
        │   nyv-caddy ──┬── api.nyayasiddhi.online → gateway-a/b │
        │   (host-      ├── app.nyayavigya.in       → console     │
        │    routed     ├── nym.* → nyayamitra-front              │
        │    reverse    ├── pro.* → nsp-front                     │
        │    proxy)     ├── ins.* → nsi-front                     │
        │               ├── ace.* → nsa-front                     │
        │               └── min.* → nsm-front                     │
        └───────────────────────────────────────────────────────┘
                         │                         │
                         ▼                         ▼
              ┌─────────────────────┐    ┌─────────────────────┐
              │  RDS Postgres 16    │    │  ElastiCache Redis  │
              │  db.t4g.small       │    │  7.1, t4g.micro     │
              │  multi-AZ (prod)    │    │  TLS, AUTH token,    │
              │  PITR 7d            │    │  at-rest encrypted   │
              │  Secrets:           │    │  Secrets:            │
              │  nyv-…/rds/master   │    │  nyv-…/redis/auth    │
              └─────────────────────┘    └─────────────────────┘
```

### 10.2 Containers on the host

`docker-compose.ecosystem.yml` defines the full stack:

| Container | Image | Listens | Notes |
|---|---|---|---|
| `nyv-caddy` | `caddy:2.7-alpine` | 80, 443 | Per-host reverse proxy. Access logs → `/var/log/caddy/access.log` JSON, rotated 50 MB × 7 |
| `nyv-gateway-a`, `nyv-gateway-b` | partner ECR `nyv-gateway:<deploy-id>` | 5000 | Two replicas behind Caddy round-robin; per-deploy pinned by `scripts/deploy-replit-direct.sh` |
| `nyv-console` | partner ECR `nyv-console:<deploy-id>` | 3004 | Next.js dashboard |
| `nyv-nym`, `nyv-nsp`, `nyv-nsi`, `nyv-nsa`, `nyv-nsm` | per-partner ECR | varies | Front-end containers; never talk to RDS / Redis directly — only to `nyv-gateway-*` over the partner's API key |

Health checks: Caddy has a built-in `/health`; gateways expose `/health` (process alive, returns `200 ok`) and `/api/nv/health` (`{ db: ok, redis: ok, ts }`). The exhaustive `/api/nv/health/full` is admin-only — see §24.

### 10.3 Two-phase apply (DNS + datastores)

The `dev-edge` Terraform workspace is two-phase by design (see [`AWS-DNS-HANDOFF-2026-04-24.md`](./AWS-DNS-HANDOFF-2026-04-24.md) §3 and [`AWS-MANAGED-DATASTORES-2026-04-24.md`](./AWS-MANAGED-DATASTORES-2026-04-24.md) §1):

- **Phase A (default).** Zone, ACM cert, validation CNAMEs, ALB, HTTP→HTTPS redirect, target group, S3 access logs. `terraform apply` succeeds in <1 min even when the cert is `PENDING_VALIDATION`.
- **Phase B (operator-gated).** `terraform apply -var enable_https_listener=true` — adds `aws_acm_certificate_validation` waiter and the ALB :443 HTTPS listener. Runtime is dominated by the validation wait (5–15 min once BigRock NS is live).
- **Datastores phase (operator-gated).** `terraform apply -var enable_managed_datastores=true` — provisions RDS + ElastiCache + their SGs + Secrets Manager entries. ~15 resources. RDS provisioning 8–12 min, ElastiCache 5–7 min.

The cutover from container-local `nyv-postgres` / `nyv-redis` to managed RDS / Redis is one idempotent script: `scripts/migrate-to-managed-datastores.sh` — phases `--preflight | --dump | --restore | --cutover | --rollback`, each marker-tracked under `/opt/nyayavigya/migration/state/`.

### 10.4 DNS facts

| Record | Type | Target |
|---|---|---|
| `nyayasiddhi.online` | A ALIAS | ALB |
| `www.nyayasiddhi.online` | A ALIAS | ALB |
| `api.` / `console.` / `docs.` / `status.` / `ace.` / `ins.` / `min.` / `nym.` / `pro.` | A ALIAS | ALB |
| 4× NS at registrar (BigRock) | NS | `ns-457.awsdns-57.com` / `ns-831.awsdns-39.net` / `ns-1111.awsdns-10.org` / `ns-1846.awsdns-38.co.uk` |

The 10-record fan-out at Route 53 is the single source of truth; Caddy's host-routing maps the subdomain to the correct partner container.

### 10.5 Multi-AZ posture

- **Today (dev-edge):** single-AZ for cost (RDS `db.t4g.small`, single-AZ; Redis `cache.t4g.micro`, no replica). Acceptable for the pre-launch window.
- **Production target (May 15, 2026):** RDS multi-AZ (synchronous standby in a second AZ), ElastiCache replication group with at least one replica, ALB health checks driving target rotation. EC2 remains single-host until §26's EKS migration. Acceptable RTO for an EC2 loss is 15 min via terraform-taint + bootstrap (see Drill #2 in [`NYV-DR-DRILL-RESULTS.md`](./NYV-DR-DRILL-RESULTS.md)).

### 10.6 DR drill outcomes

[`NYV-DR-DRILL-RESULTS.md`](./NYV-DR-DRILL-RESULTS.md) records the 2026-04-23 paper drill (#0): all Terraform module references resolve, all shell scripts pass `bash -n`, `bootstrap-fresh-ec2.sh` writes a structured report, and Drill #4 (region loss) is tracked as a follow-up because `envs/prod-dr/` is not yet written. Drills #1 (RDS PITR), #2 (EC2 reprovision), #3 (secret rotation + rollback) are predicted RTO ≤ 25 min, ≤ 15 min, ≤ 4 min respectively; live results are filled in on the first execution against production.

---

## 11. Database Architecture

### 11.1 Inventory

The platform's SQL footprint is approximately **170+ `pgTable(...)` declarations** across five schema files (counts as of April 25, 2026):

| Schema file | `pgTable` count (approx) | Domain |
|---|---|---|
| `shared/schema.ts` | 79 | Core gateway: auth, agents, SDK, orchestration, audit, billing, RAG, memory, HITL, compliance |
| `shared/nyayamitra-schema.ts` | 3 | Citizen-app domain (NyM-specific surfaces) |
| `shared/nyayasiddhi-academy-schema.ts` | 3 | Academy domain |
| `shared/nyayasiddhi-institutional-schema.ts` | 3 | Institutional domain |
| `shared/nyayasiddhi-ministry-schema.ts` | 3 | Ministry domain |

The production tables under the `nv_*` namespace (the canonical names used by the live gateway) total ~85 tables when you include the per-partner extension tables. The legacy `shared/schema.ts.sdkApplications` def is **unrelated** to the live tables; the canonical SDK-app tables are in `nv_schema.*` and provisioned by `scripts/nv-provision-ecosystem.ts` with raw SQL.

### 11.2 Domains

Each domain below maps to a contiguous block in `shared/schema.ts` (approximate; the file has been refactored several times — `rg "pgTable\('nv_<domain>" shared/schema.ts` for the exact set):

| Domain | Key tables (representative) | Purpose |
|---|---|---|
| **Auth** | `nv_users`, `nv_user_sessions`, `nv_orgs`, `nv_org_members`, `nv_api_keys` | JWT-signed sessions, refresh tokens, per-org membership, hashed API keys (raw key shown once at issue) |
| **Agents** | `nv_agents`, `nv_agent_personas`, `nv_agent_capabilities` | Agent registry rows; `original_agent_id` is the join key into the JSON registries |
| **SDK** | `nv_sdk_applications`, `nv_sdk_keys`, `nv_sdk_webhooks`, `nv_sdk_deliveries` | Partner apps + their live/test keys + webhook config + delivery history |
| **Orchestration** | `nv_orchestrations`, `nv_orchestration_subtasks`, `nv_orchestration_events` | One row per `orchestrationId`; subtasks store the per-agent input/output; events back the AG-UI stream replay |
| **Audit** | `nv_schema.nv_audit_logs`, `nv_audit_chain_state` | Hash-chained audit; `previous_hash UNIQUE` index is the cross-pod backstop |
| **Billing** | `nv_credits`, `nv_credit_transactions`, `nv_invoices` | Credit balance per org; Razorpay invoice references |
| **RAG** | `nv_documents`, `nv_document_chunks`, `document_embeddings`, `nv_corpus_jurisdictions` | Statute / case / template / partner-private docs with per-chunk vectors |
| **Memory** | `nv_session_memory`, `nv_matter_memory`, `nv_long_term_memory`, `nv_social_memory` | The five tiers (semantic + episodic + session + long-term + social) |
| **HITL** | `nv_hitl_queue`, `nv_hitl_decisions` | Pending reviewer items, decision history, SLA flags |
| **Compliance** | `nv_consent_records`, `nv_data_subject_requests`, `nv_dpdp_incidents`, `nv_evidence_chain` | DPDP / GDPR primitives; data-subject request lifecycle |
| **Multi-tenant ops** | `nv_rls_sentinel`, `nv_org_settings`, `nv_feature_flags` | Test sentinel for RLS, per-org defaults, feature flags |

> **TBD** — A column-level table-of-tables generated from the live database (rather than from the schema files) is pending Task #88 (post-launch documentation pass). Until then, `shared/schema.ts` is the source of truth for column names and types.

### 11.3 RLS posture

Migration `drizzle/0004_enable_rls_for_tenant_tables.sql` walks `information_schema.columns`, finds every `nv_*` / `ns_*` / `ni_*` / `nm_*` table that carries an `org_id` column, and installs a `tenant_isolation` policy on each. The policy is **strict** — `org_id::text = current_setting('app.current_org_id', true)`; an unbound session sees zero rows because `org_id::text = NULL` evaluates to `NULL`. There is **no** empty-setting bypass.

**Phased rollout** is gated on `NYV_RLS_ENFORCE`. The migration runner (`scripts/nv-migrate.ts`) reads the env variable and binds it to the session GUC `app.nyv_rls_enforce` before executing 0004. The DO loop installs policies unconditionally but only `ENABLE` / `FORCE ROW LEVEL SECURITY` runs when the GUC is `'true'`. Default (unset / `'false'`): policies present, enforcement off, existing behaviour preserved. Operators flip enforcement on after every DB call site has been wired through `req.withTenant(fn)` (tracked as follow-up #41).

`orgRlsMiddleware` is mounted on `/api/nv/` in `src/index.ts` immediately after `tenantIsolation`. Every authenticated request carries a `req.withTenant(fn)` helper that opens a transaction, runs `SET LOCAL app.current_org_id = '…'` on the transaction's pinned connection, and reverts on COMMIT/ROLLBACK so nothing leaks back to the pool. Cron jobs and queue workers use `withTenantTx(orgId, fn)` directly. The `SAFE_ORG_ID` regex `/^[A-Za-z0-9_\-]{1,64}$/` rejects illegal values before the database sees them.

**Known gap** ([`NYV-IAM-GAPS.md`](../pending_implementation_docs/NYV-IAM-GAPS.md), follow-up #42): the current pooled prod role is a `SUPERUSER`, which is exempt from RLS. Until a dedicated `nyv_app` role is provisioned and the app is pointed at it, RLS is a no-op in production even though enforcement is on. This is the highest-priority compliance unblock.

### 11.4 Field-level encryption

`src/services/field-encryption-service.ts` exposes `encryptedExpr(...)` / `decryptedExpr(...)` SQL fragments that wrap `pgp_sym_encrypt` / `pgp_sym_decrypt` with the session-scoped `app.field_encryption_key`. Migration `0004` adds `*_enc bytea` companion columns and back-fills via `pgp_sym_encrypt` when the key is set.

The mandated sensitive fields (Task #29) are: voice transcripts, identity-extraction fields, document extraction content, CLAWD bot conversation messages, mem0 long-term matter memory entries (`nv_matter_memory.content`), and citation / RAG full text (`document_embeddings.text`). Every insert / update is wrapped in a single Postgres transaction with the `pgp_sym_encrypt` mirror UPDATE (`db.transaction(async tx => { await tx.insert(...); await tx.update(...); })`). If `pgp_sym_encrypt` raises (missing key, pgcrypto absent, bytea conversion failure), the transaction rolls back and **no plaintext row is left without its encrypted companion**. There is no "log and continue" path on the write side.

The decrypt-on-read path uses `COALESCE(${decryptedExpr('content_enc')}, content)` — preferring the encrypted column, falling back to the legacy plaintext column during the dual-write transition. Once follow-up #41 drops the legacy plaintext columns, the COALESCE collapses to encrypted-only.

Key sourcing: `NYV_FIELD_ENCRYPTION_KEY` (preferred) or `ENCRYPTION_KEY` (fallback). Production startup fails fast when neither is set. Key rotation is a four-step zero-downtime procedure documented in [`NYV-COMPLIANCE-ATTESTATION.md`](./NYV-COMPLIANCE-ATTESTATION.md) §3.1.

### 11.5 Migrations

The migration runner is `scripts/nv-migrate.ts` plus `src/startup/nv-migration-safety-runner.ts`. drizzle-kit owns the SQL files in `drizzle/`; the runner applies them in lexicographic order and refuses to start the application if pending migrations would put security controls into an inconsistent state. Seed data (registries, default org, demo SDK keys for dev-edge) is loaded by `scripts/nv-seed-all.ts` after the schema is up.

---

## 12. Redis Architecture

ElastiCache Redis 7.1 is used for **five distinct workloads**. They share the cluster but use disambiguated key namespaces so an operator can `MONITOR` a single workload without swimming in noise.

| Workload | Key shape | TTL | Failure behaviour |
|---|---|---|---|
| **Distributed PII vault** | `nyv:pii:<sha256-of-token>` | 5 min default (`PX`) | Falls back to in-memory map; logs structured warning per `src/startup/nv-pii-vault-cleanup.ts` |
| **Rate limiting** | `nyv:ratelimit:<keyId>:<windowSeconds>` | window length | Best-effort; degraded mode logged once per process by the runtime auth gate (no `WRONGPASS` spam) |
| **Prompt cache (shared backend)** | `<lmcache-namespace>::<normalizedPrompt>` | 24 h (cold-tier TTL) | Best-effort; in-process tiers continue to serve. Opt-in via `LMCACHE_SHARED_BACKEND=redis` |
| **Audit chain lock** | `nv:audit:chain:lock` | 250 ms (TTL bound) | Helper returns `acquired:false`; writes proceed under in-process mutex + DB unique-index backstop alone |
| **BullMQ queues** | `bull:<queue>:*` | per-job | Boot-time gate sets `isQueueEnabled=false` if no usable Redis TCP URL; runtime auth gate flips to disabled on `WRONGPASS` / `NOAUTH`, no spam |

URL conventions (alphabetical):

- `LMCACHE_REDIS_URL` (preferred for prompt cache) → `REDIS_URL` → `NYV_REDIS_TCP_URL` (last-resort fallback).
- `NYV_REDIS_TCP_URL` is the **required** TCP `rediss://` URL for ioredis-based clients (PII vault, rate limiter, audit chain lock, BullMQ). The HTTPS REST endpoint `REDIS_URL` is **not** suitable for ioredis and is rejected at boot by `src/utils/env-validator.ts`.
- Auth tokens live in Secrets Manager at `nyv-<env>-redis/redis/auth` and are interpolated into the URL by the deployer; the gateway never ships with a literal token in `.env`.

The shared ioredis client (used by the audit lock and the rate limiter) installs a `reconnectOnError` predicate plus an `error` listener that detects `WRONGPASS` / `NOAUTH` replies, flips the local `_runtimeDisabled` flag, disconnects the socket, and stops new reconnect attempts. After that the same no-op semantics apply for the rest of the process lifetime — there is **no** ioredis "Unhandled error event" spam even when the URL parses but the password is wrong. This contract is documented in [`NYV-OBSERVABILITY.md`](./NYV-OBSERVABILITY.md) "Queue health" and tested in `tests/unit/security/audit-chain-lock.test.ts`.

---

## 13. LLM Orchestration & Routing

`src/services/real-llm-service.ts` (~2,600 lines) is the single point of contact between the gateway and any LLM provider. It wraps **17 providers** behind one router. The hot paths:

### 13.1 Provider rotation

`executeWithFallback(req, ctx)` builds the chain `[primary, ...getFallbackProviders(primary)]` and walks each in order. Per-provider failure (open breaker, network error, 4xx, 5xx, breaker timeout) is caught and logged at `WARN`; we move to the next provider in the chain rather than surfacing `Error: …` to the caller. A final terminal error is raised **only** after every provider in the chain has failed. Each provider call runs through the same named opossum breaker `llm:${providerId}` as the streaming path (see `executeStreamRequest` in the same file), so a degraded provider trips one shared circuit visible on both surfaces.

### 13.2 Hierarchical task allocator scoring

See §5.2 above. The Queen calls `hierarchicalTaskAllocator.selectAgents(task, ctx)` which returns an ordered list of candidate agents. The composite score blends jurisdiction match, tier proximity, success rate (rolling EWMA), latency factor (inverse of P95 ms), concurrency penalty, and per-jurisdiction outcome bias. The per-agent breakdown is exposed at `GET /api/nv/routing/weights` (params: `capability`, `jurisdiction`, `preferredTier`, `limit`).

### 13.3 Opossum circuit breakers

`src/services/circuit-breaker.ts` is the single registry. Surfaces:

| Surface | Timeout | Error % | Volume threshold | Window | Reset |
|---|---|---|---|---|---|
| `outbound:llm` | 60 s | 60% | 5 calls | 60 s | 45 s |
| `outbound:queue` | 10 s | 50% | 5 | 30 s | 30 s |
| `outbound:rag` | 30 s | 60% | 5 | 60 s | 30 s |

Plus: `outbound:capability`, `outbound:db`, `outbound:http`, `outbound:integration` — each a first-class `BreakerSurface` value with a registered policy in `DEFAULT_POLICIES`.

LLM provider calls run through `runWithRetryAndBreaker(`llm:${providerId}`, …, 'outbound:llm', { maxAttempts: 1 })` on **both** the sync and the streaming paths. We pin `maxAttempts: 1` for streaming because retrying mid-stream would replay the SSE chunks the caller already saw.

`listBreakers()` returns every registered name; `getBreakerStats(name)` returns `{ state, stats }` exposed under `breakers` on `/admin/health/full`.

### 13.4 Retry policy

`runWithRetryAndBreaker(name, fn, surface, opts)`:

- `maxAttempts` defaults to `3` for non-streaming, `1` for streaming.
- Backoff is exponential with ±20% jitter.
- Retried errors are network errors, 429s, and 5xx responses. 4xx other than 429 are not retried.
- When a breaker is open, the call fast-fails with `Breaker is open` within ~5 s instead of waiting for the full timeout.

### 13.5 Prompt-cache hit/miss flow

`src/services/lm-cache-service.ts` (~922 lines) is the per-agent prompt cache. Three in-process tiers (hot / warm / cold) plus an optional shared Redis backend. The flow inside `callAgentInner` (in the Queen):

1. Compute `indexKey = "<namespace>::<normalizedPrompt>"` where `namespace = nv-agent:tenant:<tenantId>:juris:<JURIS>:agent:<originalAgentId>` (ensures tenant + jurisdiction + agent isolation).
2. `LMCacheService.get(indexKey)` — checks hot, then warm, then cold, then (if `LMCACHE_SHARED_BACKEND=redis`) the Redis backend. On backend hit, hydrate into the hot tier.
3. Cache hit → short-circuit, return cached output, increment `hits` counter, skip the LLM call entirely.
4. Cache miss → run the LLM call; on success, `LMCacheService.set(indexKey, output)` write-throughs to the cold tier and (if backend is on) to Redis.
5. Cache invalidate (admin, Task #66) — `invalidateNamespace(ns)` propagates to the backend so other pods don't keep serving scrubbed answers.

The shared backend (Task #67) is opt-in (`LMCACHE_SHARED_BACKEND=redis`); default is in-process only. URL convention: `LMCACHE_REDIS_URL` → `REDIS_URL` → `NYV_REDIS_TCP_URL`.

> **TBD** — A Redis pub/sub fanout that propagates cache clears across all running pods is follow-up #78. Today an admin clear only invalidates the receiving pod's in-process cache; the other pods keep serving the stale answer until their own TTL fires (the shared-backend hit path does see the deletion, but in-process tiers do not invalidate cross-pod).

### 13.6 Sarvam voice integration

`src/services/voice/sarvam-adapter.ts` (path representative) wraps the Sarvam STT/TTS endpoints for Indian-language speech. Voice queries route through the same orchestration pipeline as text — no shortcut, no degraded safety. The transcribed text is tagged with `lang` and passed into `QueenOrchestrator.orchestrate()` as a normal request; the response is synthesised back via Sarvam TTS with the same language tag.

> **TBD** — Full Sarvam integration is on the May→August 2026 roadmap milestone; voice flows are wired but currently behind a feature flag (`NYV_FEATURE_SARVAM_FULL`). Resolved by the same milestone that hits 1 M MAU.

---

## 14. Queen Orchestration Internals

`src/orchestration/nv-queen-orchestrator.ts` (~3,180 lines) is the master orchestrator.

### 14.1 The `orchestrate()` lifecycle

```
QueenOrchestrator.orchestrate(req, ctx)
  ├── resolveJurisdiction(req, ctx)          // §5.3
  ├── span "queen.rag"           ── ragService.retrieve(...)
  ├── span "queen.memory"        ── memoryManager.snapshot(ctx)
  ├── span "queen.decompose"     ── pickPattern + decompose
  │     └── EMIT  decomposition_complete  (orchestrationId, subtaskCount)
  ├── span "queen.execute"       ── dagOrchestrationService.run(dag)
  │     ├── for each subtask:
  │     │   ├── EMIT  agent_started  (orchestrationId, agentId, subtaskId)
  │     │   ├── span "queen.agent" ── callAgentInner(agent, subtask)
  │     │   │     ├── lm-cache lookup (§13.5)
  │     │   │     ├── on miss: real-llm-service.executeWithFallback
  │     │   │     └── perfTracker.beginExecution / .endExecution
  │     │   ├── on success → EMIT  agent_completed  (output, tokens, latencyMs)
  │     │   └── on failure → EMIT  agent_failed     (errorMessage)
  ├── EMIT synthesis_started     (orchestrationId)
  ├── span "queen.synthesis"     ── orchestrationMiddleware.synthesize(...)
  ├── EMIT synthesis_complete    (output, citations, confidence)
  └── appendAuditRecord(...)     // hash chain + Redis lock + DB unique
```

**Six lifecycle events per orchestration** (the AG-UI contract):

| Event | When | Tags |
|---|---|---|
| `decomposition_complete` | After the Queen picks pattern + agent set | `orchestrationId`, `subtaskCount`, `pattern` |
| `agent_started` | Per subtask, before LLM call | `orchestrationId`, `agentId`, `subtaskId` |
| `agent_completed` | Per subtask, after LLM call success | `orchestrationId`, `agentId`, `subtaskId`, `tokens`, `latencyMs` |
| `agent_failed` | Per subtask, on LLM call failure | `orchestrationId`, `agentId`, `subtaskId`, `errorMessage` |
| `synthesis_started` | Before reduce phase | `orchestrationId` |
| `synthesis_complete` | After reduce phase | `orchestrationId`, `outputChars`, `citations`, `confidence` |

### 14.2 `orchestrationId` correlation

Every orchestration is assigned a typed `OrchestrationId` (Task #37) at the very top of `orchestrate()`. The ID propagates through every span tag, every AG-UI event, every audit row, and every log line — so `orchestrationId=<uuid>` joins the trace, the event stream, the audit, and the logs into one queryable thread. The format is documented as a typed brand in `src/types/nv-orchestration-id.ts`.

> **TBD** — A regression test that asserts every emitted streaming event carries the ID is follow-up #62.

### 14.3 AG-UI streaming forwarding

`src/routes/nv-agui-stream-routes.ts` (~938 lines) holds the SSE handler. Key invariants:

- **Per-request emitters** (Task #64). Each request creates its own EventEmitter; it is **not** the singleton orchestrator. This makes cross-tenant event leakage structurally impossible.
- **Cross-tenant regression** (Task #36) — `tests/streaming/agui-no-cross-leak.test.ts` fans out two tenants in parallel and asserts no event from tenant A reaches tenant B's stream. The test is flaky-resistant because it asserts on the per-request emitter ID, not on timing.
- **Replay** — `GET /api/nv/agui/stream/:orchestrationId/replay` re-emits the events from `nv_orchestration_events` in original order. Useful for partner UIs that lose the connection mid-stream and want to resume.

### 14.4 Per-request emitters (post-Task #64)

Before Task #64, the AG-UI route subscribed to a singleton `OrchestratorEvents` emitter and filtered by `orchestrationId`. That meant a bug in the filter was a tenant-leak vulnerability. Post-Task #64, the orchestrator constructs a fresh emitter per `orchestrate()` call, hands the emitter to the AG-UI route, and tears it down on completion or client disconnect. The result: there is no shared event bus to leak from. Other event consumers (audit, metering) receive events by direct callback wiring rather than through the singleton — see follow-up #84 (cancelled, resolved by Task #64) in [`NYV-AGENT-SUGGESTED-FOLLOWUPS.md`](../pending_implementation_docs/NYV-AGENT-SUGGESTED-FOLLOWUPS.md).

---

## 15. Agent Prompt Execution

### 15.1 `buildAgentPrompt(agent, request, ctx)`

Composes the system prompt for one LLM call. The composition is, in order:

1. **The 22-section ROMA L5 prompt** for the agent, resolved by `resolveAgentSystemPrompt(agent, request)` from `src/services/nv-jurisdiction-prompt-resolver.ts` — eager-loaded from the seven JSON registries at boot. **Throws `PromptNotFoundError` on miss; no silent fallback.**
2. **Parlant rules** — the multi-turn legal-conversation rules from §6 (disclaimer obligations, jurisdiction binding, refusal conditions, escalation triggers).
3. **BMAD shared-context block** — when the request is part of a multi-agent cluster sharing context (e.g. P12 DISPATCHER fan-out), the shared document set is referenced with stable IDs.
4. **Language and format directives** — `lang` from the request (defaulting to the user's profile language), `format` (e.g. `markdown` / `plain` / `pdf-ready`).
5. **Tool affinity hints** — which tools (RAG, calculator, citation verifier) the agent is permitted to call this turn.

The composed prompt becomes the `system` message for the LLM call. The user message is the subtask input.

### 15.2 Cache namespace

`namespace = "nv-agent:tenant:<tenantId>:juris:<JURIS>:agent:<originalAgentId>"`. Tenant + jurisdiction + agent are all in the namespace, so:

- A hit for tenant A on India agent X never serves tenant B's same query.
- A cached answer to "what is BNS section 103" under the IN registry never serves a US-jurisdiction request even if the prompt text is identical.
- Cache invalidation can scope to a single agent, a single jurisdiction, or a whole tenant by passing the appropriate prefix to `invalidateNamespace(prefix)`.

### 15.3 Cache hit short-circuit

On hit, `callAgentInner` returns the cached `{ output, tokens, latencyMs }` without ever calling the LLM. The cache hit is logged with `cache_hit:true` and the perf tracker still records the (zero-cost) execution so the routing weights remain accurate.

### 15.4 LLM failure fallback

`real-llm-service.executeWithFallback` walks the provider chain (§13.1). When **every** provider fails:

- The orchestrator emits `agent_failed` with a structured `errorMessage`.
- The pattern's failure policy decides what happens next:
  - `lite` tier (`fail-fast`): the whole orchestration fails; the user sees a structured error and a `traceId`.
  - `mitra` / `enterprise` (`partial-tolerate`, `maxFailedNodes` 1 / 3): synthesis proceeds with the available agent outputs and a "this analysis was assembled from N of M expected agents" note.
  - `sovereign` (`best-effort`, `maxFailedNodes` 8): synthesis proceeds with whatever returned.

The failure path is observable: every `agent_failed` event lands in `nv_orchestration_events` and the `errorMessage` is also stamped on the `queen.agent` span as the `errorMessage` tag for Sentry filtering.

---

## 16. Chain-of-Thought / ReAct / Tree-of-Thought Integration

Reasoning frameworks plug into the Queen's `execute` phase, not its `decompose` phase — the Queen always picks a pattern first, then the pattern picks the framework.

| Framework | State | Code | Plugged in by |
|---|---|---|---|
| **Chain-of-Thought (CoT)** | Live | `src/services/chain-of-thought-service.ts` | P10 MENTOR (always), P22 ADVISOR (default), P8 REFINER (in the inner pass) |
| **ReAct** | Live | composed inside `src/services/agent-orchestration.ts` (tool-using interactive reasoning) | Patterns that need tool affinity (P14 CALCULATOR, P15 PARSER, P17 SENTINEL) |
| **Tree-of-Thought (ToT)** | Partially scaffolded | scaffolding under `src/services/intelligence/` | P5 SWARM (planned to use ToT for branch-prune); not yet wired |

> **TBD** — Tree-of-Thought is partially scaffolded per Task #27's deferred follow-ups. Today P5 SWARM uses straight best-of-N parallel execution with a synthesis fan-in (no branch pruning). The branch-prune wiring is queued behind the broader patterns refactor; tracked in [`NYV-ROADMAP-Q2-Q4-2026.md`](../pending_implementation_docs/NYV-ROADMAP-Q2-Q4-2026.md) Q3 2026.

The reasoning trace is observable. CoT writes step-by-step rationales into the `nv_orchestration_subtasks.reasoning` column; ReAct writes tool-call traces into `nv_orchestration_subtasks.tool_calls` (JSONB). Both are returned in the API response under `response.reasoning` and `response.tool_calls` for any pattern that opts in (MENTOR opts in by default; lawyer-facing patterns opt in via `?reasoning=true`).

---

## 17. RAG System

### 17.1 Corpus selection

`src/services/rag-service.ts` selects which corpus to retrieve from based on the request:

| Request shape | Corpus | Selection rule |
|---|---|---|
| `?corpus=statute` or default for legal Q&A | **Statute** corpus | Filtered by jurisdiction tag |
| `?corpus=case` or pattern P21 PLEADER | **Case-law** corpus | Filtered by jurisdiction + court hierarchy |
| `?corpus=template` or pattern P2 ACONIC drafting step | **Template** corpus | Filtered by document type |
| Authenticated request with `tenantId` set + `?include_private=true` | **Partner-private** corpus | Filtered by `org_id` (RLS-enforced) |

The selection is logged on the `queen.rag` span as the `corpus` tag.

### 17.2 Retrieval scoring (hybrid)

Each retrieve call runs **vector similarity + BM25** in parallel and merges the results with reciprocal rank fusion (RRF):

```
score(chunk) = 1 / (k + rank_vector(chunk)) + 1 / (k + rank_bm25(chunk))
where k = 60 (the standard RRF constant)
```

Top-N (default 8) are returned. The retrieval method is exposed on the `queen.rag` span as the `retrievalMethod` tag (`vector` / `hybrid` / `bm25` / `none`) and on the admin health endpoint as `rag_retrieval.byMethod[…]`.

### 17.3 Jurisdiction filtering

`document_embeddings` carries a `jurisdiction VARCHAR(8)` column populated at ingest. The retrieval query always includes a `WHERE jurisdiction IN (<resolvedJurisdiction>, 'GLOBAL')` clause — so an Indian question never retrieves an irrelevant US precedent. A `GLOBAL` row is something genuinely cross-jurisdiction (e.g. a UN convention).

### 17.4 Embedding model

Default: `text-embedding-3-small` (OpenAI) for the statute / case / template corpora, configurable via `NYV_EMBED_MODEL`. Partner-private corpora can pin a different model per org.

### 17.5 Vector store

**Today:** Postgres with `pgvector` (`document_embeddings.embedding vector(1536)`). All retrieval queries are SQL through drizzle.

**Tomorrow:** an external vector store (pgvector remains for partner-private; statute / case move out) is on the 10 M MAU plan — see §26. The flag is `NYV_VECTOR_STORE` (`pgvector` / `pinecone` / `qdrant` — only `pgvector` is wired today).

---

## 18. Memory System

`src/services/memory/nv-5tier-memory-service.ts` implements the five tiers from §4.6 of the business note:

| Tier | Table | Purpose | What flows in/out per request |
|---|---|---|---|
| **Session** | `nv_session_memory` | Current conversation | Recall: last N turns. Persist: every `synthesis_complete` |
| **Episodic / matter** | `nv_matter_memory` | The current matter (a specific case or deal) | Recall: prior orchestrations on the same `matterId`. Persist: orchestration summary |
| **Semantic** | derived from `nv_users` + `nv_org_settings` | Standing context (firm, jurisdiction, practice area) | Recall: user profile. Persist: rare, on profile change only |
| **Long-term** | `nv_long_term_memory` | Case histories | Recall: cross-matter summaries. Persist: end-of-matter checkpoint |
| **Social** | `nv_social_memory` | Known counterparties, judges, opposing firms | Recall: entity lookup by name/PAN/CIN. Persist: incremental on every mention |

### 18.1 What flows in / out per request

On `QueenOrchestrator.orchestrate()`:

1. **Recall (start of run, in `queen.memory` span):** session (last N turns), matter (last K orchestrations for this matter), semantic (user profile), long-term (matter index hit), social (entities mentioned in the request).
2. **Persist (post-`synthesis_complete`):** new session row, append to matter, conditional long-term checkpoint, social entity updates.

### 18.2 Storage backend

The default is in-memory backed by Postgres (`backend: 'in-memory'` on the health snapshot — meaning Postgres is the source of truth and there is no separate fast-path cache layer). Postgres-backed long-term memory is encrypted at the field level (`nv_matter_memory.content` → `content_enc bytea` via `pgp_sym_encrypt`, §11.4).

### 18.3 Retention

Per-org configurable in `nv_org_settings.memory_retention_days`. Default is 365 days for matter / long-term, 30 days for session, indefinite for semantic + social. A nightly job (`scripts/nv-memory-prune.ts`) walks expired rows and deletes them; the deletion is recorded in the audit chain.

### 18.4 Pressure

`nvMemoryManager.getPressure()` returns `{ status: 'ok' | 'elevated' | 'critical', heapPct }`. When `critical`, recall trims aggressively (last 1 turn instead of last N). The pressure status is stamped on the `queen.memory` span as the `pressureStatus` tag.

---

## 19. Multi-Tenant Architecture

### 19.1 Tenant × org × API key model

- **Tenant** = an organisation that uses Nyayavigya. One row in `nv_orgs`. Identified by `orgId`. Owns its users, keys, documents, memory, audit log.
- **User** = a human (or service principal) that can sign in. One row in `nv_users`, with a foreign key to `nv_orgs`. Carries a default `jurisdiction`.
- **API key** = a `nyv_live_sk_…` or `nyv_test_sk_…` key issued from the SDK Console. One row in `nv_sdk_keys`, with a foreign key to `nv_sdk_applications` → `nv_orgs`. Hashed with bcrypt; the raw key is shown once at issue and never again.
- **SDK application** = the partner's app config (allowed domains, webhook URL, webhook secret hash, jurisdictions). One row in `nv_sdk_applications`.

A request authenticates with one of: a user JWT (cookie), an API key (`Authorization: Bearer nyv_live_sk_…`), or an admin token. The middleware `tenantIsolation` resolves the `orgId` from any of those auth surfaces and stamps `req.orgId` for downstream use.

### 19.2 RLS posture

See §11.3. Migration `0004` installs strict policies on every `nv_*` / `ns_*` / `ni_*` / `nm_*` table that carries `org_id`. Enforcement is gated on `NYV_RLS_ENFORCE=true`. The connection-safe wrapper is `req.withTenant(async (tx) => …)` — work happens on the transaction's pinned connection, with `SET LOCAL app.current_org_id` reverted on COMMIT/ROLLBACK.

### 19.3 Cache namespace isolation

LM cache: `nv-agent:tenant:<id>:juris:<JURIS>:agent:<id>` — see §15.2.

PII vault: `nyv:pii:<sha256-of-token>` — the token is per-session and per-tenant, so the SHA includes the tenant implicitly via the token's randomness.

Rate limiter: `nyv:ratelimit:<keyId>:<windowSeconds>` — `keyId` is the SDK key id, which is tenant-scoped.

### 19.4 Cross-tenant safety check

Three-layer enforcement:

1. **Gateway middleware** (`tenantIsolation`) — resolves `orgId` from auth and rejects any request that tries to override it via body/query.
2. **Agent dispatcher** — every cache lookup, memory recall, and RAG retrieval keys on `req.orgId`. There is no codepath that constructs a key without it.
3. **Database** — RLS policies (when `NYV_RLS_ENFORCE=true`).

Regression: `tests/streaming/agui-no-cross-leak.test.ts` (Task #36) fans out two tenants in parallel and asserts no event from tenant A reaches tenant B's stream. Follow-up #63 extends this to other streaming endpoints (SSE for agent thoughts, WebSocket voice channel).

---

## 20. Admin Features

All admin endpoints are mounted under `/api/nv/admin/*` and gated by `authenticateToken + requireAdmin`. The full set:

| Feature | Endpoint | Source |
|---|---|---|
| **Health (full)** | `GET /api/nv/admin/health/full` | `src/routes/nv-health-full-routes.ts` (alias of `/api/nv/health/full`); see §24 for the full payload shape |
| **Routing weights dashboard** | `GET /api/nv/admin/routing-weights` (HTML) and `GET /api/nv/routing/weights` (JSON) | `src/routes/nv-routing-weights-routes.ts` (Task #69) |
| **Cache invalidation** | `POST /api/nv/admin/cache/invalidate` (CLI: `scripts/nv-cache-clear.ts`) | `src/routes/nv-roma-l5-admin-routes.ts` (Task #66) |
| **Cache stats** | `GET /api/nv/admin/cache/stats` | same |
| **Audit trail viewer** | `GET /api/nv/admin/audit?from=…&to=…&tenant=…` | `src/routes/nv-roma-l5-admin-routes.ts` |
| **Org / user management** | `GET/POST/PATCH/DELETE /api/nv/admin/orgs/*`, `/users/*` | `src/routes/nv-enterprise-admin-routes.ts` |
| **SDK app + key management** | `GET/POST /api/nv/sdk/console/apps/*`, `…/keys/*`, `…/webhook/test` | `src/routes/nv-sdk-console-routes.ts` |
| **Feature flags** | `GET/POST /api/nv/admin/feature-flags/*` | `src/routes/nv-feature-flags-routes.ts` |
| **Billing** | `GET /api/nv/admin/billing/orgs/:id/credits` | `src/routes/nv-credits-routes.ts` |
| **Compliance forms** | `POST /api/nv/consent/*`, `POST /api/nv/compliance/data-subject-request` | `src/routes/nv-consent-routes.ts`, `src/routes/nv-compliance-routes.ts` |

> **TBD** — Four DPDPA endpoints (data-subject request, consent record, incident report, evidence chain) currently return 500 with raw Postgres parser errors per UAT v3.2; a fifth coerces a missing tenant ID to the string `"NaN"`. Tracked as follow-up #48 (P0).

> **TBD** — Cache-clear admin **UI** (one-click from the console, list of recent clears for compliance review, cross-pod fanout) is follow-ups #76, #77, #78 (P1–P2). Backend endpoints exist; UI does not.

---

## 21. SDK Architecture

### 21.1 Three variants

| Variant | Package | Audience | Reference |
|---|---|---|---|
| **Web (server-side or edge proxy)** | `@nyayavigya/client-sdk` | Backend / Next.js apps | [`NYV-SDK-v6-INTEGRATION-GUIDE.md`](./NYV-SDK-v6-INTEGRATION-GUIDE.md) |
| **React hooks** | `@nyayavigya/react-hooks` | React apps consuming the gateway via a proxy | same |
| **Mobile (React Native + Expo)** | `@nyayavigya/mobile-sdk` (planned) | iOS / Android | [`NYV-MOBILE-INTEGRATION-GUIDE.md`](./NYV-MOBILE-INTEGRATION-GUIDE.md), store submission per [`NYV-MOBILE-STORE-SUBMISSION-CHECKLIST.md`](./NYV-MOBILE-STORE-SUBMISSION-CHECKLIST.md) |

Each variant ships in three tiers (Lite, Mitra, Enterprise/Sovereign) so partners pull only what they need.

### 21.2 Package structure

```
packages/
  client-sdk/               // @nyayavigya/client-sdk — main SDK
    src/
      NyvClient.ts          // top-level client; ask(), stream, etc
      stream/               // SSE handler with retry + abort
      errors.ts             // NyvError + retryable classification
      types.ts              // re-exports from @nyayavigya/types
    SEMVER.md               // 90-day notice + side-by-side migration policy
  react-hooks/              // @nyayavigya/react-hooks
  types/                    // @nyayavigya/types — shared types
```

### 21.3 API key + webhook flow

1. Partner signs into `app.nyayavigya.in/console`, opens **SDK Apps** → **+ New app**, picks platform + jurisdiction.
2. Console issues a `nyv_live_sk_…` key. The raw key is shown once and never again. The DB stores a bcrypt hash.
3. Optionally the console generates a `nyv_whsec_…` webhook secret and stores its hash; the raw secret is shown once.
4. Gateway POSTs `orchestration.completed` payloads (and others) to the registered webhook URL with HMAC-SHA256 signature in the `X-NYV-Signature` header (secret + timestamp). The receiver verifies with the recipe in [`NYV-SDK-v6-API-REFERENCE.md`](./NYV-SDK-v6-API-REFERENCE.md) §5.
5. Test delivery: `POST /api/nv/sdk/console/apps/:id/webhook/test` — returns the delivery id; the receiver's logs show the synthetic event.

### 21.4 npm publishing pipeline (Task #45)

`scripts/sdk-publish.sh` builds, tests, and publishes each package to the npm registry under the `@nyayavigya` scope. Versioning per `packages/client-sdk/SEMVER.md`: at least 90 days' notice + side-by-side migration guide for major bumps.

> **TBD** — End-to-end "pull the published SDK into a clean container, run the quickstart, assert the gateway responds" test is follow-up #52 (P1). Today the publish pipeline succeeds but no automated check verifies an external partner can actually install and run it. Companion follow-ups: #51 (publish `@nyayavigya/types`), #57 (make the SDK installable for partners), #59 (web quickstart that runs from the README).

### 21.5 v5 vs v6

- **v6** is GA. Use it. References: [`NYV-SDK-v6-API-REFERENCE.md`](./NYV-SDK-v6-API-REFERENCE.md), [`NYV-SDK-v6-INTEGRATION-GUIDE.md`](./NYV-SDK-v6-INTEGRATION-GUIDE.md).
- **v5** receives security patches only per [`superseded/NYV-SDK-v5-DEPRECATION-POLICY.md`](../superseded/NYV-SDK-v5-DEPRECATION-POLICY.md). New integrations must use v6.

---

## 22. Context Management & Response Delivery

### 22.1 Request context construction

The middleware chain assembles `req.ctx` in this order:

1. `tenantIsolation` → `req.orgId`, `req.tenant`.
2. `nv-rate-limit-middleware` → consumes Redis budget; rejects with 429 when over.
3. `nv-sdk-tracking-middleware` → `req.sdkApp`, `req.sdkKey`, `req.audit` (the open audit row).
4. `nv-org-rls-middleware` → `req.withTenant(fn)` helper (§11.3).
5. `requestMetrics` → starts the in-rolling-window counter.
6. The route handler builds `req.ctx = { orgId, userId, tenantId, jurisdiction, tier, language, format, ... }` and passes it to `QueenOrchestrator.orchestrate(req.body, req.ctx)`.

### 22.2 Streaming vs synchronous response paths

- **Synchronous** (`POST /api/nv/orchestrate`): the gateway awaits the full orchestration and returns one JSON response with `{ answer, citations, reasoning, tool_calls, traceId, patternUsed, costInr, confidence }`.
- **Streaming** (`POST /api/nv/agui/stream`): the gateway returns `Content-Type: text/event-stream` immediately and pushes the six lifecycle events (§14.1) as they happen. The final `synthesis_complete` event carries the same fields as the sync response. SDKs default to streaming for `> 5 s` patterns and sync for `< 5 s` patterns.

### 22.3 AG-UI event semantics

Each event is a single SSE frame: `event: <name>\ndata: <json>\n\n`. The JSON is `{ orchestrationId, ts, ... event-specific tags ... }` (§14.1). The SDK parses the `event` field and dispatches to the right callback (`onTextDelta`, `onComplete`, `onError`). Replay (`GET /api/nv/agui/stream/:orchestrationId/replay`) re-emits the events from `nv_orchestration_events` in original order.

### 22.4 Format / language coordination

`format` is one of `markdown` (default), `plain`, `pdf-ready`, `docx-ready`. The Queen passes `format` into `buildAgentPrompt` (§15.1) so the agent's system prompt picks the matching directive block. `language` (e.g. `en`, `kn`, `ta`, `hi`) does the same for output language. Voice flows tag `language` from the STT step.

### 22.5 Response headers (every response)

| Header | Meaning |
|---|---|
| `X-NYV-Trace-Id` | Surface this in your error UI for support. Same as `response.traceId`. |
| `X-NYV-Pattern-Used` | The pattern actually executed (router decisions). |
| `X-NYV-Cost-Inr` | Estimated INR spend for the call. |
| `X-NYV-Orchestration-Id` | The typed orchestration ID. Joins to spans, audit, events. |

---

## 23. Security & Compliance Posture

### 23.1 Authentication and session

- **JWT** signed with `JWT_SECRET` (Secrets Manager: `nyayavigya/<env>/gateway/jwt_secret`). Algorithm: `HS256`. TTL: 1 h. Issued by `POST /api/nv/auth/login`.
- **Refresh token** signed with `JWT_REFRESH_SECRET`. TTL: 30 days. Stored httpOnly + Secure cookie.
- **Rotation** — `JWT_SECRET` rotation procedure documented in DR Drill #3 ([`NYV-DR-DRILL-RESULTS.md`](./NYV-DR-DRILL-RESULTS.md)): set new value, restart, fresh logins work, rollback within 5 min if needed.
- **API keys** — bcrypt hashed; raw shown once at issue. Format: `nyv_(live|test)_sk_<partner>_<32-char-token>`.
- **HMAC webhooks** — `X-NYV-Signature: t=<unix>,v1=<hex>` where v1 = HMAC-SHA256(secret, `t.body`). Receivers verify timestamp ≤ 5 min drift.

### 23.2 PII vault (Task #29)

`src/startup/nv-pii-vault-cleanup.ts` — Redis-backed (`NYV_REDIS_TCP_URL`, `PX` TTL 5 min default), with structured loud warning on fallback to in-memory. Janitor runs every 5 min. Used by identity-extraction and voice-transcription paths to hold sensitive tokens before they're consumed.

### 23.3 Field-level encryption (Task #29)

See §11.4. Six mandated sensitive fields, fail-closed dual-write transactions, decrypt-on-read with `COALESCE(${decryptedExpr(col)}, col)`, key rotation per [`NYV-COMPLIANCE-ATTESTATION.md`](./NYV-COMPLIANCE-ATTESTATION.md) §3.1.

### 23.4 Audit hash chain (Task #29 + #43)

`src/middleware/nv-sdk-tracking-middleware.ts` exports `appendAuditRecord` — the universal writer. `src/services/audit-chain-lock.ts` implements the cross-pod Redis lock with compare-and-delete release (Task #43). The DB unique-index `nv_audit_logs_prev_hash_uniq` is the cross-pod backstop. Test coverage: `tests/unit/security/hash-chain.test.ts` — broken chain throws, concurrent writers serialize, two-pod + 10-pod fan-out, graceful Redis-down degradation.

A scanning test fails the build if any new file outside `nv-sdk-tracking-middleware.ts` introduces a direct `INSERT INTO (nv_schema.)?nv_audit_logs`. The legacy `public.nv_audit_logs` table is now writer-free; the canonical chain target is `nv_schema.nv_audit_logs`.

### 23.5 Fail-closed enforcement

When `appendAuditRecord` raises during SDK key creation, the handler **does not** swallow it. Instead it (a) marks the just-issued key `is_active=false` so it cannot authenticate, and (b) returns HTTP 500 with code `NYV-KEYLIFE-AUDIT-001` so the caller retries. An unauditable raw key never escapes the handler. Test: `"SDK key-lifecycle route fails closed when chain enforcement fails"`.

### 23.6 DPDP + GDPR posture

Per [`NYV-COMPLIANCE-ATTESTATION.md`](./NYV-COMPLIANCE-ATTESTATION.md). DPDPA §8(5) (PII vault, field encryption), §9(1) (RLS multi-tenant isolation). GDPR via the EU-AI-Act compliance service (`src/services/eu-ai-act-compliance-service.ts`); Art. 10 (data-and-data-governance) covered by field encryption.

### 23.7 Known gaps

- **RLS enforcement** is gated on `NYV_RLS_ENFORCE` and on the app pool running as a non-superuser role — both pending follow-up #42 (P0).
- **WAF enforcement** is in count-only mode pending follow-up #19 (P1) and #20 (alarm destination).
- **Legacy plaintext columns** (the COALESCE fallback) drop pending follow-up #41 (P1).

---

## 24. Observability Stack

This section consolidates [`NYV-OBSERVABILITY.md`](./NYV-OBSERVABILITY.md) into a single diagram + payload reference. Read the full doc for SLO definitions and dashboard URLs.

### 24.1 Three layers

1. **Sentry** — application errors + traces, per-tenant. DSN secret `nyayavigya/prod/gateway/sentry_dsn`. Sample rate 1.0 errors / 0.1 traces. Per-tenant tag `tenant=<organization_id>` set by middleware.
2. **CloudWatch** — infra metrics, logs, alarms, dashboards. Log groups `/aws/nyayavigya/<env>/{gateway,console,caddy,nym,nsp,nsi,nsa,nsm}`, 30 d retention.
3. **Caddy access logs** — JSON, 50 MB × 7 in-container.

### 24.2 Span schema (Queen lifecycle)

Tracer: `src/utils/nyv-tracer.ts`. With `NYV_SENTRY_DSN` set, the in-process spans are mirrored as Sentry transactions; without, they fall back to JSONL logs plus a 200-sample-per-name in-memory ring buffer that powers `tracer.spanLatencies` on `/admin/health/full`. See [`NYV-OBSERVABILITY.md`](./NYV-OBSERVABILITY.md) "Span schema" for the per-span tag list.

### 24.3 Operator dashboard panel → field mapping

The reviewer-flagged KPIs from Task #28 round 11 (excerpted from the same doc):

| Dashboard panel | Field on `/api/nv/admin/health/full` |
|---|---|
| **LLM prompt-cache hit rate** | `prompt_cache.llm_prompt_cache.hitRate` (+ `hits`, `misses`, `entries`, hot/warm/cold split) |
| **KV cache hit rate** | `prompt_cache.kv_cache.hitRate`, `mode` (`redis` / `in-memory-lru`) |
| **RAG retrieval hit rate** | `rag_retrieval.hitRate`, `attempts`, `avgLatencyMs`, `byMethod[vector\|hybrid\|bm25\|none]` |
| **RAG recall latency** | `tracer.spanLatencies['queen.rag']` (end-to-end) + `rag_retrieval.avgLatencyMs` |
| **Memory recall hit rate** | `memory.tiers.session.hitRate` |
| **LLM provider streaming fallback** | `llm_providers.health[].successRate`; rotation logged at WARN as `stream provider 'X' failed (…); rotating` |
| **Per-provider breaker state** | `llm_providers.breakers[provider]` |
| **Other named breakers** | `breakers[name]` (`llm:openai`, `llm:openrouter`, `outbound:llm`, …) |
| **Queue depths** | `queues.queues[name]` when `queues.enabled=true`, else `queues.reason` |
| **Tracer pattern × jurisdiction × tier × agent-tier** | `tracer.spanLatenciesByTag[span][tagKey][tagValue]` |

What's **not** on the public `/api/nv/health/full` (NYV-OBS-PUBLIC-REDACT-001): everything except `status / platform / services{name:{status}}`. The full detail is admin-only.

### 24.4 Request metrics (60 s rolling)

`src/middleware/nyv-request-metrics.ts` — `requests.totalRequests`, `requests.totalErrors`, `requests.rpsLastMinute`, `requests.errorClassHistogram`, `requests.recentErrors[]` (last 100). Lightweight, no Prometheus dependency.

### 24.5 SLOs

| Service | SLI | Target |
|---|---|---|
| `api.nyayasiddhi.online` | success rate (non-5xx) | 99.5% |
| `api.nyayasiddhi.online` | p95 response time | < 1.2 s for `/v1/chat`, < 250 ms for `/v1/branding/*` |
| RDS | availability | 99.9% (multi-AZ guarantees) |

### 24.6 Sentry-mode setup

See [`NYV-OBSERVABILITY.md`](./NYV-OBSERVABILITY.md) §"Sentry-mode setup" for the 5-step procedure (set DSN, restart, verify on `/admin/health/full`, run one orchestration, sample-rate tune). Local smoke: `scripts/nv-smoke-task39-sentry-tracer.ts`.

> **TBD** — Backend uncaught exception → Sentry wiring is follow-up #53 (P1). Today the tracer ships spans to Sentry but uncaught backend errors only hit the JSON logger.

> **TBD** — Per-tenant Sentry tagging is follow-up #54 (P1). Spans carry `orchestrationId` / `jurisdiction` but not `orgId` / `tenantId` yet.

---

## 25. Operational SOPs

| Procedure | Document | Trigger |
|---|---|---|
| **Incident response** | [`NYV-INCIDENT-RUNBOOK.md`](./NYV-INCIDENT-RUNBOOK.md) | Any `5xx > 10/min` alarm or paging event |
| **DR drills** | [`NYV-DR-DRILL-RESULTS.md`](./NYV-DR-DRILL-RESULTS.md) | Quarterly cadence; drills #1–#4 scheduled within 14 d of first prod `terraform apply` |
| **Secrets rotation** | [`NYV-SECRETS-MANAGEMENT.md`](./NYV-SECRETS-MANAGEMENT.md) + DR Drill #3 | Quarterly + on suspected compromise |
| **Secrets cleanup (legacy)** | [`NYV-SECRETS-CLEANUP.md`](./NYV-SECRETS-CLEANUP.md) | One-shot during migration windows |
| **Cert + DNS rotation** | [`NYV-DNS-AND-EDGE.md`](./NYV-DNS-AND-EDGE.md) | ACM cert auto-renews 60 d before expiry; DNS unchanged |
| **RDS migration** | [`NYV-RDS-MIGRATION-RUNBOOK.md`](./NYV-RDS-MIGRATION-RUNBOOK.md) | Major-version upgrades, region moves |
| **Replit → EC2 deploy** | [`NYV-CICD-REPLIT.md`](./NYV-CICD-REPLIT.md) + `scripts/deploy-replit-direct.sh` | Every deploy |
| **Partner onboarding** | [`NYV-PARTNER-DEPLOY-GUIDE.md`](./NYV-PARTNER-DEPLOY-GUIDE.md) | New partner provisioning |
| **Datastore cutover (dev-edge → managed)** | [`AWS-MANAGED-DATASTORES-2026-04-24.md`](./AWS-MANAGED-DATASTORES-2026-04-24.md) | One-shot, ~15 min wall-clock |
| **DNS cutover** | [`AWS-DNS-HANDOFF-2026-04-24.md`](./AWS-DNS-HANDOFF-2026-04-24.md) | One-shot, NS-delegation gated |

The **incident bridge call number**, **on-call rotation**, **escalation matrix**, and **PagerDuty inbound URL** all live in the incident runbook (not duplicated here).

---

## 26. Future Roadmap & Path to 10 M MAU

This section is a cross-reference to [`NYV-ROADMAP-Q2-Q4-2026.md`](../pending_implementation_docs/NYV-ROADMAP-Q2-Q4-2026.md) — read that doc for sequencing. What follows is the technical-only delta between today (single-EC2 + RDS-t4g.small, ~thousands RPM) and the 10 M MAU target (~150 RPS sustained, 600 RPS peak, hundreds of millions of orchestrations / month).

### 26.1 Compute — single EC2 → EKS

- **Today.** Single `t3.large` running ~10 containers via docker-compose. Single point of failure for the host (mitigated by RDS / Redis being external + DR Drill #2 reprovision).
- **Tomorrow.** EKS cluster in `ap-south-1` with at least 3 AZs. Gateway runs as a Deployment with HPA on CPU + custom (RPS-based) metric. Caddy replaced by an ALB Ingress controller. Console becomes its own Deployment. Per-partner front-ends each become their own Deployment behind their own host-routed Ingress rule. Estimated cost: ~10× today, but with elasticity.

### 26.2 Database — t4g.small → r6g sizing

- **Today.** RDS `db.t4g.small`, single-AZ in dev-edge, multi-AZ in prod, 7 d PITR.
- **Tomorrow.** RDS `db.r6g.xlarge` (or larger) with multi-AZ + at least one read replica per region. Read replica for analytics + RAG retrieval to keep transactional load on primary. Storage scales to 500 GB+ on gp3 with provisioned IOPS. PITR window extended to 35 d.

### 26.3 Cache — single node → cluster mode

- **Today.** ElastiCache `cache.t4g.micro`, no replica.
- **Tomorrow.** ElastiCache cluster mode with at least 3 shards, each with one replica. Promotes the audit-chain lock from "best-effort cross-pod" to "guaranteed cross-pod"; promotes the prompt cache to "fully cross-pod" (closing follow-up #78); enables BullMQ to use Redis-backed queues at sustained rates.

### 26.4 Multi-region (DR posture)

- **Today.** Single region (`ap-south-1`). Region loss is paper-drilled (Drill #4) but `envs/prod-dr/` does not exist.
- **Tomorrow.** Active-passive with `ap-south-2` as warm DR. RDS cross-region read replica + Secrets Manager cross-region replication. Route 53 health-check-driven failover. Estimated RTO: 4 h; RPO: 5 min (same as PITR).

### 26.5 Observability scale

- **Today.** Sentry sample 0.1, JSONL fallback ring buffer for 100% in-memory.
- **Tomorrow.** Sentry sample 0.05, OpenTelemetry export to a dedicated OTel collector → Sentry + a separate metrics sink (CloudWatch metrics or Prometheus). Logs to OpenSearch for long-tail querying. Per-tenant Sentry projects optional for sovereign-tier customers.

### 26.6 Cost envelope

- **Today.** ~USD 90/mo (EC2 + ALB + RDS + Redis + Route 53 + S3 + CloudWatch — see [`AWS-DNS-HANDOFF-2026-04-24.md`](./AWS-DNS-HANDOFF-2026-04-24.md) and [`AWS-MANAGED-DATASTORES-2026-04-24.md`](./AWS-MANAGED-DATASTORES-2026-04-24.md)).
- **Tomorrow (10 M MAU).** Order-of-magnitude estimate: USD 8 K–15 K/mo for infra (EKS + r6g.xlarge primary + r6g.large replica + Redis cluster + multi-region + Sentry + observability sinks). LLM cost dominates the total bill (USD 40 K–80 K/mo at projected token rates) and is governed by the cost-aware router (§13) + the prompt cache (§13.5).

The roadmap doc has the time-boxed sequencing.

---

## 27. Pending Production-Scale Work

These are explicit blockers for the 10 M MAU target — pulled directly from [`NYV-AGENT-SUGGESTED-FOLLOWUPS.md`](../pending_implementation_docs/NYV-AGENT-SUGGESTED-FOLLOWUPS.md). One line per item.

| Ref | Title | Why it's a 10 M blocker |
|---|---|---|
| **#19** | Flip the firewall from observation to enforcement | A WAF in count-only mode is a dashboard, not a defence. At 10 M MAU the abuse traffic is not survivable without an enforcing edge. |
| **#20** | Send firewall alerts to a real inbox or chat channel | Without an alarm destination, a sudden burst is invisible until someone opens the console. |
| **#41** | Drop legacy plaintext columns once encrypted backfill is verified | While the COALESCE-fallback exists, a misconfigured key still leaks plaintext on read. Must close before SOC 2 audit. |
| **#42** | Provision a non-superuser app role so RLS actually filters in production | The single biggest compliance unblock. Until the app pool is non-superuser, RLS is a no-op even when `NYV_RLS_ENFORCE=true`. |
| **#35** | Add load tests proving each tier's concurrency limits hold | Tier caps are config; no test enforces them under load. Required to publish capacity claims. |
| **#56** | Run audit-chain test against real Redis to prove pod coordination end-to-end | The mocked test does not catch ordering bugs the real lock would. Required before EKS multi-pod fleet. |
| **#73** | E2E test: deliberately-unsafe LLM response is blocked at the HTTP layer in production | Today only the verdict is asserted; the gateway HTTP path is not. |
| **#78** | Make cache clears reach every running server, not just one | Today an admin clear only invalidates the receiving pod. Cluster-mode Redis pub/sub fanout closes this. |
| **#79** | Turn the shared prompt cache on in staging and production | Behind a flag today (`LMCACHE_SHARED_BACKEND=redis`). Required before EKS multi-pod fleet — otherwise pods don't share. |
| **#81** | Prove the shared cache works end-to-end against a real Redis | Companion to #79; current test stubs the backend. |
| **#48** | Fix broken compliance forms that crash with raw database errors | Five DPDPA endpoints currently 500 with leaked Postgres parser errors. Highest-visibility production bug. |
| **#52 / #57 / #59** | Make the SDK installable + verify quickstart works for partners | If a partner can't `npm install`, the platform doesn't have a market regardless of how big it scales. |
| **#53 / #54** | Backend errors → Sentry; tag spans with tenant | At 10 M MAU you cannot debug a single enterprise customer's failure without `tenant` on every span. |
| **#62 / #63** | Regression tests that every streaming event carries `orchestrationId`; cross-leak coverage on non-AG-UI streams | Trace-tree integrity is what makes 10 M-scale debugging tractable. |

For the full backlog (P0–P3 across security, observability, SDK, caching, streaming, ops, testing, routing) read [`NYV-AGENT-SUGGESTED-FOLLOWUPS.md`](../pending_implementation_docs/NYV-AGENT-SUGGESTED-FOLLOWUPS.md). The list above is the subset that gates 10 M MAU specifically.

---

## 28. Glossary & References

### 28.1 Terms and acronyms

| Term | Meaning |
|---|---|
| `/api/nv/` | The single canonical API prefix for the Nyayavigya gateway. Anything else is a brand-front route. |
| **A2A** | Agent-to-agent protocol. §6. |
| **ACM** | AWS Certificate Manager. The TLS cert for `nyayasiddhi.online` lives here. |
| **AG-UI** | Streaming protocol from gateway to UI. Six lifecycle events per orchestration (§14.1). |
| **ALB** | AWS Application Load Balancer. The TLS terminator and HTTP→HTTPS redirector in front of the EC2 host. |
| **BMAD** | Multi-agent deployment protocol (shared-context coordination). §6. |
| **BNS / BNSS / BSA** | Bharatiya Nyaya Sanhita / Bharatiya Nagarik Suraksha Sanhita / Bharatiya Sakshya Adhiniyam. The post-2023 Indian criminal code, criminal procedure code, and evidence law. They replace the older IPC, CrPC, and Indian Evidence Act. |
| **BullMQ** | The Node.js job queue library; runs on Redis when `NYV_REDIS_TCP_URL` is set, no-ops gracefully when not. |
| **Caddy** | The per-host reverse proxy in the docker-compose stack. Terminates HTTP from the ALB and Host-routes to gateway / console / partner containers. |
| **CoT** | Chain-of-Thought reasoning framework. §16. |
| **DAG** | Directed Acyclic Graph. The shape of a multi-agent orchestration after `decompose`. |
| **DPDPA / DPDP 2023** | India's Digital Personal Data Protection Act, 2023. |
| **drizzle-kit** | The migration / ORM tooling. Source of `drizzle/*.sql` migrations. |
| **EBS / gp3** | Elastic Block Store, gp3 volume type used by RDS. |
| **EKS** | AWS Elastic Kubernetes Service. The 10 M MAU target compute. |
| **ElastiCache** | AWS managed Redis. Cache + lock + queue layer. |
| **GUC** | Postgres "Grand Unified Configuration" — session-scoped settings like `app.current_org_id`. |
| **HITL** | Human-in-the-loop. A pattern that hard-stops before delivery awaiting reviewer sign-off. |
| **IAM** | AWS Identity and Access Management. Per-partner deploy roles, EC2 instance role, etc. |
| **Jurisdiction** | The legal system whose rules apply. Six in scope: `IN`, `UK`, `US`, `GCC`, `SG`, `EU` plus a `DEFAULT` registry. |
| **LM cache** | The per-agent prompt cache. `src/services/lm-cache-service.ts`. |
| **MAU** | Monthly active users. |
| **NYV** | Platform code. Used as the prefix on env vars (`NYV_*`), Sentry release tags, Secrets Manager paths. |
| **`nyv_live_sk_` / `nyv_test_sk_`** | The two API key prefixes. Live / test split is enforced at the SDK key issuer. |
| **opossum** | The circuit-breaker library wrapping every outbound surface. |
| **Orchestration** | The act of choosing which agents to run, in what order, on a given task. The Queen does this. |
| **Pattern (P1–P22)** | One of 22 named ways to compose agents. §5, §4.3. |
| **PII vault** | The Redis-backed short-lived store for sensitive tokens. §23.2. |
| **PITR** | Point-in-time recovery. RDS supports 7 d today, 35 d at 10 M MAU target. |
| **RAG** | Retrieval-augmented generation. §17. |
| **Replay** | `GET /api/nv/agui/stream/:orchestrationId/replay`. Re-emits events from `nv_orchestration_events`. |
| **RLS** | Row-Level Security. Migration `0004` installs the policies; enforcement gated on `NYV_RLS_ENFORCE`. §11.3. |
| **ROMA L5** | Role / Outcome / Method / Audit Level 5 — our internal prompt specification. 22 sections, ~20 KB per prompt. |
| **Sarvam** | The Indian-language speech provider for STT/TTS. §13.6. |
| **SDK** | The published client libraries. v6 GA; v5 security-patches-only. §21. |
| **Secrets Manager** | AWS Secrets Manager. All credentials live here under `nyayavigya/<env>/<surface>/<name>`. |
| **Span** | A unit of trace timing. `queen.orchestrate`, `queen.rag`, `queen.decompose`, `queen.execute`, `queen.synthesis`, `queen.agent`, `queen.memory`. |
| **Tenant** | An organisation that uses Nyayavigya. Identified by `orgId`. |
| **Tier** | The commercial plan: `lite`, `mitra`, `enterprise`, `sovereign`, `white-label`. Determines per-tier policy. |
| **ToT** | Tree-of-Thought reasoning framework. Partially scaffolded today (§16). |
| **WAF** | AWS Web Application Firewall. In count-only mode pending follow-up #19. |

### 28.2 Reference documents (drilled into by this doc)

| Doc | Drilled into in section(s) |
|---|---|
| [`NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md`](./NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md) | All — sibling business note |
| [`NYV-ARCHITECTURE-v6.md`](./NYV-ARCHITECTURE-v6.md) | §10, §11, §13 |
| [`NYV-ARCHITECTURE-312.md`](./architecture/NYV-ARCHITECTURE-312.md) | §1, §10 |
| [`AWS-MANAGED-DATASTORES-2026-04-24.md`](./AWS-MANAGED-DATASTORES-2026-04-24.md) | §10, §11, §12, §26 |
| [`AWS-DNS-HANDOFF-2026-04-24.md`](./AWS-DNS-HANDOFF-2026-04-24.md) | §10, §26 |
| [`NYV-DNS-AND-EDGE.md`](./NYV-DNS-AND-EDGE.md) | §10, §25 |
| [`NYV-RDS-MIGRATION-RUNBOOK.md`](./NYV-RDS-MIGRATION-RUNBOOK.md) | §11, §25 |
| [`NYV-DR-DRILL-RESULTS.md`](./NYV-DR-DRILL-RESULTS.md) | §10, §25, §26 |
| [`NYV-REDIS-MEM0-SETUP.md`](./NYV-REDIS-MEM0-SETUP.md) | §12, §18 |
| [`orchestration-map.md`](./orchestration-map.md) | §4, §5, §6, §13 |
| [`NYV-OBSERVABILITY.md`](./NYV-OBSERVABILITY.md) | §13, §24 |
| [`NYV-COMPLIANCE-ATTESTATION.md`](./NYV-COMPLIANCE-ATTESTATION.md) | §11, §23 |
| [`NYV-IAM-GAPS.md`](../pending_implementation_docs/NYV-IAM-GAPS.md) | §11, §23 |
| [`NYV-INCIDENT-RUNBOOK.md`](./NYV-INCIDENT-RUNBOOK.md) | §25 |
| [`NYV-SECRETS-MANAGEMENT.md`](./NYV-SECRETS-MANAGEMENT.md) | §23, §25 |
| [`NYV-SECRETS-CLEANUP.md`](./NYV-SECRETS-CLEANUP.md) | §25 |
| [`NYV-PARTNER-DEPLOY-GUIDE.md`](./NYV-PARTNER-DEPLOY-GUIDE.md) | §3, §25 |
| [`NYV-CICD-REPLIT.md`](./NYV-CICD-REPLIT.md) | §10, §25 |
| [`NYV-PLATFORM-GOVERNANCE.md`](./NYV-PLATFORM-GOVERNANCE.md) | §3, §19 |
| [`NYV-SDK-v6-API-REFERENCE.md`](./NYV-SDK-v6-API-REFERENCE.md) | §21, §22 |
| [`NYV-SDK-v6-INTEGRATION-GUIDE.md`](./NYV-SDK-v6-INTEGRATION-GUIDE.md) | §21 |
| [`NYV-MOBILE-INTEGRATION-GUIDE.md`](./NYV-MOBILE-INTEGRATION-GUIDE.md) | §21 |
| [`NYV-MOBILE-STORE-SUBMISSION-CHECKLIST.md`](./NYV-MOBILE-STORE-SUBMISSION-CHECKLIST.md) | §21 |
| [`NYV-SDK-PRODUCTION-AUDIT-REPORT-Apr2026.md`](./NYV-SDK-PRODUCTION-AUDIT-REPORT-Apr2026.md) | §21 |
| [`NYAYAMITRA-SDK-FINAL.md`](./NYAYAMITRA-SDK-FINAL.md) | §21 |
| [`agents/agents-product.md`](./agents/agents-product.md) | §4, §5 |
| [`agents/NYV-AGENT-CATALOG.md`](./agents/NYV-AGENT-CATALOG.md) | §4, §5 |
| [`api/NYV-API-REFERENCE.md`](./api/NYV-API-REFERENCE.md) | §22 (auto-generated reference; not duplicated here) |
| [`conventions/NYV-NAMING-CONVENTIONS.md`](./conventions/NYV-NAMING-CONVENTIONS.md) | §1, §11 |
| [`setup/NYV-QUICKSTART.md`](./setup/NYV-QUICKSTART.md) | §21 |
| [`uat/UAT-REPORT-v3.1.2.md`](./uat/UAT-REPORT-v3.1.2.md) | §27 |
| [`NYV-PRODUCTION-READINESS-CHECKLIST.md`](../pending_implementation_docs/NYV-PRODUCTION-READINESS-CHECKLIST.md) | §27 |
| [`NYV-ROADMAP-Q2-Q4-2026.md`](../pending_implementation_docs/NYV-ROADMAP-Q2-Q4-2026.md) | §26 |
| [`NYV-AGENT-SUGGESTED-FOLLOWUPS.md`](../pending_implementation_docs/NYV-AGENT-SUGGESTED-FOLLOWUPS.md) | §27 |
| [`uat/NYV-UAT-v3.2-COMPREHENSIVE.md`](../pending_implementation_docs/uat/NYV-UAT-v3.2-COMPREHENSIVE.md) | §27 |

### 28.3 Code roots (drilled into by this doc)

| Path | Sections |
|---|---|
| `src/orchestration/nv-queen-orchestrator.ts` | §5, §13, §14, §15 |
| `src/orchestration/orchestration-policy.ts` | §5, §15 |
| `src/orchestration/orchestration-middleware.ts` | §5, §14, §15 |
| `src/orchestration/capability-manifest.ts` | §4, §5, §6 |
| `src/services/real-llm-service.ts` | §13, §15 |
| `src/services/circuit-breaker.ts` | §13 |
| `src/services/lm-cache-service.ts` | §13, §15, §19 |
| `src/services/lm-cache-backend.ts` | §13 |
| `src/services/hierarchical-task` `‑allocator.ts` | §5, §13 |
| `src/services/agent-performance-tracker.ts` | §5, §13 |
| `src/services/cost-aware-router.ts` | §2, §13 |
| `src/services/rag-service.ts` | §17 |
| `src/services/memory/nv-5tier-memory-service.ts` | §11, §18 |
| `src/services/audit-chain-lock.ts` | §12, §23 |
| `src/services/field-encryption-service.ts` | §11, §23 |
| `src/services/hallucination-checker.ts` | §2, §16 |
| `src/services/hitl-workflow-service.ts` | §5 |
| `src/services/eu-ai-act-compliance-service.ts` | §23 |
| `src/services/consent-management-service.ts` | §20, §23 |
| `src/services/voice/` (Sarvam adapter) | §13, §22 |
| `src/services/nv-jurisdiction-prompt-resolver.ts` | §1, §15 |
| `src/utils/jurisdiction-resolver.ts` | §5, §14 |
| `src/utils/nyv-tracer.ts` | §24 |
| `src/utils/env-validator.ts` | §12, §23 |
| `src/middleware/tenantIsolation.ts` | §19, §22 |
| `src/middleware/nv-org-rls-middleware.ts` | §11, §19, §22 |
| `src/middleware/nv-sdk-tracking-middleware.ts` | §22, §23 |
| `src/middleware/nv-rate-limit-middleware.ts` | §12, §22 |
| `src/middleware/nyv-request-metrics.ts` | §24 |
| `src/startup/nv-pii-vault-cleanup.ts` | §12, §23 |
| `src/startup/nv-jurisdiction-prompt-validator.ts` | §1, §15 |
| `src/startup/nv-environment-validator.ts` | §10, §23 |
| `src/startup/nv-migration-safety-runner.ts` | §11 |
| `src/routes/nv-agui-stream-routes.ts` | §6, §14, §22 |
| `src/routes/nv-routing-weights-routes.ts` | §5, §13, §20 |
| `src/routes/nv-roma-l5-admin-routes.ts` | §20 |
| `src/routes/nv-health-full-routes.ts` | §10, §24 |
| `src/routes/nv-sdk-console-routes.ts` | §20, §21 |
| `src/routes/nv-sdk-keylife-routes.ts` | §23 |
| `src/routes/nv-consent-routes.ts` | §20, §23 |
| `src/routes/nv-compliance-routes.ts` | §20, §23 |
| `shared/schema.ts` | §11 |
| `shared/{nyayamitra,nyayasiddhi-academy,nyayasiddhi-institutional,nyayasiddhi-ministry}-schema.ts` | §3, §11 |
| `drizzle/0004_enable_rls_for_tenant_tables.sql` | §11, §23 |
| `scripts/nv-migrate.ts` | §11 |
| `scripts/nv-seed-all.ts` | §11 |
| `scripts/nv-provision-ecosystem.ts` | §3, §11 |
| `scripts/migrate-to-managed-datastores.sh` | §10 |
| `scripts/deploy-replit-direct.sh` | §10, §25 |
| `scripts/nv-cache-clear.ts` | §20 |
| `scripts/nv-doc-reorganize.ts` | doc maintenance |
| `infra/terraform/envs/{dev-edge,prod,staging}/` | §10 |
| `infra/terraform/modules/{ec2_host,iam_partner,alb,rds,elasticache,acm,cloudwatch}/` | §10, §23, §24 |
| `tests/unit/security/{pii-vault,rls,field-encryption,hash-chain}.test.ts` | §11, §23 |
| `tests/streaming/agui-no-cross-leak.test.ts` | §14, §19 |
| `tests/orchestration/{smoke,allocator-live-signals}.test.ts` | §5, §13 |
| `tests/unit/ai/lm-cache-shared-backend.test.ts` | §13 |

---

*This document is the canonical engineering reference for Nyayavigya v3.1.2 as of April 25, 2026. Where it disagrees with an older doc, this one wins; the older doc should be moved to `superseded/` in a follow-up pass and a `superseded_by:` note added to its YAML header. The business companion to this note is [`NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md`](./NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md). For the time-boxed roadmap, read [`NYV-ROADMAP-Q2-Q4-2026.md`](../pending_implementation_docs/NYV-ROADMAP-Q2-Q4-2026.md). For the prioritised backlog of follow-ups, read [`NYV-AGENT-SUGGESTED-FOLLOWUPS.md`](../pending_implementation_docs/NYV-AGENT-SUGGESTED-FOLLOWUPS.md).*
