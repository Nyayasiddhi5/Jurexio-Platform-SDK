# NYS Athena on-demand full-judgment retrieval — canonical map

**Date:** 2026-08-19 · **Ref:** `NV-NYS-FULLTEXT-001` · **Scope:** NYS (`i-000115b19219bb766`) + NYV knowledge plane
**Status:** verified by execution against the live NYS host. All numbers below are measured, not inferred.

---

## 0. The correction this document records

A prior static read concluded *"judgment full text is NOT available — RDS holds metadata and
headnotes only."* That is **half right and the wrong half was the conclusion**:

- **Right:** the judgment body is genuinely absent from the hot RDS path. `judgments.full_text`
  exists in the DDL and is `NULL` for **all 26,259,225 rows** (measured), and it is excluded from
  `SELECT_COLS` in `NYS-Agentic-AI/artifacts/api-server/src/lib/rdsCaselaw.ts`.
- **Wrong:** "not available". The body **is** available on demand from the owned S3 PDF estate,
  reached via the Athena metadata tables. It was verified end to end on 2026-08-19: a real Supreme
  Court judgment body of 33,644 characters and a real High Court order body of 1,697 characters
  were both retrieved live.

One important nuance that neither the original claim nor the correction stated precisely:

> **The full text does not come out of Athena.** Athena is the *locator*. It answers "which S3
> object is this judgment?" The text comes from **downloading that PDF from S3 and extracting it**.
> There is no Athena table containing judgment text.

---

## 1. Endpoint map (NYS)

All four live in `NYS-Agentic-AI/artifacts/api-server/src/routes/athena.ts`, mounted by
`routes/index.ts` under `app.use("/api", router)` **after** `authGuard`. Machine auth accepts
`X-API-Key` or `Authorization: Bearer` matched with `timingSafeEqual` against `NYS_SDK_API_KEYS`
(falling back to `NYS_KNOWLEDGE_API_KEY`, then `MCP_TOKEN`).

### `GET /api/athena/status`
No params. Returns the server's Athena config.
```json
{"configured":true,"database":"nyv_docs","table":"judgments_meta",
 "hcTable":"judgments_meta_hc","workgroup":"nyv-docs","maxScanBytes":5368709120}
```
Measured: `http=200`, 145 bytes, 2 ms.

### `POST /api/athena/search` — the **locator** hop
Body (Zod-validated): `q` (2–200 chars, required), `year?` int 1900–2100, `court?` ≤100 chars,
`archive?` `"sc"|"hc"|"all"`, `limit?` 1–50 (default 20).
`archive` defaults to **`"sc"`** — a deliberate cost default, since SC scans ~1.6 MB and HC ~1.3 GB.

Response:
```json
{"query":"Kesavananda",
 "results":[{"title":"HIS HOLINESS KESAVANANDA BHARATI SRIPADAGALAVARU versus STATE OF KERALA",
             "court":"Supreme Court of India","year":"1973",
             "citation":"[1973] SUPP. 1 S.C.R. 1","decision_date":"1973-04-24",
             "s3_path":"s3://your-supreme-court-data-bucket/data/tar/year=1973/english/S_1973_1_1_1002_EN.pdf",
             "archive":"sc"}],
 "bytesScanned":1663834,"estimatedCostUsd":0.000008}
```
All values are returned as **strings** (`year:"1973"`), because they come from Athena's
`VarCharValue`. Guards: 45 s deadline, 750 ms poll, `StopQueryExecution` on timeout or on breaching
`ATHENA_MAX_SCAN_BYTES` (→ `413`).

### `POST /api/athena/extract` — the **full-text** hop
Body: `s3Path` (required, must start `s3://`, ≤1024 chars), `title?` ≤500 chars.
```json
{"s3Path":"...","requestedPath":"...","title":null,"byteSize":488366,
 "textLength":33644,"text":"40 NATIONAL BUILDINGS CONSTRUCTION CORPORATION v. …",
 "ocrUsed":false,"cached":false}
```
Status codes: `400` bad/blocked path · `404` not in archive · **`413` PDF > 20 MB** ·
`422` no extractable text even after OCR · `502` S3 fetch failed · `500` other.

### `GET /api/athena/document` — presigned URL (no extraction)
Query: `s3Path` (required). Returns `{url, bucket, key, expiresIn: 300}`. Resolves the HC
sibling-bucket fallback first so the URL never 404s. Measured `http=200`, 2032 bytes, 620 ms.

> **Defect found (not fixed here):** the client SDK's `getArchiveDocument()` and
> `archiveDocumentStatus()` in `packages/client-sdk/src/api/KnowledgeApi.ts` send
> `archiveId` / `id` query params. NYS requires **`s3Path`** and ignores both, so those two SDK
> methods can only ever produce a `400 "Invalid s3Path parameter."`. `status` also takes no params
> at all. See §7.

---

## 2. Athena topology (read from the live catalog)

| Item | Value |
|---|---|
| Database | `nyv_docs` |
| SC table | `judgments_meta` → `s3://usa-caselaw/athena/judgments_meta/` |
| HC table | `judgments_meta_hc` → `s3://usa-caselaw/athena/judgments_meta_hc/` |
| US table | `judgments_meta_us` → **configured in env (`ATHENA_TABLE_US`) but never read by the code** |
| DC table | **does not exist** |
| Workgroup | `nyv-docs` |
| Results | `s3://usa-caselaw/athena/results/` |
| Region | `ap-south-1` (Athena + `usa-caselaw`); the SC/HC PDF buckets are elsewhere — see §3 |
| Format | Parquet, GZIP, `ParquetHiveSerDe` |
| Scan cap | 5 GB (`ATHENA_MAX_SCAN_BYTES` unset → default) |

Row counts via Athena: `judgments_meta` **43,505** · `judgments_meta_hc` **20,443,570`.

**All three tables are UNPARTITIONED.** `SHOW PARTITIONS` returns
`Table judgments_meta is not a partitioned table` for each. `year` is a plain `int` column.

---

## 3. Identifier → S3 key, per court tier

The bucket allowlist in `lib/archiveDocs.ts` (`DOCUMENT_BUCKET_REGIONS`) is the hard boundary —
only these four buckets can ever be presigned or fetched:

| Bucket | Region | Holds |
|---|---|---|
| `your-supreme-court-data-bucket` | `us-east-1` | SC judgment PDFs (**legacy name, live estate — not a placeholder**) |
| `ns-highcourt-data-bucket` | `us-east-1` | HC judgment PDFs |
| `ns-indian-highcourt-judegements-2`* | `ap-south-1` | HC judgment PDFs (sibling; identical key layout) |
| `usa-caselaw` | `ap-south-1` | US PDFs + the Athena tables/results |

\* exact string in code is `ns-indian-highcourt-judgements-2`.

Public Open Data buckets (`indian-supreme-court-judgments`, `indian-high-court-judgments`,
`indian-district-court-judgments`) are **metadata/ingest sources only** and are deliberately NOT on
the allowlist.

### Supreme Court — works
- **Identifier needed:** none beyond the row. `pdf_link` **is** the `s3://` path already, for
  **43,505 / 43,505** rows (100%).
- Built at ingest by `scpdfS3Path(path, year)` in `ingest-rds.ts` from the parquet `path` column:
  `s3://your-supreme-court-data-bucket/data/tar/year=<YYYY>/english/<path>_EN.pdf`
- Athena `judgments_meta.s3_path` carries the same value, so `/athena/search` → `/athena/extract`
  needs no translation.
- Measured example: `.../year=1973/english/1973_1_40_52_EN.pdf`

### High Court — works, but requires reconstruction
- **Identifier needed:** `year` + `court_code` + `bench` + `basename(pdf_link)`. **`pdf_link` alone
  is NOT usable** — for all **20,438,646** HC rows it is an eCourts-relative path such as
  `court/cnrorders/aphc/orders/APHC010000012012_1_2019-07-23.pdf` (`shape='relative'`, 100%).
- Reconstruction (`hcS3Path()` in `rdsCaselaw.ts`), exposed as the `s3Path` field on
  `CaselawDocOut`:
  `s3://ns-highcourt-data-bucket/data/pdf/year=<Y>/court=<court_code with ~ → _>/bench=<bench>/<basename>`
  — note the `~`→`_` substitution (metadata `21~11` → key `21_11`).
- **Sibling fallback is essential and fires in practice.** `resolveArchiveObject()` HEADs the
  requested bucket, then `HC_SIBLING_BUCKET`. Measured: a request for
  `s3://ns-highcourt-data-bucket/...` resolved to
  `s3://ns-indian-highcourt-judgements-2/data/pdf/year=2020/court=19_16/bench=calcutta_circuit_bench_at_jalpaiguri/WBCHCJ0027152019_1_2020-01-09.pdf`
  — i.e. `fallbackUsed=true`. Any client that skips this and presigns directly will 404 on a
  document that exists.
- Athena `judgments_meta_hc.s3_path` already contains the reconstructed form.

### District Court — **NOT retrievable. No full text exists for DC.**
Four independent blockers, all confirmed live:
1. `pdf_link` is a **directory prefix**, not an object key:
   `s3://indian-district-court-judgments/data/tar/year=2019/state=2/district=20/complex=1020168/`
2. It is `NULL` for **3,760,402 of 5,690,538** DC rows (66%); only 1,930,136 have even a prefix.
3. `indian-district-court-judgments` is **not on the allowlist** → measured
   `400 {"error":"Bucket \"indian-district-court-judgments\" is not an allowed document bucket."}`
4. `ALLOWED_KEY` requires a `.pdf` suffix, so a prefix is rejected regardless.
5. There is no `judgments_meta_dc` Athena table.

DC judgments are therefore **citable by CNR/case number only**, never quotable.

---

## 4. Where `pdf_text_cache` fits: it does not

This was a live trap. There are **two different caches in two different databases**:

| | `archive_extracts` | `pdf_text_cache` |
|---|---|---|
| Database | **app DB** (`DATABASE_URL`, Drizzle `@workspace/db`) | **caselaw RDS** (`nyv-caselaw-pg`, Secrets-Manager creds) |
| Written by | `extractArchiveText()` — the live on-demand path | nothing observed |
| Key | `requestedPath` (the *requested* s3 path, pre-fallback) | `judgment_id` |
| Rows (measured) | present and in use | **0** |

`pdf_text_cache` is declared in `rds-ddl.ts` and exists in the caselaw RDS with **zero rows**. It is
**not** part of the on-demand path. The real cache is `archive_extracts`, keyed on the requested
path with `onConflictDoNothing`, which is why a warm re-request skips S3 entirely.

**Measured cache effect:** cold extract **2,693 ms** (`cached:false`) → warm re-fetch of the same
path **13 ms** (`cached:true`), identical `textLength=35536`. A ~207× speed-up.

Caps: PDF **20 MB** (`MAX_ARCHIVE_PDF_BYTES`), text **500,000 chars** (truncated with an explicit
note). Path validation rejects percent-encoding outright, `..`, `//`, backslashes, control chars,
wildcards, and requires an exact allowlist bucket match (so `owned-bucket.evil.com` fails).

---

## 5. Latency and cost — measured, not estimated

### Locator hop (Athena)

| Scope | Predicate | Bytes scanned | Est. cost | Wall |
|---|---|---|---|---|
| `sc` | `q="Kesavananda"` | 1,663,834 | $0.000008 | 0.99 s |
| `sc` | `q="Kesavananda"`, `year=1973` | 1,663,994 | $0.000008 | 1.72 s |
| `sc` | no match at all | 1,058,732 | $0.000005 | — |
| `hc` | `q="bail"`, `year=2020` | 1,296,946,561 | $0.005898 | 1.70 s |
| `hc` | `q="bail"`, `year=2020` (2nd) | 1,465,853,831 | $0.006666 | 1.71 s |
| `hc` | `q="anticipatory bail"`, **no year** | 1,572,354,148 | $0.007150 | 1.70 s |

**HC costs ~800× SC per query.** Confirmed cost risk.

**The `year` filter does not meaningfully prune, and the reason is not the missing partitions.**
A bare `SELECT count(*) FROM judgments_meta_hc WHERE year=2020` scans only **30,811 bytes** —
Parquet row-group statistics prune it almost perfectly. The API's query scans 1.3 GB because its
predicate is `lower(title) LIKE '%q%' OR lower(coalesce(description,'')) LIKE '%q%'`, which forces a
full read of the `title` and `description` columns across every row group. Adding `year` to a
`LIKE`-driven query cannot recover that. **Partitioning the table would not fix this on its own**;
the fix is to stop using `LIKE` as the primary filter for HC scope.

Also note `buildSelect()` interpolates `year` and applies `LIMIT` **per sub-select before the union**,
so `archive:"all"` runs two independent scans (~1.6 GB combined).

### Full-text hop (S3 + extract)

| Case | PDF bytes | Text chars | Cold wall | Result |
|---|---|---|---|---|
| SC `1973_1_40_52_EN.pdf` (NBCC v. Pritam Singh Gill) | 488,366 | 33,644 | **1,761 ms** | `200`, real body |
| SC `1950_1_806_821_EN.pdf` | 538,413 | 35,536 | **2,693 ms** | `200`, real body |
| same, warm | — | 35,536 | **13 ms** | `200`, `cached:true` |
| HC `WBCHCJ0027152019_1_...pdf` | 39,009 | 1,697 | **773 ms** | `200`, real body, sibling bucket |
| HC `GAHC010024532020_1_...pdf` | 68,338 | 2,221 | **826 ms** | `200`, real body |
| **SC Kesavananda** `S_1973_1_1_1002_EN.pdf` | **35.8 MB** | — | 612 ms | **`413` over cap** |
| **SC Maneka Gandhi** `1978_2_621_776_EN.pdf` | **60.9 MB** | — | 214 ms | **`413` over cap** |

End-to-end two-hop total (resolve + extract, cold): **2.6–2.9 s**.

### The landmark-judgment gap

**Both landmark cases named in the brief FAIL the 20 MB cap.** These SC PDFs are whole *SCR volume
extracts* (`1978_2_621_776` = pages 621–776), so the most-cited judgments in Indian constitutional
law are exactly the ones that exceed the limit, while routine ones extract fine. This is a real
coverage hole at the top of the corpus, not an edge case. Not changed here (NYS-side cap change +
deploy is out of scope for this task) — see §7.

---

## 6. Metadata inventory per court tier — the decisive query

Run against the live caselaw RDS (`nyv-caselaw-pg`, db `nyv_caselaw`), positive control
`SELECT 5150` returned `5150` first. **This query had not been run before.** Elapsed 240,413 ms.

```sql
SELECT court_type, count(*) AS total, count(citation) AS with_citation
FROM judgments GROUP BY court_type ORDER BY court_type;
```

| court_type | total | with_citation | citation coverage |
|---|---|---|---|
| `dc` | 5,690,538 | **0** | 0.000% |
| `hc` | 20,438,646 | **0** | 0.000% |
| `sc` | 43,505 | **43,505** | **100.000%** |
| `us-fed` | 59,781 | 851 | 1.42% |
| `us-ny` | 26,755 | 114 | 0.43% |
| **TOTAL** | **26,259,225** | **44,470** | **0.169%** |

### Verdict on the prior claim: **CONFIRMED, and now sharper**

The claim was "`citation` is populated ONLY for Supreme Court rows (~43,505 of 26,259,225)".
Confirmed exactly — 43,505 total, 43,505 with citation, and HC/DC are **exactly zero**, matching the
hardcoded `citation: null` in `mapHcRow` and `mapDcRow`. Two refinements:

1. Totals match to the row: 43,505 SC and 26,259,225 overall.
2. It is *not* only SC — **965 US rows** also carry citations (851 `us-fed` + 114 `us-ny`). For
   **Indian** caselaw the claim is exact: SC 100%, HC 0%, DC 0%.

### Full field population (same run)

| Field | SC (43,505) | HC (20,438,646) | DC (5,690,538) |
|---|---|---|---|
| `citation` | **43,505 (100%)** | **0** | **0** |
| `cnr` | 43,505 (100%) | 20,438,646 (100%) | 5,690,538 (100%) |
| `pdf_link` | 43,505 (100%) | 20,438,646 (100%) | 1,930,136 (34%) |
| `petitioner` | 43,487 (99.96%) | **1,291,516 (6.3%)** | **0** |
| `respondent` | 43,487 (99.96%) | 1,291,512 (6.3%) | **0** |
| `judges` | 43,487 (99.96%) | 17,740,700 (86.8%) | **0** |
| `author_judge` | **0** | **0** | **0** |
| `decision_date` | 43,505 (100%) | 20,438,646 (100%) | 5,690,538 (100%) |
| `description` (headnote) | **1,128 (2.6%)** | 19,130,651 (93.6%) | 5,690,538 (100%) |
| `case_no` | 43,353 (99.7%) | **1,291,519 (6.3%)** | 5,690,538 (100%) |
| `court_code` | **0** | 20,438,646 (100%) | 5,690,538 (100%) |
| `bench` | **0** | 20,438,646 (100%) | 5,690,538 (100%) |
| **`full_text`** | **0** | **0** | **0** |

Findings beyond the brief:
- **`full_text` is NULL for all 26.26 M rows.** The column exists but was never populated; excluding
  it from `SELECT_COLS` hides nothing.
- **`author_judge` is 0 everywhere** — including SC, where `mapScRow` *does* map it. The source
  parquet column is absent or differently named. Do not attribute an authoring judge from this corpus.
- **SC has almost no headnote (2.6%) but always a citation; HC/DC have a headnote (94%/100%) but never
  a citation.** So the tier that is easiest to cite is the hardest to summarise without fetching the
  PDF — which makes the on-demand path *more* important for SC, precisely where the 20 MB cap bites.
- **HC `petitioner`/`respondent`/`case_no` are only 6.3% populated** (~1.29 M of 20.4 M) — a much
  larger gap than the brief anticipated, and it applies to HC, not just DC.
- **DC `title` is machine-synthesised** — confirmed: `CC No. 202100035472019 · Visakapatnam District Court`,
  built in `mapDcRow` from `case_type`/`case_no`/`district`. DC `petitioner`/`respondent` are 0. Confirmed.

### Available to identify and cite

| Tier | Citable as | Quotable? |
|---|---|---|
| SC | reporter citation, 100% (`[1978] 2 S.C.R. 621`) | **Yes**, if PDF ≤ 20 MB |
| HC | court + year + CNR + eCourts case no. — **never a reporter citation** | **Yes** |
| DC | CNR + synthesised case title only | **No** — no per-judgment PDF |

---

## 7. NYV side — was it wired, and what changed

### Before (the gap)

| Surface | State |
|---|---|
| `POST /api/nv/knowledge/documents/search` → `/athena/search` | exposed (proxy) |
| `GET /api/nv/knowledge/documents/status` → `/athena/status` | exposed |
| `GET /api/nv/knowledge/documents/document` → `/athena/document` | exposed |
| `POST /api/nv/knowledge/documents/extract` → `/athena/extract` | exposed |
| MCP tool `nys_athena_search` | live, **metadata only** |
| **Anything joining resolve → extract** | **absent** |
| **Any MCP tool returning judgment text** | **absent** |
| **Any intent routing "full judgment" → this path** | **absent** |

So the verdict on the key question: **NYV *exposed* the path but did not *route* to it.** Both hops
were reachable as raw proxies, but nothing connected them. A caller holding a **case name** — which is
what a user actually has — could not get text: they had to call `/documents/search`, parse
`results[i].s3_path`, then call `/documents/extract`. No agent, no MCP tool and no intent path did
that. The only archive tool an agent could reach, `nys_athena_search`, returned metadata, so an agent
could *locate* a judgment and never *read* it. That is almost certainly how "full text is not
available" became received wisdom on the NYV side.

The `archive-fulltext-hint` step (`lib/retrievalRouter.ts`) fires on `/retrieve` when
`jurisdiction === "IN"` **and** (`generative` is set **or** the query matches
`\b(judgment|judgement|ratio|held|precedent|order|full\s*text|pdf)\b`). It emits guidance —
*"RDS caselaw is metadata/headnotes. For full judgment text use Athena archive search + extract. Do
not invent passages."* — plus up to 3 `samplePdfLinks`. It is **advice to the caller, not an action**:
nothing fetches anything, and on the NYV side nothing consumed the step at all. Note its
`samplePdfLinks` come from `CaselawDocOut.pdfLink`, which for HC is the **unusable relative path**;
the usable value is the sibling `s3Path` field.

### After (this change)

**New:** `src/services/nv-nys-judgment-fulltext.ts` — `fetchJudgmentFullText()` joins the two hops
(Athena resolve → S3 extract), reusing the existing `nysKnowledgeRequest()` client and
`normalizeNysAthenaSearchBody()`; no second client was introduced. It defaults `archive` to `sc`,
forces the scope back on after normalisation (so an unknown value cannot silently become the
~1.6 GB SC ∪ HC union), maps NYS status codes to `TOO_LARGE` / `NOT_FOUND` / `NO_TEXT` /
`BAD_REQUEST` / `UPSTREAM`, returns alternates for disambiguation, and **rejects a DC directory
prefix locally without spending an upstream call**. Also exports a deliberately conservative
`isFullJudgmentTextRequest()`.

**New route:** `POST /api/nv/knowledge/judgments/full-text` in `nv-knowledge-plane-routes.ts`
(behind the same `dualSdkOrJwt` + `partnerIndiaScopeMiddleware` + `flagOr503` stack as its
siblings). Body `{ s3Path? | query?, archive?, year?, court?, title?, maxChars? }`.

**New MCP tool:** `nys_judgment_full_text`, registered in `nv-mcp-tools-registry.ts`, added to
`EXECUTABLE_MCP_TOOL_IDS` and `DELEGATED_MCP_TOOL_IDS`, handler in `nv-mcp-legal-delegate.ts`,
mapped to `intelligence.precedent` in `nv-agent-tool-bridge.ts`. Agent responses truncate at 120k
chars by default so a 500k-char body cannot blow the context window.

**New SDK method:** `KnowledgeApi.judgmentFullText()`.

### On-demand is preserved by construction

Nothing invokes this implicitly. It is **not** in `autoRagRetrieve`, not in the Queen/orchestrate
grounding path, and not in `/retrieve`. Default grounding still uses the headnote
(`nv-nys-knowledge-retriever.ts` → `description`). Given HC scope costs ~$0.007/query and bodies run
to hundreds of thousands of characters, pulling this into default context would be both wrong and
expensive. `isFullJudgmentTextRequest()` is exported for a future explicit routing decision but is
**not** wired to auto-trigger a fetch — that would need a deliberate call in
`nv-auto-rag-router.ts`, which is owned by another agent right now (see §8).

---

## 8. Known defects and open items (not fixed here)

1. **20 MB cap excludes landmark SC judgments** — Kesavananda (35.8 MB) and Maneka Gandhi (60.9 MB)
   both `413`. Fixing this is an NYS-side change (raise `MAX_ARCHIVE_PDF_BYTES`, or stream/page the
   PDF, or pre-split volume extracts into per-judgment PDFs) plus a deploy. **Recommended:** page-range
   extraction, since these are volume extracts and the cap is protecting memory, not correctness.
2. **Client SDK `getArchiveDocument()` / `archiveDocumentStatus()` are broken** — they send
   `archiveId`/`id`; NYS wants `s3Path`. Guaranteed `400`. Not fixed here to keep this change
   reviewable; the fix is a param rename in `KnowledgeApi.ts` + an SDK minor bump.
3. **HC scope cost** — the `LIKE`-based predicate defeats row-group pruning. A `year=`-first
   pre-filter or an FTS/`cnr` lookup instead of `LIKE` would cut ~1.3 GB per query to near zero.
4. **`ATHENA_TABLE_US` is configured but dead** — `athenaConfig()` never reads it, so
   `judgments_meta_us` is unreachable through the API.
5. **`archive-fulltext-hint.samplePdfLinks` emits unusable HC relative paths** — should emit `s3Path`.
6. **`pdf_text_cache` is dead** (0 rows, wrong DB). Candidate for removal from `rds-ddl.ts`.
7. **Requested edit deferred (file owned by another agent):** `nv-auto-rag-router.ts` comment at
   line ~91 says citation is null on "~99.8% of the corpus" — measured value is **99.831%**
   (44,470 / 26,259,225 populated). Accurate enough; no edit needed. If full-text auto-routing is
   ever wanted on the RAG path, that is the file to touch, and it should remain opt-in.

---

## 9. Reproducing this

Probe scripts (host-local; API key read from `/proc/<pid>/environ`, never printed — length only):

| Script | Purpose |
|---|---|
| `scripts/_nys-ssm-run.sh` | SSM runner targeting the NYS host (mirrors `nv-ec2-ssm-run.sh`) |
| `scripts/_ec2-nys-athena-probe2.sh` | env/config discovery |
| `scripts/_ec2-nys-citation-inventory.sh` | the decisive citation + field-population query |
| `scripts/_ec2-nys-athena-e2e.sh` | first end-to-end run |
| `scripts/_ec2-nys-athena-tiers.sh` | per-tier extraction + cache + cost |
| `scripts/_ec2-nys-athena-ddl.sh` | Athena DDL / partitioning / pruning |
| `scripts/_ec2-nys-fulltext-contract.sh` | replay of the exact two-hop sequence the new service issues |

**Instrument-validation note.** Two probes failed *as instruments* before producing anything real,
and both looked like platform faults: `ECONNREFUSED 127.0.0.1:5432` (SSM shell has no DB env) and
`relation "judgments" does not exist` (connected to the **app DB** via `DATABASE_URL` — the caselaw
corpus is a *different* Postgres reached through the RDS managed master secret). Every probe here
carries `PC1_ECHO=5150` and a DB/Athena `SELECT 5150` control; if a control is missing, the command
failed, not the platform.
