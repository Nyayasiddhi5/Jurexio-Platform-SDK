# DocParse — Amazon Textract as structured backup (before LLM)

**Role:** AI architecture + document management crosscheck (2026-10-07).  
**References:** [Amazon Textract features](https://aws.amazon.com/textract/features/), [AnalyzeDocument](https://docs.aws.amazon.com/textract/latest/dg/how-it-works-analyzing.html), [Textract FAQs](https://aws.amazon.com/textract/faqs/).  
**Related:** `nv-got-ocr-adapter-service.ts`, `@nyv/docparse-sdk` `CloudOcrProvider`, `PartialFieldRecoveryProvider`, `DOCPARSE-LEGAL-GLOBAL-BEST-STATUS-2026-10.md`.

---

## 1. Executive recommendation

**Yes — add Amazon Textract as an optional cloud tier after local OCR and before any LLM** (partial snippet recovery or full `/documents/analyze`).

| Goal | Textract contribution |
|------|------------------------|
| Reduce LLM token spend | **Queries** + **Forms** return field-shaped answers with confidence — use instead of Nova for many gaps |
| Improve tables (ruledMethodTables gap) | **TABLES** + cell geometry maps to docparse `Table` / `TableRecord` |
| Handwriting / noisy scans | **OCR** on printed + some handwriting — backup when Tesseract/Paddle fail (not a replacement for Indic handwriting at “global best”) |
| Keep deterministic merge | Textract output → same candidate/resolution plane (bbox + conf), not free-form prose |

Textract is **not** a substitute for the legal engine (anchors, statutes, PII governance, autofill four states). It is a **better OCR + structure** layer than vision-LLM for many pages.

**Do not** route every document through Textract by default — cost is per page (~order of $1.50 / 1K pages for document analysis tiers per internal cost plan). Use **policy-gated** escalation only.

---

## 2. Current Nyayavigya recovery ladder (today)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Text layer (PDF digital)                                      │
│ 2. Local OCR (Tesseract + Paddle arbitration)                    │
│ 3. CloudOcrProvider (SDK page hook) → NYV GOT / Mistral / Gemini │
│    / OpenAI vision / tesseract-local (nv-got-ocr-adapter)        │
│ 4. PartialFieldRecoveryProvider (snippet LLM, NYV_F_DOCPARSE_    │
│    LLM_FALLBACK) — field paths only                              │
│ 5. Full LLM analyze (/documents/analyze) — obligations, risks  │
└─────────────────────────────────────────────────────────────────┘
```

**Gap:** Step 3 often uses **vision LLMs** (steps 3–4 in adapter), which burn **LLM tokens** and are overkill for “read this scanned FIR table.”

**Proposed insertion:**

```
2. Local OCR
2b. Amazon Textract (sync page or async job)  ← NEW, structured, non-LLM-token
3. Vision OCR (GOT/Mistral/Gemini) only if Textract unavailable or low conf
4. Partial LLM (snippets)
5. Full analyze
```

---

## 3. Textract features mapped to DocParse

From [AWS Textract features](https://aws.amazon.com/textract/features/) and API `FeatureTypes`:

| Textract capability | DocParse use | Legal / PII fit |
|---------------------|--------------|-----------------|
| **OCR** (lines/words + bbox + confidence) | Feed `groupLines()` via `CloudOcrProvider` | Core backup OCR |
| **TABLES** | Merge into `detectPageTables` / `TableRecord` (LEDGER, LISTING) | Cause lists, bank annexures, charge-sheet schedules |
| **FORMS** (key-value) | Map to `Candidate` paths (`court.raw`, `fir.number`, …) | Filing forms, police forms |
| **LAYOUT** | Headings → `analysis.structure` | Judgments, plaints |
| **QUERIES** | Predefined legal questions → gap-fill **before** partial LLM | CNR, parties, case number (confidence-scored) |
| **SIGNATURES** | `humanReview` / vakalatnama hints | Not auto-fill without review |
| **Custom Queries** | Domain-pack specific (BFSI FNOL, health claim) | Sector packs |
| **Analyze Lending / Invoices / Analyze ID** | **Out of scope** for NYV legal-in default | Use only in sector packs if needed |

**Not a good primary fit for India legal:** mortgage **Analyze Lending** pipeline (US loan packages). Indian court plaints/FIRs still benefit from **TABLES + FORMS + QUERIES + LAYOUT**.

**Handwriting:** Textract advertises handwritten text; treat like local OCR — **triage + human review** for Indic script, same as current engine docs.

---

## 4. Where to wire in code (SSoT)

### 4.1 SDK (`@nyv/docparse-sdk`) — already ready

| Extension | Interface | Today |
|-----------|-----------|--------|
| Page OCR backup | `CloudOcrProvider.recognizePage()` | Wired in `run.ts` after local OCR fail / low conf |
| Future structured pass | **New** `CloudStructureProvider.analyzePage()` returning `{ text, tables[], forms[], queries[] }` | Design below — optional alpha.4 |

Textract **page** path: implement `CloudOcrProvider` with id `aws-textract` — flatten LINE blocks to text + mean confidence.

Textract **structure** path (recommended): second hook after OCR success on hard pages:

```typescript
// Proposed (alpha.4) — documents/working only until GO implement
interface CloudStructurePageResult {
  text: string;
  meanConf: number;
  provider: "aws-textract";
  forms: Array<{ key: string; value: string; confidence: number; bbox: BBox }>;
  tables: Array<{ grid: string[][]; confidence: number }>;
  queryAnswers: Record<string, { answer: string; confidence: number }>;
}
```

Merge **forms/queryAnswers** into `candidates` with `extractorKind: "CLOUD_STRUCTURE"` and `aiInvolved: false` (Textract is ML but **not** your LLM budget).

### 4.2 NYV gateway

| Location | Change |
|----------|--------|
| `nv-docparse-cloud-ocr-sdk-provider.ts` | Chain: try Textract when `NYV_F_TEXTRACT=1` && IAM ok, else existing GOT adapter |
| `nv-got-ocr-adapter-service.ts` | Insert provider **`textract`** at precedence **2** (after self-hosted GOT, **before** Mistral/Gemini/OpenAI vision) |
| `nv-docparse-partial-llm-sdk-provider.ts` | Skip field paths already filled by Textract Queries above confidence floor |
| Feature flag | `NYV_F_TEXTRACT` / env `NYV_TEXTRACT_ENABLED=1`, region `AWS_REGION=ap-south-1` |

**Dependency (when implementing):** `@aws-sdk/client-textract` — not in tree yet; canonical stub referenced in `docs/canonical/13-prod-cutover-plan-2026-05-12.md` (`textract-adapter.ts` planned, not shipped).

### 4.3 NSP (local-first)

NSP can implement the **same** `CloudOcrProvider` / `CloudStructureProvider` using **NSP’s AWS account** (recommended for DPDP — document bytes never leave NSP for OCR if NYV is not used).

Handoff: copy provider pattern from NYV once shipped; inject in `NspHybridDocparseOptions.cloudOcr`.

---

## 5. API usage pattern (AWS)

### 5.1 Single page (matches SDK page loop)

```typescript
// AnalyzeDocument — sync, single-page image/PDF page raster
FeatureTypes: ["TABLES", "FORMS", "LAYOUT"]  // add QUERIES via QueriesConfig
Document: { Bytes: pagePngBytes }
```

### 5.2 Multi-page paper book (NYV async jobs)

Use **`StartDocumentAnalysis`** + S3 `DocumentLocation` + SNS completion — align with existing `docparse-sdk` BullMQ worker (same job record, Textract job id in progress).

Cap pages with existing `maxPagesPerDoc`.

### 5.3 Legal-in query set (replaces many partial LLM calls)

Configure once per domain pack `legal-in`:

| Query alias | Natural language query (Textract Queries) | Maps to fieldPath |
|-------------|-------------------------------------------|-------------------|
| `cnr` | What is the CNR number? | `cnr` |
| `court` | What is the name of the court? | `court.raw` |
| `petitioner` | Who is the petitioner? | `parties[0].name` |
| `respondent` | Who is the respondent? | `parties[1].name` |
| `fir` | What is the FIR number? | `fir.number` |

**Gate:** if `QUERY_RESULT.confidence >= 0.85`, do **not** call partial LLM for that path.

---

## 6. Cost vs LLM tokens (architecture decision)

| Path | Billing model | When to use |
|------|---------------|-------------|
| Local docparse | Compute only | Default |
| Textract AnalyzeDocument | **Per page** (feature mix affects tier) | Scanned page, table-heavy, local OCR fail |
| Vision OCR (Gemini/OpenAI) | **LLM / vision tokens** | After Textract fail or non-AWS air-gap |
| Partial LLM (Nova micro) | **LLM tokens** × fields | Remaining gaps only |
| Full analyze | **LLM tokens** × document | User opts in (`includeNyvIntelligence`) |

Internal planning already notes Textract as opt-in handwritten fallback (~$1.5 / 1K pages) — see `NYV-DEPLOYMENT-COST-PLAN-20K-USERS-2026-09.md`.

**Rule of thumb:** One Textract page on a failed OCR is usually **cheaper and more stable** than one vision-LLM call + partial LLM on the same page.

---

## 7. Document management & compliance

| Topic | Guidance |
|-------|----------|
| **Retention** | Textract does not store your document; bytes in-flight only. Log **provider id + page + conf**, not text (NV-SECRETS-001). |
| **Region** | Prefer **`ap-south-1`** for India workloads; configure per tenant. |
| **NSP air-gap** | Local parse + NSP-owned Textract IAM role — no NYV egress. |
| **NYV managed** | Textract from nysdev/prod — clarify in DPA that OCR subprocessors include AWS. |
| **PII** | Textract output still flows through **governance/redaction** before autofill; do not skip PII catalog because AWS processed the page. |

---

## 8. Implementation roadmap (no bit-splitting)

| Phase | Deliverable | Owner | Depends on |
|-------|-------------|-------|------------|
| **T0 (done)** | Architecture + ladder (this doc) | Platform | — |
| **T1** | `nv-textract-ocr-service.ts` + SDK cloud chain + flag `NYV_F_TEXTRACT` | NYV | **DONE** — live nysdev deploy `2026-10-07T0844Z-aws-ssm`, IAM + `NYV_F_TEXTRACT=1` |
| **T2** | Precedence in `nv-got-ocr-adapter-service` (Textract before vision LLM) | NYV | **DONE** |
| **T3** | `CloudStructureProvider` + TABLES/FORMS merge into docparse tables/candidates | SDK alpha.4 | T1 |
| **T4** | Legal-in `QueriesConfig` + partial LLM skip logic | NYV + SDK | T3 |
| **T5** | NSP sample provider + handoff § in team integration guide | NSP bundle | T1 |
| **T6** | Corpus gate: optional `NYV_DOCPARSE_GATE_TEXTRACT=1` on EC2 | Ops | GO deploy nysdev |

**Explicit GO needed:** IAM role/policy for Textract on nysdev, `@aws-sdk/client-textract` dependency, and spend approval (same bar as enabling partial LLM).

---

## 9. Crosscheck summary vs “global best” legal docparse

| Gap | Textract helps? |
|-----|-----------------|
| OCR on EC2 workers | **Yes** (async + sync) |
| Ruled / table quality | **Yes** (TABLES feature) |
| Partial LLM cost | **Yes** (Queries + FORMS) |
| Indic handwriting | **Partial** — keep human review |
| Legal intelligence (obligations) | **No** — still extractive local or `/analyze` |
| Dual engine legacy | **No change** — Textract is adapter, not `@nyv/docparse` |

---

## 10. NSP / NYV / JRX quick policy

| Platform | Textract recommendation |
|----------|-------------------------|
| **NSP** | Enable on **your** AWS account as `cloudOcr` + future `cloudStructure`; default off in dev |
| **NYV** | Central Textract with feature flag; before vision LLM in adapter |
| **JRX** | Same NYV path via HTTP escalation; JRX does not call Textract directly unless embedded SDK on JRX infra |

---

## 11. Next actions for you

1. **Product GO:** Textract spend + IAM on nysdev (`ap-south-1`).
2. **Engineering GO:** Implement T1–T2 (single PR: provider + adapter precedence + flag).
3. **NSP:** No change until T5 — continue local-first bundle; add Textract when NSP AWS ready.
4. **Deploy:** Still separate **`GO deploy nysdev`** for current alpha.3 HTTP features; Textract is additive after T1.

When you want implementation, reply **GO Textract T1–T2** (and confirm AWS region + IAM). When you want EC2 parity for existing docparse API, reply **GO deploy nysdev**.
