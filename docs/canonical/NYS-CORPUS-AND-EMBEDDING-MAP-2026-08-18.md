# NYS caselaw corpus — data sources, ingest, embedding, and the optimisation plan

> **Purpose.** The reference I should have had before touching the embedding pipeline, so a
> future "optimise the embedding" request needs zero discovery. All figures measured
> 2026-08-18 against `nyv-caselaw-pg` (SSM `nys-embed-gap`, `nys-embed-runtime`,
> `nys-deployed-check`, `nys-shard2-diag`, `nys-shard2-tcp`).
> **Companion:** `AGENT-OPERATING-MAP-2026-08-18.md` (hosts, the two-databases trap).

---

## 1. Corpus state — measured, not estimated

`judgments` on `nyv-caselaw-pg` (db `nyv_caselaw`). Total **26,259,225** rows.

| court_type | total | unembedded | coverage |
|---|---|---|---|
| **sc** (Supreme Court) | 43,505 | **0** | **100 %** |
| **hc** (High Courts) | 20,438,646 | 4,637,757 | 77.3 % |
| **dc** (District Courts) | 5,690,538 | 3,371,437 | 40.8 % |
| us-fed | 59,781 | 59,781 | 0 % |
| us-ny | 26,755 | 26,755 | 0 % |

### Supreme Court is COMPLETE — 1950 → 2026

Verified per year: **every SC year has `todo = 0`**, including 2026 (172), 2025 (897),
2024 (782) … back through the earliest years. `EMBED_SKIP_SC=1` on the HC shards and the
loop comment *"SC already ~complete at ~43.5k"* are both **correct**.

> **Correction on record.** My action-plan item **P0-6 ("Supreme Court is the least
> embedded corpus")** was **WRONG** and is withdrawn. I compared SC's embedded count
> (43,497) against the *whole-corpus* total (26.3 M) and inferred a precedential blind
> spot that does not exist. An SC backfill would have spent Bedrock budget on zero rows.
> The `sc` checkpoint being "stale since 2026-07-14" means **finished**, not stalled.

### The real gap is the newest HC years — and nothing is embedding them

| year | HC total | HC unembedded | | DC total | DC unembedded |
|---|---|---|---|---|---|
| **2026** | 752,152 | **752,152 (100 %)** | | 351,890 | 0 |
| **2025** | 2,033,186 | **2,033,186 (100 %)** | | 929,203 | 0 |
| **2024** | 1,747,681 | 1,510,790 (86 %) | | 824,223 | 0 |
| 2023 | 2,078,757 | 340,640 (16 %) | | 984,958 | 984,958 |
| 2022 and older | — | **0** | | — | fully unembedded ≤2023 |

**HC 2025 and 2026 are 0 % embedded — 2.79 M of the most recent judgments have no vector.**
DC is the mirror image: 2024–2026 complete, 2023-and-older untouched.

---

## 2. Why the newest years are last: `ORDER BY id`

`embed-corpus.ts:137` (deployed `embed-corpus.mjs`, mtime 2026-08-11):

```sql
SELECT id, title, petitioner, respondent, court, disposal_nature, description
FROM judgments WHERE embedding IS NULL <scopeCond> AND id > $2 <shardCond>
ORDER BY id LIMIT $1
```

Ids **do** correlate with year, and monotonically — measured, non-overlapping ranges:

| year | min_id | max_id |
|---|---|---|
| 2026 | 19,730,303 | 20,528,841 |
| 2025 | 17,697,117 | 19,730,302 |
| 2024 | 15,949,436 | 17,697,116 |
| 2023 | 13,870,679 | 15,949,435 |

So `ORDER BY id ASC` + a resumable `last_id` walks the corpus **oldest → newest**. HC
shards sit at `last_id ≈ 16.3 M`, i.e. **inside 2024**, and will reach 2025–2026 only after
another ~3.4 M rows. That is why the most-cited recent judgments are last in line.

**Two ways to fix, both cheap:**

1. `ORDER BY year DESC, id DESC`. Planner check: uses `judgments_court_year_idx (court_type, year)`
   via **Index Scan Backward + Incremental Sort** (`Presorted Key: year`) — **no new index
   needed**. Requires flipping the checkpoint predicate from `id > last_id` to `id < last_id`.
2. Keep `ORDER BY id` and add a **year floor** (`AND id >= 19730303` for 2026-only), running
   a newest-first window pass, then lowering the floor. Smaller change, reuses checkpoints.

There are **0 rows with NULL year**, so either approach covers the whole corpus safely.

---

## 3. Data sources — S3, Parquet, Athena

### Source buckets (`artifacts/api-server/src/ingest-rds.ts`)

| constant | bucket | notes |
|---|---|---|
| `SC_BUCKET` | `indian-supreme-court-judgments` | metadata Parquet |
| `HC_BUCKET` | `indian-high-court-judgments` | metadata Parquet |
| `SC_PDF_BUCKET` | `your-supreme-court-data-bucket` | **placeholder name** — PDF path builder `s3://<bucket>/data/tar/year=<Y>/english/<path>_EN.pdf` |

Key layout: **`metadata/parquet/year=<YYYY>/`** — year-partitioned, which is what makes a
year-scoped ingest or backfill natural. Read with `hyparquet`
(`asyncBufferFromUrl` + `parquetReadObjects`), listed via `ListObjectsV2`, region `ap-south-1`.

`ingest-rds.ts` maps ~25 metadata fields (`cnr`, `citation`, `judges`, `authorJudge`,
`caseType`, `decisionDate`, `disposalNature`, `firNo`, `lowerCourt`, `petAdvocate`, …).
Note `dateStr()` handles the source's `DD-MM-YYYY` (e.g. SC `13-05-2020`) and rejects years
outside 1800–2100. **`ingest-rds.ts` handles `sc` and `hc` only** — DC rows arrive by
another route (not located in this tree; ask the architect).

### Athena

`scripts/athena-run.mjs` — region `ap-south-1`, results to **`s3://usa-caselaw/athena/results/`**.
Referenced table locations: `s3://usa-caselaw/athena/judgments_meta_hc/` and
`.../judgments_meta/`. `run(sql, db)` polls every 1.5 s and reports `DataScannedInBytes`;
`results(id, max)` prints rows. Used for corpus-scale metadata questions without hammering RDS.

`s3://nyv-sdk-distribution/caselaw-worker/api/` is the deploy artefact path for this host.

---

## 4. Embedding pipeline

**Model: `amazon.titan-embed-text-v2:0` via Bedrock** (`BEDROCK_REGION`), 1024-dim →
`judgments.embedding vector(1024)`. Do not switch bulk vectors to Cohere or a chat LLM.

**Worker** `/opt/nyv/api/embed-corpus.mjs` — `node embed-corpus.mjs <maxRows> <batchSize> <scope>`
where scope ∈ `all|sc|hc|dc` (**the deployed build accepts `dc`; the local submodule source
at `embed-corpus.ts:42` still lists only `all|sc|hc` — the checkout lags the host**).
It is shard-aware (`EMBED_SHARDS`/`EMBED_SHARD`), uses a dedicated client with
`SET statement_timeout = '600s'`, embeds `concurrency` rows per slice, does a per-row
`UPDATE ... SET embedding`, then upserts `embed_progress`.

**Loop** `/opt/nyv/api/nv-caselaw-embed-loop.sh` — HC pass → optional `all` pass → SC pass
(skipped by default). Guard is a **global** `pgrep -f embed-corpus.mjs`.

**Units** (`systemctl`, all `active since 2026-08-11 18:03`, `restarts=0`):

| unit | scope | concurrency | maxRows |
|---|---|---|---|
| `nyv-caselaw-embed-loop@{0,1,2}` | hc, shard i of 3 | **8** | 200,000 |
| `nyv-caselaw-embed-dc` | dc | **6** | 80,000 |

`embed_progress` checkpoints (2026-08-18): `hc:s0of3` 16,297,785 · `hc:s1of3` 16,295,869 ·
`hc:s2of3` **14,926,988** · `dc` 23,380,056 · `sc` 20,526,057 (done) · `all` 5,921,950 (idle since 07-30).

### Measured throughput and headroom

- ~200 rows per ~50 s per worker ⇒ **~14 k rows/hour** per worker; 3 live workers ⇒ ~43 k/h.
- **`ThrottlingException` = 0** in the last 3,000 log lines.
- **Host is idle: 2 vCPU, loadavg 0.10, 787 MB of 7.8 GB used, disk 7 %.**

So throughput is limited by **`EMBED_CONCURRENCY=8/6`, not by CPU, memory, or Bedrock
throttling**. At the current rate the 8.0 M remaining rows take **~7–8 months**.

---

## 5. HC shard 2 is dead — a half-open TCP socket, not a crash

**Symptom.** `hc:s2of3` last advanced **2026-08-16T18:46** (~40 h ago) while shards 0/1
advanced minutes ago. `systemctl is-active` = **active**, `NRestarts` = **0**, so nothing
alerted and the loop is legitimately in `do_wait`. One third of HC capacity has been
silently dark for ~2 days.

**Diagnosis (a hypothesis I formed and then disproved twice).**
I first blamed the global `pgrep` guard — wrong: shard 2 *has* a live child. I then blamed a
missing `statement_timeout` — also wrong: the worker sets `600s`.

The evidence that settles it:

| observation | meaning |
|---|---|
| worker PID 1836874: elapsed **1d 16:16**, CPU **00:05:53** | alive, doing nothing |
| **2** open sockets, one `ESTAB → 172.31.8.7:5432`, **zero Bedrock conns** | blocked on Postgres, not on the model |
| `pg_stat_activity` pid 16125 state = **`idle`**, `state_change` **1d 11:35** ago | **the query FINISHED server-side** |
| host `tcp_keepalive_time = 7200` (2 h), pg client sets no `keepAlive` | a half-open socket is never detected |

The backend is `idle`, so **`statement_timeout` cannot fire** — it only bounds a *running*
query. The response was lost on a silently broken connection (NAT/idle reap), and the client
waits forever on a socket the kernel still calls `ESTAB`.

**Fixes, in order of leverage:** (a) kill PID 1836874 — the loop's `Restart=always` +
`|| true` will start the next pass immediately, recovering ⅓ of HC throughput now;
(b) set `keepAlive: true` + `keepAliveInitialDelayMillis` on the embed client, and/or
`query_timeout`, so a dead peer is detected in seconds; (c) add a liveness check that
compares `embed_progress.updated_at` per scope against `now()` and restarts a stalled unit.

---

## 6. Recommended plan

| # | action | why | risk |
|---|---|---|---|
| ✅ **1** | **Kill the hung worker** — **DONE 2026-08-18.** `hc:s2of3` moved 14,926,988 → 14,932,319; stale now <1 min after ~40 h dark | recovered ⅓ of HC throughput; zero code | none — resumed from checkpoint |
| **2** | **Newest-first: year floor or `year DESC`** | HC 2025+2026 are **0 %** embedded, 2.79 M of the most-cited rows; index support already exists | low — selection order only, checkpoints need care |
| ~~3~~ | ~~Raise `EMBED_CONCURRENCY` 8 → 16–24~~ **TRIED 2026-08-18 · MADE IT WORSE · REVERTED** | Measured: concurrency **8 → 47–48 s/batch (~14,900 rows/h/worker)**; **20 → 88–112 s/batch (~6,500–7,900)**. Host stayed 96.8 % idle, fetch is 0.1 s, RDS 39/1,713 conns, zero `ThrottlingException`. **Bedrock sheds load as per-invoke latency, not as an error**, so parallelism beyond 8 costs more than it buys. **8/6 is the empirical optimum — do not raise without re-measuring per-batch gaps.** | — |
| **4** | **Add `keepAlive` + `query_timeout` to the embed client** | makes the shard-2 class of hang self-healing | low |
| **5** | **Stall alarm on `embed_progress.updated_at`** | 40 h of silent dark capacity must not recur | none |
| **6** | Decide on `us-fed` / `us-ny` (86.5 k rows, 0 %) | India-only partners today; may be intentional | none — ask first |

**Order matters:** 1 and 3 are minutes and need no deploy; 2 changes the *ordering* of a
long-running job and should land after 1 and 3 prove stable.

**Open questions for the architect** (cheaper to ask than to probe):
- Where does **DC** metadata come from? `ingest-rds.ts` only handles SC and HC.
- Is `SC_PDF_BUCKET = "your-supreme-court-data-bucket"` a real bucket or an unfinished placeholder?
- Are `us-fed` / `us-ny` meant to be embedded, or parked?
