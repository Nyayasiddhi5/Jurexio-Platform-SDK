---
status: pending
version: 3.1.2
superseded_by: null
last_verified: 2026-04-27
---

# Nyayavigya Platform — Next Project Plan (Wire-Up & Test)

**Audience.** Engineering leads + the agent that picks up the next batch of
tasks. **Scope.** Take what we already built but haven't yet wired into the
default request path, wire it in, test it, and surface it on the admin
dashboard. No new ML training; no production-readiness items (covered in the
existing roadmap doc).

**Why now.** NV-ROUTER-001 closed the LLM-routing gap. The remaining
high-leverage gaps are upstream of the LLM call: smarter retrieval (Adaptive +
Corrective RAG), richer memory (5-tier + graph), DAG-based agent execution,
quality measurement (LLM-as-judge + oracle harness), and the Legal Chat
dashboard tool that exercises the whole stack so SMEs can train it.

This plan complements (does **not** replace) the existing
[`NYV-ROADMAP-Q2-Q4-2026.md`](./NYV-ROADMAP-Q2-Q4-2026.md) — that doc covers
production readiness; this one covers feature depth.

---

## 1. Track A — Wire built-but-isolated AI modules into the default request path

Each task is sized as ONE merge unit and references the file that already
exists. None require new ML or new infra.

### A1. Make Adaptive RAG the default retrieval strategy
- **Files:** `src/services/rag/adaptive-rag-service.ts` (existing),
  `src/orchestration/queen-orchestrator.ts`, `src/services/rag/index.ts`
- **What:** When Queen's task plan contains a step of kind `legal_research`,
  `precedent_lookup`, `case_law`, `statute_lookup`, or `compliance_review`,
  call Adaptive RAG instead of the generic `rag-service.ts`. Query-complexity
  classifier picks between dense/sparse/hybrid/multi-hop strategies.
- **Acceptance:** Unit test asserts the strategy chosen for 6 representative
  queries (1-line factual, comparative, multi-hop, cross-jurisdiction, vague,
  citation-only). E2E test against `/api/nv/orchestrate` with a precedent
  query shows the Adaptive RAG path was taken in `routerDecision.attempts`.

### A2. Turn on Corrective RAG with web-fallback
- **Files:** `src/services/rag/corrective-rag-service.ts`,
  `src/services/web-search.ts`, `src/services/nyayavigya-legal-web-search-service.ts`
- **What:** Wrap the default RAG output in CRAG's grader. If grade < 0.6,
  trigger the legal web search tool, then re-rerank. Cap at 1 web round-trip
  per request to control cost.
- **Acceptance:** Forced-low-quality test (empty corpus) hits the web path;
  high-quality test does not. Per-request flag `noWeb=true` short-circuits.

### A3. Promote 5-tier memory + graph memory to the Queen path
- **Files:** `src/services/memory/nv-5tier-memory-service.ts`,
  `src/services/memory/graph-memory-service.ts`,
  `src/orchestration/queen-orchestrator.ts`
- **What:** Replace the legacy `nv-memory-service.ts` reads/writes with the
  5-tier service. Inject graph-memory neighborhood lookups into the prompt
  builder so cross-matter relationships (same opposing counsel, same statute,
  same opposing party) reach the agent.
- **Acceptance:** Memory snapshot endpoint returns L1/L2/L3/L4/L5 hit counts
  per request. Graph lookup adds ≤80ms p95.

### A4. DAG orchestration for declarative multi-step workflows
- **Files:** `src/services/dag-orchestration-service.ts`,
  `src/routes/nv-orchestration-routes.ts`
- **What:** Add `POST /api/nv/orchestrate/dag` accepting a node/edge plan. Each
  node is an agent call; edges declare data dependencies. Queen resolves the
  topological order and runs independent nodes in parallel through the unified
  router.
- **Acceptance:** A 5-node DAG (parse → extract → classify → draft → review)
  runs end-to-end. Failure of one node does not block siblings; downstream
  nodes get a typed error in their input.

### A5. Verbalized sampling for high-stakes drafting
- **Files:** `src/services/verbalized-sampling-service.ts`,
  `src/orchestration/queen-orchestrator.ts`
- **What:** When `taskKind=legal_drafting && tier in {pro,enterprise,
  superadmin}`, run k=3 samples through the router with temperature jitter,
  then have an LLM-as-judge pick the winner. Surfaces consistency in the
  response metadata.
- **Acceptance:** Drafting requests return `{ samples: 3, winnerIdx,
  consistencyScore }` in metadata. Latency budget configurable; default off,
  opt-in via `request.options.verbalize=true`.

### A6. Plug full safety pipeline + grounded hallucination detector
- **Files:** `src/services/safety-pipeline.ts`,
  `src/services/hallucination-checker.ts`,
  `src/services/nyayavigya-citation-grounding-service.ts`
- **Status:** The safety-pipeline plug itself **merged in Task #34** — the
  pipeline is now the canonical post-orchestrator gate and failures throw
  in production. Two follow-ups remain open as separate proposed tasks and
  pick up the rest of the work below: **#72** (swap the heuristic
  hallucination check for the grounded detector that compares output spans
  against retrieved chunks) and **#71** (return an actionable
  block-with-explanation to the SDK / UI instead of a stuck spinner).
- **Acceptance for the remaining work:** #72 lands the grounded detector
  behind the existing safety-verdict contract; #71 lands the explanation
  surface and an E2E test asserting a deliberately-unsafe response is
  blocked at the HTTP layer with a typed reason.

### A7. Skills system → tool-use loop inside Queen
- **Files:** `src/services/skills/skills-system-service.ts`,
  `src/orchestration/queen-orchestrator.ts`
- **What:** Make skills addressable by agents via a tool-use protocol.
  Currently agents emit text; this lets them request `skill.statute_lookup`,
  `skill.timeline_build`, `skill.amendment_impact` and the Queen executes the
  skill, returns the result to the same agent context, and continues.
- **Acceptance:** A litigation-strategy query that needs a timeline + statute
  lookup completes in one orchestration with both skills called.

### A8. LLM-as-judge wired into testing path + Legal Chat
- **Files:** `src/services/testing/nv-llm-judge-service.ts`,
  `src/services/testing/nv-agent-testing-framework.ts`
- **What:** Schedule the agent testing framework nightly (CI) per jurisdiction.
  Expose verdict + per-rubric scores in `/api/nv/testing/results`. Use the
  same judge for the Legal Chat SME grading flow (Track C).

---

## 2. Track B — Test depth for what we already have

### B1. Adaptive + Corrective RAG unit tests
Cover the strategy router, low-quality grade trigger, web-fallback cap.

### B2. Memory tier integration test
Hit the same orchestrate request twice; assert L1 short-circuits the second.
Confirm cross-tenant memory does not leak (extends task #36's regression).

### B3. Streaming cascade test
Force the primary model to 5xx before first token; assert the orchestrator
silently advances to the next provider and the client sees a clean stream
from the second model. Then force a mid-stream failure and assert the
`[STREAM_INTERRUPTED:<modelId>]` marker arrives.

### B4. Sick-model circuit-breaker test (live)
Already covered locally by router test #13. Add a live smoke that drives a
real provider into observed-failure state with a malformed key, confirms it
falls out of primary, and recovers after a `resetHealth` admin call.

### B5. End-to-end agent-testing oracle pack
Run the agent-testing-framework against all 7 jurisdiction registries with a
stable prompt set; gate merges on no regression in pass rate.

---

## 3. Track C — Legal Chat dashboard + workflow visualizer

The user-visible payoff. Detailed plan in
[`NYV-LEGAL-CHAT-DASHBOARD-PLAN.md`](./NYV-LEGAL-CHAT-DASHBOARD-PLAN.md).

Summary: a single-page admin tool that lets an SME:

- Upload one or many documents.
- Pick jurisdiction(s), tier, agent class, model preferences.
- Type any prompt (drafting / Q&A / parse / statute lookup / compliance).
- Watch the orchestration steps live (PII redaction, agent decomposition,
  RAG retrievals, model fallbacks, safety verdicts, citations).
- Rate the response (thumbs + per-criterion rubric) → feeds GRPO + LLM-judge
  training set.

---

## 4. Track D — Observability deltas needed for Tracks A/B/C

| Item | Why | Where |
|---|---|---|
| Per-request `pipelineTimeline` event stream | Powers the workflow visualizer | New endpoint `/api/nv/orchestrate/timeline/:orchestrationId` reading from per-request emitter (#64) |
| RAG step records (strategy chosen, namespaces queried, top-k, rerank scores, web-fallback fired) | Show on dashboard | Extend `recordDecision` ring buffer with optional `ragSteps[]` |
| Memory step records (L1/L2/L3/L4/L5 hits, graph edges traversed) | Show on dashboard | Same as above |
| Safety verdict + reason | Show "why blocked" (#71) | Extend output schema |
| GRPO feedback writes | SME ratings → training set | New table `sme_feedback` keyed by `orchestrationId` |

---

## 5. Suggested execution order (one-merge-per-row)

| # | Task | Track | Depends on |
|---|---|---|---|
| 1 | A6 — Safety-pipeline plug **(merged in Task #34)**; remaining work split out as proposed tasks #72 (grounded-detector swap) and #71 (block-with-explanation surface) | A | none |
| 2 | A1 — Adaptive RAG default | A | none |
| 3 | A2 — Corrective RAG + web fallback | A | #2 |
| 4 | A3 — 5-tier + graph memory | A | none |
| 5 | A7 — Skills tool-use loop | A | none |
| 6 | A4 — DAG orchestration endpoint | A | none |
| 7 | A5 — Verbalized sampling (opt-in) | A | none |
| 8 | A8 — LLM-judge wired in testing path | A | none |
| 9 | D — Pipeline-timeline event stream + RAG/memory step records | D | #1–#5 |
| 10 | C — Legal Chat dashboard tool (Phase 1 — chat + selectors + workflow visualizer) | C | #9 |
| 11 | C — Legal Chat dashboard tool (Phase 2 — SME rubric + GRPO write-back) | C | #10 |
| 12 | B1–B5 — Test depth | B | parallelizable across all of the above |

Each row is intentionally small enough to be one task agent's scope and
mergeable in a day.

---

## 6. Out of scope for this plan

- Production EKS migration, multi-region DR, partner-ALB target groups —
  tracked in `NYV-ROADMAP-Q2-Q4-2026.md` §6.
- New ML training (GRPO model retraining itself) — only the data-collection
  side is in scope here.
- Mobile UI work for the Legal Chat — desktop / dashboard only initially.
- Public SDK quickstart fixes (#57, #59) — already in the production roadmap.
