---
status: audit
version: 5.0.1
date: 2026-05-07
author: agent
supersedes:
  - docs/v5.0.0/NYV-ORCHESTRATION-AUDIT-2026-05-07.md (deleted; folded into this doc)
scope: |
  Comprehensive cross-check of the running platform against the canonical
  architecture spec, the master product note (v7.1 FROZEN), and the user's
  guardrail directive of 2026-05-07. Covers: orchestration conformance,
  duplicate / legacy code, dark services, security violations, doc bloat,
  and a proposed 5-phase remediation plan that holds the line on the new
  guardrail "no request ever bypasses the safety ring."
references:
  - nyayavigya-platform-312/Full-Final-Nyayavigya-ProductNote-312-April2026.md (v7.1 FROZEN, 3641 lines)
  - documents/working/{PRODUCT,TECHNICAL,LLM-STACK}.md
  - nyayavigya-platform-312/docs/v3.1.2/pending_implementation_docs/NYV-ARCHITECTURE-AND-USER-FLOWS-v3.1.2.md
  - replit.md gotchas (provider lockdown, EC2 deploy, Redis cutover)
---

# Nyayavigya Platform Deep Audit — Architecture, Code, and Docs

> **The guardrail.** Henceforth every AI/SDK/API request MUST traverse:
> tenant isolation → guardrails → Queen → agent allocation (1042 agents ×
> 6 jurisdictions × 22 patterns × 107 swarm topologies) → 22-section
> Parlant prompt → 5-tier memory + multi-tier RAG + GraphRAG → CoT/ReAct →
> NV-ROUTER-001 (cost-optimal LLM) → response engineering → halluc + cite
> + safety + HITL → audit hash chain → streaming. **No direct LLM calls.
> No bypass paths. Ever.** This audit measures every gap against that line.

---

## 0. Executive verdict

| Dimension | State | Notes |
|---|---|---|
| Queen orchestration on JWT path (`/api/nv/orchestration/orchestrate`) | ✅ Canonical | Multi-agent → Queen; single-agent → callNyayavigya. Reference impl. |
| Mandated services wired (RAG, memory, CoT, safety, hallucination, citation, audit) | ✅ Mostly wired | 25 of 28 architecture-named services are reachable from request hot-path |
| LLM router unification (NV-ROUTER-001 as "only path") | ❌ Violated | 12 confirmed bypass sites; `realLLMService` is the de-facto router and does NOT delegate to `intelligent-router/orchestrateLLM` |
| Document AI surface (parse / intelligence / summarize / compare / compliance) | ❌ Bypassed | 6 raw `realLLMService` calls in `sdk-document-pipeline-service.ts` — no Queen, no PII vault, no halluc, no cite, no audit |
| Code-level duplicates | ⚠️ 9 clusters | Queen facade, RAG legacy split, two agent registries, three routers, two memory systems, gateway-routes pair, etc. |
| Dark code (built but not wired) | 3 services | DAG orchestration, Federated Privacy, PQC |
| Doc bloat | ⚠️ ~120 active markdown across 3 trees (`docs/`, `docstotrack/`, `documents/working/`) | Target: collapse to 10 canonical |
| Numeric drift docs vs reality | ⚠️ Several | "1042 agents" vs ~148 base + jurisdiction multiplier; "17 providers" vs 6 active; "55 models" vs 93 in catalog |
| Banned-pattern violations | 6 | `Math.random()` found in 6 files (must use `secureRandom`) |
| Live EC2 SDK auth | ❌ Drifted | Replit `NYV_SDK_KEY_*` secrets don't match EC2 RDS keys; live SDK probes blocked |

---

## 1. Orchestration conformance — confirmed bypass sites

### 1.1 The canonical safety ring (reference)

`src/services/nv-client.ts → callNyayavigya()` does, in order:
1. `resolveAgent()` / `resolveAgentByCapability()` — agent selection
2. `promptEnhancementPipeline.enhance()` — 22-section Parlant prompt
3. `realLLMService.executeRequest()` — LLM call (currently NOT routed through NV-ROUTER-001 — see §1.4)
4. `responseEngineeringPipeline.process()` — format, citation, structure
5. `redactPII()` + `complianceCheck()` — DPDP / GDPR
6. `nvHallucinationDetector.checkOutput()` — hallucination gate
7. `nvCitationVerifier` — citation grounding
8. `nvHITLService` trigger — if confidence below threshold
9. `nvUsageService.logUsage()` + `emitOrchestrationAudit()` — audit + billing
10. CoT branch via `chainOfThoughtService.executeReasoning()` for pro/elite/government tiers

`/api/nv/orchestration/orchestrate` (JWT) properly routes here. Multi-agent modes (swarm/dag/hierarchical) hit `queenOrchestrator.orchestrate()` first.

### 1.2 The 12 confirmed bypass sites

| # | File | Severity | What it bypasses | Used by |
|---|---|---|---|---|
| B1 | `src/services/sdk/sdk-document-pipeline-service.ts` (6× `realLLMService.executeRequest`) | 🔴 CRITICAL | Queen, agent select, PII vault, prompt enh, response eng, halluc, cite, HITL, audit | Every `/api/nv/sdk/docs-pipeline/*` endpoint (parse, intelligence, embeddings, compare, summarize, compliance-check) |
| B2 | `src/services/sdk/sdk-workflow-protocol-service.ts` | 🔴 CRITICAL | Queen + safety ring | `/api/nv/sdk/workflows/*` |
| B3 | `src/services/sdk/sdk-multimodal-voice-service.ts` | 🟠 HIGH | Response eng + halluc | `/api/nv/sdk/multimodal/*` |
| B4 | `src/services/openai-document-intelligence-service.ts` | 🟠 HIGH | Provider abstraction; goes straight to OpenAI | doc analysis routes |
| B5 | `src/services/automateai/automateai-service.ts` | 🟠 HIGH | Full safety ring | AutomateAI features |
| B6 | `src/services/identity-extraction-service.ts` | 🟠 HIGH | Full safety ring; PII risk | `/api/nv/identity/*` |
| B7 | `src/services/case-management-service.ts` | 🟠 HIGH | Full safety ring | case mgmt routes |
| B8 | `src/services/llm-providers.ts` | 🟡 MED | Direct provider, intended as low-level — but should now route via NV-ROUTER-001 | internal |
| B9 | `src/routes/nv-sdk-gateway-routes.ts` (own `executeWithOrchestration`) | 🟠 HIGH | Halluc + cite + HITL (does run prompt enh + response eng) | `/api/nv/gateway/{agents,research}/*` (5 endpoints) |
| B10 | `src/routes/nv-gateway-routes.ts` (legacy gateway) | 🟡 MED | Most of the safety ring | legacy `/api/nv/v1/*` paths |
| B11 | `src/routes/nv-core-routes.ts` | 🟡 MED | Specific endpoints — needs per-route inspection | `/api/nv/*` core |
| B12 | `src/nv-sdk-main-index.ts` (SDK package main) | 🟡 MED | The npm SDK ships a direct LLM call path | external SDK consumers |

**Explicitly NOT bypasses (initially flagged but verified clean):**

| File | Verdict | Reason |
|---|---|---|
| `src/services/chain-of-thought-service.ts` | ✅ Wired correctly | Imported by `nv-client.ts` line 25; invoked from line 856 inside `callNyayavigya`. Its internal `realLLMService` call (line 338) is an inner reasoning step within the safety ring, not a bypass. |
| `src/services/rag/adaptive-rag-service.ts` | ✅ Wired | RAG internally uses LLM for query rewriting; this is normal CRAG behavior. |
| `src/services/rag/nyv-graphrag-legal-service.ts` | ✅ Wired | Same — internal LLM use for graph synthesis. |
| `src/utils/ai-orchestration-validator.ts` | ✅ Test-only | Validator probe, not a runtime path. |

### 1.3 Confirmed live services (the wins)

Per the dark-code subagent's exhaustive walk, these architecture-mandated services ARE invoked from the request hot-path today:

Queen Orchestrator, NV-ROUTER-001 (export only — see §1.4), Adaptive RAG, Corrective RAG, GraphRAG, LightRAG, 5-tier Memory, Graph Memory, Safety Pipeline, Verbalized Sampling, Skills System, Smart Thinking Engine, Chain-of-Thought, Legal Reranker, GotOCR Adapter, Agent Testing Framework, LLM-as-Judge, EU AI Act Service, Cost Manager, Swarm Topology Service, 22-pattern routes.

That's 21 of the 28 named services. Better than I feared.

### 1.4 NV-ROUTER-001 paradox — built, exported, hardly called

`src/services/intelligent-router/llm-orchestrator.ts:539` exports `orchestrateLLM()`. The 28-model scoring + AgentZero terminal fallback + 8-dimension routing is fully implemented.

**But only 3 callers use it**: `nv-llm-gateway.ts`, `nv-legal-chat-routes.ts`, `nv-router-stats-routes.ts`. Meanwhile `realLLMService.executeRequest` is called from 50+ sites and does its own provider rotation **without** the intelligent router's scoring or AgentZero fallback.

The architecture doc says verbatim: *"NV-ROUTER-001 is the only path through which any LLM call leaves the platform."* Today, it's the path for ~3% of LLM traffic.

### 1.5 Two agent-registry sources of truth

`src/services/agent-registry-service.ts` (operational, used by routes) vs `src/core/agent-registry.ts` (class-based, used by Queen internally) — the same agent ID can resolve differently depending on which registry the caller hits. This explains drift between Queen's agent-pick and `nv-client`'s agent-pick.

### 1.6 Two RAG implementations

`src/services/rag-service.ts` (legacy functional, used by Queen) vs `src/services/rag/rag-service.ts` (class-based, used by `nv-client`). The Queen and the safety ring read different RAG.

### 1.7 Two memory systems

`src/services/nv-memory-manager.ts` (older "main") vs `src/services/memory/nv-5tier-memory-service.ts` (new spec-mandated). Both are read; primary memory still uses the old path per architecture doc §10.

---

## 2. Code-level duplicates / legacy clusters

| # | Cluster | Files | Recommendation |
|---|---|---|---|
| D1 | Queen orchestrator facade | `src/orchestration/queen-orchestrator.ts` (re-exports) → `src/orchestration/nv-queen-orchestrator.ts` (canonical) | ARCHIVE facade; rewrite imports |
| D2 | SDK gateway middleware facade | `src/middleware/sdk-gateway.ts` → `src/middleware/nv-sdk-gateway.ts` | ARCHIVE facade |
| D3 | Prompt enhancement facade | `src/orchestration/prompt-enhancement-pipeline.ts` → `src/orchestration/nv-prompt-enhancement-pipeline.ts` | ARCHIVE facade |
| D4 | RAG split | `src/services/rag-service.ts` (legacy, Queen reads this) vs `src/services/rag/rag-service.ts` (canonical) | UNIFY on canonical; refactor Queen |
| D5 | Agent registry split | `src/services/agent-registry-service.ts` vs `src/core/agent-registry.ts` | UNIFY; promote one as service-of-record |
| D6 | LLM router triple | `services/real-llm-service.ts` + `services/intelligent-router/intelligent-router.ts` + `services/nv-language-router-service.ts` | Make `real-llm-service.executeRequest` internally delegate to `intelligent-router.orchestrateLLM`; keep `nv-language-router-service` as language-routing layer above |
| D7 | Memory split | `services/nv-memory-manager.ts` vs `services/memory/nv-5tier-memory-service.ts` | UNIFY on 5-tier; deprecate old |
| D8 | Gateway routes pair | `routes/nv-gateway-routes.ts` (legacy) vs `routes/nv-sdk-gateway-routes.ts` (current) | Inventory legacy endpoints; migrate live ones to current; ARCHIVE legacy |
| D9 | 11 same-basename file clashes | `vector-database.ts`, `document-processor.ts`, `context-engineering.ts`, `agent-coordination.ts`, `sarvam-translation-service.ts`, `llm-routing-engine.ts`, `token-cost-prediction-service.ts`, `unified-jurisdiction-sync.ts`, `types.ts` (×2 each in different dirs) | Per-cluster review; pick canonical, delete or rename other |

**`server/` directory**: 7 files, recent (May 5-6), narrow scope (Replit integration sync + one specialized agent guardrail). NOT a duplicate of `src/` — keep but document its scope. The single `server/services/legal-agents/prompt-guardrail-service.ts` is imported by `src/routes/nv-sdk-gateway-routes.ts:26` so it IS live and not a dup.

---

## 3. Dark code — built and exported, never wired

Per dark-code subagent (verified):

| Service | Path | Why it matters |
|---|---|---|
| DAG Orchestration | `src/services/dag-orchestration-service.ts` | Architecture doc §10 calls this out as wire-in target — replace ad-hoc `Promise.all` decomposition. Currently unused. |
| Federated Privacy | `src/services/security/nv-federated-privacy-service.ts` | Enterprise tier feature flag claimed in product note; not callable. |
| PQC (Post-Quantum Cryptography) | `src/services/security/nv-pqc-service.ts` | Kyber/Dilithium/FALCON scaffolding mentioned in product note v7.1; service exists but no caller. |

Plus these support modules also unwired (lower-priority): `nv-statute-seeding-service.ts`, `email-automation-service.ts`, `replicate-provider.ts`, `nv-azentzero-service.ts` (typo: `azentzero` vs `agentzero` — possible cause of why AgentZero terminal fallback isn't triggering), `e-filing-service.ts`, `nv-runtime-agent-factory.ts`, `nv-inter-service-auth.ts`, `nv-doc-access-guard.ts` (this last one is concerning — Session 7 added it, but if it's not imported by any route the share-grant enforcement may be dead code; needs verification).

---

## 4. Security & banned-pattern violations

`Math.random()` is BANNED per master product note §6 (must use `secureRandom`). Found in 6 files:

```
src/middleware/nv-redis-platform-rate-limiter.ts
src/utils/nv-secure-random.ts            (likely the implementation; check)
src/services/circuit-breaker.ts
src/services/hierarchical-task-allocator.ts
src/services/agent-orchestration.ts
src/routes/nv-document-orchestrator-routes.ts
```

Each occurrence needs review: jitter for backoff is acceptable; agent selection randomness is not.

---

## 5. Numeric & claim drift — docs vs reality

| Claim in master product note (v7.1 FROZEN) | Reality | Severity |
|---|---|---|
| 1,042 agents (149/jur × 6 + 148 DEFAULT); 1,046 live on dev-edge | SDK canonical doc says 148 base agents; live `/api/nv/gateway/agents` returns 0 (auth blocked); jurisdiction-registry JSONs claim 1,043 | 🟡 needs ground-truth count |
| 17 providers / 5 priority + AgentZero / 9 disabled | replit.md provider-lockdown gotcha: 6 active (anthropic, openai, google, openrouter, sarvam, bedrock); 17 platform-supported but not routable; 23 in `nv_llm_providers` DB row | 🟠 doc out of sync |
| 55 built-in models | 93 models in `nv_model_catalog` after Phase-1 seed | 🟡 doc behind |
| 502 MCP tools / 102 live | not yet verified by this audit | 🟡 verify |
| 305 statutes seeded (target ≥500) | matches replit.md follow-up | ✅ aligned |
| 113 frontend pages, 74 route files, 210+ services | 83 route files in `src/routes/`; 272 service files in `src/services/`; pages count not verified | 🟡 close-ish |
| API keys must be `nyv_*` prefix (NEVER `nv_*`) | env vars are `NYV_SDK_KEY_*` (uppercase, OK); actual key string format needs DB inspection | 🟡 verify |
| "All LLM calls go through router" | Violated — see §1.2 | 🔴 false today |
| AgentZero terminal never-fail | Built but only reachable via NV-ROUTER-001 path (which is called in 3% of traffic) | 🔴 effectively dark |

---

## 6. Document bloat — collapse plan to 10 canonical

Subagent counted ~120 active markdown across 3 doc trees. Target: 10 canonical files per user directive.

### 6.1 Target structure (canonical paths after consolidation)

| # | Canonical doc | Proposed location | Source files to merge | Move-rest-to |
|---|---|---|---|---|
| 1 | Product | `docs/canonical/01-PRODUCT.md` | `Full-Final-Nyayavigya-ProductNote-312-April2026.md` (master), `docstotrack/A-active/01-product-and-status/NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md`, `documents/working/PRODUCT.md`, `documents/working/PRODUCT-NOTE-v3.1.2.md` | `archive/superseded/product/` |
| 2 | Technical | `docs/canonical/02-TECHNICAL.md` | `docstotrack/A-active/01-product-and-status/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md`, `documents/working/TECHNICAL.md`, `documents/working/TECHNICAL-NOTE-v3.1.2.md` | `archive/superseded/technical/` |
| 3 | Architecture + Algorithms + Flows | `docs/canonical/03-ARCHITECTURE.md` | `docstotrack/A-active/04-architecture-and-tech/NYV-ARCHITECTURE-CANONICAL.md`, `docs/v3.1.2/pending_implementation_docs/NYV-ARCHITECTURE-AND-USER-FLOWS-v3.1.2.md`, any `MICROSERVICES-ARCHITECTURE.md`, `NYV-USER-FLOWS.md` | `archive/superseded/architecture/` |
| 4 | Agents + Orchestration | `docs/canonical/04-AGENTS-AND-ORCHESTRATION.md` | `docstotrack/A-active/11-agents-and-prompts/NYV-AGENT-CATALOG.md`, `agents/agents-product.md`, `AGENTS.md`, swarm-topology docs | `archive/superseded/agents/` |
| 5 | LLM + Algorithms | `docs/canonical/05-LLM-STACK.md` | `documents/working/LLM-STACK.md`, `orchestrate-services-*.md`, `NYV-DATA-RAG-MEMORY.md`, router-stats docs | `archive/superseded/llm/` |
| 6 | AWS Deployment | `docs/canonical/06-AWS-DEPLOYMENT.md` | `docstotrack/A-active/06-aws-ops-and-deployment/NYV-OPS-RUNBOOK.md`, `NYV-AWS-ONE-CLICK-DEPLOY.md`, `ONE-CLICK-DEPLOY.md`, `AWS-DNS-HANDOFF-2026-04-24.md`, `AWS-MANAGED-DATASTORES-2026-04-24.md`, `ELASTICACHE-CUTOVER-2026-05-07.md` | `archive/superseded/deployment/` |
| 7 | Security + Audit + Governance + Compliance | `docs/canonical/07-SECURITY-COMPLIANCE.md` | `docstotrack/A-active/05-audit-and-security/NYV-PLATFORM-GOVERNANCE.md`, `NYV-COMPLIANCE-ATTESTATION.md`, `NYV-SECRETS-MANAGEMENT.md`, `NYV-IAM-GAPS.md` | `archive/superseded/security/` |
| 8 | UAT Test Cases | `docs/canonical/08-UAT.md` | `documents/working/UAT-TEST-PLAN.md`, `NYV-UAT-v3.2-COMPREHENSIVE.md`, `NYV-UAT-v3.2-SUMMARY.md`, `UAT-REPORT-v3.1.2.md`, `AI-TESTING-UAT.md`, `QA-REPORT-2026-05-05.md` | `archive/superseded/uat/` |
| 9 | SOP for AWS | `docs/canonical/09-SOP-AWS.md` | `documents/working/EC2-OPERATIONS-SOP.md`, `NYV-INCIDENT-RUNBOOK.md`, `NYV-DR-DRILL-RESULTS.md`, `NYV-RDS-MIGRATION-RUNBOOK.md`, `NYV-SECRETS-CLEANUP.md` | `archive/superseded/sop/` |
| 10 | Project Tracker + Changelog | `docs/canonical/10-TRACKER-AND-CHANGELOG.md` | `Project-Tracker.md` (root), `nyayavigya-platform-312/CHANGELOG.md`, `nyayavigya-platform-312/Project-Tracker.md`, `docstotrack/A-active/12-roadmap-and-tracking/Project-Tracker.md`, all session-doc trackers | `archive/superseded/tracker/` |

### 6.2 Archive disposition

- Everything currently under `docstotrack/C-reference/` → already archived in spirit; move to `archive/docstotrack-c-reference-snapshot-2026-05-07/`
- Everything under `archive/2026-05-01-pre-may3-cleanup/` → already archived; leave as-is
- All the per-session docs under `docstotrack/A-active/{02..10}/` → fold relevant content into the 10 canonical docs above; archive originals
- Root-level loose markdown (`Full-Final-...md`, `replit.md`, `README.md`, `CHANGELOG.md`) → keep `replit.md` (live agent guidance) and `README.md` (repo entry); fold the rest into the canonical 10

**Result**: 10 canonical docs + `replit.md` + `README.md` = 12 active markdowns at the project root + `docs/canonical/`. Everything else under `archive/`.

---

## 7. Proposed remediation — one ordered plan, 5 phases, gated by user approval

> Each phase produces a verifiable artifact and runs vitest + the relevant
> e2e probe before declaring done. No phase begins without explicit approval
> for the previous one. **No code change is made by this audit task itself.**

### Phase R1 — LLM Router unification (low risk, high leverage)

**Goal**: Make `realLLMService.executeRequest()` internally delegate to `intelligent-router/orchestrateLLM()`. Behavior-preserving facade. Every caller automatically gains: 28-model scoring, jurisdiction fit, AgentZero terminal fallback, health-aware cascading.

**Files**: `src/services/real-llm-service.ts` (1 file).
**Tests**: existing `intelligent-router/__tests__/intelligent-router.test.ts` + new probe asserting all callers reach `orchestrateLLM`.
**Risk**: low. **Estimated effort**: ~2-3 hours including tests.
**Closes**: §1.4 paradox, makes AgentZero terminal fallback live for the first time.

### Phase R2 — Universal SDK orchestration wrapper (medium risk, closes 8 of 12 bypasses)

**Goal**: Create `src/orchestration/nv-sdk-orchestration-wrapper.ts` exporting `executeWithFullSafetyRing(req, ctx)` that runs the canonical 10-step ring (§1.1). Refactor B1, B2, B3, B4, B5, B6, B7, B9 to use it.

**Files**: 1 new + 8 edits.
**Tests**:
- New `tests/integration/orchestration-conformance.test.ts` asserting every SDK endpoint response carries the `orchestration` envelope (`agentId`, `pattern`, `promptEnhanced`, `responseEngineered`, `piiRedacted`, `hallucinationCheck`, `citationsVerified`, `router.modelId`, `router.candidatesScored`, `auditId`).
- Run full vitest (currently 144/144).
- Run smoke 95/101.
**Risk**: medium (changes behavior of every SDK doc-AI endpoint).
**Estimated effort**: ~4-6 hours.
**Closes**: B1, B2, B3, B4, B5, B6, B7, B9. PII vault now enforced before doc-AI calls (G9).

### Phase R3 — Code de-duplication (medium risk, gates against future drift)

**Goal**: Resolve 9 duplicate clusters from §2.

- D1, D2, D3 (facades) — delete facades, rewrite imports (sed-able, low risk).
- D4 (RAG) — pick canonical, refactor Queen to use it.
- D5 (Agent registry) — promote one as `nv-agent-registry-service.ts` top-level service; delete other.
- D6 (LLM router) — handled by R1.
- D7 (Memory) — pick canonical (5-tier per spec); deprecate old; ensure all reads/writes go through it.
- D8 (Gateway routes) — inventory legacy endpoints, migrate live ones to `nv-sdk-gateway-routes.ts`, archive legacy file.
- D9 (basename clashes) — per-cluster review; rename or delete.

**Files**: ~25 files touched.
**Tests**: full vitest + smoke + ROMA L5 conformance.
**Risk**: medium-high (touches many import paths).
**Estimated effort**: ~6-8 hours.
**Closes**: §2.

### Phase R4 — Wire dark code + security violations (low risk, completeness)

**Goal**:
- Wire DAG orchestration into Queen as the multi-step decomposition engine (replacing ad-hoc `Promise.all`).
- Gate Federated Privacy + PQC behind `enterprise+` feature flag, expose admin endpoint to enable per tenant.
- Fix `Math.random()` violations: every call site reviewed; replace with `secureRandom` where security-sensitive (agent selection, ID generation), keep where it's pure jitter (backoff timing).
- Verify `nv-doc-access-guard.ts` is actually wired (Session 7 added it; subagent flagged it as dark — possible regression).
- Fix `nv-azentzero-service.ts` typo to `nv-agentzero-service.ts` (possibly why AgentZero never triggers).

**Files**: ~12 files touched.
**Tests**: vitest + new DAG integration test + share-grant enforcement re-test.
**Risk**: low.
**Estimated effort**: ~4 hours.
**Closes**: §3, §4.

### Phase R5 — Doc consolidation + observability + EC2 sync (low risk, hygiene)

**Goal**:
- Build `docs/canonical/{01..10}-*.md` per §6.1; move all originals to `archive/superseded/{category}/`.
- Update `replit.md` to point at the new 10-doc structure.
- Add `services.orchestration` block to `/api/nv/health/full` exposing Queen, Router, Pipeline, Registry status.
- Run `bash scripts/nv-db-sync-to-ec2.sh` to put live SDK keys on EC2 RDS.
- Re-run full E2E SDK probe matrix against prod with synced keys.

**Files**: 10 new canonical + ~120 moves; 1 health-route edit; sync script run.
**Tests**: smoke 95/101 again; live SDK probe matrix on EC2.
**Risk**: low (mostly file moves and additive code).
**Estimated effort**: ~3-4 hours.
**Closes**: §6, observability gap, EC2 SDK auth gap.

---

## 8. Acceptance criteria for the whole remediation (architect-grade)

After R1–R5 land, the platform must satisfy:

1. **No bypass possible.** A repo-wide ripgrep `realLLMService.executeRequest` (or any direct provider call) must return only: `nv-client.ts`, `nv-queen-orchestrator.ts`, `nv-sdk-orchestration-wrapper.ts`, `real-llm-service.ts` (the facade itself), and `intelligent-router/llm-orchestrator.ts`. Every other call site is a regression.

2. **Every AI response carries the orchestration envelope.** Spec'd in Phase R2 above.

3. **Single source of truth for every pillar.** One Queen, one agent registry, one RAG, one memory, one router, one gateway-routes file.

4. **10 canonical docs.** No duplicates. `replit.md` points at them.

5. **AgentZero terminal fallback proven.** A failure-injection test forces all 28 candidate models to fail; AgentZero responds with deterministic stub; test passes.

6. **Vitest 144/144 + new conformance suite.** Full ROMA L5 conformance + new orchestration-conformance suite green.

7. **Smoke 95/101 or better** (the 6 Upstash quota fails are environmental, not regressions).

8. **Live EC2 SDK probes 100% pass.** All 7 SDK platforms (NSP, NSPM, NYM, NSI, NSA, NSM, JRX) authenticate and produce valid orchestration envelopes against prod.

9. **`/api/nv/health/full` exposes orchestration subsystem.** Ops can see Queen + Router + Pipeline + Registry health at a glance.

10. **Architect re-review PASS.** No CRITICAL or HIGH findings.

---

## 9. What I am NOT doing in this audit

- No code changes. The user explicitly paused remediation pending review of this audit.
- No file moves or doc consolidation yet. Pending approval of §6 plan.
- No EC2 changes. EC2 is healthy; sync script is queued for R5.
- No new docs beyond this audit (per the user's "no doc bloat" guardrail).
- No claim of "DONE" anywhere — every Phase requires its own gated approval per the new guardrail.

---

## 10. Sources

- Master product note (3641 lines, v7.1 FROZEN): `nyayavigya-platform-312/Full-Final-Nyayavigya-ProductNote-312-April2026.md`
- Architecture + flows (WIP): `nyayavigya-platform-312/docs/v3.1.2/pending_implementation_docs/NYV-ARCHITECTURE-AND-USER-FLOWS-v3.1.2.md`
- Working drafts: `documents/working/{PRODUCT,TECHNICAL,LLM-STACK,UAT-TEST-PLAN}.md`
- Live agent gotchas: `nyayavigya-platform-312/replit.md`
- Code: `nyayavigya-platform-312/src/{services,orchestration,routes,middleware,core}/` (272 + 26 + 83 + 31 + 11 = 423 source files audited via ripgrep + 4 parallel subagents)
- Live EC2 health: `https://api.nyayasiddhi.online/api/nv/health/full` (200, 19/19 functional E2E)

---

# Appendix A — Point-by-point verification against user directive 2026-05-07

This appendix supersedes §1.2 of the main audit. The user directed me to
re-verify every flagged bypass with the lens "is this actually
Nyayavigya's responsibility, or downstream client / dead code?". Result:
**the real bypass list shrinks from 12 to 6.**

## A.1 Re-verified bypass table

| # | File | Phase-1 verdict | Re-verified verdict | Reason |
|---|---|---|---|---|
| B1 | `services/sdk/sdk-document-pipeline-service.ts` | CRITICAL | ✅ **CRITICAL — confirmed** | 6 raw LLM calls; doc-AI is core Nyayavigya |
| B2 | `services/sdk/sdk-workflow-protocol-service.ts` | CRITICAL | ✅ **CRITICAL — confirmed** | Workflow runtime, core platform |
| B3 | `services/sdk/sdk-multimodal-voice-service.ts` | HIGH | ✅ **HIGH — confirmed** | Voice Q&A, core platform |
| B4 | `services/openai-document-intelligence-service.ts` | HIGH | ❌ **NOT a separate bypass** | Only called by `nv-sdk-gateway-routes.ts` — closed by fixing B9 |
| B5 | `services/automateai/automateai-service.ts` | HIGH | ✅ **HIGH — confirmed** | "AutomateAI™ Visual Workflow Builder, 8 AI gates" — legit Nyayavigya feature |
| B6 | `services/identity-extraction-service.ts` | HIGH | ✅ **HIGH — confirmed; PII risk** | Identity = PII-critical, must go through P18 GUARDIAN |
| B7 | `services/case-management-service.ts` | HIGH | ❌ **NOT Nyayavigya — belongs in NSP downstream client** | Per user directive: NSP owns case management; gateway should not host it. Zero internal callers. **ACTION: archive from gateway** |
| B8 | `services/llm-providers.ts` | MED | ❌ **By-design low-level** | Provider abstraction layer; only `realLLMService` should call it. Add lint guardrail to enforce. |
| B9 | `routes/nv-sdk-gateway-routes.ts` | HIGH | ✅ **HIGH — confirmed partial** | Has own wrapper; missing halluc/cite/HITL/PII. Fixing this also closes B4. |
| B10 | `routes/nv-gateway-routes.ts` | MED | ⚠️ **DEPRECATE** | Confirmed line 159 raw realLLMService; endpoints (`/chat /summarize /explain /translate /agents/:id/execute /jobs /embed`) overlap `nv-sdk-gateway-routes.ts`. **ACTION: deprecate, migrate any unique endpoints** |
| B11 | `routes/nv-core-routes.ts` | MED | ❌ **NOT a bypass** | Re-grep: ZERO `realLLMService` / direct LLM calls. Phase-1 was wrong. |
| B12 | `nv-sdk-main-index.ts` | MED | ❌ **DEAD CODE** | v9-era SDK package entry exporting `RealLLMServiceV9`, `NyayavigyaUnifiedOrchestratorV9` etc. NOT in package.json main. ZERO importers. **ACTION: archive — orphan from v9 rewrite that never landed** |

**Real bypass list (revised): 6 sites — B1, B2, B3, B5, B6, B9.**
Plus 2 archive actions: **B7 (case-management → NSP), B12 (sdk-main-index → archive)**.
Plus 1 deprecation: **B10 (legacy gateway routes)**.

## A.2 AgentZero as the 7th LLM — already 95% built

Verification surfaced something important:

- `nv-azentzero-service.ts` (461 lines) — full sovereign-LLM impl with retry, breaker, streaming
- `intelligent-router/default-sequences.ts` already includes `agentzero` in **9 default cascades**
- `intelligent-router/router-types.ts` registers `'agentzero'` as a provider type
- `nyv-master-config.ts`, `llm-config.ts`, `nyv-dynamic-model-registry.ts` all configure it (priority 99 always-on backup)
- `.env.production` has 3 `NYV_AZENTZERO_*` env vars set

**The single missing wire**: `agentzero` is NOT in `src/config/nyv-allowed-providers.ts:ALLOWED_PROVIDERS` (only 6: anthropic, openai, google, openrouter, sarvam, bedrock). The lockdown layer rejects `agentzero` before it can fire.

**Fix is one-line** + R1 (router unification): add `agentzero` as the 7th to `ALLOWED_PROVIDERS`, and ensure `realLLMService.executeRequest` delegates to `orchestrateLLM` (R1) which already cascades to `agentzero` last. **AgentZero goes live for free as soon as R1 ships.**

## A.3 Dark-services revised disposition

| Service | Disposition |
|---|---|
| **DAG Orchestration** (`dag-orchestration-service.ts`) | **WIRE INTO QUEEN** in R4 — replace ad-hoc `Promise.all` decomposition |
| **Federated Privacy** (`security/nv-federated-privacy-service.ts`) | **GATE BEHIND `enterprise+` FEATURE FLAG**, default OFF, expose via admin endpoint. Keep code, useful for enterprise sales. |
| **PQC** (`security/nv-pqc-service.ts`) | **DISABLE via feature flag** (`NYV_PQC_ENABLED=false`), document as "scaffold for post-2030 quantum-safe regulatory requirement". Keep file. |
| `nv-azentzero-service.ts` | Activate per A.2 above |
| Other minor (`replicate-provider`, `email-automation`, `e-filing`, `nv-statute-seeding`, `nv-runtime-agent-factory`, `nv-inter-service-auth`, `nv-doc-access-guard`) | Per-service review in R4 — most are legit feature scaffolds awaiting wire-in; `nv-doc-access-guard` IS wired (only on `nv-document-orchestrator-routes.ts:33`, missing on SDK doc-pipeline) |

## A.4 Doc-access dev-mode flag (per user directive 6)

New env var: **`NYV_DOC_ACCESS_MODE=permissive|strict`** (default `permissive` in dev, `strict` in production). In `permissive`, `nv-doc-access-guard` short-circuits to allow with a `WARN` log line carrying caller + doc + would-have-decision. Lets all SDK/API testing proceed without share-grant friction. Switch to `strict` post-UAT.

Implementation: 1 file edit (`src/middleware/nv-doc-access-guard.ts`) + 1 env-var doc update.

## A.5 The 6-phase remediation (revised)

Same as §7 of the main audit, plus:

### Phase R6 — Comprehensive E2E re-verification (NEW, per user directive 8)

- Run full SDK probe matrix (7 platforms × every endpoint) against EC2 prod after R1–R5
- Verify orchestration envelope on every response
- Verify Redis + ElastiCache + BullMQ in tandem (queue depths, consumer health, no `evalsha` errors)
- Verify all 83 DB tables match `shared/schema.ts` (column drift check via `drizzle-kit introspect` diff)
- Verify audit hash chain integrity (`scripts/nv-audit-chain-repair.sh --dry-run` should be clean)
- Verify cost optimization actually kicks in: same query through new wrapper should pick a cheaper model than baseline 60%+ of the time
- Architect re-review must PASS with zero CRITICAL/HIGH findings before declaring done

**Effort**: ~4-6 h. **Risk**: low (verification only, no code).

## A.6 Total revised effort

| Phase | Hours | Approval gate |
|---|---|---|
| R1 LLM router unification (auto-activates AgentZero) | 2-3 | Required |
| R2 Universal SDK orchestration wrapper (closes 6 bypasses) | 4-6 | Required |
| R3 Code de-duplication + B7/B12 archives + B10 deprecation | 6-8 | Required |
| R4 Wire dark code (DAG into Queen, FP+PQC behind flags) + Math.random fix + naming-convention sweep | 4-5 | Required |
| R5 Doc consolidation to 10 + observability + EC2 sync + permissive doc-guard | 3-4 | Required |
| R6 Full E2E re-verification + architect re-review | 4-6 | Required |
| **Total** | **23-32 h** | 6 gates |

## A.7 Phase-1 audit corrections (transparency)

I got these wrong in my Phase-1 audit; correcting on the record:

1. **Chain-of-Thought** — Phase-1 said "raw LLM bypass." **Wrong.** It's wired into `nv-client.ts:856` inside the safety ring. Its inner `realLLMService` call is a legitimate reasoning step, not a bypass.
2. **`nv-core-routes.ts`** — Phase-1 said "MED bypass." **Wrong.** Zero direct LLM calls.
3. **`openai-document-intelligence-service`** — Phase-1 said "HIGH independent bypass." **Wrong.** Only called by `nv-sdk-gateway-routes.ts` — a single fix at B9 closes it.
4. **`nv-doc-access-guard`** — Phase-1 dark-code subagent said "DARK." **Wrong.** It IS wired (one route only). Needs broader wiring, not creation.
5. **AgentZero typo** — Phase-1 said "`nv-azentzero` looks like a typo of `nv-agentzero`." **Wrong.** "Azentzero" is the actual product name (sovereign self-hosted backup). Two files exist by design: `nv-azentzero-service.ts` (impl) + `nv-agentzero-adapter.ts` (adapter shim).
6. **Bypass count** — Phase-1 said 12. **Real number is 6** after applying the user's "downstream client vs platform" lens.

Lesson going forward: ripgrep for "is this called?" is necessary but not sufficient — must also ask "is this even Nyayavigya's responsibility?" Adding to NV-NAMING-001 guardrail below.
