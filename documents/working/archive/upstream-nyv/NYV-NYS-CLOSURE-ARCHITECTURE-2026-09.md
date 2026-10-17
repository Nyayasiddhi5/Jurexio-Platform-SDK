# NYV ↔ NYS closure architecture (2026-09)

> **Tracker:** `NV-NYV-NYS-CLOSURE-ARCHITECT-001` · **Scope:** NYV gateway resolve/draft surfaces that consume NYS corpus tiers.  
> **Field catalog + gap plan:** [`NYV-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md`](./NYV-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md) (`NV-CASE-CORPUS-FIELD-GAP-001`).

## Corpus layers → NYV routes

| Layer | Store | Approx scale | Feeds (API fields) | NYV entry |
|---|---|---|---|---|
| **Tier-1 case-api** | RDS `case_api_search` + DuckDB `case_lookup_full` | ~57M RDS / ~78M DuckDB | `fields.*`, inline `hearings`, `counts`, SC `diary_no` | `lookupCnrViaCaseApi` / `lookupDiaryViaCaseApi` |
| **Tier-2 legacy** | `nyv_caselaw.judgments`, `cnr_case_details`, Athena `parquet_case_details`, S3 PDFs | ~26M judgments / ~797k dimension | Acts, deep hearings, `documents[]`, `caseCreate`, optional `extractPreview` | `fetchLegacyCnrResolve` → NYS `POST /cnr/resolve` |
| **Tier-3 eCourts NIC** | Live API (opt-in) | n/a | On-demand fetch when corpus miss | `nv-ecourts-live-fetch.ts` |
| **Tier-4b portal** | Async job queue | n/a | Portal scrape job id on `not_found` | `nv-ecourts-tier4b-worker.ts` |
| **Kanoon (P6)** | api.indiankanoon.org | external | `candidates[]` additive | `nv-kanoon-enrichment.ts` |

**Honesty lock:** every path keeps `claimEcourts: false` until a verified live eCourts fetch succeeds.

## Field provenance (resolve)

| Partner field | Primary tier | Merge (P2a) when sparse |
|---|---|---|
| `cnr` | case-api CNR row; SC diary often empty | legacy may publish CNR when registered |
| `fields.hearings` | case-api inline + `/timeline` (P2b) | legacy union dedupe `(date,purpose)` |
| `fields.actsSections` | case-api | legacy Athena / `cnr_case_details` |
| `fields.partyDetails` | case-api PII columns (sparse) | legacy `caseCreate` parties |
| `extractPreview` | legacy PDF extract (`includeExtractPreview`) | merged onto case-api `found` |
| `sourcesTried[]` | tier tags | union on P2a / cascade |

## Closure status (NYV tasks from master inventory)

| ID | Item | Status | Evidence |
|---|---|---|---|
| C-06 | Diary P2a legacy merge without CNR | **DONE** (2026-09-22) | `shouldAttemptLegacyCaseApiEnrichment`, `courtType` on legacy resolve, probe `_ec2-diary-legacy-merge-probe.sh` |
| C-14 | Procedural `draftProfile.limitation` (days) | **DONE** (2026-09-22) | `PROCEDURAL_LIMITATION_DAYS` in `nv-nyayatimeline-service.ts`; vitest limitation-fee |
| C-19 | Kanoon hook | **DONE** (2026-09-22) | Auto-enable when `INDIA_KANOON_API_KEY` set; mock vitest |
| C-20 | `extractPreview` on case-api path | **DONE** (2026-09-22) | Legacy fetch + merge into case-api resolve |
| #17 | `includeTimeline` partner doc | **DONE** | CNR one-pager §1 + SDK `CnrResolveOptions` |
| #29/#33 | Caselaw hints + degraded envelope | **DONE** (doc + A-048 overlay) | `nv-knowledge-plane-routes.ts` 200 degraded envelope; overlay FTS guidance |

## NYS / caselaw-worker closure (2026-09-22T06:35Z)

SSM target: `i-000115b19219bb766` via `scripts/_nys-ssm-run.sh`. **No** key rotation, **no** destructive RDS, **no** force refresh of `cnr_case_details`.

| Inv # | Checklist | Status | Evidence (SSM command id) | Notes |
|---|---|---|---|---|
| **#9** C-04 Siddhanta merge | **DONE** | `429214fc` status · `5a831da5` overlap | Merge pid **464414** run log `siddhanta-cnr-merge-20260921T040156Z.log` finished: scanned **796,960**, candidates **502,107**, **updated=0** (intersection-only). Overlap in 5k recent details: **58/5000** vs HC staging **17.98M**. |
| **#4** C-03 P1 2025 ETL | **DONE** | `b5814025` · `a2eb34bf` | ETL **not running**; log `p1-etl-20260920T052456Z.log` **`NV-CASE-API-P1-ETL complete`** totals updated **893,969** acts. **2025+ slice:** **9.89M** rows; **acts_json ~76.3%** (**7,544,417** / **9,887,439**); diary/PII **0%**. |
| **#8** `cnr_case_details` refresh | **DONE** (monitor) | `9ba498ce` | **796,960** rows; **`max_updated=2026-09-21T17:41:25Z`**. Skipped `_nys-ops-force-cnr-details-refresh.sh` (checkpoint clear). Daily wrapper **`/opt/nyv/api/nys-cnr-index-sync.mjs`** (judgments `delta` + `ingest-cnr-case-details`); cron not installed on worker (`grep /etc/cron.d` empty) — schedule per `NYS-EMBED-CNR-SCHEDULE.md` / `cron(30 17 * * ? *)` UTC. |
| **#3** case-api vs judgments gap | **DONE** (architecture) | `7b4bf85a` · `9ba498ce` | **`nys-cnr-index-sync.mjs`** present (1.8k wrapper + **`ingest-rds.mjs`**). National **`delta-dc` DONE** → **`judgments` DC 9,523,847**. Remaining DC `not_found` on Tier-1 is **case_api_search coverage**, not missing judgments ingest; NYV **unified cascade** (Tier-2) is the documented closure. No new ingest **GO** run. |
| **#13** C-21 NYS dist rebuild | **BLOCKED** | `5839fda7` | Worker: **Node 20.20.2**, **pnpm ABSENT**, **no** `NYS-Agentic-AI` source tree on host. Deployed bundles at **`/opt/nyv/api/`** (e.g. `index.mjs` 6.7MB). **Fix:** build on workstation (`artifacts/api-server/build.mjs`) → `NYS-Agentic-AI/scripts/upload-deploy.mjs`, or install pnpm + clone source on worker. |
| **#15** C-08 SC diary timeline | **BLOCKED** (data) | `925ce4cc` | One-pager **§10**: timeline is **CNR-keyed**. Live nysapi: diaries **`17329/2025`**, **`264/2024`** → **200 found**, **`cnr_len=0`** → **`/timeline` skipped**. Product honest-limit unchanged; not an NYV code fix. |
| **#7** acts sparse | **CLOSED (beta)** | `a2eb34bf` · `26631bf4` | P1 acts fill **~76%** on 2025+ slice; NYV **`acts_json`** map + P2a merge. **P3** cnr-details **DONE** 2026-09-22 (8GB/limit5, 179k upserts, `max_updated` 2026-09-22). |

### NYS verify chain

1. `bash scripts/_nys-ssm-run.sh scripts/_nys-ops-poll-status.sh`
2. `bash scripts/_nys-ssm-run.sh scripts/_ec2-case-api-p1-fill-probe.sh`
3. `bash scripts/_nys-ssm-run.sh scripts/_ec2-siddhanta-cnr-merge-status-probe.sh`

## Case corpus beta closure (2026-09-22 — `NV-CASE-CORPUS-BETA-CLOSURE-001`)

| Gap | NYV ship | NYS/data | Status |
|---|---|---|---|
| Live status / next hearing | `applyCorpusBetaHonestyEnvelope`, `meta.fieldAvailability.tier3_required`, SDK **5.1.7** | Tier-3 NIC | **CLOSED (beta)** / **BLOCKED (GO)** for live |
| Acts on resolve | `acts_json` in adapter + legacy merge | RDS **76%** 2025+ acts_json | **CLOSED (beta)** |
| Party PII | `corpus_unavailable` + passthrough | **0%** RDS PII cols | **PARTIAL (data)** |
| RDS ↔ DuckDB lag | `meta.provenance.tableVersion` + ops §5.5 in gap plan | watermark **`v_20260917T071752Z`** | **PARTIAL (data)** |
| Witnesses | `manual_required` + `betaReadiness.edjJobPath` | not in corpus | **CLOSED (beta)** |

Detail: [`NYV-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md`](./NYV-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md) §5.0.

## Still BLOCKED (cross-cutting)

| Item | Why |
|---|---|
| C-02 PII fill | Needs new PII source / NYS ETL (diary/PII still **0%**) — beta honesty **shipped** |
| C-09/C-10 live eCourts | NIC key + explicit **GO** — beta `tier3_required` messaging **shipped** |
| C-15 courtFee state packs | SME per-state tables |
| C-21 NYS dist rebuild | Worker has no pnpm / no source tree (see table above) |
| C-08 SC diary `/timeline` | Pending SC rows lack CNR in corpus |
| Embed soak C-01 | Continuous NYS job (not primary this batch) |

## Deploy / verify chain

1. `npm run guardrail` (NYV)
2. `npm run dev:deploy:ec2` (user **GO**)
3. `npm run partner:smoke:ec2`
4. `bash scripts/nv-diary-legacy-merge-probe-ec2.sh` (SC diary legacy tiers)
