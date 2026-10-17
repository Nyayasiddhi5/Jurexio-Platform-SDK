# Cursor Prompt — Integrate `@jurexio/docparse` into Jurexio Professional

Paste this whole file into Cursor as the task. It assumes the `docparse/` package
has been copied into the monorepo. It is **discovery-first**: do not assume paths.

---

## 0. Ground rules — read before writing any code

These are not preferences. Violating any of them is a rejected PR.

1. **No LLM in the extraction path.** `@jurexio/docparse` is deterministic. Do not add
   an AI call to "improve" a field. The `llmFallback` config exists, defaults to
   `enabled: false`, is capped at `maxConfidence: 0.65`, and may only be turned on
   by an org-level admin setting — never by the engine, never by a request
   parameter, never by a feature flag the app can flip.
2. **Additive migrations only.** No `DROP`, no `ALTER ... TYPE`, no column renames.
3. **RLS on every new table.** No exceptions.
4. **`nyp_intake_decision` is append-only.** `REVOKE UPDATE, DELETE`.
5. **Never persist an unmasked Aadhaar or bank account number.** The engine masks
   both before returning; do not un-mask, do not store the raw page text
   separately, do not log the `ExtractionResult` at debug level without redaction.
6. **The four autofill states must stay four states in the UI.** `fields`,
   `lowConfidence`, `conflicts`, `absent`. Collapsing them into "filled or blank"
   destroys the user's ability to tell a confident extraction from a guess. This is
   the single most important UI requirement in this task.
7. **No case is created without explicit human approval.** The engine proposes.
8. **No eCourts automation.** No headless browser, no CAPTCHA solving, no scraping.
   CNR enrichment is user-mediated only.
9. **Reuse the existing app shell, navigation and breadcrumb.** Do not rebuild them.

---

## 1. Discovery — do this first, report before coding

Find and report, with file paths:

1. The API app root (Express 4 + TypeScript ESM). Look for `apps/api` or similar.
   Report: how routers are registered, how auth/tenant middleware is applied, how
   errors are shaped, whether there is a request-context/AsyncLocalStorage pattern.
2. The web app root (React 18 + Vite + Tailwind + shadcn/ui). Report: the app shell
   component, the navigation component, the breadcrumb component, the route
   definition file, and the existing form primitives (Input, Select, FormField).
3. The DB layer. Report: whether Drizzle schema files or raw SQL migrations are the
   source of truth, where migrations live, the naming convention, and the existing
   `nyp_` table set. **Confirm the connection uses `pg.Pool` and not `neon()`** —
   `neon()` against RDS is a known failure mode in this codebase.
4. The job queue (BullMQ). Report: where queues/workers are defined, the Redis
   config, and how a job reports progress.
5. The SSE / streaming pattern. Search for `onStage` — report how it is wired from
   worker to client.
6. The audit log (IronLedger). Report: the table, the append function, and the
   hash-chain implementation, so `docparse`'s own chain can be **folded into it
   rather than duplicated**.
7. Existing document upload/storage. Report: where files land, the storage
   abstraction, and whether SHA-256 is already computed on ingest.
8. Any existing intake/case-creation code, including the `nyp_intake_*` tables if
   they already exist from the earlier intake plan.
9. The `nyv_ref` reference plane. Report whether `nyv_ref.court` and the case-type
   master are reachable from this service.

**Stop and report. Do not write code until this is done.** Then propose the
integration plan and wait for confirmation.

---

## 2. What the package gives you

```ts
import { run } from "@jurexio/docparse";

const result = await run(
  [{ path: "/storage/batch/abc/fir.pdf", fileName: "fir.pdf" }],
  {
    batchId: "batch_01H...",
    actor: "advocate:1234",           // goes into every audit event
    now: () => platformClock(),        // inject the platform clock, not Date.now
    referenceYear: 2026,               // for 2-digit year expansion; keep explicit
    maxPagesPerDoc: 60,
    config: { ocr: { maxConcurrency: 4, dpi: 300 } },
  },
);
```

Returns an `ExtractionResult`:

| Field | Use |
|---|---|
| `documents[]` | Per document: pages, lines with bboxes, classification with alternatives and evidence, langs, timings, warnings |
| `candidates[]` | Every proposal with full provenance. **This is what you persist.** |
| `resolutions[]` | Per field: status (RESOLVED / CONFLICT / LOW_CONFIDENCE / ABSENT), chosen, competing, and a human-readable `rationale` |
| `autofill` | `fields` (pre-fill these), `lowConfidence` (offer, do not pre-fill), `conflicts` (make the user choose), `absent` (show "not found"), `tier`, `completeness` |
| `analysis[]` | Extractive summary sentences with line indices, timeline, obligations, reliefs, holding, citations, monetary, structure |
| `governance` | `restricted` + reasons, `redactions`, `aiInvolved`, `humanReviewRequired`, `auditEvents` |
| `timings`, `warnings` | Stage timings and user-facing warnings |

Also exported and useful directly: `toCaseDraft(payload)` → nested NSP case shape;
`AuditChain.verify(events, genesis)` → `null` if intact, else first broken seq.

---

## 3. Database — one additive migration

Create `nyp_intake_*` if the earlier intake plan has not already landed them. If it
has, **extend, do not recreate**. Every table: RLS on, tenant-scoped.

```sql
-- nyp_XXX_docparse.sql  (pick the next migration number)

-- Ante-matter container. Holds documents BEFORE a matter exists, which resolves
-- the ordering deadlock (no document without a matter, yet the matter derives
-- from the documents).
CREATE TABLE IF NOT EXISTS nyp_intake_batch (
  batch_id        text PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'PARSING',   -- PARSING|READY|APPROVED|REJECTED|FAILED
  restricted      boolean NOT NULL DEFAULT false,
  restricted_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  tier            text,                              -- T0..T3
  matter_id       uuid,                              -- set only on approval
  CONSTRAINT nyp_intake_batch_status_ck
    CHECK (status IN ('PARSING','READY','APPROVED','REJECTED','FAILED'))
);

CREATE TABLE IF NOT EXISTS nyp_intake_document (
  document_id     text PRIMARY KEY,
  batch_id        text NOT NULL REFERENCES nyp_intake_batch(batch_id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL,
  file_name       text NOT NULL,
  mime            text NOT NULL,
  sha256          char(64) NOT NULL,
  page_count      int NOT NULL,
  doc_type_code   text,
  doc_type_conf   numeric(4,3),
  doc_type_alts   jsonb NOT NULL DEFAULT '[]'::jsonb,
  langs           text[] NOT NULL DEFAULT '{}',
  storage_key     text NOT NULL,
  timings         jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per proposed value. This is the provenance record.
CREATE TABLE IF NOT EXISTS nyp_intake_candidate (
  candidate_id    bigserial PRIMARY KEY,
  batch_id        text NOT NULL REFERENCES nyp_intake_batch(batch_id) ON DELETE CASCADE,
  document_id     text NOT NULL REFERENCES nyp_intake_document(document_id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL,
  field_path      text NOT NULL,
  value_raw       text NOT NULL,
  value_normalized jsonb,
  confidence      numeric(4,3) NOT NULL,
  extractor_id    text NOT NULL,
  extractor_kind  text NOT NULL,
  ai_involved     boolean NOT NULL DEFAULT false,
  authority_weight numeric(4,3) NOT NULL,
  page_no         int NOT NULL,
  bbox            jsonb,
  line_indices    int[] NOT NULL DEFAULT '{}',
  redacted        boolean NOT NULL DEFAULT false,
  notes           jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nyp_intake_candidate_kind_ck CHECK (extractor_kind IN
    ('TEXT_LAYER','OCR','ANCHOR','GRAMMAR','TABLE','REFERENCE','COMPUTED','MANUAL','LLM_FALLBACK')),
  CONSTRAINT nyp_intake_candidate_conf_ck CHECK (confidence >= 0 AND confidence <= 1),
  -- An LLM-derived candidate can never exceed the cap. Enforced in the DB so a
  -- future code path cannot raise it.
  CONSTRAINT nyp_intake_candidate_ai_cap_ck
    CHECK (NOT ai_involved OR confidence <= 0.65)
);

CREATE INDEX IF NOT EXISTS nyp_intake_candidate_batch_field_idx
  ON nyp_intake_candidate (batch_id, field_path);

-- Append-only decision log. What the human actually accepted.
CREATE TABLE IF NOT EXISTS nyp_intake_decision (
  decision_id     bigserial PRIMARY KEY,
  batch_id        text NOT NULL REFERENCES nyp_intake_batch(batch_id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL,
  field_path      text NOT NULL,
  action          text NOT NULL,   -- ACCEPT|REJECT|OVERRIDE|CHOOSE
  candidate_id    bigint REFERENCES nyp_intake_candidate(candidate_id),
  final_value     jsonb,
  actor_id        uuid NOT NULL,
  decided_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nyp_intake_decision_action_ck CHECK (action IN ('ACCEPT','REJECT','OVERRIDE','CHOOSE')),
  -- An OVERRIDE must record what the human typed; an ACCEPT must point at a candidate.
  CONSTRAINT nyp_intake_decision_shape_ck CHECK (
    (action = 'OVERRIDE' AND final_value IS NOT NULL) OR
    (action IN ('ACCEPT','CHOOSE') AND candidate_id IS NOT NULL) OR
    (action = 'REJECT')
  )
);

REVOKE UPDATE, DELETE ON nyp_intake_decision FROM PUBLIC;
-- and from the application role explicitly:
-- REVOKE UPDATE, DELETE ON nyp_intake_decision FROM <app_role>;

ALTER TABLE nyp_intake_batch     ENABLE ROW LEVEL SECURITY;
ALTER TABLE nyp_intake_document  ENABLE ROW LEVEL SECURITY;
ALTER TABLE nyp_intake_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE nyp_intake_decision  ENABLE ROW LEVEL SECURITY;
-- Add tenant policies matching the codebase's existing RLS convention. Find that
-- convention in discovery; do not invent a new one.
```

Verify: apply to a scratch PostgreSQL 16, run it **three times**, confirm
idempotency and identical row counts. Then run adversarial inserts proving each
CHECK rejects (especially `ai_cap`) and that UPDATE/DELETE on
`nyp_intake_decision` is refused.

---

## 4. API

### `POST /intake/batch`
Create a batch, store files, enqueue the parse job. Returns `{ batchId }`.
Validate: file count, per-file size, MIME allow-list (`application/pdf`,
`image/png`, `image/jpeg`, `image/tiff`).

### `GET /intake/batch/:batchId/stream` (SSE)
Reuse the existing `onStage` pattern. Emit per page, not per document —
a 10-page scanned bundle is roughly **50 seconds** at measured throughput, so the
user must see progress. Events:

```ts
{ stage: "INGESTED",  documentId, fileName, pageCount }
{ stage: "PAGE_DONE", documentId, pageNo, route, meanConf }
{ stage: "CLASSIFIED", documentId, code, label, conf, alternatives }
{ stage: "FIELDS",    filled, lowConfidence, conflicts, absent, tier }
{ stage: "DONE",      batchId, tier, completeness }
{ stage: "WARNING",   code, message, severity, pageNo? }
```

### `GET /intake/batch/:batchId`
Full review payload: documents, resolutions with rationale, autofill, analysis,
governance. **Respect `governance.restricted`** — withheld field paths must not be
serialised to a role without the entitlement.

### `POST /intake/batch/:batchId/decision`
`{ fieldPath, action, candidateId?, finalValue? }`. Insert into
`nyp_intake_decision`. Never update an existing row.

### `POST /intake/batch/:batchId/approve`
Create the matter from accepted decisions only. Wrap in a transaction. Write an
IronLedger event. **Refuse if any `conflicts` entry is undecided.**

### `GET /intake/document/:documentId/page/:pageNo/image`
Rendered page image for provenance highlighting. Auth + tenant scoped.

---

## 5. Worker

```ts
// One job per batch.
// 1. run() from @jurexio/docparse
// 2. persist documents, candidates (already masked), resolutions
// 3. fold result.governance.auditEvents into IronLedger, preserving order
// 4. set batch.status / tier / restricted
// 5. emit SSE per stage
```

Notes that matter:

- Set `OMP_THREAD_LIMIT=1` in the worker environment as well. The package sets it
  per Tesseract invocation, but making it explicit in the worker prevents a future
  refactor losing a **4.4× latency win**.
- Do not raise `ocr.maxConcurrency` above the pod's CPU allocation. Page
  concurrency scaled 2.8× on 2 cores; oversubscribing regresses it.
- Set `ocr.pageTimeoutMs`. One malformed scan must not hold the job forever.
- Store the rendered page images at the DPI used, for the highlight overlay.

---

## 6. Web — four screens, reusing the existing shell

Reuse the app shell, nav and breadcrumb exactly as they are. Only the page bodies
are new.

### 6.1 Upload
Drop zone, per-file rows with type + page count as they classify. Show a
`BUNDLE_DETECTED` warning inline with the proposed split when the engine reports
one.

### 6.2 Review — the important screen
Split pane. Left: the form. Right: the page image with the provenance highlight.

Field rendering, and this is the requirement that matters most:

| State | Rendering |
|---|---|
| **RESOLVED** | Input **pre-filled**. Small provenance chip: document, page, confidence. Clicking it highlights the bbox on the right. |
| **LOW_CONFIDENCE** | Input **EMPTY**. The candidate shown *beside* it as a one-tap "Use this" suggestion, with confidence and the `rationale`. A pre-filled field is a field the user will not read — that is the whole point of this distinction. |
| **CONFLICT** | A chooser listing each competing value with its source document, page and confidence. **No default selection.** Show `rationale`, which already explains why the system refused to pick. |
| **ABSENT** | Input empty, labelled "not found in your documents" — visually distinct from a failure. |

Also on this screen:
- Restricted-matter banner when `governance.restricted`, listing the statutory
  reasons, with withheld fields rendered as "withheld — statutory bar".
- `NUMERIC_ARBITRATION_CONFLICT` warnings surfaced next to the affected fields:
  "different OCR models read this number differently — please confirm".
- Human-review list from `governance.humanReviewRequired`, with page thumbnails.
- Every field row exposes Accept / Override / Reject → `POST /decision`.

### 6.3 Analysis
Extractive summary (each sentence clickable → highlights its source lines),
timeline, obligations with obligor and deadline, reliefs, citations. Label the
summary "extracted from your documents", never "AI summary" — it is neither.

### 6.4 Approve
Tier badge (T0–T3), completeness, unresolved-conflict count. Approve is **disabled
while any conflict is undecided**. On approve, show the created matter.

---

## 7. Definition of done

- [ ] Migration applies 3× idempotently on PG 16; adversarial inserts all rejected;
      UPDATE/DELETE on `nyp_intake_decision` refused
- [ ] `pg.Pool`, not `neon()`
- [ ] RLS enabled and policied on all four tables
- [ ] `@jurexio/docparse` test suite passes in CI (210 tests)
- [ ] End-to-end: upload the FIR fixture → review → approve → matter created
- [ ] SSE emits per page, verified on a 2-page scan
- [ ] **Serialise a full API response and grep for the fixture Aadhaar
      `234567890123`. Zero hits. Add this as a CI test.**
- [ ] All four field states render distinctly; screenshot each
- [ ] Conflict chooser has no default selection
- [ ] Restricted-matter path verified with a POCSO-section document
- [ ] IronLedger chain verifies after a batch is processed
- [ ] `OMP_THREAD_LIMIT=1` set in the worker env
- [ ] No new `mupdf`, `mupdf-js` or `scribe.js-ocr` dependency (all AGPL)
- [ ] No AI call anywhere in the extraction path

---

## 8. Things you will be tempted to do — don't

- **Don't pre-fill low-confidence fields "for convenience."** It defeats the entire
  confidence model.
- **Don't auto-pick the highest-confidence value in a conflict.** The engine
  already declined to, deliberately, and its `rationale` says so.
- **Don't add an LLM to clean up Indic OCR.** It will hallucinate a plausible name.
  Indic prose is flagged low-confidence on purpose; the answer is human
  verification, not generation.
- **Don't "fix" the concordance by flipping `CONCORDANCE_STATUS`.** It is DRAFT
  until an advocate signs the table off.
- **Don't cache the `ExtractionResult` to an unencrypted store or log it at debug.**
  It contains masked-but-sensitive material and full page text.
- **Don't raise `maxConcurrency` to "make it faster."** Measured: it regresses past
  the CPU allocation. The real wins available are DPI (validated ~1.6 s/page at
  200 DPI) and restricting Indic arbitration to numeric-bearing lines.
