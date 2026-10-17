# NSP ↔ NYV AI Handshake — Authoritative Integration Contract (2026-09-16)

> **Superset document** for all NSP/NYM AI integration surfaces.  
> **Live API:** `https://api.nyayasiddhi.online` (nysdev)  
> **Current deploy:** **`2026-10-09T1917Z-aws-ssm`** (tarball **`aeab32ff`**, SSM **`e7aaba50`**) — **NV-BETA-COMPLETION-TRUST-001** + **NV-NSP-STREAM-META-002** (stream `completion*` on `run_completed`). Live curls: [`NSP-NYV-CONTINUE-LIVE-ARTIFACTS-2026-10.md`](./NSP-NYV-CONTINUE-LIVE-ARTIFACTS-2026-10.md). Client SDK **5.2.0** for CNR resolve.  
> **No secrets in this doc.** SDK keys live on nysdev canonical env only.

**Cross-refs (detail, not duplicate here unless noted):**

| Doc | Scope |
|-----|-------|
| [`NSP-NYV-AI-TASK-SURFACE-2026-09.md`](./NSP-NYV-AI-TASK-SURFACE-2026-09.md) | **NSP quick ref** — feature → taskType → endpoint → mode → status one-pager |
| [`NSP-NYV-DRAFT-HANDSHAKE-2026-09.md`](./NSP-NYV-DRAFT-HANDSHAKE-2026-09.md) | Stream vs async draft routing, durable SSE, Gap 3 worker payload |
| [`PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md`](./PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md) | Full prompt pipeline, §J decision matrix, agent registry |
| [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md) | Per-endpoint timeout matrix, error mapping, tracking fields |
| [`NSP-NYV-HANDOFF-README-2026-09-16.md`](./NSP-NYV-HANDOFF-README-2026-09-16.md) | Bundle index + verification commands |
| [`NSP-DRAFT-CONTINUE-FAST-IMPLEMENT-2026-10.md`](./NSP-DRAFT-CONTINUE-FAST-IMPLEMENT-2026-10.md) | **NSP single-page** — Continue button + BFF wire (Beta) |
| [`NYV-BETA-COMPLETION-TRUST-TIER-2026-10.md`](./NYV-BETA-COMPLETION-TRUST-TIER-2026-10.md) | NYV completion loop, beta tokens, trust-tier memory |

---

## 1. Connection headers (required)

| Header | NSP | NYM | Notes |
|--------|-----|-----|-------|
| `X-API-Key` | `NYV_SDK_KEY_NSP` | `NYV_SDK_KEY_NYM` | Also accepted as `Authorization: Bearer <key>` |
| `X-NYV-Platform` | `nsp` | `nym` | **Required** for best-outcome depth (`NYV_DEPENDENT_PLATFORM_CODES`) |
| `X-NYV-User-Id` | numeric user id | same | Per-user memory; or body `userId: <numeric>` |
| `X-Request-Id` | optional UUID | same | NYV echoes on response for log correlation |
| `Content-Type` | `application/json` | same | All orchestrate bodies |

Jurisdiction `IN` is server-enforced for NSP/NYM (`INDIA_ONLY_PARTNER_CODES`).

---

## 2. Draft quality tiers + token matrix (NV-DRAFT-LENGTH-TIER-001)

**NYV code SSoT:** `nyayavigya-platform-312/src/config/nv-draft-length-registry.ts`  
**NSP mirror (align before prod):** `packages/nsp-config/src/drafting/nv-draft-length-registry.ts`

| NSP tier | NYV `options.draftLength` | Stream `taskType` | SLA cap (when `-fast` + SLA ON) | Async `taskType` |
|----------|---------------------------|-------------------|----------------------------------|------------------|
| **Fast** | `low` | `legal-draft-fast` / `doc-draft-fast` | **4096** (+1024 attachment → **5120**) | — |
| **Standard** (default) | `medium` | `legal-draft-fast` / `doc-draft-fast` | **6144–8192** per doctype (+2048 attachment, capped **8192**) | — |
| **Comprehensive** | `comprehensive` | — | No SLA cap | `legal-draft` (worker + poll) |

**Env overrides:** `NYV_DRAFT_FAST_SLA_MAX_TOKENS` (**8192** default), `_LOW` (**4096**), `NYV_DRAFT_ATTACHMENT_BUMP_*` (+1024 / +2048 / +4096).

**Recommended:** send `parameters.documentType` (snake_case registry key) + `options.draftLength` on every draft request for best routing.  
**Missing or unknown `documentType`:** NYV **infers** intent (prompt/attachments heuristics) or falls back to `general_legal_document` — **HTTP 200**, not 400 (NV-DOCUMENT-TYPE-INFERENCE-001). Read `draftQuality.inferredDocumentType` + `draftQuality.documentTypeSource` to learn what NYV chose.

Full per-doctype table: [`NSP-NYV-DRAFT-HANDSHAKE-2026-09.md`](./NSP-NYV-DRAFT-HANDSHAKE-2026-09.md) § Token length SSOT.

---

## 3. AI task types — complete matrix

### 3.1 Generation / orchestration

| Surface | Endpoint | `taskType` | Class | Timeout | Mode |
|---------|----------|------------|-------|---------|------|
| Interactive draft (default UI) | `POST /api/nv/orchestrate` | `legal-draft-fast` | Interactive | 90s | Sync or SSE |
| Doc-grounded quick draft | same + `/stream` | `doc-draft-fast` | Interactive | 90s | SSE preferred |
| Legal chat quick turn | same + `/stream` | `legal-chat-fast` | Interactive | 90s | SSE |
| Counsel pleading / memo | worker → orchestrate | `legal-draft` | Counsel | 600s | Async poll |
| Deep draft (user opt-in) | worker | `legal-draft-deep` / `doc-draft-deep` | Counsel | 600s | Async poll |
| Legal research / analysis | orchestrate | `legal_research` / `analysis` | Counsel | 600s | Worker |
| Caselaw research | orchestrate / knowledge | `caselaw-research` | Interactive/Counsel | 90–600s | Sync |
| Statute research | knowledge + orchestrate | `statute-research` | Interactive | 90s | Sync |
| Extract case fields | `POST /api/nv/v1/sdk/intelligence/extract-case` | — | Interactive | 90s | Sync |
| Prompt improve | `POST /api/nv/v1/sdk/prompt/improve` | — | Interactive | 30s | Sync |
| CNR / diary resolve | `POST /api/nv/v1/sdk/cnr/resolve` | — | Interactive | 90s | Sync |
| Orchestrate sync | `POST /api/nv/orchestrate` | any above | per class | per class | JSON body |
| Orchestrate stream | `POST /api/nv/orchestrate/stream` | any interactive | Interactive | 90s idle | SSE |

**Legacy alias:** `POST /api/nv/v1/sdk/orchestrate` (+ `/stream`) — same router.

**Four honoured `-fast` aliases only:** `legal-chat-fast`, `legal-draft-fast`, `doc-draft-fast`, `document-draft-fast`. Any other `-fast` suffix gets full counsel depth.

**Do NOT use:** `POST /api/nv/gateway/documents/draft` (hardcodes Queen; `-fast` SLA never applies).

### 3.2 Chat flows

| Flow | taskType | maxTokens floor | RAG | CoT |
|------|----------|-----------------|-----|-----|
| FAQ / quick Q&A | `legal-chat-fast` | 768 (`NYV_PARTNER_MAX_TOKENS_CHAT_FAST`) | Off when doc-less | Off |
| Counsel chat | `legal-chat` | partner floor 16384 | On | On (Queen when `NYV_NSP_COUNSEL_QUEEN=1`) |

### 3.3 Stream SSE contract (`POST /api/nv/orchestrate/stream`)

Event order: `run_started` → `pipeline_ready` → `text_delta` → `run_completed`

| Rule | Detail |
|------|--------|
| Gated deltas | `gated: true` on `text_delta` → **replace** entire editor body, not append |
| Never-miss | Empty specialist output triggers `ensurePartnerNeverMissContent()` (NV-QUEEN-NEVER-MISS-001) |
| Async handoff | NYV **never** returns HTTP 202; NSP BFF emits `meta.mode: durable` + poll path |
| CoT on `-fast` | Forced off (`NV-FAST-COT-OFF-001`) even if body sends `enableCoT: true` |

### 3.4 Async worker contract (comprehensive counsel)

When NSP routes comprehensive / Continue / real attachments:

1. BFF returns **one** SSE meta event (`mode: durable`, `taskId`, `pollPath`) then `[DONE]` — zero `text_delta`.
2. Worker calls NYV with bare `legal-draft`, `options.draftLength: comprehensive`, `enableCoT: true`.
3. UI shows counsel-queued copy; poll until `ready` or `failed_infra`.

Worker payload table: [`NSP-NYV-DRAFT-HANDSHAKE-2026-09.md`](./NSP-NYV-DRAFT-HANDSHAKE-2026-09.md) § Gap 3.

---

## 4. documentType registry

21 snake_case keys in `nv-draft-length-registry.ts` (20 specialized + `general_legal_document` fallback):  
`bail_application`, `criminal_petition`, `writ_petition`, `written_statement`, `legal_notice`, `complex_agreement`, `affidavit_case`, `legal_opinion`, `case_summary`, `general_legal_document`, …

Structure checklists: `nv-indian-draft-structure-registry.ts` (`INDIAN_DRAFT_STRUCTURE_CHECKLIST`).

**Inference metadata (when NYV chose the type):** `draftQuality.inferredDocumentType`, `draftQuality.documentTypeSource` (`prompt_inferred` | `unknown_explicit_fallback` | `general_fallback`).

---

## 4g. Draft completion & Continue (NV-AI-COMPLETION-LOOP-001, Beta 2026-10)

> **NSP implement fast:** [`NSP-DRAFT-CONTINUE-FAST-IMPLEMENT-2026-10.md`](./NSP-DRAFT-CONTINUE-FAST-IMPLEMENT-2026-10.md)  
> **NYV behaviour:** auto LLM continuation on incomplete structure / `length` stop; higher beta token floors (`NYV-BETA-QUALITY-FIRST-001`). Trust-tier memory is **NYV-only** (no NSP wire).

### 4g.1 Beta impact on NSP / users

| Question | Answer |
|----------|--------|
| Breaking API change? | **No** — additive response fields; optional request `options.*` |
| Must NSP ship before Beta? | **No** — old clients keep working; quality often improves without UI |
| Should NSP ship for Beta? | **Yes (recommended)** — Continue avoids regen + credibility loss on incomplete drafts |
| User sees without NSP UI? | Longer/more complete drafts when NYV auto-continues; occasional still-incomplete body |
| Memory / RAG | No NSP change; unreviewed drafts no longer auto-written to NYV durable memory |

### 4g.2 Additive response fields (sync `POST /api/nv/orchestrate`, async poll `result`)

| Field | Type | Partner use |
|-------|------|-------------|
| `completion` | object | Canonical completion envelope |
| `completion.status` | `complete` \| `incomplete` \| `continued` | UX state |
| `completion.continuationAvailable` | boolean | **Show Continue button** when `true` |
| `completion.continuationCount` | number | NYV auto-segments already applied this HTTP request |
| `completion.incompleteReason` | enum | `abrupt_ending`, `max_tokens`, `structure`, `segment_budget` |
| `completion.hint` | string | User-facing copy (may reference `options`) |
| `completion.continueRequest.options` | object | Next `segmentIndex` (+ optional `priorRequestId`) |
| `completionStatus` | same enum | Top-level mirror |
| `continuationAvailable` | boolean | Top-level mirror |
| `draftQuality.completion*` | mirrors | If UI reads only `draftQuality` today |
| `requestPhase` | lifecycle | **`degraded`** when incomplete but `content` present — **not failure** |
| `optionalDegraded` | boolean | Often `true` with incomplete draft |

**Show Continue when:** `continuationAvailable === true` (top-level or `completion` or `draftQuality`).

**Do not:** map `degraded` to timeout error; discard `content`; require new endpoints.

### 4g.3 Continue request (same endpoint, additive `options`)

Re-post **`POST /api/nv/orchestrate`** with **unchanged** `taskType`, `prompt`, `sessionId`, `matterId`, `parameters`, and prior `options.draftLength` (etc.), plus:

```json
{
  "options": {
    "continueIncomplete": true,
    "priorContent": "<full prior response content>",
    "segmentIndex": 1,
    "priorRequestId": "<prior response requestId>"
  }
}
```

| Rule | Detail |
|------|--------|
| `priorContent` | Full last `content`, not a diff |
| `segmentIndex` | Use `completion.continueRequest.options.segmentIndex` from prior response |
| `prompt` | Same user instruction as first turn (not “continue writing”) |
| Regenerate | New thread — **omit** `continueIncomplete` |

NYV merges `priorContent` with new model output and may run further auto-continuations in the same request (env cap, default 4 segments).

### 4g.4 Optional counsel memory accept (separate from Continue)

When advocate explicitly saves filing-ready text to matter knowledge (future/hardening):

```json
"options": { "counselAccepted": true }
```

or `acceptToMatterKnowledge: true`. Not required for Continue.

### 4g.5 Stream SSE (NV-NSP-STREAM-META-002)

On **`POST /api/nv/orchestrate/stream`**, terminal **`run_completed`** now mirrors sync:

- `result.completionStatus`, `result.continuationAvailable`, `result.completion`
- Same keys duplicated on the **event root** (with `draftQuality`) for BFF parsers
- `draftQuality.completion*` mirrors unchanged

Stream does **not** run the automatic multi-segment completion loop (sync only); metadata reflects **final streamed body** + `options.segmentIndex` / usage segment counts. NSP Continue still uses sync `POST /api/nv/orchestrate` with `priorContent` from the editor.

### 4g.6 Error / success matrix (additions)

| Condition | HTTP | NSP action |
|-----------|------|------------|
| `completion.status === 'complete'` | 200 | Normal success |
| `completion.status === 'continued'` | 200 | Success; NYV already appended segment(s) |
| `continuationAvailable === true` | 200 | Show **Continue**; keep editor content |
| `continuationAvailable === false` + incomplete | 200 | Counsel async / manual edit; honour `reviewRecommended` |
| `requestPhase === 'degraded'` + non-empty `content` | 200 | Success with Continue or review banner |

---

## 5. Error codes (partner-facing)

| Condition | HTTP | Partner action |
|-----------|------|----------------|
| Missing `parameters.documentType` on draft | **200** | Optional — NYV infers; read `draftQuality.inferredDocumentType` |
| Unknown `parameters.documentType` on draft | **200** | NYV uses `general_legal_document`; partner may sync wire key from inference metadata |
| `-fast` draft completed | 200 | Render `data.content` |
| Draft incomplete + `continuationAvailable` | 200 | Show Continue (§4g); do not regen by default |
| `requestPhase: degraded` + content | 200 | Not timeout — Continue or review (§4g) |
| Queen CoT parse fail but content produced | 200 | Render content; check `qualityEnvelope.scaledOptional` |
| `requestPhase` = `generating` / `enriching` | in-flight | Show progress; never `DRAFT_AI_TIMEOUT` |
| `optionalDegraded: true` with content | 200 | Success; optional quiet note |
| `QUALITY_ENVELOPE_FAILED` | **422** | Top-level `error.code`; `details.qualityEnvelope.missingMandatory` — do not blind-retry |
| `AI_SERVICE_UNAVAILABLE` | **503** | Top-level `error.code`; `retryable: true`; optional `details.retryJobId` (NV-ORCH-RETRY-001) |
| Long AI HTTP (orchestrate, stream, legal-work, doc analyze) | **600s** | NYV `NV-LONG-AI-HTTP-TIMEOUT-001` — gateway socket + `NYV_ORCH_WALL_CLOCK_MS` (~590s); NSP BFF may use shorter UX timeout but must not abort NYV upstream early |
| NSP `documentAIService.analyzeIntelligence` / `analyzeIntelligenceLong` | sync **90–180s** | NYV: `taskType: analyzeDocument` on `/api/nv/orchestrate` or SDK doc-pipeline; worker `nsp-ai-summary` → `agentKey: document-analyst` |
| `failed_infra` / empty after 600s | 5xx | Retry once with new idempotency bucket |
| 401 | — | Wrong/missing `X-API-Key` or JWT-only route |
| 403 scope / DPDPA | — | Fix consent or key scope |
| 429 | — | Backoff (NSP/NYM demo unlimited by default) |

---

## 6. Production LLM sequence (2026-09-16)

Researched from `nv-llm-routing-policy.ts`, `nv-llm-cascade-config.ts`, `llm-orchestrator.ts`, `nv-partner-platform.ts`.

### 6.1 Tier → model routing

| Partner tier | taskType | Serving tier | Lead models | Token cap | Latency | Cost | Accuracy |
|--------------|----------|--------------|-------------|-----------|---------|------|----------|
| **Fast** | `*-fast` + `draftLength: low` | `plus` (Haiku-first) | Bedrock Haiku 4.5 → Nova Lite → Gemini Flash | 4096 SLA | ~8–15s | Low | Good skeleton |
| **Standard** | `*-fast` + `draftLength: medium` | `plus` → fallback cascade | Haiku first; Sonnet/Opus on escalation | 6144–8192 SLA | ~15–40s | Medium | Full interactive draft |
| **Comprehensive** | `legal-draft` async | `enterprise` (Queen) | Opus 5 → Opus 4.8 → Sonnet 5 → Gemini Pro | 16384–32768 | ~70–180s | High | Counsel-grade |

### 6.2 Cascade rung order (default Bedrock-first)

1. **SLA fast** (`legal-*-fast`): `BEDROCK_SLA_FAST_LEGAL` — Haiku 4.5, Nova Lite, Nova Pro, Gemini Flash Lite, Gemini Flash
2. **Env lead** (`NYV_LLM_CASCADE_LEAD`) — ops prepend without code change
3. **Bedrock regions:** `us-east-1` → `ap-south-1` (Opus 5 / Opus 4.8 / Sonnet 5 / DeepSeek / Nova)
4. **Gemini pool** (`NYV_LLM_CASCADE_GEMINI`)
5. **OpenRouter paid** + direct Anthropic/OpenAI (when `NYV_PARTNER_LEGAL_PREMIUM_FIRST=1`)
6. **OmniRoute** (if enabled)
7. **OpenRouter :free**
8. **Scored MODEL_CATALOG** remainder
9. **AgentZero** terminal (never-empty fallback — avoid in prod)

### 6.3 Key env knobs

| Env | Default | Effect |
|-----|---------|--------|
| `NYV_NSP_COUNSEL_QUEEN` | `1` | Bare `legal-chat`/`legal-draft` → Queen+CoT; explicit `-fast` stays Haiku |
| `NYV_DRAFT_FAST_SLA` | `1` | Caps `-fast` tokens; skips statute QA + Haiku polish on SLA path |
| `NYV_PARTNER_FAST_SERVING_TIER` | `plus` | `-fast` aliases use lite cascade |
| `NYV_PARTNER_MAX_TOKENS_FLOOR` | `16384` | Counsel bare draft floor |
| `NYV_PARTNER_MAX_TOKENS_DRAFT_FAST` | `4096` | Draft-fast output floor |
| `NYV_PARTNER_MAX_TOKENS_CHAT_FAST` | `768` | Chat-fast lean floor |
| `NYV_LLM_TIMEOUT_MS` | `90000` | Master cascade budget; extended for deep/partner-legal |

### 6.4 Tradeoffs summary

- **Fast:** Haiku + low token cap = lowest cost/latency; may truncate long prayers without attachment bump.
- **Standard:** Haiku-first with SLA cap 8192 = NSP default UX; skips expensive post-LLM on SLA path.
- **Comprehensive:** Opus Queen + full registry floor = highest accuracy; must never run on 55–60s browser threads.

`nv-model-cascade-service.ts` provides complexity-based tier selection for non-partner paths (Tier 1 Groq/DeepSeek → Tier 3 Sonnet/GPT-4o). Partner orchestrate uses the intelligent-router policy above.

---

## 7. Verification commands

```bash
cd nyayavigya-platform-312
npm run partner:smoke:ec2          # 7 platforms, 0 failures expected
npm run demo:probe:draft-length:ec2 # bail medium Haiku ~4k tokens
npm run demo:probe:ec2              # full crosscheck
```

Probes **SKIP** (not PASS) when keys absent locally — EC2 SSM is authoritative.

---

## 8. Pre-production checklist (2026-09-16)

### P0 (before prod go-live)

| Item | Status | Action |
|------|--------|--------|
| Token SSOT deploy | **DONE** `2026-09-16T1502Z-aws-ssm-667d73f1` | Monitor first 24h draft token histograms |
| NSP `documentType` on all draft paths | NSP-side (recommended) | Merge on stream + worker for best routing; NYV infers if omitted |
| NSP registry token bands | **ALIGNED** (2026-09-17 crosscheck) | NSP `LENGTH_TOKENS` 4096/8192/32768 matches NYV bands (see §9) |
| Async comprehensive worker wire | **CODE WIRED** (FB-423/424/428) | Durable SSE meta + BullMQ worker → `legal-draft` + `draftLength: comprehensive`; **E2E prod verify** still recommended |

### P1 (same week)

| Item | Action |
|------|--------|
| LLM cascade tuning | Watch Haiku truncation on `written_statement` standard tier; consider Sonnet-first for doctypes >8192 registry default |
| Token caps | Confirm NSP UI `maxTokens` does not override NYV SLA cap downward on standard tier |
| Probe script | `_ec2-draft-length-probe.sh` updated for mandatory `documentType` (slp + counsel scenarios) |
| Missing probes | Add stream-path draft-length probe; add comprehensive async Queen latency probe |
| Prompt improve | Confirm live clean responses post `1357Z`; drop NSP local fallback |

---

## 9. NSP registry alignment note

**NSP path:** `/Users/vamsit/Desktop/Nyayasiddhi-Professional 2/packages/nsp-config/src/drafting/nv-draft-length-registry.ts`

**NSP values (2026-09-17 code crosscheck — ALIGNED):** low=4096, medium=8192, comprehensive=32768 in `packages/nsp-config/src/drafting/nv-draft-length-registry.ts`  
**NYV live values:** low=4096, medium=6144–8192 (per doctype), comprehensive=16384–32768

Wire fields (`options.draftLength`, `parameters.documentType`) remain authoritative at runtime. Prior “stale 2048/4096/8192” note applied to pre-`0905b585` NSP commits — **superseded**.

```ts
// NSP mirror (current — matches NYV ceiling bands)
const LENGTH_TOKENS: Record<NyvDraftLength, number> = {
  low: 4096,
  medium: 8192,
  comprehensive: 32768,
};
```

---

## 10. Partner sign-off

**NSP confirmed 2026-09-16** — Playbook alignment via `buildNyvDraftOrchestratePayload` / `draftWire` frozen. Token tier deploy **`1502Z`** completes NYV side of NV-DRAFT-LENGTH-TIER-001. **NSP registry mirror aligned** per 2026-09-17 wire crosscheck (`0905b585` / `LENGTH_TOKENS` 4096/8192/32768).

**NSP Sept handshake self-assessment (2026-09-17, Pro deploy `fb437-1904299f`) — NYV crosscheck:**

| Pillar | NSP claim | NYV verified | Notes |
|---|---|---|---|
| Drafting / AI | ~9.5 | **~9.0–9.2** | Wire + stream ingress (FB-437) **DONE**; NYV counsel-grade **15/0/0** + stream metadata (NV-NSP-STREAM-META-001). NSP P1 UI **DONE** `fb439-e339e717-09171715` — chat `draftQuality`, `routing_hint` CTA, hub deep-links |
| Doc-parse / autofill | ~9.5 | **~8.5–9 typed / ~7.5 scanned** | **58/58** typed corpus confirmed; scanned Indic OCR partial (ORDER 0%) |
| Research / citator | ~8.5–9 | **~8.5–9.0** | Corpus **live** (~26M RDS, ~77% embed, 15.5K graph edges); remaining caps are era/query limits (pre-2000 SCR paras, SLP tokenization), not missing corpus |
| Platform cohesion | ~9.5 | **~8.5–9.0** | NSP internal **65/65** smoke + **3002/0** asserts; hub null routes **DONE** `fb439`; NYV `partner:smoke:ec2` (**7** platforms, 0 failures) |

**Verdict:** **Nothing blocking Sept handshake closure** on core wire + Pro deploy. Honest cross-system composite **~8.7–9.0/10** post **NSP Pro `fb439-e339e717-09171715`** (2026-09-17) — P1 UI gaps closed (Legal Chat `draftQuality`, `routing_hint` → `DraftComprehensiveUpgradeBanner`, hub null routes → `#/ai-usage?tool=`). Remaining uplift: documented product limits only (pre-2000 SCR paras, pending SC diary CNR null, SLP tsquery edge cases).

---

## 11. Agent polish audit — pre-prod gaps (2026-09-16)

Source audit: NYV agent registry + runtime overlays. **Do not bulk-edit 164 registry JSON prompts** — SME India rules live in `nv-legal-intelligence-overlay.ts`, `nv-legal-drafting-prompt.ts`, `nv-agent-draft-overlay.ts`, and `nv-indian-draft-structure-registry.ts`.

| Priority | Gap | Owner | Status |
|:---:|---|---|---|
| **P0** | NSP async comprehensive worker (`legal-draft` + `draftLength: comprehensive` + poll) | NSP BFF | **CODE WIRED** (FB-423/424/428) — durable SSE + worker; E2E prod verify |
| **P1** | Legal Chat draft stream omits `draftQuality` on chat-only path | NSP UI/BFF | **DONE** `2026-09-17` — NSP Pro **`fb439-e339e717-09171715`**; Fast default `draftQuality` on chat-only Legal Chat stream |
| **P1** | NSP UI honour `routing_hint` / `draftQuality.routingHint` | NSP UI | **DONE** `2026-09-17` — NSP Pro **`fb439-e339e717-09171715`**; `DraftComprehensiveUpgradeBanner` auto-upgrade CTA from `routing_hint` |
| **P1** | Hub null routes → AI Usage deep-link | NSP UI | **DONE** `2026-09-17` — NSP Pro **`fb439-e339e717-09171715`**; catalogue + `#/ai-usage?tool=` deep-link for 3 tools |
| **P0** | NSP `documentType` on every draft stream/worker call | NSP BFF | **Recommended** — NYV infers if missing (no 400) |
| **P1** | Eval harness missing `written_statement`, `writ_petition`/SLP, comprehensive Queen async | NYV | **DONE** `2026-09-16T18:45Z` — +5 cases in `nv-counsel-grade-set.v1.json` |
| **P1** | Standard tier Haiku cap (8192) vs long pleadings (`written_statement` 32k comprehensive) | NYV + NSP | **DONE** — NYV emits `routing_hint`; NSP **`fb439`** honours via `DraftComprehensiveUpgradeBanner` |
| **P2** | Template catalog (204 IN) not keyed to partner `documentType` | NYV | **DONE** `documentTypeKey` via `nv-template-doctype-map.ts` |
| **P2** | CNR resolved facts → draft parameter auto-fill | NYV | **DONE** `mergeCnrFactsIntoOrchestrateBody` → `formatCnrCaseContext` in draft overlay |

**NYV counsel-grade surface (2026-09-16):** Overlays (state headers, DPDP/CPA, SLP paper-book), structure checker WS/WP backfill, leading-SC RAG salience boost, review/execution registry aliases. **FB-428 (WS/SLP density eval):** NYV-side **DONE**. **NSP wire crosscheck 2026-09-17:** core orchestrate **PASS** (`partner:smoke:ec2` 0 failures); comprehensive async **coded**; token mirror **aligned**. **NSP P1 UI closed 2026-09-17:** Pro deploy **`fb439-e339e717-09171715`** — Legal Chat `draftQuality`, `DraftComprehensiveUpgradeBanner`, hub `#/ai-usage?tool=` deep-links. **Remaining (product limits, not wiring):** pre-2000 SCR para structure, pending SC diary `cnr=null`, generic SLP tsquery 0-hit.

---

## 12. NYS corpus backlog — closure (2026-09-17)

Live probes SSM **`737b3f46`** (`demo:probe:ec2`) + **`1b91d073`** (targeted caselaw/nysapi). **Retrieval stack:** RDS Postgres (~26.2M judgments) is the primary search plane; Parquet/S3 feeds ingest; Athena serves on-demand full-text via `/retrieve` `archive-fulltext-hint`; **nysapi** (`nysapi.nyayasiddhi.online`) handles CNR/diary case lookup separately from knowledge search.

| # | Backlog item | Verdict | Status |
|---|--------------|---------|--------|
| 1 | Caselaw semantic embed ~2.6% | **MISDIAGNOSED** | **CLOSED** — live **~76.8%** (20.1M/26.2M); July metric stale; FTS works without embed |
| 2 | Citator graph 0 rows | **CLOSED** | **CLOSED** — **15,548 edges** live (`graphAvailable=True`, Aug 2026 ingest) |
| 3 | Pre-~2000 SCR paragraph numbering | **OPEN (era limit)** | **DOCUMENTED** — marginal letters vs numbered paras; not missing corpus |
| 4 | Hybrid search 0-hit | **MISDIAGNOSED** | **CLOSED** for normal queries — bail **1000**, NI Act **223**, IPC 420 **1000**; edge case: generic "SLP" **0** (tsquery tuning) |
| 5 | SC pending diary / CNR linkage | **PARTIAL** | **WIRING CLOSED** — nysapi diary resolve **200**; `cnr=null` legitimate until SC assigns CNR |

**Confirmed:** Athena, Parquet, RDS, nysapi, and NYV `nv-nys-knowledge-retriever` paths are wired. "Limited knowledge" on counsel-grade paths is **not** due to absent corpus — counsel-grade live eval **15/0/0** on deploy `49c047445`.
