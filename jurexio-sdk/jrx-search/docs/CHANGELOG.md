# NYS Knowledgesearch — Changelog

All notable changes to this project. Newest first. Keep this file updated with every merged task or significant change.

## [Unreleased]

### Added — Nyayasearch CNR/diary dashboard Ph0–4 LIVE (2026-09-04T04:20:00Z)

- **Deploy:** API md5 `1021a81b8aadcb03696fb076815603f1`, frontend `d440cdf1a2b371611cbedf9cea5c94c6`; accept probe SSM `863ca44e`.
- **Phase 1:** `CaseTimeline`, `CaseDocumentsPanel` + presign refresh.
- **Phase 2 (partial):** SC/DC Athena CTAS scripts; multi-table case_details cold path; HC verify OK; SC/DC IAM blocked.
- **Phase 3–4:** `options.live`, `nv-ecourts-portal-fetch.ts`, write-through on live hit; ecourts key absent on worker.

### Added — Nyayasearch dashboard Case Lookup (Phase 0, 2026-09-04T03:25:00Z)

- Routes `/case-lookup` and `/case/:cnr`; sidebar **Case Lookup**; same-origin `/api/cnr/resolve` + `/api/cnr/:cnr` with **`profile=caseCreate`**.
- Components: `CaseLookup`, `CaseDetail`, `CorpusSourceBadge`, `CnrCandidatePicker`, `lib/cnrApi.ts`, `lib/cnrTypes.ts`.
- Superseded local build md5 `b17146af` — production deploy above.

### Fixed — Caselaw search fail-soft under embed/backfill load (2026-08-21T08:40:00Z)

- `searchRdsJudgments` (`rdsCaselaw.ts`): after retry, metadata-only FTS fallback; final fallback empty degraded JSON (no HTTP 503). Deployed worker `index.mjs` md5 `a5c3f916aaf0bbfc5a12d37b2cf15d8e`.
- `POST /athena/extract` with `structure=true`: adds `parasMeta.parasUnavailableReason` when pre-~2000 SCR volumes have no numbered paragraphs.

## 2026-08-20 — CNR case-create profile (P0–P2) — **DEPLOYED**

- **Worker:** `index.mjs` md5 `54470c0d5bdb11aa6f83857b45fb9b20` (upload-deploy 2026-08-20T16:10Z).
- **Gateway:** NYV `2026-08-20T1610Z-aws-ssm` / sha `ee541ca1`.
- **Live smoke (worker, CNR `RJHC010324382023`):** `caseCreate=yes`, timeline 2 rows, title + manifest OK.

- **`POST /cnr/resolve`** — `options.profile: "caseCreate"` returns `data.caseCreate`
  (header, timeline, clients, opposing parties, summary, `fieldManifest`) and optional
  `data.extractPreview` from judgment PDF extract.
- **Athena cold path** — `ATHENA_TABLE_HC_CASE_DETAILS` queries public HC
  `metadata/parquet_case_details` when RDS `cnr_case_details` is missing or thin; async
  write-through to RDS (no wait for `nys-cnr-index-sync`).
- **Files:** `src/lib/cnrCaseCreate.ts`, `src/lib/cnrResolve.ts`, `src/routes/cnr.ts`,
  `src/__tests__/cnr-case-create.test.ts`, `scripts/athena-hc-case-details-ctas.mjs`.

## 2026-08-20 — Structured judgment payload, search pagination/filters, and the bare-numeric latency root cause — NOT DEPLOYED

Three partner asks (NSP NYV-3/4/5). New `src/lib/judgmentStructure.ts`; changes in
`src/routes/athena.ts`, `src/routes/caselaw.ts`, `src/lib/rdsCaselaw.ts`.

### `NYS-JUDGMENT-STRUCTURE-001` — `paras[]` with real paragraph numbers, and an honest gap

NSP's floor ask: paragraph-citable judgments, with an explicit prohibition on synthesis (they
deleted a sentence-splitting "Key Holdings" panel in their FB-206 rather than keep a plausible
guess). Opt-in via `structure: true` on `POST /athena/extract`.

**The central finding is a class of judgments for which the correct answer is `paras: []`.**
Pre-~2000 Supreme Court Reports volumes **do not number their paragraphs at all** — the body is
unnumbered prose with marginal letters A–G for pinpoint citation. Confirmed on real extracted text:
in Maneka Gandhi [1978] 2 SCR 621 and Kesavananda Bharati [1973] 1 SCR 1 every line-initial number
is a year (`1967. On the 4th of July 1977…`), an Article number (`368. It is determinative of…`), a
quoted enactment clause, or a footnote marker (`(1) [1967] 3 S.C.R. 525`). Both return `paras: []`
with `numbering: 'ambiguous'` and a note saying no numbers were inferred. **Modern volumes are
complete:** [2026] 3 SCR 525 returns **1..68 contiguous**, cross-validated against the reporter's
own `[Para 37]` headnote reference.

**Measured on 12 real reporter volumes (1950–2026) pulled from the owned S3 estate and run through
the production extractor** — 2012→199, 2020→139, 2024→**776 across 6 opinions**, 2025→258, 2026→68;
**1,491 paragraphs, 0 fabricated** (every `n` verified to exist literally as a line-initial marker
in its own source). Extraction reproduced the documented sizes exactly: Kesavananda 1,006 pp /
2,878,447 chars, Maneka 156 pp / 529,765 chars.

**Four gates prevent fabrication; every threshold is measured, not chosen.**

| Gate | Why it exists |
|---|---|
| strictly-+1 ascending chain | years and Article numbers cannot form one |
| min density 2.0 lines/para | the authorities list in [2025] 1 SCR 1782 (`4. Bennion on Statutory Interpretation` / `5. (2022) 2 SCC 401`) is a *perfect* +1 chain of 8; only spacing separates it from prose |
| **20 % body coverage** | measured population gap: real numbering covers 26.9–98.6 % of the body, every false candidate 0–6.1 % |
| first paragraph ≤ 12 | rejects a quoted prior order internally numbered 22..27 |

**Locating the body is a correctness requirement, not a refinement.** In [1980] 3 SCR 383 the
*headnote* prints `HELD : 1.` … `15.` — a genuine +1 chain with prose-like spacing that no local
test can reject. Those entries number HOLDINGS (each ends in a reporter page ref such as
`[393 C-D]`), so emitting them would give counsel a "para 14" citing the reporter's summary rather
than the Court. Markers are therefore read from the body only.

**Multi-opinion numbering stays separate.** Indian judgments restart at 1 per concurring/dissenting
opinion, so `n` alone is ambiguous; each paragraph carries `opinionIndex` plus the authoring judge
as printed. Load-bearing: with the restart rule disabled, Kesavananda's separate quoted-clause lists
fuse into one 61-"paragraph" chain and a judgment with no numbering starts reporting 61 of them.

**`ratio`/`obiter` are always reported unavailable.** No Indian format delimits them, and a keyword
or sentence-position guess is exactly FB-206. `headnote`/`held`/`facts`/`issues`/`disposition` are
returned only where the reporter typeset a caption, so they are quotations. Every response carries
`extractedFields` and `unavailableFields`.

**What the corpus can and cannot answer:** `coram` yes (bracketed bench line);
`parallelCitations` yes but **SC-only** (`citation` is 43,505/43,505 SC and **0** of 20.4M HC /
5.7M DC); `appealedFrom` yes where a "Case Arising From" block exists; **`appealedTo` never** (a
judgment does not state where an appeal from it goes); **`author_judge` never** (empty in every row
of every tier, so it is declared unsupported rather than offered as a filter matching nothing).

Parsing runs per request over the cached text and is **not** persisted into `archive_extracts`:
2.88M chars parse in ~40 ms against a ~2.7 s cold extract, so pre-computing wins little while
changing a stored shape that already has live rows would pin future parser fixes behind a migration.

### `NYS-CASELAW-SEARCH-LATENCY-001` — reproduced, and the suspected cause disproved

NSP measured `IPC 302` 0.107 s vs `302` 13.995 s. The ratio is real; the cause is **not** an
unselective FTS match. `302` matches only **11,545 of 26.26M** rows and the GIN scan costs
**3.3 ms**. `EXPLAIN (ANALYZE, BUFFERS)` shows the cost is the bitmap heap fetch of the ranking
candidate window over a **281 GB** table against **~3.9 GB `shared_buffers`** (~1.4 % cacheable):

| query | candidates | blocks read | exec |
|---|---|---|---|
| `bail` | 10,000 | 7,015 | 1,526 ms |
| `bail` | 2,000 | 3,435 | 735 ms |
| `bail` | 500 | 295 | 63 ms |

The 130× ratio is just whether a query reaches the cap — `IPC 302` matches 1,429 rows and never
does. **Ranking fewer candidates costs no precision:** the inner scan has no `ORDER BY`, so GIN
returns physical order and the 10,000 were already an *arbitrary* subset, not the best-ranked rows.
Window is now `(limit+offset)×20` clamped 400..2,000; `COUNT_CAP` 10,000→1,000 (the count re-runs
the same heap scan and was doubling the I/O).

**Before → after: `bail` 4,090 ms → 31 ms (70× less I/O), `302` 44 ms → 11 ms**; selective queries
unchanged (`BNS 103` 1.0×, `murder` 1.1×).

### `NYS-CASELAW-SEARCH-FILTERS-001` — pagination and filters, with the gaps named

Added `offset`, `yearFrom`/`yearTo`, `dateFrom`/`dateTo`, `judge`, `reporter`, `benchStrength`,
`sort=relevance|date`, and a machine-readable `filterSupport` block stating each filter's real
coverage.

**`benchStrength` is honestly derivable, against expectation** — HC `bench_name` carries literal
`Single` / `Single Bench` / `Division` / `Division Bench`. It is offered **HC-only and refuses
elsewhere**, because the same column holds a district name ("Kadapa", "Guntur") for DC rows.

**`total` is never an estimate** — exact below the 1,000 cap, an explicitly-labelled
`totalIsLowerBound` above it. A planner estimate was measured and **rejected as unpublishable**:
`murder` 33,330 estimated vs 497 actual (67× high), `IPC 302` 42 vs 1,429 (34× low). RRF cannot be
paginated by slicing one leg, so `offset>0` is served by the FTS leg and `method` reports which leg
answered.

### `NYS-SEARCH-SLO-001` — published contract at `GET /caselaw/search/slo`

Caselaw p50 150 ms / p99 2 s / client timeout 30 s. Statutes p50 500 ms / p99 6 s / timeout 30 s.
The p99s are much looser than the warm measurements because cache residency dominates, not the
plan: the same `302` query measured 27 ms warm and **16,756 ms cold**. The statutes p99 is set by a
**separate, still-open** bare-numeric outlier (`302` 5.9 s warm over HTTP) — published rather than
hidden behind a median.

### Verification

Parser suite **18/18**; **10/10 mutations RED, no green survivors**, plus a deliberate anchor-miss
control proving the harness fails loudly. Two mutations changed the code: a jurisdiction-block
anchor was **deleted** after mutation showed it altered no verdict on any of the 12 volumes, and the
page-furniture probe **found a real defect** — 13 of 68 paragraphs in [2026] 3 SCR 525 carried an
interleaved running header, now 0. `pnpm typecheck` holds at the pre-existing 5 errors in
`rdsCaselaw.ts`/`patra-mitra.ts`, none added. No deploy.

## 2026-08-19 — Large reporter-volume PDFs are extractable (`NYS-ARCHIVE-LARGE-PDF-001`) — NOT DEPLOYED

`POST /athena/extract` rejected the most-cited judgments in Indian constitutional law with `413`:
Kesavananda Bharati (35.8 MB) and Maneka Gandhi (60.9 MB), while routine judgments extracted fine.
Supreme Court PDFs are reporter-volume extracts, so the landmark authorities are the largest objects
in the estate and a flat byte cap excluded exactly them.

**Page-range extraction was measured and rejected as a no-op.** `1978_2_621_776` does encode
pp. 621–776, but the object already contains only those **156 pages** — it is 60.9 MB because the
pages are heavy scans, not because it holds a whole volume.

**The size/cost correlation is inverted, and that is why the byte cap was the wrong instrument.**
Maneka Gandhi (63,851,267 B, 156 pp) extracts in **3,696 ms**; Kesavananda (37,514,544 B, **1,006 pp**)
in **17,579 ms** — measured on the caselaw worker. Cost tracks **page count**, not bytes.

- **`extractPdfTextLayer()` (new, `lib/extractDocText.ts`) replaces `unpdf.extractText()`** for PDFs.
  unpdf fans `Promise.all` across every page and never calls `page.cleanup()`, so a 1,006-page volume
  holds every page's parsed text content resident at once. Sequential read + `cleanup()` cut peak RSS
  **408.5 → 318.4 MB** and made the pass interruptible, enabling budgets of **2,000 pages / 40 s**
  (both inside the 60 s the NYV client allows). A budget hit returns the pages read plus an explicit
  `[Note: text extracted from the first N of M pages …]` and `truncated: true`.
- **`MAX_ARCHIVE_PDF_BYTES` 20 → 96 MB**, from the corpus not a guess: all **176,997** SC PDFs have
  p99.9 9.29 MB and **max 68.79 MB**; 20 MB excluded 43 objects, 80 MB+ excludes zero.
- **`MAX_EXTRACT_TEXT_CHARS` 500,000 → 4,000,000.** Kesavananda yields **3,200,322** chars, so the old
  limit would have returned its first 16% and called it the judgment. Maneka Gandhi's 529,765 chars
  also exceeded it.
- **Heavy-extraction gate (this, not the cap, is the OOM guard).** PDFs >10 MB (just above corpus
  p99.9) are admitted **2 at a time**: the worker has 2 vCPU and pdf.js extraction is CPU-bound, so a
  third in flight would push all three past the caller timeout while tripling peak RSS. Saturation
  waits 20 s then returns **`503` + `Retry-After: 30`** (`ArchiveDocBusyError`), never a hang. Applied
  to both `/athena/extract` and `/chat/conversations/:id/documents/from-archive`.
- **`truncated`** added to the extract response and to `AthenaExtractResult` in `openapi.yaml`, along
  with the `503`. A cached row derives it from the stored `[Note: …]` marker, so warm reads report it too.
- **No async/queued path is needed:** worst measured cold extraction is 21.1 s inside a 60 s budget,
  and `archive_extracts` makes it once-per-judgment-ever (cold 2,693 ms → warm 13 ms).

**Host headroom measured, not inferred** (`i-000115b19219bb766`, systemd `nyv-api.service`): 7,823 MB
RAM / 6,866 MB available, `MemoryMax=infinity`, node v20.20.2 with a **2,096 MB** V8 heap limit, API
process at 271 MB RSS beside 4 embed workers. The landmarks peaked at **432.9 MB** and **451.4 MB**
RSS (~21% of the heap ceiling) and the service stayed `active` throughout.

**Verified live against the real S3 objects** (byte sizes asserted against `HeadObject` first):
Kesavananda Bharati `S_1973_1_1_1002_EN.pdf` → **2,878,447 chars in 8,427 ms**, text running from the
bench line to the signature block; Maneka Gandhi `1978_2_621_776_EN.pdf` → **529,765 chars in 998 ms**.
The 488 KB control still yields 33,644 chars, byte-identical to before. Budget enforcement proven by
re-running the 1,006-page volume at `maxPages: 25`: stopped at exactly 25 with the note present.

Tests: `archive-extract.test.ts` **21/21** (cap assertions now derive from `MAX_ARCHIVE_PDF_BYTES` and
pin both landmark byte sizes plus the 68.79 MB corpus max); new `pdf-text-layer-budget.test.ts`
**6/6**, including `maxConcurrentOpen === 1` so reintroducing the `Promise.all` fan-out fails a test.

**NOT DEPLOYED — unverified until it is:** the `503`/`Retry-After` over the wire, the `truncated` field
on the JSON payload, and an `archive_extracts` round-trip for a multi-MB body on the real app DB (the
scratch DB accepted 3.2 M chars). Against the currently deployed NYS both landmarks still `413`.

## 2026-08-14 — Statute compare aliases (LIVE 2026-08-15)

- `GET /statutes/compare/old-new?from=` now accepts `CRPC` and `IRPC` as aliases of `CrPC` (RDS stores `CRPC`; API enum was `CrPC` only → 400).
- Live RDS check (caselaw-worker): 97,861 statutes; IPC 302 → BNS 103; CrPC 438 → BNSS 482. Corpus/embeddings intact. Mapping breakage on NSP was NYV Queen+FAQ rewrite, not NYS data.
- **Deployed** `index.mjs` md5 `e2edf3bb976077d34cf31eedf63ed934`; `nyv-api` active, health 200. Verified via NYV proxy: `from=IRPC&section=438` → 200 BNSS 482 in 61ms.
- Dashboard compare still requires a session cookie (`AUTH_REQUIRED`); unauthenticated public GET remains 401 by design.

## 2026-08-10 — District Open Data AP+TG GO deploy

- Deployed API `d5a94f97` + `ingest-rds` `df250f59` + updated `apply-cnr-ddl` (CHECK allows `dc` alongside `us-fed`/`us-ny`, NOT VALID).
- Ingested AP+TG 2024–2026 (~2.1M `dc` rows); historical `dc 1987–2023` running under `/opt/nyv/ingest-dc.log`.
- Smoke: CNR `TSWL000000742024` → found / nys_rds / sourceArchive dc via partner API.
- DC ingest reads public HTTPS `cases.parquet` (no S3 ListBucket on Open Data bucket).

## 2026-08-09 — District Open Data → RDS (AP + Telangana)

- Extended `judgments.court_type` CHECK to include `dc` (`rds-ddl.ts` + `apply-cnr-ddl.mjs` ALTER).
- `ingest-rds.ts`: modes `dc` / `delta-dc`; bucket `indian-district-court-judgments`; state filter **2 (Andhra Pradesh)** + **29 (Telangana)**; maps parquet `cino` → `cnr`.
- Background: `nys-cnr-index-sync.mjs` / `weekly-india-refresh.mjs` `ingest-rds delta` now refreshes DC current+previous year.
- CNR resolve documents: `sourceArchive: "dc"`.
- **Pending GO:** apply DDL on worker + backfill `node ingest-rds.mjs dc <start> <end>` (years ~1987–2026 available for TG).

## 2026-08-09 — CNR corpus resolve (Phases A + D) — GO deploy

- Added `POST /api/cnr/resolve`, `GET /api/cnr/:cnr`, `/documents`, `POST /api/cnr/enrich`.
- Cascade: RDS exact CNR → Athena Open Data parquet → FTS suggestions; always `claimEcourts: false`.
- RDS DDL applied: `cnr_case_details`, `cnr_resolve_metrics`, `judgments_cnr_upper_idx` (~20.5M judgments with CNR).
- Ingest scripts installed: `ingest-cnr-case-details.mjs`, `nys-cnr-index-sync.mjs`.
- **Deployed** `index.mjs` md5 `881e38f08feadeb18e9ca060fbaf28ea`; probe `found`/`nys_rds` ~40ms for sample HC CNR.
- Hotfix: exact `WHERE cnr = $1` only (OR upper/btrim timed out).

## 2026-08-08 — Patra Mitra (document companion) — GO deploy

- Added **Patra Mitra** nav item + page `/patra-mitra` (upload any PDF/DOCX/image → fields, summary, ask-document chat).
- BFF `/api/patra-mitra/*` proxies to NYV Patra Mitra when `NYV_API_BASE_URL` + SDK key are set; otherwise local OCR extract + model-call fallback.
- Brand: Parse · Understand · Ask (Nyayasiddhi Knowledge).
- **Deployed** to `nyv-caselaw-worker`: API `index.mjs` md5 `a1a518f19eaa8752f27242e82141e2e6`; frontend `public.tgz` md5 `78c6091bd836a4420c72e7d9a1a54e7c` (`index-Wg2L5fBW.js`); `/patra-mitra` **200**.
- Worker env: `NYV_API_BASE_URL` + `NYV_SDK_KEY` **SET** → BFF mode NYV proxy. Authed smoke: health Patra Mitra; session `pm_*` NDA; chat parties+fee PASS.
- BFF fix: proxy `content` as well as `base64`; send `X-NYV-Consent: granted`.

## 2026-07-25 — Caselaw-worker API bundle deploy (GO)

- Built and deployed the `artifacts/api-server` bundle to EC2 `nyv-caselaw-worker` (`i-000115b19219bb766`) via content-addressed S3 manifest (`nyv-sdk-distribution/caselaw-worker/api`) + SSM `AWS-RunShellScript`.
- Deployed `index.mjs` md5 `b557377c807f1c6d1d485fdcc6013019`; worker healthz 200, systemd `nyv-api` restarted cleanly.
- Also installed scripts: `embed-corpus.mjs`, `embed-statutes.mjs`, `ingest-rds.mjs`, `audit-coverage.mjs` with md5 verification.

## 2026-07-16 — Court-tier templates reseed + Console-aligned frontend (GO)

- Reseeded `nyvapp.templates` → **575** (IN **304** · US **271**); court tags SC6 / HC6 / District9 / Contractual6; Tier1=7 · Tier2=12 · Tier3=8.
- Frontend deploy `public.tgz` md5 `0882988afa2f99653463b32fd11fe623` — Court/Tier filters, Nyayasiddhi Knowledge brand (navy/gold); `nyayasearch` **200**.
- Provenance: rules/practice-aligned final instruments (not government-sealed PDFs).

## 2026-07-15 — India Code drained + caselaw accelerate + Console sign-off

- India Code **pending=0** (823 done / 18 pdf / 1 no-sections / 3 skipped); statute embed remains **100%**.
- Caselaw embed loop accelerated (HC 50k×100 / ALL 25k×100); HC ~105.5k; overall ~2.55%.
- Console browser: Knowledge Plane hub PLANE ON + statute SLO OK + statutes probe PASS; NYS Knowledge Workbench 97,861 / SLO ok.

## 2026-07-14 — Gap close-out (embed 100% + persistent loops)

- Statute embed coverage **100%** (`unembedded=0`, SLO ok); indexes valid.
- Enabled systemd: `nyv-embed-statutes-loop`, `nyv-india-longtail`, `nyv-caselaw-embed-loop` (HC→ALL).
- Authed smokes 200: statutes/caselaw/templates/Athena/coverage/stats; India pending ~323 draining.
- Repo script: `scripts/nv-caselaw-embed-loop.sh`.

## 2026-07-14 — Filing-ready templates + knowledge dashboard

- Generated/merged **16** multi-party filing instruments; prod templates **530**.
- Dashboard: Knowledge corpus panel; removed model breakdown UI; public static redeployed.
- NYV agents: `/api/nv/knowledge/search` uses `nys_global`; orchestrate cites BNS 103 + SHA template guidance.

## 2026-07-14 — Corpus status (USC near-complete + India long-tail)

- Live `nyvapp` statutes **97,861** (IN 38,130 · US **59,731** / **53** USC titles); embed **~91.9%** catching up.
- India Code progress **285 done / 538 pending**; long-tail `--limit 400` resumed on worker.
- Templates **514** / tasks **228** unchanged. Search smoke IN+US **200** `hybrid_rrf`.
- Fixed orchestrator embed spawn (`stdio append` → bash redirect).

## 2026-07-14 — Parallel statute fill (USC pack + India priority + embed fix)

- **USC priority pack complete** on worker: US statutes **~18k → 37.7k+** sections (Titles 5/8–12/15/17–22/26/28–29/31/35/38/41–42/47/49–50 + wave2 remaining titles).
- **India Code priority** continuing (~28/85 done; Companies, Competition, GST, DPDP, Designs, …); PDF fallback batch 18 acts.
- **Embed fix:** `embed-statutes.mjs` args are `[maxRows] [batchSize]` — `--null-only` caused `NaN` and `done:0`. Catch-up + `scripts/nv-embed-null-loop.sh` use numeric args and single-flight.

## 2026-07-14 — Statute ingest worker (India Code + USC titles) on EC2

- Shipped `ingest-india-code.mjs` / `ingest-usc-titles.mjs` / `nv-statute-ingest-worker.mjs` + `nyv-statute-ingest.service` to caselaw worker.
- USC Title 8 preflight: **316** sections; India Code priority ingest running (844 acts enumerated, resumable progress table).
- Post-load: FTS rebuild, ANALYZE, embed NULL rows; indexes validated during search smokes (`hybrid_rrf`).

## 2026-07-14 — Deep IN/US catalog + prod reseed (514 templates / 228 tasks)
- **Catalog generator:** `artifacts/api-server/scripts/generate-nys-catalog-expansion.mjs` — draft, research, checklist, amendment/order tracker per practice area (IN+US).
- **Prod `nyvapp`:** templates **70 → 514** (IN 251 · US 263); legal_tasks **180 → 228** (IN 60 · US 78 · GLOBAL 90).
- **Integrity:** `EXPECTED_TASK_COUNT` → 228; `seed` + `seed-templates` added to `build.mjs`.

## 2026-07-14 — Template & task library expansion (US parity + IN tasks)
- **Templates**: US library expanded 23 → 59 (all 17 practice-area categories); merge via `data/seed-templates-us-expansion*.json` + `scripts/merge-nys-seed-expansions.mjs`.
- **Legal tasks**: IN-tagged seeds 0 → 36 (12 legacy rows recategorized + 24 new India practice tasks); `EXPECTED_TASK_COUNT` 144 → 180.
- **Integrity**: fixed invalid category slugs on legacy IN task rows; `us-tax-controversy-intake` moved to `compliance` category.
- **Reload**: `pnpm --filter @workspace/api-server run seed` + `seed:templates`; validate with `pnpm run check:seeds` (requires `DATABASE_URL`).

## 2026-07-14 — NYS UX optimizations (hybrid search, locale, Open Data scaffold)
- **Caselaw**: `mode=hybrid|fts` documented in OpenAPI; India Caselaw Search UI adds power-user hybrid toggle and result method badge.
- **Dashboard**: India semantic readiness labels on embedding cards; citation + litigation Open Data analytics sections (`GET /analytics/citations`, `/analytics/litigation`) with honest empty states.
- **Reserved jurisdictions**: unified `ReservedJurisdictionNotice` on New Run, Runs, and Dashboard analytics.
- **Locale**: `locale` / `language` on run + chat APIs; pass-through prompt hint (no translation engine).
- **Multimodal**: OpenAPI + Legal Chat accept PDF/DOCX/TXT/MD and image types; server OCR for PNG/JPEG/WebP uploads.

- `embed-corpus` no longer runs `SELECT count(*) … WHERE embedding IS NOT NULL` (multi-minute stall + lock contention with ingest). Uses `embed_progress` checkpoint + resumes `last_id`.
- Ops: do not run embed and `ingest-rds delta` concurrently; delta partitions hit statement_timeout under dual load.

## 2026-07-14 — India P0: delta ingest + embed relaunch + amendment stale flag
- `ingest-rds delta|delta-sc|delta-hc`: clears current+previous year `ingest_progress` checkpoints and re-reads Open Data parquet (ON CONFLICT DO NOTHING for new rows). First prod run cleared 94 partitions (2025–2026).
- `scripts/weekly-india-refresh.mjs` installed on worker for EventBridge/SSM weekly schedule.
- `ingest:indiacode:refresh:stale` (`--force-stale-days 90`) reopens old `done` acts for amendment reconcile.
- Retrieve plan: `archive-fulltext-hint` for IN generative/precedent (full text via Athena, not RDS).
- Caselaw `embed-corpus` relaunched as `nyv-embed` systemd unit with `EnvironmentFile` (bash `source .env` breaks on `$` in DATABASE_URL).

## 2026-07-14 — Stats SWR + caselaw hybrid RRF + embed SLOs + NYV SSO secret
- Deployed api-server (`upload-deploy.mjs --deploy`, md5 `5037d22a`): `caselaw/stats` 60s route cache + skip US probe; `rdsStats` stale-while-revalidate + cold `pg_class` approx (live smoke ~0.4s / cache HIT).
- Caselaw search default `mode=hybrid` → FTS+vector RRF (`method=hybrid_rrf`); degrades to `fts` when vector empty.
- `GET /caselaw/embedding/coverage` SLO (target 99%); `GET /statutes/embedding/coverage` SLO (statutes live **100%**).
- Set shared `NYS_SSO_LAUNCH_SECRET` for NYV Console → `/api/auth/sso/callback` handoff.
- **Open:** caselaw embedding coverage ~2.3% (SLO critical) — continue `embed:corpus` backfill.

## 2026-07-10 — Task #117: Shipped the embedding-coverage safety net (#112) to production
- Standard prod deploy of the current api-server bundle (`build.mjs` → `upload-deploy.mjs --deploy`, content-addressed + md5-verified, `nyv-api` restarted, health 200).
- Prod smoke: `GET /api/statutes/retrieve` and `/api/statutes/search` now return the live `embeddingCoverage` object (`total`/`embedded`/`unembedded`/`coveragePct`) at 100% — 56,209/56,209 rows embedded (Titan v2), unembedded 0, so no worker embedder relaunch was needed.
- Deploy surfaced a prod schema drift: the prod `nyvapp.statutes` table was missing the newer act-metadata columns (`department`, `source_act_id`) that the current Drizzle schema selects, so `/statutes/{search,retrieve}` had begun returning 500 "Failed query" (the prod app DB has no Drizzle-migration infra). Fixed by applying the idempotent `STATUTES_DDL` (`ADD COLUMN IF NOT EXISTS` + FTS/HNSW indexes) to prod via a `pg` client on the worker — data untouched, 56,209 rows preserved.
- Product Note row #112 flipped from "dev (prod deploy pending)" to "dev + prod (shipped 2026-07-10)".

## 2026-07-09 — Task #113: Dev-DB drift guard — `check:devdata` + embedding coverage in the test pre-flight
- New verification-only command `pnpm --filter @workspace/api-server run check:devdata` (`src/check-devdata.ts`): checks legal_tasks jurisdiction distribution vs `data/seed-tasks.json`, seeded templates distribution vs `data/seed-templates.json`, core statutes per-code counts, and 100% statutes embedding coverage. Prints a one-line `→ fix:` remediation command per failed check and exits 1 on drift; never mutates the DB.
- Check logic extracted into shared `src/lib/devDataIntegrity.ts` and the vitest globalSetup pre-flight rewired onto it, so the standalone check and the test-run self-healer can never diverge. The pre-flight now ALSO guards embedding coverage: NULL statute embeddings (the drift that silently degraded hybrid retrieval to keyword-only) trigger an automatic `embed:statutes` run before suites — except under `AI_PROVIDER=bedrock`, where it fails with the remediation printed instead of spending paid embedding calls. Embedding check runs after the seed heals so freshly reseeded rows get embedded too.
- Caught real drift on landing: dev tasks had reverted to all-GLOBAL and 0/2,279 statutes were embedded; `check:devdata` flagged both with exact fix commands, the pre-flight self-healed, and the full api-server suite ran green (30 files / 393 tests). Typecheck green.

## 2026-07-09 — Task #112: Statute embedding-coverage drift is now loud and visible
- Hybrid statute search silently weakened whenever newly seeded/ingested rows had NULL embeddings (the vector leg skips them until `embed:statutes` re-runs) — during Task #105 verification the entire dev corpus turned out to be unembedded with no visible signal.
- New corpus-wide coverage check (`getStatuteEmbeddingCoverage`, 60s cache): `GET /statutes/search` and `GET /statutes/retrieve` now return an `embeddingCoverage` object (`total`/`embedded`/`unembedded`/`coveragePct`), and both search paths log a warn with the exact fix command whenever `unembedded > 0`.
- Every statute data loader (`seed:statutes`, `seed:constitution`, `ingest:indiacode`, `ingest:indiacode-pdf`, prod `load-statutes-appdb`) now ends with a shared `warnIfUnembeddedStatutes` check: loud "ACTION REQUIRED … run embed:statutes" warning on drift, 100%-coverage info line otherwise (handles the missing-embedding-column fresh-DB case).
- OpenAPI: new `StatuteEmbeddingCoverage` schema, required on both search responses; codegen re-run. PROJECT-TRACKER §4 ship gate now requires verifying embedding coverage after any statute data load.
- Verified: typecheck green; new coverage regression test in `statutes-rrf-fusion.test.ts` (7/7); curl e2e on both endpoints shows live coverage metadata (dev corpus currently 0% embedded — the exact drift this makes visible).

## 2026-07-09 — Task #110: Test pre-flight now also guards templates and core-statutes seeds
- Extended the vitest globalSetup pre-flight (Task #98) beyond `legal_tasks`: it now also verifies the seeded templates library (per-jurisdiction counts of `is_custom=false` rows vs `data/seed-templates.json`, IN 47 / US 23) and the core statutes seed (per-code counts BNS 358 / BNSS 531 / BSA 170 / IPC 521 / CrPC 510 / IEA 181 / USC 8 from `EXPECTED_COUNTS`).
- On mismatch it loudly runs the matching seeder (`seed:templates` / `seed:statutes`). Custom (`is_custom=true`) templates are never touched; the statutes check deliberately ignores COI and the India Code corpus (expensive to rebuild; `seed:statutes` only replaces its own codes).
- Verified: simulated drift (deleted 35 seeded templates + 100 BNS rows, inserted a custom template) → full suite self-healed and ran green (29 files / 387 tests); counts restored exactly and the custom template survived. Typecheck green.

## 2026-07-09 — Task #106: RRF fusion + distance-cutoff unit tests for hybrid statute search
- New `statutes-rrf-fusion.test.ts` (6 tests) pins the `searchStatutes` vector/RRF branch directly (the route suite only pins FTS behavior): a shared-token embedded fixture is fused in and returned first with `method=hybrid_rrf`; the cosine-distance cutoff (0.5 dev hash) excludes a noise row the KNN would otherwise surface; when every vector candidate is beyond the cutoff the search degrades to labeled `method=fts`; a thrown `embedText` (mocked, toggleable) degrades to `fts` with FTS results intact and recovers to `hybrid_rrf` on the next call (no sticky state); `total ≥ results.length` invariant.
- Fixtures use a dedicated `ZZRRF` code so both legs are scoped to suite-inserted rows, with pre-computed deterministic hash embeddings — distances verified to straddle the cutoff (~0.45 similar vs ~0.96 noise). Suite runs green on empty or fully-seeded DBs; covered by the existing `api-server-tests` validation workflow. Typecheck green.

## 2026-07-09 — Task #105: Verified meaning-based (hybrid) statute grounding in the retrieval router
- Confirmed the retrieval router's statute tool already runs through the hybrid FTS+vector path (Task #70 shipped it): `planAndRetrieve` step 3 calls `hybridSearchStatutes()` with RRF fusion, logs every decision (`retrieval router: hybrid statute retrieval` with method/count), and the deterministic-first order (citations → section lookup → code comparisons → hybrid statutes → caselaw) is intact. All grounding surfaces inherit it: `POST /runs` + `/runs/stream`, `/retrieve`, MCP router tool, and chat/draft actions.
- Live e2e proof: paraphrased query "which statute provision covers cheating and dishonestly inducing delivery of property" (zero FTS hits) returned IPC 420 as vector rank 1 via `POST /api/retrieve` — meaning-based retrieval works without keyword overlap.
- Fixed stale dev data that was masking this: reseeded tasks (jurisdiction tags had reverted to all-GLOBAL, breaking 3 jurisdiction tests) and ran `embed:statutes` on the dev corpus (2,279 rows, hash embeddings) so the hybrid vector leg fires in dev instead of silently degrading to FTS-only. Full api-server suite 387/387 green, typecheck green.

## 2026-07-09 — Task #98: Test-run pre-flight self-heals dev-DB seed drift
- Twice (Task #87, #97) the full api-server suite failed in `jurisdiction-segregation.test.ts` because dev `legal_tasks` rows had drifted back to all-GLOBAL (144/0 instead of 90 GLOBAL / 54 US), needing a manual reseed and looking like a code regression.
- New `artifacts/api-server/vitest.config.ts` registers a `globalSetup` (`src/__tests__/globalSetup.ts`) that runs before any suite: it compares the DB's per-jurisdiction `legal_tasks` counts against `data/seed-tasks.json`; on any mismatch (or unreadable table) it logs a loud `[test pre-flight] dev DB seed drift detected` warning and runs `pnpm --filter @workspace/api-server run seed` automatically, then proceeds.
- Verified end-to-end: simulated drift (`UPDATE legal_tasks SET jurisdiction='GLOBAL'`), then the full `api-server-tests` workflow — pre-flight detected the mismatch, reseeded, and the run finished green (29 files / 387 tests). Typecheck green.

## 2026-07-09 — Task #104: Full statute corpus semantically searchable in prod (backfill complete, embedder hardened)
- Prod statute-embedding backfill **complete**: 56,209/56,209 `statutes` rows embedded with Titan v2; `statutes_embedding_hnsw` index live; job finished error-free ("statutes embedding complete", provider=bedrock).
- Root-caused the backfill's repeated silent 5-minute stalls/deaths: `bedrockEmbed` had no request timeout, so Bedrock socket drops hung the batch forever. Hardened `src/lib/embeddings.ts` (cached BedrockRuntimeClient with `maxAttempts: 5` + 5s connect / 30s request timeouts) and `src/embed-statutes.ts` (`embedWithRetry`: 45s hard timeout per call, 4 attempts with backoff). Relaunch recipe now includes a bash retry-loop wrapper so a process death auto-resumes.
- Redeployed the API bundle (the deployed prod bundle predated #95 and lacked the `method` field). Prod smoke: "stealing someones property" → `method: hybrid_rrf` with BNS 317 / IPC 410 / BNS 303 (theft/stolen-property provisions); "punishment for cheating and fraud" → `hybrid_rrf`, sensible hits; public healthz 200.
- Tests: api-server 387/387 green (dev tasks reseeded — stale all-GLOBAL seed had re-broken the 3 jurisdiction-segregation tests).

## 2026-07-09 — Task #95: Semantic (hybrid) search over the 37k-row statutes corpus (shipped to prod)
- `statutes` table gains `embedding vector(1024)`; new resumable batch embedder `pnpm --filter @workspace/api-server run embed:statutes` (keyset-paginated by id, self-provisions the pgvector extension/column, creates the HNSW index + `ANALYZE` on completion; Bedrock Titan v2 in prod, deterministic hash-embed in dev). Bundled as `embed-statutes.mjs` and installed on the worker via `upload-deploy.mjs --scripts`.
- `GET /statutes/search` is now hybrid: Postgres FTS + pgvector cosine KNN fused with Reciprocal Rank Fusion (k=60). A cosine-distance cutoff (0.8 for Titan, 0.5 for the noisier dev hash embedder) keeps KNN from polluting no-match queries — nonsense queries still return `total: 0`. Response carries a required `method` field (`hybrid_rrf` | `fts`); any vector-branch failure or unembedded corpus degrades to labeled pure FTS, never blocks search.
- Prod: pgvector extension created in `nyvapp` (RDS master via SSM), API bundle deployed (health 200), full 37k-row Titan backfill running detached on the worker (`/opt/nyv/embed-statutes.log`, resumable); prod smoke returns `method: hybrid_rrf` and no-match returns `total: 0, method: fts`.
- Tests: statutes-search route suite green with hybrid semantics (distance cutoff keeps FTS-exact totals for token fixtures); api-server 340/340; typecheck green. (Dev DB reseeded — stale all-GLOBAL task seed had re-broken the pre-existing jurisdiction-segregation tests.)

## 2026-07-09 — Task #94: 19 PDF-only central Acts ingested (incl. Income-tax Act 1961) — statutes corpus now 38,138 rows / 851 acts
- Brought the 19 central Acts India Code serves only as gazette PDFs (no HTML sections) into the statutes corpus: Income-tax Act 1961 (783 §), Wealth-tax Act 1957 (133 §), Gift-tax Act 1958 (78 §), plus 16 pre-1900 acts — 1,031 rows total.
- New PDF ingest pipeline: `pnpm --filter @workspace/api-server run ingest:indiacode-pdf` (`src/ingest-india-code-pdf.ts`) downloads the English gazette PDF bitstream, extracts text via unpdf (OCR fallback for scanned pages), and parses sections with `src/lib/pdfActParser.ts` — arrangement-of-sections parse + tiered monotone body split (handles footnote-marker gaps like `4.1[Charge…`), body-scan fallback for acts without an arrangement, and a single "Full Act" full-text row for short pre-1900 abstract-style acts with no numbered boundaries (large unparseable acts still fail loudly).
- Shared India Code helpers extracted into `src/lib/indiaCode.ts` (UA, entity/HTML handling, slugging, practice-area mapping, fetch retries, act metadata) — the HTML ingest (`ingest-india-code.ts`) now imports them instead of duplicating.
- Same 16-column act-metadata upsert as the HTML ingest; acts appear in `GET /statutes/acts` and FTS search; progress tracked in `statute_ingest_progress` (`done-pdf` status).
- Tests: new `pdf-act-parser.test.ts` (12 tests: arrangement + body-scan modes, footnote gaps, omitted-section fallback, dedupe, PDF-path picking); full api-server suite 352/352 green; typecheck green. (Dev tasks reseeded to restore jurisdiction tags — pre-existing stale seed had broken 3 jurisdiction tests.)
- **Shipped to prod**: exported the 19 acts as JSONL (Node pg script) → S3 → SSM-ran the bundled `load-statutes-appdb.mjs` on the worker (`NODE_ENV=production` required — pino-pretty transport bakes a dev path otherwise). Prod nyvapp now 38,138 rows / 851 act codes; smoke verified (Income-tax 783 §, FTS "charge of income-tax" → §4 hit).

## 2026-07-09 — Task #70: Statutes RAG — embed + hybrid retrieval over the full Indian statutes corpus
- **Statute embeddings**: added `embedding vector(1024)` to `statutes` (dev applied via direct ALTER; prod DDL carried in `statutesDdl.ts` incl. `CREATE EXTENSION IF NOT EXISTS vector`). New resumable batch embedder `pnpm --filter @workspace/api-server run embed:statutes` (`src/embed-statutes.ts`): keyset-paginated over `embedding IS NULL`, progress upserted to `statute_embed_progress`, creates the HNSW cosine index + `ANALYZE` on completion. Titan v2 on prod (`AI_PROVIDER=bedrock`), deterministic hash embeddings in dev. Dev corpus fully embedded (ingest still adding acts; embedder re-runs pick up new rows).
- **Hybrid retrieval**: `hybridSearchStatutes()` — Postgres FTS leg + pgvector cosine-KNN leg (30 candidates each), fused with Reciprocal Rank Fusion (k=60); response reports `method: "hybrid" | "fts"` (explicit degrade with logged warning when the vector leg is unavailable) plus per-hit `ftsRank`/`vectorRank`/`rrfScore`. New endpoint `GET /statutes/retrieve` (q, code, jurisdiction, practiceArea, limit) — OpenAPI-first + codegen.
- **Similar provisions**: `GET /statutes/{id}/similar` — lazy-embeds the source row if needed, vector KNN with explicit FTS-on-heading fallback (`method` says which ran); 404 on missing id.
- **Router + grounding**: retrieval router step 3 now uses hybrid statute retrieval (broader statute-flavour detection); `POST /runs` grounding inherits it via `planAndRetrieve` (provisions stored on the run, shown in RunDetail's Sections & Statutes rail). Chat + draft actions gained non-blocking hybrid statute grounding for statute-shaped prompts (verified-provisions context block; failure never blocks a turn).
- **Tests**: new `statutes-hybrid-retrieval.test.ts` (13 route-level tests: RRF ordering, per-leg ranks, jurisdiction/code/practiceArea filters, limit, 400s, similar-provision vector + 404/400); router/chat mocks updated for the hybrid path. Full api-server suite green, typecheck green, curl e2e green (hybrid IPC 420 retrieval, BNS 318 similar via vector, 404/400 paths).
- **Not yet shipped to prod** — EC2 deploy (bundle incl. `embed-statutes.mjs`, run Titan v2 backfill on worker) tracked as follow-up.

## 2026-07-09 — Task #97: Acts-browse route regression suite (+ optional `limit` on `/statutes/acts`)
- New `statutes-acts-routes.test.ts` (20 tests) pins the `GET /statutes/acts` contract the same way the sibling statutes-route suites do: act search matching (by act name **and** by code), jurisdiction + practiceArea filters (alone and combined), per-act section counts (grouped per code+jurisdiction), actName ordering, `total`/`totalSections` accounting, act metadata passthrough (year/no/ministry/practiceArea/enactmentDate), the pre-filter `practiceAreas` facet, limit clamping, empty-result (not error) paths, and 400s for invalid jurisdiction / empty q / empty practiceArea / non-numeric limit.
- The route previously had no `limit` param; an optional `limit` was added end-to-end (OpenAPI spec + Zod route schema + `listStatuteActs`): clamped to 1–1000, sliced after sort, with `total`/`totalSections` still reflecting the full filtered set. Omitting `limit` returns all acts (backward compatible — existing UI/SDK callers unchanged).
- Fixture-token pattern (`zyxquactstest` in code + act name) so the suite runs green on both empty and fully-seeded DBs; only rows it inserted are removed afterwards. Already covered by the existing `api-server-tests` validation workflow (full vitest suite).
- Verified: api-server suite 360/360 across 27 files; full typecheck green (required a `typecheck:libs` rebuild — stale `@workspace/db` declarations lacked the act metadata columns); codegen re-run after the spec change. Dev DB task seed re-run to restore the 54 US / 90 GLOBAL jurisdiction tagging (pre-existing stale state had broken the jurisdiction-segregation tests).

## 2026-07-09 — Task #96: Statutes corpus refresh mode + one-command prod delta sync
- `pnpm --filter @workspace/api-server run ingest:indiacode:refresh` (i.e. `--refresh`): re-enumerates India Code, registers acts absent from `statute_ingest_progress`, and ingests only new + previously failed acts — done/skipped/no-sections acts are never re-fetched. Known-amended acts can be forced with `--only <handle>` (upserts make it safe).
- New `statutes.updated_at` column (idempotent DDL ALTER + index) — every ingest upsert stamps `updated_at = now()`, so deltas are queryable by timestamp. Refresh runs capture the DB clock at start and, on completion, log the exact delta-export + prod-sync command with that cutoff.
- New `export:statutes-delta -- --since <ISO> [--out <file>]` exporter (keyset-paginated Node pg script — never `psql \copy`) writes changed rows as JSONL for the existing prod loader.
- New `scripts/sync-statutes-delta.mjs <delta.jsonl>` — one command: builds the api-server bundle, uploads the JSONL + `load-statutes-appdb.mjs` to S3 under content-addressed keys, then via SSM md5-verifies both on the worker and runs the loader with `DATABASE_URL` grepped (never sourced) from the worker `.env`. Fails loudly on any mismatch.
- Refresh cadence: run `ingest:indiacode:refresh` monthly (or after known legislative activity); if the run reports `rowsTouched > 0`, follow the logged export + sync command to push the delta to prod.
- Verified: refresh smoke run (enumerate + register + zero-queue + delta hint) against live India Code; exporter/loader round-trip on dev DB (2,279 rows, idempotent).

## 2026-07-09 — Task #88: Overwrite-safe frontend + worker-script deploys (extends Task #86)
- Extended the content-addressed deploy pipeline to the two remaining mutable-copy paths: the frontend static tarball and the worker script copies (`ingest-rds` / `embed-corpus` / `audit-coverage`).
- `upload-deploy.mjs --frontend[=path]` uploads the Vite build tarball (default `/tmp/public.tgz`) as `caselaw-worker/api/releases/public-<md5>.tgz` and records it as `public.tgz` in the manifest; with `--deploy` the worker downloads the hashed key, verifies md5, extracts to a staging dir, sanity-checks `index.html`, and atomically swaps `/opt/nyv/api/public` (previous kept at `public.old`) — any mismatch exits 1.
- `upload-deploy.mjs --scripts` installs `/opt/nyv/api/{ingest-rds,embed-corpus,audit-coverage}.mjs` from the manifest's hashed keys with md5 verification — no more copying the mutable `caselaw-worker/api/*.mjs` keys. `--no-api` allows frontend-only or scripts-only invocations; the manifest merges with the existing remote copy so partial uploads never drop entries.
- Fixed a latent `ssm-run.mjs` bug: its CLI block ran on *import*, so importing modules with CLI args accidentally executed those args as shell commands on the worker; now gated behind an entry-point check.
- Verified live: frontend tarball + all bundles uploaded content-addressed with manifest read-back green; positive (verified download + extract + index.html present) and negative (deliberate md5 mismatch → loud non-zero exit) tests ran on the worker; real `--scripts` deploy installed all three verified script copies on the worker.
- Docs updated: `scripts/src/ssm-run.md`, `replit.md`, Product Note status table, PROJECT-TRACKER §4 step 6.

## 2026-07-09 — Task #87: Open judgment PDFs inside the app instead of a new tab
- Caselaw Search's "Open judgment PDF" button now opens the shared in-app PDF viewer dialog (same one as Archive Search) instead of a new browser tab — attorneys stay in context and stale tabs can't hit expired presigned URLs.
- Extracted the Archive Search viewer into a reusable `PdfViewerDialog` + `usePdfViewer` hook (`src/components/PdfViewerDialog.tsx`); both pages now share it. A fresh URL is fetched on **every** open (viewer or new-tab) — SC presigned URLs expire in 5 minutes, so links are never reused across opens.
- Viewer keeps honest loading/error + Retry states, plus "Open in new tab" and Download in the footer; 404s from `/caselaw/documents/{id}/pdf-url` still render the inline "PDF not available" message.
- Tests: new `PdfViewerDialog.test.tsx` (3 tests — dialog+iframe render, error→Retry recovery, fresh-URL refetch on reopen); frontend 28/28; api-server 328/328; typecheck green. (Dev DB reseeded to restore the 54 US / 90 GLOBAL task tagging — pre-existing stale seed had broken jurisdiction-segregation tests.)
- Not a prod ship — frontend-only change rides the next static-build deploy.

## 2026-07-09 — Task #86: Overwrite-safe production deploys (content-addressed S3 + md5-verified SSM deploy)
- Root cause: deploys uploaded to a single mutable S3 key (`caselaw-worker/api/index.mjs`) and the worker blindly copied it — a concurrent release between upload and download silently won (last-writer-wins), caught only by manual md5 comparison.
- `scripts/upload-deploy.mjs` now uploads every bundle to a content-addressed key (`caselaw-worker/api/releases/<name>-<md5>.mjs`, with `ContentMD5` so S3 rejects corrupt uploads) plus a `manifest.json` recording per-file md5/size, then read-back-verifies the manifest and aborts if another release overwrote it.
- New `--deploy` flag makes upload+deploy one atomic flow: SSM downloads the hashed key to a temp file, verifies its md5 against the manifest hash, atomically `mv`s into `/opt/nyv/api/index.mjs`, restarts `nyv-api`, and health-checks — any mismatch or failure exits 1 loudly (no silent overwrite possible: the hashed key is immutable per content).
- Verified live: upload flow ran against S3 (4 bundles + manifest, read-back green); deploy command plumbing verified read-only on the worker via SSM.
- Docs updated: `scripts/src/ssm-run.md`, `replit.md`, Product Note ops reference + status table, PROJECT-TRACKER §4 ship gate step 6.

## 2026-07-09 — Task #85: Embedding backfill progress on the dashboard (shipped to prod)
- **Dashboard "Semantic Search Readiness" section**: reads the existing `GET /caselaw/stats` `embedding` field (RDS backend) and renders one card per backfill scope (`all`/`sc`/`hc`) with progress % (totalEmbedded vs corpus size from `sources`), embedded/total counts, a progress bar, and last-checkpoint age; auto-refreshes every 60s. Hidden entirely when the backend reports no embedding progress (dev/local).
- **States**: *In progress* (recent checkpoint), *Complete* (green, when embedded ≥ scope denominator), *Stalled* (amber warning when the last checkpoint is >30 min old and not complete — signals the backfill died). Scope denominators match source prefixes loosely (`in-hc` also matches the `in-hc (estimated)` label the prod stats fallback emits).
- **Completion-side ops already automated**: `embed-corpus` creates the HNSW index and runs `ANALYZE judgments (embedding)` at the end of every run, so planner stats refresh and vector KNN activation need no manual step.
- Frontend-only change (no API/schema edits). Verified: full typecheck; frontend-tests 25/25; UI screenshot with all three states (temporary dev mock, reverted); prod smoke — worker stats returns `embedding` (scope `all`, ~409k embedded, fresh checkpoint; backfill process live at ~20k rows/hr), rebuilt static frontend deployed via S3+SSM with md5 + bundle-hash verification (`index-CFrBuhE1.js` live on the domain).

## 2026-07-09 — Task #74: Let users upload and create templates (shipped to prod)
- Attorneys can now add their own templates/checklists to the library: **New template** (markdown editor with title/category/jurisdiction/kind/description/tags) and **Upload document** (DOCX/PDF/MD/TXT → server-side text extraction reusing the chat pipeline incl. OCR fallback for scanned PDFs → editable draft → save) on the Templates page.
- Additive schema: `templates.is_custom` (bool), `source` (`seeded|created|uploaded`), `source_filename`, `updated_at` — dev via drizzle push, prod via idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `setup-appdb.ts`.
- New endpoints: `POST /templates`, `PATCH /templates/{id}`, `DELETE /templates/{id}`, `POST /templates/extract` (OpenAPI-first + codegen). Custom rows get a collision-safe `custom-` slug; seeded rows are read-only (403 on PATCH/DELETE).
- **Reseed protection:** `seed:templates` now deletes only `is_custom = false` rows — user-created templates survive every reseed (verified live: 70 reseeded + 1 custom intact).
- UI: custom badge on cards, Edit/Delete in the detail dialog (custom only), delete confirmation, upload button in header and in the editor.
- Tests: `templates-crud.test.ts` (11 tests — create/slug-dedupe/validation, 403 seeded protection, update/delete, extract happy+error paths, reseed-protection predicate); full api-server suite 297/297; frontend 23/23; UI e2e pass (create→search→edit→delete→seeded read-only).
- **Shipped to prod** (`nyayasearch.nyayasiddhi.online`): DDL applied via `setup-appdb.mjs` on the worker (password parsed from worker DATABASE_URL + `RDS_CA_BUNDLE`, both required env), new API bundle + rebuilt static frontend deployed via S3+SSM. Prod smoke green: login, create (`custom-` slug, `isCustom:true`), PATCH custom 200, PATCH/DELETE seeded 403, extract MD 200, delete custom 204, 70 seeded rows intact, domain 200.

## 2026-07-09 — Task #73: Platform-wide jurisdiction segregation (India-first)
- **Schema**: `legal_tasks.jurisdiction` (`IN` | `US` | `GLOBAL`, not null, default `GLOBAL`; seed tagged — 54 US-specific + 90 GLOBAL benchmark tasks, integrity-checked by `check:seeds`) and nullable `runs.jurisdiction` (legacy runs stay null and are excluded from scoped views).
- **API (additive)**: `jurisdiction` query param on `GET /tasks`, `GET /categories`, `GET /dashboard/summary` — task-library rule is *selected jurisdiction + GLOBAL*, dashboard run stats are exact-match; unknown values return 400 (no silent pass-through). `POST /runs` persists the run's jurisdiction and echoes it on Run/RunDetail; chat passes it through to run actions.
- **Chat hard guard**: Legal Chat always sends the selected jurisdiction (including reserved GCC/UK/EU/SG); server-side, `runChatAction` deterministically skips authority retrieval for any non-live jurisdiction — an explicit reserved selection is never inferred to US/IN, so reserved-jurisdiction turns can't pull US or IN authorities. Pinned by 3 new tests in `chat-actions.test.ts` (reserved → zero retrieval across all retrieving modes; reserved wins over document-based inference; IN/US still retrieve with the selected value).
- **Frontend**: every surface now follows the sidebar jurisdiction selector — Task Library + Dashboard filtered; Templates, Statutes show coming-soon cards for reserved jurisdictions (GCC/UK/EU/SG) with **zero network fetches**; Statutes code dropdown splits IN codes vs USC and resets on switch; Legal Chat sends the active jurisdiction; Archive Search and the Old↔New comparator are IN-only with switch-back cards.
- **Tests**: new `jurisdiction-segregation.test.ts` (10 API tests: filtering, no-leak, backward-compat unscoped, 400 on unknown, run persistence, dashboard scoping) + Statutes UI pins (coming-soon renders without fetches; `jurisdiction=IN` sent by default). All 6 validation workflows green: api-server 299/299, frontend 25/25, citation-router 64/64, seeds 25/25, statutes 9/9, typecheck. Live curl e2e verified IN=90 / US=144 task split and statutes scoping.
- **Not yet shipped to prod** — EC2 deploy (incl. `setup-appdb.ts` DDL for the two new columns) tracked as a follow-up.

## 2026-07-09 — Task #72: HC archive search (20.4M docs) + on-demand PDF→text extraction feeding chat & runs — SHIPPED TO PROD
- **HC Athena table**: new `nyv_docs.judgments_meta_hc` (20,443,570 rows, CTAS parquet at `s3://usa-caselaw/athena/judgments_meta_hc/`) built from the public `s3://indian-high-court-judgments/metadata/parquet/` estate via staging table `hc_meta_src`; `s3_path` points at owned HC PDF keys (`ns-highcourt-data-bucket`, with automatic sibling fallback to `ns-indian-highcourt-judgements-2` — validated live: sample PDFs resolve via the sibling). Worker env `ATHENA_TABLE_HC=judgments_meta_hc`.
- **API**: `POST /athena/search` accepts `archive: "sc" | "hc" | "all"` (default sc; `all` = UNION ALL both tables); every hit carries `archive`; `/athena/status` reports `hcTable`. Cost guardrails unchanged (`nyv-docs` workgroup, 5 GB enforced cutoff — HC searches scan ~1.5 GB).
- **Extraction**: `POST /athena/extract` — auth-gated, owned-bucket allowlist, 25 MB size cap (HeadObject first, 413 over cap), pdf.js text layer with OCR fallback (pdf-to-img + tesseract.js) for scanned judgments, results cached in new `archive_extracts` table (keyed by s3Path, `requestedPath` preserved when the sibling bucket serves the file).
- **Chat**: `POST /chat/conversations/{id}/documents/from-archive` attaches an archive judgment as a chat document (extract → `chat_documents` with `source_ref`); Archive Search "Summarize in chat" creates a conversation, attaches, and deep-links to `/chat?c=<id>`.
- **Runs**: `POST /runs/stream` accepts `archiveReferences` (max 3); extracted text is injected into drafting grounding with provenance; NewRun shows removable reference chips (deep-linked from Archive Search / Caselaw Search "Use as run reference").
- **Prod ship gate**: typecheck green; api-server 303/303 + frontend 23/23 tests; deployed via S3+SSM (index.mjs, setup-appdb.cjs — `archive_extracts` DDL + `chat_documents.source_ref` — frontend public.tgz); prod smoke green: status shows hcTable, HC search returns Meghalaya judgments, live extract (665 chars via sibling bucket), chat from-archive attach 200, domain 200.

## 2026-07-09 — Task #71: Production RDS caselaw corpus completeness + PDF links + embedding backfill (shipped)
- **Coverage audit vs AWS Open Data** (new bundled `audit-coverage.mjs`, report at `/opt/nyv/coverage-report.json`): SC now **43,505/43,505 (0 gaps)** after a full SC wipe + re-ingest that recovered ~5,180 rows previously lost to cross-partition dedupe and populated `decision_date` + s3 `pdf_link` on **every** SC row. HC: 20,438,646/20,443,570 source rows (12 gap partitions re-run; 2026 recovered 66 rows; residual ~4.9k delta confirmed as true cross-partition duplicates — accepted).
- **PDF links end-to-end**: new `GET /api/caselaw/documents/:id/pdf-url` — SC s3:// paths are presigned (5-min, owned-bucket allowlist shared with Athena; allowlist key regex now accepts `=` in partitioned keys like `year=2024/`, +1 presign test), HC public-bucket URLs returned directly after a HEAD reachability check; dev/local corpus 404s gracefully. Caselaw search cards gained a fetch-and-open **Judgment PDF** button (`JudgmentPdfLink`).
- **Embedding backfill with progress visibility**: `embed-corpus` now takes a scope arg (`all|sc|hc`) and checkpoints into a new `embed_progress` table; `GET /api/caselaw/stats` returns an `embedding` field (per-scope totalEmbedded/lastId/updatedAt). Backfill relaunched on the worker (`/opt/nyv/embed.log`) — ~400k embedded and climbing, resumable.
- **Stats resilience**: prod `/caselaw/stats` exact `GROUP BY source` count can exceed the 120s statement timeout under ingest/embed load; it now falls back to a fast `ingest_progress`-based estimate (labelled `(estimated)`) instead of erroring, and still serves stale cache when available. `RDS_STATEMENT_TIMEOUT_MS` env override added for batch jobs.
- **Verified (EC2 ship gate):** full typecheck; api-server-tests **287/287**; frontend-tests 23/23; dev API smoke; prod smoke green — stats returns totals + embedding progress, SC doc returns a working presigned PDF URL, HC doc returns the public PDF URL. Deploy gotcha fixed en route: the shared S3 deploy object had been overwritten by another writer — redeploys now verified by md5 on the worker before restart.

## 2026-07-09 — Task #69: Complete India statutes corpus — Constitution + ~824 central Acts (37,107 rows / 832 act codes), dev + prod
- **Shipped to prod** (`nyayasearch.nyayasiddhi.online`, EC2 worker via S3+SSM, EC2 ship gate completed): the statutes corpus grew from 2,279 rows / 8 codes to **37,107 rows across 832 act codes** in both dev and the production `nyvapp` RDS database.
- **Constitution of India** (`seed:constitution`, `data/seed-constitution.json`): 477 rows under code `COI` — 395 articles incl. lettered inserts (21A, 51A, 300A…), 12 schedules, preamble; chapter = Part; idempotent delete-then-insert with integrity pre-flight.
- **India Code ingest** (`ingest:indiacode`, `src/ingest-india-code.ts`): section-by-section ingest of all ~846 central Acts from indiacode.nic.in with act metadata (act name/year/no, ministry, department, mapped practice area, enactment date, source handle) on new nullable `statutes` columns. Resumable via a `statute_ingest_progress` table with atomic per-act claims (parallel-safe); `--retry-failed` baked into the npm script. Result: 824 acts ingested, 19 genuinely PDF-only acts excluded (incl. Income-tax Act 1961 — India Code serves no HTML sections for them), 3 skipped as already carried under dedicated codes (BNS/BNSS/BSA).
- **WAF resilience** (hard-won during the run): indiacode.nic.in throttles bursts by serving degraded JS-only act pages (no server-rendered section anchors), then 500s/403s. The ingester now uses a browser UA (the identifying UA got 403-blocked mid-run), a known-good-act health probe to distinguish degraded pages from genuine PDF-only acts, a 3-strike circuit breaker with 5-minute cooldowns, and a wait-for-healthy loop at startup so workflow restarts never die on a throttled enumeration.
- **Act-level browse**: new `GET /api/statutes/acts` (search, jurisdiction + practice-area filters, per-act section counts, totals) + the Statutes page rebuilt around an acts-browse experience; SDK gains `statutes.acts()`.
- **Prod loader** (`src/load-statutes-appdb.ts` → `load-statutes-appdb.mjs`): bulk JSONL upsert that applies DDL, delete-then-inserts per code, and rebuilds the FTS index. Gotcha fixed: exporting JSONL via `psql \copy` text format mangles escapes (5,927 lines corrupted) — export with a Node pg script instead; reload verified 37,107/37,107 rows, 832 codes.
- **Verified (ship gate §4):** typecheck green; api-server 298/298, frontend 26/26, citation-router 64/64, check-statutes 9/9; dev API e2e (acts browse 831 acts, FTS "oppression" → Companies Act 2013 §241, COI §1); prod smoke after API + frontend redeploy (acts 832/37,107, COI sections, FTS hit, domain 200s).

## 2026-07-09 — Task #66: Frontend test suite runs automatically on every change
- Registered a new `frontend-tests` validation workflow (`pnpm --filter @workspace/nys-agentic-ai run test`) alongside the existing `citation-router-tests`, `api-server-tests`, `typecheck`, `check-seeds`, and `check-statutes` checks, so the US-outage UI suite (`UsOutage.test.tsx`) and the CaselawSearch/LegalChat component tests now gate every change instead of running only when invoked manually.
- PROJECT-TRACKER §4 step 2 updated to list all 6 validation workflows. Verified: `frontend-tests` run PASSED (12/12).

## 2026-07-09 — Production ship (2nd of the day): demo-readiness — drafting workspace, template order, citation lawyer-syntax, PDF links
- **Shipped to prod** (`nyayasearch.nyayasiddhi.online`, EC2 worker via S3+SSM, EC2 ship gate completed) — a demo-readiness bundle:
- **Templates order**: the templates listing now returns full templates before checklists (`routes/templates.ts` `orderBy desc(kind)`), fixing the "only checklists" impression on the default **All** tab.
- **Citation Check**: `verify-citation` normalizes `v.` / `vs.` / `vs` to `versus` before building the Indian-corpus FTS query, so real case names typed lawyer-style (e.g. "Kesavananda Bharati vs State of Kerala") now verify instead of returning `not_found`.
- **Caselaw search cards**: render an **Open judgment PDF** link when a document carries an absolute `pdfLink` URL; relative eCourts HC paths are guarded out to avoid broken links.
- **NEW — RunDetail drafting workspace**: a TipTap WYSIWYG editor over the run's work product — **Edit draft** toggle, H1–H3 / bold / italic / underline / lists / blockquote / yellow-highlight toolbar, **Copy** + **Download .md**, client-side only — plus a sticky right-rail **Intelligence** panel: **Sections & Statutes** chips (regex-extracted, link to `/statutes?q=`), **Parties**, **Citations & References** (link to `/caselaw?q=`), **Case summary**, **Case details**, and **Verified authorities**. `Statutes.tsx` and `CaselawSearch.tsx` now accept a `?q=` URL param so the deep links land on a pre-filled search.
- **Verified:** 286/286 api-server tests, full workspace typecheck green; prod smoke green (templates order, citation verify with lawyer-style case name, domain 200s).

## 2026-07-09 — Task #65: Search page surfaces the US outage message instead of an empty list
- Caselaw Search now shows the API's 502 error message prominently (e.g. "CourtListener timed out. Try again shortly.") under a "Live source unavailable" heading when the live US source is down — never "0 results" or a generic failure. `extractErrorMessage()` reads the server's `error` field from the typed `ApiError` (now exported from `@workspace/api-client-react`), falling back to the error message, then a generic hint.
- Citation Check's failure card now shows the server's error message instead of a bare "Verification failed. Please try again."; the 200 "uncertain" status + note path (US source down) was already rendered and is now pinned by tests.
- New component suite `UsOutage.test.tsx` (3 tests, jsdom + mocked fetch): 502 search shows the exact server message and no empty-list UI; verify-citation "uncertain" note rendered; 502 verify surfaces the server message. Frontend suite 12/12 green; workspace typecheck green.

## 2026-07-09 — Task #61: Mixed-direction questions link both ways
- One chat message mixing a reverse and a forward comparison ("BNSS 482 was which CrPC section, and what replaced IPC 302?") now gets a verified **Compare side-by-side** link for every provision in both directions, instead of the forward links being dropped entirely.
- `detectOldNewCompareIntents()` no longer returns `[]` whenever reverse intents exist; it skips only the character spans of BNS/BNSS/BSA section references the reverse detector already claimed, so untouched IPC/CrPC/IEA refs still surface as forward intents. Reverse-only questions still yield no forward intents (no old-code section numbers to match).
- `buildCompareLink()` in `chatActions.ts` (now exported) merges reverse + forward links into one footer — reverse first — under a shared 5-link cap (`MAX_COMPARE_LINKS`); the per-direction builders return link arrays and the footer renders once.
- Tests: retrievalRouter "forward yields entirely to reverse" replaced with 3 mixed/claimed-span cases; 4 new `buildCompareLink` cases in `chat-compare-link.test.ts` (merge order, unverified-reverse fallback, shared 5-cap, no-intent null). Full api-server suite 271/271 green; workspace typecheck green.

## 2026-07-09 — Task #60: Empty-corpus warning + search hint pinned by regression tests
- New `caselaw-empty-corpus.test.ts` (4 tests, mocked DB) pins `searchIndianCaselaw`'s hint logic: zero results + empty corpus → `message` with the exact `seed:caselaw` command; zero results on a seeded corpus → no `message`; a failing emptiness check never errors the search; the check isn't consulted when the search has results.
- New `caselaw-search-routes.test.ts` (3 tests, real DB + supertest, fixture-token pattern like the statutes route suite) pins `GET /api/caselaw/search?jurisdiction=IN` end to end: fixture judgment found via FTS, no `message` field on zero-result queries against a seeded corpus, and the hint passed through verbatim as `message` when the corpus is empty (helper stubbed for that case). Green on empty or seeded dev DB.
- Full api-server suite 261/261 green; typecheck green.

## 2026-07-09 — Task #57: Chat compare links cover every referenced provision
- Multi-provision questions ("What replaced IPC 302 and IPC 420?", "BNSS 482 and BSA 63 were which old sections?") now get one verified **Compare side-by-side** link per mapped section instead of only the first. Single-link answers keep the inline format; multiple links render as a bulleted list under one footer.
- New plural detectors `detectNewOldCompareIntents()` / `detectOldNewCompareIntents()` in `retrievalRouter.ts` (global regex scan, deduped, capped at 5; forward still yields entirely to reverse when both apply; the singular detectors now return the first plural result, keeping the router lockstep suite intact). `buildReverseCompareLink()` / `buildForwardCompareLink()` in `chatActions.ts` verify each mapping via `compareNewToOld()` / `compareIpcToBns()` / `compareOldToNew()`; unverified or failing lookups are silently skipped per-section.
- 11 new tests (9 plural-detector cases in `retrievalRouter.test.ts` incl. mixed codes, dedupe, 5-cap, reverse-priority; 2 multi-link cases in `chat-compare-link.test.ts` incl. partial verification). Full api-server suite 254/254 green; workspace typecheck green.

## 2026-07-09 — Task #56: Loud warning when the caselaw corpus is empty in a fresh environment
- Startup guard: the API server logs a loud `CASELAW CORPUS IS EMPTY` / `CASELAW TABLE MISSING` error (with the exact `seed:caselaw` fix command) right after listen when the local `caselaw_documents` table is empty/missing — skipped when `CASELAW_BACKEND=rds` (production uses the RDS corpus, not the local table).
- Search hint: IN caselaw search (`GET /caselaw/search?jurisdiction=IN`) now returns an explicit `message` ("corpus is not seeded… run seed:caselaw") alongside the empty result when the query finds nothing *because* the corpus is empty; the check never blocks or errors a search (failure just omits the hint). Uses the existing optional `message` field on `CaselawSearchResponse` — no OpenAPI change.
- Verified e2e: with the table swapped to empty, `/api/caselaw/search` returned the hint; with the 43k-row corpus restored, normal search results and no hint. Full api-server suite green; typecheck green.

## 2026-07-09 — Production ship: backlog waves 1-2 + template library (+RDS search fix)
- **Shipped to prod** (`nyayasearch.nyayasiddhi.online`, EC2 worker via S3+SSM, EC2 ship gate §4 completed): rebuilt the API bundle (`node build.mjs` → `s3://nyv-sdk-distribution/caselaw-worker/api/` → `systemctl restart nyv-api`) carrying **wave 1** (#7, #12, #15, #26, #27, #33, #34, #35, #40, #47) and **wave 2** (#8, #13, #14, #41) plus the merged comparator/seed tasks (#45–#50, #53).
- New esbuild externals `tesseract.js` + `pdf-to-img` npm-installed in `/opt/nyv/api` (18 packages) so the OCR fallback (#14) runs on the worker.
- Frontend static rebuild (`BASE_PATH=/`) extracted to `/opt/nyv/api/public`.
- Prod app DB (`nyvapp` on RDS): created `pg_trgm` extension + `chat_messages_content_trgm_idx` (GIN) + `chat_messages_conversation_id_idx`, so chat content search (#12) stays fast at scale in prod.
- Reseeded the **70-template library** in prod (was 10; bundled `seed-templates.mjs` + `/opt/nyv/data/seed-templates.json`; logged "templates seeded count:70").
- **New fix found during prod smoke:** prod RDS caselaw search for broad queries (e.g. "bail") hit the 25s pool `statement_timeout` → 500. Fixed in `src/lib/rdsCaselaw.ts` by porting #7 resilience (`SET LOCAL statement_timeout = 8s` in a transaction, retry-once on Postgres 57014, `CorpusBusyError` → 503) + bounded ranking (`ts_rank` over at most 10,000 GIN candidates) + capped count (exact up to 10,000). Verified in prod: "bail" 200 in 0.64s (total 10000), narrow query 0.06s. Per architect review, the capped count is now explicit in the API contract: `CaselawSearchResponse.totalCapped?: boolean` (true when `total` is a 10,000-cap lower bound; local backend always sends `false`), the CaselawSearch UI renders "10,000+", and a new `rds-caselaw-resilience.test.ts` regression suite (5 tests) covers the RDS timeout/retry/503 path (221 tests total).
- **Prod smoke (all green):** healthz 200, public `/api/openapi.json` 200 via domain, frontend 200, auth gate 401 unauthenticated, login 200, templates(70)/statutes search (BNS 318 "cheating")/chat/athena status all green.

## 2026-07-09 — Task #54: Exact statute lookups (like IPC 420) pinned by direct tests
- New vitest suite `statute-section-lookup.test.ts` gives the exact-section helper `getStatuteBySection` (lib/statutes.ts) its first direct coverage: exact match, prefix fallback in both directions (base → subsection "990319" → "990319(4)" and subsection → base "990320(2)" → "990320"), exact-match precedence over prefix candidates, lowercase + whitespace normalization ("990321a" → "990321A"), code scoping, and null for a missing section.
- Route-level coverage of the retrieval router's statute path: `POST /api/retrieve` with "IPC <sec>" and "section <sec> of the IPC" resolves `intent: "statute"` deterministically (`llmRequired: false`) with a `statute-lookup` step, and the prefix fallback works end-to-end through the route.
- Same self-contained fixture pattern as the search-route suite (990xxx sections that never occur in the real corpus, remove only self-inserted rows) — green on empty dev DB and seeded corpus. Full api-server suite green (227 tests, 11 new); full workspace typecheck green.


## 2026-07-08 — Task #53: Dev setup seeds the statutes corpus automatically
- New `seed:ensure` script (`src/seed-if-empty.ts`): checks `legal_tasks`, `templates`, and `statutes` and runs the matching seeder only when a table is empty/missing (idempotent, never clobbers existing data; ~4s no-op when seeded, ~7s to reseed statutes).
- Post-merge setup (`scripts/post-merge.sh`) now runs `seed:ensure` after `db push`, so fresh dev environments/task-agent clones get all three corpora automatically; post-merge timeout raised 20s → 120s to cover a cold seed.
- Startup guard: the API server logs a loud `STATUTES CORPUS IS EMPTY` / `STATUTES TABLE MISSING` error (with the exact fix command) right after listen if the corpus is empty, so comparator 404s are never silent.
- Verified e2e: truncate → post-merge run reseeded 2,279 statute rows; startup warning fires when empty and is absent when seeded; full typecheck green.

## 2026-07-08 — Task #52: Regression tests for the chat's reverse-compare link
- New `chat-compare-link.test.ts` (13 tests) locks the deterministic **Compare side-by-side** link behavior: `buildReverseCompareLink()` (now exported from `chatActions.ts`) appends the link only when `compareNewToOld()` confirms the mapping, joins multiple old sections, normalizes lowercase/letter-suffixed sections, returns null for non-reverse messages or unmapped sections, and never throws when the statute lookup fails (chat keeps working, link is just omitted).
- Lockstep suite: a shared query list asserts `detectNewOldCompareIntent()` fires on exactly the queries `planAndRetrieve()` routes to `new-old-compare` (and on none of the non-reverse ones), so the chat link and the router can't drift apart.
- Verified: full api-server suite 211/211 green; workspace typecheck green.

## 2026-07-08 — Task #51: Forward (old→new) compare links in chat
- Legal Chat: forward comparison questions ("What replaced IPC 302?", "CrPC 438 under BNSS?", "BSA equivalent of Evidence Act 65B?") now also end with a deterministic **Compare side-by-side** link, mirroring the Task #48 reverse-link behavior. IPC links go to `/statutes/compare?section=<n>`; CrPC/IEA links to `/statutes/compare?from=<CrPC|IEA>&section=<n>`.
- New exported `detectOldNewCompareIntent()` in `retrievalRouter.ts` (reuses `OLD_SECTION_REF`/`SECTION_REF` + new `FORWARD_CUE`; yields to the reverse detector when both apply). Mapping verified via `compareIpcToBns()` / `compareOldToNew()` before linking; lookup runs in parallel with the LLM call; failure logs a warning and never blocks the answer.
- 8 new detector unit tests; full api-server suite green (205). e2e verified in dev chat for both IPC 302 → BNS 103 and CrPC 438 → BNSS 482 links.

## 2026-07-08 — Task #48: Statute results link straight to the comparator's reverse view
- Legal Chat: when a message is a reverse (new→old) comparison question (e.g. "BNSS 482 was which CrPC section?"), the answer now ends with a deterministic **Compare side-by-side** link to `/statutes/compare?from=<BNS|BNSS|BSA>&section=<n>`. Intent detection reuses the router's regexes (new exported `detectNewOldCompareIntent()` in `retrievalRouter.ts`; the router's inline cue regex was deduplicated into `REVERSE_CUE`); the mapping is verified via `compareNewToOld()` before linking (lookup runs in parallel with the LLM call; failure logs a warning, never blocks; also streamed via `onDelta`).
- Chat UI: assistant messages now render internal markdown links (`[label](/path)`) as clickable router links (`renderWithInternalLinks` in `LegalChat.tsx`, 3 new unit tests); external links/plain text untouched.
- Statutes browser: BNS/BNSS/BSA rows show a "See old equivalent" link to the same reverse comparator view.
- e2e verified in dev (statutes corpus reseeded, 2,279 rows): chat answer for "BNSS 482 was which CrPC section?" ends with the link; `/statutes/compare?from=BNSS&section=482` renders BNSS 482 ↔ CrPC 438. Full suites green (api-server 116, frontend 9).

## 2026-07-08 — Task #50: Statute search & browse route regression suite
- New route-level vitest suite `statutes-search-routes.test.ts` (supertest against the real Express app + dev DB) covering `GET /api/statutes/search` and `GET /api/statutes` so a future corpus reseed, FTS-expression change, or schema change fails loudly.
- Search coverage: FTS finds fixture rows via a unique token and ranks the densest match first (`ts_rank`), code/jurisdiction filters (alone + combined), 400 on q < 2 chars / missing q / bad code, limit=1 respected while `total` reports the true count, limit clamping (0 → 1, 99999 → 50), and empty-result (not error) for a no-match query.
- List coverage: code + jurisdiction filters, code-then-section ordering, default limit 100, max-limit clamp at 600, below-minimum clamp to 1, 400 on unsupported code and non-numeric limit.
- Same fixture pattern as the comparator suite (upsert with `onConflictDoNothing`, remove only self-inserted rows), so it runs green on both an empty dev DB and a seeded corpus. Full api-server suite green (187 tests, 19 new).

## 2026-07-08 — Backlog wave 2 (#8, #13, #14, #41) (dev-complete)

## 2026-07-08 — Backlog wave: #7, #12, #15, #26, #27, #33, #34, #35, #40, #47 (dev-complete)
- **#33/#34 Streaming polish**: Run + chat streams now render live formatted markdown (new dependency-free `Markdown.tsx` component reused for streaming and final output, rAF-throttled flushes) with a **Cancel** button; abort propagates end-to-end (client `AbortController` → SSE routes detect premature disconnect via `res.on("close")` + `writableFinished` → `AbortSignal` forwarded to Anthropic SDK and Bedrock ConverseStream, upstream stream closed, no orphaned rows — chat deletes the dangling user message). Partial content preserved and marked "Cancelled".
- **#12 Chat content search**: `GET /chat/conversations?search=` now matches message bodies, not just titles — title hits ranked first, then content-only hits with a ~180-char `matchedSnippet` (additive OpenAPI field, codegen re-run); snippet shown in the history sidebar. e2e verified with a word appearing only inside a message.
- **#35 Public API reference**: `GET /api/openapi.json` mounted before the auth guard (like MCP) — API users can fetch the spec without logging in; all described endpoints remain auth-gated in prod.
- **#7 Search resilience during ingestion**: IN caselaw FTS runs with `SET LOCAL statement_timeout = 8s`, retries once on Postgres 57014, then returns explicit `503 { retryable: true }` via typed `CorpusBusyError` — never silent empty results; 502 upstream contract untouched. 8 new unit tests.
- **#15 Chat-action regression suite**: locks all 6 modes' contracts (mode-critical prompt markers, structured vs free-text payloads, brief/detailed directive, mandatory predictions disclaimer, 400 on unknown mode) with mocked provider.
- **#26 MCP schema-drift suite**: `tools/list` input schemas compared field-by-field against OpenAPI-derived Zod schemas (explicit alias map for intentional renames) + full snapshots — any drift fails CI.
- **#27 True statute count**: `/statutes` returns the real filtered total via a separate COUNT query (was capped at the page limit); UI shows "showing first N". Verified: 2,279 unfiltered, 358 BNS, 32 for "cheating".
- **#47 Template-category drift guard**: canonical `TEMPLATE_CATEGORIES` (17) enforced both directions in the seed pre-flight (`check:seeds`), mirroring the practice-area guard.
- **#40 In-app PDF viewer**: Archive Search results open judgments in an in-app dialog (iframe of a **freshly presigned** URL on every open — 5-min TTL never stale) with Download / new-tab actions and honest loading/error + Retry states; new-tab remains as secondary action.
- Scale hardening (architect review): `chat_messages` gains a trigram GIN index on `content` (pg_trgm) + a `conversation_id` btree index so content search stays fast as histories grow (schema-level in `lib/db`, applies to prod on next schema sync).
- Also fixed dev-DB drift: recreated missing `embedding vector(1024)` column + reseeded statutes (2,279). Verified: full workspace typecheck green; api-server suite **152/152**; curl e2e on all changed endpoints.

## 2026-07-08 — Task #49: Comparator route regression suite (both directions)
- New route-level vitest suite `statutes-compare-routes.test.ts` (supertest against the real Express app + dev DB) pinning known official mappings: IPC 420 → BNS 318(4) (with change notes), CrPC 438 → BNSS 482, IEA 65B → BSA 63, BNSS 482 → CrPC 438, BSA 63 → IEA 65B, BNS 318 → IPC 415/417/418/420 (reverse query on IPC rows), BNS 318(4) → IPC 420, plus lowercase-section normalization.
- Error paths covered: 404 for unmapped sections on all three compare endpoints, 400 for unsupported `from` codes and missing/empty params (Zod → error middleware).
- Fixtures are upserted with `onConflictDoNothing` and only self-inserted rows are removed in `afterAll`, so the suite runs green on both an empty dev DB and a fully seeded corpus. Full api-server suite green (132 tests, 21 new).

## 2026-07-08 — Task #46: Practice-area count drift guard (merged)
- Seed-integrity suite now enforces one-to-one sync between `CATEGORY_NAMES` (`src/lib/categories.ts`) and the categories used in `data/seed-tasks.json`: new `checkUnusedCategories` fails loudly (listing each orphaned slug + display name) if any practice area has no seed task; the existing valid-slug check already covers the reverse direction.
- Wired into `validateTasksSeed`, so the `seed` pre-flight and `check:seeds` inherit the guard automatically; negative-case test proves offenders are listed by name.
- The new check immediately caught real drift: `contracts` existed in `CATEGORY_NAMES` (25 entries) but no seed task used it — removed, restoring the documented 24-practice-area taxonomy. Full api-server suite green (108 tests).

## 2026-07-08 — Task #45: New→old lookup on the comparator page (BNS→IPC, BNSS→CrPC, BSA→IEA)
- New `GET /statutes/compare/new-old?from=BNSS|BSA|BNS&section=...` endpoint reusing `compareNewToOld()` (deterministic, no LLM); 404 with explanation when no mapping exists. OpenAPI path added (`compareNewOld`), codegen re-run, SDK gains `statutes.compareNewToOld(from, section)`.
- Comparator UI (`IpcBnsCompare.tsx`) now has a direction swap: three reverse modes (BNS→IPC, BNSS→CrPC, BSA→Evidence Act) alongside the existing old→new modes, with a one-click "Look up old → new instead" toggle. Reverse view shows the in-force section text (left) beside mapped repealed provision(s) (right) — full IPC text where in corpus, mapping-only card for CrPC/IEA. Deep-linkable via `?from=BNSS&section=482`.
- e2e verified: BNSS 482 → CrPC 438, BNS 318 → IPC 415/417/418/420 (full IPC text + change notes), BSA 63 → IEA 65B; 404/400 error paths; forward endpoints regression-checked; full api-server suite green (114 tests).

## 2026-07-08 — Comprehensive legal template library (10 → 70)
- Expanded `data/seed-templates.json` from 10 to 70 practice-ready templates/checklists after studying common Indian and US legal-market document needs: IN 47 + US 23 across 17 categories.
- India: criminal (anticipatory/regular bail BNSS 482/480, quashing BNSS 528, private complaint BNSS 223, discharge BNSS 250, appeal BNSS 415, maintenance BNSS 144, §138 NI Act notice + complaint, reply to BNSS 35(3) notice), constitutional (habeas corpus, PIL, SLP Art 136), civil (plaint O.VII, written statement O.VIII, injunction O.XXXIX, GPA, specific performance SRA), commercial/corporate (NDA, MSA, SHA, founders, LLP, employment w/ POSH refs, commercial lease), arbitration (§21 notice, statement of claim), insolvency (IBC §8/§9 Form 3), privacy/compliance (DPDPA notice + checklist, POSH ICC inquiry checklist), family/property/estate (HMA 13B divorce, PWDVA §12, will, gift deed, agreement to sell), consumer (State Commission appeal CPA 2019), RTI.
- US: litigation (FRCP 8 complaint, answer w/ affirmative defenses, 12(b)(6), Rule 56 MSJ, interrogatories, RFPs, deposition-prep checklist), IP (trademark C&D, DMCA takedown), transactional (settlement + release, mutual NDA, contractor agreement, at-will offer letter, single-member LLC OA, board consent, engagement letter), estate/family/property (will, durable POA, residential lease, notice to quit, prenup).
- All IN templates cite current BNS/BNSS/BSA sections with former IPC/CrPC/IEA numbers in parentheses; no fabricated case citations; every body ends with practical drafting notes.
- Reseeded dev DB (70 rows) and verified `GET /api/templates` (list + detail) and the Templates UI. Production reseed pending (EC2 ship gate applies; bundled `seed-templates.mjs` on worker).

## 2026-07-08 — Task #44: Task & template seed integrity pre-flights (merged)
- New shared module `src/lib/seedIntegrity.ts` validates `seed-tasks.json` (144 tasks; unique (category, slug); valid category slugs derived from `lib/categories.ts`; non-empty instructions/deliverables; unique, complete rubric criteria) and `seed-templates.json` (non-empty file; unique (kind, slug); valid kinds; non-empty titles/bodies).
- Both seeders (`seed`, `seed:templates`) run the checks pre-flight and exit non-zero without touching the DB, listing every offender — same pattern as the statutes seeder; the bundled prod seeders inherit it via esbuild.
- Vitest suite `seed-integrity.test.ts` shares the same module (runnable via `check:seeds`), including corruption-injection tests.
- Fixed pre-existing statutes-integrity drift: `EXPECTED_COUNTS` now includes CRPC 510 + IEA 181 (2,279 total), with a known-short allowlist for IEA 75 ("All other documents are private."). Full api-server suite green (106 tests).
- Verified: corrupting seed-tasks.json (empty instructions, missing criteria) and seed-templates.json (empty body, duplicate key) aborts both seeders with exit 1 and offender lists; restored files seed 144 tasks / 10 templates normally.

## 2026-07-08 — Task #42: Reverse new→old chat routing (BNSS→CrPC, BSA→IEA, BNS→IPC)
- Retrieval router now answers reverse questions ("BNSS 482 was which CrPC section?", "BNS 318 corresponds to which IPC section?") deterministically via new `compareNewToOld()` — no LLM. BNSS/BSA rows use their own `mappedCode/mappedSections`; BNS reverse-queries the IPC mapping rows.
- New `new-old-compare` tool/intent in `RetrievalStep`/`RetrievalPlan` (OpenAPI + SDK types updated; codegen re-run); routing decisions logged; run/advise grounding includes the new-code statute plus mapped old-code corpus rows.
- 8 new router unit tests (94 api-server tests pass); e2e verified BNSS 482 → CrPC 438, BSA 63 → IEA 65B, BNS 318 → IPC 415/417/418/420; forward intents regression-checked.


## 2026-07-08 — Task #37: Plain-language CrPC→BNSS / IEA→BSA chat routing (merged)
- Retrieval router now detects old-code comparison intents ("What is CrPC 438 under BNSS?", "BSA equivalent of section 65B of the Evidence Act") and answers deterministically via `compareOldToNew()` — no LLM.
- New `old-new-compare` tool/intent in `RetrievalStep`/`RetrievalPlan` (OpenAPI enums + SDK types updated; codegen re-run); routing decisions logged like existing intents.
- Run/advise grounding includes the mapped new-code sections as statute context; 7 new router unit tests (85 api-server tests pass); e2e verified CrPC 438 → BNSS 482 and IEA 65B → BSA 63.

## 2026-07-08 — Task #39: Seeder-enforced statutes integrity pre-flight (merged)
- `seed:statutes` now runs the same integrity checks as the vitest suite before touching the DB: if `seed-statutes.json` fails (wrong counts, duplicates, short/placeholder/repeal text, missing key sections like 498A), the seeder logs every offending section and exits non-zero — database untouched.
- Validation logic extracted to a shared module (`src/lib/statutesIntegrity.ts`) used by both the test suite and the seeder pre-flight, so they can't drift.
- The bundled production seeder (`dist/seed-statutes.mjs`) carries the same protection automatically (esbuild bundles the shared module).
- Verified: corrupting the seed file (498A repeal text + a duplicate row) aborts with exit 1 listing all failures; restored file seeds 1,588 rows normally.

## 2026-07-08 — Nyayavigya SDK v5 integration plan (docs)
- Studied the attached Nyayavigya v5.0.0/v5.1.0 material (Technical Product Note Part 2, truthful capability snapshot, 2026-06 status report, 2026–2036 roadmap, 164-agent IN registry) and wrote `docs/NYS-Nyayavigya-SDK-Integration-Plan-v5.md`.
- Plan positions NYS as NYV's **knowledge plane**: RAG tier + executable MCP tool handlers + citation-verification oracle; NYV owns orchestration/CoT, LLM routing (NV-LLM-001), 5-tier memory, governance ring. Includes gap list (G1–G9), phased merge plan (M0–M4), and standing design rules for all future NYS work.
- Supersedes the 3.1.2-era `NYS-AgenticAI-Nyayavigya-Integration-Blueprint.md`.

## 2026-07-08 — Task #32: Open judgment PDFs from Athena search hits
- New `GET /api/athena/document?s3Path=...` returns a short-lived (5 min) presigned S3 GET URL for a judgment PDF; bucket allowlist (owned SC/HC/US buckets only) + key sanitation prevent presigning arbitrary buckets/keys.
- New **Archive Search** UI page (`/archive`): Athena search form (query/year/court), scan-size + cost badges, per-hit "Open PDF" button that fetches the presigned link and opens the document in a new tab; shows a not-configured notice in dev.
- OpenAPI: `getAthenaDocument` + `AthenaDocumentUrl` schema; codegen regenerated.
- New worker dependency `@aws-sdk/s3-request-presigner` (esbuild external — must be npm-installed in `/opt/nyv/api` on the EC2 worker before redeploy).

## 2026-07-08 — Task #31: Athena cost guardrail workgroup (merged)
- Created dedicated Athena workgroup `nyv-docs` (ap-south-1) with **enforced** `BytesScannedCutoffPerQuery` = 5 GB and enforced result location `s3://usa-caselaw/athena/results/` — AWS now kills runaway scans server-side even if the app-side poll misses them, and query history/costs are isolated from `primary`.
- Added S3 lifecycle rule `expire-athena-results` on `usa-caselaw` (prefix `athena/results/`): objects expire after 7 days; incomplete multipart uploads aborted after 7 days.
- Worker env: `ATHENA_WORKGROUP=nyv-docs`; `nyv-api` restarted; verified in prod (`/api/athena/status` reports the workgroup; live search succeeded under it). No code changes — route already supported `ATHENA_WORKGROUP`.

## 2026-07-08 — Task #29: Statutes seed data-integrity check (merged)
- New vitest suite validates `seed-statutes.json` before seeding: exact per-code counts (BNS 358, BNSS 531, BSA 170, IPC 521, USC 8), no duplicate (code, section) pairs, no empty/short text or headings, no placeholder or repeal-notice text standing in for real IPC section text, and key IPC sections present (302, 420, 498A, 124A, 376(3)).
- Runnable standalone via `pnpm --filter @workspace/api-server run check:statutes`; failures list the offending sections. Also runs with the normal `test` script.

## 2026-07-08 — Task #28: Historical CrPC + Evidence Act corpus
- Ingested full CrPC 1973 (510 sections) and Indian Evidence Act 1872 (181 sections) as codes `CRPC`/`IEA` in `seed-statutes.json` (now 2,279 rows) — genuine bare-act text from devgan.in, official CrPC→BNSS / IEA→BSA mappings from NCRB Sankalan (495 + 174 sections mapped).
- `GET /api/statutes?code=CRPC|IEA` and statute FTS now cover the old procedural/evidence law; `StatuteCode` enum + Statutes page code filter extended.

## 2026-07-08 — Task #20: US citation year capture (merged)
- Citation extractor now captures the decision year in bare-year US cites like `347 U.S. 483 (1954)` (court text before the year is optional).
- Unit tests updated; all 16 citation tests pass.

## 2026-07-08 — Task #10: Full statutes library (merged)
- Statutes corpus grown 62 → **1,588 rows**: full text of all 358 BNS, 531 BNSS, 170 BSA sections + the full official IPC→BNS mapping table (521 IPC rows) + 8 USC provisions, sourced from the official NCRB Sankalan portal.
- Curated overlays preserved (subsection-precise mappings, rich change notes); non-curated IPC rows carry official headings + explicit repeal notes (no fabricated text).
- List cap raised to 600; comparator 404 message updated; seeder idempotent.

## 2026-07-08 — Task #11: Citation-parser & router regression tests (merged)
- 30 vitest unit tests: citation extractor (AIR, SCC, SCC OnLine, SCR, INSC, US reporters, edge cases) + retrieval-router intent selection (offline, DB mocked).
- Registered `citation-router-tests` validation step.

## 2026-07-08 — Task #9: Semantic similar-cases + statutes in production (merged)
- Production RDS: `embedding vector(1024)` + HNSW live; `/caselaw/documents/{id}/similar` returns `method: vector` via Bedrock Titan v2; full-corpus embedding running detached (resumable, ~400 docs/min).
- 62 statutes seeded on prod `nyvapp` DB (self-provisioning seeder); `/statutes/*` + `/retrieve` verified in prod.
- Ops hardening: 600s statement timeout for batch scans, id-cursor pagination, post-backfill ANALYZE.

## 2026-07-08 — Task #4: Platform surface (merged)
- **SSE streaming**: `POST /runs/stream` + chat message stream (Anthropic + Bedrock ConverseStream).
- **SDK v2**: templates + intelligence modules; `createRunStream` / `sendMessageStream` async-generator helpers.
- **MCP server**: `POST /api/mcp` (JSON-RPC 2.0, 8 tools incl. chat_action), Bearer MCP_TOKEN auth.
- **Analytics**: `api_usage` table + middleware, per-model AI tracking, `GET /analytics/usage`, dashboard widgets.
- **Templates**: table + 10 seeded items, Templates UI, Legal Chat draft grounding.
- **API tester**: fully schema-driven from live `openapi.json` (Playwright-verified).
- **Athena**: `/athena/status` + `/athena/search` (SELECT-only, scan-capped, kills over-budget queries).
- `POST /advise` grounded strategy advisory.

## 2026-07-08 — Task #3: Retrieval-first intelligence (merged)
- Deterministic citation extractor (IN + US formats, no LLM); `POST /citations/extract`.
- Embeddings plane: Bedrock Titan v2 (prod) / hash-embed (dev); pgvector KNN similar-cases with labeled FTS fallback; resumable `embed:corpus` script + HNSW index.
- Statutes plane: statutes table, FTS/lookup, IPC→BNS comparator API + UI, Statutes browser page.
- Retrieval router (`POST /retrieve`): citation → statute → compare → case-search → generate; `llmRequired`; every decision logged. `POST /runs` grounds drafts with real statute text.
- Reserved jurisdictions skip retrieval grounding safely.

## 2026-07-08 — Task #43: CrPC + Evidence Act live in production (merged)
- Production statutes corpus reseeded from 1,588 → 2,279 rows: full CrPC 1973 (510 sections) + Indian Evidence Act 1872 (181 sections) with official BNSS/BSA mappings, alongside BNS/BNSS/BSA/IPC/USC.
- Rebuilt API bundle + static dashboard shipped to EC2 (S3 → SSM flow); CRPC/IEA code filters and Old→New comparator now work on nyayasearch.nyayasiddhi.online.
- Prod smoke passed: `/api/statutes?code=CRPC` and `?code=IEA` return real section text on the live domain.
- Fixed a crash-loop on redeploy: `@aws-sdk/s3-request-presigner` (esbuild external) npm-installed in `/opt/nyv/api`.
- Added `scripts/upload-deploy.mjs` (uploads API bundle, seed script, and static tarball to the S3 distribution bucket).

## 2026-07-08 — Task #2: Legal Chat workspace (merged)
- Claude-style Legal Chat: multi-file upload (PDF/DOCX/TXT via unpdf/mammoth), conversation history + title search, per-conversation memory, brief/detailed toggle, copy + save-as-PDF.
- Six AI action modes: summary, extract, case_details, draft, intelligence, predictions (with mandatory not-legal-advice disclaimer); extract/case_details are retrieval-first (regex facts + authority grounding, Zod-validated JSON).
- 7 new API endpoints + `chat` SDK module; `chat_conversations` / `chat_messages` / `chat_documents` tables (mirrored into prod bootstrap).
- Fixed Drizzle nested-select count bug via separate groupBy queries.

## 2026-07-08 — Task #6: Reserved-jurisdiction regression net (merged)
- 10 API tests (vitest + supertest) + 6 UI tests (jsdom + Testing Library): GCC/UK/EU/SG can never break search or runs; coming-soon panels render and recover.

## 2026-07-08 — Task #5: Jurisdiction selector live in production (merged)
- Rebuilt API + static dashboard shipped to EC2; nyayasearch.nyayasiddhi.online now serves the global jurisdiction selector.

## 2026-07-08 — Consolidated product note
- Created `docs/NYS-Knowledgesearch-Product-Note.md` merging all five planning docs + live codebase audit.

## 2026-07-08 — Task #1: Jurisdiction selector (merged)
- Jurisdiction enum (IN, US, GCC, UK, EU, SG) across OpenAPI/API/SDK/UI; coming-soon states; jurisdiction-aware grounding; persistent sidebar picker.

## Earlier foundation (pre-changelog)
- Full IN corpus ingestion to RDS (SC 1950–2025 + 25 HCs, 6.77M+ docs); production domain + ALB + superadmin auth; Bedrock Converse production AI (Nova Pro); benchmark library (144 tasks/24 areas); grounded agentic runs; AI-judge rubric grading; citation verification; typed SDK; dashboard.
