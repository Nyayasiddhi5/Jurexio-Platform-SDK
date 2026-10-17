# NYV pending work — verified status (2026-08-18)

> Every line below was **re-verified against source today**, not recalled. That matters:
> checking corrected two items I had previously reported wrongly, and revealed that three
> file paths in my earlier plan did not exist as written.
> **Excludes RLS** (out of scope per architect). **India-only** for NYS.

---

## 1. Where we stopped, and why

The six-component optimisation plan (`NYV-P0-P1-ACTION-PLAN-2026-08-18.md`) was interrupted
after **Wave 1** to fix NYS. That NYS work is now done through Phase 2, so NYV is the
open front again.

**Completed before the interruption** (all deployed and verified live):

| item | evidence |
|---|---|
| NSP structured fields on the orchestrate path (`NV-COURT-DOC-FIELDS-004`) | 7/7 live shapes return `fieldSource=nyv`, 13 fields |
| Memory `ANY()` bug — accounting broken on every recall | proven on live DB, fixed, guarded by a test |
| Document erasure wired (`deleteDocument`) | still wired — 3 refs in `nv-document-orchestrator-routes.ts` |
| Local signed URLs routable + verifiable | `nv-storage-file-routes.ts` present |
| DB indexes: HNSW on legal graph, 3 FK, 10 unused dropped | applied |
| Anthropic prompt caching, ladder reorder, 2 dead rungs | shipped |
| RDS planner tuning (`random_page_cost`, `work_mem`) | applied |

---

## 2. Verified-open items, highest value first

### P0-A · Memory: 3 of 5 tiers are still in-process — **worst gap**

Measured today:

| file | `new Map` | durable writes |
|---|---|---|
| `src/services/memory/nv-5tier-memory-service.ts` | 3 | 2 |
| `src/services/memory/graph-memory-service.ts` | **12** | **0** |

`graph-memory-service.ts` has **zero** durable references — it is entirely in-process and is
lost on every restart. We deployed ~8 times in two days. Any "the assistant remembers this
matter" behaviour built on the graph tier silently resets each time.

**Fix:** back the tiers with `nv_schema.memory_entries` (already indexed; recall is 10.6 ms)
behind the existing `Map` as a read-through cache. No new table, no parallel pipeline.
**Verify:** write a memory → restart the container → recall it. Today that returns nothing.

### P0-B · A typical partner request reaches **1 of 5** memory tiers

`src/orchestration/nv-context-budgets.ts` (note: **`orchestration/`**, not `services/` as my
earlier plan said):

| complexity | `memorySources` |
|---|---|
| `simple` | **`session`** ← one tier |
| `moderate` | `session+longterm` |
| `complex` / `very_complex` | `full` |

NSP traffic is overwhelmingly `*-fast`, which classifies simple/moderate — so the deep tiers
are dark on exactly the paths carrying the volume. The original reason to restrict this was
recall cost, and **that reason is gone**: recall went 716 ms → 10.6 ms.
**Fix:** lower the `full` threshold for partner traffic. **Verify:** assert `memorySources`
in response metadata on a `legal-chat-fast` call.

### P0-C · MMR still not wired — answers carry near-duplicate chunks

`rerankResults` lives in `src/services/rag/nv-legal-reranker-service.ts` and has **zero
callers outside its own file**. Diversity was built and never connected, so multi-issue
questions get several chunks saying the same thing and burn budget on redundancy.

> **Correction:** I previously said this was "dead code with zero callers", then corrected to
> "it has a caller". Both were sloppy. Precisely: it **is** called, but only *within* its own
> service — nothing in the retrieval path invokes it. So the capability is real and unreachable.

**Fix:** call it at the Auto-RAG fusion point, after RRF, before the char cap.
**Verify:** **`npm run eval:quality-trend`**, not unit tests — reordering chunks moves answer
quality and unit tests cannot see that.

### P0-D · Deploy has no drain/readiness gate — we cause partner 502s

`grep -c "drain|readiness|wait.*health"` on `scripts/deploy-aws-ssm.sh` = **0**. This is the
confirmed root cause of NSP task 387 (created **124 ms** after our container started, 61 s
before health went green). NSP independently agreed. Every deploy is an outage window — and
I have deployed ~8 times since.
**Fix:** start new → poll `/health` until green → cut traffic → stop old; add `SIGTERM` drain.
**Verify:** deploy while a 60 s poll loop runs; assert zero non-200.

### P1-E · Re-run the cost benchmark — **PARKED by architect decision, 2026-08-19**

> **PARKED until production.** Cost is explicitly not the benchmark that matters before we
> move to production, and there will be time for it then. The single core optimisation until
> then is **counsel-grade quality across every AI task in NYV and NYS**.
>
> What parking does NOT change: every cost claim about the ladder reorder and prompt caching
> remains **a projection, not a measurement**, and must be stated that way. Parking the
> measurement is a decision to defer knowing — not permission to assert the saving. If a cost
> figure is needed for a commercial conversation before production, this item unparks first.

The only benchmark artifact is `.local/benchmarks/v2-first-defensible-2026-08-16T17-33-27-123Z`
— **2026-08-16 17:33**, while the ladder reorder and prompt caching shipped **2026-08-17
19:02–19:21Z**. So the benchmark *predates the changes it was meant to measure*, and every
cost claim I have made about them is a projection. `npm run bench:cost` exists and is ready to
run when this unparks.

**Quality is now the measured axis instead.** The equivalent discipline applies: a citation-density
regression probe (N research prompts, assert ≥1 delivered authority each) converts "counsel-grade"
from a claim into a number that can fail — which is exactly what the cost benchmark was for.

### P1-F · Gemini prompt caching genuinely absent

> **Correction:** a grep for `cachedContent` matched `src/services/nv-client.ts:1115`, but
> that is a **local variable holding cached response text** — not Gemini's context-caching
> API. I nearly recorded this as "already done". It is not.

Caching covers Anthropic (Bedrock + direct) only, while Gemini is the default flash rail.
Given NYS measured Gemini at **1.8× faster than Titan**, this rail matters more than assumed.

### P1-G · Three capability leaves declared but unreachable

| leaf | referenced outside the manifest? |
|---|---|
| `rag.self` | yes — `nv-agent-tool-bridge.ts`, `nv-client.ts` |
| `rag.reranker` | yes — `nv-agent-tool-bridge.ts` |
| **`memory.graph.add`** | **no** |
| **`memory.mem0.consolidate`** | **no** |
| **`memory.project.store`** | **no** |

> **Correction:** I previously listed all five as "never invoked". Two *are* referenced. The
> real number is **three**, and all three are memory leaves — which is consistent with P0-A.

Per **NV-MESH-001**, declaring a leaf is not enough: it needs an INTENT map entry plus an
`analyzePrompt` hint. Wire or formally retire; do not leave them advertised.
**Verify:** `npm run guardrail:intent-mesh`.

### P1-H · Smaller, still open

- **`retentionDays` not honoured for documents.** `nv-retention-service.ts` **is** wired at
  startup behind `NYV_F_RETENTION_SWEEP` (default OFF) + `NYV_RETENTION_APPLY=1`, but sweeps
  only telemetry/memory tables (`ai_activity`, `mcp_tool_executions`, `async_job_queue`,
  `mem0_memories`, `memory_entries`) — **not documents**, and not a partner's per-document
  value. Narrower than I first said, but real.
- **`hallucination_checks` 39 MB for 7,622 rows** (~5 kB/row) — full payloads in a hot table.
- **`nv_schema.rag_documents` vs `public.rag_documents`** name collision (757 rows vs 0).
- **Bedrock region:** `BEDROCK_REGION=us-east-1` while RDS is `ap-south-1`. Titan p50 is
  **1,018 ms** cross-region. Found during NYS work; likely affects NYV embedding too.

---

## 3. Recommended order

> **Superseded 2026-08-19 by the counsel-grade quality sprint.** Cost is parked until
> production (see P1-E). The order below was cost-led; the live order is now quality-led:
> P0 citation grounding → P1 good-law → P2 instrument breadth → P3 parity. See
> `documents/working/NYV-COUNSEL-GRADE-QUALITY-PLAN-2026-08-19.md`, which is root-caused by
> live probe rather than by reading code.
>
> Retained below because items 2–6 are still individually valid and unfinished.

| # | item | why now |
|---|---|---|
| 1 | ~~**P1-E benchmark**~~ | **PARKED** — cost is not the pre-production benchmark |
| 2 | **P0-D drain gate** | small, and stops us causing partner 502s on every deploy |
| 3 | **P0-A + P0-B memory** | the largest gap between "5 tiers" as designed and what a request gets |
| 4 | **P0-C MMR** | one wiring change, direct answer-quality gain — needs the quality eval |
| 5 | **P1-F Gemini caching** | extends a proven saving to the faster rail |
| 6 | **P1-G, P1-H** | cleanup once the above are measured |

**1 and 2 are cheap and independent — they can ship together in one deploy** (batching
deploys, per the earlier lesson that three deploys for related fixes was a process failure).

## 4. NYS, for contrast

Phase 1 ✅ · Phase 2 ✅ · **Phase 3 unblocked** — storage approved, so `embedding_g` +
its own HNSW index is the agreed path. Remaining: parallelise the Gemini batch helper,
add the NYS provider switch, then the 10 k pilot gated on cost-per-1k **and** recall A/B.
