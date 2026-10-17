# Partner AI Integration + Prompt Engineering + Agent Registry Audit

**Date:** 2026-09-08 (updated)  
**Scope:** NYV (`nyayavigya-platform-312/`) — NSP/NYM partner paths, agent registry, prompt pipeline crosscheck  
**Live API:** `https://api.nyayasiddhi.online` · Deploy **`2026-09-06T0719Z-aws-ssm-22bf786e`** (commit `22bf786e`)  
**Evidence:** EC2 probes via SSM + code audit (file:line citations below) · UAT run [`UAT-TEST-PLAN-v2-2026-09.md`](./UAT-TEST-PLAN-v2-2026-09.md)

---

## Executive summary

| Finding | Detail |
|---------|--------|
| **Draft-fast cold latency** | Post-deploy probe (2026-09-07): **5.2s** cold / warm cache per LM cache. Deploy `2026-09-06T0719Z`: chat-fast **4.2s**, draft-fast **5.2s** (SSM `d4021e49`). Prior baseline **10.7s** → **12.45s** track. Remaining gap vs 5–8s target is LLM output generation. |
| **Warm repeat** | Identical prompt → **~59–75ms** (LM cache). NYV tax ≈ 0%. |
| **NSP ~60s draft abort** | Not NYV down — bare **`legal-draft`** (**70–94s** Opus) vs NSP **55–60s** client budget. Use **`legal-draft-fast`** (~**7s**), **`syncTimeoutMs: 90000`**, or stream (**TTFB ~42ms**). §A.0. |
| **Partner integration** | Use `POST /api/nv/orchestrate` with explicit `-fast` taskType aliases. Never sync `legal-draft` from UI threads. |
| **Agentic vs fast** | `-fast` = specialist + registry L1 system prompt + legal-intel overlay; **Queen skipped**. Counsel-grade = Queen + multi-agent + CoT. Do not route `-fast` through Queen to get “agent intelligence.” |
| **Prompt engineering** | **No path sends raw user text alone.** All paths run safety pipeline + (when agent resolves) layered registry prompts. Partner `-fast` skips Queen `analyzePrompt`, skips RAG when doc-less, skips CoT/confidence scorer; still runs `promptEnhancementPipeline.enhance()`. |
| **Registry** | **164 agents** per jurisdiction file under `config/agent-registries/`; loaded via `agent-registry-loader.ts`. Each agent embeds §0 security constitution (23-section XML). |

---
## A.0 NSP ~60s draft timeout symptom (2026-09-07)

**RCA (session `620c1a03`):** The **~60s draft symptom** is **not** a gateway hang — it is **bare `legal-draft`** on the sync orchestrate path (**~70–94s** Opus counsel) colliding with the NSP/client **~55–60s abort** budget.

**Fix:** Call **`legal-draft-fast`** (~**7s** sync specialist) **or** send **`syncTimeoutMs: 90000`** / header **`X-NYV-Partner-Sync-Timeout-Ms: 90000`** (sync-budget auto-route to `-fast`); for progressive UX use **`POST /api/nv/orchestrate/stream`** — measured stream **TTFB ~42ms** on `legal-draft-fast`.

| Wrong (what partners see) | Right (integration) |
|---------------------------|---------------------|
| Sync **`legal-draft`** from UI/BFF threads | **`legal-draft-fast`** or counsel **worker + async poll** |
| No sync budget / default bare taskType | **`syncTimeoutMs: 90000`** or explicit **`-fast`** alias |
| Interpret **60s timeout** as NYV outage | Bare counsel sync needs **~70–94s** Opus wall time |
| Block UI until full JSON sync returns | **Stream** — **~42ms TTFB**, then token deltas |

Probe: `scripts/_ec2-draft-stream-ttfb-probe.sh`



## A. GO profile draft-fast — cold latency RCA

### A.1 Live probe results

**Command:** `npm run demo:probe:draft-latency:ec2`  
**SSM:** `74ff4861-4d88-42d8-8e9d-9fecb1ce421f` · stamp `6b665834`  
**Deploy:** `2026-09-02T1228Z-aws-ssm-d67dce2c`

| Scenario | Wall ms | taskType | path | model | content_len |
|----------|---------|----------|------|-------|-------------|
| draft-fast-cold | **10,693** | legal-draft-fast | specialist | Haiku 4.5 | 4,007 |
| draft-fast-warm | **59** | legal-draft-fast | specialist | Haiku 4.5 | 4,170 |
| draft-full-cold | **73,179** | legal-draft | specialist | Opus 5 | 9,422 |
| chat-fast-cold | **28,731** | legal-chat-fast | specialist | Haiku 4.5 | 12,048 |

Prior post-deploy probe (SSM `3f2a6e9d`): draft-fast cold **12.45s**, warm **73ms**.  
Pre-fix baseline (SSM `d9f570f4`): draft-fast cold **18,597ms**.

Probe script: `scripts/_ec2-draft-latency-comparison-probe.sh` — reports wall time only (no per-stage breakdown in response JSON today).

### A.2 Why cold is ~10–12s, not ~5–8s

**Dominant cost: LLM completion time**, not NYV routing.

Evidence chain:

1. **RAG removed on doc-less draft-fast** (`NV-FAST-DRAFT-NORAG-001`):

```289:297:nyayavigya-platform-312/src/utils/nv-partner-platform.ts
export function shouldSkipRagForPartnerFastDraft(
  taskType: string | undefined,
  hasDocumentPayload: boolean,
  enableRAG?: boolean,
): boolean {
  if (!isPartnerExplicitFastDraftAlias(taskType)) return false;
  if (hasDocumentPayload) return false;
  if (enableRAG === true) return false;
  return true;
}
```

2. **Queen skipped** — `partnerLean=true` for `-fast` → adaptive router returns `specialist` immediately:

```186:198:nyayavigya-platform-312/src/orchestration/nv-adaptive-router.ts
  if (input.partnerLean) {
    return {
      path: 'specialist',
      reason: 'partnerSyncLean opt-in — single-agent only (Queen skipped; quality gates still ON)',
      ...
      requireCoT: !!input.enableCoT,
      requireMakerChecker: false,
```

3. **CoT forced off** on `-fast` (`NV-FAST-COT-OFF-001`):

```305:311:nyayavigya-platform-312/src/utils/nv-partner-platform.ts
export function resolvePartnerDispatchEnableCoT(
  taskType: string | undefined,
  bestQualityEnableCoT: boolean,
  adaptiveRequireCoT?: boolean,
): boolean {
  if (isPartnerExplicitFastAlias(taskType)) return false;
```

4. **Context budgets = `simple` + `partnerSlaFast`** — no partner RAG floor (16 chunks / 45s):

```882:893:nyayavigya-platform-312/src/services/nv-client.ts
    const specialistComplexity = slaFastTask
      ? 'simple'
      : ...
    const ctxBudgets = resolveContextBudgets(
      options.forceLegalBestOutcome && !slaFastTask ? 'very_complex' : specialistComplexity,
      {
        partnerBestOutcome: options.forceLegalBestOutcome === true,
        partnerSlaFast: slaFastTask,
      },
    );
```

```123:140:nyayavigya-platform-312/src/orchestration/nv-context-budgets.ts
  if (opts?.partnerBestOutcome && !opts?.partnerSlaFast) {
    const floorK = envInt('NYV_PARTNER_RAG_TOP_K', 16);
    const floorMs = envInt('NYV_PARTNER_RAG_TIMEOUT_MS', 45_000);
    ...
  }
```

5. **Warm path proves NYV overhead is negligible** — 59ms total including HTTP; cache hit in `nv-client.ts` pre-RAG LM cache (`NV-LMCACHE-HOTPATH-001`).

### A.3 Remaining NYV stages (cold, specialist path)

| Stage | Est. cost | Notes |
|-------|-----------|-------|
| SDK auth + tenant scope | <100ms | Unchanged |
| Adaptive router + quality envelope setup | <50ms | `partnerLean` short-circuit |
| Complexity assessment | **skipped** | `if (!partnerLean)` at orchestration ingress |
| Safety pipeline pre-gate (13 steps) | ~100–300ms | PII, compliance, agent audit |
| Agent auto-select (`agentKey: auto`) | ~50ms | `resolveAgentByCapability(taskType)` |
| Layered system prompt assembly | ~50–150ms | L1 + legal-intel overlay (`drafting` task class) |
| Prompt enhancement pipeline | ~50–200ms | Still runs when `enableOrchestration=true` |
| **LLM Haiku completion** | **~8–11s** | ~4k char output despite “one sentence” probe prompt |
| Hallucination + citation (async) | non-blocking | Safety retained |
| Confidence scorer | **skipped** | `if (!slaFastExplicit)` |
| Response sanitize + envelope | <50ms | CoT stripped for partners |

**LLM share of cold wall time: ~85–90%.**

The probe asks for a full bail/SLP skeleton but Haiku was capped at **1,024 completion tokens** (`NYV_PARTNER_MAX_TOKENS_DRAFT_FAST`), truncating mid-paragraph — measured on nysdev 2026-09-07: `completion_tokens=1024`, `content_len≈4323` vs bare `legal-draft` **5190**. **Fix (2026-09-07):** default raised to **4,096**; chat-fast stays **768**.

```708:710:nyayavigya-platform-312/src/utils/nv-partner-platform.ts
  const draftFastFloor = envPartnerToken('NYV_PARTNER_MAX_TOKENS_DRAFT_FAST', 4_096);
  /** NV-FAST-CHAT-SLA-001 — doc-less FAQ answers, not counsel memos. */
  const chatFastFloor = envPartnerToken('NYV_PARTNER_MAX_TOKENS_CHAT_FAST', 768);
```

**Tiering:** `legal-chat-fast` → 768 (FAQ latency); `legal-draft-fast` → 4096+ (full counsel skeleton); bare `legal-draft` → partner floor 16,384.

### A.4 Recommended next optimization (plan only — not implemented)

**Highest leverage, lowest risk:**

1. **Partner-side:** For Describe & Generate / one-line prayers only, send `maxTokens: 512` and a tight instruction (“Return ONLY the Prayer paragraph, ≤120 words”). NYV floor for draft-fast is **4,096** — partners may go lower when they truly want a short fragment.

2. **NYV-side (needs eval gate):** Add stage timing to orchestration metadata (`safetyMs`, `promptAssemblyMs`, `llmMs`) in probe responses — enables evidence-based tuning without guessing.

3. **NYV-side (behavioral — defer):** Skip `promptEnhancementPipeline.enhance()` when `slaFastExplicit` (mirror confidence scorer skip at `nv-client.ts:1528`). Estimated savings **<200ms** — not worth behavior change without eval.

4. **Do NOT:** Re-enable RAG on doc-less draft-fast, lower hallucination/citation gates, or route `-fast` through Queen.

---

## B. NSP / NYM team integration checklist

### B.1 Connection

| Item | Value |
|------|-------|
| Base URL | `https://api.nyayasiddhi.online` |
| Auth | `X-API-Key: <<NYV_SDK_KEY_NSP>\|NYM>` |
| Platform header | `X-NYV-Platform: nsp` or `nym` (**required** for best-outcome depth) |
| Jurisdiction | `IN` only (server-enforced for NSP/NYM) |
| Correlation | `X-Request-Id: <uuid>` |

```ts
const nyv = new NyvClient({
  apiKey: process.env.<NYV_SDK_KEY_NSP>!,
  baseUrl: 'https://api.nyayasiddhi.online',
  defaultJurisdiction: 'IN',
  defaultPlatform: 'nsp',
  timeout: 90_000,              // interactive
  orchestrateTimeoutMs: 600_000 // counsel-class worker only
});
```

### B.2 API paths (canonical)

| Purpose | Path | Notes |
|---------|------|-------|
| **Primary AI orchestration** | `POST /api/nv/orchestrate` | Queen/specialist adaptive router |
| Stream (SSE) | `POST /api/nv/orchestrate/stream` | Partner streaming |
| Legacy alias | `POST /api/nv/v1/sdk/orchestrate` (+ `/stream`) | Same router (`NV-ORCH-ALIAS-001`) |
| SDK gateway surface | `/api/nv/gateway/*` | Documents, OCR, research, usage, **embeddings**, **prompt/improve** |
| SDK v1 surface | `/api/nv/v1/sdk/*` | Patra, CNR, ecosystem docs, intelligence, **prompt/improve** alias |
| Patra Mitra | `POST /api/nv/v1/sdk/patra-mitra/sessions` → `/chat` | Short doc Q&A |
| CNR autofill | `POST /api/nv/v1/sdk/cnr/resolve` | Corpus-only default; `profile=caseCreate` for deep tier; Nyayasearch UI two-tier (2026-09-04) |
| Document autofill QA | Console `/console/autofill-qa` | Review conflicts / low-confidence / absent fields via orchestrate `courtDocFieldBlock` (P2-7, deploy `2026-09-06`) |
| CAM | `/api/nv/v1/sdk/cam/*` | Consent-aware model access |
| Voice STT | `POST /api/nv/legal-chat/voice/transcribe` | SDK key OK (before JWT gate) |

Mount order reference: `src/index.ts:717-731`.

### B.3 taskType aliases — critical

**Honoured `-fast` aliases (exactly four):**

- `legal-chat-fast`
- `legal-draft-fast`
- `doc-draft-fast`
- `document-draft-fast`

Kebab or snake accepted. **Any other `-fast` suffix is NOT recognised** → full counsel depth.

| taskType | Class | Client timeout | Depth |
|----------|-------|----------------|-------|
| `legal-draft-fast` | Interactive | 90s | Specialist, Haiku-first, no Queen |
| `legal-chat-fast` | Interactive | 90s | Specialist, doc-less RAG skip |
| `doc-draft-fast` | Interactive | 90s | Same as draft-fast |
| `legal-draft` / `drafting` / `document-drafting` | **Counsel** | 600s worker | Queen + CoT (NSP default) |
| `legal-draft-deep` | Counsel | 600s | Always Queen |

Detection: `isPartnerSlaFastTask()` in `nv-partner-platform.ts:355-406`.

### B.4 Request flags

| Field | Guidance |
|-------|----------|
| `enableCoT` | **Default OFF on `-fast`** (forced off server-side). Only send `true` on counsel-class tasks. |
| `enableRAG` | Omit on doc-less `-fast` (RAG skipped). Send `true` or attach docs/`ragDocumentIds` when grounding needed. |
| `enableRAG: false` | Honoured — explicit opt-out respected (`NV-CALLER-FLAG-CONTRACT-001`) |
| Documents | Use `ragDocumentIds` after EDJ/index — do not paste 40KB into `prompt` |
| `partnerSyncLean` | Ignored for NSP/NYM unless `NYV_ALLOW_NSP_NYM_LEAN=1` — use `-fast` taskType instead |
| `syncTimeoutMs` / `X-NYV-Partner-Sync-Timeout-Ms` | When ≤90s (default `NYV_PARTNER_SYNC_BUDGET_MS`), bare `legal-chat` / `legal-draft` auto-route to `-fast` (`NV-PARTNER-SYNC-TASKTYPE-001`, deploy `2026-09-06`). Send `qualityMode: counsel` or `-deep` to keep Queen. |
| `routingMode: fast` / `X-NYV-Routing-Mode: sla` | Same auto-route to `-fast` for bare counsel aliases |
| `orchestrationMode` | Do not send — forces Queen regardless of `-fast` |

### B.5 Cache behavior

Identical `prompt` + same agent/jurisdiction/tenant → **~59–75ms** warm (LM cache pre-RAG).  
Partners should reuse `sessionId` for multi-turn memory when RAG is on.

### B.6 Request body construction

Prompt aliases (NSP voice/STT copy-resend): `message`, `text`, `transcript`, `query`, `messages[]` → canonical `prompt`:

```87:98:nyayavigya-platform-312/src/utils/nv-partner-platform.ts
const PARTNER_PROMPT_KEYS = [
  'prompt', 'query', 'message', 'text', 'transcript', 'content', ...
] as const;
```

Full orchestrate body (from `nv-partner-platform.ts` + endpoint matrix):

```json
{
  "prompt": "Draft anticipatory bail prayer under BNSS for FIR 123/2026",
  "taskType": "legal-draft-fast",
  "jurisdiction": "IN",
  "sessionId": "<matter-thread-uuid>",
  "ragDocumentIds": ["<indexed-doc-id>"],
  "agentKey": "auto",
  "maxTokens": 4096,
  "parameters": {
    "highCourt": "High Court of Karnataka",
    "district": "Bengaluru Urban",
    "courtName": "Sessions Judge, Bengaluru Urban"
  }
}
```

| Field | Required | Source |
|-------|----------|--------|
| `prompt` | Yes (or alias) | User instruction |
| `taskType` | **Yes** | SLA + depth selector |
| `jurisdiction` | Yes | `IN` for NSP/NYM |
| `sessionId` | Multi-turn | Minted or partner-supplied |
| `ragDocumentIds` | When docs indexed | After EDJ/shared-docs |
| `agentKey` | Optional | Default `auto` |
| `maxTokens` | Optional | Floor applied per task class |
| `parameters` | Draft context | HC/district/court metadata |

### B.7 Endpoints — CNR, Patra, CAM

| Surface | Endpoint | SDK |
|---------|----------|-----|
| Patra Mitra | `/api/nv/v1/sdk/patra-mitra/*` | `nyv.patraMitra.*` |
| CNR resolve | `POST /api/nv/v1/sdk/cnr/resolve` | `nyv.cnr.resolve` — CNR **or** diary (see §B.7.1) |
| CAM | `/api/nv/v1/sdk/cam/*` | Consent-gated model catalog |

#### B.7.1 Diary lookup (NSP / NYM) — same endpoint as CNR

**Do not** call `/api/nv/v1/sdk/diary/resolve` (retired, 404). Send `diaryNumber` or `diary` on `POST /api/nv/v1/sdk/cnr/resolve`.

```http
POST /api/nv/v1/sdk/cnr/resolve
X-API-Key: <NYV_SDK_KEY_NSP>
X-NYV-Platform: nsp
Content-Type: application/json

{
  "diaryNumber": "2023 INSC 1081",
  "options": { "courtType": "sc", "includeDocuments": true, "profile": "default" }
}
```

| Format | Example | `options.courtType` |
|--------|---------|---------------------|
| SC INSC (canonical in corpus) | `2023 INSC 1081` | `sc` |
| SC slash diary | `264/2024` | `sc` |
| HC numeric filing ref | `256000007942025` | `hc` |
| DC case_no | numeric / slash from corpus | `dc` |

**Response:** `data.lookupType: "diary"`, `data.status: "found"|"not_found"|"suggested"`, `fields.*`, optional `documents[]`. **`claimEcourts: false` always** (corpus, not live eCourts). **`nextHearingDate` is null** in corpus v1.

**Errors:** `503 DIARY_CORPUS_BLOCKED` if gateway `NYV_DIARY_CORPUS_ENABLED=0`; `504 CNR_UPSTREAM_TIMEOUT` / busy when RDS contended — **retryable**, not “case missing”.

**Health:** `GET /api/nv/v1/sdk/cnr/health` → `diaryCorpus: "ready"`, `lookupTypes: ["cnr","diary"]`.

Full probe evidence: `documents/working/CNR-NYS-ATHENA-OPTIMIZATION-2026-09-02.md` §Diary + post-index accept SSM `95595a6f`.

### B.8 What NOT to call

| Path | Why |
|------|-----|
| `POST /api/nv/gateway/documents/draft` | Hardcodes Queen + CoT — `-fast` SLA never applies |
| `/api/nv/legal-chat/send` (etc.) | JWT-only — SDK key → 401 |
| `POST /api/nv/stream` | Console AG-UI JWT |
| Direct `nyayasearch.nyayasiddhi.online` | Bypasses NYV auth/metering |
| Sync `legal-draft` from browser/BFF | 55s abort class — use worker + `202` poll |

`Idempotency-Key` header is **not honoured** server-side yet — client-side de-dupe required.

### B.9 NSP routing crosscheck (2026-09-04)

**Verdict:** Official NSP integration is **fully served via NYV** (`https://api.nyayasiddhi.online`) when using SDK + documented routes. NYS (`nyayasearch`) is an **internal upstream** for corpus/RAG only — not a partner bypass.

| NSP capability | NYV endpoint | Via NYV? | Probe (SSM `0ebb8f67`) |
|---|---|---|---|
| CNR + diary | `POST /api/nv/v1/sdk/cnr/resolve` | Yes → NYS proxy | TSWL/RJHC **200 found** |
| Orchestrate chat/draft | `POST /api/nv/orchestrate` (`*-fast`) | Yes → NYV LLM ring | chat-fast **200 ~3.6s**; draft-fast **200 ~7.2s** |
| Prompt improve | `POST /api/nv/v1/sdk/prompt/improve` | Yes (NYV only) | Route live; **not in typed SDK yet** |
| Embeddings | `/api/nv/v1/sdk/documents/embeddings` (+ aliases) | Yes → NYV cascade | Server-side keys |
| Caselaw search | `/api/nv/knowledge/caselaw/search` | Yes → NYS proxy | hybrid **200/0 hits**; FTS **200/1000 hits** — use `mode=fts` interim |
| Patra / CAM / EDJ / research | `/api/nv/v1/sdk/*` | Yes | All NYV-gated |

**Bypass risks (NSP team must verify):** NSP Pro BFF (`/ns/v1/*`) must forward to NYV — grep NSP repo for `nyayasearch`, `openai.com`. Never embed `NYV_SDK_KEY_NSP` in browser. Do not use JWT-only Console paths with SDK key.

---

## C. Agentic AI vs direct fast path — architecture

### C.1 Routing decision tree

```
POST /api/nv/orchestrate
        │
        ├─ taskType matches *-fast alias?
        │     YES → isPartnerSlaFastTask() → partnerLean=true
        │           → specialist path (Queen SKIPPED)
        │
        ├─ bare legal-draft / legal-chat + NYV_NSP_COUNSEL_QUEEN=1 (default)?
        │     YES → partnerLean=false → Queen + CoT + maker-checker
        │
        └─ engageQueenForced / orchestrationMode / -deep?
              YES → Queen path
```

Key env: `NYV_NSP_COUNSEL_QUEEN=1` (default) makes bare counsel tasks Queen-depth for NSP/NYM.

### C.2 When agents ARE used vs skipped

| Path | Queen | Registry agent | System prompt |
|------|-------|----------------|---------------|
| `-fast` partner | **No** | Yes (`agentKey: auto` → capability match) | L1 single-shot + legal-intel overlay |
| Counsel `legal-draft` | **Yes** | Multiple leaves via Queen decomposition | Full L0/L1 per leaf |
| Console legal chat | **Yes** | Queen-selected specialists | Per-leaf layered prompts |
| Hub web-search | No (SERP-only) | Specialist + live search | Minimal |

### C.3 Can `-fast` use legal draft agent personas?

**Partially — by design:**

- Specialist path **does** load a registry agent (e.g. document-drafting capability) and inject its **L1 system prompt** + task overlay.
- It **does not** run Queen decomposition, multi-agent fan-out, or maker-checker.
- Passing `agentKey: "document-drafting-agent"` is a routing hint; unresolved keys fall back gracefully.

**Should you route `-fast` through Queen for “smarter” drafts?** **No.** Measured defect when `-fast` was ignored: **84.8s** Written Statement with Queen+CoT vs **~10s** specialist. The `-fast` alias is a **caller latency contract**.

### C.4 CoT default wiring

| Context | CoT default |
|---------|-------------|
| NSP/NYM `-fast` | **OFF** (forced) |
| NSP/NYM counsel (`legal-draft`) | ON when `NYV_NSP_COUNSEL_QUEEN=1` |
| Enterprise Console (Queen) | Task-dependent; SME runs force maker-checker |
| Partner JSON leak | Stripped by `NV-COT-PARTNER-STRIP-001` |

### C.5 Recommendation

| Tier | Use |
|------|-----|
| **Counsel-grade** | `legal-draft`, Queen mesh, 600s worker, full RAG/memory |
| **Interactive / Describe & Generate** | `legal-draft-fast`, specialist + registry L1 + legal-intel overlay, 90s |
| **Do not merge** | Never substitute Queen depth for `-fast`; never use bare `legal-draft` in sync UI |

---

## D. Agent registry + system prompts inventory

### D.1 Registry location and loading

| Layer | Path |
|-------|------|
| **Runtime SSoT** | `nyayavigya-platform-312/config/agent-registries/Nyayavigya-Legal-registry-{Default,IN,UK,EU,US,GC,SG}.json` |
| **Legacy reference** | `config/agents/agents-master.json`, `config/agents/system-prompts.json` |
| **Loader** | `src/config/agent-registry-loader.ts` |
| **Service facade** | `src/services/agent-registry-service.ts` |
| **Alias map** | `config/agent-registries/agent-id-aliases-v5.1.0.json` |

Load flow: `getRegistryPath(jurisdiction)` → parse JSON → overlay via `NV_PRIMARY_JURISDICTION` → `getActiveAgents()` / `getAgent(id)`.

**Totals:** 164 agents per jurisdiction file (`src/constants/nv-registry-stats.ts:24-26`).

Forensic archived flat merge (1042 agents): `archive/v5.0.0/` — only when `NV_REGISTRY_FORENSIC_MODE=1`.

### D.1.1 Agent registry reality (honest — 2026-09-07)

| Claim | Reality |
|-------|---------|
| **164 agents** | **Catalog** — all load at runtime; not all are reachable on every partner path |
| **NSP `-fast` orchestrate** | **One named specialist** per request (`resolveAgentByCapability` → registry agent, Queen CoT off) — typically research **A-052** (chat-fast) or drafting **A-003** (draft-fast), not `agentKey=generic` |
| **Bare `legal-chat` / `legal-draft` (counsel)** | **Queen mesh** when `NYV_NSP_COUNSEL_QUEEN=1` (default) and no sync-budget auto-route — multi-leaf decomposition, full RAG/memory |
| **P0 alias fix (2026-09-07)** | **`NV-PARTNER-TASKTYPE-ALIAS-001`** — explicit `-fast` taskTypes (`legal-chat-fast`, `legal-draft-fast`, `doc-draft-fast`, `document-draft-fast`) now share the same capability alias table as bare partner taskTypes; fixes silent `generic` fallback that discarded specialist system prompts |
| **Multilingual** | **Partial** — Sarvam-M pipeline + `multi-language-output` agents exist; partner `-fast` paths default English; Hindi/regional output requires explicit language params and is not fully UAT-closed |

Capability alias SSoT: `src/services/nv-agent-capability-alias.ts` · probe: `scripts/nv-probe-agent-selection.ts` (28/28 partner taskTypes bind post-fix).

### D.2 Prompt structure (23-section XML per agent)

Each agent `systemPrompt` contains tagged sections:

| Section | Purpose |
|---------|---------|
| `section_0_security_constitution` | §0 NSS — absolute, immutable (OWASP LLM Top 10) |
| `section_1_identity` | Agent persona |
| `section_2_mandate` | Role scope |
| `section_3_jurisdiction` | BNS/BNSS/BSA rules (IPC repeal) |
| `section_4_reasoning` | IRAC / 10-step protocol |
| `section_5_evidence` | Standards of proof |
| `section_6_citation` | Citation marker contract |
| `section_17_output` | Response shape |
| `section_18_quality_checklist` | Pre-delivery self-check |
| … | Additional governance sections |

Parser/assembler: `src/services/nv-agent-prompt-bundle.ts` — `parseAgentPromptBundle()`, `assembleLayeredAgentSystemPrompt()`.

**Load-once architecture:**

- **Turn 1 / full:** L0 entire constitution
- **Single-shot / Turn 2+:** L1 identity + mandate + short §0 binding + depth-selected operative sections

### D.3 Partner-specific overlays

| Overlay | File | When attached |
|---------|------|---------------|
| Universal legal intelligence | `src/services/nv-legal-intelligence-overlay.ts` | All safety-ring paths; `buildUniversalLegalIntelligenceOverlay()` |
| Drafting SME rules | `src/services/nv-legal-drafting-prompt.ts` | Draft task kinds; HC paper-book structure |
| Partner counsel sys (orchestrate) | `nv-orchestration-routes.ts:1420-1431` | NSP/NYM when no client `systemPrompt` |

NSP/NYM partner overlay depth on `-fast` doc-less: **`micro`** (`nv-client.ts:760-762`).

### D.4 Security prompts (22+ / §0 ring)

| Component | File | Attachment |
|-----------|------|------------|
| §0 per-agent constitution | Embedded in each registry agent | Parsed at prompt assembly; L1 binding every request |
| Safety pipeline (13-step) | `src/services/safety-pipeline.ts` | **Per request**, pre-LLM in `nv-client.ts:621-652` |
| Compliance check | `nv-client.ts:135` (`complianceCheck`) | Input + output |
| PII redaction | `nv-client.ts:101` (`redactPII`) | Pre-processing |
| Security monitor middleware | `src/services/nv-security-monitor.ts` | `/api/nv/*` when `NYV_F_SECURITY_MONITOR=1` |
| Hallucination + citation | Async post-LLM | Non-blocking safety ring |

**Not a separate `nv-security-prompts.ts` file** — security is §0 inside each agent prompt + runtime safety pipeline.

### D.5 Prompt enhancement pipeline

| Component | File |
|-----------|------|
| Unified enhancer | `src/orchestration/nv-prompt-enhancement-pipeline.ts` |
| Queen analyzePrompt heuristic | `src/orchestration/nv-queen-orchestrator.ts:2964+` (private) |
| Token budgets | `src/config/nv-prompt-budget.ts` |
| Context budgets | `src/orchestration/nv-context-budgets.ts` |

---

## E. Prompt engineering crosscheck — all request paths

Legend: **YES** = actively applied · **NO** = skipped · **PARTIAL** = conditional · **N/A** = not on this path

### E.1 Partner orchestrate — `legal-chat-fast`

| Stage | Applied? | Evidence |
|-------|----------|----------|
| Queen `analyzePrompt` | **NO** | Complexity skipped when `partnerLean` (`nv-orchestration-routes.ts:566-568`) |
| `promptEnhancementPipeline.enhance()` | **YES** | `nv-client.ts:1192-1233` |
| Context budgets (simple/fast) | **YES** | `nv-client.ts:882-893`, `partnerSlaFast: true` |
| Agent system prompt (L1) | **YES** | `assembleLayeredAgentSystemPrompt` mode `single_shot` (`nv-client.ts:809-818`) |
| Security §0 + safety pipeline | **YES** | `nv-client.ts:621-652`, registry §0 |
| RAG | **NO** (doc-less) | `shouldSkipRagForPartnerFastChat()` |
| Memory | **NO** (doc-less) | Tied to RAG in `resolveNspNymBestOutcomeQuality` |
| Queen synthesis | **NO** | `partnerLean` → specialist |
| CoT | **NO** | `resolvePartnerDispatchEnableCoT` |
| Confidence scorer | **NO** | `nv-client.ts:1528` |

### E.2 Partner orchestrate — `legal-draft-fast`

| Stage | Applied? | Evidence |
|-------|----------|----------|
| Queen `analyzePrompt` | **NO** | Same partnerLean skip |
| `promptEnhancementPipeline.enhance()` | **YES** | Same pipeline |
| Context budgets | **YES** | `simple` + `partnerSlaFast` |
| Agent system prompt | **YES** | Drafting task class → `drafting` budget 24k tokens |
| Legal-intel overlay | **YES** | `overlayDepth: micro` when doc-less fast |
| Security ring | **YES** | Full pre/post gates |
| RAG | **NO** (doc-less) | `shouldSkipRagForPartnerFastDraft()` |
| Memory | **NO** (doc-less) | Same as chat-fast |
| Queen synthesis | **NO** | Specialist only |
| CoT | **NO** | Forced off |

### E.3 Console legal chat — `POST /api/nv/legal-chat/send`

| Stage | Applied? | Evidence |
|-------|----------|----------|
| Queen `analyzePrompt` | **YES** | Inside `queenOrchestrator.orchestrate()` |
| `promptEnhancementPipeline` | **PARTIAL** | Via Queen leaf → `nv-client` on each leaf |
| Context budgets | **YES** | Queen Step-0 parallel memory∥RAG |
| Agent system prompts | **YES** | Per leaf via `nv-queen-leaf-prompt.ts` |
| Security ring | **YES** | Queen + safety envelope |
| RAG | **YES** (default) | Unless caller disables |
| Memory | **YES** | Session-scoped |
| Queen synthesis | **YES** | Primary path (`nv-legal-chat-routes.ts:769`) |
| CoT | **YES** (task-dependent) | SME runs force maker-checker |

### E.4 Counsel-grade — `legal-draft` (bare)

| Stage | Applied? | Evidence |
|-------|----------|----------|
| Queen `analyzePrompt` | **YES** | `partnerLean=false` when counsel Queen ON |
| Prompt enhancement | **YES** | Full orchestration |
| Context budgets | **YES** | Partner RAG floor (topK 16, 45s) when not `-fast` |
| Agent system prompts | **YES** | Queen multi-leaf full depth |
| Security ring | **YES** | All gates |
| RAG | **YES** | Unless explicit opt-out |
| Memory | **YES** | When userId present |
| Queen synthesis | **YES** | Default for NSP/NYM counsel |
| CoT | **YES** | `wantsNspCounselQueen` default |

### E.5 Critical question: raw user text to LLM?

**No.** Every path applies at minimum:

1. PII redaction + compliance check (`nv-client.ts:574-576`)
2. Safety pipeline pre-processing (`nv-client.ts:621-652`)
3. System prompt (registry L1 and/or legal-intel overlay and/or partner counsel sys)
4. Prompt enhancement wrapper (role/domain context block) when `enableOrchestration=true`

The **closest to “minimal engineering”** is partner `-fast` doc-less paths — but they still carry §0 security binding, L1 agent identity, legal-intel overlay (micro depth), and enhancement pipeline scaffolding. They deliberately **omit** Queen decomposition, RAG, memory, and CoT.

---

---

## G. Embeddings input shapes (NV-NSP-EMBED-INPUT-001)

**Problem:** NSP callers sending docs-pipeline `{ documents: [{ id, content }] }` to gateway embeddings paths received HTTP **400** (~76-byte validation body, 5–11 ms latency — not an OpenAI failure).

**Fix deploy:** `2026-09-03T0555Z-aws-ssm-689caf64`

### G.1 Canonical paths

| Path | Auth | Notes |
|------|------|-------|
| `POST /api/nv/gateway/documents/embeddings` | SDK key | Primary gateway surface |
| `POST /api/nv/v1/sdk/documents/embeddings` | SDK key | v1 alias (same handler) |
| `POST /api/nv/sdk/docs-pipeline/documents/embeddings` | SDK key | Per-document IDs returned |

Mount: `src/index.ts:717` (`/api/nv/gateway`) and `src/index.ts:731` (`/api/nv/v1/sdk`).

### G.2 Accepted request bodies

All three shapes normalize to `string[]` via `normalizeGatewayEmbeddingsTexts()` (`src/utils/nv-embeddings-request-normalize.ts`):

```json
{ "texts": ["Section 302 BNS bail provision", "Anticipatory bail grounds"] }
```

```json
{ "content": "Single clause or paragraph to embed" }
```

```json
{
  "documents": [
    { "id": "doc-1", "content": "Indemnity clause text…" },
    { "id": "doc-2", "content": "Limitation period paragraph…" }
  ]
}
```

**400 response** when none of the above yield non-empty strings:

```json
{
  "success": false,
  "error": "Missing required field: texts (array of strings), or documents ([{ id, content }]), or content (string|string[])"
}
```

### G.3 Example (gateway)

```bash
curl -sS -X POST 'https://api.nyayasiddhi.online/api/nv/v1/sdk/documents/embeddings' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: <<NYV_SDK_KEY_NSP>>' \
  -H 'X-NYV-Platform: nsp' \
  -d '{"documents":[{"id":"d1","content":"Anticipatory bail under BNSS"}]}'
```

Expected: `success: true`, `data.embeddings[]`, `data.latencyMs`.

---

## H. Prompt Improve API (recommended — NV-PROMPT-IMPROVE-FAST-001)

> **Post `2026-09-16T1357Z` (NV-PROMPT-IMPROVE-USER-001):** `improvedPrompt` must contain **only** user-facing brief text — no `NV-LEGAL-INTEL-FORCE-001`, registry §0 bindings, or legal-intel overlay markers. Internal enrichment stays in `metadata.enhancementsApplied`.

**Use case:** Enrich a user draft prompt **before** calling `/api/nv/orchestrate` — without Queen latency (no swarm, no RAG, no CoT, no LLM round-trip on v1).

### H.1 Why not `taskType: prompt-improve` on orchestrate?

There is **no** dedicated `prompt-improve` taskType on orchestrate today. Routing prompt improvement through orchestrate would invoke the adaptive router and potentially Queen — measured cold paths are **10–73 s**, not suitable for inline UI typing assist.

### H.2 Recommended endpoint

| Canonical | Alias |
|-----------|-------|
| `POST /api/nv/v1/sdk/prompt/improve` | `POST /api/nv/gateway/prompt/improve` |

Same SDK key auth as orchestrate (`X-API-Key` + `X-NYV-Platform: nsp|nym`).

### H.3 Request / response

**Request:**

```json
{
  "prompt": "Draft bail application for FIR 456/2026 Karnataka",
  "taskType": "legal-draft-fast",
  "jurisdiction": "IN",
  "context": {
    "highCourt": "High Court of Karnataka",
    "district": "Bengaluru Urban"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "improvedPrompt": "Draft bail application for FIR 456/2026 Karnataka (High Court of Karnataka, Bengaluru Urban). Include sections: facts, grounds, prayer, verification.",
    "metadata": {
      "enhancementsApplied": [
        "analyzePrompt-lite",
        "legal-intel-overlay-compact",
        "registry-agent-hints",
        "security-section0-binding",
        "context-injection",
        "output-optimization",
        "tone-verbosity"
      ],
      "model": "deterministic-v1",
      "latencyMs": 42,
      "cacheHit": false,
      "complexity": "moderate",
      "intent": "legal_drafting",
      "agentId": "document-drafting-agent",
      "originalLength": 48,
      "improvedLength": 312
    }
  }
}
```

### H.4 What runs (fast path)

| Stage | LLM? | Est. latency |
|-------|------|--------------|
| LM cache lookup (identical input) | No | **<100 ms** |
| `assessPromptComplexity()` (Queen analyzePrompt lite) | No | ~5 ms |
| Registry agent resolve + §0 security binding excerpt | No | ~20 ms |
| `buildUniversalLegalIntelligenceOverlay(compact)` | No | ~10 ms |
| `promptEnhancementPipeline.enhance()` (CoT off) | No | ~30 ms |
| **Total cold (v1)** | **No** | **~50–200 ms** |

Implementation: `src/services/nv-prompt-improve-fast.ts` → route in `nv-sdk-gateway-routes.ts`.

### H.5 Integration pattern

```ts
// 1. Improve prompt (fast, optional)
const improved = await nyv.post('/api/nv/v1/sdk/prompt/improve', {
  prompt: userText,
  taskType: 'legal-draft-fast',
  jurisdiction: 'IN',
});

// 2. Orchestrate with improved prompt
const draft = await nyv.orchestrate({
  prompt: improved.data.improvedPrompt,
  taskType: 'legal-draft-fast',
  jurisdiction: 'IN',
});
```

### H.6 Deferred — semantic LLM rewrite (phase 2)

For **semantic** rewrites (not just overlay injection), a future `mode: "semantic"` could add a single Haiku call via the safety ring (~1–2 s cold). Not shipped in v1 to preserve `<2 s` SLA and NV-LLM-001 compliance without full orchestrate overhead.

| Decision | v1 (shipped in repo) | Phase 2 (defer) |
|----------|----------------------|-----------------|
| Endpoint | `POST /api/nv/v1/sdk/prompt/improve` | Same |
| Intelligence | Deterministic overlay + pipeline | + Haiku rewrite |
| Cold latency | ~50–200 ms | ~1–2 s |
| Deploy | Document + code; live deploy optional | Requires eval gate |

---

## I. Drafting UX / NSP–NYV responsibility split

**Shipped:** 2026-09-07 · `NV-PARTNER-HUMAN-POLISH-001` + `NV-DRAFT-QUALITY-001` + `NV-ATTESTATION-001`

### I.1 Responsibility matrix

| Concern | NSP builds | NYV exposes |
|---------|------------|-------------|
| Word / Outlook editor chrome | Task pane, ribbon, insert, export | — |
| Draft body generation | Calls `POST /api/nv/orchestrate` | `content`, `curated`, `draftQuality` |
| Human-like voice (no chatbot filler) | Display rules; hide internal markers if any leak | `nv-partner-human-polish.ts` on `-fast` paths |
| Placeholder fill UX | Matter auto-fill primary; inline edit fallback | Placeholders in `content` (`[...]`, `{{...}}`); count in `draftQuality.placeholdersRemaining` |
| Field conflicts | Popup / diff UI for `CONFLICT` | `docparseMeta.conflictFields`, `attestationRequired` |
| Advocate attestation gate | Checkbox + audit log before export | `attestationRequired: boolean` |
| Citations / authorities badge | Render count + link-out | `trust.authoritiesDelivered`, `draftQuality.authoritiesDelivered` |
| Document analyze status | Retry vs cache empty arrays | Top-level `analysisStatus` when court-doc block present |
| Counsel-grade depth | Route bare `legal-draft` async only | Queen + CoT; no `-fast` human polish |

### I.2 Placeholder UX contract

1. **Primary:** NSP matter auto-fill maps known keys → bracket/mustache tokens in `content`.
2. **Fallback:** Inline edit in task pane when `draftQuality.placeholdersRemaining > 0`.
3. **Conflicts:** When `docparseMeta.conflictFields.length > 0` or field `status: CONFLICT`, show resolution popup — do not silently pick a value.

### I.3 Human-like output layers (NYV)

| Layer | Module | When |
|-------|--------|------|
| Prompt ban | `nv-legal-drafting-prompt.ts`, legal-intel overlay | All draft paths |
| Structure attach | `nv-legal-structure-attach.ts` | Draft / counsel (not chat-fast) |
| Fast skeleton fill | `nv-fast-delivery-polish.ts` | `-fast` draft only |
| AI-marker strip | `nv-partner-human-polish.ts` | `-fast` + partnerLean; skips Nyayamitra agents |
| Outcome sanitize | `nv-client-outcome-sanitize.ts` | All partner responses |

**NSP display rules:** Never prefix user-visible draft with "AI generated"; use `riskBadge` + `draftQuality.reviewRecommended` for review badges instead.

### I.4 TaskType routing

| taskType | Queen | RAG default | Human polish | Typical SLA |
|----------|-------|-------------|--------------|-------------|
| `legal-chat-fast` | Skip | Skip when doc-less | Yes | ~5–30s cold |
| `legal-draft-fast` | Skip | Skip when doc-less | Yes | ~5–12s cold |
| `legal-chat` | Optional (NSP flag) | On | No | Minutes |
| `legal-draft` | On (counsel) | On | No | Minutes |

Sync UI threads: **always** send explicit `-fast` aliases; never bare `legal-draft` on a blocking HTTP call.

### I.7 Word selection rewrite — `selectedText` / `content` contract (2026-09-08)

**Shipped (code):** `NV-SELECTION-TEXT-PRIORITY-001` · **Deploy pending** on nysdev.

When the NSP Word task pane rewrites a **highlighted** passage (not the whole document), send the highlight in a **selection key** and the user instruction in **`prompt`**:

| Field | Required | Notes |
|-------|----------|-------|
| `prompt` | Yes | Task, e.g. "Rewrite this clause to favor the Customer." |
| `selectedText` | Yes (rewrite UX) | Word selection / highlight text |
| `documentText` / `documentContent` | Optional | Full file for matter context — NYV **prefers `selectedText`** when both are present |

**Accepted selection aliases (first non-empty wins):** `selectedText`, `selected_text`, `selection`, `selectionText`, `highlightedText`, `_selectedText`.

**Do not** rely on longest-wins among `content` / `documentText` alone when both a short selection and a long file are sent — without `selectedText`, the model may ground on the entire document. Implementation: `selectInlineDocumentText` in `nv-inline-document-prompt.ts`.

```json
{
  "prompt": "Rewrite this clause to be more favorable to the Customer.",
  "selectedText": "CLAUSE 12.1 (LIABILITY CAP): aggregate liability shall not exceed fees paid.",
  "documentText": "<optional full agreement for context>",
  "taskType": "legal-draft-fast",
  "jurisdiction": "IN"
}
```

### I.6 Streaming draft UX (2026-09-08)

**Shipped:** `NV-STREAM-TERMINAL-POLISH-001` — post-stream deterministic polish on partner `-fast` specialist SSE before `run_completed`.

Partners should prefer **`POST /api/nv/orchestrate/stream`** for draft editor UX: tokens arrive early; formatting and `draftQuality` land on completion.

#### SSE event contract

| Event | When | Partner action |
|-------|------|----------------|
| `run_started` | Immediately after auth/credit | Bind `runId`, show spinner |
| `text_delta` | Each provider token (`provisional: true`) | **Append** using `accumulated` (replace if `gated: true`) |
| `text_delta` | Terminal polish correction (`gated: true`, `complete: true`) | Replace editor body with `accumulated` |
| `run_completed` | Full envelope ready | Read `draftQuality`, `curated.sections`, `result`; filing checklist also on `result.validationResults[]` + `result.draftProfile` (mirrored at event root for NSP BFF) |
| `run_finished` | Lifecycle tail | Close stream UI state |
| `[DONE]` | Sentinel | End SSE reader |

#### NSP render contract

1. **During stream:** append `accumulated` on every `text_delta` with `provisional: true`.
2. **On gated delta:** replace entire editor content with `accumulated` (post-polish authoritative body).
3. **On `run_completed`:** persist `draftQuality`, `sessionId`, `orchestrationId`, `auditHash`; drive review badge from `draftQuality.reviewRecommended`.

```typescript
// TypeScript pseudocode — no secrets; keys from your secure store.
const res = await fetch(`${NYV_BASE}/api/nv/orchestrate/stream`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.NYV_SDK_KEY_NSP!,
    'X-NYV-Platform': 'nsp',
  },
  body: JSON.stringify({
    prompt: 'Draft one-paragraph bail prayer under BNSS',
    taskType: 'legal-draft-fast',
    jurisdiction: 'IN',
    maxTokens: 1024,
  }),
});

const reader = res.body!.getReader();
const dec = new TextDecoder();
let buffer = '';
let editorText = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += dec.decode(value, { stream: true });
  for (const block of buffer.split('\n\n')) {
    if (!block.trim()) continue;
    const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
    if (!dataLine || dataLine === 'data: [DONE]') continue;
    const evt = JSON.parse(dataLine.slice(6));
    if (evt.type === 'text_delta') {
      editorText = evt.gated ? evt.accumulated : (evt.accumulated ?? editorText + (evt.delta ?? ''));
      renderEditor(editorText);
    }
    if (evt.type === 'run_completed') {
      const dq = evt.result?.draftQuality;
      setReviewBadge(dq?.reviewRecommended, dq?.placeholdersRemaining);
    }
  }
}
```

#### Sync vs stream polish tradeoff

| Path | TTFB | Final formatting | `draftQuality` |
|------|------|------------------|----------------|
| Sync `legal-draft-fast` | ~4–8s wall | Applied inline in `nv-client` | In JSON `data` |
| Stream `legal-draft-fast` | **~2.7s** first `text_delta` | Terminal polish pass before `run_completed` | In `run_completed.result` |
| Sync bare `legal-draft` | **~59–94s** | Full counsel polish | Yes — but exceeds NSP ~60s budget |

Stream shows **provisional** tokens immediately; a final **gated** `text_delta` may replace the body when deterministic polish normalizes headings (e.g. `**MOST RESPECTFULLY SHOWETH:**`). Partners must honor `gated` replacement — do not concatenate gated deltas.

#### Probe numbers (nysdev, 2026-09-08)

Command: `scripts/_ec2-draft-stream-ttfb-probe.sh`

| Scenario | Typical wall |
|----------|--------------|
| Stream first `text_delta` | **~2.7s** |
| Sync `legal-draft-fast` | **~4–8s** |
| Sync bare `legal-draft` (no budget) | **~59s+** (NSP abort ~55–60s) |

#### Wrong vs right (stream)

| Wrong | Right |
|-------|-------|
| Block UI until sync JSON returns | Stream — show tokens at ~2.7s TTFB |
| Concatenate gated `text_delta` | **Replace** editor from `accumulated` when `gated: true` |
| Ignore `run_completed.draftQuality` | Drive review badge + placeholder UX from `draftQuality` |
| Sync bare `legal-draft` on UI thread | **`legal-draft-fast`** or stream with explicit `-fast` |

Cross-ref: `documents/working/NSP-NYV-WORD-DMS-API-CONTRACT-2026-07.md` §1.1 drafting lifecycle.

### I.5 New SDK fields (orchestrate `data`)

```typescript
draftQuality?: {
  voiceOk: boolean;              // no AI-marker regex hits in content
  placeholdersRemaining: number; // [...] + {{...}} count
  authoritiesDelivered: number;  // mirror of trust.authoritiesDelivered
  reviewRecommended: boolean;    // risk !== GREEN || placeholders > 0 || (counsel/draft && authorities === 0)
};
analysisStatus?: 'structured' | 'unstructured' | 'failed';  // top-level when court-doc fields present
analysisStatusReason?: string;
attestationRequired?: boolean;   // reviewRecommended || riskBadge === RED || unresolved CONFLICT count > 0
```

---

## J. NSP Fast API Construct — actionable reference for NSP engineers

**Shipped:** 2026-09-08 · **Scope:** every NSP UI action that needs an immediate or fast best response using NYV agents, agentic routing, and the typed SDK.

**Base URL:** `https://api.nyayasiddhi.online`  
**Auth (all examples):**

```http
X-API-Key: <<NYV_SDK_KEY_NSP>>
X-NYV-Platform: nsp
Content-Type: application/json
X-Request-Id: <uuid>          # optional — NYV mints one if omitted
```

**SDK bootstrap (TypeScript):**

```typescript
import { NyvClient } from '@nyayavigya/client-sdk';

const nyv = new NyvClient({
  apiKey: process.env.NYV_SDK_KEY_NSP!,
  baseUrl: 'https://api.nyayasiddhi.online',
  defaultJurisdiction: 'IN',
  defaultPlatform: 'nsp',
  timeout: 90_000,              // interactive surfaces
  orchestrateTimeoutMs: 600_000 // counsel worker only
});
```

**Latency classes (measured nysdev, updated 2026-09-09):**

| Class | Target | Agent path |
|-------|--------|------------|
| **Doc-less draft-fast sync** | **~3s** cold | Specialist — SLA ON |
| **Typed draft-fast medium sync** | **~23s** at SLA cap | Specialist — prefer **stream** for UX |
| **Stream TTFB** | **~42ms** first delta | Same specialist path |
| **Warm repeat** | **~67ms** | LM cache hit |
| **Prompt improve** | ~50–200ms | Deterministic — no LLM |
| **Counsel worker** | up to **600s** | **Queen** + CoT (`routing.path: queen`) |

**Honest agent routing:** `-fast` taskTypes never invoke Queen decomposition. They load one registry specialist (typically A-052 research for chat-fast, A-003 drafting for draft-fast) with L1 system prompt + legal-intel overlay. Counsel-grade bare `legal-draft` uses Queen when `NYV_NSP_COUNSEL_QUEEN=1` (default).

**Response fields to persist on every orchestrate call:** `content`, `routing.path`, `draftQuality`, `attestationRequired`, `sessionId`, `requestId`, `riskBadge`, `auditHash`. When court filing text is sent, also read top-level `analysisStatus` and `courtDocFieldBlock` (see §J.8).

---

### J.0 Decision matrix — NSP user action → API call

| User action in NSP | `taskType` | Endpoint | Sync / Stream | Client timeout |
|--------------------|------------|----------|---------------|----------------|
| Quick legal Q&A (chat pane) | `legal-chat-fast` | `POST /api/nv/orchestrate` | Sync | 90s |
| Quick legal Q&A (progressive) | `legal-chat-fast` | `POST /api/nv/orchestrate/stream` | Stream | 90s idle |
| Describe & Generate (short prayer / clause) | `legal-draft-fast` | `POST /api/nv/orchestrate` | Sync | 90s |
| Describe & Generate (streaming editor) | `legal-draft-fast` | `POST /api/nv/orchestrate/stream` | Stream | 90s idle |
| Full pleading / counsel memo | `legal-draft` | Worker → `POST /api/nv/orchestrate` | Async poll | **600s worker** |
| Long draft in sync UI (acceptable quality tradeoff) | `legal-draft-fast` + `maxTokens: 4096` | `POST /api/nv/orchestrate` | Sync | 90s |
| Word selection rewrite | `legal-draft-fast` or `doc-draft-fast` | `POST /api/nv/orchestrate` | Sync or stream | 90s |
| Selection / document summarize (inline text) | — | `POST /api/nv/gateway/documents/summarize` | Sync | 90s |
| Short file companion (parse + summary + Q&A) | — | `POST /api/nv/v1/sdk/patra-mitra/sessions` → `/chat` | Sync | 90s |
| Pre-call prompt polish (typing assist) | — (hint only) | `POST /api/nv/v1/sdk/prompt/improve` | Sync | 5s |
| Document-aware quick draft (paste ≤ cap) | `doc-draft-fast` | `POST /api/nv/orchestrate` | Sync or stream | 90s |
| Document-aware quick draft (indexed matter file) | `doc-draft-fast` | `POST /api/nv/orchestrate` + `ragDocumentIds` | Sync or stream | 90s |
| CNR / diary matter autofill | — | `POST /api/nv/v1/sdk/cnr/resolve` → orchestrate `parameters` | Sync + sync | 60s + 90s |

Cross-ref: full endpoint matrix in [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md); streaming contract §I.6; `draftQuality` / `attestationRequired` §I.5.

#### J.0.1 NSP migration checklist — **REQUIRED** (GO 2026-09-08)

Full copy-paste examples: [`NSP-MIGRATION-GO-2026-09-08.md`](./NSP-MIGRATION-GO-2026-09-08.md).

| # | Change | Status |
|---|--------|--------|
| 1 | Replace sync bare `legal-draft` with `legal-draft-fast` | **REQUIRED** |
| 2 | Add `parameters.documentType` (snake_case registry key) | **REQUIRED** |
| 3 | Add `options.draftLength: "medium"` (default) | **REQUIRED** |
| 4 | Send `X-NYV-User-Id` or body `userId` (numeric) for memory | **REQUIRED** |
| 5 | Use `/api/nv/orchestrate/stream` for progressive editor UX | **REQUIRED** for editor |
| 6 | Counsel full pleadings → async worker + bare `legal-draft` poll | **REQUIRED** for Queen depth |
| 7 | Verify memory probe passes on EC2 post-deploy | **REQUIRED** |
| 8 | Stream typed drafts via `/api/nv/orchestrate/stream`; gated → **replace** body | **REQUIRED** (NV-DRAFT-STREAM-DUP-001) |
| 9 | Expect ~23s bail medium at SLA cap — use stream for editor UX | **REQUIRED** (NV-DRAFT-FAST-SLA-001) |
| 10 | Live probes: **SKIP** when keys absent — never fake PASS | **REQUIRED** (NSP ops contract) |

Full detail: [`NSP-MIGRATION-GO-2026-09-08.md`](./NSP-MIGRATION-GO-2026-09-08.md) §J.A–§J.D.

#### J.0.2 Stream + SLA quick reference (2026-09-09)

**Stream (NV-DRAFT-STREAM-DUP-001):** Use `POST /api/nv/orchestrate/stream` with `legal-draft-fast` + `parameters.documentType`. Gated SSE deltas (`gated: true`) → **replace** entire body, not append. Deploy `2026-09-09T1042Z-aws-ssm-02b7885f`.

**SLA (NV-DRAFT-FAST-SLA-001):** `NYV_DRAFT_FAST_SLA=1` (default ON on nysdev) caps medium at **2560** tokens, skips statute QA/Haiku polish — bail medium **~65s → ~23s**; warm **~67ms**. Set `NYV_DRAFT_FAST_SLA=0` for full registry floors (bail medium 8500). Deploy `2026-09-09T1437Z-aws-ssm-f28b3550`.

**Token registry:** `nv-draft-length-registry.ts` — 20 types; send `parameters.documentType` + `options.draftLength: low|medium|comprehensive`.

**Probes:** EC2 SSM authoritative (`npm run demo:probe:ec2`, `nv-partner-memory-probe-ec2.sh`). Local without `.local/secrets/runtime.env` → **SKIP** (`key_len=0`), not PASS. Operator JWT for EDJ/Console via `nv-uat-fetch-admin-jwt-ec2.sh`.

---

### J.1 Quick legal Q&A — `legal-chat-fast`

**When:** Legal Chat pane, Ask-a-question, advice turn — doc-less FAQ, not counsel memos.  
**Agent path:** Specialist (Queen skipped). **Target:** ~4–7s sync; stream TTFB ~2.7s.

#### Sync

```http
POST /api/nv/orchestrate
X-API-Key: <<NYV_SDK_KEY_NSP>>
X-NYV-Platform: nsp
Content-Type: application/json

{
  "prompt": "What is the limitation period for a money recovery suit under the Limitation Act?",
  "taskType": "legal-chat-fast",
  "jurisdiction": "IN",
  "sessionId": "matter-thread-uuid-001",
  "syncTimeoutMs": 90000
}
```

```typescript
const answer = await nyv.orchestrate({
  prompt: 'What is the limitation period for a money recovery suit under the Limitation Act?',
  taskType: 'legal-chat-fast',
  sessionId: 'matter-thread-uuid-001',
  syncTimeoutMs: 90_000,
});
// answer.content — rendered answer
// answer.routing.path === 'specialist'
// answer.draftQuality?.voiceOk — human-polish check (chat-fast)
```

**Expected response (`data`):**

```json
{
  "content": "Under the Limitation Act, 1963…",
  "routing": { "path": "specialist", "reason": "partnerSyncLean opt-in — single-agent only (Queen skipped; quality gates still ON)" },
  "draftQuality": { "voiceOk": true, "placeholdersRemaining": 0, "authoritiesDelivered": 2, "reviewRecommended": false },
  "attestationRequired": false,
  "sessionId": "matter-thread-uuid-001",
  "requestId": "req-uuid",
  "riskBadge": "GREEN"
}
```

#### Stream variant

```http
POST /api/nv/orchestrate/stream
```

Same body as sync. Handle SSE events (§I.6):

| Event | Partner action |
|-------|----------------|
| `run_started` | Show spinner; bind `runId` |
| `text_delta` (`provisional: true`) | Append `accumulated` to chat bubble |
| `text_delta` (`gated: true`) | Replace bubble with `accumulated` |
| `run_completed` | Read `result.content`, `result.draftQuality`, `result.routing.path` |
| `data: [DONE]` | Close reader |

```typescript
await nyv.orchestrate.stream(
  { prompt: 'Explain anticipatory bail under BNSS.', taskType: 'legal-chat-fast', sessionId: 'matter-thread-uuid-001' },
  {
    onTextDelta: (d) => renderChat(d.accumulated ?? ''),
    onRunCompleted: (r) => setReviewBadge(r.result?.draftQuality?.reviewRecommended),
  },
);
```

---

### J.2 Describe & Generate (short description) — `legal-draft-fast`, prompt only

**When:** New Case → Describe & Generate, one-paragraph prayer, short clause — **no attached document**.  
**Agent path:** Specialist drafting agent (A-003). RAG skipped when doc-less (`NV-FAST-DRAFT-NORAG-001`).  
**Target:** ~5–8s sync.

```http
POST /api/nv/orchestrate
X-API-Key: <<NYV_SDK_KEY_NSP>>
X-NYV-Platform: nsp
Content-Type: application/json

{
  "prompt": "Draft a one-paragraph anticipatory bail prayer under BNSS for FIR 456/2026, Karnataka.",
  "taskType": "legal-draft-fast",
  "jurisdiction": "IN",
  "parameters": { "documentType": "bail_application" },
  "options": { "draftLength": "medium" },
  "userId": 12345,
  "maxTokens": 512,
  "syncTimeoutMs": 90000
}
```

**Tip:** For truly short fragments (single prayer paragraph), send `maxTokens: 512` and a tight instruction ("Return ONLY the Prayer paragraph, ≤120 words"). Default draft-fast floor is 4096 tokens.

**Expected fields:** `content` (draft body with `[...]` placeholders), `routing.path: specialist`, `draftQuality.placeholdersRemaining`, `draftQuality.reviewRecommended`, `attestationRequired` (true when placeholders remain or risk ≠ GREEN).

```typescript
const draft = await nyv.orchestrate({
  prompt: 'Draft a one-paragraph anticipatory bail prayer…',
  taskType: 'legal-draft-fast',
  maxTokens: 512,
});
if (draft.attestationRequired) showAttestationGate();
if (draft.draftQuality?.placeholdersRemaining > 0) showInlinePlaceholderEditor();
```

**NSP rule:** AI failure on Describe & Generate must be **non-blocking** for the case row — degrade gracefully.

---

### J.3 Full draft (long description / counsel-grade)

Two valid patterns depending on quality vs latency tradeoff.

#### Option A — Counsel worker + async poll (recommended for full pleadings)

**When:** Written Statement, full petition, regenerate with Queen depth.  
**Agent path:** Queen + CoT + maker-checker. **Target:** up to **600s** on worker; UI gets `202` + `jobId`.

```typescript
// NSP BFF worker — never call from browser thread
const job = await enqueueDraftJob({
  prompt: 'Draft a complete Written Statement for recovery of money…',
  taskType: 'legal-draft',          // bare counsel — Queen path
  jurisdiction: 'IN',
  sessionId: 'matter-thread-uuid-001',
  ragDocumentIds: ['indexed-doc-id'], // optional grounding
});
// Return 202 + jobId to UI; poll job row until ready (~70–94s typical)
```

Worker orchestrate call:

```http
POST /api/nv/orchestrate
X-API-Key: <<NYV_SDK_KEY_NSP>>
X-NYV-Platform: nsp
Content-Type: application/json

{
  "prompt": "Draft a complete Written Statement for recovery of money in Suit No. 123/2026…",
  "taskType": "legal-draft",
  "jurisdiction": "IN",
  "sessionId": "matter-thread-uuid-001",
  "ragDocumentIds": ["indexed-doc-id"],
  "qualityMode": "counsel"
}
```

**Expected:** `routing.path: queen`, `orchestrationId` present, full `qualityEnvelope`, `draftQuality` without human-polish fast path. **Do not** sync this from UI — NSP ~60s abort will fire before Opus completes.

#### Option B — Fast sync with higher token cap (interactive compromise)

**When:** User wants a longer skeleton in the task pane without waiting for Queen.  
**Agent path:** Specialist. **Target:** ~7–12s.

```http
POST /api/nv/orchestrate

{
  "prompt": "Draft a Written Statement skeleton with numbered paras for recovery of money…",
  "taskType": "legal-draft-fast",
  "jurisdiction": "IN",
  "maxTokens": 4096,
  "syncTimeoutMs": 90000
}
```

Or stream for progressive UX (§I.6): `POST /api/nv/orchestrate/stream` with same body.

---

### J.4 Word selection rewrite — `selectedText` + `prompt`

**When:** Word task pane — user highlights a clause and asks for rewrite.  
**Agent path:** Specialist. Prefer `legal-draft-fast` for contract clauses; `doc-draft-fast` when full agreement context matters.  
**Contract:** `NV-SELECTION-TEXT-PRIORITY-001` — always send `selectedText`; see §I.7.

```http
POST /api/nv/orchestrate
X-API-Key: <<NYV_SDK_KEY_NSP>>
X-NYV-Platform: nsp
Content-Type: application/json

{
  "prompt": "Rewrite this clause to be more favorable to the Customer.",
  "selectedText": "CLAUSE 12.1 (LIABILITY CAP): aggregate liability shall not exceed fees paid in the preceding twelve months.",
  "documentText": "<optional full agreement for background — NYV prefers selectedText when both present>",
  "taskType": "legal-draft-fast",
  "jurisdiction": "IN",
  "sessionId": "matter-thread-uuid-001"
}
```

```typescript
const rewritten = await nyv.orchestrate({
  prompt: 'Rewrite this clause to be more favorable to the Customer.',
  selectedText: selectionFromWord,
  documentText: optionalFullDoc,
  taskType: 'legal-draft-fast',
  sessionId: matterSessionId,
});
// rewritten.content — replacement passage only (not full doc unless prompt asks)
```

**Stream variant:** Same body to `/api/nv/orchestrate/stream` — replace selection in editor on `run_completed`.

**Expected:** `routing.path: specialist`, `draftQuality.voiceOk`, `attestationRequired` when review recommended.

---

### J.5 Selection summarize — gateway summarize OR Patra Mitra

Two paths depending on input shape.

#### A. Inline text summarize (selection or pasted excerpt)

**When:** User selects text in Word/Outlook and taps "Summarize".  
**Endpoint:** `POST /api/nv/gateway/documents/summarize` (alias: `/api/nv/v1/sdk/documents/summarize` if mounted).

```http
POST /api/nv/gateway/documents/summarize
X-API-Key: <<NYV_SDK_KEY_NSP>>
X-NYV-Platform: nsp
Content-Type: application/json

{
  "content": "CLAUSE 12.1 (LIABILITY CAP): aggregate liability shall not exceed…",
  "depth": "concise",
  "maxWords": 120,
  "jurisdiction": "IN"
}
```

```typescript
const summary = await nyv.gateway.post('/api/nv/gateway/documents/summarize', {
  content: selectedText,
  depth: 'concise',
  maxWords: 120,
});
// summary.data.summary — bullet summary
// No draftQuality on this path — not orchestrate
```

**Target:** ~5–30s depending on selection length. Specialist summarizer via safety ring (not Queen).

#### B. Short file companion — Patra Mitra

**When:** User uploads a PDF/DOCX/image (≤ few pages) — parse, fields, summary, grounded Q&A.  
**Agent path:** Patra Mitra service (dedicated doc companion, not orchestrate Queen).

```http
POST /api/nv/v1/sdk/patra-mitra/sessions
X-API-Key: <<NYV_SDK_KEY_NSP>>
X-NYV-Platform: nsp
Content-Type: application/json

{
  "fileName": "nda-acme.pdf",
  "contentBase64": "<base64>",
  "mimeType": "application/pdf"
}
```

Then summarize or Q&A:

```http
POST /api/nv/v1/sdk/patra-mitra/sessions/<sessionId>/chat

{
  "message": "Summarize the indemnity clause in three bullet points."
}
```

```typescript
const session = await nyv.patraMitra.createSession({ fileName: 'nda.pdf', contentBase64, mimeType: 'application/pdf' });
const reply = await nyv.patraMitra.chat(session.data.sessionId, { message: 'Summarize key obligations.' });
```

**When to use which:**

| Input | Path |
|-------|------|
| Highlighted text in editor | `gateway/documents/summarize` |
| Small uploaded file (companion UX) | Patra Mitra sessions → `/chat` |
| Large matter file already in DMS | Index via EDJ → `ragDocumentIds` on orchestrate |

---

### J.6 Pre-call prompt polish — `POST /api/nv/v1/sdk/prompt/improve`

**When:** User is typing in Describe & Generate or draft prompt box — enrich before orchestrate.  
**Agent path:** **None** — deterministic pipeline, no LLM, no Queen. **Target:** ~50–200ms.

```http
POST /api/nv/v1/sdk/prompt/improve
X-API-Key: <<NYV_SDK_KEY_NSP>>
X-NYV-Platform: nsp
Content-Type: application/json

{
  "prompt": "Draft bail application for FIR 456/2026 Karnataka",
  "taskType": "legal-draft-fast",
  "jurisdiction": "IN",
  "context": {
    "highCourt": "High Court of Karnataka",
    "district": "Bengaluru Urban"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "improvedPrompt": "Context:\nDomain Context: …\n\nRequest:\nDraft bail application…",
    "metadata": { "model": "deterministic-v1", "latencyMs": 42, "agentId": "document-drafting-agent" }
  }
}
```

```typescript
const improved = await nyv.post('/api/nv/v1/sdk/prompt/improve', {
  prompt: userDraftPrompt,
  taskType: 'legal-draft-fast',
  context: { highCourt: 'High Court of Karnataka' },
});
const draft = await nyv.orchestrate({
  prompt: improved.data.improvedPrompt,
  taskType: 'legal-draft-fast',
});
```

**Do not** route prompt improve through `/api/nv/orchestrate` — there is no `prompt-improve` taskType; orchestrate cold paths are 10–73s.

---

### J.7 Document-aware quick draft — `doc-draft-fast`

**When:** Draft grounded on an open document or indexed matter file.

#### When to use `documentText` vs `ragDocumentIds`

| Scenario | Send | Why |
|----------|------|-----|
| User pasted / open doc ≤ inline cap (~40KB) | `documentText` or `documentContent` | Immediate; NYV caps and may set `truncated: true` — surface to user |
| Matter file already indexed in EDJ/shared-docs | `ragDocumentIds: ["<doc-id>"]` | Vector RAG grounding; no paste blob; preferred for large files |
| Both present | `ragDocumentIds` wins for RAG; `selectedText` wins for rewrite UX | See §I.7 |

**Inline document (paste / open file):**

```http
POST /api/nv/orchestrate
X-API-Key: <<NYV_SDK_KEY_NSP>>
X-NYV-Platform: nsp
Content-Type: application/json

{
  "prompt": "Draft a reply to the counter-affidavit based on the attached petition.",
  "documentText": "<petition text — capped; check document_context.truncated on stream>",
  "taskType": "doc-draft-fast",
  "jurisdiction": "IN",
  "sessionId": "matter-thread-uuid-001"
}
```

**Indexed matter file (preferred for DMS):**

```http
POST /api/nv/orchestrate

{
  "prompt": "Draft a reply to the counter-affidavit based on the indexed petition.",
  "taskType": "doc-draft-fast",
  "jurisdiction": "IN",
  "ragDocumentIds": ["edj-doc-uuid-001"],
  "sessionId": "matter-thread-uuid-001"
}
```

```typescript
const docDraft = await nyv.orchestrate({
  prompt: 'Draft a reply to the counter-affidavit…',
  taskType: 'doc-draft-fast',
  ragDocumentIds: [indexedDocId],
  sessionId: matterSessionId,
});
// docDraft.routing.path === 'specialist' (RAG on when ragDocumentIds present)
// docDraft.draftQuality — placeholder + attestation UX
```

**Stream:** On `/api/nv/orchestrate/stream`, watch for `document_context` SSE event before tokens when inline doc is truncated.

**Agent path:** Specialist with RAG when docs attached; Queen still skipped on `-fast`.

---

### J.8 CNR / matter autofill before draft — `cnr/resolve` → orchestrate `parameters`

**When:** New Case → CNR or diary lookup → pre-fill draft metadata before Describe & Generate.

**Step 1 — Resolve matter:**

```http
POST /api/nv/v1/sdk/cnr/resolve
X-API-Key: <<NYV_SDK_KEY_NSP>>
X-NYV-Platform: nsp
Content-Type: application/json

{
  "cnr": "TSWL000000742024",
  "options": { "includeDocuments": true, "profile": "default" }
}
```

Diary variant (same endpoint):

```json
{
  "diaryNumber": "2023 INSC 1081",
  "options": { "courtType": "sc", "includeDocuments": true }
}
```

**Step 2 — Map fields to orchestrate `parameters`:**

```http
POST /api/nv/orchestrate

{
  "prompt": "Draft anticipatory bail application for the matter below.",
  "taskType": "legal-draft-fast",
  "jurisdiction": "IN",
  "parameters": {
    "cnr": "TSWL000000742024",
    "petitioner": "<from cnr resolve fields.petitioner>",
    "respondent": "<from fields.respondent>",
    "courtName": "<from fields.courtName>",
    "highCourt": "<from fields.highCourt>",
    "district": "<from fields.district>",
    "caseNumber": "<from fields.caseNumber>",
    "filingDate": "<from fields.filingDate>"
  },
  "sessionId": "matter-thread-uuid-001"
}
```

```typescript
const cnr = await nyv.cnr.resolve({ cnr: 'TSWL000000742024' });
const fields = cnr.data.fields;
const draft = await nyv.orchestrate({
  prompt: 'Draft anticipatory bail application…',
  taskType: 'legal-draft-fast',
  parameters: {
    cnr: 'TSWL000000742024',
    petitioner: fields.petitioner,
    respondent: fields.respondent,
    courtName: fields.courtName,
    highCourt: fields.highCourt,
    district: fields.district,
  },
});
```

**Court-doc field block:** When filing text (≥220 chars + court cue) is sent as `documentText`, orchestrate may emit top-level `analysisStatus` (`structured` | `unstructured` | `failed`) and `courtDocFieldBlock` with extracted filing fields. NSP autofill QA should branch on `analysisStatus` and show conflict UI when `docparseMeta.conflictFields` or `attestationRequired` is true (§I.2–I.3).

**Provenance:** CNR resolve is corpus-only — `claimEcourts: false` always. Show miss UI on `not_found`, never claim live eCourts.

---

### J.9 Shared response contract — `draftQuality`, `attestationRequired`, `courtDocFieldBlock`

All orchestrate paths in §J.1–J.8 return (when applicable):

```typescript
// Persist on every draft/chat turn
interface PartnerOrchestrateData {
  content: string;
  routing: { path: 'specialist' | 'queen' | 'doc-pipeline'; reason: string };
  draftQuality?: {
    voiceOk: boolean;
    placeholdersRemaining: number;
    authoritiesDelivered: number;
    reviewRecommended: boolean;
  };
  attestationRequired?: boolean;  // gate export when true
  analysisStatus?: 'structured' | 'unstructured' | 'failed';
  courtDocFieldBlock?: Record<string, unknown>;  // filing field extraction
  sessionId: string;
  requestId: string;
  riskBadge: 'GREEN' | 'YELLOW' | 'RED';
}
```

| Field | NSP UX action |
|-------|---------------|
| `draftQuality.placeholdersRemaining > 0` | Inline placeholder editor or matter auto-fill |
| `draftQuality.reviewRecommended` | Review badge (not "AI generated" prefix) |
| `attestationRequired: true` | Block export until advocate checkbox + audit log |
| `courtDocFieldBlock` + `analysisStatus: structured` | Pre-fill form fields; show conflict popup on `CONFLICT` |
| `routing.path: queen` when `-fast` sent | **Misconfiguration** — check taskType / sync budget |

---

## F. References

| Document | Purpose |
|----------|---------|
| `documents/working/NSP-DRAFT-LATENCY-ANALYSIS-2026-09-02.md` | Draft-fast RCA + shipped fixes |
| `documents/working/NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md` | Full endpoint matrix |
| `documents/working/NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md` | Payload recipes |
| `nyayavigya-platform-312/FEATURES-REGISTRY.md` | Wired feature SSoT |
| `nyayavigya-platform-312/guardrails.md` | NV-EXECUTE-BEFORE-CLAIM-001 |

---

*Generated 2026-09-08 · §J NSP Fast API Construct · NV-STREAM-TERMINAL-POLISH-001*
