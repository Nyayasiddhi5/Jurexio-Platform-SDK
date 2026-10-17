# NSP / NYM — AI task endpoint & configuration matrix (2026-08-17)

> **Live deploy (2026-08-20T17:35Z verified):** NYV gateway sha **`ee541ca1`** (`2026-08-20T1610Z-aws-ssm`) · NYS worker `index.mjs` md5 **`c02fc526fb711183f4feaaa167ef61d7`** · public `/api/nv/health` 200 · CNR `profile:caseCreate` + Tier A `analysisStatus` live. Prior sprint **`8c6852aa`** superseded for CNR case-create + Athena cold path. §4e + §4f below include both deploys where relevant.
> **Audience:** NSP (Nyayasiddhi Professional) and NYM (Nyayamitra) backend / BFF / worker / mobile leads.
> **Live API:** `https://api.nyayasiddhi.online` (ALB → nysdev). Console `https://console.nyayasiddhi.online`.
> **SDKs:** `@nyayavigya/client-sdk@5.1.1+` (NSP / server — `CnrCaseCreateProfile`) · `@nyayavigya/nyayamitra-sdk@5.1.2+` (NYM).
> **Supersedes for timeouts / endpoint choice:** the single `timeout: 600_000` line in [`NSP-INTEGRATION-CHEATSHEET-2026-06.md`](./NSP-INTEGRATION-CHEATSHEET-2026-06.md).
> **Wave-B reply / live measurements:** [`NYV-NSP-WAVE-B-RESPONSE-2026-08-17.md`](./NYV-NSP-WAVE-B-RESPONSE-2026-08-17.md)
> **Read with:** [`NSP-API-HANDOFF-2026-08-17.md`](./NSP-API-HANDOFF-2026-08-17.md) (draft SLA + completion-driven §6) · [`Nyayavigya-platform-Integration-document-5.0.0.md`](./Nyayavigya-platform-Integration-document-5.0.0.md) (full API/SDK) · [`NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md`](./NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md) (payload recipes).

**Nothing in this document is a new endpoint.** Every path below is already live and frozen in `FEATURES-REGISTRY.md`. What changed is (a) which endpoint each AI surface must call, (b) the **per-class timeout** (there is no single correct timeout), and (c) which response fields to persist so a request is trackable end-to-end.

---

## 1. Connection config (per platform)

| Item | NSP | NYM |
|---|---|---|
| Base URL | `https://api.nyayasiddhi.online` | same |
| Key env var | `NYV_SDK_KEY_NSP` | `NYV_SDK_KEY_NYM` |
| Auth header | `X-API-Key: <key>` (also accepted as `Authorization: Bearer <key>`) | same |
| Platform header | `X-NYV-Platform: nsp` | `X-NYV-Platform: nym` |
| Jurisdiction | `IN` only (enforced server-side — `INDIA_ONLY_PARTNER_CODES`) | `IN` only |
| Correlation | send `X-Request-Id: <your uuid>`; NYV echoes it back on the response | same |
| Server-side only | keys must never reach a browser or an APK | keys stay in the NYM backend, not the app bundle |

```ts
import { NyvClient } from '@nyayavigya/client-sdk';

export const nyv = new NyvClient({
  apiKey: process.env.NYV_SDK_KEY_NSP!,       // NYV_SDK_KEY_NYM for NYM
  baseUrl: 'https://api.nyayasiddhi.online',
  defaultJurisdiction: 'IN',
  defaultPlatform: 'nsp',                     // 'nym' for NYM
  timeout: 90_000,                            // interactive calls
  orchestrateTimeoutMs: 600_000,              // full-counsel orchestrate only
});
```

Why two numbers: `NyvClient` uses `config.timeout` (default **30_000**) for every non-orchestrate call and a separate `orchestrateTimeoutMs` (default **600_000**) for `nyv.orchestrate`. A single `timeout: 600_000` makes a typeahead call able to hang for ten minutes; the old default of `30_000` aborts a legitimate counsel draft. Set both.

`X-NYV-Platform` is what selects best-outcome depth (`NYV_DEPENDENT_PLATFORM_CODES`). If it is missing, the SDK sends `nys-professional` and you may not get NSP/NYM treatment — always set it explicitly.

---

## 2. The three request classes

Every AI button must be classified before it is wired. This is the single decision that prevents the 55s-abort class of failure.

| Class | Meaning | Client timeout | Transport | Failure semantics |
|---|---|---|---|---|
| **Interactive** | user is watching a spinner | **90_000** | sync HTTP or SSE stream | abort is a UI event, not a job failure |
| **Counsel** | full Queen depth, minutes | **600_000** on the **worker** | worker call; UI gets `202` + `jobId` + poll | only `failed_infra` / empty after 600s is a failure |
| **Batch / corpus** | files, DD, DMS ingest | job poll | `createJob` → poll | per-document status |

Never run a Counsel-class call from a browser request thread. A 55s browser/BFF abort against a job that is still `generating` must not be mapped to `DRAFT_AI_TIMEOUT`.

---

## 3. Endpoint matrix — every AI task

All paths are prefixed with the base URL. `Auth` column: **SDK key** = `X-API-Key` works (`dualSdkOrJwt` / gateway auth); **JWT only** = Console admin/SME, not available to partner keys.

### 3.1 Generation / reasoning (the AI core)

| Surface | Endpoint | SDK | `taskType` | Class | Timeout |
|---|---|---|---|---|---|
| AI Assist · propose · Describe & Generate · quick redraft | `POST /api/nv/orchestrate` | `nyv.orchestrate({...})` | `legal-draft-fast` | Interactive | 90s |
| Legal chat quick turn (partner chat UI) | `POST /api/nv/orchestrate` | `nyv.orchestrate` | `legal-chat-fast` | Interactive | 90s |
| Doc-derived quick draft | `POST /api/nv/orchestrate` | `nyv.orchestrate` | `doc-draft-fast` | Interactive | 90s |
| Token-streamed answer / draft | `POST /api/nv/orchestrate/stream` | `nyv.orchestrate.stream(req, { onTextDelta })` | any of the above | Interactive (SSE) | 90s idle-based |
| Full pleading / counsel opinion / memo | `POST /api/nv/orchestrate` | `nyv.orchestrate` | `legal-draft` · `document-drafting` · `drafting` | Counsel | 600s worker |
| Research / analysis / strategy | `POST /api/nv/orchestrate` | `nyv.orchestrate` | `legal_research` · `analysis` | Counsel | 600s worker |
| Deliberately deep draft (user opted in) | `POST /api/nv/orchestrate` | `nyv.orchestrate` | `legal-draft-deep` · `doc-draft-deep` | Counsel | 600s worker |
| Hub web search / workflow suggest | `POST /api/nv/orchestrate` | `nyv.orchestrate` | `web-search` · `workflow-suggest` | Interactive | 90s |
| Legacy partner alias (same router) | `POST /api/nv/v1/sdk/orchestrate` (+ `/stream`) | — | same | same | same |

**Exactly four `-fast` aliases are honoured** (kebab or snake): `legal-chat-fast`, `legal-draft-fast`, `doc-draft-fast`, `document-draft-fast`. Anything else with a `-fast` suffix is **not** recognised and will take full counsel depth. Bare `legal-draft` / `legal-chat` / `doc-draft` are counsel, by design.

### 3.2 Documents (parse → understand → index)

| Surface | Endpoint | SDK | Class |
|---|---|---|---|
| Word selection / single short file companion (parse · fields · summary · Q&A) | `POST /api/nv/v1/sdk/patra-mitra/sessions` → `/sessions/:id/chat` · `/sessions/:id/tools` | `nyv.patraMitra.*` · NYM `nym.openPatraMitra` / `askPatraMitra` | Interactive |
| Summarize a document | `POST /api/nv/sdk/docs-pipeline/documents/summarize` | `nyv.docsPipeline.summarize` | Interactive |
| Parse / compare / compliance-check | `POST /api/nv/sdk/docs-pipeline/documents/{parse,compare,compliance-check}` | `nyv.docsPipeline.*` | Interactive |
| Classify document / clauses | `POST /api/nv/v1/sdk/intelligence/classify-document` · `POST /api/nv/gateway/documents/classify-clauses` | `nyv.partnerIntelligence.classifyDocument` · `nyv.gateway.classifyClauses` | Interactive |
| OCR a scanned file | `POST /api/nv/gateway/ocr/process` | `nyv.gateway.ocrProcess` | Interactive |
| NSP file → AI index (then RAG) | `POST /api/nv/shared-docs/process` → `GET /api/nv/shared-docs/status/:jobId` | `nyv.ecosystemDocuments.processSharedDoc` / `.getNspSharedDocStatus` | Batch |
| Large DMS / matter file ingest (EDJ) | `POST /api/nv/v1/sdk/ecosystem-documents/jobs` → `/jobs/:id`, `/jobs/:id/result`, `/jobs/:id/content` | `nyv.ecosystemDocuments.createJob` / `.getJob` / `.getResult` / `.getContent` | Batch |
| Due-diligence / matter review pack | `POST /api/nv/matter-vault/matters` → `/upload-batch` → `/run-playbook` | `nyv.matterVault.createMatter` / `.uploadBatch` / `.runPlaybook` | Batch |

Do not paste document text into `prompt`. Index first, then pass `ragDocumentIds` to `/api/nv/orchestrate`.

### 3.2a Inline document on `/api/nv/orchestrate` — supported, capped, and it now tells you

`NV-INLINE-DOC-PROMPT-001` (2026-08-19). **Behaviour change — read this if you send document text to orchestrate.**

Until this fix, a document sent in `documentText` / `documentContent` / `content` / `text` was read only for the deterministic 17-field block. **It never reached the model's prompt.** Measured live: the same MSA sent in `documentText` produced 3,351 chars of confident analysis that mentioned neither the indemnity clause, nor the liability cap, nor the governing-law seat, nor either party's name; the identical text pasted inside `prompt` produced 6,334 chars that mentioned all four. If you have shipped analysis built on the inline shape, **treat every answer produced before this fix as ungrounded** — it read like analysis and was generated from your instruction alone.

What changed:

| Before | After |
|---|---|
| `prompt` + document key → document ignored by the model | Document is folded into the prompt, fenced as material |
| `documentContent` with no `prompt` → `400 prompt is required` | `200` with a default analysis instruction applied |
| No signal that a document was received or truncated | `data.documentContext` on the response; `document_context` SSE event on `/stream` |

**Accepted keys** (longest value wins, so a short title field cannot mask the body): `documentContent`, `documentText`, `content`, `text`. Your `prompt` is preserved as the task — it is never overwritten by the document, and the two are delimited in separate fenced blocks so clause text is not read as an instruction.

**It is capped, and the cap is per task class** — no budget was raised to accommodate documents. A request carrying a document is classified at least `research` (4,500 context tokens); `legal_drafting` / `legal-draft` gets `drafting` (14,000). Measured: a 20 KB contract on `taskType: analysis` is truncated to ~18,000 characters; 200 KB on a drafting task to ~56,000.

**Read `data.documentContext` — do not assume the whole document was analysed:**

```json
"documentContext": {
  "injected": true,
  "sourceField": "documentText",
  "documentChars": 211999,
  "includedChars": 17999,
  "truncated": true,
  "documentTokens": 4500,
  "budgetTokens": 4500,
  "promptTaskClass": "research",
  "advice": "Document exceeded the prompt budget for this task class and was truncated. Index the file first (POST /api/nv/shared-docs/process or the ecosystem-documents job API) and pass ragDocumentIds for whole-document analysis."
}
```

`truncated: true` means the answer describes **part** of the document. Surface that to your user, or route the file through the indexed path instead. On `/api/nv/orchestrate/stream` the same fields arrive as an SSE `document_context` event before the answer, because a streaming client never sees the response envelope.

**When to use which path:** inline is for excerpts, clause sets and single short documents where a round trip to indexing is not worth it. For a whole contract, a matter file or anything you need analysed in full, the guidance in §3.2 stands — index first and pass `ragDocumentIds`. Inline will not silently pretend to have read the whole thing, but it also will not read the whole thing.

### 3.2b Document parsing & autofill (NSP case / firm / form intake)

**Deploy:** live on gateway `8c6852aa`. Full contract: [`NYV-TO-NSP-FORMAL-REPLY-2026-08-20.md`](./NYV-TO-NSP-FORMAL-REPLY-2026-08-20.md) §7.

Use this decision tree — do not build a parallel parser:

| Scenario | Primary path | Autofill output |
|---|---|---|
| CNR on cover sheet | `POST /api/nv/v1/sdk/cnr/resolve` | Matter fields from corpus (not live eCourts) |
| Single Indian court filing (petition, WS, order) | `documents/extract` → `documents/analyze` **or** `/orchestrate` + `documentText` | Deterministic filing fields + NER; read **`data.extras.analysisStatus`** |
| Custom onboarding / firm / arbitrary form | `POST /api/nv/v1/sdk/ecosystem-documents/jobs` with **`fieldManifest`** | `GET …/jobs/:id/result` → **`fields: { key: value }`** |
| Small file → RAG then draft | `POST /api/nv/shared-docs/process` (shim) or EDJ | Index first; pass `ragDocumentIds` to orchestrate |
| Large DMS / due diligence | EDJ `full_intelligence` or Matter Vault playbook | Progressive poll; not instant single-form autofill |

**Court document keys (Tier A)** — when present, each carries `confidence` and `source` (`cause-title` | `regex-rules` | `legal-ner`): case number, court, bench, parties, filing date, subject, act/section refs, cause title. **`analysisStatus`:** `structured` = autofill; `unstructured` = empty form (not an error); `failed` = retry.

**Custom schema (Tier B)** — `fieldManifest.fields[]` supports `extract.method`: `regex`, `builtin`, `llm`, `tool`. Set `outputProfile: "extraction"`. Poll `GET /jobs/:id` then `GET /jobs/:id/result`.

```json
{
  "correlationId": "<uuid>",
  "orgId": "<X-Org-Id value>",
  "storageRef": { "type": "inline_base64", "base64": "…", "mimeType": "application/pdf" },
  "outputProfile": "extraction",
  "fieldManifest": {
    "fields": [
      { "key": "firmName", "type": "string", "extract": { "method": "llm", "instruction": "Registered firm name" } },
      { "key": "pan", "type": "string", "extract": { "method": "regex", "pattern": "[A-Z]{5}[0-9]{4}[A-Z]" } }
    ]
  }
}
```

**Headers:** same as §1 (`X-API-Key`, `X-NYV-Platform: nsp`, `X-Customer-User-Id`, `X-Org-Id` where org-scoped). **Re-probe:** `scripts/nv-nsp-partner-reprobe.sh`.

### 3.2c NSP wiring checklist — demo handoff (NYV-owned vs NSP-owned)

> **Purpose:** paste-ready ownership matrix for NSP backend / BFF / mobile leads wiring **CNR resolve**, **Tier A `analysisStatus`**, and **Tier B `fieldManifest`** for the demo.  
> **Live deploy:** NYV gateway **`ee541ca1`** · deploy **`2026-08-21T0102Z-aws-ssm-ee541ca1`** (SSM `47d7b326…`, OpenRouter STT cascade live) · NYS worker **`c02fc526…`** · base URL **`https://api.nyayasiddhi.online`**.  
> **Demo verify (2026-08-20T17:35Z):** reprobe **9/9 PASS** (2 SKIP) · CNR `profile:caseCreate` live · Tier A `analysisStatus=structured` on ≥516-char filing excerpt.
> **Demo models (2026-08-21):** counsel chat → Bedrock **Sonnet 5**; draft (`legal-draft-fast`, `doc-draft-fast`) → Bedrock **`us.anthropic.claude-opus-5`**; counsel `legal-draft` uses Queen path (600s worker — not `-fast` SLA); STT → **gemini-3.7-flash** `isSimulation=false` (OpenRouter Whisper backup). Cascade: `NYV_PARTNER_LEGAL_PREMIUM_FIRST=0`, Opus-first `NYV_LLM_CASCADE_LEAD` (no dead `global.anthropic.claude-opus-5` rung), `NYV_LLM_HEDGE_MS=0`. Apply: `scripts/_ec2-opus-draft-routing-go.sh`. Deploy **`2026-08-21T0233Z-aws-ssm-ee541ca1`**.
> **Terminology:** eCourts identifier is **CNR** (16-character Case Number Record). There is no separate **CRN** field in corpus/RDS — if your UI says CRN, map it to CNR.

#### Master ownership matrix

| Surface | NYV (shipped — do not rebuild) | NSP (your wiring) | Verify |
|---|---|---|---|
| **CNR New Case autofill** | `POST /api/nv/v1/sdk/cnr/resolve` with **`profile: "caseCreate"`** · `data.caseCreate` + `fieldManifest` · Athena cold path on `judgments_meta_hc_case_details` · always `claimEcourts: false` | BFF call + map **`data.caseCreate.*`** (§3.2d) · handle `found` / `suggested` / `not_found` · manual next-hearing + PII | CNR caseCreate curl in §3.2c.5 |
| **Tier A — court filing autofill** | `POST /api/nv/orchestrate` emits **`data.analysisStatus`** + filing fields when input ≥220 chars + court cue | Send filing text in `documentText` · branch on `structured` / `unstructured` / `failed` | Reprobe **`nyv6_analysisStatus`** |
| **Tier B — onboarding / arbitrary forms** | `POST /api/nv/v1/sdk/ecosystem-documents/jobs` with `outputProfile: "extraction"` + `fieldManifest` · poll + result APIs live (EDJ) | Define your schema in `fieldManifest` · async job UI (create → poll → map `fields`) · no parallel parser | EDJ job completes → `GET …/result` has `fields` |
| **Firm clause library only** | Injection on `/api/nv/orchestrate` when `_firmClauseLibrary` present | Send **`X-Org-Id`** matching each clause's `orgId` · read `data.firmClauses.reason` if clauses dropped | Reprobe `x_org_id_clause` with `X_ORG_ID` set |

**NYV is not blocking the demo** on the three rows above unless you can reproduce missing fields with a **`requestId`** after following this checklist.

#### Decision tree (which checklist applies)

```
User action
│
├─ Typed or scanned CNR (16 alnum)?
│     └─► §3.2c.3 CNR checklist
│
├─ Indian court filing PDF (petition, WS, order, notice)?
│     └─► §3.2c.1 Tier A checklist
│
└─ Firm onboarding / corporate / non-court PDF?
      └─► §3.2c.2 Tier B checklist
```

---

#### 3.2c.1 Tier A — `analysisStatus` on `/api/nv/orchestrate`

| | Owner | Item |
|---|---|---|
| **NYV** | Endpoint live | `POST /api/nv/orchestrate` (also `/api/nv/v1/sdk/orchestrate`) |
| **NYV** | Status field | **`data.analysisStatus`** ∈ `structured` \| `unstructured` \| `failed` (merged from extras by the orchestration contract; legacy clients may also read `data.extras.analysisStatus`) |
| **NYV** | Companion fields | `analysisStatusReason`, `fieldSource`, `fieldCount`, `fields[]`, `detectedDocumentType`, flat aliases (`statutes`, `entitiesFlat`, …) — same top-level merge |
| **NYV** | Gate | Court-doc block only when inline text ≥ **220 chars** **and** structural cue present (`IN THE HIGH COURT`, `Petition No.`, `versus`, `PRAYER:`, etc.) — shorter excerpts return **no** `analysisStatus` (not a failure) |
| **NSP** | Request shape | Put OCR/extracted body in **`documentText`** (or `documentContent` / `content` / `text` — longest wins). Keep `prompt` as the task instruction. |
| **NSP** | Response parse | **`response.data.analysisStatus`** (preferred). Do not use internal `heuristicFallback`. |
| **NSP** | UX branch | `structured` → autofill form keys from `extras.fields` / flat aliases · `unstructured` → empty form (cache, not error) · `failed` → retry once, then alert |
| **NSP** | Headers | `X-API-Key`, `X-NYV-Platform: nsp`, `X-NYV-Consent: granted`, `X-Customer-User-Id` (per user/matter) |
| **NSP** | Anti-patterns | Prompt-only with no document body · excerpt &lt; 220 chars · expecting `analysisStatus` on pure chat with no filing text |

**Platform date (NV-PLATFORM-TEMPORAL-001):** Every counsel overlay injects **`PLATFORM REFERENCE DATE`** (Asia/Kolkata, authoritative). Models must **not** treat the current calendar year as "future". Current-year crime/news/count queries auto-enable **live web search** when tools are not explicitly set.

**Minimal smoke request (NSP BFF):**

```http
POST /api/nv/orchestrate HTTP/1.1
X-API-Key: <NYV_SDK_KEY_NSP>
X-NYV-Platform: nsp
X-NYV-Consent: granted
X-Customer-User-Id: <your-user-id>
Content-Type: application/json

{
  "taskType": "legal-chat-fast",
  "jurisdiction": "IN",
  "prompt": "Review this filing.",
  "documentText": "IN THE HIGH COURT OF TELANGANA AT HYDERABAD\nCRIMINAL PETITION No. 4471 OF 2025\nBetween X Petitioner and State of Telangana Respondent\nUnder Section 438 CrPC anticipatory bail.\n\nThe petitioner seeks protection from arrest in connection with Crime No. 123 of 2025 registered at Banjara Hills Police Station.\n\nPRAYER: Allow this Criminal Petition and grant anticipatory bail."
}
```

**Expected:** `success: true` and **`data.analysisStatus`** present (typically `structured` for a real filing excerpt ≥220 chars). If absent on a full document, send NYV the `requestId` from the response envelope.

---

#### 3.2c.2 Tier B — `fieldManifest` (firm / onboarding autofill)

| | Owner | Item |
|---|---|---|
| **NYV** | Submit | `POST /api/nv/v1/sdk/ecosystem-documents/jobs` → `202 { jobId }` |
| **NYV** | Lifecycle | `GET …/jobs/:jobId` — `queued` → … → `completed` \| `failed` |
| **NYV** | Autofill map | `GET …/jobs/:jobId/result` → **`data.fields: { yourKey: value }`** |
| **NYV** | Extractors | `fieldManifest.fields[].extract.method`: `regex`, `builtin`, `llm`, `tool` (NV-EDJ-003 — real LLM path, no stub) |
| **NYV** | Shim | `POST /api/nv/shared-docs/process` delegates to same worker for small files |
| **NSP** | Schema | One manifest entry per onboarding form field you want autofilled |
| **NSP** | Profile | Set **`outputProfile: "extraction"`** (not `full_intelligence` for instant single-form autofill) |
| **NSP** | Async UI | Show poll/progress — Tier B is **not** synchronous like Tier A |
| **NSP** | Body ids | Include `correlationId`, `orgId`, `userId`; `storageRef.type: inline_base64` or your stored ref |
| **NSP** | Method choice | `regex` for PAN/GSTIN/CNR patterns · `llm` for semantic fields (firm name, partner list) |
| **NSP** | Result bind | Map `GET …/result` → `fields` into NSP onboarding screens |

**Minimal job body (NSP):**

```json
{
  "correlationId": "<uuid>",
  "orgId": "<nsp-firm-org-id>",
  "userId": "<customer-user-id>",
  "storageRef": {
    "type": "inline_base64",
    "base64": "<pdf-bytes>",
    "mimeType": "application/pdf",
    "fileName": "onboarding.pdf"
  },
  "outputProfile": "extraction",
  "fieldManifest": {
    "version": "1",
    "fields": [
      { "key": "firmName", "type": "string", "required": true,
        "extract": { "method": "llm", "instruction": "Registered name of the law firm" } },
      { "key": "pan", "type": "string",
        "extract": { "method": "regex", "pattern": "[A-Z]{5}[0-9]{4}[A-Z]" } }
    ]
  },
  "delivery": { "mode": "poll" }
}
```

**NSP does not need a new NYV endpoint for onboarding autofill** — wire this job flow.

---

#### 3.2c.3 CNR — corpus resolve & case autocreation

| | Owner | Item |
|---|---|---|
| **NYV** | Primary API | `POST /api/nv/v1/sdk/cnr/resolve` · SDK `nyv.cnr.resolve()` (client-sdk ≥ 5.0.9) |
| **NYV** | Documents | `GET /api/nv/v1/sdk/cnr/:cnr/documents` — optional presigned PDF attach |
| **NYV** | Honesty | Always `claimEcourts: false` · UI badge **`Suggested · Judgment corpus`** |
| **NYV** | Coverage | ~20.5M CNR-populated judgment rows (SC/HC/DC AP+TG); one CNR → up to 25 doc rows |
| **NSP** | Flow A — typed CNR | User enters CNR → `POST …/cnr/resolve` → map `data.fields.*` to New Case / 02b |
| **NSP** | Flow B — upload | `docs-pipeline/extract` → regex `/[A-Z0-9]{16}/` after normalize → same resolve |
| **NSP** | Status UX | `data.status`: `found` → prefill · `suggested` → candidate picker (no silent overwrite) · `not_found` → miss modal · all may be HTTP 200 + `success: true` |
| **NSP** | Field map | See [`NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md`](./NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md) §3.5 — leave `nextHearingDate` empty (not in corpus v1) |
| **NSP** | Anti-patterns | Caselaw search for CNR identity · labelling as live eCourts · expecting unique 1:1 CNR→single PDF without user pick |

**Minimal resolve request:**

```http
POST /api/nv/v1/sdk/cnr/resolve HTTP/1.1
X-API-Key: <NYV_SDK_KEY_NSP>
X-NYV-Platform: nsp
Content-Type: application/json

{ "cnr": "RJHC010324382023", "options": { "includeDocuments": true, "fuzzyLimit": 5 } }
```

Optional BFF proxy: `POST /ns/v1/cnr/resolve` if already mounted — same contract.

---

#### 3.2c.4 Headers — demo minimum vs firm-clause only

| Header | Tier A | Tier B EDJ | CNR resolve | Firm clauses (`_firmClauseLibrary`) |
|---|---|---|---|---|
| `X-API-Key` | Required | Required | Required | Required |
| `X-NYV-Platform: nsp` | Required | Required | Required | Required |
| `X-NYV-Consent: granted` | Required | Required | If consent gate applies | If consent gate applies |
| `X-Customer-User-Id` | Strongly recommended | Recommended | Optional | Recommended |
| **`X-Org-Id`** | Not required | Body `orgId` suffices | Not required | **Required** — must match each clause's `orgId` |

**`X-Org-Id` format:** `[A-Za-z0-9_-]{1,64}` — UUID with hyphens OK, numeric like `4001` OK. **Not** the same header as `X-Organization-Id` (tenant-isolation mismatch checks). Invalid charset → HTTP 400 `ORG_ID_INVALID`.

---

#### 3.2c.5 Verification (NSP run before demo)

```bash
export NV_API_BASE_URL=https://api.nyayasiddhi.online
export NYV_SDK_KEY_NSP=<your-production-key>
export X_ORG_ID=<your-firm-org-id>   # optional; firm-clause probe only
bash nyayavigya-platform-312/scripts/nv-nsp-partner-reprobe.sh
```

| Probe | Pass means |
|---|---|
| `nyv6_analysisStatus` | Tier A path wired; read **`data.analysisStatus`** on a ≥220-char filing excerpt |
| `x_org_id_clause` | Firm clause org binding (skip if `X_ORG_ID` unset) |
| `nyv1_health` | Gateway reachable |

For **CNR caseCreate** (§3.2d):

```bash
curl -sS -m 65 -H "X-API-Key: $NYV_SDK_KEY_NSP" -H "X-NYV-Platform: nsp" \
  -H "Content-Type: application/json" \
  -d '{"cnr":"RJHC010324382023","options":{"profile":"caseCreate","includeDocuments":false}}' \
  "$NV_API_BASE_URL/api/nv/v1/sdk/cnr/resolve" \
  | jq '{success, status: .data.status, caseCreate: (.data.caseCreate != null), timeline: (.data.caseCreate.timeline|length), complete: .data.caseCreate.fieldManifest.complete}'
```

**Expected:** `success: true`, `status: "found"`, `caseCreate: true`, `timeline ≥ 1`, `complete` includes `cnr` / `caseTitle` / `timeline`.

For CNR health: `GET /api/nv/v1/sdk/cnr/health` → 200.

**Escalation to NYV:** any failure after this checklist → send **`requestId`** + request body (redact secrets). Do not open a NYV blocker without a reproducing `requestId`.

---

#### 3.2c.6 Paste-ready message to NSP engineering

> **NYV side for CNR, Tier A `analysisStatus`, and Tier B `fieldManifest` is deployed on gateway `ee541ca1` (NYS worker `c02fc526…`).**  
> **CNR:** Wire `POST /api/nv/v1/sdk/cnr/resolve` with **`profile: "caseCreate"`** — map `data.caseCreate.*` (not just flat `data.fields.*`).  
> **Tier A:** On `POST /api/nv/orchestrate`, send filing text in `documentText` (≥220 chars) and branch on **`data.analysisStatus`**.  
> **Tier B:** `POST /api/nv/v1/sdk/ecosystem-documents/jobs` with `outputProfile: "extraction"` + your `fieldManifest`; poll → `GET …/result` → map `fields`.  
> Full checklist: endpoints doc **§3.2c** / **§3.2d**. Re-probe: `scripts/nv-nsp-partner-reprobe.sh`. Contract refs: formal reply §7, `NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md`.

#### 3.2d Case Create field matrix — NSP parallel tasks (demo-ready)

> **Shipped on NYV/NYS (P0–P2):** `options.profile: "caseCreate"` on `POST /api/nv/v1/sdk/cnr/resolve` returns structured **`data.caseCreate`** + **`data.fieldManifest`** for New Case autofill. Athena cold path on `parquet_case_details` runs when RDS `cnr_case_details` is empty/incomplete — **no wait for nightly sync**. Optional **`data.extractPreview`** when PDF extract fills gaps (police station, summary snippet). **Flow never blocks:** empty fields → manual entry; `not_found` → continue manually.

##### NYV / NYS — shipped (do not rebuild)

| Tier | Trigger | API / behaviour |
|---|---|---|
| **P0** | CNR typed | `POST …/cnr/resolve` with `"options": { "profile": "caseCreate", "includeDocuments": true }` |
| **P0** | Response | `data.caseCreate.header`, `.timeline[]`, `.clients[]`, `.opposingParties[]`, `.summary`, `.fieldManifest` |
| **P0** | Back-compat | `data.fields.*` still populated (`caseTitle`, `hearings`, `policeStation` added) |
| **P2** | RDS miss / thin details | `sourcesTried` includes `opendata_athena_case_details` → Athena `ATHENA_TABLE_HC_CASE_DETAILS` |
| **P2** | Write-through | Athena hit upserts `cnr_case_details` async (next lookup faster) |
| **P1** | Metadata gaps + PDF | `includeExtractPreview: true` (default **on** for `caseCreate`) → `data.extractPreview` |
| **Ops** | Athena table | **`judgments_meta_hc_case_details`** — **CONFIRMED 2026-08-20** (~796,960 rows). One-time DDL: run `NYS-Agentic-AI/scripts/athena-hc-case-details-ctas.mjs` from **developer/deploy IAM** (`iam/developer`); worker role **`nyv-caselaw-worker-role` lacks `glue:CreateTable`** — runtime Athena queries on worker are fine after table exists. Env: `ATHENA_TABLE_HC_CASE_DETAILS=judgments_meta_hc_case_details`. Athena SQL uses **`trim()`** not `btrim()`. |
| **Ops** | RDS backfill | `nys-cnr-index-sync.mjs` continues nightly (parallel, not blocking) |

**Minimal case-create request:**

```http
POST /api/nv/v1/sdk/cnr/resolve HTTP/1.1
X-API-Key: <NYV_SDK_KEY_NSP>
X-NYV-Platform: nsp
Content-Type: application/json

{
  "cnr": "RJHC010324382023",
  "options": {
    "profile": "caseCreate",
    "includeDocuments": true,
    "includeExtractPreview": true
  }
}
```

##### NSP engineering — parallel tasks (owner: NSP)

| ID | Task | Map from `data.caseCreate` | Empty-field UX |
|---|---|---|---|
| **NSP-CC-01** | BFF: call resolve with `profile: "caseCreate"` | — | 60s timeout; never block create |
| **NSP-CC-02** | Case header form | `header.caseTitle`, `header.cnr`, `header.filingDate`, `header.caseStatus`, `header.policeStation` | `nextHearingDate` always editable + helper text |
| **NSP-CC-03** | Timeline grid | `timeline[]` → Date, Purpose, Judge, Status | Allow append manual rows |
| **NSP-CC-04** | Summary textarea | `summary.value` | Spinner if null; show `extractPreview` note |
| **NSP-CC-05** | Clients list | `clients[]` → type, name, advocate; leave father/address/phone/email blank | Manual PII entry required |
| **NSP-CC-06** | Opposing parties | `opposingParties[]` | Same as clients |
| **NSP-CC-07** | Witnesses | `witnesses[]` (usually empty) | Tier B EDJ async optional post-demo |
| **NSP-CC-08** | Provenance chips | `*.source` on each field | Badge: `Suggested · Judgment corpus` |
| **NSP-CC-09** | `fieldManifest` branch | `complete` / `partial` / `missing` / `manualRecommended` | Highlight missing; never error |
| **NSP-CC-10** | Status UX | `data.status` `found` / `suggested` / `not_found` | §3.2c.3 unchanged |
| **NSP-CC-11** | Attach PDF | `documents[0].url` from documents list | Optional “Attach judgment” |
| **NSP-CC-12** | SDK types | `@nyayavigya/client-sdk` ≥ **5.1.1** — `CnrCaseCreateProfile` | TypeScript map helpers |

##### Field coverage honesty (corpus-only)

| NSP field | Autofill | Source |
|---|---|---|
| CNR, court, title, parties (names) | High | RDS / Athena judgments |
| Filing date, timeline (HC) | Medium–High | `cnr_case_details` / Athena case_details |
| Case status | Medium | Often DISPOSED |
| Police station | Low–Medium | FIR ref or PDF extract |
| Next hearing | **None** | Manual only (not in corpus) |
| Client phone / email / address | **None** | Manual only |
| Witnesses | Low | Empty unless EDJ/LLM post-step |

##### NSP paste-ready message

> Wire **`profile: "caseCreate"`** on CNR resolve. Map **`data.caseCreate`** sections to New Case. Use **`fieldManifest.missing`** to show editable empty fields — **never block case create**. Next hearing and client PII are expected manual. Full matrix: endpoints doc **§3.2d**. SDK ≥ 5.1.1.

### 3.3 Retrieval / knowledge (zero or low LLM — use these before generating)

| Surface | Endpoint | SDK | Class |
|---|---|---|---|
| Statute / caselaw / acts typeahead | `GET /api/nv/knowledge/statutes/search` · `GET /api/nv/knowledge/caselaw/search` | `nyv.instantSearch.statutes()` / `.caselaw()` | Interactive (<3s) |
| Hybrid knowledge search | `POST /api/nv/knowledge/search` · `POST /api/nv/knowledge/retrieve` | `nyv.knowledge.search` / `.retrieve` | Interactive |
| IPC→BNS / CrPC→BNSS mapping (zero LLM) | `POST /api/nv/knowledge/statutes/compare/:kind` (`ipc-bns` · `old-new` · `new-old`) | `nyv.knowledge.compareOldToNew()` / `.compareNewToOld()` | Interactive (<1s) |
| Citation verify / extract | `POST /api/nv/knowledge/caselaw/verify-citation` · `POST /api/nv/knowledge/citations/extract` | `nyv.knowledge.verifyCitation` / `.extractCitations` | Interactive |
| Templates catalog | `GET /api/nv/knowledge/templates` | `nyv.knowledge.listTemplates` | Interactive |
| Matter RAG query | `POST /api/nv/rag/query` · `POST /api/nv/rag/collections/auto/retrieve` | `nyv.rag.query` / `.autoRetrieve` | Interactive |
| CNR New-Case autofill (corpus only, never live eCourts) | `POST /api/nv/v1/sdk/cnr/resolve` · `GET /api/nv/v1/sdk/cnr/:cnr` | `nyv.cnr.resolve` | Interactive |
| Live legal feed / regulatory digest | `GET /api/nv/v1/sdk/legal-intelligence/feed` (+ `/history`) · `GET /api/nv/intelligence/regulatory-feed` | `nyv.intelligence.getLegalFeed*` | Interactive |
| Legal-work tasks / runs / evaluate | `POST /api/nv/legal-work/runs` · `POST /api/nv/legal-work/evaluate` | `nyv.legalWork.createRun` / `.evaluate` | Interactive |
| Voice dictation → text (NSP Pro mic) | `POST /api/nv/legal-chat/voice/transcribe` (alias `/stt`) | — | Interactive |
| Gateway research Q&A / precedent | `POST /api/nv/gateway/research/query` · `/research/precedent` | `nyv.gateway.researchQuery` | Interactive |
| Translate / transliterate | `POST /api/nv/gateway/translate*` | `nyv.gateway.translate*` | Interactive |
| Usage / token accounting | `GET /api/nv/gateway/usage` · `/usage/tokens` | `nyv.gateway.usage()` | — |
| Health | `GET /api/nv/gateway/health` · `GET /api/nv/health` | — | — |

### 3.4 Do **not** call these for partner AI tasks

| Path | Why |
|---|---|
| `POST /api/nv/gateway/documents/draft` | hardcodes `taskType: document-drafting` + `enableCoT: true` → always Queen. The `-fast` SLA can never apply. Use `/api/nv/orchestrate`. **The former exception no longer applies:** the firm clause library (§4a.1) now works on `/api/nv/orchestrate` too, so there is no reason to come here for house wording. |
| `/api/nv/legal-chat/sessions` · `/send` · `/timeline/*` · `/feedback` · `/replay/*` | **JWT only** (Console admin / SME dashboard). An SDK key gets 401. Partner chat must use `/api/nv/orchestrate`. Only `/api/nv/legal-chat/voice/*` accepts SDK keys. |
| `POST /api/nv/stream` | Console AG-UI, admin JWT. Partner streaming is `/api/nv/orchestrate/stream` (outcome-only by design). Stream filter contract: [`NYV-NSP-STREAM-FILTER-2026-08-28.md`](./NYV-NSP-STREAM-FILTER-2026-08-28.md). |
| Direct calls to `nyayasearch.nyayasiddhi.online` | NYS is federated under `/api/nv/knowledge/*`. Calling it directly bypasses auth, metering, and jurisdiction scope. |

---

## 4. Request configuration that changes AI quality

```json
POST /api/nv/orchestrate
{
  "prompt": "Draft a Written Statement in a civil suit for recovery of money.",
  "taskType": "legal-draft-fast",
  "jurisdiction": "IN",
  "agentKey": "drafting-specialist",
  "ragDocumentIds": ["<edj-doc-id>"],
  "sessionId": "<matter-thread-id>"
}
```

| Field | Send it when | Effect |
|---|---|---|
| `taskType` | **always** | selects depth + SLA (§3.1). The single most important field. |
| `jurisdiction` | always | `IN` for NSP/NYM. Drives BNS/BNSS/BSA statute set, not IPC/CrPC. |
| `agentKey` | when you know the specialism | routing hint to one of the 164 registry agents. Ignored if it does not resolve; never a failure. |
| `ragDocumentIds` | after indexing a matter file | grounds the answer on the client's documents instead of the prompt blob. |
| `sessionId` | multi-turn | enables memory + turn continuity for that matter thread. |
| `enableCoT` | **do not send on `-fast`** | `true` forces chain-of-thought back on and defeats the fast SLA. Omit the field entirely. |
| `partnerSyncLean` | do not send | ignored for NSP/NYM unless ops sets `NYV_ALLOW_NSP_NYM_LEAN=1`. The supported lean switch is the `-fast` `taskType`. |
| `orchestrationMode` | do not send | forces Queen (`swarm` / `hierarchical` / `parallel`) regardless of `-fast`. |

**RAG, citation verification and hallucination checking stay ON for every class, including `-fast`.** Fast means "skip the extra chain-of-thought pass", not "skip safety".

---

## 4a. Firm clause library — `_firmClauseLibrary` (NV-FIRM-CLAUSE-DRAFT-001)

NSP owns the firm clause library. `ns_clause_library` is **NSP's** table and does not exist in the NYV tree; NYV has no org-scoped firm clause table (`sdk_clause_library` is a 15-row platform-curated global catalogue with no `org_id`, `nv_template_clauses` FKs to templates with no `org_id`). So NYV did not invent one — it accepts the firm's wording as a **receiving contract** and injects it into the drafting system prompt. This section is that contract.

### 4a.1 Where it works — the interactive drafting paths, as of 2026-08-20

| Path | Firm clauses honoured? |
|---|---|
| `POST /api/nv/orchestrate` (+ `/stream`) with a drafting `taskType` | **Yes** — `legal-draft-fast`, `legal-draft`, `doc-draft-fast`, `doc-draft`, `document-drafting` |
| `POST /api/nv/v1/sdk/orchestrate` with a drafting `taskType` | **Yes** |
| `POST /api/nv/gateway/documents/draft` | **Yes** (unchanged) |

**This corrects the previous version of this section, which said `gateway/documents/draft` was the only path.** That was true when it was written and is no longer: `_firmClauseLibrary` had exactly one call site, on the path §3.4 tells you *not* to use for interactive AI, so firm wording and the 90 s `-fast` SLA were mutually exclusive. They are not any more — **you can send `_firmClauseLibrary` on `/api/nv/orchestrate` with `taskType: "legal-draft-fast"` and get house wording inside the fast SLA.**

Two things to know about how it is wired, because they determine what you can rely on:

- The injection point is the **shared drafting-prompt composer**, not a per-endpoint branch. Every drafting path — the specialist leg, the Queen leaves, the doc-pipeline leg, and the gateway route — reaches that one composer, so a new drafting surface inherits the behaviour without another change here.
- The **caps are tighter on the `*-fast` roles** (§4a.5). That is deliberate: an interactive prompt has a smaller token ceiling than the CoT-enabled gateway path, and NYV reduced the clause payload rather than raising a budget.

### 4a.2 Request shape

`_firmClauseLibrary` is accepted **top-level or inside `parameters`** (top-level wins). `firmClauseLibrary` without the underscore is accepted inside `parameters` only. The value is either a bare array of clauses or `{ "clauses": [...] }`. The same shape works on `/api/nv/orchestrate` and on `gateway/documents/draft`.

```json
POST /api/nv/orchestrate
X-API-Key: <NYV_SDK_KEY_NSP>
X-NYV-Platform: nsp
X-Org-Id: 4001
Content-Type: application/json

{
  "prompt": "Draft an MSA between Acme Pvt Ltd and Beta LLP for managed IT services.",
  "taskType": "legal-draft-fast",
  "jurisdiction": "IN",
  "parameters": {
    "template": "master_services_agreement",
    "documentType": "msa",
    "practiceArea": "corporate",
    "_firmClauseLibrary": {
      "clauses": [
        {
          "orgId": "4001",
          "clauseType": "limitation_of_liability",
          "title": "House LoL — 12-month fee cap",
          "text": "The aggregate liability of either party shall not exceed the fees paid in the twelve months preceding the claim.",
          "documentTypes": ["msa", "sla"],
          "practiceAreas": ["corporate"],
          "jurisdiction": "IN",
          "priority": 90
        }
      ]
    }
  }
}
```

### 4a.3 Clause object — field by field

| Field | Required | Accepted aliases | Notes |
|---|---|---|---|
| `orgId` | **yes** | `org_id`, `tenantId`, `tenant_id` | Must equal the RLS-bound org for the request — see §4a.4. A clause with no owner is **discarded**; NYV will not default it to the caller |
| `text` | **yes** | `clauseText`, `clause_text`, `defaultText`, `default_text`, `body` | The house wording |
| `clauseType` | no | `clause_type`, `category`, `type` | Defaults to `general`. Echoed into the prompt as `[clauseType]` |
| `title` | no | `clauseName`, `clause_name`, `name` | Defaults to `clauseType` |
| `documentTypes` | no | `document_types`, `documentType`, `document_type`, `templates` | Array, or a string delimited by comma / semicolon / pipe. Lower-cased. **Empty = firm-wide default** |
| `practiceAreas` | no | `practice_areas`, `practiceArea`, `practice_area` | Same coercion |
| `jurisdiction` | no | — | Upper-cased. Omit unless the wording is genuinely jurisdiction-specific (see §4a.6) |
| `priority` | no | `popularity` | Higher wins when the cap forces a choice. Contributes at most 2 points of score, so it is a tie-breaker, not an override |

Both `camelCase` and `snake_case` work throughout. A malformed entry is dropped, not an error: the whole payload can be `null`, a string, or `{clauses: "nope"}` and the draft still succeeds without firm wording.

### 4a.4 `X-Org-Id` is mandatory — this is the first thing to get wrong

Firm clauses are only injected when the clause's `orgId` equals the org **the request is RLS-bound to**. That org is **not** taken from your API key: the tenant binding runs app-level, before the gateway router validates `X-API-Key`, so at binding time NYV has no SDK context and falls back to the `X-Org-Id` request header (and, absent that, to the literal `default` in production). This applies on `/api/nv/orchestrate` exactly as it does on the gateway draft path.

Measured on the real middleware chain: with `sdkContext.organizationId = 7777` set by gateway auth, the bound org was `default` with no header and `4001` when `X-Org-Id: 4001` was sent.

```http
X-API-Key: <NYV_SDK_KEY_NSP>
X-NYV-Platform: nsp
X-Org-Id: 4001          ← must match the `orgId` on every clause you send
```

So: **send `X-Org-Id` on every draft call, and use that same value as `orgId` on each clause.** If you omit it, your clauses are stamped `4001`, the bound org is `default`, and every clause is dropped as cross-tenant. The draft still returns normally with generic wording — but you now get a `reason: "org_unresolved"` diagnostic saying so (§4a.8), instead of the silent 200 this section previously had to warn you about. `X-Org-Id` is distinct from `X-Tenant-Id` / `X-Organization-Id` (those are checked against the authenticated tenant by `tenantIsolation`); it is not currently cross-checked against your key, which is a NYV-side hardening item, not a licence to send another firm's id.

### 4a.5 Caps — per role, and which are *dropped* vs *truncated*

The caps depend on the role, because an interactive `*-fast` prompt has a smaller ceiling than the CoT-enabled gateway path.

| Cap | `*-fast` roles | `legal-draft` / `document-drafting` / gateway draft | Behaviour when exceeded |
|---|---|---|---|
| `maxClauses` | **2** | **4** | Lower-ranked clauses are **dropped** — not summarised, not merged |
| `maxCharsPerClause` | **400** | **600** | The clause **text is truncated**, at a word boundary, with a ` […]` marker **counted inside** the cap |
| `maxTotalChars` | **800** | **2,400** | A clause that would breach the total is **skipped**; ranking continues to the next one, which may still fit |

Measured worst case (2026-08-19): **467 prompt tokens** on the `*-fast` roles, **881** on the wide roles — under 5% of the drafting ceiling, and inside the tightest tier a drafting prompt can land in (`chat`, 2,500). **No budget was raised for this feature**; the fast payload was reduced instead. The precedence paragraph (§4a.10) is **not** shortened on the fast path — it is a legal correctness guarantee, not padding.

Practical consequence: on an interactive `-fast` draft, send your **two most important** clauses for that instrument and keep each under 400 characters. Use `priority` and `documentTypes` so the two that survive are the two you meant.

### 4a.6 Selection and ranking (deterministic — no embeddings)

Score: instrument match **+4**, practice-area match **+3**, jurisdiction match **+1**, firm-wide default (no `documentTypes` **and** no `practiceAreas`) **+1**, plus `min(2, priority/50)`. Ties break alphabetically by `title`, so ordering is stable across identical requests.

Exclusions, in the order that bites:

1. **Wrong org** → dropped, and NYV logs `NV-FIRM-CLAUSE-TENANT-001`. Non-zero there is treated as a NYV-side bug (the FB-190 class), so if you see empty output for clauses you believe are yours, check `orgId` first.
2. **Jurisdiction mismatch** → dropped. `"jurisdiction": "SG"` on an `IN` draft never appears. A clause with **no** `jurisdiction` matches every request — that is the safer default for house wording.
3. **Targeted at other instruments** → a clause naming `documentTypes` that matches neither the instrument nor the practice area is dropped. That targeting is read as the firm telling NYV where the wording applies.

Matching is substring-based against `documentType` + `template` + inferred family, so `"documentTypes": ["msa"]` matches `template: "master_services_agreement"`.

### 4a.7 Which drafting families accept clauses

The gate is an **allow-list of transactional instruments**, not a deny-list of court filings: `contract`, `notice`, `letter`. All three are reachable.

**This corrects the previous version, which listed a fourth entry, `agreement`.** That was a **dead allow-list branch** — `inferDraftDocFamily` never returned `agreement`, so the branch could not execute. The `agreement` family has since been removed: it emitted a skeleton byte-identical to `contract`, making it a synonym rather than a family, and every agreement-shaped instrument now resolves to `contract`. Nothing you send changes; the allow-list simply no longer advertises a family that does not exist.

Everything else ignores firm clauses — `bail`, `slp`, `petition`, `plaint`, `affidavit`, `written_statement`, `counter_affidavit`, `rejoinder`, `review_petition`, `execution_petition`, `caveat`, `interim_application`, `fir`, `application`, `memo`, `opinion`, **and `custom`**. A negotiated indemnity carve-out inside a bail application is a drafting defect a registry would reject, so this is deliberate and is enforced twice (at resolution, and again when the prompt is assembled — a hand-crafted overlay cannot be smuggled into a bail draft).

**A bare descriptive slug now works.** The previous version of this section told you a slug alone resolved to `custom` and your clauses were silently ignored unless you *also* sent `documentType` **and** a real `instruction`. That was measured and true; it has been fixed. Re-measured 2026-08-19, `template` only, no `documentType`, no `instruction`:

| `template` slug alone | family | clauses used |
|---|---|---|
| `master_services_agreement` | `contract` | **yes** |
| `services_agreement` | `contract` | **yes** |
| `share_purchase_agreement` · `employment_agreement` · `loan_agreement` · `settlement_agreement` · `franchise_agreement` | `contract` | **yes** |
| `lease_deed` · `term_sheet` | `contract` | **yes** |
| `nda` · `msa` · `sla` · `mou` · `contract` | `contract` | **yes** |
| `legal_notice` · `demand_notice` | `notice` | **yes** |
| `engagement_letter` · `covering_letter` · `letter` | `letter` | **yes** |
| `bail_application` | `bail` | **no** (by design) |
| `special_leave_petition` · `written_statement` · `counter_affidavit` · `review_petition` · `execution_petition` · `writ_petition` · `caveat` · `interim_application` | their own court family | **no** (by design) |

Sending `documentType` and a real `instruction` is still **recommended** — it improves the draft, and instrument matching (§4a.6) is more accurate with it — but it is no longer required for your clauses to be seen.

### 4a.8 Fail-soft — it never breaks a draft, and it now tells you when it skipped

Every failure path returns an empty overlay and the draft proceeds with generic wording: unresolved org, ineligible family, malformed payload, DB error, or zero clauses surviving selection. **A draft is always produced. Firm wording is a preference and can never fail a request.**

What has changed: when you **supplied** clauses and **none** were applied, NYV now emits a non-fatal signal instead of staying silent. Server-side it logs `NV-FIRM-CLAUSE-DIAG-001` with the count and the reason; caller-side the response carries a diagnostic of this shape:

```json
{
  "supplied": 3,
  "applied": 0,
  "reason": "org_unresolved",
  "message": "0 of 3 supplied clauses applied: the organisation for this request could not be resolved, so every clause was treated as cross-tenant — send the X-Org-Id header (the API key does not supply the org on this chain)."
}
```

| `reason` | What to fix |
|---|---|
| `org_unresolved` | Send `X-Org-Id` (§4a.4). This is the case that was previously undebuggable from outside |
| `cross_tenant` | The org resolved, but no clause carried that org's `orgId`. Check the `orgId` on each clause matches the header |
| `no_match` | Your clauses target a different instrument, practice area or jurisdiction than this draft (§4a.6) |

Deliberately **not** reported: an ineligible family. A bail application receiving no house wording is the family gate working, not your mistake — reporting it would train a UI to expect commercial clauses in a Court filing.

The diagnostic is **counts and a reason only**. It never echoes clause text and never names another org's identifier, so it is safe to log and safe to surface. There is still **no positive** "these N clauses were used" field — absence of a diagnostic means they were applied, but do not gate UI copy ("drafted in your firm's voice") on inferring that. If you need the positive signal, ask for it explicitly.

### 4a.9 Alternative — store the clauses once, server-side

Instead of sending clauses on every request, they can live in the existing org-scoped row `nv_organizations.settings->'clauseLibrary'` (same array/`{clauses:[]}` shape, same field names). NYV reads it inside the request's tenant transaction and stamps each clause with the org id **of the row it came from**, never the request's.

| | per-request `_firmClauseLibrary` | stored `settings->'clauseLibrary'` |
|---|---|---|
| Who owns the source of truth | NSP (`ns_clause_library`) | NYV row, provisioned once |
| Update path | your next request | ops/admin write |
| Best for | per-matter or per-client wording; NSP remains the editor | a stable firm-wide house style |

Both sources are merged and then ranked together under the same caps. **There is no partner-facing write endpoint for `settings->'clauseLibrary'` today** — provisioning it is an ops action, so treat the per-request path as the self-serve one.

### 4a.10 Precedence — read this before promising anything to a firm

The injected block **states its own ranking** so the model cannot read house wording as authority. Highest first:

1. Statute, subordinate legislation, binding precedent
2. The mandatory form / scope rules and any **Court-prescribed form**
3. The **anti-fabrication rule** — never invent citations, parties, section numbers, dates or figures
4. The **facts supplied for this matter**
5. **The firm's wording**

Where 1–4 require a departure, the draft departs and notes it in a non-operative "Counsel notes" appendix. A house clause **cannot** override a court-mandated form, and negotiated commercial positions are never carried into a Court filing. Do not build UI that implies a firm can pin wording that beats a statutory form.

### 4a.11 Honesty limit — quality improvement is unmeasured

What is proven: the firm's wording reaches the drafting system prompt on **every** drafting path (interactive `-fast` included), within stated caps, only for the firm that owns it, only for eligible families, and ranked below statute and mandatory form. Unit tests cover tenant isolation (the FB-190 regression), the per-role caps, the family gate, the non-shadowing of the twenty court families, the ranking, and the unapplied-clause diagnostic.

What is **not** proven: that drafts are *better*. There is no A/B measurement, no SME rubric score, and no eval comparing drafts with and without firm clauses. Sell it as "your clause wording is supplied to the model as a preference", not as a measured quality gain.

---

## 4b. `qualityEnvelope` — breaking-shaped change to `completed[]`, and legal chat now emits one (NV-QE-DEFERRED-SPLIT-001 / NV-LEGALCHAT-QE-001)

**Action required: if you count `qualityEnvelope.completed` as "gates passed", read §4b.1 — the count changes.**

### 4b.1 `deferred` records have left `completed[]`

`snapshotQualityEnvelope` used to push **both** `completed` and `deferred` step records into `completed[]`. So `hitl` — a human-in-the-loop review that is **queued and has not happened** — was reported inside the array named `completed`. Verified on the live dev gateway before the fix: the `hitl` record read `{"status": "deferred"}` while `completed[]` contained `hitl`.

Rendering that array as ticks tells a lawyer a human signed off on work no human has seen. So it is fixed at source rather than papered over in each UI:

| Field | Before | Now |
|---|---|---|
| `completed[]` | `completed` **+ `deferred`** records | `completed` records **only** |
| `scaledOptional[]` | `skipped_scaled` records | unchanged |
| `deferred[]` | **absent** | **new** — `deferred` records (queued, not yet performed) |
| `steps[]` | authoritative, per-stage `status` | unchanged — still authoritative |
| `ok` / `missingMandatory` / `failClosed` | — | **unchanged.** `deferred` was never counted as `failed`, so pass/fail accounting does not move |

**What this means for you concretely:** on a high/critical-risk task `hitl` now appears in `deferred[]` instead of `completed[]`, so `completed.length` is one lower than it used to be. That is not a regression in quality — the same gates ran; the report is simply no longer overstating them.

**Treat `steps[]` as the source of truth.** Each record carries its own `id` / `status` / `note` / `at`, and `status` is one of `completed` · `skipped_scaled` · `deferred` · `failed`. The summary arrays are a convenience projection. In particular: **a gate that never ran has NO record at all** — it appears only in `missingMandatory[]`. Absence of evidence must render as "not captured" or "missing", never as a pass.

### 4b.2 `POST /api/nv/legal-chat/send` now emits `qualityEnvelope` (additive)

`run_complete.data` previously carried `{response, citations, model, tokensIn, tokensOut, safetyBlocked, agentsUsed}`. It now **also** carries `qualityEnvelope`, the same shape as on `/api/nv/orchestrate`. Every pre-existing field is unchanged — this is additive; no existing reader breaks.

**Read it expecting an incomplete envelope, and do not treat that as an error.** Legal chat drives the Queen directly and therefore does **not** run the route-level gates `/api/nv/orchestrate` applies after orchestration. Rather than emit a full-looking envelope, it reports only what measurably ran:

| Gate | On legal chat | Why |
|---|---|---|
| `consent_credits` | **now `completed` when the cap ran** — see §4b.3 | Was permanently `failed`. The pre-spend AI-credit cap is now wired on this path. |
| `bias` | often missing | The bias check is queued only for mitra+ tiers. |
| `hallucination` / `citation` | missing if the check did not run | On `/api/nv/orchestrate` these run at route level; here they come from the Queen safety ring only. |

Consequently `ok` may still be `false` and `missingMandatory` non-empty on legal chat **while the answer is still delivered**. `failClosed` on this wire reports the enforcement *mode*, not a refusal; legal chat does not fail-closed on the envelope. If you surface a gate summary to a lawyer, render these as "not captured" / "missing", never as passes — and prefer `/api/nv/orchestrate` when you need the full audited chain.

### 4b.3 Legal chat: `consent_credits` can now pass, a spend cap can now refuse, and `rag_retrieval` finally carries real numbers (NV-LEGALCHAT-CREDIT-001 / NV-LEGALCHAT-RAG-EVENT-001)

**Action required only if you read the `rag_retrieval` SSE event — its `chunks` field can now be `null`.** Everything else here is additive or a gate turning green.

#### `consent_credits` is no longer permanently red

It used to be hard-coded to `failed` on this path with a note saying no pre-spend credit enforcement existed. That was true of the platform, and wrong as a report: a mandatory gate that can never go green teaches you to ignore `ok: false`, at which point the envelope is worth nothing.

The cap is now wired, so the gate reports what actually happened:

| `consent_credits` status | Meaning |
|---|---|
| `completed` | Consent re-checked by the safety ring **and** the pre-spend AI-credit cap reached a verdict before any model spend |
| `failed` | The cap did **not** run for this request (the enforcer fails soft on database trouble — see below). The `note` says so. Do not render as a pass |

Absent from `steps[]` entirely still means the ring never reported consent — read it as "not captured", per §4b.1.

#### A legal-chat turn can now be refused for budget

`POST /api/nv/legal-chat/send` enforces the same AI-credit cap `/api/nv/orchestrate` has always enforced, at the same point: before the model is called. When the budget is exhausted the stream terminates with `run_failed` and **no answer is produced**:

```json
{
  "step": "run_failed",
  "status": "failed",
  "message": "Daily token budget exceeded. Used: 800,000, Limit: 800,000. Resets at midnight UTC.",
  "data": {
    "error": "CREDIT_CAP_EXCEEDED",
    "code": "CREDIT_CAP_EXCEEDED",
    "reason": "Daily token budget exceeded. Used: 800,000, Limit: 800,000. Resets at midnight UTC.",
    "tier": "pro",
    "budgetLimit": 800000,
    "usedToday": 800000,
    "remainingToday": 0,
    "retryAfterSeconds": 1200
  }
}
```

`code` is deliberately the **same** `CREDIT_CAP_EXCEEDED` that `POST /api/nv/orchestrate/stream` emits, so you branch on one code across both SSE surfaces rather than two. The sync `/api/nv/orchestrate` returns HTTP 429 `RATE_LIMIT_EXCEEDED` with the same `details.code`; on an already-open event stream the terminal event is the equivalent. **Do not blind-retry** — honour `retryAfterSeconds`, and surface `remainingToday` rather than presenting it as a platform error.

The cap **fails soft**, matching `/orchestrate`: if the enforcer itself errors (missing table, DB blip) the answer is still produced, because a billing problem must never withhold a lawyer's answer. In that case `consent_credits` reports `failed`, so an unenforced request is visible to you rather than assumed.

The estimate prices the prompt that will actually be sent, **attachments included** — a 60 KB attached contract is the dominant cost term, and pricing the bare question would wave a request past a cap it exceeds.

#### `rag_retrieval` — `chunks: 0` no longer means two different things

**This event previously had no data source.** It read a Queen field that is never populated, so on every legal-chat turn ever it reported `chunks: 0` with `status: 'ok'`. If you were watching it, you were being told retrieval ran and found nothing. It was not telling you anything.

It now reports the Queen's measured Step-0 retrieval, and the four possible realities are **mutually exclusive** on `(status, chunks)`:

| `status` | `data.evidence` | `data.chunks` | `data.retrieved` | Reality |
|---|---|---|---|---|
| `running` | — | — | — | The initial announcement, unchanged. Always followed by one of the rows below |
| `ok` | `measured` | `> 0` | `true` | Retrieval ran and returned authorities. `layersUsed` / `retrievalMethods` / `intent` are populated |
| `ok` | `measured` | `0` | `false` | Retrieval ran and genuinely found **nothing**. This is the only case where `chunks` is `0` |
| `failed` | `measured` | **`null`** | `null` | Retrieval timed out or errored — the count was **never observed**. `data.reason` says which. `data.timedOut` distinguishes them |
| `skipped` | `absent` | **`null`** | `null` | No Step-0 evidence was surfaced at all. `data.reason`: "retrieval outcome unknown, not zero" |

**Two consequences for your reader:**

1. **`chunks` is nullable.** A reader doing `chunks || 0` or `Number(chunks)` will turn "we do not know" back into "found nothing" — which is the exact defect being fixed. Branch on `evidence` and on `chunks === null` first.
2. **`chunks: 0` is now trustworthy.** Because it is emitted only when a retrieval genuinely returned zero, an ungrounded answer is now something you can legitimately badge.

Removed fields (they were always empty, because the source object never existed): `sources`, `topScore`, `graphHits`, `collection`, `namespace`. Added: `evidence`, `source`, `attempted`, `retrieved`, `grounded`, `timedOut`, `layersUsed`, `retrievalMethods`, `intent`, `reason`.

`grounded` is separate from `retrieved` on purpose: `retrieved` means chunks came back, `grounded` means a context block was actually assembled into the prompt. They can differ, and treating them as one is how a zero-chunk retrieval gets reported as grounding.

---

## 4c. A spend cap is now evaluated on the document, research and intelligence endpoints — and is deliberately **not refusing yet** (NV-CREDIT-UNIVERSAL-001 / NV-CREDIT-OBSERVE-001)

**Read this if you call anything other than `/api/nv/orchestrate`.** Until now only
`/api/nv/orchestrate`, `/api/nv/orchestrate/stream` and `/api/nv/legal-chat/send`
could refuse a request for budget. A number of endpoints you use spent real money
with no cap at all. Those endpoints now carry a cap that is **wired, evaluated and
priced on every request** — and that, today, **records the refusal it would have
made instead of making it**. Nothing on the list below can currently return a
budget refusal.

**Do not read this section as "429s are coming tomorrow", and do not read it as
"nothing happened".** Two different things shipped, and only one of them is
inactive:

| What | State today |
|---|---|
| The cap: pricing the request, comparing it to the budget, reaching a verdict | **Live** on every endpoint below |
| The **refusal** based on that verdict | **Suppressed** — logged, not returned |
| The usage **recorder** that makes `usedToday` real | **Live**, and not gated by any of this (see the invoices note below) |

| Endpoint group | Cap evaluated | Can refuse today |
|---|---|---|
| `POST /api/nv/gateway/documents/{draft,analyze,summarize,compare,qa,extract-entities,classify-clauses}` | yes | no |
| `POST /api/nv/gateway/research/{query,precedent}` | yes | no |
| `POST /api/nv/gateway/agents/:agentId/execute` | yes | no |
| `POST /api/nv/gateway/legal-intelligence/feed/generate` | yes | no |
| `POST /api/nv/sdk/docs-pipeline/documents/*`, `/clauses/suggest` | yes | no |
| `POST /api/nv/v1/sdk/intelligence/*` | yes | no |
| `POST /api/nv/{intelligence,ai}/*` (the model-calling ones) | yes | no |
| `POST /api/nv/sdk/multimodal/voice/*`, `/api/nv/phase4/{voice,vision,vector}/*` | yes, **in micro-USD** | no |

The `/api/nv/v1/sdk/...` aliases of the above behave identically.

### Why it is recording instead of refusing

Not caution for its own sake — the budgets these caps enforce have **never been
compared to real consumption**. The cap admits or refuses on a running total summed
from the AI-credit usage table, and until the universal recorder shipped in this
same sprint, almost nothing wrote that table: the total was structurally zero, so
no cap could ever have fired. Turning the recorder and the refusals on in one
deploy would start refusing your work against numbers nobody has validated, and a
budget set too low refuses lawful work — a worse and far more visible failure than
the present over-permissiveness. So: record first, watch what *would* have been
refused, tune the budgets, then refuse.

Server-side each near-miss writes one `warn` line carrying the surface, the key
*identifier* (never key material), the tier, the limit that tripped, and **how far
over** the request was — the last of those being the point, because a cap that
would have refused by 200 tokens is a budget very slightly too small while one
that would have refused by 4M is a runaway caller.

**Nothing in the response claims otherwise.** No envelope stage, header or response
field reports "credits enforced" on a request that could not have been refused. If
you are looking for a signal that enforcement is on, there deliberately isn't one to
misread.

### When this changes, and how much warning you get

It changes by an **operator flipping `NYV_CREDIT_CAP_MODE` from `observe` to
`enforce`** — an environment switch on our side, **not a redeploy of new code and
not a new version of anything you integrate against**. Practical consequences for
you:

- **The behaviour can change without any release you can observe.** Do not treat
  "we tested it and never got a 429" as a property of the platform. It is a
  property of a flag.
- **The default is `observe`, and it fails toward `observe`**: an unset value, an
  empty value, or an unrecognised value all resolve to `observe`, so a deploy that
  forgets to set anything cannot start refusing by accident. Only an explicit
  opt-in flips it.
- **`NYV_CREDIT_ENFORCE=0` still overrides everything**, including
  `NYV_CREDIT_CAP_MODE=enforce`. An operator who has switched credit enforcement
  off entirely has not asked for refusals here either.
- **Build and ship the handler now.** The refusal contract below is final and is
  already live on the §4b.3 surfaces, so you can implement and test against those
  today. When the flag flips there will be nothing to change on your side — which
  is the entire reason this section exists rather than a release note after the
  fact.

### The four surfaces that DO refuse today — unchanged

`/api/nv/orchestrate`, `/api/nv/orchestrate/stream`, `/api/nv/legal-chat/send` and
`/api/nv/completions` enforce inline, on their own pre-existing path, and were
**deliberately not routed through the observe switch** — they carry live traffic
with established refusal behaviour, and putting them behind a default-off flag
would have *reduced* safety. Everything §4b.3 tells you about a legal-chat turn
being refused for budget remains true and active. The distinction is: those four
refuse; the list above evaluates and records.

### The refusal is the shape you already branch on

Unchanged, and this is the contract to write your handler against.
HTTP **429**, catalog code `RATE_LIMIT_EXCEEDED`, business code in `error.details`:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "NYV-CREDIT-001: AI token budget exceeded for this billing period.",
    "details": {
      "code": "CREDIT_CAP_EXCEEDED",
      "reason": "Daily token budget exceeded. Used: 800,000, Limit: 800,000. Resets at midnight UTC.",
      "tier": "pro",
      "budgetLimit": 800000,
      "usedToday": 800000,
      "remainingToday": 0,
      "retryAfterSeconds": 1200
    }
  }
}
```

`error.details.code` is deliberately the **same** `CREDIT_CAP_EXCEEDED` that
`/api/nv/orchestrate` returns and that the SSE surfaces emit in their terminal
`run_failed` event (§4b.3). **If you already handle the orchestrate refusal, you
handle these — one branch, not one per endpoint.** As there: **do not blind-retry**,
honour `retryAfterSeconds`, and surface `remainingToday` rather than presenting it
as a platform error.

No model is called on a refusal, so a refused request costs you nothing. In the
current `observe` mode the request proceeds instead, so it **does** call a model and
**does** cost you — which is the pre-existing behaviour, not a new charge.

### What is deliberately *not* capped

Free reads in the same routers still answer normally when a budget is exhausted,
because they do not spend: `GET /api/nv/sdk/docs-pipeline/documents/templates`,
`/clauses/library`, `/clauses/:clauseId`, `GET /api/nv/v1/sdk/intelligence/capabilities`,
`/client-health`, `/firm-snapshot`, and the deterministic statute-mapping paths
(§3). A cap that refused a free read would break a flow to close a gap that does
not exist on that path.

### Two things that have not changed for you

1. **NSP and NYM are unaffected in practice.** Ecosystem partner keys already skip
   product credit and hourly caps (`NYV_NSP_UNLIMITED` /
   `NYV_PARTNER_DEMO_UNLIMITED`, both default-on), and the new cap threads that same
   bypass. Your live Pro traffic is not newly refusable — and in `observe` mode it
   is not refusable at all. Handle the code anyway: the bypass is an operational
   setting, not a contract, and so is the mode.
2. **The cap fails soft.** If the enforcer itself errors (missing table, DB blip)
   your answer is still produced, because a billing problem must never withhold a
   lawyer's answer. This is independent of the mode: in `enforce` it is the
   difference between a 429 and an answer, in `observe` it makes no observable
   difference at all.

### Not everything is metered in tokens — the money dimension (NV-CREDIT-COST-DIM-001)

Thirteen of the capped surfaces spend real money **without consuming a single chat
token**: embeddings bill per 1,000 input tokens at an embedding rate, speech-to-text
per second of audio, text-to-speech per character, and off-safety-ring vision per
image. The daily token budget compares against a token counter, so it could not
meter any of them — and inventing a token-equivalence factor was rejected, because
that factor would silently have become our pricing policy for three product lines.

Those surfaces are therefore priced in **integer micro-USD** (1e-6 USD), the
resolution the credit ledger's cost column already stores, so the estimate is in the
same unit as the spend later recorded against it:

| Surface | Billed on | Measurable before the call |
|---|---|---|
| `POST /api/nv/gateway/documents/embeddings` | per 1k input tokens | yes |
| `POST /api/nv/sdk/docs-pipeline/documents/embeddings` | per 1k input tokens | yes |
| `POST /api/nv/phase4/vector/{search,ingest}` | per 1k input tokens | yes |
| `POST /api/nv/sdk/multimodal/voice/{transcribe,stt}` | per audio second | **only when you POST the audio** |
| `POST /api/nv/phase4/voice/transcribe` | per audio second | yes |
| `POST /api/nv/sdk/multimodal/voice/{synthesize,voiceover/generate}` | per character | yes |
| `POST /api/nv/phase4/voice/synthesize` | per character | yes |
| `POST /api/nv/phase4/vision/{analyze,ocr,classify}` | per image / per page | analyze & classify yes; **OCR no** |

These are metered in money **only** — their input text is not also charged against
the token budget, because that would count one request twice in two units.

`POST /api/nv/sdk/multimodal/vision/analyze` is **not** in this list even though you
pay per image for it: it runs through the safety ring, so its tokens do reach the
accumulator and tokens are the honest unit for that one. It is capped on tokens.

**Two cases cannot be priced before the spend, and we do not pretend otherwise.**

1. **OCR page count** — only known after the document has been rendered.
2. **URL-hosted audio** (`audioUrl` rather than an inline payload) — nothing has
   been fetched, so the duration is unknown.

For both, the pre-spend estimate is reported as **unmeasurable and recorded at
zero** rather than filled in with a plausible-looking guess. A fabricated estimate
that refuses a lawful request is worse than no estimate. **Read that zero as "not
measured", never as "free":** the post-spend recorder still captures the true cost,
so the *next* request from the same caller is metered against real, measured spend.
If you want an OCR page to be priced before the call, state the page count on the
request — supplied, it is used.

One estimate is deliberately a **floor**, not a best guess: audio duration derived
from inline bytes assumes an uncompressed rate, so a compressed upload is
under-priced rather than over-priced. Under-pricing admits a request; over-pricing
refuses lawful work.

### Related change you may notice in your invoices

Per-request AI spend is now recorded for **every** `/api/nv/*` call that actually
invoked a model, not only for `/orchestrate` and `/legal-chat/send`. Previously
most of your model usage was not written to the credit ledger at all, which is why
`usedToday` looked implausibly low. Requests that call no model — deterministic
proxies, cache hits, validation errors — record nothing and consume no budget.

**This is live now, and it is the one part of §4c that observe mode does not
suppress** — deliberately. Suppressing the recorder as well would leave the caps
watching a counter nothing increments, which is the original defect wearing a
caution label. So expect `usedToday` to start reflecting your real consumption
immediately, and to be **larger than it used to be** — that is the counter becoming
correct, not your usage increasing. It is also what will justify the eventual flag
flip, so if a budget looks wrong to you against your own metering, tell us during
this window rather than after enforcement is on.

---

## 4d. Citator / treatment — answers to the three NYV-2 asks (NV-CITATOR-ATTRIBUTION-001)

> Measured live on nysdev 2026-08-20, gateway sha `232a92e4`. Every probe
> `http=200`, partner key present, and the JSON parser was validated against a
> known-good fixture *before* any real call — an earlier run of ours reported
> "0 results" everywhere and the cause was a missing `node` binary on the host,
> not the platform.

### Ask 3 — exact-citation resolution / an `exactMatch` you can trust: **mostly delivered, with one real bug — use `exact=true`**

`authority.resolution` is live, and for **case names** it does what you were told:

```
GET /api/nv/knowledge/caselaw/treatment?citation=Kesavananda Bharati v. State of Kerala
  authority.resolution = { matched: true, confidence: 0.8,
                           method: 'all-tokens-in-title', exactModeRequested: false }
  authority.title = "HIS HOLINESS KESAVANANDA BHARATI SRIPADAGALAVARU versus STATE OF KERALA"
  authority.court = "Supreme Court of India"   authority.year = 1973
```

When it cannot resolve, `title`/`court`/`year` come back **null** and `treatments`
is withheld, so an unresolved lookup can no longer read as a resolved one. If
your tests still show the old behaviour, they are hitting stale expectations —
read `authority.resolution.method` and branch on that.

**But default-mode resolution is not safe for a reporter citation.** We found a
reproducible false positive: `method: 'all-tokens-in-title'` will match a
citation's *numeric* tokens against unrelated numbers in an unrelated title and
still report `matched: true`.

| You send | It resolves to | Verdict |
|---|---|---|
| `[1980] 3 S.C.R. 383` — Gurbaksh Singh Sibbia, SC 1980 | `CRP/3616/2010 of The Shalimar Works (**1980**) Limited Vs Board of Trustees of Port of Visakhapatnam` — **HC Telangana 2010**, `matched:true`, conf 0.6 | **wrong case, silently** — `1980` matched a company name |
| `[2018] 6 S.C.R. 825` — Sushila Aggarwal, SC 2018 | an unrelated Jharkhand writ petition, `matched:true`, conf 0.6 | **wrong case, silently** |
| `[2020] 2 S.C.R. 1` | `matched:false`, `unresolved` | correct refusal |
| `Zzzq Nonexistent Xyllq v Qqqq` | `matched:false`, `unresolved` | correct refusal (our negative control) |

**Do this today:** send **`?exact=true`** for anything citation-grade. In that mode
all four rows above return `matched:false`, `method:'unresolved'`, `title`/`court`/
`year` nulled and `treatments` withheld. It refuses rather than guesses — which is
the guarantee you asked for. Be aware of the trade: `exact=true` currently also
refuses *genuine* reporter citations, so treat it as a safe **gate**, not yet a
resolver.

**What we owe you:** default-mode resolution must reject a candidate whose only
shared tokens with the query are numeric. That is ours to fix, not yours to work
around.

### Ask 1 — citation graph with treatment labels and paragraph anchors: **buildable; the hard prerequisite is validated; the graph is not built**

The difficult half is done and measured. `nv-citator-attribution` decides whether
an adverse phrase is actually *about* the authority you asked about, and on a
32-item corpus gold set it scores **100% precision, 0 false positives, 66.7%
recall** (`npm run eval:treatment-attribution` → "precision bar MET"). Phrase
detection *without* attribution scored **25% precision with 18 false positives** —
so attribution is the entire difference between a citator and a phrase grep, and
it is the reason we will not ship the graph without it.

Outstanding: `nv_legal_graph_entities` and `nv_legal_graph_edges` are **0 rows**;
no backfill has run. That call is the architect's and is currently conditional on
widening the gold set to 80–120 items including the two landmark authorities. We
are not starting it unilaterally.

**The recall ceiling — please factor this into what you promise users.**
`/caselaw/search` FTS indexes **metadata only**: `title`, parties, reporter
`citation`, `cnr`, `case_no`, `judges`, `description`. `full_text` is NULL for all
26,259,225 rows. Measured:

```
GET /caselaw/search?q=stands overruled&courtType=sc   →  0 rows
   ... across all 43,505 Supreme Court judgments
```

Treatment language **structurally cannot exist** where today's endpoint scans.
That is the real cause of the recall cap, and why full-body attribution — not more
phrase patterns — is what raises it.

### Ask 2 — an affirmative `good` state: **we recommend against it, and you already have the field that answers your real question**

Your underlying need is legitimate and we are not brushing it off: *"today we
cannot distinguish 'checked and clean' from 'not checked'."* Correct, and worth
fixing. But `goodLaw: 'good'` is the wrong instrument, for five reasons that
survive the arrival of a citation graph:

1. **A graph cannot see statutory supersession.** A judgment can be entirely
   un-overruled and still not good law because the statute beneath it was
   replaced. There is a documented case in this corpus where a graph-derived
   `good` would have been *actively wrong*.
2. **Partial overruling is not boolean.** Authorities are routinely overruled on
   one point and followed on three others; one chip cannot carry that.
3. **43,505 is the *embedded* SC set**, not every SC judgment. "Fully scanned"
   over a subset is not fully scanned.
4. **Recall is 66.7% and structurally incomplete** (see the 0-row measurement).
   So absence of adverse treatment means *"attribution refused"*, not *"nothing
   adverse exists"*.
5. **`good` has no honest confidence value.** Any number printed beside it would
   be manufactured.

**What to use instead — already live in the response:**

```json
{
  "goodLaw": "unknown",
  "unknownReason": "no_treatment_language_found",
  "coverage": { "passagesScanned": 20, "corpusCoveragePct": 73.61, "retrievalLimited": true },
  "direction": "citing",
  "treatments": [],
  "limitations": "Deterministic phrase extraction over retrieved passages. Not a citation graph: absence of adverse treatment is not evidence of good law, and `good` is never asserted. Verify against official law reports before relying on this in filed work."
}
```

**`unknownReason` is the field that answers your ask.**
`no_treatment_language_found` with `retrievalLimited: false` and a high
`corpusCoveragePct` is *"checked, nothing adverse found"*. A short scan, or
`retrievalLimited: true`, is *"not checked"*. Your UI can say "checked and clean"
in its own words with that evidence on screen — and `GoodLawBadge` keeps its
current honesty guarantee, because we are not asking it to render a legal
conclusion we cannot defend.

If, once the graph lands, you still want one affirmative token, we would rather
give you `adverseTreatmentFound: false` scoped explicitly to *"within the edges we
hold, at this coverage"* than a bare `good`. Same UI affordance; no claim we
cannot stand behind.

---

## 4e. `analysisStatus` — how to tell an empty analysis from a failed one, and verdicts on the five blockers (NV-ANALYZE-STATUS-005 / NV-NSP-503-PERMANENCE-006)

**Status: DEPLOYED 2026-08-20T17:35Z verified** — NYV gateway sha **`ee541ca1`**
(`2026-08-20T1610Z-aws-ssm`). Prior sprint **`8c6852aa`** remains valid for NYV-7…11
surfaces. Ingress verified at `https://api.nyayasiddhi.online/api/nv/health` (200). §4e.1
(`analysisStatus`) and §4e.5 (per-surface circuit breaker) are **live**.
On `/api/nv/orchestrate`, read `analysisStatus` from **`data.analysisStatus`**
(top-level — the unified contract merges extras). `data.extras.analysisStatus` may also
appear on older client parsers.

This section answers NYV-6 through NYV-11. Read 4e.1 first — it is the only one that
changes your client.

### 4e.1 NYV-6 — `analysisStatus` is now on every analyze response

You asked us to populate the structured arrays **or** return an explicit status so an
empty analysis is distinguishable from a parse failure. We did the second, because it
is the honest half: `fieldSource` could not answer your question, since it reads
`'none'` both for a document we read successfully that contains no filing metadata,
and for an extraction that threw.

Two new keys, present on **every** analyze surface:

| Field | Values | Meaning |
|---|---|---|
| `analysisStatus` | `structured` | at least one array a client maps is non-empty |
| | `unstructured` | analysis **completed** and found nothing — empty arrays are a *result*, cache them |
| | `failed` | extraction did **not** complete — empty arrays are *missing data*, retry / alert |
| `analysisStatusReason` | string | always non-empty; explains which of the three applies |

**Treat `unstructured` and `failed` differently.** That is the entire point of the
field: the arrays are byte-identical in both cases, so the status is the only carrier
of the difference.

Two rules worth knowing because they are deliberate:

- **`failed` outranks a populated result.** If the LLM analyzer throws but our
  deterministic extractor still recovers 14 fields, you get `failed` **with**
  those fields. The analysis genuinely did not complete; use the fields, but retry.
- **`structured` counts the flat aliases, not just `fieldCount`.** A commercial
  contract has no court-filing number, so `fieldCount` is 0 while
  `entitiesFlat` / `risksFlat` are populated. That is `structured`.

On the **EDJ webhook** payload you additionally get `failedExtractors: string[]`,
naming which of the six extractors rejected (`summary`, `clauses`, `obligations`,
`risks`, `missingTerms`, `privacyAlerts`). An empty array means all six ran.

### 4e.2 Correction — the arrays are **not** empty, and your test case may be stale

Your report said `entities: []`, `statutes: []`, `deadlines: []`, `risks: []`. Measured
live against the deployed gateway with an 835-character Indian anticipatory-bail
petition, all four paths returned:

```
fieldCount: 14        fieldSource: "nyv"      statutes: [1 item]
detectedDocumentType: "anticipatory_bail_petition"    isIndianCourtDocument: true
```

and `/api/nv/sdk/docs-pipeline/documents/analyze` additionally returned
`entities: {obligations: 1, risks: 3, deadlines: 2, entities: 6}` with
`entitiesFlat`, `risksFlat`, `deadlinesFlat`, `obligationsFlat` all populated.

So the flat aliases from §4b.3 **are** live. If you are still seeing empty arrays,
either the document carries no extractable metadata (now reported as `unstructured`)
or the fixture predates that change — please re-run against current and send us the
`requestId` if it reproduces.

### 4e.3 Which endpoint you are actually calling

Six hours of gateway logs show **30 × `POST /api/nv/orchestrate`** and **zero** calls
to `/api/nv/gateway/documents/analyze` or
`/api/nv/sdk/docs-pipeline/documents/analyze`. Orchestrate is your document-analysis
path, and it had a defect the other three did not: the structured block was attached
only when `fieldCount > 0`, so a filing we read but found nothing in returned a
response indistinguishable from an ordinary chat turn. That gate is gone — once the
input looks like a court document you always get a block, with a status.

If you *intend* to use a different endpoint, tell us, because we optimise and test the
one you actually call.

### 4e.4 NYV-7 / NYV-8 / NYV-9 — all three are **ENABLED**, not 503

Measured live, partner key, current deploy:

| Item | Surface | Result |
|---|---|---|
| NYV-7 | `GET /api/nv/matter-vault` · `/packs` | **200** |
| NYV-7 | `POST /api/nv/matter-vault/packs` | **201** — pack created, Postgres-backed |
| NYV-7 | `GET /api/nv/matter-vault/packs/:id` | **200** |
| NYV-8 | `GET /api/nv/legal-work/tasks` | **200** — 190-item benchmark catalog |
| NYV-8 | `POST /api/nv/legal-work/evaluate` | **200 in 49.9 s**, `status: "evaluated"` |
| NYV-9 | `GET`/`POST /api/nv/compliance/evidence-pack` | **200 in 212 ms** |

None of these is deprecated and none needs removing. **Wave D D7 is unblocked.**

Two practical notes:

- **`legal-work/evaluate` is synchronous and takes 50–180 s.** It creates a run,
  waits, then grades it. Set your client timeout to at least 200 s — a client
  timeout here looks exactly like a platform failure and is the most likely reason
  you recorded it as unavailable. If it is still running it returns **202** with a
  `runId`; poll `GET /api/nv/legal-work/runs/:id`.
- **One real gap:** `POST /api/nv/matter-vault/packs/:id/playbook` is **404**. The
  live path is `POST /api/nv/matter-vault/matters/:id/run-playbook`. If you need the
  `/packs/…/playbook` alias, ask and we will add it.

### 4e.5 Why you saw 503 — it was our circuit breaker, not the upstream

`NYV_F_NYS_KNOWLEDGE_PLANE` was already on, so no flag was ever off. The 503s read:

```json
{"success":false,"error":{"code":"NYS_UPSTREAM","message":"NYS knowledge circuit open","retryable":true}}
```

That breaker was **process-global across every NYS surface**. Reproduced exactly: one
`mode=hybrid` call took **48.8 s**, and the next five calls of **both** modes returned
503 in **under 11 ms without ever contacting the upstream**. So slow `hybrid` calls
were opening the breaker and then failing `fts` — the mode we told you was the safe
interim — along with `verify-citation` and `legal-work`.

It is now partitioned per surface, the threshold is raised 5 → 12, the cooldown is cut
30 s → 10 s, and the message names the tripped surface, e.g.
`NYS knowledge circuit open (caselaw/search)`.

**What this means for your client:** `NYS_UPSTREAM` with `retryable: true` was, and
still is, worth retrying — but it no longer means "all of knowledge is down". Treat it
as scoped to the named surface.

### 4e.6 NYV-10 — hybrid latency, with numbers

Five interleaved runs of each mode, `q=anticipatory bail&limit=10`, breaker closed:

| Mode | min | mean | max | typical |
|---|---|---|---|---|
| `hybrid` | 564 ms | 1342 ms | 3454 ms | ~570 ms |
| `fts` | 303 ms | 2614 ms | 11854 ms | ~305 ms |

(`fts` mean is skewed by a single 11.8 s cold-cache run; its steady state is 303–306 ms.)

**Verdict: hybrid is viable for search-on-submit, not for keystroke typeahead.** A
~570 ms median is usable behind an explicit search action; a ~3.5 s tail is not a
typeahead budget. Stay on `fts` for as-you-type.

**Does this change when embedding completes?** The recommendation does not. There are
currently 4 concurrent `embed-corpus.mjs` workers on the NYS host, and they cause the
**tail**, not the ~570 ms floor. Expect the max to fall toward the mean once they
finish, which makes hybrid more comfortable for search-on-submit — but the floor is
vector search plus RRF fusion and will not reach `fts`'s 300 ms. Plan on `fts` for
typeahead permanently; adopt hybrid where the user has pressed something.

### 4e.7 NYV-11 — `verify-citation` will **never** carry treatment. Definitive.

**No.** Please stop asking, and switch the surface.

`POST /api/nv/knowledge/caselaw/verify-citation` is a pass-through proxy to the NYS
endpoint of the same name. It contains no treatment logic on the NYV side at all, and
it answers **existence only**. Live response shape:

```json
{"success":true,"source":"nys-knowledge-plane",
 "data":{"status":"not_found","note":"…Treat this citation as unverified.","matches":[]}}
```

No treatment, no `goodLaw`, no citing/cited direction — by design, not by omission.

**Treatment lives on a different endpoint:** `GET /api/nv/knowledge/caselaw/treatment`
(documented in §4d). That is the correct surface, it is deterministic, and it returns
`coverage {passagesScanned, corpusCoveragePct, retrievalLimited}` so you can tell
"checked and clean" from "not checked". Per §4d it never asserts `good`, and that is
deliberate.

Use `verify-citation` to answer *"does this citation exist?"* and `treatment` to
answer *"has it been treated adversely?"*. They are two questions and they will remain
two endpoints.

---

## 4f. NYV-3 / NYV-4 / NYV-5 — structured judgment payload, search pagination, and the bare-numeric latency (`NYS-JUDGMENT-STRUCTURE-001`, `NYS-CASELAW-SEARCH-{LATENCY,FILTERS}-001`, `NYS-SEARCH-SLO-001`)

**Status: DEPLOYED 2026-08-20T10:04Z** — NYS `index.mjs` md5 **`712e35ea785adab7068603d171d7c7e6`**
(caselaw worker `i-000115b19219bb766`, health 200). NYV gateway **`8c6852aa`** forwards
the full filter surface including `courtType`. Measured live after deploy: `courtType=sc`
returns Supreme Court rows through the gateway (was identical to unfiltered before).

### 4f.1 NYV-3 — `paras[]`, and the one class of judgment where we return nothing

You said this is the floor: *"a judgment you cannot cite by paragraph is a document you
cannot rely on in court."* Agreed, and it is delivered — with one honest gap you need to
design for, because we would rather you saw it here than discovered it in front of a client.

Opt in with `structure: true`:

```bash
curl -sS -X POST "$NYV/api/nv/knowledge/judgments/full-text" \
  -H "x-api-key: $NSP_KEY" -H 'x-nyv-platform: nsp' -H 'x-nyv-consent: granted' \
  -H 'content-type: application/json' \
  -d '{"query":"Municipal Corporation of Greater Mumbai","archive":"sc","structure":true}'
```

You get `data.structure` with `paras[]`, plus `extractedFields` / `unavailableFields` so an
absent field is a stated fact rather than a silent omission:

```json
{
  "paras": [{ "n": 37, "text": "As rightly observed by the learned Arbitral Tribunal…",
              "opinionIndex": 0, "opinionAuthor": "J.K. Maheshwari J." }],
  "numbering": "preserved",
  "numberingNote": null,
  "coram": ["J.K. Maheshwari", "Atul S. Chandurkar"],
  "parallelCitations": ["2026 INSC 228", "[2026] 3 S.C.R. 525"],
  "disposition": "Appeals Dismissed.",
  "extractedFields": ["paras","headnote","held","facts","issues","disposition","coram","parallelCitations","appealedFrom"],
  "unavailableFields": ["ratio","obiter","appealedTo"]
}
```

**Every `n` is read literally off the page. None is ever derived by counting.** We honoured
your FB-206 constraint as a hard rule, not a preference.

#### The gap: pre-~2000 Supreme Court Reports volumes do not number paragraphs at all

This is the part to plan around. Those volumes print unnumbered prose with **marginal letters
A–G** for pinpoint citation — that was the citation convention of the era. So for that class
we return `paras: []` and a `numberingNote` explaining why.

Verified on the two authorities most likely to be opened first:

| Judgment | Result | Why |
|---|---|---|
| **Maneka Gandhi [1978] 2 SCR 621** | `paras: []` | no paragraph numbering in the source |
| **Kesavananda Bharati [1973] 1 SCR 1** | `paras: []` | no paragraph numbering in the source |
| [1980] 3 SCR 383 | `paras: []` | its numbered list is the *headnote's* HOLDINGS, not paragraphs |
| **[2026] 3 SCR 525** | **1..68 contiguous** | modern format, fully numbered |
| [2024] 11 SCR 1647 | **776 across 6 opinions** | modern, multi-opinion |
| [2025] 1 SCR 1782 | 258 | modern, two opinions |

Every line-initial number in Maneka and Kesavananda is a year (`1967. On the 4th of July
1977…`), an Article number (`368. It is determinative of…`), a quoted enactment clause, or a
footnote marker (`(1) [1967] 3 S.C.R. 525`). We could have emitted those as paragraph numbers
and the payload would have looked richer. Counsel would then have cited "para 368" of
Kesavananda, which does not exist. **Please render `numbering: 'absent' | 'ambiguous'` as an
explicit "this judgment is not paragraph-numbered — cite by page/marginal letter" state, not
as an empty panel.** Across 12 real volumes we emitted 1,491 paragraphs and **zero** that were
not literally printed in the source.

#### Multi-opinion: `n` alone is not a citation

Indian judgments restart numbering at 1 for each concurring or dissenting opinion, so "para 5"
can exist several times in one judgment. Each paragraph therefore carries `opinionIndex` and
`opinionAuthor`. **Render the judge alongside the number** ("para 5, Khanna J."), because the
number on its own does not identify a passage.

#### Your four groups, answered with the data

| Ask | Deliverable? | Evidence |
|---|---|---|
| `paras[]` with numbers | **Yes for modern; no for pre-~2000** | see table above |
| `headnote` / `held` / `facts` / `issues` / `disposition` | **Yes, where the reporter typeset a caption** | returned as quotations, never inferred |
| `ratio` / `obiter` | **No — and we will not add them** | no Indian format delimits them; separating binding reasoning from dicta is a legal judgment, and a keyword or sentence-position guess is your FB-206 |
| `coram` / bench | **Yes** | from the bracketed bench line |
| `parallelCitations[]` | **Yes, Supreme Court only** | `citation` is populated for 43,505/43,505 SC rows and **0** of 20.4M HC / 5.7M DC |
| `appealedFrom` | **Yes, where stated** | from the "Case Arising From" block |
| `appealedTo` | **No** | a judgment does not state where an appeal from it will go |
| `author_judge` | **No** | empty in **every** row of every tier — we declare it unsupported rather than ship a field that is always null |

### 4f.2 NYV-4 — pagination, filters, sort

`GET /api/nv/knowledge/caselaw/search` now accepts `offset`, `yearFrom`, `yearTo`, `dateFrom`,
`dateTo`, `judge`, `reporter`, `benchStrength`, and `sort=relevance|date`. Every response
carries a `filterSupport` block stating each filter's real coverage, so you can size your UI
from a contract instead of by experiment.

**`benchStrength` IS supported — but High Court only.** You expected this might not be
derivable; it is. HC `bench_name` genuinely carries `Single` / `Single Bench` / `Division` /
`Division Bench`. The request is **refused on other tiers** rather than approximated, because
the same column holds a *district name* ("Kadapa", "Guntur") on District Court rows.

**Coverage caveats you should surface in the UI:**

- `judge` — `judges` is populated for ~87 % of HC rows and all SC rows, and is **empty for
  every District Court row**, so a DC-scoped judge filter returns nothing by construction.
- `reporter` — effectively Supreme-Court-only (see the `citation` population above).

**`total` is never a guess.** It is exact up to 1,000 and above that you get
`totalIsLowerBound: true` with `countCap: 1000` — read it as "at least 1,000", which is
literally true. We evaluated returning a planner estimate for large matches and **rejected
it**: measured against real counts it was wrong by 67× high (`murder`: 33,330 estimated vs 497
actual) and 34× low (`IPC 302`: 42 vs 1,429). A number that wrong is worse than no number,
because it looks precise.

**One pagination constraint to know:** hybrid search fuses two ranked lists (RRF), and page 2
of a fused ranking is not the fused ranking of page 2. So `offset > 0` is served by the
keyword leg, which has a stable order. `method` in the response always tells you which leg
answered — it is never silently switched.

### 4f.3 NYV-5 — the bare-numeric latency, root-caused

Reproduced. But the likely-sounding explanation is wrong, and the real one matters for how you
set timeouts.

`302` is **not** an unselective match. It matches **11,545 of 26.26M** rows, and the index scan
costs **3.3 ms**. The cost is fetching the ranking candidate window from a **281 GB** table
backed by **~3.9 GB** of database cache — only ~1.4 % of the corpus can be resident, so a wide
window pays real disk reads:

| query | candidates ranked | blocks read | execution |
|---|---|---|---|
| `bail` | 10,000 | 7,015 | 1,526 ms |
| `bail` | 500 | 295 | 63 ms |

Your 130× ratio was simply whether a query hit the 10,000 cap: `IPC 302` matches 1,429 rows and
never did. The window was also never the *best-ranked* 10,000 — the inner scan has no ordering,
so it was an arbitrary subset — which is why narrowing it costs no relevance.

**Result after the fix:**

| query | before | after |
|---|---|---|
| `bail` | 4,090 ms | **31 ms** |
| `302` | 44 ms | **11 ms** |
| `BNS 103` | 5.4 ms | 4.5 ms (unchanged) |
| `murder` | 4.0 ms | 3.6 ms (unchanged) |

### 4f.4 The SLO you asked for

Published at `GET /api/nv/knowledge/caselaw/search/slo` so you can read the contract without
issuing a search.

| Endpoint | p50 | p99 | **Set your timeout to** | Retryable |
|---|---|---|---|---|
| `caselaw/search` | 150 ms | 2 s | **30 s** | `503` |
| `statutes/search` | 500 ms | 6 s | **30 s** | `503` |

**Why the timeout is so much larger than the p99, and please do not tune it down to the p99:**
the dominant cost is cache residency, not the query plan. The same `302` query measured **27 ms
warm and 16,756 ms on a cold cache**. Four embedding workers share the instance; under that
load the server returns **`503` with `retryable: true`** ("corpus is busy") rather than hanging
past your timeout — so retry on 503 rather than treating it as a failure.

**One honest disclosure:** the statutes p99 of 6 s is set by a bare-numeric outlier on *that*
endpoint (`302` measured 5.68–5.99 s warm). That is a **separate, still-open** issue — the fix
above addressed the caselaw candidate window, which is not the statutes bottleneck. We are
publishing the number that includes it rather than quoting the median and letting you find the
outlier in production.

---

## 5. Tracking — what to persist per AI call

Persist these from every orchestrate response so a user complaint can be traced to a request without asking NYV to grep logs.

| Field | Where | Why |
|---|---|---|
| `requestId` | response body + `x-request-id` response header | the join key for every NYV log line and provider call for that request |
| `riskBadge` | `GREEN` / `YELLOW` / `RED` | the chip to show on the answer; `RED` means the quality envelope did not pass |
| `auditHash` | response | SHA-256 over the trust inputs — persist with the matter turn for the audit trail |
| `trust` | response | pass/fail summary behind the badge |
| `qualityEnvelope` | response (+ legal-chat `run_complete.data`) | which mandatory steps ran; `scaledOptional` lists what was intentionally skipped; `deferred` lists what is queued but has **not** happened. **See §4b — `deferred` records left `completed[]`, and `steps[]` is authoritative** |
| `cost.completions` | response | billed provider completions for this request (envelope-accurate since NV-METER-ENVELOPE-001) |
| `routing.path` | response | `specialist` / `doc-pipeline` / `queen` — tells you whether your `taskType` did what you intended |
| `requestPhase` | **always present** (all paths, since 2026-08-17) | `accepted → grounding → generating → enriching → ready \| degraded \| failed_infra`. Declared in OpenAPI as `components.schemas.RequestPhase` |
| `optionalDegraded` | when an optional stage was dropped | `true` = answer complete, optional enrichment dropped for progression. **Success, not an error.** |
| `orchestrationId` | Queen path | Stable id for the whole multi-leaf run; survives retries. **Quote this to NYV.** Absent on specialist |
| `sessionId` | always | The session this turn belongs to — minted by NYV for NSP/NYM when absent. **Echo it on the next turn** to continue the thread and reuse its memory |

Send `X-Request-Id: <uuid>` yourself if you want your own correlation id used; otherwise NYV mints one and returns it.

**Idempotency:** end-to-end `Idempotency-Key` de-dupe is **not yet implemented server-side** for SDK mutating routes. Until it is, do the de-dupe on your side: gate the button, key your own job row on `(draftId, action, attemptBucket)`, and never issue a second counsel request for a job that is still `generating`. Retrying a 5-minute Queen draft because a browser aborted at 55s doubles the spend and produces two different drafts.

---

## 6. Error mapping (this is where the 502s came from)

| NYV condition | HTTP | Partner action |
|---|---|---|
| `-fast` draft completed | 200 | render `data.content` |
| Full Queen, CoT JSON parse failed, answer produced | **200** | render content. `qualityEnvelope.scaledOptional` may list `cot`. Not an error |
| `requestPhase` = `generating` / `enriching` | in flight | show progress. **Never** `DRAFT_AI_TIMEOUT` |
| `optionalDegraded: true` **with** content | 200 | success. Optionally a quiet "grounding still catching up" note |
| Client/BFF abort while the NYV job runs | — | keep polling your own job row. Browser hangup does not cancel NYV work |
| `QUALITY_ENVELOPE_FAILED` with `missing: ["hallucination"]` / `["citation"]` / `["llm_route_budget"]` | 500 | a real failure. Do **not** blind-retry — file it |
| `failed_infra`, or empty content after the 600s worker deadline | 5xx | now it is a timeout. Retry once with a new idempotency bucket |
| 401 | — | missing/wrong `X-API-Key`, or you called a JWT-only route (§3.4) |
| 403 scope | — | key lacks the scope (documents / knowledge) |
| 403 `DPDPA_CONSENT_BREACH` | — | consent not recorded for that user + purpose. Record consent, then retry |

The Job-297 failure mode (HTTP 500, 193 bytes, `QUALITY_ENVELOPE_FAILED` / `missing:["cot"]`) is fixed server-side and shipped in deploy `2026-08-17T0653Z-aws-ssm`. If it reappears on a draft surface, the worker is not sending `legal-draft-fast`.

---

## 7. NSP — surface-by-surface wiring

| NSP surface | Call | `taskType` | Timeout | Notes |
|---|---|---|---|---|
| Drafts → AI Assist / `propose` | `POST /api/nv/orchestrate` | `legal-draft-fast` | 90s | must not call `gateway/documents/draft`; must not send `enableCoT` |
| New Case → Describe & Generate | `POST /api/nv/orchestrate` | `legal-draft-fast` | 90s | AI failure must be **non-blocking** for the case row |
| New Case → CNR lookup | `POST /api/nv/v1/sdk/cnr/resolve` | — | 60s | `claimEcourts:false`; show a miss UI, never claim live eCourts |
| New Case → file upload intake | `POST /api/nv/shared-docs/process` (small) / EDJ (large) | — | poll | then pass `ragDocumentIds` to orchestrate |
| Legal Chat (Pro) | `POST /api/nv/orchestrate` (+ `/stream`) | `legal-chat-fast` interactive · `legal_research` counsel | 90s / 600s | not `/api/nv/legal-chat/send` — that is JWT-only Console |
| Legal Chat mic | `POST /api/nv/legal-chat/voice/transcribe` | — | 60s | `audioBase64` or `audioUrl`; 400 `AUDIO_REQUIRED` if neither |
| Full pleading / regenerate | worker → `POST /api/nv/orchestrate` | `legal-draft` | **600s worker** | UI gets `202` + `jobId` + poll |
| Doc companion (Word selection) | `nyv.patraMitra.*` | — | 40s | short files; EDJ for large |
| Due diligence | EDJ job → `nyv.matterVault.runPlaybook` | — | poll | finding list fills progressively |
| Instant Search | `nyv.instantSearch.statutes/caselaw/acts` | — | 5s | typeahead; do not route through orchestrate |
| Live Legal Feed | `nyv.intelligence.getLegalFeed` | — | 15s | empty digest is an honest `no_data`, not an error |

Worker mapping (copy):

```ts
// Interactive draft (Assist / Describe & Generate / Written Statement)
{ taskType: 'legal-draft-fast', jurisdiction: 'IN', agentKey: 'drafting-specialist' }
// timeoutMs: 90_000 · do NOT set enableCoT

// Counsel draft (user opted into long generation)
{ taskType: 'legal-draft', jurisdiction: 'IN' }
// timeoutMs: 600_000 · return 202 + jobId to the UI, then poll
```

---

## 8. NYM — surface-by-surface wiring

NYM is mobile: the key lives in the NYM backend, the app talks to that backend, and the backend talks to NYV. Never ship `NYV_SDK_KEY_NYM` in an APK/IPA.

| NYM surface | Call | `taskType` | Timeout |
|---|---|---|---|
| Ask-a-question / advice turn | `POST /api/nv/orchestrate` | `legal-chat-fast` | 90s |
| Streamed answer in-app | `POST /api/nv/orchestrate/stream` | `legal-chat-fast` | 90s idle |
| Document tab (PATRA) — photo / PDF of a notice | `nym.openPatraMitra` → `nym.askPatraMitra` (`/api/nv/v1/sdk/patra-mitra/*`) | — | 40s |
| Deep opinion (user taps "detailed") | backend job → `POST /api/nv/orchestrate` `legal-draft` | `legal-draft` | 600s backend, push/poll to app |
| Statute lookup / IPC→BNS | `nyv.knowledge.compareOldToNew` / `nyv.instantSearch.statutes` | — | 5s |
| Case status by CNR | `nyv.cnr.resolve` | — | 60s |

Mobile networks abort often, so the durable path matters more for NYM than for NSP: anything above ~60s must be a backend job with a push/poll result, never a held mobile socket.

---

## 9. Smoke (run from the partner host with its own env)

```bash
# identity
echo "$NV_API_BASE_URL"   # expect https://api.nyayasiddhi.online

# 1. auth + reachability
curl -sS -H "X-API-Key: $NYV_SDK_KEY_NSP" -H "X-NYV-Platform: nsp" \
  "$NV_API_BASE_URL/api/nv/gateway/health"

# 2. interactive draft — must return 200 in < 90s, path=specialist
curl -sS -m 90 -w "\nhttp=%{http_code} time=%{time_total}\n" \
  -H "X-API-Key: $NYV_SDK_KEY_NSP" -H "X-NYV-Platform: nsp" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Draft a short Written Statement for recovery of money.","taskType":"legal-draft-fast","jurisdiction":"IN"}' \
  "$NV_API_BASE_URL/api/nv/orchestrate" | head -c 400

# 3. zero-LLM statute mapping — must be sub-second
curl -sS -X POST -H "X-API-Key: $NYV_SDK_KEY_NSP" -H "X-NYV-Platform: nsp" \
  -H "Content-Type: application/json" -d '{"section":"302","from":"IPC"}' \
  "$NV_API_BASE_URL/api/nv/knowledge/statutes/compare/ipc-bns"
```

Pass criteria: step 1 `200`; step 2 `200`, no `QUALITY_ENVELOPE_FAILED`, `routing.path` = `specialist`; step 3 returns a BNS section.

NYV-side partner smoke: `cd nyayavigya-platform-312 && NYV_PLATFORM=NSP npm run partner:smoke:ec2`.

---

## 10. Honesty limits to respect in partner UI

Do not claim, in UI copy or sales material: live eCourts integration · sealed HC/SC court forms · 100% caselaw vectorisation (~3–7% of ~20.5M judgments embedded; FTS/hybrid search is what is live) · SOC 2 Type II certification · "1,042 live agents" (**164** in the default registry) · live DocuSign/iManage OAuth.

---

## 11. Change control

| Doc | Role |
|---|---|
| [`NSP-API-HANDOFF-2026-08-17.md`](./NSP-API-HANDOFF-2026-08-17.md) | draft SLA RCA + completion-driven §6 (why the timeouts are what they are) |
| [`Nyayavigya-platform-Integration-document-5.0.0.md`](./Nyayavigya-platform-Integration-document-5.0.0.md) | full API/SDK reference |
| [`NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md`](./NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md) | request/response recipes |
| [`NSP-INTEGRATION-CHEATSHEET-2026-06.md`](./NSP-INTEGRATION-CHEATSHEET-2026-06.md) | 2-page card |
| [`PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md`](./PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md) · [`NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md`](./NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md) | per-surface contracts |

Frozen partner contracts (do not expect renames): `POST /api/nv/orchestrate` (+ `/stream`), `POST /api/nv/v1/sdk/orchestrate`, `/api/nv/legal-chat/*`, `/api/nv/legal-work/*`, `/api/nv/rag/*`, `/api/nv/v1/sdk/cnr/*`, EDJ / shared-docs, `/api/nv/gateway/*`, `/api/nv/platforms`, `/api/nv/health`, PII / compliance / citations. Authority: `nyayavigya-platform-312/FEATURES-REGISTRY.md`.
