# NYV + NYS — pending work for smooth NSP/NYM delivery (2026-08-18)

> **SUPERSEDED in part by [`NYV-P0-P1-ACTION-PLAN-2026-08-18.md`](./NYV-P0-P1-ACTION-PLAN-2026-08-18.md) — read that first.**
>
> **Two corrections.** (1) **NYS is part of NYV**, not a separate project; it is deployed to its own
> server (`nyv-caselaw-worker`, systemd `nyv-api` on `:8080`) only to isolate corpus and
> document-processing load. Its source lives at `~/Desktop/nyayavigya-platform-5.0.0/NYS-Agentic-AI`
> (a submodule of a different checkout than this workspace). Every NYS item is **ours**.
> (2) **The "caselaw hybrid 10.5s" finding below is WITHDRAWN** — it was a single cold call.
> Warm, through the NYV wrapper: **0.366 / 0.320 / 0.312 s**, `method=hybrid_rrf`, no fallback,
> zero CorpusBusy in 6 h. Caselaw search is healthy and NSP should stay on `hybrid`.
> The real defect the probe surfaced is **5.56 % embedding coverage with Supreme Court at 43,497
> rows** — see P0-6 in the action plan.
> **Excludes** the RLS rollout, which is tracked separately.
> **Evidence:** SSM `nys-integration-audit`, `nys-error-detail`, `nys-retrieve-timing`,
> `p0-p1-final`.

---

## A. NYS integration — measured, and mostly excellent

| check | result | verdict |
|---|---|---|
| `nyayasearch.nyayasiddhi.online/healthz` | **200** | live |
| NYS `POST /retrieve` latency (5 runs) | **33 / 39 / 40 / 48 / 119 ms** | **excellent** |
| NYS returns `llmRequired: false` + `intent: statute` | yes | the zero-LLM signal works |
| IPC→BNS via NYV | **52 ms**, `source: nys-knowledge-plane` | zero-LLM path live |
| Statute FAQ through orchestrate | **72 ms, `completions: 0`**, `resolution: statute-fast-path`, `model: nys-statute-faq` | **a real legal answer at zero LLM cost** |
| Statutes search through NYV | 200 in 3.7 s | acceptable |
| Caselaw hybrid through NYV | 200 in **10.5 s** | **too slow for a typeahead** |
| NYS errors in 3 h | **4**, all `POST /retrieve` "aborted due to timeout", all retried | rare, self-healing |

**A hypothesis I had and then disproved:** I expected the 4 timeouts to be the Auto-RAG
extras deadline (2,500 ms) cutting NYS off, since `NYS_KNOWLEDGE_SYNC_TIMEOUT_MS=3000` is
capped by `Math.min(extrasDeadlineMs, …)` at `nv-auto-rag-router.ts:667` and is therefore
**inert**. But NYS answers in 33–119 ms, so 2,500 ms is 20× more than it needs. The 4
failures are cold-start/network blips at a rate of ~1.3/hour, each retried with 250 ms
backoff. **Not a defect worth changing.** The inert env var is worth deleting to stop the
next reader believing it does something.

### WITHDRAWN: "the one NYS-side item" (kept for the record)

~~**Caselaw hybrid search at 10.5 s.**~~ **This was my measurement error.** Retained below only so the correction is legible; the real item is embedding coverage (action plan P0-6).

> Original, incorrect text: Statutes are 3.7 s and `/retrieve` is 40 ms, so the
cost is specific to the hybrid caselaw path — consistent with the known embedding coverage
(~3–7 % of ~20.5 M judgments, so RRF is fusing a mostly-FTS result set over a large
corpus). NSP uses this for typeahead, where 10.5 s is unusable. ~~This needs the NYS team~~ — **wrong on both counts: it is not slow, and NYS is us.** NYV already passes `mode=fts` for
snappy typeahead — that is the correct interim answer for NSP.

---

## B. Pending in NYV, by user-visible impact

### P0 — affects correctness or a partner-visible promise

| # | item | why it matters now |
|---|---|---|
| 1 | **3 of 5 memory tiers are in-process only** — `memory.5tier.episodic`, graph memory, mem0 hot cache live in JS `Map`s (`nv-5tier-memory-service.ts:91`, `graph-memory-service.ts:181`). They are **lost on every deploy/restart** | We deployed 6× yesterday. Any "the assistant remembers my matter" behaviour built on those tiers silently resets. Durable equivalents already exist (`nvMatterMemory`, `nvClientMemory`, …) but are reachable **only via REST**, not from the Queen fan-in |
| 2 | **A simple/moderate request queries 1 of 5 memory tiers.** `memorySources === 'full'` only fires on complex/very_complex or the partner floor (`nv-context-budgets.ts:84,98,134`) | Most NSP traffic is `-fast`, so most requests get `memory.tiered.recall` alone. The other four tiers are effectively dark on the paths that carry the volume |
| 3 | **`retentionDays` accepted and never enforced** — stored as metadata, not even copied to the object (`nv-document-intelligence-orchestrator.ts:628,633-646`) | We accept a retention instruction from a partner and do nothing with it. Erasure-on-request now works (NV-DOC-ERASURE-001); *scheduled* retention does not |
| 4 | **MMR is dead** — `applyMMR` is only called by `rerankResults`, which has **zero callers** | Retrieval returns near-duplicate chunks; diversity was built and never wired. Directly affects answer quality on multi-issue questions |

### P1 — cost, latency, or dormant capability

| # | item | evidence |
|---|---|---|
| 5 | **Prompt caching covers Anthropic only.** Gemini (`cachedContent`) and the OpenAI-compatible paths are untouched | Gemini is rung 21–24 and the default flash rail; on Gemini-heavy traffic the new saving does not apply |
| 6 | **`rag.self`, `rag.reranker`, `memory.graph.add`, `memory.mem0.consolidate`, `memory.project.store`** are declared capability leaves that are **never invoked** | Queen cannot schedule them, so five advertised capabilities are unreachable from the mesh |
| 7 | **NYS `deterministic.answer` is produced but the router never returns early** (`nv-auto-rag-router.ts:118-122` says callers MUST check it) | We compute a zero-LLM answer and then sometimes pay for an LLM anyway. The statute fast path *does* honour it — 72 ms / 0 completions proves the mechanism — but other callers may not |
| 8 | **GCS backend configured with no adapter** (silently degrades to local); **S3 multipart configured, not implemented** despite a >50 MB claim in the header | A >50 MB upload behaves differently from what the config implies |
| 9 | **`work_mem`/`random_page_cost` are now tuned, but `hallucination_checks` is 39 MB for 7,622 rows** (~5 kB/row) | Full payloads in a hot table; a `jsonb` → compressed or archived split is the next DB win |
| 10 | **v2 cost benchmark still not re-run** since the leaf-scope probe fix | We have prompt caching + a cheaper ladder now and **no measurement** of either. This is the one that turns yesterday's work from "should be cheaper" into a number |

### P2 — hygiene

11. Delete the inert `NYS_KNOWLEDGE_SYNC_TIMEOUT_MS` (capped by the extras deadline).
12. Rename `nv_schema.rag_documents` → `nv_tenant_rag_documents` to end the name collision with `public.rag_documents` (757 rows vs 0).
13. Wire `cleanupTempFiles()` / `verifyIntegrity()` / `healthCheck()` — all zero callers.
14. Add a deploy **drain/readiness gate** — this is what produced NSP's task-387 502.

---

## C. Recommended order

1. **Item 10 (re-run v2 benchmark)** — free, and it is the only way to know whether the ladder + caching changes actually paid. Everything else is guesswork until this runs.
2. **Item 14 (deploy drain)** — small, and it removes a class of partner-visible 502 we caused.
3. **Items 1 + 2 (memory)** — the biggest gap between "5 tiers of memory" as designed and what an NSP request actually gets. Wire the durable tiers into the fan-in and lower the `full` threshold for partner traffic.
4. **Item 4 (MMR)** — one wiring change, direct answer-quality gain.
5. **Item 5 (Gemini caching)** — extends the saving already proven on Anthropic.
6. **Item 3 (retention)** — needed before any paid GA claim about data lifecycle.

Items 1–2 and 4–5 are independent and can run in parallel.
