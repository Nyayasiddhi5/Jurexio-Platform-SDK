# Nyayavigya Platform — Features Registry (Master Named List)

**Purpose:** The single source of truth for "is feature X built, wired, live?" Loaded by every session per `guardrails.md` § 1.

**Last regenerated:** 2026-07-29 (Wave D honesty pass)  
**Generated from:** `src/index.ts` mounts · `client/src/App.tsx` routes · `nv_*` DB tables · `docs/audit/nv-wiring-audit.json` · `docs/audit/feature-inventory-2026-05-11.md` · `docs/audit/feature-matrix-and-status-2026-05-11.md` · `docs/audit/console-cpo-audit-2026-05-11.md` · `config/agent-registries/`

> Detailed env-by-env status (Replit dev / Replit publish / EC2 prod-dev) is in `docs/audit/feature-inventory-2026-05-11.md`. **This file is the named-list summary** — every feature has a canonical name and one of: `WIRED` / `WIRED-FLAG-OFF` / `WIRE-INTERNAL` / `KEEP-BARREL` / `KEEP-CLI` / `KEEP-CONTRACT` / `KEEP-DYNAMIC-IMPORT` / `ARCHIVED`.

---

## 0. Headline numbers (live as of 2026-07-29)

| Surface | Count |
|---|---:|
| Gateway route mounts (`app.use('/api/nv*'`) | **104** (was 101 pre-v15) |
| Unique route prefixes | 91+ |
| Console pages (`client/src/pages/**.tsx`) | **121** |
| Console routes (`<Route path="…">`) | **151** |
| Active LLM providers in DB | **13** |
| Active LLM models in DB | **113** |
| MODEL_CATALOG (May-2026 frontier) | **50** |
| **Runtime agents (v5.1.0 Default + optional overlay)** | **164** |
| Archived v5.0.0 flat backup (forensic only) | **1,042** under `config/agent-registries/archive/v5.0.0/` — **not** “1,042 live” |
| MCP tool definitions (in-code catalog) | **556** (`src/data/nv-mcp-tools-registry.ts`) |
| MCP gateway executable (all handlers) | **134** |
| MCP partner curated (gateway) | **109** |
| MCP partner curated (gateway + MCP-server API) | **~125** (`packages/mcp-server` SKU `full`) |
| MCP OAuth stubs (excluded from curated claims) | **25** (DocuSign, iManage/DMS OAuth, Drive, …) |
| Caselaw semantic embed coverage | **ops backfill** of **~20.5M** (multi-shard HC+DC loop + daily coverage log; FTS/hybrid live) |
| Swarm topology catalog | **107** (`nv-swarm-topology-service.ts`) |
| Practice areas (runtime registry) | **9** |
| Jurisdictions (overlay add-ons) | IN, UK, US, EU, GC, SG (+ Default primary) |
| 22 agentic patterns | P01–P22 |
| DB tables (public + nv_schema) | 199 |
| Wired files (BFS from `src/index.ts`) | 334 |
| Used-internal files | 83 |
| Effective orphans (after allowlist) | 0 |
| Allowlisted intentional orphans | 24 (15 KEEP-BARREL + 3 KEEP-CLI + 3 KEEP-CONTRACT + 3 KEEP-DYNAMIC-IMPORT) |

> **Registry truth (locked):** Production runtime loads `Nyayavigya-Legal-registry-Default.json` (164 agents) always; `NV_PRIMARY_JURISDICTION` merges one overlay. The 1,042-agent flat set is **archived backup only** — enable `NV_REGISTRY_FORENSIC_MODE=1` to load from `archive/v5.0.0/`. Health surfaces read live counts via `getRegistryStats()`.
>
> **Frozen partner contracts (do not rename / reshape):** `POST /api/nv/orchestrate` (+ `/stream`), `POST /api/nv/v1/sdk/orchestrate`, `/api/nv/legal-chat/*`, `/api/nv/legal-work/*`, `/api/nv/rag/*`, `/api/nv/v1/sdk/cnr/*`, EDJ/shared-docs, `/api/nv/gateway/*`, `/api/nv/platforms`, `/api/nv/health`, PII/compliance/citations. Console AG-UI (`POST /api/nv/stream`) is admin JWT only; partner SSE stays outcome-only (`NV-CLIENT-OUTCOME-SANITIZE-001`).
>
> **Product scope (locked for share):** `NYV_DOMAIN_PACK=legal`. Runtime loads **Legal** registry only. Nyayavigya documentation and sell surface are **Nyayasiddhi Legal ecosystem only**.

---

## 1. AI Orchestration & Reasoning

| Feature | Canonical name | File / Mount | Status |
|---|---|---|---|
| Queen Orchestrator (master coordinator) | `nv-queen-orchestrator` | `src/orchestration/nv-queen-orchestrator.ts` | WIRED — A2A INTENT + ROMA L5 outcome track (2026-08-11) |
| NS LRM Core v9 (Nyayasiddhi Legal Reasoning Model) | `nyayavigya-orchestration-core-v9` | `src/orchestration/nyayavigya-orchestration-core-v9.ts` (592 LOC) | WIRED — consumed by 9 files |
| 22 agentic patterns (P01..P22) | ROMA L5 patterns | `src/agents/`, mounted via `/api/nv/stream/<pattern>` | WIRED — all 22 streamable |
| AGUI streaming (AG-UI lifecycle events) | `nv-agui-stream-routes` | `/api/nv/stream/{,:pattern,:health}` | WIRED — Session-15 v15 added dual auth |
| Smart Thinking Engine | `nv-smart-thinking-engine` | `src/orchestration/nv-smart-thinking-engine.ts` | WIRED |
| Production Orchestrator | `nv-production-orchestrator` | `src/orchestration/nv-production-orchestrator.ts` | WIRED |
| Runtime Agent Factory | `nv-runtime-agent-factory` | `src/orchestration/nv-runtime-agent-factory.ts` | WIRED |
| Maker-Checker Loop | `MakerCheckerService.runLoop` | injected into queen synth via `maybeRunMakerCheckerLoop()` | WIRED-FLAG-OFF (`NYV_F_GOV_MAKER_CHECKER`) |
| Self-Improvement Orchestrator | `nv-self-improvement-orchestrator` | wire-chain | WIRED-INTERNAL |
| Streaming Orchestrator | `nv-streaming-orchestrator` | wire-chain | WIRED-INTERNAL |
| Internal wire-chain (edge-holder) | `nv-internal-wire-chain` | `src/orchestration/nv-internal-wire-chain.ts` | WIRED |
| Plugin Bootstrap | `nv-plugin-bootstrap` | `src/orchestration/nv-plugin-bootstrap.ts` | WIRED |
| Capability Manifest | `capability-manifest` (snapshot JSON) | `src/orchestration/capability-manifest.{ts,snapshot.json}` | WIRED — **SDK/runtime authority = `capability-manifest.ts`**; snapshot JSON is generated (`npm run manifest:snapshot`); `nv_schema.protocol_registry` is a **derived DB seed** via `scripts/nv-reseed-protocol-registry.ts`, not an alternate source of truth |
| Concurrency Governor | `concurrency-governor` | `src/orchestration/concurrency-governor.ts` | WIRED |
| Orchestration Middleware | `orchestration-middleware` | `src/orchestration/orchestration-middleware.ts` | WIRED |
| Orchestration Policy | `orchestration-policy` | `src/orchestration/orchestration-policy.ts` | WIRED |
| Unified Routing Registry | `nv-unified-routing-registry` | wire-chain | WIRED-INTERNAL |
| SDK Auto-Initialization | `nv-sdk-auto-initialization` | `src/orchestration/nv-sdk-auto-initialization.ts` | WIRED |
| Agent Hierarchy Coordinator | `agent-hierarchy-coordinator` | `src/orchestration/agent-hierarchy-coordinator.ts` | WIRED |
| Prompt Enhancement Pipeline | `nv-prompt-enhancement-pipeline` | `src/orchestration/nv-prompt-enhancement-pipeline.ts` | WIRED |
| Response Engineering Pipeline | `nv-response-engineering-pipeline` | `src/orchestration/nv-response-engineering-pipeline.ts` | WIRED (2026-08-11: `fix-bullet-spacing` must not split `**bold**`) |
| GRPO (Group-Relative Policy Optimization) | GRPO online EMA + nightly export | `nv-grpo-online-policy` + `nv-grpo-nightly-export-scheduler` | WIRED — GPU weight trainer still PARKED |
| A2A collaboration bus | `protocol.a2a.handoff` | INTENT `a2a` / `handoff` + Queen analyzePrompt + tool-bridge | WIRED |
| ROMA L5 engine | `roma-l5-engine` | Redis-backed performance store + Queen/specialist/doc `trackOutcome` + `/api/nv5/orch/roma` | WIRED |
| Continuous Agent Monitoring 2.0 (CAM) framework | CAM analyzer + dashboard | ~2,044 LOC + `/api/nv/v1/sdk/cam/dashboard` + `/api/nyayavigya/cam/dashboard` (Session-15 v15) | WIRED — `totalAgents` from live registry (not empty `nv_agents`); ROMA tracked count additive |
| AgentZero (sovereign always-on backup) | `agentzero-adapter` + `azentzero-service` | wire-chain via provider-registry | WIRED |
| Digital Twin Service | `src/services/digital-twin/*` | service tree | WIRED |
| Self-Improvement Engine | `nv-self-improvement-orchestrator` | wire-chain | WIRED-INTERNAL |
| Event Replay Service | `nv-event-replay-service` | wire-chain | WIRED-INTERNAL |
| Real-Time Collaboration Service | `nv-real-time-collaboration-service` | wire-chain | WIRED-INTERNAL |

## 2. LLM Providers (13 active)

| # | Provider | Latest May-2026 model | Status (dev) |
|---|---|---|---|
| 1 | anthropic | claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5, claude-opus-4-6 | WIRED, key set |
| 2 | openai | gpt-5.5-pro, gpt-5.5, gpt-5.4, gpt-5.4-mini, o3, gpt-5, gpt-5-mini, gpt-5-nano | WIRED, key set |
| 3 | google | gemini-3-1-pro-preview, gemini-3-flash-preview, gemini-2.5-flash, gemini-2.5-pro | WIRED, key set |
| 4 | sarvam | sarvam-105b, sarvam-30b, sarvam-m, bulbul-v2, saaras-v2.5 | WIRED, key set |
| 5 | openrouter | 12 paid + 13 `:free` backups | WIRED, key set |
| 6 | bedrock (AWS) | **Primary `us-east-1`** (failover `ap-south-1`). Live invoke 2026-08-14: **Opus 5** (`us.anthropic.claude-opus-5`), **Opus 4.8/4.7**, **Sonnet 5**, Sonnet 4.6, Opus 4.6, Haiku 4.5; DeepSeek V3.2/R1; Kimi; Qwen3 VL/Next; Gemma3-27B; GLM-5. Global Opus 5 = payment instrument; Fable 5 = data-retention mode. | WIRED; latest Claude cascade 2026-08-14 |
| 7 | deepseek | deepseek-v4-pro, deepseek-v4-flash | WIRED, **no key** — explicit `unavailable-no-key` via `router-stats.providerKeyChecklist` (Session-16); router skips, agentzero is terminal fallback |
| 8 | mistral | mistral-medium-3, mistral-large-2-2411 | WIRED, **no key** |
| 9 | xai | grok-4.20, grok-4.20-reasoning (2M ctx) | WIRED, **no key** |
| 10 | groq | llama-3.3-70b-versatile (LPU) | WIRED, key set on EC2 (health 2026-08-05) |
| 11 | cohere | command-r-plus-08-2024 | WIRED, **no key** — OpenRouter bridge when catalog id selected |
| 12 | perplexity | sonar-pro, sonar-reasoning-pro (+ `perplexity/sonar-pro` via OpenRouter) | WIRED — direct needs `PERPLEXITY_API_KEY`; else OpenRouter bridge when `OPENROUTER_API_KEY` set |
| 13 | agentzero | sovereign always-on backup | WIRED, always-on |

**Two registries (NV-DOC-001 documented):** `intelligent-router/MODEL_CATALOG` (50 frontier entries, source of truth for `/api/nv/v1/sdk/llm/*` and router) vs `nyv-dynamic-model-registry/BUILT_IN_MODELS` (115 entries, older orchestration registry seeded into `nv_llm_providers`/`nv_model_catalog`). Consolidation deferred. Partners use the SDK catalog endpoint as authoritative.

## 3. Memory & RAG

| Feature | Canonical name | Status |
|---|---|---|
| 5-tier memory architecture | working / short / long / episodic / semantic | WIRED |
| mem0 integration | mem0 client | WIRED |
| Semantic cache | `nv-prompt-cache` + `nv-multi-tier-cache` | WIRED-INTERNAL |
| Vector store | `nv-vector-store` | WIRED-INTERNAL |
| Graph store | `nv-graph-store` | WIRED-INTERNAL |
| GraphRAG fusion (RRF reranking) | RRF reranker | WIRED |
| Multi-tier RAG | retrieval pipeline | WIRED |
| Tiered Memory Storage | `tiered-memory-storage` | USED-INTERNAL |
| Project Memory Manager | `project-memory-manager` | USED-INTERNAL |
| Document Intelligence Service | `document-intelligence-service` | USED-INTERNAL |
| Document Parsing Service | `document-parsing-service` | USED-INTERNAL |
| **@nyv/docparse (Indian legal OCR + 58-type engine)** | `packages/docparse/` · `nv-docparse-adapter-service.ts` · `nv-docparse-ingest-helper.ts` · `NYV_F_DOCPARSE` | **WIRED** — all partner binary ingest paths (gateway, doc-pipeline, orchestrate, Patra Mitra, production-doc-processor); `tables[]` + OCR fallback chain; deployed nysdev `2026-08-27T1229Z-aws-ssm` |
| **@nyv/docparse-sdk (Platform SDK — legal-first NYV/NSP)** | `packages/docparse-sdk/` · `nv-docparse-sdk-adapter-service.ts` · BullMQ `nyv-docparse-sdk` · `docparse.intelligence/v1` · `npm run docparse-sdk:gate:legal` · client-sdk `NyvLegalDocparse` | **WIRED** — `@nyv/docparse-sdk@1.0.0-alpha.2`; ingest default **ON** non-dev (`NYV_F_DOCPARSE_SDK`); legacy `@nyv/docparse` fail-soft fallback; NSP bind via `legalParseGuide` + `nspAutofillAction` |
| **@nyayavigya/nsp-docparse (NSP local-first hybrid)** | `packages/nsp-docparse/` · `NspHybridDocparseClient` · `npm run nsp:pack:docparse-local` · [`NSP-DOCPARSE-LOCAL-FIRST-HANDOFF.md`](documents/working/NSP-DOCPARSE-LOCAL-FIRST-HANDOFF.md) | **WIRED** — local `@nyv/docparse-sdk` + optional NYV escalation; partner tarball bundle |
| Patra Mitra (Document Companion) | `nv-patra-mitra-*` + `/api/nv/v1/sdk/patra-mitra/*` | WIRED — parse/OCR/fields/summary/doc-chat + session list + parse tools + multilingual; NYS workbench `/patra-mitra`; **client-sdk `nyv.patraMitra` @5.0.10**; NYM SDK 5.1.2 |
| CNR corpus resolve (NSP autofill) | `nv-cnr-*` + `/api/nv/v1/sdk/cnr/*` → NYS `/api/cnr/*` | **Live** NYV + NYS; partner `claimEcourts:false`; **Nyayasearch dashboard** `/case-lookup` LIVE (same NYS API, session auth) |
| Nyayasearch CNR/diary case lookup UI | `nys-dashboard-cnr-lookup` + `/case-lookup` | **LIVE** caselaw-worker deploy 2026-09-04 — `/case-lookup` HTTP 200; accept probe SSM `863ca44e`; frontend md5 `d440cdf1a2b371611cbedf9cea5c94c6` |
| Nyayasearch case detail (corpus) | `nys-dashboard-case-detail` + `/case/:cnr` | **LIVE** — `CaseTimeline`, `CaseDocumentsPanel`, `PdfViewerDialog`; caseCreate profile |
| Tier-4 live eCourts fallback (dashboard) | `nys-cnr-live-tier4` + `options.live` | **WIRED** — NIC client module; worker `NYV_ECOURTS_API_KEY` **absent** (configured:false SSM `bdbb2768`); UI disabled state + write-through on live hit |
| District court Open Data (AP+TG) | `ingest-rds` `dc`/`delta-dc` → `judgments` `court_type=dc` | **Live** (GO 2026-08-10): ~2.1M rows 2024–2026; hist backfill 1987–2023; smoke `TSWL…2024` found/`dc`; daily/weekly delta |
| LLM Cache Key | `nv-llm-cache-key` | WIRED-INTERNAL |
| NYS Knowledge Plane (federated) | `nv-nys-knowledge-*` + Auto-RAG `nys_global` + `/api/nv/knowledge/*` + `/api/nv/legal-work/*` + Console `/nys-knowledge-plane` (SSO + embed SLOs) | WIRED — flag on nysdev; Queen RAG dedupe; caselaw `hybrid_rrf`; stats SWR; SSO `NYS_SSO_LAUNCH_SECRET`; manage UI = nyayasearch |
| Canonical NSP legal templates catalog | `nv-templates-catalog` + `/api/nv/templates` (+ `/catalog`, `/gateway/templates`, `/:id`, `/:id/generate`) | WIRED — EC2 2026-07-29; **IN approved** (`platform_curated`/`sme_approved`); SME review routes; SDK `@nyayavigya/client-sdk@5.0.5`; **+ BNSS 25 court apps pack** live `2026-08-03T1408Z-aws-ssm` |
| BNSS 25 essential court applications KB | `nv-bnss-court-applications-pack` + drafting/Queen overlay + BNSS statute expansion | **Live** EC2 `2026-08-03T1408Z-aws-ssm` — templates/checklist/matcher/sections |
| SME HC-pattern legal drafting | `nv-legal-drafting-prompt` (NV-SME-LEGAL-DRAFT-002) + Console `/legal-drafting` + mic | **Live** `2026-08-03T1509Z-aws-ssm` — HC/Sessions pattern, no bail sureties pre-grant, forum fields, humanized voice |
| Legal-intel force (anti-generic) | `nv-legal-intelligence-overlay` + Queen merge + AgentsApi.run depth | **Live** `2026-08-03T1528Z` — overlay survives compiler |
| Agent identity on merge (FORCE-002) | `preserveAgentIdentityFromRegistryPrompt` keeps §1/§2 | **Live** `2026-08-03T1726Z-aws-ssm` — NSP/NYM: identity + mandate + legal intel |
| Prompt load-once (SESSION-001) | `nv-agent-prompt-bundle` + session store + Queen/client L0/L1/L2 | **Live** `2026-08-04T0846Z-aws-ssm` — Turn 1 full constitution; Turn 2+ identity+mandate; ecosystem auto-session |
| SME template legal-review pipeline | `nv-templates-sme-review` + `/api/nv/templates/reviews*` + `POST /:id/review` | WIRED — 2026-07-29T07:55:00Z; rubric gate ≥0.75 for sme_approved |
| Agent retrieval policy | `nv-agent-retrieval-policy` — Queen Step-0 + patterns + legal-work | WIRED — order **NYS → tenant RAG/KB → memory → LLM**; India-first |
| Matter Vault (Harvey-style) | `nv-matter-vault-*` + `/api/nv/matter-vault/*` + Console `/matter-vault` | WIRED — EDJ batch ingest + tenant RAG probe + contract playbook runs |

## 4. Voice / Multimodal / i18n

| Feature | Canonical name | Mount | Status |
|---|---|---|---|
| Voice WebSocket pipeline | `nv-voice-ws-routes` | ws `/api/nv/voice/stream` | WIRED — Deepgram + Sarvam 22-Indic + Whisper |
| Voice REST routes (per-format) | `/api/nv5/voice/*` | Batch B | WIRED |
| Voice provider tagging | `nv_voice_sessions.provider` column | DB | WIRED — Session-15 v15 added column |
| Multimodal voice routes | `nv-sdk-multimodal-voice-routes` | `/api/nv/sdk/multimodal/*` (12 endpoints) | WIRED |
| Voice package metadata | `src/packages/voice/index.ts` | barrel | KEEP-BARREL |
| Multimodal package metadata | `src/packages/multimodal/index.ts` | barrel | KEEP-BARREL |
| i18n package metadata | `src/packages/i18n/index.ts` | barrel | KEEP-BARREL |
| Translation service | `nv-translation-service` | wire-chain | WIRED-INTERNAL |
| Doc-AI converter (1 GB streaming) | `/api/nv5/doc-ai/convert` | path-based + disk-spill | WIRED — task-106/129 (2026-05-11) |

## 5. Partner SDK surface (`/api/nv/v1/sdk/*` + `/api/nv/sdk/*`)

| Feature | Mount | Auth | Status |
|---|---|---|---|
| LLM catalog (filterable) | GET `/api/nv/v1/sdk/llm/catalog` | X-API-Key | WIRED — Session-15 v15 |
| Provider matrix (derived from MODEL_CATALOG) | GET `/api/nv/v1/sdk/llm/providers` | X-API-Key | WIRED — Session-15 v15 |
| Router health snapshot | GET `/api/nv/v1/sdk/llm/router/health` | X-API-Key | WIRED — Session-15 v15 |
| Router explain (predict cost/latency) | POST `/api/nv/v1/sdk/llm/router/explain` | X-API-Key | WIRED — Session-15 v15 |
| CAM dashboard (partner) | GET `/api/nv/v1/sdk/cam/dashboard[/:startupId]` | X-API-Key | WIRED — Session-15 v15 |
| CAM dashboard (UI) | GET `/api/nyayavigya/cam/dashboard[/:startupId]` | JWT | WIRED — Session-15 v15 |
| AGUI stream (dual-auth) | POST `/api/nv/stream/{,:pattern}` | X-API-Key OR JWT | WIRED — Session-15 v15 |
| Canonical agent endpoint | GET `/api/nv/gateway/agents` | any valid SDK key | WIRED |
| SDK provisioning routes | `nv-sdk-provision-routes` | super-admin | WIRED |
| SDK auto-init | `nv-sdk-auto-initialization` | startup | WIRED |
| Dual auth middleware | `dualSdkOrJwt` (`src/middleware/nv-dual-auth.ts`) | helper | WIRED |
| Canonical SDK auth header | `extractSdkApiKey` (`src/middleware/nv-sdk-auth-header.ts`) | helper | WIRED + CI-enforced (NV-AUTH-HEADER-001) |
| Inter-service auth | `src/middleware/nv-inter-service-auth.ts` | east-west `X-NV-API-Key` | WIRED |
| API versioning middleware | `src/middleware/nv-api-versioning.ts` | global `/api/nv/*` | WIRED — Phase 0 (2026-05-10) |

## 6. Governance / Compliance / Cost (`/api/nv5/gov/*`)

| Feature | Mount | Status |
|---|---|---|
| Governance routes (5 services) | `/api/nv5/gov/*` | WIRED — Session-16 (2026-06-02): `govConcurrency`+`govCostOpt`+`govSecurityMon` DEFAULT-ON in non-dev (fail-soft); `govMakerChecker`+`govOrgRatelimit` remain FLAG-OFF (documented gate) |
| Maker-checker | injected into queen synth | WIRED-FLAG-OFF (`NYV_F_GOV_MAKER_CHECKER`) — default ON for enterprise pack (`NYV_ENTERPRISE_TIER` / `NYV_PACK=enterprise`); SME forces per-request via `metadata.forceMakerChecker` |
| Legal-pipeline admin (5) | `/api/nv5/legal-pipeline/*` | WIRED — Session-16: all 5 `NYV_F_LEGAL_PIPELINE_*` DEFAULT-ON in non-dev (read-only deterministic, SDK-key gated) |
| Compliance admin (3) | `/api/nv5/compliance/*` | WIRED — Session-16: 3 `NYV_F_COMPLIANCE_*` DEFAULT-ON in non-dev (route exposed; full PQC/federated needs `NYV_PQC`/`NYV_ENTERPRISE_TIER`) |
| Internal services admin | `/api/nv5/internal/*` | WIRED — Session-16: `NYV_F_INTERNAL_SURFACE` DEFAULT-ON in non-dev (read-only `/capabilities`, SDK-key gated) |
| Audit hash chain | every safety-ring response | WIRED |
| Hallucination check | safety ring | WIRED — jurisdiction-pluggable (`src/services/citation-verification/`), non-IN delegates to authority registry |
| Citation check | safety ring | WIRED — **LIVE authority verification** (Session-17, 2026-06-03) across 6 JCNs via `NYV_F_CITATION_LIVE_*` (default-ON non-dev). FULLY-LIVE: UK (legislation.gov.uk), EU (EUR-Lex CELEX), IN (India Code). BEST-EFFORT: SG (SSO title-hit; corpus primary). DEGRADED-PENDING-CREDENTIAL: US (set `NYV_COURTLISTENER_TOKEN`), GC (set `NYV_GC_LEGISLATION_API_BASE`). Timeout+cache guarded → explicit `unverified` on failure, never silent `verified`. |
| HITL gate | safety ring | WIRED — `NYV_F_HITL_REGISTRY` default ON in non-dev (2026-07-14) |
| Bias analysis | `nv_schema.bias_analysis_log`, `bias_audits` | WIRED |
| Model drift detection | `nv_schema.model_drift_*` (3 tables) | WIRED |
| Explainability logs | `nv_schema.explainability_logs` | WIRED |
| Adversarial test runs | `nv_schema.adversarial_test_runs` | WIRED |
| Compliance evidence | `nv_schema.compliance_evidence` | WIRED |
| Data lineage audit | `nv_schema.data_lineage_{audit,events}` | WIRED |
| Credit gate middleware | feature-flag gated | WIRED-FLAG-OFF |
| Credit transactions / wallet | `nv_schema.credit_{transactions,wallet}` | WIRED |
| AI credit usage / overrides | `nv_schema.ai_credit_{usage,overrides}` | WIRED |
| Billing invoices / activity | `nv_schema.billing_{invoices,activity_log}` | WIRED |

## 7. Console (React 19, 121 pages, 151 routes)

| Hub | Path | Consolidated pages | Status |
|---|---|---|---|
| OrchestrationHub | `/orchestration` | replaces ~6 standalone pages | WIRED (consolidation 60% — see CPO audit) |
| IntelligenceHub | `/intelligence` | central AI ops | WIRED (consolidation 60%) |
| OperationsHub | `/operations` | platform health, metrics | WIRED (consolidation 60%) |
| ChatHub | `/chat` (default tab `universal` = UniversalChat); aliases `/universal-chat → /chat?tab=universal`, `/global-chat → /chat?tab=agents`, `/legal-chat → /chat?tab=legal`. Sidebar entry: Workspace › Chat. ProtectedRoute `minRole="user"`. | unified chat surface | WIRED (verified task-249, 2026-05-12) |
| SDKHub | `/sdk` | SDK key mgmt, catalog browse | WIRED |
| CommandCentre | `/admin`, `/admin-console`, `/command-centre` | aliased — same component | WIRED (alias dedup pending) |
| AgentRegistry | `/agents`, `/agent-registry` | aliased — Agent Gallery with swarm topologies tab | WIRED |
| MatterVault | `/matter-vault` | Harvey-style matter review hub | WIRED |
| TwinDesk / Digital Twin | `/digital-twin-creator`, `/digital-twin` | TwinDesk API `/api/nv/twindesk/*` + SDK `nyv.twins` | WIRED |
| CAMMonitoringDashboard | (queries `/api/nyayavigya/cam/dashboard`) | live | WIRED — Session-15 v15 |

> Console consolidation gaps tracked in `docs/audit/console-cpo-audit-2026-05-11.md` (28 stub pages, 84 → 24 sidebar consolidation pending, 12 broken endpoints flagged).

### 7a. Shared review rail panels (`client/src/components/execution/`)

Hosted by `ExecutionTraceRail`, which sits beside the answer on every surface where a deliverable
is reviewed (LegalChat, SME workspace, drafting, live testing, orchestration trace, instant search,
SDK playground). **Audit this table before building any new authority/verdict surface — these are
the existing ones (NV-NO-DUPLICATE-001).**

| Panel | Backing endpoint / contract | Reached from | Status |
|---|---|---|---|
| `ReasoningTrailPanel` (`NV-REASONING-TRAIL-001`) | server `qualityEnvelope` via `nv-orchestration-response-contract` | rail `trail` prop | WIRED |
| **`GoodLawPanel` (`NV-GOOD-LAW-PANEL-001`)** — "is this authority still good law?" | `GET /api/nv/knowledge/caselaw/treatment` → `nv-citator-treatment.ts`; readouts in `client/src/lib/nv-good-law.ts`; SDK `nyv.knowledge.caselawTreatment()` | rail `goodLawCitation` prop (Legal Chat per-citation) + Instant Search caselaw rows | WIRED |

> `GoodLawPanel` is **not a citator** and must never be extended into one implicitly:
> `nv_legal_graph_entities` / `nv_legal_graph_edges` hold **0 rows**, so it is deterministic phrase
> extraction over retrieved passages. `goodLaw: 'good'` is **unreachable by construction** upstream
> and the panel has no affirmative badge — a green tick would be read as a clearance the platform
> cannot give. `coverage` renders unconditionally and `extractedBy` renders per row; both are
> load-bearing, not decoration. Costed plan for a real graph:
> `documents/working/NYV-TREATMENT-GRAPH-ASSESSMENT-2026-08-19.md` (assessment only, not started).
>
> **`NV-CITATOR-ATTRIBUTION-001` (2026-08-20) — the attribution step exists; the backfill does not.**
> `src/services/nv-citator-attribution.ts` binds an adverse phrase to the authority it is *about*,
> and `detectNegativeTreatment({ targetAuthority })` refuses to emit a row it cannot bind. Rows
> carry `attributionMethod` (`citation-span` | `case-name-span` | `reporter-list-verdict`) alongside
> `extractedBy`. Measured on 32 corpus-derived gold items: **100.0% precision / 0 false positives /
> 66.7% recall**, against **25.0% precision** for detection alone over the same full bodies. Authority
> identity is shared from `src/services/nv-authority-identity.ts`, not re-implemented
> (NV-NO-DUPLICATE-001) — `nv-knowledge-plane-routes.ts` still holds a copy and a drift test fails if
> either side is edited alone. **`nv_legal_graph_*` are still 0 rows and must stay so** until the gold
> set is widened and Kesavananda / Maneka Gandhi are reachable (both HTTP 413 against the live 20 MB
> extraction cap). Evidence and the conditional backfill recommendation:
> `docs/audit/eval/nv-treatment-attribution-2026-08-20.md`. Re-measure with
> `npm run eval:treatment-attribution -- --baseline`.

## 8. Per-feature service trees (`src/services/*`)

All listed below are **WIRED** (consumed by route handlers or wire-chain) unless noted otherwise:

| Service tree | Status |
|---|---|
| `intelligent-router` (MODEL_CATALOG, pickSequence, cost-aware-router) | WIRED |
| `llm-providers` (per-provider adapters) | WIRED |
| `memory` (5-tier, mem0, tiered-memory-storage) | WIRED |
| `rag` (multi-tier retrieval, GraphRAG, RRF rerank) | WIRED |
| `sdk` | WIRED |
| `document-pipeline` (intelligence + parsing services) | USED-INTERNAL via wire-chain |
| `jurisdiction-agents` | WIRED |
| `enterprise-platform` (dead `index.ts` stub archived 2026-05-10) | WIRED (real impl); old stub ARCHIVED |
| `digital-twin` | WIRED |
| `skills` | WIRED |
| `e-filing` | WIRED |
| `white-label` | WIRED |
| `rbac` | WIRED |
| `contract-lifecycle` | WIRED |
| `regulatory-monitor` | WIRED |
| `llm-priority-manager` | WIRED |
| `clawdbot`, `openbot`, `automateai`, `twindesk`, `nyaya-tools` | WIRED |
| `intelligence`, `testing`, `security`, `compliance` | WIRED |
| `microservice-contracts` (3 contract specs) | KEEP-CONTRACT (intentional, deploy-time consumed) |
| `queue` | WIRED |
| `orchestration` (sub-tree) | WIRED |
| `persistence` | WIRED |
| `multi-org` (dead `index.ts` stub archived 2026-05-10) | WIRED (real impl); old stub ARCHIVED |
| `redis.ts`, `redis-client.ts` | USED-INTERNAL |
| `nv-model-catalog-seeding-service`, `nv-statute-seeding-service` | KEEP-CLI (deploy-time seed) |

## 9. Top-level `packages/` (publishable SDKs)

| Package | Status |
|---|---|
| `client-sdk` | WIRED — partner-facing |
| `nyayamitra-sdk` | WIRED — citizen-app (Indic + offline) |
| `client-sdk-react-native` | WIRED — mobile |
| `enterprise-sdk` | WIRED — org/billing/compliance wrapper |

## 10. Agent registries (v5.1.0 runtime + archived backup)

| Layer | Path | Agents | Status |
|---|---|---:|---|
| **Primary runtime (Default)** | `config/agent-registries/Nyayavigya-Legal-registry-Default.json` | 164 | WIRED — always loaded first |
| IN overlay | `…-registry-IN.json` | 164 (same IDs, tuned metadata) | WIRED — optional via `NV_PRIMARY_JURISDICTION=IN` |
| UK overlay | `…-registry-UK.json` | 164 | WIRED — optional overlay |
| US overlay | `…-registry-US.json` | 164 | WIRED — optional overlay |
| GC overlay | `…-registry-GC.json` | 164 | WIRED — optional overlay |
| EU overlay | `…-registry-EU.json` | 164 | WIRED — optional overlay |
| SG overlay | `…-registry-SG.json` | 164 | WIRED — optional overlay |
| **Archived v5.0.0 backup** | `config/agent-registries/archive/v5.0.0/` | 1,042 flat (historical) | ARCHIVED — forensic mode only (`NV_REGISTRY_FORENSIC_MODE=1`) |
| Legacy flat merged file | ~~`src/data/nv-agents-registry.json`~~ | removed | Use `src/data/jrx-agents-registry.json` only |

## 11. Database (199 tables)

Schemas: `public` (application data) + `nv_schema` (governance/audit). Tables prefixed `nv_` in `public` are application-side; tables in `nv_schema` are audit/governance.

Key table families (full list via `psql … "\dt nv_schema.*"` and `\dt public.*"`):
- **Agents:** `nv_agents` (1,299 rows), `nv_agent_*` (configs, personas, metrics, performance, prune log, marketplace_*, chains, chain_executions, learning_sessions, experiments, audit_log, auto_selections)
- **LLM:** `nv_llm_providers` (13 active), `nv_model_catalog` (113 active), `nv_router_decisions`
- **Memory:** `nv_schema.memory_entries`, `knowledge_chunks`, `knowledge_graph_{edges,entities}`
- **Documents:** `documents`, `document_extracted_content`, `document_pages`, `document_parsing`, `document_processing_jobs`, `ns_doc_processing_jobs`, `ns_parsed_documents`
- **Cases:** `nv_cases`, `nv_case_documents`, `nv_case_insights`, `case_predictions`, `case_updates`
- **Voice:** `nv_voice_sessions` (with `provider` column added Session-15 v15)
- **Audit/Governance:** `nv_audit_logs`, `audit_log`, `data_lineage_*`, `bias_*`, `hallucination_checks`, `citation_checks`, `model_drift_*`, `model_governance`, `explainability_logs`, `adversarial_test_runs`, `compliance_evidence`
- **Billing:** `credit_*`, `billing_*`, `ai_credit_*`
- **HITL:** `hitl_reviews`, `hitl_workflows`, `hitl_workflow_executions`
- **AGUI:** `agui_events`
- **MCP:** `mcp_tool_executions`
- **Async:** `async_job_queue`
- **Auth:** `nv_users`, `nv_api_keys`, `nv_auth_tokens`, `sdk_app_api_keys` (scopes source of truth)

## 12. Configuration sources

| Source | Path |
|---|---|
| Master config | `src/config/nyv-master-config.ts` + `config/nyv-master-config.json` |
| Feature flags | `src/config/nv-feature-flags.ts` (NYV_F_* gates) |
| Product config | `src/config/nv-product-config.ts` |
| SDK variants | `src/config/nv-sdk-variants.ts` (NB: scopes source of truth is DB `sdk_app_api_keys.scopes`) |
| Allowed providers | `src/config/nyv-allowed-providers.ts` |
| Dynamic model registry | `src/config/nyv-dynamic-model-registry.ts` (115 entries) |
| Scale config | `src/config/nyv-scale-config.ts` |
| SDK production config | `src/config/nyv-sdk-production-config.ts` |
| Platform config | `src/config/platform-config.ts` |
| API versions matrix | `src/config/api-versions.ts` (v5.0.0 current, v3.1/v3.0 supported, v2 deprecated→2026-06-01 sunset) |
| Jurisdiction configs | `src/config/jurisdiction-configs.ts` |
| LLM config | `src/config/llm-config.ts` + `config/llm/` |
| CORS | `src/config/cors-config.ts` |
| Scraper allowlist | `src/config/nv-scraper-allowlist.ts` |
| DMS config | `src/config/nyv-dms-config.ts` |
| Service URLs | `src/config/nv-service-urls.ts` |
| Registry paths | `src/config/registry-paths.ts` |
| Domain packs | `src/config/nv-domain-packs.ts` (`NYV_DOMAIN_PACK`, default `legal`; `GET /api/nv/domains`) |
| Agent config | `src/config/agent-config.ts` |

## 13. Infrastructure

| Surface | Status |
|---|---|
| Replit dev (this workspace) | gateway port 5000 (Upstash Redis), 40/40 strict UAT PASS |
| Replit publish (deployment target) | NEEDS provider keys per `feature-inventory` table — see "needs key" rows |
| EC2 prod-dev `i-0df71e5ea1df8f588` | live behind `console.nyayasiddhi.online` + `api.nyayasiddhi.online` + `nym.nyayasiddhi.online`, image `:proxyfix-20260507T042014Z`, ElastiCache `nyv-dev-edge-redis`, BEHIND on code (per `EC2-INTEGRATION-STATUS.md`) |
| Per-deploy network bridge | `nyayavigya-platform-312_nyv-net` (NOT `naya...`) — systemd unit `nyv-gateway-bridge.service` |
| Active DNS | only `nyayasiddhi.online`, `www.`, `api.`, `console.`, `nym.` resolve |

## 14. Allowlisted intentional orphans (24 — DO NOT WIRE)

| Disposition | Count | Files |
|---|---:|---|
| KEEP-BARREL | 15 | `src/orchestration/index.ts`, `src/packages/{analytics,i18n,protocols,security,voice,workflows}/index.ts`, `src/packages/tools/{,code/,database/}index.ts`, `src/services/{document-pipeline,memory,orchestration,multi-org,enterprise-platform,rag}/index.ts` |
| KEEP-CLI | 3 | seed scripts + type-only test (`nv-model-catalog-seeding-service`, `nv-statute-seeding-service`, `nv-queen-lifecycle-events.types-test.ts`) |
| KEEP-CONTRACT | 3 | `src/services/microservice-contracts/nv-{agent,doc,rag}-service-contract.ts` |
| KEEP-DYNAMIC-IMPORT | 3 | files consumed via `await import()` |

Effective orphan count: **0**. Budget: 1 (allows one in-flight). CI-enforced via `npm run guardrail:no-new-orphans`.

## 15. Recent corrections (Session-15 v15→v16)

Originally reported as missing/not-wired but verified live during the triple-pass audit:

- ✅ May-2026 model catalog (50 entries in `intelligent-router/MODEL_CATALOG`) — was always wired
- ✅ AgentZero (~1,090 LOC, sovereign backup) — wired via provider-registry
- ✅ GRPO (~750 LOC) — wired
- ✅ CAM framework (~2,044 LOC) — wired; bridge route added v15
- ✅ Voice/multimodal/i18n packages — barrels intentional, real impls wired via `/api/nv/voice/*` + `/api/nv5/voice/*` + `/api/nv/sdk/multimodal/*`
- ✅ mem0 — wired
- ✅ AGUI streaming — wired; dual-auth added v15

The "missing" verdicts were a shallow-audit artifact. This registry is the corrective single-source-of-truth so it doesn't recur.

## 16. Partner claims honesty matrix (Wave D — 2026-07-29)

Use these postures in sales, integration docs, and Console copy. Authority: `MCP_REGISTRY_STATS` · `PLATFORM-STATUS.md` § honesty.

| Claim | Posture | Honest fact |
|---|---|---|
| Partner curated MCP (~125) | **Live** | 109 gateway curated + ~16 MCP-server API tools |
| MCP catalog (~556) | **Catalog only** | Majority return honest `501` — never sell full catalog as live |
| OAuth connector stubs (~25) | **Not sold** | DocuSign / iManage / Drive / Slack / … → `oauth_required` |
| Runtime agents (164) | **Live** | Default registry always loaded |
| Archived agents (1,042) | **Not live** | Forensic backup only (`NV_REGISTRY_FORENSIC_MODE=1`) |
| Caselaw semantic embed | **Ops-backfill** | multi-shard HC+DC systemd + daily JSONL; hybrid + FTS search work today |
| Queen CoT + maker-checker + neural rerank | **Live** (tier-gated) | Queen / pro+ / enterprise; lite + `partnerSyncLean` lean |
| Mesh v1 manifest leaves | **Live** (schedulable) | `templates.*`, `digital_twin.simulate`, `clm.*`, `efiling.*`, `intelligence.precedent` |
| Multi-AZ RDS / ElastiCache | **Not sold** | Dev-tier single-AZ — requires explicit GO (P2/P3) |
| Sealed SC/HC certified forms | **Not sold** | India templates = practitioner / SME-approved drafts |
| SOC 2 Type II certification | **Not sold** | Evidence mappers + audit chain — no Type II cert |
| Full DMS OAuth (DocuSign / iManage) | **Not sold** | Partners own OAuth UX; NYV accepts content/`storageRef` |
| Instant Search (dedicated partner `/instant` API) | **Not sold** | Facade `nyv.instantSearch` → `/api/nv/knowledge/*`; Console UI `/instant-search` + Intelligence Hub tab; NYS `/statutes` + `/caselaw` |
| Live Legal Feed (own RSS→S3/RDS/RAG) | **Live** | `/api/nv/v1/sdk/legal-intelligence/feed*`; Console `/legal-intelligence-feed`; no Tavily by default |
| Regulatory feed intelligence route | **Live** | Reads own `nv_regulatory_feeds` + digests; empty = honest no fake items |
| Amendment impact intelligence | **Live** | Adapter over NyayaAmend DB (not synthetic stub) |
| NyayaWatch rules | **Live** | Persisted `nv_schema.nv_nyayawatch_rules` |
| Gazette → matter notify | **Deferred** | Phase C — not sold |
| Tavily regulatory sweep | **Flag-gated** | `NYV_ENABLE_TAVILY_REG_SWEEP=1` only; default off |
| NSP/NYM best-outcome orchestrate | **Live** | Queen + RAG + citations + hallucination + memory + CoT for Legal Chat/draft (`NYV_NSP_COUNSEL_QUEEN=1` default). Hub web-search stays SLA-fast. |
| NSP comprehensive counsel format | **Live** | Headings Issue/Facts/Law/Analysis/Authorities/Risks/Next steps; env `NYV_LEGAL_COMPREHENSIVE` / `NYV_LEGAL_HEADING_COMPLETE`. Never invent citations. |
| Stored IRAC / Prayer attach | **Live** | `nv-legal-structure-attach` — orchestrator attaches stored IRAC or BNSS Prayer/Verification after the LLM; extract/search skip. Escape `NYV_LEGAL_STRUCTURE_ATTACH=0`. |
| Partner prompt aliases (voice copy-resend) | **Live** | NV-PARTNER-PROMPT-ALIAS-001 — `message`/`text`/`transcript`/STT envelope/`messages[]` → `prompt` on orchestrate + legal-chat `/send`. Deploy `2026-08-14T0950Z-aws-ssm`. |
| Partner legal model/token/RAG knobs | **Live** | Chat/research: Sonnet 5 then Opus 5; drafts keep Opus 5. Old→new statute mapping FAQs skip the LLM entirely (NYS compare, `model: nys-statute-map`). Deploy `2026-08-15T0946Z-aws-ssm`. |
| Old→new statute mapping fast path | **Live** | NV-STATUTE-MAP-FASTPATH-001 — IPC/CrPC/IRPC/IEA → BNS/BNSS/BSA answered from NYS knowledge plane, **no LLM**, 66–293ms. Escape `NYV_STATUTE_QA_GROUNDING=0`. |
| Ecosystem best-outcome (all NYV-dependent platforms) | **Live** | Same gates for NSI/NSA/NSM/NSPM/NYV; JRX selective; deploy `2026-08-03T1214Z-aws-ssm` |
| India-grade drafting (gateway + Queen) | **Live** | NV-LEGAL-DRAFT-BEST-001 — Bedrock-first + Gemini fallback for legal_drafting |
| Non-Legal domain packs (Cyber/BFSI/…) | **Not loaded** | Contract only — swap registry + RAG + seed later; Legal remains default GA |
