# NYS embedding + corpus — concrete plan (2026-08-18)

> **Ground rule for this plan:** almost everything needed **already exists**. The work is
> configuration, wiring and two small code changes — not new subsystems. Each item below
> states what exists, what is missing, and the smallest change that closes the gap.
> **RLS is explicitly out of scope.** **India-only** (`sc`/`hc`/`dc`); `us-fed`/`us-ny` stay parked.
> Evidence: SSM `nys-index-check`, `nys-bottleneck`, `nys-final-verify`, `nys-embed-gap`.

---

## 0. Corrected facts that change the plan

Three things I previously reported were wrong. They matter because they were driving priorities.

### 0.1 Coverage is **69.4 %**, not 5.56 % — the gauge is broken, not the corpus

`getCaselawEmbeddingCoverage()` (`rdsCaselaw.ts:282-294`) derives `embedded` from
**`MAX(embed_progress.total_embedded)`**, preferring the `all` scope. That counter is a
*per-run* tally, last written 2026-07-30 at **1,462,592**, and is not the number of embedded
rows. Real arithmetic from live counts:

| | rows | |
|---|---|---|
| corpus total | 26,259,225 | |
| unembedded (hc 4,637,757 + dc 3,371,437 + us 86,536) | 8,095,730 | |
| **actually embedded** | **18,163,495** | **69.17 %** (India-only: **69.40 %**) |
| **API reports** | 1,462,592 | **5.56 %** ← wrong |

Summing the per-scope counters instead gives 7.7 M — also wrong, because shards overlap and
reset. **Only `COUNT(*) FILTER (WHERE embedding IS NOT NULL)` is correct.** So my earlier
"5.56 % coverage, vector search is blind" P0 was reporting a **broken instrument**. The
`slo.overallStatus: degraded` it emits is therefore also false.

### 0.2 Supreme Court is 100 % embedded (`todo = 0` every year, 1950→2026) — P0-6 withdrawn.

### 0.3 Raising `EMBED_CONCURRENCY` **reduces** throughput

Measured, identical 200-row batches: **8 → 47–48 s** (~14,900 rows/h/worker);
**20 → 88–112 s** (~6,500–7,900). Host stayed 96.8 % idle, fetch is **0.1 s**, RDS 39/1,713
conns, zero `ThrottlingException`. Bedrock sheds load as **per-invoke latency**. Reverted to
8/6 — and this is exactly why the Gemini ask is the right lever: the ceiling is the
*provider*, not our machine.

---

## 1. What already exists (do not rebuild)

| capability | where | state |
|---|---|---|
| **Multi-provider embedding cascade** | `src/config/nv-embedding-cascade.ts` — `NV-EMBEDDING-CASCADE-001` | **Built.** Default `gemini,bedrock,openrouter,openai,local`; **Gemini already first**; per-provider models via env; **dim-safety** skips providers whose native dims ≠ target |
| **Gemini embeddings with configurable dims** | `src/services/nv-gemini-embeddings.ts` | **Built.** `generateGeminiEmbedding(text, dims)` passes `outputDimensionality`, so 1024 is a parameter, not a code change |
| **Multi-key Gemini rotation** | same file, `resolveGeminiApiKeys()` | **Built.** Returns a **list**, rotates to the next key on `429/403/quota/resource`, logs `keyIndex`. Your extra keys plug in with no code change |
| **Batch helper** | `generateGeminiEmbeddingsBatch()` | **Built** — but serial (`for` + `await`), see §3.2 |
| **NYS provider switch** | `artifacts/api-server/src/lib/embeddings.ts` | **Partial.** `embeddingProvider()` returns only `"bedrock" \| "hash"`; `EMBEDDING_DIM = 1024` hard-coded; `bedrockEmbed()` asserts the returned length |
| **HNSW vector index** | `judgments_embedding_hnsw USING hnsw (embedding vector_cosine_ops)` | **Exists** — this is the key constraint, see §2 |
| **Year-ordered index** | `judgments_court_year_idx (court_type, year)` | **Exists** — newest-first needs no new index |
| **Shard framework** | `EMBED_SHARDS`/`EMBED_SHARD`, `embed_progress` checkpoints | **Built and working** |

---

## 2. The hard constraint on adding Gemini: one index, one vector space

`judgments.embedding` is `vector(1024)` with a **single cosine HNSW index over the whole
column**. Titan v2 and Gemini produce **different, non-comparable vector spaces**. If half
the corpus is Titan and half Gemini, every ANN query ranks across two incompatible
geometries — recall degrades in a way that **looks like bad search, not a bug**, and FTS
would mask it exactly as it masked the coverage gauge.

So "Gemini followed by Bedrock" must mean **one of these**, never "mix into one column":

| option | shape | cost | verdict |
|---|---|---|---|
| **A — Gemini for the REMAINING 8.1 M only** | new rows Gemini, existing 18.2 M stay Titan | cheapest | **Rejected** — silently creates a two-space column behind one HNSW index |
| **B — Gemini as fallback only on Titan failure** | Titan primary, Gemini rescues a failed row | ~0 | **Rejected for bulk** — same mixing, just rarer and harder to detect |
| **C — second column + second index, cut over on completion** | `embedding_g vector(1024)` + own HNSW; backfill with Gemini; switch reads when coverage is comparable | +~90–130 GB storage on a 267 GB DB | **Recommended** — clean vector space, reversible, no read-path risk until cutover |
| **D — full re-embed of 26 M rows in place** | one space, but a long window of half-migrated data | highest | Only if storage forbids C |

**Recommendation: C.** It is the only option that keeps search correct while both providers
run, and it makes the price comparison real (both providers embedding the same rows).

**Prerequisite:** `AI_PROVIDER` and `BEDROCK_REGION` are the only provider env on the NYS host
— **there is no Google/Gemini key there**. The key exists on the **NYV** host and is reusable
per the architect, so this is a copy, not a procurement.

### Measured feasibility (2026-08-18, SSM `gemini-1024-feasibility`)

Tested with the existing NYV key against `gemini-embedding-2`:

| test | result |
|---|---|
| `outputDimensionality: 1024` | **OK, len = 1024** — matches `vector(1024)` exactly. Feasible. |
| `outputDimensionality: 1536` | OK, len = 1536 (what NYV currently uses for `knowledge_chunks`) |
| 10 sequential calls | **10/10 ok, 946 ms/call** |
| Titan baseline | 200 rows / 47–48 s at concurrency 8 ⇒ **~240 ms/row effective** |

**This changes the throughput argument.** A single Gemini call is ~4× slower per row than
Titan's *effective* rate, so Gemini is only a throughput win if parallelised — and
`generateGeminiEmbeddingsBatch()` is currently a **serial `for`+`await`** (§3.2), which would
make it ~4× *slower*, not faster. Parallelising the batch helper is therefore a **hard
prerequisite**, not an optimisation. And since Titan showed that raising concurrency *hurt*
because the provider adds latency under load, Gemini's usable concurrency must be
**measured, not assumed** — that is exactly what the 3.4 pilot is for.

**Key inventory — UPDATED 2026-08-18:** **3 nonprod keys are now provisioned on the NYS
host** (`nonprod-nys-gemni-key-1..3`), all validated at 1024 dims, stored as a
`GEMINI_API_KEYS` comma list with `NYV_EMBEDDING_DIMS=1024` pinned. That is 3× the
rotation headroom, which directly raises the usable concurrency ceiling the 3.4 pilot
will measure. **Rotate them at Google after the backfill** — they were pasted in chat and
also traversed SSM command history, because the host role has Parameter Store and
Secrets Manager list denied. Previously on NYV: exactly **1 distinct key** was present (`GOOGLE_API_KEY`, `GEMINI_API_KEY`,
`GEMINI_API_KEYS` all hold the same value). `resolveGeminiApiKeys()` rotates across a *list*,
so the offered additional keys translate directly into parallel headroom — **with one key,
429s cannot be rotated away**. Note also `NYV_EMBEDDING_DIMS=1536` on the NYV host: the NYS
path must pass **1024 explicitly** rather than inherit that default.

---

## 3. The plan

### Phase 1 — status 2026-08-18

| item | state |
|---|---|
| **1.2 stall detector** | ✅ **SHIPPED + ARMED.** `nyv-embed-stall-detector.timer`, 10-min interval, 1800 s threshold, fails closed, `sc`/`all` unmonitored by design. 3 dry-run acceptance tests passed. |
| **1.1 coverage gauge** | ✅ **SHIPPED + VERIFIED LIVE.** Endpoint now reports **69.69 %** with `approx: false` and per-court-type (sc 100 %, hc 77.55 %, dc 41.25 %); 2nd call **0.006 s** (cache works); the only SLO reason left is the honest `coveragePct < target 99`. Hardened after measuring: the scan is **249 s**, so it runs on a dedicated client under `SET LOCAL statement_timeout`, caches 30 min, and serves stale counts on failure rather than reporting 0 %. |
| ~~1.1 was BLOCKED~~ | ⚠️ **The "source drift" blocker was MY ERROR — withdrawn.** Needs a rebuild; the local NYS submodule checkout is **behind** the deployed build (`embed-corpus.ts:43` accepts only `all\|sc\|hc`, deployed accepts `dc`) and has no `node_modules`. Rebuilding from it would **delete DC embedding**. |
| **1.3 keepAlive** | ✅ **SHIPPED.** `rdsPool.ts` sets `keepAlive: true` + `keepAliveInitialDelayMillis: 10_000`. Root fix for the half-open socket the stall detector only caught after the fact. |
| ~~1.3 was BLOCKED~~ | ⚠️ Same withdrawn premise. Verified the `keepAlive`(10)/`query_timeout`(5) hits in the deployed bundle are **bundled `pg` internals defaulting to `false`**, not our config, so this is genuinely unfixed. |

**There was never any source drift.** I had been reading a **stale sibling checkout** at
`~/Desktop/nyayavigya-platform-5.0.0/NYS-Agentic-AI` (HEAD `2f26dc2`, 2026-07-17, whose git
remote points at an *archive* directory). The live source is **inside this workspace** at
`nyayavigya-platform-312/NYS-Agentic-AI` — clean, with `dc` scope, shard support,
`node_modules` and `dist`. A clean `npm run build` reproduces a **byte-identical** bundle
(`cmp` clean), so rebuilding cannot regress DC embedding. **Always build from the
in-workspace checkout.**

### Phase 2 — status 2026-08-18

**`EMBED_YEAR_MIN` implemented** (`embed-corpus.ts` + `nv-caselaw-embed-loop.sh`). Three
decisions worth keeping:
- **Year predicate AND an id floor.** The predicate alone still makes the pkey scan walk and
  discard every embedded row below the window — a cost that grows as the corpus fills and the
  likely source of the `statement timeout` errors already in the log. The floor
  (`MIN(id) WHERE year >= n`) skips them at the index level. Both are kept because id
  ordering alone would embed the wrong rows if ingest back-fills an old judgment under a new id.
- **A windowed run gets its own checkpoint** (`hc:s0of3:y2025`). Sharing the plain scope's row
  would jump `last_id` to ~20.5 M and **permanently skip the 2024-and-older backlog**.
- **The loop forwards the variable explicitly**, because `run_embed` builds the child env with
  `env`, so a value set only in the unit file would never reach the worker.

### Phase 1 detail — stop lying, cost nothing (do first)

**1.1 Fix the coverage gauge** (`rdsCaselaw.ts:282-294`) — **P0**
Replace `MAX(embed_progress.total_embedded)` with a real `COUNT(*) FILTER (WHERE embedding IS NOT NULL)`,
scoped to India court types, cached (it is a ~240 s scan — keep the existing cache TTL and
`approx` flag). Report **per-court-type** coverage, not one blended number, since sc=100 %,
hc=77 %, dc=41 % are three different stories.
*Verify:* endpoint reports ~69.4 % and `overallStatus` stops claiming `degraded` falsely.

**1.2 Stall detector** — **P0**
Shard 2 was dark ~40 h with `systemctl` reporting `active`. Add a check comparing
`embed_progress.updated_at` per scope against `now()`; if a scope exceeds ~30 min while its
unit is active, log at error and `systemctl restart` that unit. Small script + timer.
*Verify:* kill a worker's socket; the detector restarts it.

**1.3 Make the hang impossible** — **P0**
Add `keepAlive: true`, `keepAliveInitialDelayMillis`, and a `query_timeout` to the embed
client (`embed-corpus.ts`, and `rdsPool.ts` for the API). This is the actual fix for the
half-open socket; 1.2 is the safety net.
*Verify:* a dead peer surfaces in seconds, not never.

### Phase 2 — newest-first (the real corpus gap)

**2.1 Embed HC 2025 + 2026 before older years** — **P0**
2.79 M of the most-cited judgments are **0 % embedded** because selection is
`ORDER BY id ... AND id > last_id` and ids track year, so the walk is oldest→newest.
Two options; prefer the first:
- **Year-window pass:** add `EMBED_YEAR_MIN` and select `AND year >= $n`, keeping
  `ORDER BY id` and the existing checkpoints. **~5 lines, no checkpoint semantics change.**
- `ORDER BY year DESC, id DESC` — cleaner, uses `judgments_court_year_idx`
  (EXPLAIN-verified: Index Scan Backward + Incremental Sort), but inverts the
  `id > last_id` resume predicate and needs per-year checkpoints.

*Verify:* HC 2026 `todo` falls; older years unchanged.

### Phase 3 — Gemini as the throughput and cost lever

**3.1 Provision keys + provider switch on NYS** — **keys DONE 2026-08-18; switch pending**
- ✅ Gemini key(s) in `/opt/nyv/api/.env` (chmod 600) — 3 keys, all validated at 1024 dims.
- Extend `embeddingProvider()` to `"gemini" | "bedrock" | "hash"` and add a `geminiEmbed()`
  that reuses **NYV's existing** `nv-gemini-embeddings.ts` logic — key list, 429 rotation,
  `outputDimensionality: 1024`. **Do not write a second implementation** (NV-NO-DUPLICATE-001).
- Keep NYS's existing length assertion: reject any vector whose length ≠ 1024.

**3.2 Make the batch helper parallel**
`generateGeminiEmbeddingsBatch()` is a serial `for`+`await`. Give it the same bounded
concurrency the Bedrock path uses, so `EMBED_CONCURRENCY` means the same thing for both.

**3.3 Add `embedding_g` + its own HNSW index (option C)**
Migration on the caselaw DB, then run Gemini shards writing **only** `embedding_g`. Reads
keep using `embedding` until cutover. Build the HNSW index **after** the bulk backfill, not
before — building it first makes every insert pay index maintenance.

**3.4 Measure before scaling — do not repeat my concurrency mistake**
On a **10 k-row pilot**, capture: rows/hour/worker, p50/p95 invoke latency, 429 rate, cost
per 1 k rows vs Titan, and a **recall A/B** (same 20 legal queries against `embedding` vs
`embedding_g`). Only then choose the shard/concurrency shape.
*Gate:* proceed to full backfill only if Gemini is both **cheaper per 1 k rows** and **≥ Titan on recall**.

**3.5 Cut over**
When `embedding_g` India coverage ≈ `embedding`, switch the query path, keep the old column
one release for rollback, then drop it.

### Phase 4 — after the above

**4.1** Decide `us-fed`/`us-ny` (86,536 rows) — parked per your instruction; revisit later.
**4.2** Confirm the real SC PDF bucket name and replace the `your-supreme-court-data-bucket`
placeholder in `ingest-rds.ts:163` — you confirmed the bucket is real, so this is a rename
plus a `ListObjectsV2` probe.
**4.3** Locate the **DC ingest path**: `ingest-rds.ts` handles only SC and HC, yet 5.69 M DC
rows exist. Needs finding before DC ingest can be reasoned about.

---

## 4. Sequencing and dependencies

```
Phase 1 (1.1 gauge, 1.2 stall detector, 1.3 keepAlive)   ← independent, do now
        │
Phase 2 (2.1 newest-first HC 2025/2026)                  ← independent of Gemini
        │
Phase 3 (3.1 keys+switch → 3.2 parallel → 3.3 column → 3.4 PILOT → gate → 3.5 cutover)
```

Phases 1 and 2 need **no Gemini key and no NYV deploy** — they are host-side changes to the
NYS tree. Phase 3 is gated on keys and on the 3.4 pilot.

## 5. What I need from you

1. **Gemini API key(s)** for the NYS host — the blocker for all of Phase 3.
2. **Confirm option C** (second column + second index). It costs ~90–130 GB on a 267 GB DB.
   If storage is tight, say so and I will price option D instead.
3. **The real SC PDF bucket name**, to replace the placeholder.
4. **Where DC metadata is ingested from** — I could not find it in the tree.

**Model note:** you mentioned "Gemini 3.7". The embedding model configured here is
`gemini-embedding-2` (`NYV_GEMINI_EMBED_MODEL`). Generation models and embedding models are
separate ladders — if you mean a specific newer *embedding* model, name it and I will set it
via env; if you mean 3.7 for *generation*, that belongs to the LLM cascade, not this plan.
