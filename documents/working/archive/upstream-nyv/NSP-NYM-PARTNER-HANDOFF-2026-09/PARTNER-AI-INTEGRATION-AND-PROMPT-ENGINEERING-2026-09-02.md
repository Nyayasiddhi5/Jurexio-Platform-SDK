# Partner AI Integration + Prompt Engineering + Agent Registry Audit

**Date:** 2026-09-03 (updated)  
**Scope:** NYV (`nyayavigya-platform-312/`) — NSP/NYM partner paths, agent registry, prompt pipeline crosscheck  
**Live API:** `https://api.nyayasiddhi.online` · Deploy **`2026-09-03T0555Z-aws-ssm-689caf64`**  
**Evidence:** EC2 probes via SSM + code audit (file:line citations below)

---

## Executive summary

| Finding | Detail |
|---------|--------|
| **Draft-fast cold latency** | Post-fix probe: **10.7s** cold / **59ms** warm (Haiku specialist). Prior baseline **18.6s** → **12.45s** → **10.7s**. Remaining gap vs 5–8s target is **LLM output generation** (~4k chars), not NYV RAG/Queen overhead. |
| **Warm repeat** | Identical prompt → **~59–75ms** (LM cache). NYV tax ≈ 0%. |
| **Partner integration** | Use `POST /api/nv/orchestrate` with explicit `-fast` taskType aliases. Never sync `legal-draft` from UI threads. |
| **Agentic vs fast** | `-fast` = specialist + registry L1 system prompt + legal-intel overlay; **Queen skipped**. Counsel-grade = Queen + multi-agent + CoT. Do not route `-fast` through Queen to get “agent intelligence.” |
| **Prompt engineering** | **No path sends raw user text alone.** All paths run safety pipeline + (when agent resolves) layered registry prompts. Partner `-fast` skips Queen `analyzePrompt`, skips RAG when doc-less, skips CoT/confidence scorer; still runs `promptEnhancementPipeline.enhance()`. |
| **Registry** | **164 agents** per jurisdiction file under `config/agent-registries/`; loaded via `agent-registry-loader.ts`. Each agent embeds §0 security constitution (23-section XML). |

---

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

The probe asks for “one sentence bail prayer” but Haiku returns **~4,000 characters** — generation time scales with output length. Partner `maxTokens` floor for draft-fast is **1,024** (`NYV_PARTNER_MAX_TOKENS_DRAFT_FAST`), not the probe’s requested 256:

```644:651:nyayavigya-platform-312/src/utils/nv-partner-platform.ts
  const draftFastFloor = envPartnerToken('NYV_PARTNER_MAX_TOKENS_DRAFT_FAST', 1_024);
  ...
  return Math.max(asked > 0 ? asked : 0, floor);
```

### A.4 Recommended next optimization (plan only — not implemented)

**Highest leverage, lowest risk:**

1. **Partner-side:** For Describe & Generate / one-line prayers, send `maxTokens: 512` and a tight instruction (“Return ONLY the Prayer paragraph, ≤120 words”). NYV floor is 1,024 — partners cannot go lower without NYV env change.

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
| CNR autofill | `POST /api/nv/v1/sdk/cnr/resolve` | Corpus-only, not live eCourts |
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
  "maxTokens": 1024,
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
| CNR resolve | `POST /api/nv/v1/sdk/cnr/resolve` | `nyv.cnr.resolve` |
| CAM | `/api/nv/v1/sdk/cam/*` | Consent-gated model catalog |

Full contract: `documents/working/PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md`, `NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`.

### B.8 What NOT to call

| Path | Why |
|------|-----|
| `POST /api/nv/gateway/documents/draft` | Hardcodes Queen + CoT — `-fast` SLA never applies |
| `/api/nv/legal-chat/send` (etc.) | JWT-only — SDK key → 401 |
| `POST /api/nv/stream` | Console AG-UI JWT |
| Direct `nyayasearch.nyayasiddhi.online` | Bypasses NYV auth/metering |
| Sync `legal-draft` from browser/BFF | 55s abort class — use worker + `202` poll |

`Idempotency-Key` header is **not honoured** server-side yet — client-side de-dupe required.

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
    "improvedPrompt": "Context:\nDomain Context: …\n\nRequest:\nDraft bail application for FIR 456/2026 Karnataka\n\nOrganize your response with clear sections and bullet points.",
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

## F. References

| Document | Purpose |
|----------|---------|
| `documents/working/NSP-DRAFT-LATENCY-ANALYSIS-2026-09-02.md` | Draft-fast RCA + shipped fixes |
| `documents/working/NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md` | Full endpoint matrix |
| `documents/working/NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md` | Payload recipes |
| `nyayavigya-platform-312/FEATURES-REGISTRY.md` | Wired feature SSoT |
| `nyayavigya-platform-312/guardrails.md` | NV-EXECUTE-BEFORE-CLAIM-001 |

---

*Generated 2026-09-03 · Deploy `689caf64` · NV-NSP-EMBED-INPUT-001 + NV-PROMPT-IMPROVE-FAST-001*
