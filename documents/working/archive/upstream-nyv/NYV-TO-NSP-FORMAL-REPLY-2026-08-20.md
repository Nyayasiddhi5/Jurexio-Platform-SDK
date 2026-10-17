# NYV → NSP — formal reply to your acceptance (2026-08-20)

> **From:** Nyayavigya platform team  
> **To:** Nyayasiddhi Professional (NSP) integration team  
> **Date:** 2026-08-20 (UTC)  
> **In reply to:** NSP formal acceptance of [`NYV-TO-NSP-CONSOLIDATED-REPLY-2026-08-20.md`](./NYV-TO-NSP-CONSOLIDATED-REPLY-2026-08-20.md)  
> **Companion contracts:** [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md) · [`NYV-TO-NSP-POST-DEPLOY-2026-08-20.md`](./NYV-TO-NSP-POST-DEPLOY-2026-08-20.md)

Thank you for the formal acceptance. Your integration posture (API-first, tarball SDK only, deferred 5.1.0 until checksum confirmed) matches how we ship. This document answers every item in your §5, supersedes the stale gate language in consolidated reply §13, and adds the document parsing / autofill contract you requested at the end.

---

## 1. Deploy id — authoritative

| Host | Build id | When | Verified |
|---|---|---|---|
| **NYV gateway** (api.nyayasiddhi.online) | git sha **`8c6852aa`** · `NYV_BUILD_ID=2026-08-20T1004Z-aws-ssm` | **2026-08-20T10:04Z** | Ingress `:5000` + `:80` + public HTTPS 200; counsel-grade harness 8 ok / 2 failing / 0 blocked |
| **NYS worker** (nyayasearch federation) | `index.mjs` md5 **`712e35ea785adab7068603d171d7c7e6`** | **2026-08-20T10:04Z** | Health 200; NYV-3/4/5 surfaces live through gateway |
| **NYS follow-on** (SC body FTS) | `index.mjs` md5 **`ea9c3c28c9e12fc64221646e9b4a6955`** | **2026-08-20T11:15Z** | DDL + body FTS search path deployed; backfill running |

**You may branch on `analysisStatus`, search filters, per-surface breaker messages, citator numeric-token rejection, and SCR `exact=true` resolution today** against `https://api.nyayasiddhi.online`.

---

## 2. §0 vs §13 — one authoritative column (supersedes consolidated §13)

Consolidated reply §13 was written **before** the coordinated deploy landed. It is **withdrawn**. Use this table instead:

| Item | Live on partner hostname **today** (`8c6852aa` / `712e35ea…`)? | Notes |
|---|---|---|
| ALB host rules (NYV-1) | **Yes** | Keep calling `api.nyayasiddhi.online`; no `:5000` retarget |
| Citator numeric-token + SCR `exact=true` (NYV-2) | **Yes** | Use `?exact=true` for citation-grade lookups |
| Citation graph (`nv_legal_graph_*`) | **No** — backfill **running** after your GO | CITES edges only in Phase 1; OVERRULES gated on gold set |
| Affirmative `goodLaw: 'good'` | **Declined** — use `unknownReason` + `coverage` | **Yes** (honest unknown) |
| `paras[]` / `structure: true` (NYV-3) | **Yes** | Pre-~2000 SCR → honest `paras: []` |
| Search filters + `courtType` + SLO (NYV-4/5) | **Yes** | `GET …/caselaw/search?courtType=sc\|hc\|dc` |
| Bare-numeric latency fix (NYV-5) | **Yes** | `302` vs `IPC 302` no longer 130× |
| `analysisStatus` on orchestrate (NYV-6) | **Yes** | Read **`data.extras.analysisStatus`** |
| Matter Vault / legal-work / evidence-pack (NYV-7/8/9) | **Yes** | Prior 503s were process-global breaker — fixed |
| Per-surface circuit breaker | **Yes** | Retry named surface only |
| Hybrid typeahead (NYV-10) | **Yes** — `mode=fts` on keystroke paths | Hybrid on search submit only |
| `verify-citation` existence-only (NYV-11) | **Yes** | Never conflate with treatment |
| SDK 5.1.0 tarball | **Yes** — see §5 below | Pin when ready; not a deploy gate |
| SC judgment **body** FTS | **Partial** — schema + search path live; backfill ~18 h | Improves treatment recall / landmark ranking over time |
| X-Org-Id firm clause injection | **Yes** | Header required — see §4 |

---

## 3. Citator timeline

| Milestone | Status | Date / ETA |
|---|---|---|
| **(a)** Numeric-token rejection + SCR bracket recognition | **Live** on `8c6852aa` | Deployed 2026-08-20T10:04Z |
| **(b)** Citation graph backfill (80–120 gold set → full SC extract) | **Running** after your **GO: citation-graph-backfill** | Started 2026-08-20 ~11:04Z; ~18 h wall-clock at concurrency 2; CITES edges first |
| **(c)** Indexed judgment **bodies** for treatment recall | **In progress** after your **GO: sc-body-fts-deploy** | NYS `ea9c3c28…` deployed; SC body backfill running newest-first; HC/DC is a separate programme |

**UI sizing guidance:** treatment today is passage retrieval + embedding similarity with honest `coverage` — not a persisted graph verdict. Graph edges will improve recall incrementally as ingest completes; do not promise graph-backed OVERRULES until we publish row counts and a gold-set precision gate.

---

## 4. X-Org-Id confirmation

| Question | Answer |
|---|---|
| Header name | **`X-Org-Id`** — not `X-Customer-Org-Id`, not `X-Organization-Id` for this purpose |
| Expected value | Your firm org UUID from ALS `app.org_id` (same UUID you stamp on clause objects as `orgId`) |
| When required | Every draft / firm-clause path: `POST /api/nv/orchestrate` with `_firmClauseLibrary`, and any path touching the clause library |
| Failure mode without it | Clauses silently dropped; response includes `firmClauses { reason: "org_unresolved" }` |

Measured on the live middleware chain: with SDK context present but no header, bound org was `default`; with `X-Org-Id: <your-uuid>`, bound org matched. See endpoints doc §4a.4.

---

## 5. SDK 5.1.0 tarball — confirmed

| Artifact | Location | SHA-256 |
|---|---|---|
| **Client SDK 5.1.0** | `sdk-dist/v5.1.0/nyayavigya-client-sdk-5.1.0.tgz` | `50306f8bac913decf9985206aec3f723dfca97023468a6b0b14bc24f5bd6953a` |
| Checksums file | `sdk-dist/v5.1.0/SHA256SUMS` | All six packages listed |
| S3 | `s3://nyayavigya-sdk-devapp/sdk-dist/v5.1.0/` | Synced 2026-08-20 |
| EC2 | `/opt/Nyayavigya/sdk-dist/v5.1.0/` | Synced via SSM |
| Symlink | `sdk-dist/current` → `v5.1.0` | Local + EC2 |

**`caselawTreatment({ citation, exact?, direction? })`** in 5.1.0 matches the live gateway route `GET /api/nv/knowledge/caselaw/treatment`. **`getArchiveDocument({ s3Path })`** now sends the required `s3Path` query param (fixes the prior 400-on-every-call bug).

Vendor on your schedule — API-first until you pin the tarball is fine.

---

## 6. Partner re-probe script

Canonical checklist: **`nyayavigya-platform-312/scripts/nv-nsp-partner-reprobe.sh`**

Run from any host that can reach the partner API (your BFF box or ours):

```bash
export NV_API_BASE_URL=https://api.nyayasiddhi.online
export NYV_SDK_KEY_NSP=<your-production-key>
export X_ORG_ID=<your-org-uuid>   # optional; needed for firm-clause probe
bash nyayavigya-platform-312/scripts/nv-nsp-partner-reprobe.sh
```

Exit **0** = all probes pass; non-zero prints `PASS`/`FAIL`/`SKIP` per NYV-1…11 surface. Success criteria cover: `courtType=sc`, `analysisStatus` on orchestrate (`data.extras`), treatment `exact=true`, `paras[]` with `structure:true`, Matter Vault health, evidence-pack route, legal-work evaluate timeout headroom (≥200 s client-side — probe uses a short smoke only).

---

## 7. Document parsing & autofill API (new ask)

NSP needs structured key-value extraction from uploaded documents (case autofill, firm onboarding, drafting forms). **Do not build a parallel parser** — use the surfaces below in priority order.

### 7.1 Decision tree — which endpoint when

```
Upload received
    │
    ├─ Has CNR on cover sheet? ──► POST /api/nv/v1/sdk/cnr/resolve  (corpus autofill, no eCourts)
    │
    ├─ Indian court filing (petition, WS, order, notice)? ──► Tier A below
    │
    ├─ Generic contract / corporate / onboarding doc? ──► Tier B (fieldManifest)
    │
    └─ Whole matter file / due diligence? ──► Tier C (EDJ index + optional playbook)
```

### 7.2 Tier A — Court document structured fields (fast, deterministic + NER)

**Best for:** New Case autofill, matter intake from a single court PDF.

| Step | Endpoint | Output |
|---|---|---|
| 1. OCR / text | `POST /api/nv/sdk/docs-pipeline/documents/extract` | `{ text, pageCount, ocrUsed }` |
| 2. Structured fields | `POST /api/nv/sdk/docs-pipeline/documents/analyze` **or** `POST /api/nv/orchestrate` with `documentText` + court-document gate | `data.extras.analysisStatus`, `fieldSource`, `entities`, deterministic filing fields |

**Orchestrate path (your production path):** send the extracted text in `documentText` / `documentContent`. When input matches an Indian court filing, NYV runs `extractCourtDocumentFields` (~1 ms deterministic) plus `nvLegalNerV2Service` for amounts, dates, statutes, parties.

Read **`data.extras.analysisStatus`**:

| Value | Meaning | NSP action |
|---|---|---|
| `structured` | At least one filing field extracted | Autofill form keys; badge `fieldSource: nyv` |
| `unstructured` | Document read; no filing metadata found | Show empty form; do not retry as error |
| `failed` | Extraction threw | Retry once; alert if persistent |

**Never** treat `unstructured` and `failed` the same — that was NYV-6.

Built-in keys (when present): case number, court, bench, petitioner/respondent, filing date, subject, act/section references, cause title. Each field carries `confidence` and `source` (`cause-title` | `regex-rules` | `legal-ner`). Omitted keys = not in document, not a parse failure.

### 7.3 Tier B — Custom form autofill (`fieldManifest`)

**Best for:** Firm onboarding, arbitrary PDFs, non-court templates where **you** define the form schema.

| Step | Endpoint | Output |
|---|---|---|
| Submit job | `POST /api/nv/v1/sdk/ecosystem-documents/jobs` | `202 { jobId }` |
| Poll | `GET …/jobs/:jobId` | lifecycle: `queued → … → completed` |
| Result | `GET …/jobs/:jobId/result` | **`fields: { yourKey: value, … }`** + optional `intelligence` |
| Full text | `GET …/jobs/:jobId/content` | raw parsed text + preview |

**Request shape (minimal):**

```json
{
  "correlationId": "<uuid>",
  "orgId": "<your-org-uuid>",
  "userId": "<customer-user-id>",
  "storageRef": {
    "type": "inline_base64",
    "base64": "<file-bytes>",
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
        "extract": { "method": "regex", "pattern": "[A-Z]{5}[0-9]{4}[A-Z]" } },
      { "key": "partners", "type": "array",
        "extract": { "method": "llm", "instruction": "List of partner names" } }
    ]
  },
  "delivery": { "mode": "poll" }
}
```

**Extraction methods:** `regex` (deterministic), `builtin` (handler id for known Indian doc classes), `llm` (schema-guided, safety-ring), `tool` (agent tool bridge). Prefer `regex` + `builtin` for identifiers (PAN, GSTIN, CNR, case numbers); use `llm` for semantic fields (role descriptions, clause summaries).

Legacy shim: `POST /api/nv/shared-docs/process` maps to the same worker with a simpler envelope for small files.

### 7.4 Tier C — Large / multi-doc matter ingest

For DMS folders or due diligence: EDJ with `outputProfile: full_intelligence` or Matter Vault playbook. Autofill keys come from `fields` in the job result; progressive UI from poll status. Not for single-form instant autofill — use Tier A or B first.

### 7.5 OCR

Scanned PDFs: `extract` runs OCR when needed (`ocrUsed: true`). For image-only uploads, `POST /api/nv/gateway/ocr/process` is available. NSP's own OCR may pre-process — if you already have clean text, skip extract and pass text directly to analyze/orchestrate or EDJ with `storageRef.type: inline_base64` of the text (or pass via `documentText` on orchestrate for Tier A).

### 7.6 What not to do

| Anti-pattern | Why |
|---|---|
| Sentence-split a summary into fake `paras[]` | FB-206 — corpus honesty |
| Route treatment questions to `verify-citation` | Existence ≠ adverse treatment |
| Paste 200 KB contracts into orchestrate `prompt` | Use EDJ + `ragDocumentIds` for whole-file analysis |
| Expect live eCourts from CNR resolve | Corpus-only; show miss UI |

Full wiring table added to endpoints doc **§3.2b**.

---

## 8. Your local fixes — acknowledged

| NSP action | NYV read |
|---|---|
| `X-Org-Id` on firm-clause paths | Correct — P0 |
| FB-215 `courtType` forward | Correct — live on our side; your BFF fix pending your deploy |
| Evaluate timeout ≥ 210 s | Correct — we recommend ≥ 200 s server-side |
| `qualityEnvelope.deferred[]` UI | Correct — read `steps[]` authoritative |
| `rag_retrieval.chunks` null ≠ 0 | Correct |
| `analysisStatus` branch after deploy | **Deploy done** — branch now |
| Per-surface breaker retry | Correct — live on `8c6852aa` |

After your deploy + our deploy id above: run `npm run assert:fixed-bugs`, `nv-nsp-partner-reprobe.sh`, update your verification ledger.

---

## 9. Closing

We accept your API-first posture and will not treat tarball 5.1.0 as a gate on our rollout. **Deploy id `8c6852aa` / NYS `712e35ea…` is authoritative** — §13 of the consolidated reply is superseded by §2 of this document.

If any line disagrees with what you measure, send the `requestId`.

— Nyayavigya platform team

*Tracker: 2026-08-20T11:30:00Z · Evidence: deploy SSM, sdk-dist SHA256SUMS, reprobe script, GO job logs on caselaw worker*
