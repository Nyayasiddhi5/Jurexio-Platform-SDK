---
status: live
version: 5.0.2
audience: platform engineers, partner integrators, architects
last_updated: 2026-05-10
---

# 11 — Agentic Architecture Walkthrough (Session-12)

> Per-batch end-to-end traces through the **NV-ARCH-001 safety ring** for
> one representative request per Batch A–J namespace mounted under
> `/api/nv5/*`. Each walkthrough names the exact files traversed, the
> 5-tier memory hit, the RAG retrieval, the chosen ROMA pattern, the
> `orchestrateLLM` provider decision, the hallucination + citation +
> safety + HITL gate, the audit hash-chain commit, and the streamed
> AG-UI response.
>
> **Companion docs:**
> - Product capability per batch — `01-product-comprehensive-2026-05-07.md` § 11 "Batch A–J product surface"
> - Endpoint tables per batch — `04-sdk-and-api-canonical-2026-05-07.md` §§ 11–17
> - Feature-flag matrix — `src/config/nv-feature-flags.ts`

---

## 0. The canonical safety ring (NV-ARCH-001) — recap

```
┌─ tenant isolation (nv-tenant-isolation-middleware)
│
├─ guardrails (nv-orchestration-guardrails + nv-pii-jcn)
│
├─ Queen orchestration (nv-queen-orchestrator)            ← multi-agent path
│  OR callNyayavigya (nv-client.ts)                       ← single-agent path
│
├─ agent allocation (bm25-agent-selector)
│   1042 agents × 6 jurisdictions × 22 ROMA-L5 patterns × 107 swarm topologies
│
├─ 22-section Parlant prompt assembly
│
├─ 5-tier memory (Mem0 + working / episodic / semantic / procedural / governance)
│   + multi-tier RAG (statute / case / template / private)
│   + GraphRAG (knowledge-base-system + nv-jurisdiction-overlay-service)
│
├─ CoT / ReAct / ToT reasoning (chain-of-thought-service)
│
├─ NV-ROUTER-001 (intelligent-router/orchestrateLLM)
│   cost-optimal LLM pick → AgentZero (priority 99) backup cascade
│
├─ response engineering (response-engineering-pipeline)
│
├─ hallucination + citation + safety + HITL gate
│   (hallucination-checker · citation-grounding · nv-escalation-service)
│
├─ audit hash chain commit (nv_schema.audit_hash_chain · hash-chain-verifier)
│
└─ AG-UI streaming (sharedAGUIService → SSE on /api/nv/agents/.../stream)
```

**NV-LLM-001 invariant** — every LLM emission below resolves through
`realLLMService.executeRequest → orchestrateLLM`. The Batch A–J sub-routers
under `/api/nv5/*` are **thin admin / metadata wrappers** that either:

- expose deterministic compute (chunking, RRF fusion, Flesch-Kincaid scoring,
  PQC keygen, DP-noise probe), or
- delegate to canonical pipelines via `delegateTo()` in `src/routes/nv5/_auth.ts`
  (multimodal + voice batches), or
- expose read-only listings + capability metadata (governance, internal,
  workflows lifecycle).

**No nv5 endpoint short-circuits the safety ring for an LLM-bearing call.**

---

## A. `/api/nv5/orch/*` — Orchestration primitives

**Representative request.** Operator wants to know which jurisdiction-specific
SLM the cascade would pick for an Indian Contract Act question, and what BM25
agent shortlist would be used:

```bash
curl -H "X-API-Key: $NYV_SDK_KEY_NSI" \
  -X POST -H 'content-type: application/json' \
  -d '{"query":"Section 73 damages computation","topK":5}' \
  http://localhost:5000/api/nv5/orch/agent-select/select
```

**Trace.**

1. `tenant isolation` → `org_id` extracted from `sdkAppContext`.
2. `requireSdkKey` (`_auth.ts`) → DB-backed key validation passes.
3. `nv5OrchAgentSelectRouter` calls `bm25AgentSelector.select(query, topK)`
   against the index previously loaded via `POST /api/nv5/orch/agent-select/load`
   (typically loaded with the IN registry from
   `config/agent-registries/Nyayavigya-Legal-registry-IN.json`).
4. **No LLM call** — BM25 is pure information-retrieval scoring over the
   loaded agent descriptors. Returns `{success, selected:[…], count}`.
5. **No memory write, no hash-chain commit** — admin metadata route.
6. Response envelope: `{success:true, selected:[{agentId, score, …}], count:N}`.

**Why this matters.** When the operator follows up with the actual question
through the canonical `/api/nv/orchestrate` route, the same `bm25-agent-selector`
runs as step (4) of the safety ring, then the chosen agent invokes
`realLLMService.executeRequest` (step 9) which routes through
`orchestrateLLM` → `nv-model-cascade-service` → AgentZero backup. The
nv5 admin route lets ops verify the selected set deterministically without
spending an LLM call.

---

## B. `/api/nv5/multimodal/*` and `/api/nv5/voice/*` — Multimodal + Voice

**Representative request (multimodal).** A NSP user uploads a scanned
contract page and asks for vision-grounded analysis:

```bash
curl -H "X-API-Key: $NYV_SDK_KEY_NSP" \
  -X POST -H 'content-type: application/json' \
  -d '{"imageUrl":"s3://...page-1.png","prompt":"List parties and material clauses"}' \
  http://localhost:5000/api/nv5/multimodal/rag-adv/vision/analyze
```

**Trace.**

1. `requireSdkKey` → SDK key validated.
2. `delegateTo(canonicalMM, '/multimodal/vision/analyze')` rewrites
   `req.url` and invokes the **canonical** `nv-sdk-multimodal-voice-routes`
   router. **From this point the request is indistinguishable from a
   direct call to `/api/nv/sdk/multimodal/vision/analyze`.**
3. Canonical router enters the safety ring at `nv-queen-orchestrator`.
4. BM25 selects the `vision-multimodal-agent` from the IN registry.
5. 22-section Parlant prompt assembled with the image as a vision-tier
   attachment (Tier-2 in the 5-tier memory model).
6. Multi-tier RAG fires: statute tier (Indian Contract Act, BNS 2023),
   template tier (NSP commercial-contract templates).
7. ReAct reasoning step inspects the image, plans clause-by-clause
   extraction, calls `nv-got-ocr-adapter-service` for text overlay.
8. `orchestrateLLM` picks `anthropic/claude-3-5-sonnet` (vision-capable,
   lowest-cost provider with vision support per the May-2026 catalog).
9. Response engineering normalises to `{parties, clauses, risks}`.
10. Hallucination check: every cited clause line number is verified
    against the OCR overlay; failures trigger HITL escalation.
11. Audit row appended to `nv_schema.audit_hash_chain` with the request
    hash, model id, token counts, and vision-input SHA-256.
12. AG-UI streams `agent_selected → tool_call(vision) → thinking →
    text_delta* → complete` events back to the NSP client.

**Voice variant.** `/api/nv5/voice/streaming/start` delegates to
`nv-voice-ws-routes` which opens a Deepgram or Sarvam (22-Indic) STT
socket; transcribed text re-enters the safety ring at the same
`nv-queen-orchestrator` step.

---

## C. `/api/nv5/workflows/*` and `/api/nv5/doc-ai/*` — Long-running workflows

**Representative request (workflows).** Trigger an autonomous due-diligence
sweep across an org's contract corpus:

```bash
curl -H "X-API-Key: $NYV_SDK_KEY_NSI" \
  -X POST -H 'content-type: application/json' \
  -d '{"engine":"autonomous","tasks":[{"type":"dd-sweep","corpusId":"acme-q4"}]}' \
  http://localhost:5000/api/nv5/workflows/start
```

**Trace.**

1. `requireSdkKeyStrict` (no JWT bypass) → SDK key validated.
2. `anyWorkflowFlagOn` → at least one of `NYV_F_WORKFLOW_AUTONOMOUS` /
   `_CONTINUOUS` must be on, otherwise 404.
3. `nv5WorkflowsRouter` mints a `workflowId`, persists initial row to
   `nv_workflow_runs`, and submits to
   `autonomous-continuous-execution-engine` (or `continuous-execution-engine`).
4. The engine **fans out** one ReAct loop per task. Each fan-out call
   re-enters the safety ring at `nv-queen-orchestrator` — workflow
   engines are clients of the ring, not bypasses.
5. `bm25-agent-selector` picks a different agent per task (e.g.
   `contract-risk-agent`, `obligation-extraction-agent`,
   `change-of-control-agent`).
6. RAG retrieves from the org-scoped private tier
   (`tenants/<orgId>/corpus/acme-q4/`) plus the IN statute tier.
7. `orchestrateLLM` per-task picks the cheapest provider that meets the
   complexity tier from `cost-aware-router` (typically
   `openai/gpt-4o-mini` for extraction, `anthropic/claude-3-5-sonnet`
   for risk reasoning).
8. `maker-checker-service` (Batch D) fires HITL hold on any output flagged
   `confidential` by the safety classifier.
9. Each task append to the audit hash chain with its own hash; the
   workflow row carries the **chain-tip hash** of its constituent tasks.
10. AG-UI streams progress: `workflow_started → task_started ×N →
    text_delta* → workflow_complete` to the client polling
    `GET /api/nv5/workflows/:id`.

**Doc-AI variant.** `POST /api/nv5/doc-ai/convert/jobs` accepts a binary
upload (multer ≤ 1 GB) and runs `nv-document-converter-service` to
produce PDF/A or DOCX outputs. **No LLM emission** — pure deterministic
conversion. Job lookup at `GET /api/nv5/doc-ai/convert/jobs/:id` and
the rendered output download at `GET /api/nv5/doc-ai/convert/jobs/:id/result`.
Result lands in object storage at `tenants/<orgId>/conversions/<jobId>/`.

---

## D. `/api/nv5/gov/*` — Governance, cost, concurrency

**Representative request.** Org admin checks the rate-limit budget left
for a user before running a 1k-document batch:

```bash
curl -H "X-API-Key: $NYV_SDK_KEY_NSI" \
  http://localhost:5000/api/nv5/gov/org-ratelimit/check/acme-org/user-42
```

**Trace.**

1. `requireSdkKeyOnly` → JWT-shaped tokens 401 with `BEARER_NOT_SDK_KEY`.
2. `requireScope('admin')` → wildcard `*` scope (super-admin keys) passes.
3. `org-rate-limiter` reads counters from Redis (cluster-coordinated).
4. **No LLM call**, **no audit-chain commit** — pure governance read.
5. Response: `{ok:true, remaining:{perMinute:97,perHour:5832,perDay:48201}}`.

**Side-channel impact on the safety ring.** When
`NYV_F_GOV_ORG_RATELIMIT=1`, `orgRateLimiter.middleware()` is mounted on
`/api/nv/*` **before** business handlers (see doc 04 § 14.3). Any
LLM-bearing request that exceeds the per-minute cap is short-circuited
with `429 Retry-After` **before** entering the safety ring — saving
both LLM cost and audit-chain churn.

Similarly, `NYV_F_GOV_CONCURRENCY=1` wraps queen-orchestrator synthesis
dispatch in `concurrencyGovernor.withTenantSlot()`, gating the LLM call
at step 8 of the safety ring (post-RAG, pre-router).

---

## E. `/api/nv5/legal-pipeline/*` — RAG primitives

**Representative request.** Engineer wants to preview how a 30-page
arbitration award would be chunked before re-indexing:

```bash
curl -H "X-API-Key: $NYV_SDK_KEY_NSI" \
  -X POST -H 'content-type: application/json' \
  -d '{"text":"<award text>","mimeType":"text/plain","strategy":"semantic-section"}' \
  http://localhost:5000/api/nv5/legal-pipeline/chunker/preview
```

**Trace.**

1. `requireSdkKeyOnly` + `requireScope('admin')` → pass.
2. `nv5LegalPipelineRouter` calls `legalDocChunker.preview()`.
3. **Pure deterministic compute** — no LLM, no embedding API call, no DB
   write. The chunker tokenises against statute / case / clause section
   markers (specific to the IN/UK/US legal corpus structure).
4. Response: `{chunks:[{idx, text, tokens, section, citations}], totalTokens, strategy}`.

**Side-channel impact on the safety ring.** When the same engineer
later POSTs the document to `/api/nv/sdk/docs-pipeline/documents/intelligence`,
the canonical RAG pipeline calls the **same** `legalDocChunker` at step 6
of the safety ring (RAG indexing), then `embeddingsService` (also
exposed read-only here as `/embedding/models`), then `legalReranker`
(read-only as `/reranker/rrf-fuse`). The nv5 admin endpoints let
operators tune chunker / reranker config deterministically before
running expensive index passes.

---

## F. `/api/nv5/compliance/*` — EU AI Act, PQC, federated privacy

**Representative request.** EU customer requests an Article 9 risk-management
report for an agent before deploying it in their tenant:

```bash
curl -H "X-API-Key: $NYV_SDK_KEY_JRX" \
  http://localhost:5000/api/nv5/compliance/eu-ai-act/agent/contract-risk-agent/risk-management
```

**Trace.**

1. `requireSdkKeyOnly` + `requireScope('admin')` → pass.
2. `nv5ComplianceRouter` calls
   `nvEuAiActService.generateArticle9Document(agentId)`.
3. **No LLM call** — pure data lookup against the agent registry
   (Nyayavigya-Legal-registry-EU.json) + the EU AI Act rule table.
4. Response includes intended-use, foreseeable misuse, risk register,
   risk-mitigation measures, post-market monitoring plan, and links to
   the bias-audit endpoint.

**Side-channel impact.** When a downstream LLM call traverses the safety
ring under EU jurisdiction, the audit hash-chain row carries the
`euAiArticle9DocId` reference so EU regulators can reconstruct which
risk register was active at request time.

---

## G. `/api/nv5/internal/{model-cascade,slm-router,cost-aware-router}/*` — Routing / cascade

**Representative request.** Ops checks SLM availability for the SG
jurisdiction before flipping traffic:

```bash
curl -H "X-API-Key: $NYV_SDK_KEY_NSI" \
  http://localhost:5000/api/nv5/internal/slm-router/availability/SG
```

**Trace.**

1. `requireSdkKeyOnly` + `requireScope('admin')` → pass.
2. `nv5InternalRouter` calls
   `nvSlmRouterService.getSlmAvailability('SG')`.
3. **No LLM call** — pure DB + provider-status read.
4. Response: `{success:true, jurisdiction:"SG", slms:[{id, status, latencyMs}], fallback:"openrouter/meta-llama-3.1-70b"}`.

**Side-channel impact.** When the canonical safety ring step 8
(`orchestrateLLM`) routes a SG-jurisdiction request, it consults the
**same** `nv-slm-router-service` to pick the SLM tier first; only
on SLM failure does it cascade to the global LLM cascade
(anthropic / openai / google / openrouter / sarvam / bedrock) and
ultimately to AgentZero (priority 99) per `realLLMService.executeRequest`
last-step guarantee. The peer routes (`/model-cascade/capabilities`,
`/cost-aware-router/capabilities`) likewise expose the cascade-tier and
complexity-tier metadata that step 8 reads at decision time.

---

## H. `/api/nv5/internal/{esign,ocr,pdfa,watermark}/*` — Document pipeline adapters

**Representative request.** Ops fetches the OCR adapter capability
matrix before kicking off a 50k-page batch through the canonical
`docs-pipeline` route:

```bash
curl -H "X-API-Key: $NYV_SDK_KEY_NSI" \
  http://localhost:5000/api/nv5/internal/ocr/capabilities
```

**Trace.**

1. `requireSdkKeyOnly` + `requireScope('admin')` → pass.
2. `nv5InternalRouter` calls
   `nvGotOcrAdapterService.getCapabilities()`.
3. **No LLM call** — pure metadata lookup (supported MIME types,
   doc-type taxonomy, quality tiers).
4. Response: `{success:true, docTypes:[…], qualities:[…]}`.

**Side-channel impact.** When the canonical
`/api/nv/sdk/docs-pipeline/documents/intelligence` chain processes a
file, it calls the **same** `nvGotOcrAdapterService` after multer
buffering and PII redaction. The peer routes (`/esign/capabilities`,
`/esign/session/:id`, `/pdfa/capabilities`, `/watermark/capabilities`)
expose the deterministic adapters that the canonical chain composes
in fixed order (OCR → PDF/A → watermark → eSign) — operators can
precheck each adapter independently here without committing the
full pipeline.

---

## I. `/api/nv5/internal/{hallucination,escalation,event-sourcing,jurisdiction-overlay,audit-chain}/*` — Quality / audit / jurisdiction

**Representative request.** Compliance auditor fetches the active
jurisdiction overlay set for a tenant before reviewing audit-chain
rows from the same window:

```bash
curl -H "X-API-Key: $NYV_SDK_KEY_NSM" \
  http://localhost:5000/api/nv5/internal/jurisdiction-overlay/capabilities
```

**Trace.**

1. `requireSdkKeyOnly` + `requireScope('admin')` → pass.
2. `nv5InternalRouter` calls
   `nvJurisdictionOverlayService.getActiveJurisdictions()`.
3. **No LLM call** — DB read of the per-tenant overlay table.
4. Response: `{success:true, jurisdictions:[{code,active,inheritsFrom}], …}`.

**Side-channel impact.** Three of the five Batch I services (hallucination,
escalation, audit-chain) are **post-LLM safety-ring stations** — they
fire AFTER `orchestrateLLM` returns:

- `hallucinationChecker.runChecks()` runs at safety-ring step 10.
  Failures route to `nvEscalationService.escalate()` (HITL gate).
- `nvEventSourcingAdapter` writes a per-step event row.
- Every approved response then commits to `nv_schema.audit_hash_chain`
  via `hash-chain-verifier` (verifiable from
  `/audit-chain/capabilities`).

The admin endpoints expose the **types / catalogs** for each
station (e.g. hallucination check types, escalation targets) so
operators can reason about coverage without replaying a real request.

---

## J. `/api/nv5/internal/{case-update,azentzero,agentzero,feature-flags,orchestration-facade}/*` — Adapters / case-mgmt / platform

**Representative request.** SRE checks the AgentZero circuit-breaker
state before promoting a new model in the cascade:

```bash
curl -H "X-API-Key: $NYV_SDK_KEY_NSI" \
  http://localhost:5000/api/nv5/internal/agentzero/capabilities
```

**Trace.**

1. `requireSdkKeyOnly` + `requireScope('admin')` → pass.
2. `nv5InternalRouter` calls `nyvAgentZero.getCapabilities()`.
3. **No LLM call** — circuit-breaker state, retry budgets, and
   adapter version are returned from in-process counters.
4. Response: `{success:true, breaker:{state,failureCount,nextHalfOpenAt}, retries:{…}, version:"…"}`.

**Side-channel impact.** AgentZero is the **priority-99 backup** in
`realLLMService.executeRequest`'s last-step cascade — every safety-ring
LLM emission falls through to it when all whitelisted providers fail.
The other Batch J adapters expose:

- `case-update` — outbound webhook event types fired post-audit-chain
  commit (when canonical pipelines change a case row).
- `azentzero` — health probe for the legacy adapter still routed via
  the canonical chain.
- `feature-flags` — runtime DB-backed flag store consulted by every
  middleware in the ring (including the `NYV_F_*` Batch A–J flags
  documented in `src/config/nv-feature-flags.ts`).
- `orchestration-facade` — metadata about the OrchestrationFacade
  class instantiated inside `nv-queen-orchestrator` at safety-ring
  step 3.

In every case the admin route is **metadata only**; the active logic
fires inside the safety ring during a real request.

---

## End-to-end safety-ring invariants verified

| Invariant | How verified at runtime |
|---|---|
| No nv5 endpoint emits an LLM call directly | `rg "realLLMService\.executeRequest\|new RealLLMService\(" src/routes/nv5/` returns 0 (NV-LLM-001 whitelist guards this) |
| Multimodal + voice always traverse canonical pipelines | `delegateTo()` in `_auth.ts` rewrites `req.url` and re-enters canonical router; canonical router runs `sdkGatewayAuth` again before the safety ring |
| Workflow engines do not bypass tenant isolation | Each fan-out task call enters via `nv-queen-orchestrator`, which re-applies tenant isolation per task |
| Governance side-channels short-circuit BEFORE the safety ring | `org-rate-limiter` + `concurrency-governor` middleware mount on `/api/nv/*` precede business handlers in `src/index.ts` |
| Audit chain unbroken across nv5-flagged paths | `npm run guardrail:no-new-orphans` + `psql -c "SELECT verify_hash_chain()"` PASS post-batch (last verified Session-11, 2026-05-10) |

---

## Reproducer commands

The single-curl examples in sections A through J above are intentionally
self-contained — each runs standalone against any flag-on dev or EC2
gateway. To replay coverage of all 10 batches, copy the curl from each
section in order. There is no Session-12 wrapper script; the docs are
the source of truth.

To verify the safety ring is untouched after running the traces:

```bash
npm run guardrail:auth-header
npm run guardrail:script-db
npm run guardrail:api-contract
npm run guardrail:no-new-orphans
```

To inspect any audit-chain row a trace produced (for safety-ring steps
that commit, e.g. Batch B vision and Batch C workflows):

```sql
SELECT request_id, agent_id, model_id, hash, prev_hash, created_at
FROM nv_schema.audit_hash_chain
WHERE created_at > now() - interval '5 minutes'
ORDER BY created_at DESC;
```
