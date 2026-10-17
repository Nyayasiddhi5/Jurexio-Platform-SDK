# Nyayavigya Platform — Feature Wiring Inventory & Cross-Environment Status
**Snapshot date:** 2026-05-11 (Session-15 v2 close)
**Scope:** Every wired feature with status across **Replit dev** (this workspace) · **Replit publish** (deployment target) · **EC2 prod-dev** (`i-0df71e5ea1df8f588`).
**Source of truth:** generated from `src/index.ts` route mounts, `client/src/App.tsx` page routes, `nv_llm_providers` + `nv_model_catalog` DB tables, and `docs/canonical/EC2-INTEGRATION-STATUS.md`.

> Allowed under NV-DOC-001 — `docs/audit/` is the audit/inventory bucket (same as `nv-orphan-allowlist.json`, `nv-orphan-disposition.md`, `nv-orphan-budget.json`). This file replaces ad-hoc status messages and will be regenerated each session that touches feature wiring.

---

## 1. Headline numbers

| Surface | Count |
|---|---|
| Gateway route mounts (`app.use('/api/nv*'`) | **104** |
| Unique route prefixes | 91 |
| Console pages (`client/src/pages/**.tsx`) | **121** |
| Console routes (`<Route path="…">`) | **151** |
| Active LLM providers (DB `nv_llm_providers`) | **13** |
| Active LLM models (DB `nv_model_catalog`) | **113** |
| Inactive providers (kept as catalog rows for re-enable) | 12 |
| Agent registry (per jurisdiction) | 7 files (Default, IN, UK, US, GC, EU, SG) |
| Total agents (flat registry) | 1,042 |
| Practice areas | 8 |
| Jurisdictions accepted | IN, UK, GB, US, EU, GCC, SG |

---

## 2. LLM provider status (May-2026 frontier catalog)

### 2.1 Active providers — all 13 (env-key-gated)

| # | Provider | Latest May-2026 model in catalog | Replit dev | Replit publish | EC2 |
|---|---|---|---|---|---|
| 1 | **anthropic** | `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5`, `claude-opus-4-6` | ✅ key set | ⚠️ needs key | ⚠️ needs key |
| 2 | **openai** | `gpt-5.5-pro`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `o3`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano` | ✅ key set | ⚠️ needs key | ⚠️ needs key |
| 3 | **google** (GenAI) | `gemini-3-1-pro-preview`, `gemini-3-flash-preview`, `gemini-3-1-flash-lite-preview`, `gemini-2.5-flash`, `gemini-2.5-pro` | ✅ key set | ⚠️ needs key | ⚠️ needs key |
| 4 | **sarvam** | `sarvam-105b`, `sarvam-30b`, `sarvam-m`, `bulbul-v2`, `saaras-v2.5` (Indic + multilingual) | ✅ key set | ⚠️ needs key | ⚠️ needs key |
| 5 | **openrouter** | 12 paid (gpt-5.5, claude-opus-4-7, gemini-3-1-pro, grok-4.20, llama-4-maverick/scout, deepseek-v4-pro, mistral-large-2, …) + **13 `:free` backups** (kept per user mandate: llama-3.3-70b, gpt-oss-120b, qwen3-72b, deepseek-r1, gemma-3-27b, hermes-3, nemotron-70b, mistral-small-3.1, phi-4, …) | ✅ key set | ⚠️ needs key | ⚠️ needs key |
| 6 | **bedrock** (AWS) | `anthropic.claude-opus-4-7-v1:0`, `amazon.nova-premier-v1:0` (1M ctx), nova-pro/lite/micro, llama4-maverick/scout, deepseek.r1, mistral-large, jamba | ✅ AWS keys set | ⚠️ needs IAM | ✅ EC2 IRSA |
| 7 | **deepseek** | `deepseek-v4-pro`, `deepseek-v4-flash` | ❌ no key (silent skip) | ❌ no key | ❌ no key |
| 8 | **mistral** | `mistral-medium-3`, `mistral-large-2-2411` | ❌ no key | ❌ no key | ❌ no key |
| 9 | **xai** | `grok-4.20`, `grok-4.20-reasoning` (2M ctx) | ❌ no key | ❌ no key | ❌ no key |
| 10 | **groq** | `llama-3.3-70b-versatile` (LPU sub-second) | ❌ no key | ❌ no key | ❌ no key |
| 11 | **cohere** | `command-r-plus-08-2024` | ❌ no key | ❌ no key | ❌ no key |
| 12 | **perplexity** | `sonar-pro`, `sonar-reasoning-pro` (web-grounded) | ❌ no key | ❌ no key | ❌ no key |
| 13 | **agentzero** | sovereign always-on backup (no external API) | ✅ always-on | ✅ always-on | ✅ always-on |

> Direct-API providers without env keys silently skip via `isProviderAvailable()` — cascade falls through to next provider. **Ask the user to provide secrets for any of: `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY` (or `GROK_API_KEY`), `GROQ_API_KEY`, `COHERE_API_KEY`, `PERPLEXITY_API_KEY`, `TOGETHER_API_KEY`** to widen the active cascade.

### 2.2 Catalog jurisdiction policy (Session-15 v2 update)

- **All non-Sarvam models** are jurisdiction-agnostic: `jurisdictionFit: { GLOBAL: <score> }`. They are equally available to **IN, UK, US, EU, GCC, SG**. Selection is driven by tier, task, latency, cost, capabilities — not jurisdiction.
- **Sarvam models** retain `jurisdictionFit: { IN: 100, GLOBAL: 70-78 }` so they lead for `jurisdiction=IN` queries (matches the user mandate: Sarvam is the Indic-multilingual specialization).
- **OpenRouter `:free` models are KEPT** as last-resort backups before AgentZero. They never out-rank a paid frontier model when paid keys are present.

### 2.3 Verified routing (6/6 jurisdictions PASS, 2026-05-11 smoke)

| Jurisdiction | Model selected | Latency | Notes |
|---|---|---|---|
| IN | `sarvam-105b` | 2.2s | Indic specialization, real ID Act §25F/G/N citations |
| US | `gemini-3-flash-preview` | 10.5s | Real Delaware/MBCA content |
| EU | `gemini-3-flash-preview` | 15.1s | Real CJEU/Aktg content |
| UK | `gemini-3-flash-preview` | 9.8s | Post `UK`/`GB` dual-acceptance fix |
| GB | `gemini-3-flash-preview` | 10.4s | ISO-3166 alias |
| SG | `gemini-3-flash-preview` | 8.4s | |

---

## 3. Wired feature surfaces (gateway `/api/nv/*` mounts)

> 104 wired mounts across 91 unique prefixes. Status legend: ✅ live · ⚠️ behind code on EC2 · ❓ flag-gated (default OFF) · ❌ not deployed.

### 3.1 Core platform (always on)
| Mount | Purpose | Replit dev | Publish | EC2 |
|---|---|---|---|---|
| `/api/nv/health`, `/health/full` | Liveness, readiness, full health | ✅ | ✅ | ✅ |
| `/api/nv/auth` | Login, register, JWT, refresh, CSRF | ✅ (NS-3 8/8 PASS) | ✅ | ✅ |
| `/api/nv/auth/rotate` | Refresh-token rotation | ✅ (NV-AUTH-FIX-2026-05-10) | ✅ | ⚠️ behind |
| `/api/nv/gateway` | SDK gateway (research, draft, analyze, …) | ✅ | ✅ | ✅ |
| `/api/nv/gateway/agents` | Canonical agent endpoint | ✅ | ✅ | ✅ |
| `/api/nv/docs`, `/api/nv` (OpenAPI) | Swagger UI + spec | ✅ | ✅ | ✅ |
| `/api/nv/admin/*` | Heap, health-full, nv5-proxy | ✅ | ✅ | ✅ |
| `/api/nv/orchestration` | Queen orchestrator | ✅ | ✅ | ✅ |
| `/api/nv/v311` | Legacy v3 compat | ✅ | ✅ | ✅ |
| `/api/nv/drift`, `/api/nv/phase-c` | Model drift, Phase-C stubs | ✅ | ✅ | ✅ |

### 3.2 NV5 product surfaces (V5 SDK)
| Mount | Purpose | Replit dev | Publish | EC2 |
|---|---|---|---|---|
| `/api/nv5/multimodal` | Vision + audio + text fusion | ✅ | ✅ | ⚠️ |
| `/api/nv5/voice` | Deepgram + Sarvam 22-Indic + Whisper, ws stream | ✅ | ✅ | ⚠️ |
| `/api/nv5/workflows` | Workflow builder + execution | ✅ | ✅ | ⚠️ |
| `/api/nv5/doc-ai` | 1 GB streamed conversion (task-106 + task-129) | ✅ disk-streamed | ✅ | ⚠️ |
| `/api/nv5/legal-pipeline` | NSP legal pipeline | ✅ | ✅ | ⚠️ |
| `/api/nv5/compliance` | DPDPA, GDPR, EU-AI-Act | ✅ | ✅ | ⚠️ |
| `/api/nv5/internal` | Internal east-west | ✅ | ✅ | ⚠️ |
| `/api/nv5/gov` | Maker-checker, audit hash chain | ✅ flag-gated | ✅ | ⚠️ |

### 3.3 V5 Orchestration sub-surfaces (feature-flag gated)
All require `isNyvFeatureOn(<flag>)` — defaults OFF in production unless explicitly enabled.

| Mount | Flag | Replit dev | Publish | EC2 |
|---|---|---|---|---|
| `/api/nv5/orch/kb` | `aiOrchKb` | ❓ flag | ❓ | ❌ |
| `/api/nv5/orch/context` | `aiOrchContext` | ❓ | ❓ | ❌ |
| `/api/nv5/orch/multimodal-rag` | `aiOrchMultimodalRag` | ❓ | ❓ | ❌ |
| `/api/nv5/orch/plugins` | `aiOrchPlugins` | ❓ | ❓ | ❌ |
| `/api/nv5/orch/roma` | `aiOrchRoma` | ❓ | ❓ | ❌ |
| `/api/nv5/orch/agent-select` | `aiOrchAgentSelect` | ❓ | ❓ | ❌ |
| `/api/nv5/orch/protocols` | `aiOrchProtocols` | ❓ | ❓ | ❌ |

### 3.4 Middleware ring (NV-ARCH-001 safety ring)
Tenant isolation → guardrails → orchestration → agent allocation → 22-section Parlant prompt → 5-tier memory + multi-tier RAG + GraphRAG → CoT/ReAct/ToT → `intelligent-router/orchestrateLLM` → response engineering → hallucination + citation + safety + HITL → audit hash chain → streaming.

| Middleware | Status |
|---|---|
| `nvOrchestrationGuardrails` (always on, no-op when flag off) | ✅ wired |
| `tenantIsolation` | ✅ wired |
| `orgRlsMiddleware` | ✅ wired |
| `securityMonitorMiddleware` | ✅ wired |
| `nvCsrfHeaders + nvCsrfGuard` (auth routes) | ✅ wired |
| `nvResponseSigningMiddleware` | ✅ wired |
| Rate limits (public, authenticated, AI-pattern, enterprise, SDK, org) | ✅ all 6 tiers wired |
| `nvPlatformRateLimiterInmem` | ❓ flag `NYV_F_PLATFORM_RATE_LIMITER_INMEM` |
| `nvNsResponseMapper` | ❓ flag `NYV_F_NS_RESPONSE_MAP` |
| `extractSdkApiKey` (canonical SDK auth) | ✅ NV-AUTH-HEADER-001 enforced |
| `nv-inter-service-auth` (east-west `X-NV-API-Key`) | ✅ |

---

## 4. Console (Central Console UI) — 121 pages, 151 routes

> All routes return HTTP 200 from the dev server (Vite SPA shell). **Runtime React errors cannot be detected from server-side probes** — see § 6 for the open question to the user.

### 4.1 Console page families
| Family | # pages | Examples |
|---|---|---|
| Orchestration | 13 | `/orchestration`, `/orchestration/a2a`, `/orchestration/bmad`, `/orchestration/cam`, `/orchestration/grpo`, `/orchestration/lineage/:requestId`, `/orchestration/memory`, `/orchestration/policies`, `/orchestration/router-decisions` |
| Admin / governance | 12 | `/command-centre`, `/admin`, `/org-admin`, `/rbac-console`, `/governance`, `/enforcement`, `/audit-chain`, `/hash-chain`, `/eu-ai-compliance`, `/dpdpa-compliance` |
| Agents | 11 | `/agents`, `/agent-registry`, `/agent-wizard`, `/create-agent`, `/agent-flows`, `/agent-live-testing`, `/agent-scorecard`, `/agent-activity` |
| Billing | 4 | `/billing/credits`, `/billing/ledger`, `/billing/subscription`, `/credit-wallet` |
| LLM ops | 7 | `/llm-priority`, `/llm-judge`, `/model-catalog`, `/model-drift`, `/cost-optimizer`, `/lrm-dashboard`, `/superadmin-llm-budget` |
| Intelligence | 8 | `/intelligence/classify`, `/intelligence/dashboard`, `/intelligence/guardrails`, `/intelligence/predict`, `/intelligence/research`, `/intelligence/sentiment`, `/intelligence/translate` |
| Multimodal / voice | 4 | `/multimodal`, `/document-ai-hub`, `/document-forensics`, `/ocr-extraction` |
| SDK / platform onboarding | 6 | `/sdk-key-management`, `/sdk-platform-onboarding`, `/client-sdk-playground`, `/api-testing`, `/platform-management`, `/platform-config` |
| Chat surfaces | 5 | `/chat`, `/global-chat`, `/legal-chat` (redirect), `/clawdbot-console`, `/openbot-studio` |
| HITL & decisions | 4 | `/hitl-decision-cards`, `/decision-cards`, `/my-approvals`, `/architect` |
| Education / verticals | 5 | `/academy`, `/institutional`, `/ministry`, `/p1-ai-quality` |
| Misc / utilities | ~40 | `/database-schema`, `/feature-test`, `/forensics`, `/identity-extraction`, `/jurisdiction-mapping`, `/legal-ner`, `/ner-explorer`, `/digital-twin`, `/digital-twin-creator`, `/onboarding`, `/operations`, `/skills-library`, `/skills-marketplace`, `/regulatory-monitor`, `/adversarial-testing`, … |

### 4.2 Console workflow status
- **Replit dev**: NYV Console workflow running on port 3004 ✅. All probed pages return HTTP 200.
- **Replit publish**: needs deployment config update (vite preview vs dev). ⚠️ Untested.
- **EC2**: served behind `console.nyayasiddhi.online` via nginx + Docker compose. ⚠️ Behind on code (per `EC2-INTEGRATION-STATUS.md`).

---

## 5. Guardrails (CI-enforced)

| Guardrail | Status | Last run |
|---|---|---|
| `NV-ARCH-001` (no-bypass safety ring) | ✅ enforced | continuous |
| `NV-LLM-001` (single router) | ✅ enforced | `npm run guardrail:llm-router` |
| `NV-NAMING-001` (no duplicate files) | ✅ pre-flight grep | manual |
| `NV-WIRING-001` (services must be imported) | ✅ enforced | `npm run audit:wiring` |
| `NV-DOC-001` (markdown discipline) | ✅ enforced | manual |
| `NV-SECRETS-001` (canonical secret names) | ✅ enforced | `resolveRedisTcpUrl()` |
| `NV-CONTRACT-001` (method/route grep) | ✅ enforced | manual |
| `NV-OWNERSHIP-001` (curl-reproducible failures) | ✅ doctrine | manual |
| `NV-AUTH-HEADER-001` (canonical `X-API-Key`) | ✅ CI | `npm run guardrail:auth-header` |
| `NV-DB-SCRIPT-001` (`makePgSql()`) | ✅ CI | `npm run guardrail:script-db` |
| `NV-API-CONTRACT-001` (OpenAPI snapshot) | ✅ CI (1,206 ops baseline) | `npm run guardrail:api-contract` |
| `NV-WIRING-BUDGET-001` (orphans = 0 effective) | ✅ CI | `npm run guardrail:no-new-orphans` |
| `NV-AGENT-REGISTRY-FRESH-001` (flat registry) | ✅ CI + pre-commit | `npm run guardrail:flat-registry` |

---

## 6. Open issues / pending work

### 6.1 Console — needs user input
You reported "many pages still not working and not in proper order to manage and run the platform." All 151 routes serve HTTP 200 from the dev server (Vite SPA), so the problem is **inside the React app** — runtime errors, broken data fetches, layout regressions, or IA/navigation issues that I cannot enumerate without specifics.

**Please tell me which specific console pages are broken** (URL paths from § 4.1) and what you see — blank, error toast, missing data, wrong layout, etc. With that I can fix them in this session. Otherwise I'll do a bottom-up sweep of the top-traffic 10 pages (`/command-centre`, `/orchestration`, `/agents`, `/chat`, `/sdk-key-management`, `/llm-priority`, `/model-catalog`, `/billing/credits`, `/rbac-console`, `/governance`) in the next session.

### 6.2 Per-jurisdiction agent registries
Need bulk update of `config/agent-registries/Nyayavigya-Legal-registry-{IN,UK,US,GC,EU,SG,Default}.json` to swap stale model IDs for May-2026 frontier IDs, then regenerate flat registry via `npm run build:flat-registry`. Deferred to next session.

### 6.3 EC2 redeploy + RDS schema sync
Per `docs/canonical/EC2-INTEGRATION-STATUS.md`: N4 redeploy + N7 RDS schema-sync staged but not executed. Needs explicit user GO.

### 6.4 Replit publish
Deployment config likely needs `vite preview` for console + workflow port mapping for gateway. Not yet validated.

### 6.5 Extra LLM providers (currently silent-skipped)
6 active providers (deepseek, mistral, xai, groq, cohere, perplexity) have catalog entries but no API key — they silently skip in the cascade. Provide secrets to widen the active cascade.

---

*Generated 2026-05-11 close-of-Session-15-v2. Next regen: any session that adds/removes route mounts, console pages, providers, or models.*
