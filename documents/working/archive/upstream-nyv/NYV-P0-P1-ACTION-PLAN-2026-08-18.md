# P0 / P1 action plan — NYV + NYS as one platform (2026-08-18)

> **Scope corrected:** NYS is **part of NYV**, deployed to its own server (`nyv-caselaw-worker`,
> `i-000115b19219bb766`, systemd `nyv-api` on `:8080`) purely to isolate corpus and document-processing
> load. Every item below is **ours**. Nothing here is "for the NYS team".
> **Excludes** the RLS rollout, tracked separately.
> **Evidence:** SSM `nys-caselaw-latency-rca`, `nys-hop-attribution`, `nys-retrieve-timing`, `p0-p1-final`.

---

## 0. Two corrections to what I told you earlier

**I withdraw the "caselaw hybrid is 10.5s" finding. It was wrong.** I measured one cold call and
reported it as a defect. Measured properly:

| path | latency |
|---|---|
| NYS local, `mode=fts` | 0.038 s (warm) |
| NYS local, `mode=hybrid` | 0.31 / 0.51 / **0.83 s cold** |
| **through the NYV wrapper, `mode=hybrid`** | **0.366 / 0.320 / 0.312 s** — `method=hybrid_rrf`, no fallback |

Zero `CorpusBusyError` and zero "hybrid busy" fallbacks in 6 h. **Caselaw search is fast and healthy**,
and the recommendation to push NSP onto `mode=fts` was unnecessary — they can use `hybrid` and get RRF
quality at ~0.32 s. Had I not re-measured, you would have had a fabricated P0 and NSP a pointless
downgrade.

**I also withdraw "NYS caselaw is for the NYS team."** Same platform, same ownership.

**What the probe found instead is worse and real** — see P0-6.

---

## P0 — correctness, compliance, and user-visible quality

### P0-1 · Three of five memory tiers evaporate on restart
**Problem.** `episodic`, graph, and mem0-hot memory live in JS `Map`s
(`nv-5tier-memory-service.ts:91`, `graph-memory-service.ts:181`). We deployed **6× yesterday**; each
deploy silently wiped them. Durable equivalents (`nvMatterMemory`, `nvClientMemory`) exist but are
reachable **only over REST**, not from the Queen fan-in.
**Fix.** Back the three tiers with the existing `nv_schema.memory_entries` table (now indexed at
10.6 ms) behind the current in-process `Map` as a read-through cache. **No new table, no new pipeline** —
reuse the tier that already works.
**Verify.** Write a memory, restart the container, recall it. Today that returns nothing.
**Effort** M · **Risk** Low (additive; cache stays as the fast path)

### P0-2 · A typical NSP request queries 1 of 5 memory tiers
**Problem.** `memorySources: 'full'` only fires on `complex`/`very_complex` or the partner floor
(`nv-context-budgets.ts:84,98,134`). NSP traffic is overwhelmingly `*-fast`, so most requests get
`memory.tiered.recall` alone and the other four tiers are dark on the paths carrying the volume.
**Fix.** Lower the `full` threshold for partner traffic now that recall costs 10.6 ms instead of
716 ms — the latency argument for restricting it no longer holds.
**Verify.** `memorySources` in the response metadata on a `legal-chat-fast` call; assert tier count > 1.
**Effort** S · **Risk** Low (budget change, measurable, reversible)

### P0-3 · MMR is dead — answers carry near-duplicate chunks
**Problem.** `applyMMR` is reachable only through `rerankResults`, which has **zero callers**.
Diversity was built and never wired, so multi-issue questions get several chunks saying the same thing
and the token budget is wasted on redundancy.
**Fix.** Call `rerankResults` at the Auto-RAG fusion point, after RRF and before the char cap.
**Verify.** A/B one multi-issue prompt; assert distinct-source count rises and answer covers both issues.
**Effort** S · **Risk** Low–Med (changes chunk ordering → run the quality-trend eval, not just tests)

### P0-4 · `retentionDays` is accepted and never enforced
**Problem.** Stored as metadata and not even copied onto the object
(`nv-document-intelligence-orchestrator.ts:628,633-646`). We accept a retention instruction from a
partner and do nothing with it. Erasure-on-request now works; **scheduled** retention does not.
**Fix.** Persist `retention_until` on the document row and add a sweep job to the existing scheduler
that calls the now-wired `deleteDocument()`.
**Verify.** Set a 1-day retention, advance the sweep, confirm the object is gone from storage *and* DB.
**Effort** M · **Risk** Low — but it **deletes data**, so dry-run mode first, and never sweep without
an explicit enable flag.

### P0-5 · Deploy has no drain/readiness gate — this caused NSP task 387
**Problem.** Task 387 was created **124 ms** after our container started and 61 s before health went
green. A refused connection surfaces as **502**. Every deploy is an outage window for in-flight partner work.
**Fix.** In the deploy script: start the new container, poll `/health` until green, **then** cut traffic
and stop the old one. Ship with `SIGTERM` drain so in-flight requests finish.
**Verify.** Deploy while a 60 s poll loop runs against orchestrate; assert zero non-200.
**Effort** S · **Risk** Low, and it removes a class of partner-visible failure we caused

### P0-6 · Vector recall is blind on the corpus that matters most
**Problem — the real finding behind the withdrawn latency claim.** Measured coverage:

| scope | embedded | note |
|---|---|---|
| **total corpus** | **1,462,592 / 26,317,392 = 5.56 %** | SLO target is 99 % → `overallStatus: degraded` |
| **Supreme Court (`sc`)** | **43,497** | checkpoint **stale since 2026-07-14** |
| `all` | 1,462,592 | checkpoint **stale since 2026-07-30** |
| `hc` shards + `dc` | actively progressing | 3 HC + 1 DC embed jobs running now |

So the vector half of hybrid search reaches ~5.6 % of judgments, and **Supreme Court — the most-cited,
most-precedential corpus — is the least embedded.** RRF still returns results because FTS carries the
query, which is exactly why this hid behind a healthy-looking 200. Search *looks* fine and silently
misses binding precedent.
**Fix.** (a) Re-point an embed shard at `sc` first — highest precedential value per row, and only
~43 k done. (b) Un-stall the `all`/`sc` checkpoints. (c) Alert on `overallStatus: degraded` instead of
returning it in a payload nobody reads.
**Verify.** Coverage climbs; a known SC-precedent query returns the leading case via the vector arm
(compare `mode=fts` vs `mode=hybrid` result sets).
**Effort** M (mostly compute time) · **Risk** Low — additive backfill, already-proven job

---

## P1 — cost, latency, dormant capability

### P1-7 · Re-run the v2 cost benchmark — do this first
Prompt caching and the reordered ladder both shipped **unmeasured**; the leaf-scope probe defect that
blocked the benchmark is fixed. This is free, and until it runs, every cost claim including mine is
a projection. **Effort** S · **Risk** None (read-only)

### P1-8 · Gemini prompt caching
Caching covers Anthropic only. Gemini `cachedContent` is untouched despite Gemini being the default
flash rail. Mirror the Anthropic pattern. **Effort** S–M · **Risk** Low (no wording change → quality
cannot move)

### P1-9 · Five capability leaves declared but never invoked
`rag.self`, `rag.reranker`, `memory.graph.add`, `memory.mem0.consolidate`, `memory.project.store` —
Queen cannot schedule them, so five advertised capabilities are unreachable. Wire or formally retire
them; do not leave them advertised. **Effort** M · **Risk** Med — needs INTENT map + `analyzePrompt`
hint per **NV-MESH-001**, so land one at a time behind `guardrail:intent-mesh`.

### P1-10 · Honour NYS `deterministic.answer` at every caller
The statute fast path proves the mechanism (**72 ms, 0 completions**). Other callers may compute the
zero-LLM answer and then pay for an LLM anyway. Audit all callers for the early return.
**Effort** S · **Risk** Low, pure saving

### P1-11 · `hallucination_checks` — 39 MB for 7,622 rows (~5 kB/row)
Full payloads in a hot table. Move the blob to compressed `jsonb` or archive it. **Effort** S · **Risk** Low

### P1-12 · Hygiene
Delete the inert `NYS_KNOWLEDGE_SYNC_TIMEOUT_MS` (capped by the 2,500 ms extras deadline, so it does
nothing — and NYS answers in 33–119 ms, so the cap is harmless); rename
`nv_schema.rag_documents` → `nv_tenant_rag_documents` to end the collision with `public.rag_documents`;
wire `cleanupTempFiles()` / `verifyIntegrity()` / `healthCheck()`. **Effort** S · **Risk** Low

---

## Sequence

| wave | items | why this order |
|---|---|---|
| **1 — measure & stop the bleeding** | P1-7 (benchmark), P0-5 (drain gate) | Both cheap. One turns cost guesses into numbers; the other stops us causing partner 502s during deploys |
| **2 — quality users can feel** | P0-6 (SC embeddings, starts long backfill), P0-3 (MMR), P0-2 (memory breadth) | Kick off the slow backfill first, then two small changes that improve retrieval quality immediately |
| **3 — durability & compliance** | P0-1 (memory persistence), P0-4 (retention) | Larger, and P0-4 deletes data so it needs a dry-run gate |
| **4 — cost & cleanup** | P1-8, P1-10, P1-11, P1-9, P1-12 | Follows the benchmark, so savings are verifiable |

**Verification for every wave:** `npm run guardrail`, full `tests/unit` (baseline: 925 pass / 3 known
fail), `tsc --noEmit` at 39 baseline, then a live SSM acceptance probe. **P0-3 additionally needs
`npm run eval:quality-trend`**, because reordering chunks can move answer quality and unit tests will
not catch that.

**Working rule for this wave, learned the hard way twice today:** measure warm *and* cold, and validate
the instrument before believing it. The caselaw "10.5s" and the earlier `key_len=0` probe both looked
like platform defects and were both my own measurement errors.
