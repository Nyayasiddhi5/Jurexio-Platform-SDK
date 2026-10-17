---
status: superseded
version: v5.0.0
superseded_by: docs/v3.1.2/pending_implementation_docs/uat/NYV-UAT-v3.2-COMPREHENSIVE.md
last_verified: 2026-04-25
---
# Nyayavigya SDK 5.0.0 — Comprehensive UAT Document

**Document ID:** NYV-UAT-312-001
**Platform:** Nyayavigya 3.1.2 (FROZEN) | **SDK:** v5.0.0
**Audience:** QA, Partner Onboarding, Ecosystem Engineering (NYM, NYS-PRO, NYS-INS, NYS-ACE, NYS-MIN)
**Sign-off Owner:** Head of Engineering · Head of Compliance · Head of Product
**Date:** April 21, 2026

This is the master User Acceptance Test plan for promoting Nyayavigya from staging to GA. It covers the SDK lifecycle (init → integrate → use → secure → operate), every public API surface, every agentic pattern, every jurisdiction, multi-modal and multi-lingual flows, voice, RAG, GRPO, document automation, observability and chain-of-thought verification. It is structured so a tester can sign off section by section.

---

## 0. Sign-off Matrix (executive summary)

| Block | TC range | Sections | Owner | Pass criterion |
|---|---|---|---|---|
| A. SDK lifecycle | UAT-A-01 → UAT-A-12 | §3 | Partner Eng | All P0 pass, ≥ 95 % P1 pass |
| B. REST API | UAT-B-01 → UAT-B-58 | §4 | Backend QA | All P0 pass, ≥ 95 % P1 pass |
| C. 22 Patterns | UAT-C-01 → UAT-C-22 | §5 | AI QA | All P0 pass |
| D. RAG family | UAT-D-01 → UAT-D-12 | §6 | AI QA | All P0 pass |
| E. Document AI | UAT-E-01 → UAT-E-15 | §7 | AI QA | All P0 pass |
| F. Voice / Multi-lingual / Multi-modal | UAT-F-01 → UAT-F-18 | §8 | Voice QA | All P0 pass |
| G. Memory & Context | UAT-G-01 → UAT-G-10 | §9 | AI QA | All P0 pass |
| H. Compliance & Security | UAT-H-01 → UAT-H-22 | §10 | Compliance | 100 % pass — gate |
| I. Multi-jurisdiction | UAT-I-01 → UAT-I-06 | §11 | Legal SME | 100 % pass — gate |
| J. Algorithm verification (ALG-01..08) | UAT-J-01 → UAT-J-08 | §12 | AI QA | 100 % pass |
| K. Performance & Scale | UAT-K-01 → UAT-K-10 | §13 | DevOps | All NFR met |
| L. Observability & Logging | UAT-L-01 → UAT-L-08 | §14 | DevOps | All P0 pass |
| M. End-to-end ecosystem flows | UAT-M-01 → UAT-M-10 | §15 | Ecosystem | All P0 pass |

**Pass thresholds:** P0 = 100 %, P1 ≥ 95 %, P2 ≥ 90 %.

---

## 1. Test environments

| Env | Purpose | Base URL | Auth | DB | LLM keys |
|---|---|---|---|---|---|
| Local dev | Engineer loop | `http://localhost:5000` | `NV_API_KEY` (dev) | Local Neon | `OPENROUTER_API_KEY` only |
| Replit dev (public) | Live preview, partner sandbox | `https://<repl-id>.pike.replit.dev` | dev key | Local Neon | `OPENROUTER_API_KEY` |
| Staging | UAT | `https://api-staging.nyayavigya.in` | `nyv_test_sk_…` | Neon Pro | OpenAI + Anthropic + OpenRouter |
| Production | Customer | `https://api.nyayavigya.in` | `nyv_live_sk_…` | RDS / Neon Pro | All providers |

All testers must run **every block** against staging at minimum.

---

## 2. Authentication preconditions for all tests

* Inter-service / SDK key:
  ```
  Authorization: Bearer <NV_API_KEY>
  ```
  (legacy alias `X-NSP-Inter-Secret: <secret>` is also accepted for backward-compat).

* Required headers per Nyayamitra Integration Contract v1:
  ```
  Authorization: Bearer <NV_API_KEY>
  X-Client-ID: <consumer-platform>          # nyayamitra | nys-pro | nys-ins | nys-ace | nys-min
  X-Correlation-ID: <uuid v4>
  X-NSP-Tier: citizen | solo | plus | pro | enterprise | government | internal
  X-NSP-Jurisdiction: IN | UK | US | EU | GC | SG
  Content-Type: application/json
  ```

* JWT (end-user): `Authorization: Bearer <user-JWT>` to gateway → gateway verifies and forwards.

---

## 3. Block A — SDK lifecycle (init → use → secure)

> Covers `@nyayavigya/client-sdk`, `@nyayavigya/react-hooks`, `@nyayavigya/enterprise-sdk`, plus the new `sdk/nyayamitra-sdk` (Nyayamitra contract SDK shipped Apr 21).

### UAT-A-01 — npm install (P0)
**Steps:**
1. `npm install @nyayavigya/client-sdk@5.0.0-alpha.1`
2. `npm install @nyayavigya/react-hooks@5.0.0-alpha.1`
3. `npm install @nyayavigya/enterprise-sdk@5.0.0-alpha.1`

**Expected:** All four packages install with zero peer-dep warnings. Tarballs ≤ 50 KB, 12 KB, 30 KB, 8 KB respectively.

### UAT-A-02 — TypeScript types resolution (P0)
**Steps:**
1. `import { NyvClient } from '@nyayavigya/client-sdk'` in a strict-mode TS project.
2. Hover over `NyvClient` → see all 12 API class members.

**Expected:** No `any` leaks, every method has typed input + output (Nyv-prefixed interfaces from `@nyayavigya/types`).

### UAT-A-03 — Single-click app creation (P0)
```
POST /api/nv/sdk/create-app
Authorization: Bearer <jwt_token>
{
  "name": "uat-app",
  "platform_type": "professional",
  "tier": "pro",
  "jurisdiction": "IN",
  "contact_email": "qa@nyayavigya.test",
  "modules": { "nyayarag": true, "doc_intelligence": true, "automateai": true, "hitl": true, "sdk_intelligence": true }
}
```
**Expected (201):**
* `api_key` matches `^nyv_(live|test)_sk_[A-Za-z0-9]{40,}$`
* `provision_status: "ready"`
* `quickstart.base_url` returned

### UAT-A-04 — SDK provision handshake (P0)
```
POST /api/nv/sdk/provision
Authorization: Bearer nyv_live_sk_...
{ "platform_id": "uat-app", "platform_type": "professional", "sdk_version": "5.0.0", "runtime": "node-22", "reported_env": "production" }
```
**Expected:** `provision_status: "ready"`, `modules_enabled` matches what was requested in A-03, `rate_limits.requests_per_min = 60` (Pro), `agents.total = 149`.

### UAT-A-05 — Init `NyvClient` and call `ask()` (P0)
```ts
const nyv = new NyvClient({ apiKey: process.env.NV_KEY!, baseUrl: 'https://api-staging.nyayavigya.in', defaultPlatform: 'nys-professional' });
const r = await nyv.ask('Explain BNS 2023 Section 103 with case law.');
```
**Expected:** `r.text.length > 200`, `r.citations.length >= 1`, `r.governance.riskScore <= 0.3`, latency p50 ≤ 5 s.

### UAT-A-06 — Stream pattern (AG-UI SSE) (P0)
```ts
await nyv.stream.streamPattern('cot', { task: 'Analyze force majeure under Indian law', jurisdiction: 'IN' }, {
  onThinking: (s, i, total) => log(`step ${i}/${total}`),
  onTextDelta: d => write(d),
  onComplete: r => log(r.traceId),
});
```
**Expected:** at least one `onThinking` call before any `onTextDelta`; `onComplete` carries `traceId` (UUID).

### UAT-A-07 — React hook usage (P0)
Render the example in `NYV-SDK-RELEASE-PLAN.md §3.4`. Click "Research" → governance badge updates, thinking steps render, content streams, credit balance decrements by 3.

### UAT-A-08 — Enterprise SDK (billing) (P1)
```ts
import { Billing } from '@nyayavigya/enterprise-sdk/billing';
const b = new Billing({ apiKey });
const wallet = await b.getWallet();
```
**Expected:** wallet returns `{balance:number, currency:'INR'|'USD', tier:'pro'|...}`.

### UAT-A-09 — Nyayamitra contract SDK init (P0)
```ts
import { NyayamitraClient } from '../../sdk/nyayamitra-sdk';
const sdk = new NyayamitraClient(); // env-driven
```
**Expected:** Throws `NV API Key missing. Set NV_API_KEY or NV_INTER_SERVICE_SECRET` if neither env var set; otherwise constructs without error.

### UAT-A-10 — Nyayamitra SDK three methods (P0)
Run `sdk/nyayamitra-sdk/examples.ts` against staging. **Expected:**
* `sendChatMessage` returns `{success:true, data:{ message: string }}` with no disclaimer in `message`.
* `analyzeDocument` returns `{success:true, data:{ quickSummary, riskScore, riskLabel, clauseExplanations[], recommendations[] }}`.
* `generateCaseBrief` returns `{success:true, data:{ summary, severity, score, recommendedActions[], applicableLaws[], timeline[] }}`.

### UAT-A-11 — Key rotation (P0)
```
POST /api/nv/sdk/console/apps/:appId/rotate-secret
```
**Expected:** new key returned, old key remains valid for 24 h, then 401.

### UAT-A-12 — Suspend / revoke (kill-switch) (P0)
1. `POST /api/nv/sdk/console/apps/:appId/suspend` → all subsequent SDK calls return **403** with `code:"APP_SUSPENDED"`.
2. `POST .../activate` → restored.
3. `POST .../revoke` → permanent **403**, key cannot be re-activated.

---

## 4. Block B — REST API surface (≈ 79 gateway + 4 provision + 18 console + 10 portal endpoints)

For every endpoint below, baseline checks:
* **200/201** on happy path with valid auth and tier.
* **401** without auth.
* **403** with insufficient tier (e.g. Free trying to call AutomateAI).
* **422** with a malformed body (validation works).
* **429** with rate limit exhausted (RPM and RPD).
* `X-Request-ID` echoed on every response.
* `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` populated.

### B.1 Health & meta
| TC | Method | Path | Expected |
|---|---|---|---|
| B-01 | GET | `/health` (alias) | 200, `status:"healthy"` |
| B-02 | GET | `/api/nv/health` | 200, version `v3.1.2`, services map |
| B-03 | GET | `/api/nv/health/full` | 200, may be `degraded` if Redis high-latency (acceptable in staging only) |
| B-04 | GET | `/api/nv/docs` | 200, Swagger UI |
| B-05 | GET | `/api/nv/docs/swagger.json` | 200, `openapi: "3.0.3"`, `info.version: "5.0.0"` |
| B-06 | GET | `/api/nv/agents` | 401 without auth, 200 with auth — list includes 1,043 entries (paginated) |
| B-07 | GET | `/api/nv/models` | 200 — 23 providers, 15 models seeded |
| B-08 | GET | `/api/nv/jurisdictions` | 200 — `IN, UK, US, EU, GC, SG` |
| B-09 | GET | `/api/nv/flags` | 200 — feature flags map |
| B-10 | GET | `/api/nv/versions` | 200 — `{platform:"3.1.2", sdk:"5.0.0"}` |

### B.2 Auth
| TC | Method | Path | Sample request | Expected |
|---|---|---|---|---|
| B-11 | POST | `/api/nv/auth/login` | demo creds | 200 with JWT + refresh |
| B-12 | POST | `/api/nv/auth/refresh` | refresh token | 200 with new JWT |
| B-13 | POST | `/api/nv/auth/logout` | JWT | 204 |
| B-14 | POST | `/api/nv/auth/rotate` | admin JWT | 200, JWT secret rotated, monitor confirms |

### B.3 Orchestration (the core)
| TC | Method | Path | Expected |
|---|---|---|---|
| B-15 | POST | `/api/nv/orchestrate` (alias) and `/api/nv/orchestration/orchestrate` | 200 happy path; both routes serve the same handler |
| B-16 | POST | `/api/nv/orchestrate` with `agentKey:"mitra-conversational"` | response stripped of legal disclaimer; backend appends one |
| B-17 | POST | `/api/nv/orchestrate` with `agentKey:"clause-classifier"` | response is **strict JSON** matching contract §5; if model returns prose, strict-retry kicks in once; second failure → fail-closed envelope `{success:false, error:{code:"INVALID_JSON",…}}` |
| B-18 | POST | `/api/nv/orchestrate` with `agentKey:"case-brief-generator"` | strict JSON envelope, `mitra_score` mapped to `score` in SDK |

### B.4 SDK gateway / provisioning
B-19 → B-26 cover `/api/nv/sdk/create-app`, `/sdk/provision`, `/sdk/console/apps`, `/sdk/console/apps/:id`, `/sdk/console/apps/:id/{suspend,activate,revoke,rotate-secret}`, `/sdk/console/apps/:id/usage`. Verify all 18 endpoints listed in `NYV-SDK-RELEASE-PLAN.md §6.4`.

### B.5 Agents & patterns
B-27 → B-29 — `/api/nv/agents`, `/api/nv/agents/:id`, `/api/nv/agents/:id/execute`, `/api/nv/agents/:id/stream`.
B-30 → B-51 — `/api/nv/patterns/{cot,react,tot,reflection,plan-execute,refine,maker-checker,tool-retry,function-router,mcp-chain,nyayarag,graphrag,mem0,semantic-cache,hta,swarm,aconic,moat,adapt,computer-use,grpo,digital-twin}`. (covered in detail in Block C.)

### B.6 Documents
B-52 → B-54 — `/api/nv/documents/upload`, `/api/nv/documents/:id`, `/api/nv/documents/:id/jobs`. Verify async polling.

### B.7 Memory / Knowledge
B-55 → B-58 — `/api/nv/memory/store`, `/recall`, `/erase`, `/api/nv/knowledge/search`.

---

## 5. Block C — 22 Agentic patterns (P01–P22)

For each pattern, the baseline test:

```
POST /api/nv/patterns/<slug>
Authorization: Bearer <key>
{ "task": "<pattern-appropriate task>", "jurisdiction": "IN", "tier": "pro" }
```

| TC | Pattern | Slug | Task example | Pattern-specific expectations |
|---|---|---|---|---|
| C-01 | ReAct | `react` | "Find the latest BNS section that replaces IPC 302" | response includes `thoughts[]` and `actions[]` |
| C-02 | Chain-of-Thought | `cot` | "Analyze force majeure clause in IT services agreement" | `thinking[]` ≥ 3 steps; final answer references at least one step |
| C-03 | Tree-of-Thought | `tot` | "Explore 3 strategies for bail under BNSS §483" | `branches[]` ≥ 2; one marked `selected:true` |
| C-04 | Reflection | `reflection` | "Critique this NDA snippet" | response has `draft`, `critique`, `revised` |
| C-05 | Plan + Execute | `plan-execute` | "Draft an SPA outline" | response has `plan[]` then `executions[]` |
| C-06 | Refine | `refine` | "Improve this consumer complaint" | iterations ≥ 2, final passes readability scorer |
| C-07 | Maker-Checker | `maker-checker` | "Draft and review a sale-deed clause" | both maker + checker outputs returned |
| C-08 | Tool-Retry | `tool-retry` | calls a tool that fails once | retry count = 1, eventual success |
| C-09 | Function-Router | `function-router` | mixed-domain question | `selected_function` + reason returned |
| C-10 | MCP-Chain | `mcp-chain` | "Query Supreme Court via MCP, then summarise" | ≥ 2 MCP tool calls in response.trace |
| C-11 | NyayaRAG | `nyayarag` | "Cite recent case on Section 138 NI Act" | citations include `case_id`, `court`, `year` |
| C-12 | GraphRAG | `graphrag` | "Show statute relationships for BNS 103" | `graph.nodes` and `graph.edges` populated |
| C-13 | Mem0 | `mem0` | follow-up to a prior session | recalls L1–L3 memory |
| C-14 | Semantic-Cache | `semantic-cache` | run same query twice | second response served `from_cache:true`, latency < 200 ms |
| C-15 | HTA | `hta` | "Plan an M&A due diligence" | hierarchical task tree returned |
| C-16 | Swarm | `swarm` | "Multi-agent litigation prep" | swarm trace shows ≥ 3 agent IDs interacting; one of 107 topologies recorded |
| C-17 | ACONIC | `aconic` | exploratory search | `branches[]` and `confidence_curve[]` returned |
| C-18 | MOAt | `moat` | adversarial Q&A | response includes attack vectors considered |
| C-19 | ADaPT | `adapt` | dynamic refinement | adaptation steps recorded |
| C-20 | Computer-Use | `computer-use` | "Open NJDG, read case status" | tool calls show DOM/HTTP actions; result fields populated |
| C-21 | GRPO | `grpo` | training-style task | `grpo.score`, `dimensions[]` (7 dims) populated |
| C-22 | Digital-Twin | `digital-twin` | "Simulate hostile takeover defense" | Monte Carlo `iterations` ≥ 100, `outcome_distribution` returned |

**Cross-cutting expectation:** every pattern response includes `traceId`, `model_used`, `tokens_used`, `cost_usd`, `governance{riskScore, hallucination, biasFlags}`, `latency_ms`. None contain raw PII (validate via PII pattern check).

---

## 6. Block D — RAG family

| TC | Service | Endpoint | Test scenario | Expected |
|---|---|---|---|---|
| D-01 | NyayaRAG | `POST /api/nv/rag/query` | "BNS 2023 §103 vs IPC §302" | citations include both statutes; relevance ≥ 0.85 |
| D-02 | GraphRAG | pattern `graphrag` | "Map case-law graph for Section 138 NI Act" | response.graph has ≥ 5 nodes |
| D-03 | LightRAG | `POST /api/nv/rag/light` | quick query | latency p50 ≤ 1.5 s |
| D-04 | Adaptive RAG | `POST /api/nv/rag/adaptive` | ambiguous query | router selects strategy; reason returned |
| D-05 | Corrective RAG | `POST /api/nv/rag/corrective` | inject bad context | service rewrites the query and re-fetches |
| D-06 | Self-RAG | `POST /api/nv/rag/self` | open-ended question | retrieval reflection trace recorded |
| D-07 | Entity merger | `POST /api/nv/rag/entities/merge` | duplicates with different spellings | merged into canonical entity |
| D-08 | Reranker (RRF + COLIEE + MMR) | internal | top-20 candidates | top-5 rerank score increases vs raw |
| D-09 | Embedding model auto-select | internal | small text vs long text | service picks short-context vs long-context model |
| D-10 | Embedding fallback when InLegalBERT down | internal | force `INLEGAL_BERT_URL` unset | falls back, no exception |
| D-11 | Qdrant adapter | switch `VECTOR_STORE=qdrant` | run RAG query | results identical schema to pgvector path |
| D-12 | Citation grounding (L2) | testing framework | claim that has no source | service flags ungrounded; HITL queued |

---

## 7. Block E — Document intelligence & OCR

| TC | Capability | Test |
|---|---|---|
| E-01 | Async upload + job poll | upload 5 MB PDF → `POST /api/nv/documents/upload` → poll `/jobs` until `status:"complete"` ≤ 60 s |
| E-02 | OCR happy path (PDF text-layer) | `extracted_text.length > 0`, `pages` reflects original |
| E-03 | OCR fallback to GPT-4o Vision | scanned-image PDF; `provider:"gpt4o-vision"` reported |
| E-04 | Recursive legal chunker (ALG-03) | check `chunks[]` boundary at clause/section level |
| E-05 | Type-aware chunking respects schedules / annexures | annexure preserved as single chunk |
| E-06 | Hierarchical summarizer (ALG-06) | `summary.l1, l2, l3` returned |
| E-07 | Citation verification (ALG-07) | bogus citation → `verified:false`, real citation → `verified:true` |
| E-08 | Clause classification | NDA → at least Confidentiality, Term, Non-Solicit, IP clauses identified |
| E-09 | Contract analysis v2 | risk score returned, top-3 risks listed |
| E-10 | Compare contract A vs B | redline diff + clause-by-clause table |
| E-11 | PDF/A export | output passes a PDF/A validator |
| E-12 | Watermarking | watermark visible + detectable by `nyaya-tools/forensic` |
| E-13 | eSign adapter | sign request returns provider + signing_url |
| E-14 | NER v2 (parties, dates, amounts) | recall ≥ 0.9 on a labelled fixture set |
| E-15 | PII redaction in document text | PAN / Aadhaar / phone numbers masked before storage |

---

## 8. Block F — Voice / Multi-lingual / Multi-modal

| TC | Capability | Test |
|---|---|---|
| F-01 | Language router lists 47 langs | `GET /api/nv/i18n/languages` |
| F-02 | TTS hi-IN | `POST /api/nv/voice/tts {text, language:"hi-IN"}` returns audio MP3 ≥ 1 KB |
| F-03 | TTS ta-IN, te-IN, mr-IN, kn-IN, ml-IN, gu-IN, bn-IN, pa-IN, ur-IN, or-IN, as-IN | each returns audio |
| F-04 | TTS en-GB, en-US, ar-AE, fr-FR | each returns audio |
| F-05 | STT hi-IN (Sarvam) | upload 10 s WAV → transcript with WER ≤ 0.15 on a clean fixture |
| F-06 | STT en-IN (Deepgram Nova-2) | WER ≤ 0.10 on clean fixture |
| F-07 | STT legal-vocab boost | "BNSS section four eighty three" → "BNSS §483" recognised |
| F-08 | Voice WebSocket `/ws/voice` connect | upgrade succeeds, ping-pong works |
| F-09 | Voice chat full duplex | speak → STT → orchestrate → TTS streams back; round-trip p50 ≤ 4 s |
| F-10 | Speaker diarization (≥ 2 speakers) | `segments[].speaker` populated |
| F-11 | Multi-modal: image + text | upload contract image with text "find indemnity clause" → orchestrate returns text grounded in image |
| F-12 | Multi-modal: PDF + question | doc Q&A with citations to pages |
| F-13 | Multi-modal: video frame extraction (key frames) | optional path validated |
| F-14 | i18n response: query in Hindi → answer in Hindi | jurisdiction `IN`, language auto-detected |
| F-15 | i18n response: query in Tamil | answer in Tamil with English statute names preserved |
| F-16 | Translate via Sarvam | `POST /api/nv/translate {text, src:"en", tgt:"hi"}` |
| F-17 | Voice fallback to text on poor audio | server returns reason `LOW_SNR`, advises retry |
| F-18 | Voice billing | TTS minute = 3 credits, STT minute = 2 credits, deducted from wallet |

---

## 9. Block G — 5-tier memory & context engineering

| TC | Tier | Test |
|---|---|---|
| G-01 | L1 Context | within one session, follow-up uses prior context |
| G-02 | L2 Matter | same `matter_id` across sessions recalls matter facts |
| G-03 | L3 Client | client preferences (tier, jurisdiction) persisted |
| G-04 | L4 Jurisdictional | shared statutory updates surface in queries |
| G-05 | L5 Precedent | prior reasoning chains reused to bias retrieval |
| G-06 | Right-to-erasure (DPDPA) | `DELETE /api/nv/memory/user/:id` cascades L1–L5 |
| G-07 | Semantic dedup | inserting same fact twice → 1 stored entry |
| G-08 | Memory recall | `/api/nv/memory/recall` returns ranked results with tier provenance |
| G-09 | Context engineering pipeline | response trace shows compression + ranking |
| G-10 | Memory cap enforcement | exceeding tier quota returns 422 with `code:"MEMORY_QUOTA_EXCEEDED"` |

---

## 10. Block H — Compliance & Security

| TC | Item | Test | Pass |
|---|---|---|---|
| H-01 | DPDPA consent token enforced | call without valid consent → 403 `CONSENT_REQUIRED` | ✓ |
| H-02 | GDPR portability | export user data — JSON delivered ≤ 24 h | ✓ |
| H-03 | EU AI Act Art 9–15 | high-risk decision path triggers HITL | ✓ |
| H-04 | ISO 42001 AIMS | management report endpoint returns artifacts | ✓ |
| H-05 | SOC 2 evidence | `/api/nv/compliance/soc2/evidence` returns recent control logs | ✓ |
| H-06 | Hash-chain audit | tampering with one record breaks chain at next verify | ✓ |
| H-07 | Bias detector (6-dim) | adversarial prompt sets `biasFlags` ≥ 1 | ✓ |
| H-08 | Hallucination check | fabricated citation triggers `hallucination:true` | ✓ |
| H-09 | PII redaction (30+ patterns) — pre | request containing Aadhaar masked before LLM | ✓ |
| H-10 | PII redaction — post | response containing Aadhaar masked before client | ✓ |
| H-11 | PII vault TTL | stored PII auto-evicted ≤ 30 min | ✓ |
| H-12 | Prompt injection detection | direct injection / token smuggling / role-play blocked | ✓ |
| H-13 | Rate limit (6-tier) | exceed RPM → 429 with `Retry-After` | ✓ |
| H-14 | CSRF guard | unsafe origin → 403 on auth mutation routes | ✓ |
| H-15 | Helmet headers | response carries CSP, HSTS, X-Frame-Options | ✓ |
| H-16 | JWT 24 h expiry, refresh 30 d | expired JWT → 401 `TOKEN_EXPIRED` | ✓ |
| H-17 | JWT rotation monitor | manual rotate → all old JWTs invalid in ≤ 1 min | ✓ |
| H-18 | API key SHA-256 hash storage | DB stores hash only; raw key never queryable | ✓ |
| H-19 | RBAC 8 levels | role downgrade revokes access immediately | ✓ |
| H-20 | Org RLS | tenant A cannot see tenant B's data even with valid key | ✓ |
| H-21 | PQC (when liboqs installed) | `/api/nv/security/pqc/keypair` returns ML-KEM key pair | ✓ |
| H-22 | Secure random everywhere | grep proves no `Math.random()` in `src/services` (resolved Apr 14) | ✓ |

**Pass criterion: 22/22.** Any failure blocks GA.

---

## 11. Block I — Multi-jurisdiction (IN · UK · US · EU · GC · SG)

For each jurisdiction `J`, run:

```
POST /api/nv/orchestrate
{ "agentKey": "<jurisdiction-default>", "jurisdiction": "<J>", "prompt": "Answer this question in {jurisdiction}: <Q>" }
```

| TC | Jurisdiction | Sample query | Expected |
|---|---|---|---|
| I-01 | IN | "Section 103 BNS 2023 punishment for murder" | references BNS, BNSS, BSA; cites Indian SC case |
| I-02 | UK | "Murder under English law (Coroners and Justice Act 2009)" | references UK statute; no IPC/BNS references |
| I-03 | US | "First-degree murder under California Penal Code §187" | references CA Penal Code; no Indian statutes |
| I-04 | EU | "Liability under GDPR Art 82" | references GDPR + CJEU |
| I-05 | GC | "UAE Federal Decree-Law on civil transactions" | references UAE Civil Code |
| I-06 | SG | "Singapore Penal Code §300" | references SG statutes only |

**Cross-cutting:** jurisdiction binding middleware refuses calls where `jurisdiction` ≠ tenant's allowed list (403 `JURISDICTION_DENIED`).

---

## 12. Block J — 8 Best-in-class algorithms (ALG-01 → ALG-08)

| TC | Algorithm | Verification |
|---|---|---|
| J-01 | ALG-01 Legal parser (Tika + PDFBox) | parses DOC/DOCX/PDF/RTF with structure preserved (sections, tables) |
| J-02 | ALG-02 GOT-OCR2.0 (with GPT-4o Vision fallback) | OCR accuracy ≥ 95 % WER on legal-doc fixtures |
| J-03 | ALG-03 Recursive legal chunker | chunks respect headings; no chunk ≥ 1500 tokens |
| J-04 | ALG-04 Legal-BERT embedding | cosine sim ≥ 0.7 on positive pairs from a labelled set; falls back gracefully |
| J-05 | ALG-05 RRF + COLIEE reranker + MMR | nDCG@5 improvement ≥ 15 % vs raw |
| J-06 | ALG-06 PRIMERA + SummaC summarizer | SummaC consistency ≥ 0.85 |
| J-07 | ALG-07 Citation verification (6-step) | precision ≥ 0.95 / recall ≥ 0.90 on a fixture |
| J-08 | ALG-08 Template + constraint drafting | generated NDA passes a constraint validator (mandatory clauses present) |

---

## 13. Block K — Performance & Scale (NFRs)

| TC | NFR | Target | Measurement |
|---|---|---|---|
| K-01 | `/health` p50 latency | ≤ 50 ms | k6 |
| K-02 | `/api/nv/orchestrate` p50 (cached) | ≤ 200 ms | k6 |
| K-03 | `/api/nv/orchestrate` p50 (uncached, GPT-4.1) | ≤ 5 s | k6 |
| K-04 | RAG query p50 | ≤ 1.5 s | k6 |
| K-05 | Doc upload + extract p95 (5 MB PDF) | ≤ 60 s | jobs/poll loop |
| K-06 | Voice round-trip p50 | ≤ 4 s | WS load tool |
| K-07 | Concurrent requests sustained | 10,000 | k6 / Locust at 10 K VUs for 30 min |
| K-08 | Error rate at 10 K VU | ≤ 1 % | logs |
| K-09 | DB connection pool saturation | < 80 % | CloudWatch |
| K-10 | LLM cost per 1 K calls (3-tier cascade on) | ≤ 35 % of all-GPT-4o baseline | token metrics |

---

## 14. Block L — Observability & Logging

| TC | Item | Expected |
|---|---|---|
| L-01 | `X-Request-ID` on every response | UUID; same ID propagated through audit log |
| L-02 | Structured logs | JSON, includes request_id, agent_id, tier, jurisdiction, latency_ms, tokens, cost |
| L-03 | Audit log entry per request | hash-chain verifier passes |
| L-04 | Token metrics | `nv_token_metrics` row inserted per LLM call |
| L-05 | Sentry capture | a forced exception appears in Sentry dashboard with stack |
| L-06 | CloudWatch alarms | latency p95 > target → alarm fires within 1 min |
| L-07 | Health-check is unauthenticated and < 100 ms | for ELB/Probe |
| L-08 | Trace propagation (W3C `traceparent`) | inbound traceparent honored, outbound LLM call carries it |

---

## 15. Block M — End-to-end ecosystem flows

These verify that NYV truly is the AI backbone — i.e. each Nyayasiddhi platform can do its job end to end.

### M-01 — NYM citizen chat (Hindi → Hindi)
1. NYM Flutter app → NYM backend → `sdk.sendChatMessage({text, sessionId, userId})`.
2. Verify response in plain Hindi, ends with NYM-appended disclaimer (NYV strips it).
3. Round-trip ≤ 4 s.

### M-02 — NYM document analysis (rental agreement)
1. PDF text inline → `sdk.analyzeDocument(...)`.
2. Verify all 5 mapped fields.

### M-03 — NYM case-brief (intake transcript)
1. `sdk.generateCaseBrief(...)`.
2. Verify `applicableLaws` cite at least one Indian statute.

### M-04 — NYS-PRO research (NyayaRAG + Citation verify)
Lawyer searches "DPDP Act 2023 consent" → response with grounded citations + verified flag true.

### M-05 — NYS-PRO drafting (Maker-Checker + Refine)
Generate an NDA → checker flags missing arbitration clause → refine adds it → final passes constraint validator.

### M-06 — NYS-INS multi-tenant audit
Two orgs run identical queries → audit log shows both with hash-chain integrity; no data leak across `org_id`.

### M-07 — NYS-INS billing
Run 100 RAG queries → wallet decremented by exactly 100 credits → GST invoice generated with `tax:18%`.

### M-08 — NYS-ACE testing console
Run L1–L6 testing on agent `IN-Civil-001` → results uploaded to `nv_agent_performance` → dashboard shows scores.

### M-09 — NYS-MIN regulatory feed
`GET /api/nv/intelligence/regulatory-feed` returns latest gazette items (or empty if no new updates) → no errors.

### M-10 — Cross-platform HITL
NYM submits high-risk question → routed to HITL queue → NYS-INS reviewer approves → NYM session resumes with reviewed answer.

---

## 16. Chain-of-Thought verification template (for any agent response)

For **every** agent response, the tester should verify:

```yaml
governance:
  riskScore:        <= 0.3 (auto-pass) | 0.3-0.7 (HITL) | > 0.7 (block)
  hallucination:    false (else: where did the claim come from?)
  biasFlags:        empty (else: which dimension?)
trace:
  steps:            >= 1
  llm_calls:        each has provider, model, tokens, cost
  rag_hits:         each has source_id, score, jurisdiction
  tools_used:       each has tool_id, latency, success
citations:
  - each has: id, statute_or_case_id, jurisdiction, year, verified:true
disclaimer:
  - present iff backend (NYM) appends one; never inside LLM output
language:
  - response language matches user query language (auto-detect)
audit:
  - audit_id present, request_id present, hash chain link present
billing:
  - credits_charged matches operation tier
```

A response failing any of the bold rows fails UAT.

---

## 17. Tooling

| Tool | Use |
|---|---|
| **Postman / Bruno** collection at `nyayavigya-platform-312/docs/postman/NYV-SDK-v6.postman_collection.json` (to be exported) | manual API runs |
| **k6** scripts in `nyayavigya-platform-312/scripts/k6/` | performance |
| **Playwright** UI tests in `nyayavigya-platform-312/tests/e2e/` | console UI |
| **`sdk/nyayamitra-sdk/examples.ts`** | smoke for Mitra contract SDK |
| **Swagger UI** at `/api/nv/docs` | interactive exploration |
| **Sentry** | runtime errors |
| **CloudWatch** | NFR dashboards |

---

## 18. Defect logging

All defects in **Linear** project `NYV-SDK-v6`, severity per:

| Severity | Definition | SLA |
|---|---|---|
| P0 | Blocks any P0 test, security/compliance breach, data loss | < 24 h |
| P1 | Blocks any P1 test, no workaround | < 72 h |
| P2 | Workaround exists | < 1 sprint |
| P3 | Cosmetic | next release |

Bug template fields are in `.agents/skills/qa-test-planner/SKILL.md §Bug Reporting`.

---

## 19. Exit criteria (UAT sign-off)

The UAT is signed off only when **all** of the following are true:

1. Block H (Compliance & Security): **22 / 22 PASS**.
2. Block I (Multi-jurisdiction): **6 / 6 PASS**.
3. Block J (Algorithms): **8 / 8 PASS**.
4. Blocks A, B, C, D, E, F, G, K, L, M: P0 = 100 %, P1 ≥ 95 %.
5. Penetration test (S1), VAPT (S2), SOC 2 review (S3), ISO 27001 gap (S4), DPDPA audit (S5), 10 K load test (S6) — all signed off.
6. No P0 or P1 defects open.
7. CHANGELOG, public docs, and 4 npm SDK packages published at `6.0.0`.
8. AWS infra (I1–I11) provisioned and observability (L-05, L-06) live.

---

## 20. Out of scope for this UAT

* SLM training & deployment (planned Q3 2026 +).
* GA SDK consumer onboarding (Partner Program — Aug 2026).
* Sovereign LLM evaluation for Ministry tier (separate program).
* Mobile apps (Flutter / iOS / Android) — covered by their own UAT plans.

---

*End of UAT — Nyayavigya SDK 5.0.0 / Platform 3.1.2 — Apr 21, 2026.*
