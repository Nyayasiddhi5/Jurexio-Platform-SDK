# Phase 3 — Gemini embedding rollout: concrete plan (2026-08-18)

> **Everything below is measured, and it corrects three of my own earlier conclusions.**
> Evidence: SSM `nys-provider-latency`, `nys-bottleneck-isolate2`, `nys-index-check`,
> `nys-year-window-acceptance`. India-only (`sc`/`hc`/`dc`); RLS out of scope.

---

## 1. Answer: **no, more Bedrock keys will not help**

**Bedrock does not use API keys here.** The worker authenticates with the EC2 instance role
`nyv-caselaw-worker-role` via SigV4, and `AWS_ACCESS_KEY_ID` does not appear in
`/opt/nyv/api/.env` at all (`grep -c` = 0). Adding static credentials changes nothing,
because:

- `InvokeModel` quota is scoped to **account + region + model**, not to a credential.
- The bottleneck is not the credential and, as §2 shows, not Bedrock either.

Measured proof that Bedrock is not rate-limiting us:

| concurrency | wall time, embed-only | throttles |
|---|---|---|
| 8 | 1,100 ms | **0** |
| 24 | 1,162 ms | **0** |

24 parallel invokes cost 5 % more wall time than 8 — near-perfect scaling. **The only ways
to raise Bedrock throughput are a quota increase (a support request) or cross-region
inference — not more keys.**

**One real Bedrock finding:** `BEDROCK_REGION=us-east-1` while RDS is in `ap-south-1`. Titan
p50 is **1,018 ms** from Mumbai to N. Virginia. A same-region endpoint would cut a large
part of that — worth testing if Titan is kept (§5).

---

## 2. Correction: Gemini is **faster** than Titan, and my concurrency verdict was wrong

### 2.1 Gemini is ~1.8× faster per call

| provider | p50 | mean | min–max |
|---|---|---|---|
| **Gemini** `gemini-embedding-2` @1024 | **570 ms** | 553 ms | 474–631 |
| Titan v2 @1024 (us-east-1) | 1,018 ms | 1,064 ms | 932–1,533 |

**I previously wrote that Gemini was "~4× slower per row".** That was wrong: I compared
Gemini's **per-call** latency against Titan's **effective per-row** rate (200 rows ÷ 47 s at
concurrency 8), which are not comparable quantities. Apples-to-apples, Gemini wins.

### 2.2 The three keys DO add real capacity

| keys | calls | throughput | 429s |
|---|---|---|---|
| 1 | 6 | 10.4 calls/s | 0 |
| **3** | 18 | **21.2 calls/s** | 0 |

Roughly **2× on 3× the keys** — sub-linear but real, and unlike Bedrock this scales with
keys because quota is per-key. `resolveGeminiApiKeys()` already rotates the list.

### 2.3 The real bottleneck is the per-row `UPDATE`, not the model

| concurrency | embed-only | embed + `UPDATE` | UPDATE overhead | **per row** |
|---|---|---|---|---|
| 8 | 1,128 ms | 3,693 ms | 2,565 ms | **462 ms** |
| 20 | 1,140 ms | 1,280 ms | 140 ms | **64 ms** |

Two things fall out:

1. **The `UPDATE` dominates at low concurrency** — 2,565 ms of a 3,693 ms batch at conc=8.
   Each row is its own round-trip to RDS in `ap-south-1`, and HNSW index maintenance is paid
   per statement.
2. **My "raising concurrency 8→20 made throughput worse" conclusion was wrong.** In isolation
   conc=20 is **7× better per row**. The slowdown I measured earlier was real but
   mis-attributed: four workers × 20 in-flight `UPDATE`s were contending on the *same* table
   and HNSW index, and I had also sampled ~2 minutes after a restart while workers were still
   ramping. **The fix is to batch the writes, not to cap concurrency.**

---

## 3. What Phase 3 must actually do

Ordered by measured payoff, not by the original guess.

### 3.1 Batch the `UPDATE`s — **SHIPPED, but it did NOT raise throughput** · done

Shipped as `NYS-EMBED-BATCH-UPDATE-001` (md5 `7b83ef21`) and measured on a settled
10-minute window. **Result: ~32,300 rows/h aggregate vs a ~45,000 baseline — no
improvement, arguably worse.** Recording that plainly rather than claiming the win the
isolated test predicted.

**Why the isolated 7× gain did not materialise, measured (SSM `nys-postbatch-rca`):**

| component | measured | implication |
|---|---|---|
| batched `UPDATE`, 100 rows | 2,852 ms (**28.5 ms/row**) | the write is now a *minor* cost |
| Titan slice of **8** parallel | 1,122 ms | ⇒ 25 slices = **28 s** per 200-row batch |
| Titan slice of **25** parallel | **1,112 ms** | ⇒ 8 slices = **9 s** per 200-row batch |

A slice of 25 costs the **same** as a slice of 8, so at `EMBED_CONCURRENCY=8` we pay 25
sequential round-trips where 8 would do. That puts an arithmetic floor of ~28 s on a batch
— and the observed 97–123 s is **4× above even that**, which points at contention between
the four workers plus the cross-region hop (`BEDROCK_REGION=us-east-1` vs RDS in
`ap-south-1`).

**Conclusion:** the write is fixed and no longer dominates, but **throughput is now bound
by slice serialisation and cross-region latency, not by the write.** The next levers are
§3.6 (same-region Bedrock) and a concurrency raise *now that writes are batched* — but
that must be measured on a settled window, one change at a time, because I have already
mis-attributed this once.

### ~~3.1 original rationale~~ (kept for the record)

Replace the per-row `UPDATE` with one multi-row statement per slice:

```sql
UPDATE judgments AS j SET embedding = v.emb::vector
FROM (SELECT * FROM unnest($1::bigint[], $2::text[]) AS t(id, emb)) AS v
WHERE j.id = v.id
```

Collapses N round-trips into 1 and lets Postgres do index maintenance once per statement.
On the conc=8 numbers this is where the 2,565 ms goes.
**Verify:** per-row ms in the isolation harness; then per-batch cadence in `embed.log`.
**Risk** Low — same rows, same values, fewer statements.

### 3.2 Parallelise `generateGeminiEmbeddingsBatch()` · P0 for Gemini
Currently a serial `for` + `await` (`nv-gemini-embeddings.ts`). With 3 keys measured at
21 calls/s, serial execution throws that away. Give it the bounded-concurrency shape the
Bedrock path uses, and spread calls **across keys** rather than hammering key 1.

### 3.3 Add the NYS provider switch · P0 for Gemini
`embeddingProvider()` returns only `"bedrock" | "hash"`. Extend to include `"gemini"`,
delegating to NYV's existing `nv-gemini-embeddings.ts` logic — **do not write a second
implementation** (NV-NO-DUPLICATE-001). Keep the existing length assertion: reject anything
whose length ≠ 1024. Keys and `NYV_EMBEDDING_DIMS=1024` are already staged on the host.

### 3.4 Vector space — **DECIDED 2026-08-18: option B approved (storage is not a constraint)**

> Architect confirmed "no issue of storage", so `embedding_g` + its own HNSW index is the agreed
> path: a clean vector space, reversible, with a recall A/B before any cutover. Options A and B
> below are retained for the reasoning.

`judgments.embedding` is `vector(1024)` under **one** cosine HNSW index
(`judgments_embedding_hnsw`). Titan and Gemini vectors are **not comparable**, so mixing them
in that column would degrade ANN recall in a way that reads as *bad search*, not a bug — and
FTS would mask it, exactly as it masked the coverage gauge.

| option | what it means | cost | verdict |
|---|---|---|---|
| **A — finish the remaining 7.9 M with Gemini** | 69.7 % Titan + 30.3 % Gemini in one indexed column | £0 | **Do not.** Two geometries, one index. |
| **B — `embedding_g` + own HNSW, cut over when comparable** | clean space, reversible, recall A/B before switching | **+~90–130 GB** on a 267 GB DB | **Recommended** |
| **C — re-embed all 26 M with Gemini in place** | one space, but a long half-migrated window | ~26 M calls | Only if storage forbids B |

At 21 calls/s measured, 7.9 M rows ≈ **4.4 days** of wall time for the remainder (B), or
~14 days for a full re-embed (C) — before the §3.1 batching win, which should improve both.

### 3.5 Pilot before scaling — the gate · P0
On **10 k rows**: rows/hour/worker, p50/p95 latency, 429 rate per key, **cost per 1 k rows vs
Titan**, and a **recall A/B** over ~20 real legal queries (`embedding` vs `embedding_g`).
**Proceed only if Gemini is cheaper per 1 k rows AND ≥ Titan on recall.** This gate exists
because I have now been wrong three times by reasoning instead of measuring.

### 3.6 If Titan is kept for anything: move it to `ap-south-1`
`BEDROCK_REGION=us-east-1` against `ap-south-1` RDS. Same-region Titan should beat 1,018 ms
materially, and it is an env change.

---

## 4. Sequence

```
3.1 batch UPDATEs         ← do FIRST: biggest win, helps Titan AND Gemini, no provider change
     │
3.2 parallel Gemini batch + 3.3 provider switch
     │
3.4 YOUR DECISION on embedding_g  ← blocking
     │
3.5 10k pilot ── gate ──► full backfill ──► 3.7 cutover
```

**3.1 alone is worth shipping** even if Gemini is deferred: it is provider-agnostic and
addresses the dominant cost.

## 5. What I need from you

1. ~~Confirm option B~~ — **DONE 2026-08-18: approved, storage is not a constraint.**
2. **Rotate the three Gemini keys** when convenient (they were pasted in chat and traversed
   SSM history).
3. Optional: request a **Bedrock quota increase** if you want Titan to remain a fast fallback.

**Model note:** you mentioned "Gemini 3.7". The embedding model measured here is
`gemini-embedding-2`. If you mean a specific newer *embedding* model, name it and I will set
`NYV_GEMINI_EMBED_MODEL`; if 3.7 is a *generation* model, it belongs to the LLM cascade, not
this plan.
