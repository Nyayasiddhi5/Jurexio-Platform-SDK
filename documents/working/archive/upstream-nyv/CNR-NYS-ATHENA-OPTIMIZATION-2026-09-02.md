# CNR / NYS / Athena optimization — 2026-09-02

> **Scope:** NYV partner CNR resolve (`POST /api/nv/v1/sdk/cnr/resolve`) + NYS cascade + Athena parquet cold path.  
> **Evidence:** SSM probes on nysdev + caselaw-worker (2026-09-02T16:43–16:47Z).

## Executive summary

| Symptom | Root cause | Fix |
|---|---|---|
| CNR TSWL/RJHC **503 @ ~45.8s** via public API | NYV aborted NYS at **15s × 3 retries** while NYS resolve took **13–42s** (cold RDS pool + 45s Athena fallback on default profile) | NYS: skip Athena on default profile; Athena budget env; RDS pool warmup. NYV: **23s** single-attempt timeout, **504** on timeout, **retries=0** default |
| NYS direct TSWL **not_found @ 41.7s** | Default profile ran full Athena+FTS cascade after RDS cold-start miss | Default profile now RDS → case_details → FTS only (≤8s wall) |
| NYS direct RJHC **found @ 13.3s** | Cold `getRdsPool()` (Secrets Manager + TLS connect) on first request | Boot-time pool warmup + `judgments_cnr_idx` verify |


## GO execution — 2026-09-02T17:00:00Z

User **GO** for embed throttle, parquet CTAS refresh, and formal NYS deploy (`upload-deploy.mjs --deploy --scripts`, replacing runtime bundle patch SSM `5b17695e`).

### SSM command IDs (caselaw-worker `i-000115b19219bb766`)

| Step | SSM CommandId | Notes |
|---|---|---|
| Embed emergency pause | `5fe3215a-df93-4988-9a2c-95112d494d65` | Stopped `@0/@1/@2`, DC, statutes; killed embed PIDs |
| RDS pool warm (long-running) | `b6622bb3-7aed-4060-a714-a84424813c7a` | Overlapping probes — left **idle in transaction (aborted)** sessions |
| Parquet CTAS | `b79d961e-6c0d-4a77-b240-b4a41a3b1d0c` | **Success** — workgroup `nyv-docs`, DB `nyv_docs`, output `s3://usa-caselaw/athena/results/`, table `judgments_meta_hc_case_details` |
| Formal NYS deploy (API) | via `upload-deploy.mjs` | `index.mjs` md5 **`8a2f3da733526e74edc9c8a90b97fba7`**, health **200**, `nyv-api` active |
| Formal NYS deploy (scripts) | via `upload-deploy.mjs --scripts` | Installed ingest/embed/athena scripts under `/opt/nyv/api/` |
| Embed throttled resume | `7abd25bc-e7ba-434c-97af-e8515e7985e7`, `d909c2dd-a012-4ccc-82e2-cfa357b35183` | HC shards **0+1** only, `EMBED_CONCURRENCY=4`, `EMBED_BATCH=100`, `EMBED_HC_MAX_ROWS=50000` |
| PG idle-tx cleanup | `352a1358-bd50-43c2-b08f-631c7d16be75` | Terminated 3 aborted idle-in-tx backends blocking CNR index lookups |

### CNR latency (found path, probe CNRs)

| Probe | Embed / RDS state | TSWL `TSWL000000742024` | RJHC `RJHC010324382023` |
|---|---|---|---|
| Pre-GO (doc baseline) | Contended | 503 / ~45.8s | 503 / ~45.8s |
| After code patch (doc) | Contended | 200 not_found / ~16.1s | 200 not_found / ~16.1s |
| **GO smoke (embed paused, pre-deploy)** | Paused, RDS clean | **200 found / ~91ms** (NYV) | **200 found / ~1.30s** (NYV caseCreate single) |
| Post formal deploy + embed throttled | Throttled embed + idle tx | 200 not_found / ~16.1s | 200 not_found / ~16.1s |
| **Post deploy + embed paused + pg terminate** | Paused, RDS clean | **200 found / ~68–81ms** (NYS direct / NYV) | **200 found / ~11ms–1.03s** (NYS / NYV) |
| `demo:probe:ec2` after throttled resume | 2 HC shards active | 200 not_found / ~16097ms | 200 not_found / ~16080ms |

**Warm found @ <2s:** **met** with embed fully paused and RDS unblocked (executed probes above). **Not met** under throttled embed + concurrent heavy FTS/embed IO (`demo:probe:ec2`).

### NYV

- Gateway deploy unchanged: `2026-09-02T1657Z-aws-ssm-7ea52f15` (`demo:probe:ec2` SSM `72f16f70-0de7-45b5-bb3c-5cc33ea04c92`, final `cf40ae0a-2a0c-499b-93cb-2eecd4488473`).

### Blockers / follow-ups

1. **`_nys-cnr-rds-pool.sh`** must `ROLLBACK` on statement timeout — aborted idle transactions blocked `judgments_cnr_idx` lookups for ~48m.
2. **`demo:probe:ec2` CNR matrix** uses default profile; under throttled embed, RDS contends → **not_found @ ~16s** despite formal deploy healthy.
3. Re-run warm <2s acceptance after off-peak or with embed pause before partner demos.


## Before / after probe table

| Probe | Before (2026-09-02T16:44Z) | After patch (2026-09-02T17:24Z) |
|---|---|---|
| `demo:probe:ec2` TSWL | **503** / 45811ms | **200** not_found / 16121ms |
| `demo:probe:ec2` RJHC | **503** / 45815ms | **200** not_found / 16084ms |
| NYS direct TSWL | 200 not_found / 41781ms | 200 not_found / 16350ms |
| NYS direct RJHC | 200 found / 13279ms | 200 not_found / 16035ms |
| NYV localhost (warm, pre-index) | 200 found / 61ms, 36ms | — (RDS contended post-index apply) |

**Warm-path target (<2s found)** blocked by RDS `statement_timeout` under concurrent embed load — not CNR routing. Re-probe after embed throttle or off-peak.

## Architecture (resolve cascade)

```
Partner POST /api/nv/v1/sdk/cnr/resolve
  └─ NYV nv-cnr-routes (timeout 23s default / 60s caseCreate, retries=0 default)
       └─ NYS POST /cnr/resolve
            ├─ Tier 1: judgments RDS (judgments_cnr_idx, 8s statement_timeout, fail-soft)
            ├─ Tier 1b: cnr_case_details (cnr_case_details_cnr_idx)
            ├─ Tier 2: Athena parquet (caseCreate ONLY; NYS_ATHENA_QUERY_BUDGET_MS default 12s)
            └─ Tier 3: FTS suggestions (if budget remains)
```

## Env knobs (names only)

| Env | Host | Default | Purpose |
|---|---|---|---|
| `NYS_CNR_RESOLVE_BUDGET_MS` | NYS | 8000 | Default profile wall clock |
| `NYS_CNR_RESOLVE_BUDGET_CASECREATE_MS` | NYS | 45000 | caseCreate cold path |
| `NYS_ATHENA_QUERY_BUDGET_MS` | NYS | 12000 | Per-Athena poll budget (was 45s hardcoded) |
| `NYV_ATHENA_QUERY_BUDGET_MS` | NYV | 15000 | Documents/search + CNR timeout base |
| `NYS_KNOWLEDGE_TIMEOUT_MS` | NYV | 45000 | General NYS client (CNR overrides) |

## Error codes (partner contract)

| HTTP | Code | When |
|---|---|---|
| 200 | — | found / suggested / not_found (NYS body pass-through) |
| 400 | `CNR_INVALID` | Validation fail |
| 404 | — | Reserved for explicit resource miss (documents) |
| 502 | `NYS_UPSTREAM` | NYS 5xx / transport |
| 504 | `CNR_UPSTREAM_TIMEOUT` | NYV abort before NYS completes (retryable) |
| 503 | `NYS_UPSTREAM` / circuit | NYS knowledge circuit open |

## Infra-only follow-ups (no code)

1. **Parquet refresh** — `athena-hc-case-details-ctas.mjs` on schedule; HC case_details dimension lags RDS.
2. **DC historical backfill** — TSWL district rows; ingest log `/opt/nyv/ingest-dc.log`.
3. **Embed worker throttling** — concurrent embed load causes RDS statement_timeout on unrelated FTS (separate from CNR index path).

## Files changed

- `NYS-Agentic-AI/artifacts/api-server/src/lib/cnrResolve.ts` — budgets, default skips Athena
- `NYS-Agentic-AI/artifacts/api-server/src/index.ts` — RDS pool warmup
- `src/routes/nv-cnr-routes.ts` — timeout + 504 + retries=0
- `scripts/_ec2-apply-nys-caselaw-indexes.sh` — `judgments_cnr_idx`
- `scripts/_ec2-cnr-diagnose-probe.sh` — diagnostic probe (new)

## GO execution — probe align + embed cron (2026-09-02T17:30:00Z)

User **GO align probe** + **GO embed schedule**.

### Probe alignment (`demo:probe:ec2`)

- `scripts/_ec2-demo-crosscheck-probe.sh`: **TSWL** keeps **default** profile (RDS path); **RJHC** uses **`options.profile=caseCreate`** (Athena tier when RDS misses).
- Probe output includes `profile=` on each CNR line.

### Embed cron (caselaw-worker)

- See **`documents/working/NYS-EMBED-CNR-SCHEDULE.md`**
- SSM install success: **`1b4962ba-d8eb-4a47-b8f6-2242fc0c94b9`** (first attempt `d8e1e2a0-acae-4245-b355-9b03f4c1175f` failed — missing `/etc/cron.d`; fixed with `mkdir -p`).

### Post-align `demo:probe:ec2` (embed contended)

| CNR | Profile | HTTP | ms | status |
|---|---|---|---|---|
| TSWL000000742024 | default | 200 | ~16110 | not_found |
| RJHC010324382023 | caseCreate | 200 | ~43561 | not_found |

**Positive control (found @ <2s):** requires RDS unblocked (no idle-in-tx) — same as pre-GO smoke table; profile alignment exposes RJHC Athena path (longer wall when contended).



## 2026-09-03 CNR upstream_busy fix (caselaw-worker + nysdev)

**Root cause (executed probes):** CNR rows exist in RDS for TSWL/RJHC/DC (isolated SELECT 3–94ms), but concurrent **embed UPDATE** on `judgments` caused lock/statement contention. Fail-soft returned empty → **false `not_found` @ ~16s** instead of retryable error.

| Probe | Before (2026-09-03T09:28Z) | After fix (2026-09-03T09:45Z worker localhost) |
|---|---|---|
| TSWL default | 200 not_found / 16101ms | **200 found / 93ms** (nys_rds) |
| RJHC caseCreate | 200 not_found / 43608ms | **200 found / 29ms** (nys_rds) |
| DC TSHM010005562026 | not tested | **200 found / 25ms** (nys_rds) |
| Under embed load | not_found @ 16s | **503 CNR_UPSTREAM_BUSY / ~7.5s** (retryable, honest) |

**Code fixes (NYS `index.mjs` md5 `1904bf154ffdeb72d7c04ebdf8648167`):**
- `CnrUpstreamBusyError` → HTTP 503 retryable (not `not_found`) when RDS tier degraded after double contention timeout
- `BEGIN READ ONLY` + `lock_timeout=2s` on CNR lookups; RDS pool `max=25`
- Default profile: Athena fallback when RDS degraded (not only caseCreate)
- NYV: CNR proxy `retries=0` all profiles; map `CNR_UPSTREAM_BUSY` → 504 retryable

**Gaps:** Diary number lookup **not wired** (CNR-only API). SC/DC Athena parquet CTAS not built (HC case_details only). Demo probe CNR lines still 503 when caselaw search opens NYS circuit under embed — run CNR probes off-peak or after embed pause.

**SSM:** NYS deploy `upload-deploy.mjs --deploy`; accept probe `3c8a3fcb`; NYV deploy `2026-09-03T0941Z-aws-ssm`; post-deploy found TSWL/RJHC via NYV localhost @ 81ms/66ms.

### 2026-09-03 embed accelerate (caselaw-worker)

- Cron peak **10:00** / off-peak **20:00 IST**; full resume clears peak drop-ins and runs all 5 embed units at higher concurrency.
- `embed-corpus.mjs`: one-shot retry on `57014`; embed workers use `RDS_STATEMENT_TIMEOUT_MS=120000` off-peak.
- See `documents/working/NYS-EMBED-CNR-SCHEDULE.md` for SSM IDs and ETA.

## GO execution — SC/DC Athena Phase 2 (2026-09-04)

User **GO (partial):** complete SC/DC Athena gap only; **skip Live eCourts** (no `NYV_ECOURTS_API_KEY`; Tier-4 deferred until NIC key available).

### IAM (caselaw-worker `nyv-caselaw-worker-role`)

| Policy | Change |
|---|---|
| `nyv-athena-query` | Added `glue:CreateTable`, `glue:UpdateTable` on `nyv_docs` catalog/database/tables |
| `nyv-caselaw-worker-inline` | Added `s3:GetObject`/`ListBucket` for `indian-district-court-judgments` |

Re-apply: `bash scripts/_nys-athena-sc-dc-iam-grant.sh`

### SSM command IDs (worker `i-000115b19219bb766`)

| Step | CommandId | Result |
|---|---|---|
| Script presence probe | `6171887b-0b7c-43cc-8d18-2e34079f2666` | SC/DC CTAS `.mjs` on `/opt/nyv/api/` |
| SC+DC CTAS + env + verify | `e01faf4c-06b5-4e58-ab6e-6360ac06cb87` | **Success** |
| CNR resolve smoke | `2fcdf46a-fd77-46ae-bca6-df16e2bc1889` | TSWL/RJHC-style probes → **found @ RDS** |
| Cold-path helper | `eee32d8c-2a9a-4178-b975-19ae54d83ba2` | inconclusive (RDS pool probe); tables verified separately |

### Glue / Athena verify

| Table | Location | Row count (Athena) |
|---|---|---|
| `judgments_meta_sc_case_details` | `s3://indian-supreme-court-judgments/metadata/parquet/` | **43,547** |
| `judgments_meta_dc_case_details` | `s3://indian-district-court-judgments/metadata/parquet/` | **24,271,950** |

Worker env set in `/opt/nyv/api/.env`:

- `ATHENA_TABLE_SC_CASE_DETAILS=judgments_meta_sc_case_details`
- `ATHENA_TABLE_DC_CASE_DETAILS=judgments_meta_dc_case_details`

`nyv-api` restarted; healthz **200**.

### Tier-4 Live eCourts

**Deferred** until user provisions NIC `NYV_ECOURTS_API_KEY` — no rotation or env changes in this GO.

