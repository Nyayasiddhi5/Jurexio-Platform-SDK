# NSP ↔ NYV Draft Handshake — Stream vs Async (2026-09-16)

> **Audit:** subagent `a4a39c1a` · **Audience:** NSP integration + NYV partner ops  
> **Live API:** `https://api.nyayasiddhi.online` (nysdev)  
> **Latest deploy:** `2026-09-16T1357Z-aws-ssm-667d73f1` (prompt improve + stream never-miss)

---

## Ownership

| Concern | Owner |
|---------|-------|
| Live SSE tokens (`text_delta`) | **NYV** `POST /api/nv/orchestrate/stream` |
| Async job queue + poll UX | **NSP** BFF (`mode: durable`, `taskId`, `pollPath`) |
| HTTP 202 / NYV `jobId` | **Not used** — NYV never returns 202 for orchestrate |

NSP must not wait on a blank screen for async counsel drafts. Show **“submitted — you can leave”** and poll in background.

---

## Request knobs → behavior

| NSP sends | NYV behavior | NSP must do |
|-----------|--------------|-------------|
| `taskType: legal-draft-fast` | Haiku specialist, `partnerSyncLean`, gated SSE | Default interactive Describe & Generate |
| `taskType: doc-draft-fast` + grounding | Doc-grounded fast specialist | When refs attached, still **stream** unless comprehensive |
| `taskType: legal-draft` (bare) | Queen ~70–94s | **Worker + poll only** — never browser sync thread |
| `options.draftLength: medium` | SLA **6144–8192** tokens (per doctype) | Every interactive draft |
| `options.draftLength: comprehensive` | Counsel upgrade → Queen | Explicit user choice or Continue |
| `parameters.documentType` | **Required** — missing → 400 | Always merge wire key into `parameters` |
| `partnerSyncLean: true` + `skipQueen: true` | Fast stream path | All `-fast` stream calls |

---

## Intended routing matrix

| User intent | NSP route | NYV taskType | draftLength | Mode |
|-------------|-----------|--------------|-------------|------|
| Fast / Standard | `/doc-draft/stream` | `legal-draft-fast` / `doc-draft-fast` | low / medium | Live SSE |
| Comprehensive / Continue / real attachments | worker | `legal-draft` | comprehensive | Poll |
| Case-linked bail (interactive) | stream | `legal-draft-fast` | medium | Live SSE |
| File tomorrow (counsel) | worker | `legal-draft` | comprehensive | Poll |

---

## NSP async SSE contract (BFF → browser)

When counsel durable path triggers, BFF emits **one** meta event then closes:

```json
{
  "meta": {
    "mode": "durable",
    "taskId": 12345,
    "pollPath": "/ns/v1/ai/task/12345/status",
    "status": "queued",
    "counselDurable": true
  }
}
```

Then `[DONE]`. **Zero `text_delta` tokens.** UI must switch to counsel-queued copy and poll (or redirect to Jobs).

---

## NYV stream SSE contract (reference)

`run_started` → `pipeline_ready` → `text_delta` (`gated: true` = **replace** editor body) → `run_completed` with `draftQuality`.

---

## Known bugs fixed (2026-09-16 P0)

| Bug | Fix |
|-----|-----|
| Long prompt treated as attachment → forced async | `draftRequestHasAttachments` — ID arrays only |
| Missing `parameters.documentType` on stream → 400 → blank | BFF merges `wireDocumentTypeKey` |
| Case filing auto `perfMode: best` → always async | FE decouples counsel hint from routing |
| Async overlay says “streaming” | `counsel_queued` execution phase copy |

---

## User messaging (async)

| Moment | Copy |
|--------|------|
| Durable received | **Counsel-grade draft submitted** — takes 1–3 min; you can leave |
| Complete | **Draft ready** — open in editor |
| Failed | Retry with Standard quality for live stream |

---

## Verification

```bash
# NYV
cd nyayavigya-platform-312 && npm run demo:probe:draft-length:ec2

# NSP — stream path with 200-char prompt, no attachments, perfMode auto
# Expect: SSE tokens before [DONE], meta.mode !== durable
```

Cross-ref: [`NSP-OPERATING-PROFILE-2026-09-16.md`](./NSP-OPERATING-PROFILE-2026-09-16.md)

---

## Token length SSOT (NV-DRAFT-LENGTH-TIER-001)

NYV registry: `src/config/nv-draft-length-registry.ts` · SLA env: `NYV_DRAFT_FAST_SLA_*`

### NSP quality tier → NYV wire

| NSP `draftQuality` | NYV `options.draftLength` | NYV `taskType` (stream) | SLA cap (when `-fast` + SLA ON) |
|--------------------|---------------------------|-------------------------|----------------------------------|
| `fast` | `low` | `legal-draft-fast` / `doc-draft-fast` | **4096** (+1024 attachment bump → max **5120**) |
| `standard` | `medium` | `legal-draft-fast` / `doc-draft-fast` | **6144–8192** per doctype (+2048 attachment bump) |
| `comprehensive` | `comprehensive` | `legal-draft` (async worker) | **No SLA cap** — registry **16384–32768** |

Attachment presence **does not** force async (NSP `draft-quality-routing.ts`); it only bumps completion budget on stream paths.

### Tier × attachment matrix (effective NYV maxTokens floor)

| Tier | No attachments | With attachments (RAG IDs / documentText) |
|------|----------------|-------------------------------------------|
| Fast (`low`) | 4096 | 5120 |
| Standard (`medium`) | 6144–8192 (per doctype) | +2048 (capped at 8192 SLA) |
| Comprehensive | 16384–32768 | +4096 (capped at 32768) |

Env overrides: `NYV_DRAFT_FAST_SLA_MAX_TOKENS` (default **8192**), `_LOW` (**4096**), `_COMPREHENSIVE` (**16384**, unused when comprehensive skips SLA), `NYV_DRAFT_ATTACHMENT_BUMP_*`.

### Counsel-grade recommendations by documentType

| documentType | Recommended NSP tier | Standard maxTokens | Comprehensive maxTokens | Rationale (A4 counsel-grade) |
|--------------|---------------------|--------------------|-------------------------|------------------------------|
| `bail_application` | standard | 6144 | 16384 | ~8–12 pp interactive; full grounds + annexures counsel |
| `criminal_petition` | standard | 8192 | 24576 | ~12–18 pp; multiple grounds + chronology |
| `writ_petition` | standard → comprehensive | 8192 | 32768 | ~25–40 pp; facts + grounds + prayer + annexures |
| `written_statement` | standard → comprehensive | 8192 | 32768 | Para-wise denial; often 30+ pp with exhibits |
| `legal_notice` | fast → standard | 6144 | 16384 | ~4–8 pp; demand + timeline + consequence |
| `complex_agreement` | comprehensive | 8192 | 32768 | Schedules + boilerplate; multi-part operative |
| `affidavit_case` | standard | 8192 | 24576 | ~6–10 pp sworn narrative + verification |
| `legal_opinion` / `case_summary` | fast → standard | 6144–8192 | 16384–24576 | Research memo / executive summary |
| `legal_chat` | fast | 4096 (chat-fast) | 8192 | Q&A; no draft registry — use `legal-chat-fast` |

`legal_chat` uses chat floors (`NYV_PARTNER_MAX_TOKENS_CHAT_FAST=768` default lean; up to 4096 when explicitly requested).

---

## Async counsel-grade worker payload (Gap 3 — NSP ↔ NYV contract)

When NSP routes **Comprehensive / Continue / real attachments** to the BullMQ worker (`ai-task.worker.ts`), the worker must wire NYV as follows. Verified against NSP `buildNyvOrchestrateWire` + NYV gateway (`nv-orchestration-routes.ts`).

### NSP worker sends (counsel-grade)

| Field | Value | NYV effect |
|-------|-------|------------|
| `taskType` | `legal-draft` (not `-fast`) | Queen + CoT + maker-checker path |
| `parameters.documentType` | snake_case registry key (required) | Agent pin + structure checker |
| `options.draftLength` | `comprehensive` | Opus counsel depth; no SLA cap |
| `enableCoT` | `true` | Queen CoT (`maybeRunQueenCoT`) |
| `partnerSyncLean` | `false` / omitted | Do **not** skip Queen |
| `enableRAG` | `true` | Matter/case RAG when IDs present |
| `enableHallucinationCheck` | `true` | Safety ring |
| `enableCitationVerification` | `true` | Citation verify |
| `enableMemory` | `true` (counsel) | Matter memory when userId set |
| `timeoutFamily` | `draft` | ~540s worker budget (not 90s stream) |
| `parameters.cnrFacts` | JSON case block (when linked) | `formatCnrCaseContext()` overlay |

### NSP worker sends (interactive fast — Wave B assist only)

| Field | Value |
|-------|-------|
| `taskType` | `legal-draft-fast` |
| `partnerSyncLean` | `true` |
| `enableCoT` | `false` |
| `options.skipQueen` | `true` (via `buildNyvFastDraftStreamOptions`) |
| `options.draftLength` | `medium` (UI default) |

### NYV Queen + CoT wiring (bare `legal-draft`)

1. Gateway: `wantsPartnerSyncLean` → **false** for bare counsel taskTypes on NSP (default `NYV_NSP_COUNSEL_QUEEN=1`).
2. AdaptiveRouter → `path: queen`; `streamEngageQueen` / sync Queen engage.
3. Queen metadata: `queenDepth: true`, `enableCoT: true` (unless caller explicitly `-fast`).
4. Response: `chainOfThought` stripped from partner JSON (`NV-COT-PARTNER-STRIP-001`); CoT visible only in internal logs / `thinking` SSE events.
5. `draftQuality.structureMarkers` + `attestationRequired` on draft families.

### Mismatch checklist (NSP must fix locally if present)

| Symptom | Likely NSP wire bug |
|---------|---------------------|
| Worker runs 90s then empty | Missing `parameters.documentType` → NYV **400** |
| Fast stream empty, worker fallback | Missing `partnerSyncLean` + explicit `agentKey` on stream; or NYV empty specialist (fixed NV-QUEEN-NEVER-MISS-001 stream parity) |
| Comprehensive still on Haiku | `taskType` still `legal-draft-fast` — must upgrade to `legal-draft` |
| No CoT on counsel draft | `enableCoT: false` on bare `legal-draft` — worker must send `true` |
| Prompt improve shows system config | NYV leak (fixed NV-PROMPT-IMPROVE-USER-001); NSP `looksLikeSystemPromptLeak` is backup |

---
