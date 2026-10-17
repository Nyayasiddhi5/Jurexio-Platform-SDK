# NYV Orchestration Optimization — Measured Plan (2026-08-15, rev 2026-08-16)

> **Status:** RCA complete, measured on live nysdev + caselaw-worker.
> **Phase 0 shipped** (`2026-08-15T0946Z-aws-ssm`).
> **Phase 4a shipped** (`2026-08-15T1422Z-aws-ssm`, `2026-08-15T1842Z-aws-ssm`) —
> see §1.0g / §1.0h for the Queen measurement that drove it and the measured
> before/after.
> **Phase 4b shipped** (`2026-08-16T0403Z-aws-ssm`, `2026-08-16T0429Z-aws-ssm`) —
> evidence-based model selection (§8.3, §8.4a): live availability probe + latency
> bench, dead `gemini-2.5-*` rungs removed, the stale second catalog in
> `cost-aware-router` retired, and `maxCostUsd` made enforceable end-to-end.
> Measured: exploration leaves **$1.50/$12 → $0.075/$0.60 per 1M**, completion
> latency **−54 %**, node failures **3 → 0**.
> **Phase 4b metering shipped** (`2026-08-16T0535Z-aws-ssm`, `2026-08-16T0622Z-aws-ssm`)
> — M1–M4 closed (§2.4a): hedge-loser waste now counted (excluded from billing),
> the envelope reports true fan-out via `cost.completions`, and streamed spend is
> read from provider usage (`usageSource=provider`) instead of `length / 4`.
> **Phase 4c shipped** (`2026-08-16T0910Z-aws-ssm`) — the intermittent swarm 500 was
> **not a timeout**: it was `mandatory steps missing: cot`, thrown *after* a correct
> answer was produced and billed, because the collective path never ran
> `maybeRunQueenCoT` (NV-QUEEN-COT-COLLECTIVE-001). Fixed and live.
> **Phases 1, 2, 3, 5, 6 shipped in the same batch** (`2026-08-16T0910Z-aws-ssm`,
> SSM `f22c1473`): deterministic tool tier wired end-to-end, cache key/semantic
> cache repaired, prompt budget tiers, reliability ladder (jittered backoff, shared
> Redis breaker, unified quarantine, request-scoped deadlines, boot-time cascade
> validator), and the memory subsystem including the cross-tenant leak. Two
> security defects were found *by* this work and fixed: **NV-CACHE-NS-FORGERY-001**
> (caller-supplied cache namespace — cross-tenant read, poison, and a one-call
> platform-wide flush on a `documents:read` key) and **NV-CASCADE-DRIFT-001**
> (a dead Bedrock Haiku rung silently dropped from every premium ladder).
>
> **⚠ The 70 % claim is NOT yet evidenced on the Queen path — two gaps are measured, not closed.**
> Parallelising the swarm worked (3 lanes dispatch in the same millisecond) and yet
> wall time moved only ~390 s → **366 s**. The 7 completions sum to **130 s against
> 366 s wall**, so **236 s (65 %) is spent outside model calls entirely** — neither
> per-leaf cost nor per-call latency was ever the dominant term. And **Phase 3's
> prompt cuts are not reaching Queen leaves**: leaf prompts measure **19,938 tokens**
> against the **1,048** achieved on the micro path. The cost reduction therefore
> holds where the budget tiers apply and **does not yet hold on the Queen path**.
> These two items are now the top priority; see §12.
>
> Metering is trustworthy as of this batch: the envelope claimed **7 completions and
> 7 were independently counted** from provider log lines, and stream usage reads
> `usageSource=provider`. Savings can now be measured rather than asserted.
>
> Everything in §1 is a **measured live number**, not an estimate. No secret values.
> Companion audits: LLM routing core, agentic/decomposition core.
> Probes: `scripts/_ec2-queen-fanout.sh`, `_ec2-queen-shape.sh`,
> `_ec2-swarm-fail-rca.sh`, `_ec2-phase4a-verify.sh`, `_ec2-model-avail-probe.sh`,
> `_ec2-model-bench.sh`, `_ec2-leaf-tier-verify.sh`, `_ec2-meter-verify.sh`,
> `_ec2-batch-verify.sh`, `_ec2-swarm-latency-breakdown.sh`.
>
> **Deploy verification gotcha (cost one wasted cycle).** The gateway runs
> `tsx src/index.ts`; the shipped artifact is TypeScript **source** under `/app/src`
> and `/app/dist` holds client assets only. Grepping `/app/dist/index.js` returns 0
> for every marker — including markers that predate the batch — and reads as a
> failed deploy. `_ec2-batch-verify.sh` greps source and asserts a known-old marker
> as a canary so a path mistake fails loudly instead of mimicking a rollback.
>
> **What is still required before any published % claim.** Metering (M1–M4) is now
> fixed, so spend is finally measurable — but a *measured* 70 % figure needs a
> before/after on a fixed prompt set, not a projection. §2.6 defines that set. Two
> corrections already came out of measuring rather than reasoning: the audit's
> "6–8 Queen completions" did not reproduce (worst case 5), and this plan's own
> per-request cost figures were understated because they were read from the
> under-reporting envelope.

---

## 1. The measured baseline (why direct LLM calls "feel" faster)

Identical prompt (Indian counsel, anticipatory bail under BNSS 482, ~48 tokens),
`us-east-1` from the gateway host, 2026-08-15.

### 1.0 Per-task-class cost baseline — the number the 70% claim must beat

Live `POST /api/nv/orchestrate`, NSP SDK key, 2026-08-15 (SSM `74ae0e73`).
`inflation` = prompt tokens actually sent ÷ user's own tokens.

| Task class | Wall | Model chosen | Prompt tok | Out tok | Inflation |
|---|---|---|---|---|---|
| micro-FAQ "What is BNS 103?" | 33.0 s | gemini-3-1-pro | **3,592** | 1,537 | **898×** |
| mapping (Phase 0 fast path) | **0.07 s** | `nys-statute-map` | **0** | 0 | **0×** |
| short chat | 34.4 s | gemini-3-1-pro | 5,345 | 1,432 | 411× |
| classify / extract | 40.7 s | gemini-3-1-pro | 3,442 | 1,489 | 164× |
| research | 40.8 s | gemini-3-1-pro | 5,388 | 1,660 | 168× |
| drafting | 65.4 s | gemini-3-1-pro | 5,426 | 2,444 | 201× |

**Repeat test.** The identical micro-FAQ run three times cost **3,659 / 3,658 /
3,658** prompt tokens at 27.0 / 30.9 / 27.3 s. Nothing caches. Nothing gets
cheaper. A four-token question costs the same every single time.

**Blended today: $0.02445 per request · 5,851 tokens · 36.4 s.**

Note also that *every* class except mapping resolved to the **same** model
(`gemini-3-1-pro-preview`) — a classify task and a filing-grade draft are routed
identically. There is effectively no task-aware model selection in production.

### 1.0b NYS already knows an LLM is unnecessary

Live `POST /api/nv/knowledge/retrieve` (SSM `f309e7b4`):

| Query | Intent | `llmRequired` | Time |
|---|---|---|---|
| "What is BNS 103?" | `statute` | **false** | **51 ms** |
| "What BNS section replaced IPC 302?" | `ipc-bns-compare` | **false** | 55 ms |
| "Is anticipatory bail available for BNS 318(4) cheating?" | `statute` | **false** | 47 ms |
| "Leading SC authorities on anticipatory bail in economic offences" | `case-search` | **false** | 2.03 s |
| "Draft an anticipatory bail application under BNSS 482" | `generate` | **true** | 0.70 s |

NYS answered the first four with a reason string ("Resolved BNS 103 from the
local statutes corpus", "Corpus search returned relevant authorities; no
generation needed") in **47 ms–2 s**. We then spent **33–41 s and 3,442–5,388
prompt tokens** asking a Pro model the same thing. The classifier we need
already exists and already runs.

### 1.0c The hedge fires on every request and the loser is never cancelled

Live log analysis over 20k lines (SSM `3c195079`):

| Fact | Evidence |
|---|---|
| Hedge fired on **33/33** LLM requests | `NYV_LLM_HEDGE_MS=2500`, `eligible.length >= 2` always true |
| `gemini-3-1-pro-preview` won **78.8 %** (median 25.9 s) | `hedge success` log lines |
| `global.anthropic.claude-sonnet-5` won **21.2 %** (median 16.2 s) | same |
| `us.anthropic.claude-opus-5` — the configured cascade **lead** — won **0/33** | never appears in any log line |
| The losing branch is **never cancelled** | `callModel()` takes no caller `AbortSignal` — `llm-orchestrator.ts:735-745` |
| Only the **winner** is metered | `recordLlmUsage()` records `winner.result` only — `llm-orchestrator.ts:934-940` |

**Consequence: we pay for two full completions on every request and record one.**
True provider spend is **$0.04891/req** against a metered **$0.02445** — a **100 %
invisible overspend** that no dashboard shows. This is not a quality trade-off;
it is pure waste, and it is the single largest cost defect found in this audit.

`NYV_LLM_CASCADE_LEAD` starts with `us.anthropic.claude-opus-5`, and
`NYV_ROUTER_BEDROCK_FIRST=on`, so the intended primary is the most expensive
model in the catalog. It never wins — the 2.5 s-delayed secondary beats it — so
we get Opus-5-lead *cost exposure* with Gemini/Sonnet *latency*, the worst of
both. Note the catalog also lists `gemini-3-flash-preview` at **$0.30/$2.50 with
`legalQuality: 90`, `speedScore: 95`** — it is never selected for any task class.

### 1.0d Three defects that make the pipeline pay twice for nothing

Deep audits of the prompt, RAG, and memory layers found three arithmetic/wiring
bugs that each inflate every request. All three are verified live.

**(a) Re-retrieval fires on 100 % of RAG requests — the threshold is unreachable.**

`scoreConfidence` is `0.45 + mean(top-3 RRF score)` (`nv-auto-rag-router.ts:27-31`).
RRF contributes at most `1/(k+rank+1) = 1/61 = 0.0164` per list (`:120-140`, k=60),
and the pipeline fuses at most 5–6 lists. So the ceiling is:

| Lists fused | Max chunk score | Max confidence | vs 0.55 threshold |
|---|---|---|---|
| 3 | 0.0492 | 0.4992 | fires |
| 5 | 0.0820 | 0.5320 | fires |
| 6 | 0.0984 | **0.5484** | **still fires** |

Live values confirm it exactly — `conf=0.46613`, `0.47700`, `0.48244`, `0.50361`,
with `auto-rag re-retrieval pass beforeConf 0.466 afterConf 0.482 kept:true`. The
threshold `NYV_RAG_RERETRIEVE_MIN_CONFIDENCE=0.55` (`:568`) is **mathematically
unreachable**, so every RAG request pays a second full retrieval pass: +3
embeddings, +3 DB queries, +1 NYS round trip. The same bug makes the abstain
gate's 0.45 floor reachable only on *zero* chunks, and makes the `confidence`
returned to SDK clients a near-constant ~0.47. **Normalising RRF before scoring
fixes three symptoms with one change.**

**(b) The extras deadline discards work but does not cancel it.**

Live: `auto-rag extras deadline — using unified-base only, extrasDeadlineMs:2500,
jobs:3`. The race is `Promise.race` + `setTimeout` with **no `AbortController`**
(`:533-540`), so the timed-out jobs keep running, keep their DB/HTTP connections,
and — critically — the adaptive layer keeps its **LLM generations** billing
(`adaptive-rag-service.ts:512-539`, `:603-636`, 2048 max tokens). We pay for
retrieval output we have already thrown away. Same defect class as the hedge.

**(c) The prompt is not RAG or memory — it is a duplicated preamble.**

The 3,442–5,426 prompt tokens are overwhelmingly static scaffolding, which is why
`enableRAG:false` / `enableMemory:false` / a caller `systemPrompt` changed nothing:

| Component | Tokens | Gating |
|---|---|---|
| L1 registry agent layer | ~1,192 | unconditional |
| `UNIVERSAL_LEGAL_CORE` | 806 | forced on unless `NYV_LEGAL_INTEL_FORCE=0` |
| `buildLegalAdviceSystemPrompt` (incl. `INDIA_CORE` 438) | 542 | default for chat |
| `JURISDICTION_INJECTIONS.IN` | 134 | unconditional |
| BNSS overlay, injected **twice** in one build | +167…350 | `:91` then `:113`→`:288` |
| `promptEnhancementPipeline.enhance()` on the user turn | +63 | `enableOrchestration` default true |

Jurisdiction is stated **three times** (`INDIA_CORE` + `JURISDICTION_INJECTIONS.IN`
+ registry `section_3_jurisdiction`) — ~580 tokens of pure restatement of
"BNS/BNSS/BSA not IPC/CrPC/IEA". Prior turns reach the model in **three** places
(`previousMessages`, `[Relevant Context from Memory]`, `Recent Conversation:`).
Both prompt compressors are **dead by default** (`NYV_SPECIALIST_PROMPT_COMPILER`
/ `NYV_QUEEN_PROMPT_COMPILER` unset in every deploy script), and there is **no
provider prompt caching anywhere** — no `cache_control`, no `cachedContent` — even
though `bundle.hash` + a 30-min TTL already exist as the correct cache key.

One caveat on the audit's headline: a duplicate system message *is* constructed
(`nv-client.ts:913-917` plus `llm-orchestrator.ts:834-837`), but our live winners
filter it — `callGoogle` drops `role === 'system'` (`:340`) and so do Bedrock,
Anthropic, Vertex and OmniRoute. The duplication bites only OpenRouter / Sarvam /
OpenAI-direct / Perplexity, which serve ~0 % of current traffic. **Worth fixing
for correctness, but it is not where today's tokens are going.**

### 1.0f LLM-call multipliers — measured, and two audit claims corrected

Source audit: CoT + maker-checker are "ON by default" and a Queen request costs
"6–8 completions". **Measured on nysdev 2026-08-15** with
`scripts/_ec2-queen-multiplier.sh`, counting `hedge success` log lines (the hedge
fires on every provider call, so one line == one billed completion):

| Probe | Wall | Billed completions | Metered `tokens` | Layers |
|---|---|---|---|---|
| A: plain prompt (no flags) | 34.5 s | **1** | in 5056 / out 1531 | `unified-base`, `nys_global` |
| B: `complexity:very_complex` + `enableCoT:true` | 49.3 s | **3** | in 5227 / out 1929 | + `re-retrieval` |
| C: `forceLegalBestOutcome:true` | 40.4 s | **2** | in 5187 / out 2065 | + `re-retrieval` |

Corrections to the audit:

1. **CoT is NOT on by default on the live specialist path.** The audit is right
   that `nv-adaptive-router.ts:328` sets `requireCoT` when `complexity === 'moderate'`
   (and `normalizeComplexity` defaults to `moderate`, so `requireCoT` really is
   true for a flagless request). But `nv-client.ts:1143` is now
   `const shouldRunCoT = !!enableCoT;` under comment **NV-COT-001** — an earlier
   fix already removed the additive post-hoc CoT tax. Probe A confirms it:
   `cot=False`, 1 completion. The dead `requireCoT` plumbing should be deleted so
   the next reader does not "re-fix" it.
2. **The 6–8-completion Queen fan-out did not reproduce.** Worst measured case is
   **3**. The adaptive router kept all three probes on the specialist path
   (`agents=None`), so swarm/HTA breadth is real code but not on this route. Its
   priority drops until we have a probe that actually reaches it.
3. **Maker-checker did not fire** even with `forceLegalBestOutcome` — `mc=None` in
   all three probes. `nv-queen-orchestrator.ts:254` (`tier !== 'lite'`) is a real
   flag bypass and this key resolves to `tier=enterprise`, but the Queen path
   never ran, so it stayed unreached.

What *is* confirmed and costly:

- **Probe B's 3rd completion is the `re-retrieval` defect from §1.0d**, now
  independently reproduced: `layers` gains `re-retrieval` on B and C but not A.
- **Metering hides the multiplier.** The response envelope's `tokens` reports a
  single completion (out 1929 for 3 calls). Billing is *not* under-charged —
  `recordRequestCredit` (`nv-orchestration-routes.ts:173-176`) reads the summed
  `getRequestUsage()` accumulator, and `llm-orchestrator.ts:1088` calls
  `recordLlmUsage` per call. So the customer is billed correctly while **our own
  response payload under-reports 2–3×**, which is why the earlier per-request
  cost estimates in this document read low.
- **The hedge loser is still billed** (§1.0c) and is *not* passed to
  `recordLlmUsage` — only `winner.result` tokens are recorded at `:963-968`. So
  provider spend exceeds even the summed accumulator.

Net: the emergency bundle in §2.4 is unchanged in substance, but the ranking
shifts — kill `re-retrieval` and hedge waste first; CoT/maker-checker gating is
mostly *documentation debt* on the live path, not active spend.

### 1.0g The Queen path, finally measured — and it was broken, not just costly

The earlier probes never reached the Queen. Reason: `nv-orchestration-routes.ts`
does **not** destructure `complexity` from the request body, so
`{"complexity":"very_complex"}` was silently ignored; server-side
`complexityAssessment` decided instead. The lever that works is
`orchestrationMode` (`:313` → `engageQueenForced` `:342` → `decideAdaptivePath`
rule 2 at `nv-adaptive-router.ts:176`). Probe: `scripts/_ec2-queen-fanout.sh`,
which reads the authoritative path from the `AdaptiveRouter decision` log line.

| Probe | Router path | Billed completions | Wall |
|---|---|---|---|
| no `orchestrationMode` | `doc-pipeline` | 3 | 66.6 s |
| `orchestrationMode=parallel` | **queen** | 1 | 95.5 s |
| `orchestrationMode=swarm` | **queen** | **5** | 162.3 s |
| `orchestrationMode=hierarchical` | **queen** | 1 | 123.7 s |

So the source audit's "6–8 completions per Queen request" is **not reproduced**;
worst measured is 5. But measuring the path surfaced three defects that reading
the code had not, all of which cost money *and* quality:

1. **The Queen's answer was being thrown away.** `parallel` and `hierarchical`
   returned a 732-char BNSS 482 excerpt instead of the litigation strategy. The
   208-char prompt satisfied every condition in `isShortStatuteFaq` (< 280 chars,
   parses a section reference, matches no excluded keyword), so the strict
   statute-FAQ gate replaced the synthesised multi-agent answer — **after** we had
   paid for up to five completions. Fixed: **NV-STATUTE-FAQ-SCOPE-001**.
2. **A crash was misread as a policy verdict.** `safety.hallucination-check` is
   reachable as a *subtask leaf* (it sits in the `quality_check` / `review` / `qa`
   intent maps) where no upstream output exists. `params.outputText.match()` threw
   `Cannot read properties of undefined`, and because the capability id starts with
   `safety.`, the Queen's `safetyReject` test treated a TypeError as a compliance
   rejection and failed the whole agent in production. Fixed:
   **NV-HALLUCHECK-GUARD-001** + **NV-QUEEN-CAPERR-CLASSIFY-001**.
3. **Nodes each claimed a fresh timeout.** All three swarm nodes failed with
   `per-node timeout after 120000ms`. `NV_TIMEOUTS.orchWallClockMs` (540 s) and
   the per-tier `wallClockMs` both existed but **nothing enforced either**, so
   wall time was `nodes × perNodeTimeout` and every timed-out generation was
   still billed. Fixed: **NV-QUEEN-DEADLINE-001**.

### 1.0h What Phase 4a actually delivered (measured before → after)

Deploys `2026-08-15T1422Z-aws-ssm` and `2026-08-15T1842Z-aws-ssm`, verified by
`scripts/_ec2-phase4a-verify.sh`.

| Probe | Before | After |
|---|---|---|
| single-section FAQ "What does BNSS 482 say?" | 30.2 s · **2 completions** · 1,350 out tok | **0.077 s · 0 completions · 0 tokens** |
| multi-issue strategy (forced Queen) | 732-char excerpt, strategy discarded | **7,527 chars**, PMLA + SEBI + limitation all present |
| re-retrieval | fired on **100 %** of RAG requests | **does not fire** |
| hedge loser | ran to completion, billed | **cancelled on every request** |
| `reading 'match'` TypeError | fired on Queen path | **zero** |
| Phase 0 mapping fast path | 0.13 s, zero LLM | **0.26 s, zero LLM** (unchanged) |

The FAQ result is the pattern to generalise: the strict gate was always going to
replace the model's answer with a deterministic excerpt, so paying two
completions to generate text we discard was pure waste. **NV-STATUTE-FAQ-PRELLM-001**
resolves it before the model — a 390× latency improvement at zero tokens.

Still open on the Queen path: three swarm nodes continue to hit the per-node
timeout (now bounded by the request deadline rather than multiplying it). That is
a *latency/quality* problem — Gemini 3.1 Pro taking 30–60 s per node — which
Phase 4's task-tiered model policy addresses by putting a fast model on leaf
nodes and reserving the premium model for synthesis.

### 1.0e Already-built capability that never runs

| Capability | Where | Why it never fires |
|---|---|---|
| Neural rerank (Cohere / Voyage / cross-encoder) | `nv-auto-rag-router.ts:642-645` | Live log: `rerank skipped — no neural provider configured`. Flag is ON; no key is set. |
| `rag.corrective` (grading, web fallback, 5 iterations) | `capability-manifest.ts:2329` | Manifest passes an **array** where a `retrieveDocuments` **function** is expected → throws every call, swallowed at `:324-327`. |
| `rag.self` | `capability-manifest.ts:2350` | Same argument-shape bug. |
| MMR diversity re-ranking | `nv-legal-reranker-service.ts:152-184` | Auto-RAG calls `rerankLegal` directly, bypassing `rerankResults`. |
| LightRAG | `nyv-lightrag-pipeline.ts:202-208` | Entities live in in-process `Map`s written only by `nv-patterns-routes.ts:1426` → scans an **empty store** in production. |
| Semantic cache | `nv-cost-optimization-suite.ts:97-127` | **Zero callers.** |
| `NyvMemoryCompiler` (real 800-token compression, no LLM) | `nyv-memory-compiler.ts:606`, `:635` | `queryKnowledge` / `buildContextFromArticles` have **zero callers** — write-only orphan. |
| Durable L2–L5 memory (Postgres, encrypted) | `nv-5tier-memory-service.ts` | Reachable only from manual tool routes; **never enters a prompt**. |
| `memoryCharCap` (280–480 chars) | `nv-context-budgets.ts:56` | Queen honours it; `nv-client.ts:701-703` interpolates raw content → **4–8× the intended budget**. |

Two further items require attention beyond cost. Graph memory filters
`n.userId` with `|| !n.userId` (`graph-memory-service.ts:215`), so any node stored
without a `userId` is readable by **every user** — a cross-tenant read that should
be closed regardless of the optimisation programme. And the memory layer's
`totalTokensSaved` hardcodes `compressedTokens = originalTokens * 0.1` (`:278-280`)
to back a "90 % savings" claim while performing no compression at all.

### 1.1 Direct provider calls

| Provider / model | Wall time | In → out tokens |
|---|---|---|
| `us.amazon.nova-pro-v1:0` | **3.6 s** | 48 → 406 |
| `gemini-3.1-flash-lite` | **3.1 s** | 48 → 596 (no thinking) |
| `gemini-3.7-flash` | **6.5 s** | 48 → 497 (+888 thinking) |
| `global.anthropic.claude-haiku-4-5` | **7.8 s** | 60 → 666 |
| `gemini-3.5-flash` | 10.5 s | 48 → 352 |
| `global.anthropic.claude-opus-4-8` | 14.8 s | 77 → 922 |
| `gemini-3.6-flash` | 14.6 s | 48 → 519 |
| `global.anthropic.claude-sonnet-5` | **16.4 s** | 77 → 1185 |
| `gemini-3.1-pro-preview` | 19.3 s | 48 → 400 |
| `us.anthropic.claude-opus-5` | **32.9 s** | 77 → 2048 (hit `max_tokens`) |

### 1.2 Our orchestration, same prompt

| Run | Wall time | Model chosen | In → out tokens |
|---|---|---|---|
| counsel prompt | **19.1 s** | `global.anthropic.claude-sonnet-5` | **6,829** → 1,105 |
| counsel prompt (repeat) | **17.8 s** | `global.anthropic.claude-sonnet-5` | **7,344** → 1,050 |
| short FAQ (20 tokens) | 28.5 s | `gemini-3-1-pro-preview` | **5,059** → 1,445 |
| short FAQ + `enableRAG:false` | 27.7 s | `gemini-3-1-pro-preview` | **5,413** → 1,560 |
| short FAQ + RAG **and** memory off | 26.1 s | `gemini-3-1-pro-preview` | **5,417** → 1,404 |
| short FAQ + caller `systemPrompt` | 28.1 s | `gemini-3-1-pro-preview` | **5,431** → 1,526 |
| short FAQ, identical repeat | 30.4 s | `gemini-3-1-pro-preview` | **5,335** → 1,525 |

### 1.3 The four facts that explain everything

1. **Token inflation ~250×.** A 20-token question becomes **5,059–5,431** prompt
   tokens. The orchestrator only ever *appends* (jurisdiction block, overlay,
   compliance directives, RAG, memory); nothing trims.
2. **Caller flags do not reduce cost.** `enableRAG:false`, `enableMemory:false`,
   and supplying our own `systemPrompt` all produced **more** prompt tokens, not
   fewer. The knobs are advisory; the overlay is unconditional.
3. **Cache never hits.** The identical prompt repeated back-to-back cost full
   tokens and took *longer* (30.4 s vs 28.5 s). The LM cache "semantic" match is
   hash-prefix overlap over two SHA-256s, so only a byte-identical normalized
   prompt can ever match — and real embedding matching is behind a disabled flag.
4. **Model choice is not the bottleneck; our own layers are.** Sonnet 5 direct
   is 16.4 s and our Sonnet 5 answer is 19.1 s — only ~2.7 s of orchestration on
   that path. But the short-FAQ path spends **28 s** to answer a question
   `gemini-3.1-flash-lite` answers directly in **3.1 s**, because we route a
   trivial FAQ to a Pro model with a 5k-token preamble.

**Conclusion.** We are not slow because our models are slow. We are slow because
we send a 250× larger prompt to a heavier model than the task needs, then never
reuse the answer. That is the exact opposite of the 70 % token MOAT.

---

## 2. Is the 70 % claim actually achievable? Yes — and here is the arithmetic

`scripts/nv-cost-model.py` computes this from the §1.0 measured tokens and
published per-1M prices. Run it any time to re-derive.

| Scenario | Blended $/req | Cost cut |
|---|---|---|
| **Today (metered — winner only)** | **$0.02445** | — |
| **Today (true provider spend, hedge loser billed)** | **$0.04891** | — |
| Phases 1+3+4, Opus 5 on 20 % of drafts | $0.00578 | **76.3 %** |
| Phases 1+3+4, Opus 5 on 10 % of drafts | $0.00550 | **77.5 %** |
| …plus working cache at 25 % hit rate | **$0.00412** | **83.1 %** |
| …plus cache at 35 % hit rate | $0.00357 | 85.4 % |
| vs **true** spend today (incl. hedge cancel) | $0.00412 | **91.6 %** |

Alongside: **tokens 5,851 → 1,252 (−78.6 %)** and **latency 36.4 s → 5.0 s (−86 %)**.

All prices are read from **our own** `model-catalog.ts`, so the model is auditable
against the code rather than an external price page.

### 2.1 Which lever earns what (remove one, keep the rest)

| Remove this lever | Cost cut falls to |
|---|---|
| Deterministic tier | 65.7 % |
| Prompt token budgets | 67.4 % |
| Model right-sizing | 68.3 % |
| Opus-5 escalation discipline | 66.9 % |

The levers **overlap**, so removing any single one still lands 65–68 %. That makes
the 70 % claim robust rather than fragile — but only once the set ships. Today
**none** of them are in effect: every task class routes to `gemini-3-1-pro` with a
~5 k-token prompt and an un-cancelled parallel hedge.

Ranked by marginal contribution to the 83 % figure: deterministic tier ~11 pts,
Opus-5 discipline ~9 pts, prompt budgets ~9 pts, model right-sizing ~8 pts,
cache ~6 pts — **plus hedge cancellation, which alone removes 50 % of true spend.**

Re-derive any time: `python3 scripts/nv-cost-model.py`.

### 2.2 Honest framing for the claim

> Nyayavigya answers the majority of legal requests **without an LLM at all**,
> routes the rest to the cheapest model that meets a measured quality bar, and
> reserves frontier models for filing-grade work — delivering **~70 % lower cost
> and ~85 % lower latency than a naive direct-to-frontier integration**, with PII
> redaction, Bar-Council guardrails, and citation verification that direct API
> access cannot provide.

That statement is defensible **once phases 1–4 ship**. It is not defensible today,
and the current "70 % token optimization" claim is **not** defensible at all,
because no code implements it — see §12.

### 2.3 Phase 4a is the emergency fix

Cancelling the hedge loser and demoting the Opus-5 lead is a **config + small
code change with the largest and most immediate impact**:

- Add a caller `AbortSignal` to `callModel()` and abort the loser when the race
  resolves → **removes ~50 % of true provider spend, zero quality change**.
- Set `NYV_LLM_CASCADE_LEAD` to lead with `global.anthropic.claude-sonnet-5`
  (`legalQuality: 100`, 0.6× the Opus 5 price) and gate `us.anthropic.claude-opus-5`
  behind an explicit filing-grade signal.
- Raise `NYV_LLM_HEDGE_MS` above p50 latency (or gate the hedge to
  latency-critical paths only) so it stops firing on 100 % of requests.
- Meter **all** attempts, not just the winner, so waste is visible.

None of this touches prompt content, so it carries no answer-quality risk and can
ship ahead of the engineering-heavy phases.

### 2.4 Phase 4a extended — the zero-quality-risk waste bundle

The deep audits found three further defects in the same class as the hedge: work
we pay for and then discard, with no bearing on answer wording. All belong in the
same first deploy.

| Fix | Location | Effect |
|---|---|---|
| Cancel the hedge loser (`AbortSignal` into `callModel`) | `llm-orchestrator.ts:735-745`, `:856-989` | −50 % of true spend |
| Normalise RRF before `scoreConfidence` | `nv-auto-rag-router.ts:27-31` | Stops re-retrieval firing 100 % of the time; also repairs the abstain gate and the client-facing `confidence` |
| `AbortController` on the extras race | `nv-auto-rag-router.ts:533-540` | Stops paying for adaptive-RAG LLM generations already discarded at the 2500 ms deadline |
| Restrict adaptive-RAG to non-generative sources inside Auto-RAG | `adaptive-rag-service.ts:144-151`, `:512-539`, `:603-636` | Removes 1–2 full 2048-token generations per mitra+ request from a **retrieval** layer |
| Apply `memoryCharCap` when assembling memory context | `nv-client.ts:701-703` | 4–8× reduction in memory tokens (Queen already honours it) |
| Meter all attempts, not just the winner | `llm-orchestrator.ts:934-940` | Makes the remaining waste visible |

Every row is a bug fix rather than a behavioural trade-off, so this bundle needs
no prompt eval. Two items outside the cost programme should ride along: close the
cross-tenant graph-memory read (`graph-memory-service.ts:215`, drop `|| !n.userId`)
and delete the fabricated `totalTokensSaved` (`:278-280`).

### 2.4a Metering fixes that must land before we publish any % claim

Verified 2026-08-15. These are measurement defects, not spend defects, but every
saving in §2.1 is currently unverifiable on the affected traffic.

| # | Defect | Where | Fix |
|---|---|---|---|
| M1 | Hedge loser's tokens never recorded — only `winner.result` is passed to `recordLlmUsage` | `llm-orchestrator.ts:963-968`, `:1088` | Record the loser too (tagged `wasted:true`) so the waste is visible before we cancel it |
| M2 | Response envelope `tokens` reports one completion while 2–3 were billed | measured probes A/B/C, §1.0f | Emit summed `getRequestUsage()` into the envelope, plus a `completions` count |
| M3 | OpenAI / OpenRouter streams estimate tokens as `length / 4`; no `stream_options:{include_usage:true}` | `real-llm-service.ts:2679`, `:2683`, `:2759`, `:2763` | Request real usage; thread it out of `streamLLM` |
| M4 | Queen synthesis stream estimates in/out from `.length / 4` | `nv-queen-orchestrator.ts:4992-4993` | Same |

Anthropic non-stream/stream-final is the only path already using real provider
usage. Billing itself is correct (the credit enforcer reads the summed
accumulator), so M1–M4 are transparency fixes — but M2 is why this document's
earlier per-request cost figures under-stated true spend.

### 2.5 Prompt caching is a fallback, not a parallel win

Provider prompt caching is absent everywhere (no `cache_control`, no
`cachedContent` in `src/`), and `bundle.hash` + a 30-min TTL already exist as the
correct key. But modelled on top of Phase 3 it adds only **~2 pts** (83.1 % →
85.2 % at a 95 % prefix hit rate), because token budgets have already shrunk the
static prefix. **Caching and budgets are substitutes.** Its real value is as
insurance: if the legal eval blocks aggressive prompt trimming, caching recovers
most of the saving with **zero wording change**. Sequence it after Phase 3, and
promote it only if Phase 3 is forced to back off.

### 2.6 The benchmark set that turns "70 %" from a projection into a measurement

> **⚠ THE "3 COMPLETIONS" FINDING IS WITHDRAWN — IT WAS LOG-WINDOW POLLUTION, NOT FAN-OUT (2026-08-16).**
>
> `single-issue-advice` was reported as billing **3 LLM completions for a
> single-issue question** and named the platform's largest cost defect. A
> **request-scoped** probe on the live gateway disproves it:
>
> ```
> API response requestId : b7bf988c-0d4a-4b71-98d9-e88c268d85a5
> billed lines matching  : 0          ← request-scoped count
> billed lines in window : 3          ← requestIds 64597269, 6c7180ac, bf082e8c
> ```
>
> The three billed lines carry **three different requestIds**, none of which is
> the one the API returned. They are three *unrelated concurrent requests* on a
> shared dev host, not three calls for one request.
>
> **Root cause — `NV-REQID-CORRELATION-001`:** `nv-client.ts:475` mints its own
> `requestId` with `crypto.randomUUID()`, unrelated to the id returned to the
> caller in the envelope. Provider log lines are therefore **impossible to
> correlate to an API response**, so the harness silently degrades to
> `scopeMode: 'window'` and counts every billed line in a time window. On an idle
> host that is right; on a shared host it counts other traffic. This is why
> `tokensInKnown: 0` and `callsWithTokenDetail: 0` on that row — the "3 calls" had
> no token data because they were never this request's calls, and the per-request
> cost was then back-filled pro rata from the envelope, manufacturing the
> −154 % figure.
>
> **Consequence:** every per-class fan-out and cost number in the v1 passes is
> unreliable in the same way, including the swarm's "11 completions". Combined
> with the set-composition defects below, **no cost figure from the v1 harness
> stands** — in either direction.
>
> **This must be fixed before any further measurement:** thread one correlation id
> from ingress through every dispatch site so `scopeMode` can be `request` rather
> than `window`. Until then the harness cannot attribute spend to a request, and
> that — not the orchestration — is the top blocker on proving the 70 % claim.
>
> **RESOLVED 2026-08-16 — `NV-REQID-CORRELATION-001` is fixed.** One id now flows
> ingress → dispatch on both paths:
>
> - `NvOrchestrationOptions.requestId` added; `nv-client.ts` now does
>   `inboundRequestId || crypto.randomUUID()` instead of minting unconditionally.
> - `nv-sdk-orchestration-wrapper.ts` forwards `requestId: req.id` (it previously
>   passed `req.id` as `sessionId` only, which never reached the dispatch id).
> - Queen path: the route seeds `queenRequest.requestId`, `orchestrationId` now
>   prefers the caller id, and all **five** standalone-UUID dispatch sites are
>   parent-scoped — `::leaf-*`, `::synthesis`, `::synthesis-blocking`, `::cot`,
>   `::plan` — so leaf fan-out is attributable for the first time.
> - Chain verified end-to-end: `nv-client` sets `LLMRequest.id`; `real-llm-service`
>   logs `requestId: request.id`; the route returns the same id to the caller.
> - Locked by `tests/unit/nv-reqid-correlation.test.ts` (11 tests). These are
>   source-level assertions deliberately: the defect was a missing argument at a
>   call seam, which a mocked LLM stack would pass straight through.
>
> Fan-out and cost may now be re-measured with `scopeMode: 'request'`. The v1
> figures stay withdrawn; they were produced by the broken instrument.
>
> **Verified live on nysdev (deploy `2026-08-16T1516Z-aws-ssm`, container 15:26Z):**
> `scripts/_ec2-reqid-correlation-verify.sh` returned `http=200`,
> `requestId=332fe4df-6057-4ae0-ab97-2de07dec537f`, and that id **matches the
> billed provider line exactly**:
>
> ```
> request-scoped billed calls : 1   ← gemini-3-1-pro-preview, id 332fe4df…
> foreign lines in window     : 2   ← concurrent traffic, correctly excluded
> ```
>
> Two conclusions, both material:
>
> 1. **Correlation works.** Pre-fix this probe matched **0** billed lines; it now
>    matches the request's own call. Cost is attributable per request.
> 2. **Real fan-out on `single-issue-advice` is 1, not 3.** The 2 excluded foreign
>    lines are exactly what the window-scoped harness was counting. This closes
>    the "3 completions" item as **disproven, not fixed** — there was never
>    anything to cut. Marker verify also shows **0** standalone-mint dispatch
>    sites remaining in the Queen, with the `maybeRunQueenCoT` canary at 3.
>
> Residual gap (pre-existing, separately tracked): `hedge success` lines still
> carry no `tokensIn`/`tokensOut`, so per-call token detail is absent even though
> the call is now correctly attributed. Cost must still be read from the envelope
> for hedged calls.
>
> The three real dispatch sites on the specialist path do exist and are worth
> auditing on their own merits, but are **NOT** shown to all fire on one request:
> `nv-client.ts:1121` (main), `:1213` (JSON-parse retry, fires only on invalid
> JSON), `:1290` (Self-RAG regeneration, gated on tier pro/elite/government AND
> taskType analysis/research/contract-review).

>
> The v1 frozen set cannot measure the 70 % claim, for three structural reasons
> found by auditing the set itself rather than its output:
>
> 1. **30 % of blended weight is trivial statute lookups** (`statute-faq` 0.22 +
>    `statute-mapping` 0.08). "What does BNS section 103 say?" scores a free 100 %
>    saving and pads the blend. Real legal work carries only 0.70.
> 2. **All 7 cost-bearing prompts are one topic** — anticipatory bail / BNSS 482.
>    With the semantic-cache similarity threshold at **0.85**
>    (`lm-cache-service.ts`), near-identical prompts **cross-hit each other**:
>    "Summarise the leading Supreme Court authorities on anticipatory bail"
>    retrieves the cached answer to "What are the grounds for anticipatory bail".
>    The zero-completion results on `legal-research` / `multi-issue-strategy` /
>    `drafting` are therefore **false cache hits manufactured by the set's own
>    monotopicity**, not evidence about production behaviour.
> 3. **Effective sample is n = 1** per prompt. Repeats hit the cache, so the
>    harness correctly excludes them — meaning no variance is claimable at all.
>
> Consequently **−96.3 % (pre-fix), +21.2 % / −18.4 % (post-fix) are all artifacts**
> and must not be quoted in either direction. What *is* independently supported,
> because it does not depend on the blend:
>
> - `single-issue-advice` bills **3 completions for a single-issue question** —
>   verified against provider log lines, not the envelope. Real defect.
> - The swarm bills **11 completions / ~80 k prompt tokens**. Real defect.
> - `NV-DETERMINISTIC-OVERFIRE-001` was real and is fixed: the same prompt that
>   returned a bare BNSS 482 excerpt now returns a reasoned advisory.
>
> **A v2 set is a prerequisite for any published number.** Requirements:
> distinct topics per cost-bearing class (so cache cross-hits are impossible by
> construction), weights reflecting real NYV/NSP traffic rather than an assumed
> mix, trivial lookups reported **separately** instead of blended into the
> headline, and a cache-hit signal recorded per run so a zero-completion answer
> can be attributed to *cache* vs *deterministic tier* vs *over-fire* — which the
> v1 shortfall detector cannot distinguish.

>
> Two passes, both live on nysdev against the frozen set:
>
> | pass | build | measured | adjusted (defensible) |
> |---|---|---:|---:|
> | `full-v1-b-adj` | 12:23Z (pre-fix) | −68.5 % | **−96.3 %** |
> | `post-overfire-v1` | 13:53Z (post NV-DETERMINISTIC-OVERFIRE-001) | **+21.2 %** | **−18.4 %** |
>
> Blended cost/request fell **$0.037167 → $0.017073** (−54 %) against a direct
> baseline of $0.021675, so NYV is now *cheaper than a direct call on the measured
> figure* and the adjusted gap narrowed by **78 points**. Still far from 70 %.
>
> **The over-fire fix worked, and is confirmed by reading the answers, not the
> scores.** Pre-fix, `legal-research` returned a bare BNSS 482 statutory excerpt
> with no case law (732 chars). Post-fix the same prompt returns a structured
> **ISSUE & SHORT ANSWER** advisory that reasons over the provision. The
> deterministic tier is no longer answering research questions with lookups.
>
> **What the remaining flags actually are — a harness limitation, not the same
> defect.** Three classes (weight 0.35) are still flagged "cheap for the wrong
> reason" because they billed **zero completions**. But the shortfall detector
> infers the *cause* from the completion count alone, so it cannot distinguish:
>
> - **an over-fire** (deterministic tier answered out of scope) — now fixed, and
> - **a semantic cache hit** (a correct, previously-computed answer served free) —
>   which is the MOAT working exactly as designed.
>
> `legal-research` post-fix is the second case: a full advisory answer at zero
> marginal cost. Counting that as a quality regression *understates* the platform,
> just as counting it as a 100 % saving previously overstated it. **The detector
> must read the cache-hit signal before attributing a zero-completion answer to
> the deterministic path** — until it does, neither the +21.2 % nor the −18.4 %
> figure is the true number, and the honest statement is that the real value lies
> between them.
>
> **Genuine remaining cost defects, unchanged by this fix:**
> 1. `single-issue-advice` (weight **0.30**) — 3 completions and ~3,410 prompt
>    tokens for a one-issue question. Largest single drag.
> 2. `multi-jurisdiction-conflict` / `long-context` — swarm fan-out to 11 calls,
>    ~80 k prompt tokens (§12.2 residual).
> 3. Two runs returned non-HTTP-200 (`EXIT 4`), so this blend is **incomplete**.
>
> Artifacts: `.local/benchmarks/full-v1-b-adj/`,
> `.local/benchmarks/post-overfire-v1-2026-08-16T13-56-22-037Z/`.
> **Do not quote `variance-adj` (+18.2 %/+25.2 %)** — it blends only weight 0.80
> and excludes every expensive class.

Every percentage in §2.1 is a **model**, not a result. Metering (M1–M4) is now
fixed, so spend is finally observable — but the claim still needs a fixed
before/after on a frozen prompt set, run on nysdev, with the *provider log* as
ground truth rather than our own envelope. Until that table is filled in, the
public number stays unpublished.

Every percentage in §2.1 is a **model**, not a result. Metering (M1–M4) is now
fixed, so spend is finally observable — but the claim still needs a fixed
before/after on a frozen prompt set, run on nysdev, with the *provider log* as
ground truth rather than our own envelope. Until that table is filled in, the
public number stays unpublished.

Two things already argue for measuring rather than reasoning:

- The audit's "6–8 Queen completions" **did not reproduce** — worst measured case
  was 5.
- This plan's own per-request cost figures were **understated**, because they were
  read from the envelope that NV-METER-ENVELOPE-001 had been under-reporting.

**The set (frozen — do not tune the prompts to the result).** 8 prompts × 3 runs,
chosen to cover the traffic mix rather than the flattering cases:

| # | Class | Prompt shape | What it must prove |
|---|---|---|---|
| 1 | Deterministic map | "IPC 302 → BNS?" | 0 completions, 0 tokens |
| 2 | Deterministic FAQ | "What does BNS 103 say?" | 0 completions (NV-STATUTE-FAQ-PRELLM-001) |
| 3 | Cache repeat | prompt 2, reworded | semantic cache hit, 0 completions |
| 4 | Simple advisory | one-section bail question | 1 completion, budget model |
| 5 | Multi-issue advisory | BNSS 482 × PMLA 5 × limitation | quality retained, no over-tier |
| 6 | Swarm | `orchestrationMode=swarm` litigation strategy | fan-out bounded, no 500, wall ≪ sum |
| 7 | Long context | 40-page document + question | context scales with need, not floor |
| 8 | Adversarial scope | 208-char strategy prompt naming one section | must **not** take the FAQ fast path (NV-STATUTE-FAQ-SCOPE-001) |

**Per prompt, record:** billed completions (from provider log lines), prompt +
completion tokens split by `usageSource`, `cost.wasted`, wall-clock, models
actually billed, and the layers list. **Baseline** = the pre-Phase-0 commit;
**after** = current HEAD.

**Quality gate — the claim is void without it.** Cost reduction that degrades
legal output is not a MOAT, it is a defect. Prompts 4–7 must be scored by the
existing legal eval on citation validity, jurisdiction correctness, and whether
every raised issue is addressed. **A cost win on any prompt whose quality score
drops is reported as a regression, not a saving.** Prompt 8 is a pure correctness
check with no cost component.

**Report the number honestly:** a blended figure across the real traffic mix, with
the deterministic share stated separately — "70 % blended, of which prompts 1–3
are 100 % because no model runs" is defensible; a single averaged headline that
hides the mix is not.

---

## 3. What the SDK's advantage actually is (and must be)

Direct chat is *not* a viable alternative for our users, and the reasons are
structural, not marketing:

| Capability | Direct LLM | NYV SDK |
|---|---|---|
| PII redaction before egress | none | `redactPII` pre-LLM, ring gate |
| Bar Council / advocate-conduct guardrails | none | JRX guardrails gate |
| Citation verification against a real corpus | hallucinates | NYS 97,861 statutes + 20.5 M judgments |
| Old→new code mapping | guesses BNS numbers | **deterministic, 66–293 ms, no LLM** |
| Audit trail / tenant metering | none | router decisions + credit ledger |
| Provider outage survival | request fails | cascade + quarantine + sovereign terminal |
| Data residency | US egress | region-pinned Bedrock, `ap-south-1` path |

**So the honest positioning is:** the SDK must be *faster than direct* on the
70 % of traffic that is deterministic or cacheable, and *only slightly slower*
on the 30 % that genuinely needs frontier reasoning — while being the only
option that is compliant. Today we are slower on **both**. Phases below fix that.

---

## 4. Phase 0 — shipped 2026-08-15 (`2026-08-15T0946Z-aws-ssm`)

Proof that deterministic-first works:

| Query | Before | After | Model |
|---|---|---|---|
| "What BNS section replaced IPC 302?" | 27 s, **wrong** (answered IPC 302) | **131 ms** | `nys-statute-map` (no LLM) |
| "Which BNSS replaced CrPC 438?" | n/a | **69 ms** | `nys-statute-map` |
| "What replaced IRPC 420?" | 400 Zod | **67 ms** | `nys-statute-map` |

Zero tokens, zero LLM, correct answer, **200× faster**. This is the template for
everything in Phase 1.

---

## 5. Phase 1 — Deterministic tool tier (biggest win, no LLM)

**Goal:** every request that a database, parser, or index can answer never
reaches a model. Target: **40–55 % of NSP traffic** answered with zero tokens.

Build `nv-deterministic-resolver` as the **first** stage of orchestrate, before
Queen, before RAG, before the overlay. Each resolver is a typed tool:
`(query, ctx) → { answered: true, content, citations } | { answered: false, hint }`.

| Resolver | Backing store | Expected latency | Status |
|---|---|---|---|
| Old→new statute mapping | NYS compare | 70–300 ms | **live** |
| Bare section lookup ("what is BNS 103") | NYS statutes | ~100 ms | **signal exists, unused** |
| Statute/act full-text + heading | NYS statutes | ~100 ms | **signal exists, unused** |
| Case citation resolve (CNR / reporter cite) | NYS judgments | 40–200 ms | built (`nys_retrieve`) |
| Citation *verification* (does this cite exist) | NYS citations | ~100 ms | built (`nysVerifyCitation`), LLM-gated today |
| Citation extraction from text | NYS citations | ~100 ms | built (`nysExtractCitations`) |
| Limitation-period / fee / court-hierarchy tables | NYV reference tables | <50 ms | build |
| PDF/DOCX text + page render + field extract | local parse + OCR | 0.3–3 s | built (12 services), LLM-gated today |
| Document metadata (parties, dates, stamp) | regex + layout | <500 ms | partly built |
| Web search result list (no synthesis) | search provider | 0.5–2 s | built, LLM-gated today |
| Prior identical/near answer | semantic cache | <50 ms | **broken, see Phase 2** |

**The cheapest win in the whole plan.** NYS `/retrieve` already returns
`llmRequired` and an `intent` per request (live: `intent=ipc-bns-compare`,
`llmRequired=false`, **7 ms**). That field is plumbed through
`retrieveNysGlobalKnowledge` and then **discarded by every caller** — Auto-RAG
reads only `.chunks`. Honouring `llmRequired === false` generalizes Phase 0 from
mapping to statute lookup, citation checks, and case resolution in a single
change, using intelligence NYS already computes.

**Routing contract.** A resolver hit returns immediately with
`model: nv-<resolver>`, `provider: nv-deterministic`, `tokens: 0`. On a miss it
returns a **hint** that is passed to the model as pre-fetched grounding — so even
a miss saves a retrieval round-trip.

**Hard rule (NV-DETERMINISTIC-FIRST-001):** no new capability may call an LLM for
something a store can answer. Enforce in `npm run guardrail`.

---

## 6. Phase 2 — Make the cache real (second biggest win)

Today's cache cannot hit. Fix in three steps:

1. **Embedding-keyed semantic cache, on by default.** Key on the *user* prompt +
   jurisdiction + tenant, **not** the assembled 5k-token prompt (which varies per
   request and is why nothing matches). Cosine ≥ 0.94 → serve; 0.88–0.94 → serve
   as grounding to a cheap model. Retire the SHA-256 hash-prefix "similarity".
2. **Two-tier index.** ANN over a bounded hot set (Redis vector or pgvector),
   not an O(n) scan of 26 k entries — the current embedded path would cost more
   than the LLM call it avoids.
3. **Honest metering.** Cache hits currently record `tokens: 0` and a flat
   `estimatedCostSaved = hits * 0.002`. Record real avoided tokens and the model
   that *would* have run, so the 70 % MOAT becomes an auditable dashboard number
   instead of a hardcoded `savingsPercent: 70` string.

Legal Q&A is extremely repetitive (same sections, same offences, same
jurisdictions). A working cache should absorb **25–40 %** of model traffic.

---

## 7. Phase 3 — Context engineering: stop the 250× inflation

The rule: **budget-first assembly**, not append-everything.

1. **Token budget per task class,** enforced before dispatch:
   `micro-FAQ ≤ 600` · `chat ≤ 2,500` · `research ≤ 8,000` · `drafting ≤ 24,000`.
2. **Overlay tiering.** The counsel overlay is unconditional today. Emit a
   ~150-token *compact* overlay for FAQ/chat and reserve the full multi-section
   overlay for drafting/litigation strategy.
3. **Wire the compressor that already exists.** `nyv-prompt-compiler` implements
   real section-selective compression (40–60 %, critical sections preserved) but
   is unreachable from the live orchestrator path. Connect it.
4. **Honour caller flags.** `enableRAG:false` and `enableMemory:false` must
   actually remove those blocks — measured today they do not.
5. **Retrieval discipline.** Rank-then-truncate to a token budget with
   deduplication; never paste top-k blindly. Drop chunks below a relevance floor
   rather than padding to k.

Target: the 20-token FAQ costs **≤ 600** prompt tokens instead of 5,431 —
a **~89 % token reduction on the most common shape of request**.

---

## 8. Phase 4 — Intelligent model selection (measured, not static arrays)

### 8.1 Fix the scorer that already exists
There is a real 9-factor weighted scorer (context fit, cost, capability,
jurisdiction, tier, legal affinity, preference, speed, health). It is
**overridden**: a static Bedrock-lead array is prepended and a Bedrock affinity
bonus of up to **+42** dwarfs every other signal (context fit maxes at +20), so
scoring only orders the tail. Additional dead logic found:

- Health returns a perfect score for **never-called** models, so an unproven
  model gets the same bonus as a proven one.
- The GRPO online nudge reads `costPer1k` / `costTier`, **neither of which exists**
  on a model entry — so its quality branch is unreachable.
- Its model list references ids not in the catalog (`gemini-2.0-flash`,
  `amazon.nova-lite-v1:0`).
- Four contradictory cascade definitions exist across four files; one still
  leads with `gpt-4o` / `claude-3.5-sonnet` / `gemini-1.5-pro`.
- The SME preference tie-break only fires when the top two scores are within
  **0.05**, which never happens given score gaps of 5–40.

**Action:** make the scorer authoritative again. Convert the static arrays into
*priors* (bounded ±8), cap any single affinity term at +10, and feed **measured
p50/p95 latency and real cost** into the score. Delete the three dead cascade
SSoTs.

### 8.2 Task-tiered model policy (from §1 measurements)

| Task class | Lead | Then | Rationale |
|---|---|---|---|
| Deterministic | *no model* | — | Phase 1 |
| Classify / route / extract / summarize | `gemini-3.1-flash-lite` (3.1 s) | Nova Pro, Nova 2 Lite | thinking off; cheapest capable |
| Short FAQ / chat | **`gemini-3.7-flash`** (6.5 s) | Haiku 4.5 (7.8 s), Nova Pro | see §8.3 |
| Legal research / analysis | `claude-sonnet-5` (16.4 s) | Opus 4.8 (14.8 s), Gemini 3.1 Pro | best quality/latency balance |
| Drafting / litigation strategy | `claude-opus-5` | Opus 4.8, Sonnet 5 | quality dominates; raise max_tokens |
| Vision / OCR | Nova Pro, Gemini 3.1 Flash Image | — | already capable |
| Sovereign / residency | `apac.*` Bedrock | AgentZero terminal | never fail |

### 8.3 Gemini — availability probed, latency measured, dead rungs removed (SHIPPED 2026-08-16)

**Superseded the earlier estimate in this section.** Two probes now gate every
model id: `scripts/_ec2-model-avail-probe.sh` (does this account's key get a 200?)
and `scripts/_ec2-model-bench.sh` (how fast on a *realistic* BNSS-482 × PMLA-5
legal question at `maxOutputTokens` 2048, best of 2 — not a one-liner). Measured
2026-08-16:

| id | http | latency | answer chars | in/out per 1M |
|---|---|---|---|---|
| `gemini-3.1-flash-lite` | 200 | **4.65 s** | 4,488 | $0.075 / $0.60 |
| `gemini-3.7-flash` | 200 | **6.99 s** | 2,191 | $0.30 / $2.50 |
| `gemini-3.5-flash` | 200 | 9.34 s | 302 | $0.30 / $2.50 |
| `gemini-3-flash-preview` | 200 | 10.30 s | 4,236 | $0.30 / $2.50 |
| `gemini-3.6-flash` | 200 | 11.67 s | 1,738 | $0.30 / $2.50 |
| `gemini-3.1-pro-preview` | 200 | **20.79 s** | 2,087 | $1.50 / $12.00 |
| `gemini-2.5-pro`, `gemini-2.5-flash` | **404** | — | — | *retired* |

Three corrections to what this section previously assumed:

1. **`gemini-2.5-pro` / `gemini-2.5-flash` are dead** — 404 *"no longer available
   to new users"*. They were the last two rungs of `getGeminiCascadeModels()` and
   appeared in `DIRECT_PROVEN_LEAD`, `PARTNER_LEGAL_PREMIUM_LEAD`,
   `OPENROUTER_PROVEN_LEAD`, eight `default-sequences.ts` ladders and
   `ultimateFallbackSequence()`. A dead rung in a *fallback* ladder is the
   costliest kind: it is reached precisely when the lead already failed, so it can
   only add another hop plus the per-attempt timeout before failing over again.
2. **The earlier "404" diagnosis was half right.** `gemini-3-1-pro-preview` and
   `gemini-3-1-flash-lite-preview` are catalog ids, not API ids — the
   hyphen→dot rewrite in `toGeminiApiModelId` resolves both correctly. The real
   404s were the 2.5 pair.
3. **3.7 Flash beats 3.1 Pro on the metric that matters.** 6.99 s vs 20.79 s at
   comparable answer depth (2,191 vs 2,087 chars) and 5× cheaper output. It is now
   the default `NYV_GEMINI_FLASH_MODEL`.

`speedScore` is now calibrated from these measurements rather than vendor claims:
`gemini-3-1-pro-preview` 76 → **62**, `gemini-3-flash-preview` 95 → **86**. Ladder
ordering follows a rule this section had not stated: **later rungs must be faster
than earlier ones**, because a fallback is reached exactly when latency or
availability already hurt.

### 8.4 The selection algorithm — availability, cost, intelligence, evidence

The user requirement is explicit: model choice must follow *availability, cost and
measured intelligence*, not "whims and fancies". Today it follows static arrays
(§8.1). The replacement is one scoring function with four inputs, three of which
are **observed at runtime** rather than declared:

```
score(model, task, deadline) =
      w_q · quality(model, task)      // measured win-rate, not a hand-typed rank
    + w_s · speed(model, deadline)     // measured p50/p95, penalised if p95 > remaining
    + w_c · cost(model, task)          // real catalog price × expected tokens
    + w_r · reliability(model)         // rolling success rate, decayed
    - penalty(unavailable | quarantined | unresolvable id)
```

#### 8.4a What shipped 2026-08-16 — and the three reasons it previously could not work

The scoring function above **already existed** in
`intelligent-router/intelligent-router.ts` (`pickSequence`) with exactly these
inputs: `legalQuality`/`generalQuality`, `speedScore`, real catalog cost,
`getHealthScore` as the circuit breaker, plus `jurisdictionFit`, `preferredFor`
and live `isProviderAvailable`. Nothing needed inventing. Three wiring defects
meant it was bypassed or overridden at the exact point Queen leaves are dispatched:

1. **NV-COST-ROUTER-SSOT-001 — a second, stale catalog.** `cost-aware-router.ts`
   carried its **own** hardcoded eight-model catalog (`anthropic/claude-3-haiku`,
   `openai/gpt-4o`, `openai/gpt-4o-mini`, `google/gemini-flash-1.5`,
   `mistralai/mistral-7b-instruct`, `google/gemma-2-27b-it`,
   `meta-llama/llama-3.1-70b`, `anthropic/claude-3.7-sonnet` — all 2024-era
   OpenRouter ids) with hand-written `costPerMTok` and `qualityScore`, entirely
   disconnected from the 60-entry registry. Because
   `nv-queen-orchestrator.resolveAgentModelRouting()` calls it for **every leaf**,
   leaf routing ignored availability, breaker health, jurisdiction, task fit and
   real prices — and could name models this account cannot call at all. It now
   delegates to `pickSequence`, keeping only its real contribution: the
   deterministic, zero-LLM complexity classifier, mapped onto the scorer's
   tier/task inputs. It also now returns the scorer's ordered `fallbacks`, so
   callers stop inventing their own ladders (§9.1).
2. **NV-POLICY-BUDGET-001 — the policy layer un-did the budget.**
   `applyRoutingPolicy` prepends curated lead lists ahead of the scored sequence
   and did so **unconditionally**, silently defeating `maxCostUsd` — which is a
   *hard* filter in `costFitScore` (returns −1000, dropping the candidate). The
   scorer would correctly exclude an over-budget frontier model and the policy
   layer put it straight back at position 0. This is **why leaves kept running
   `gemini-3-1-pro-preview` despite the $0.005 exploration budget in §8.5**: the
   cost split had no effect on which model was actually called. The budget is now
   enforced for lead ids *and* for rungs merged in from the un-cost-filtered
   default/ultimate ladders. AgentZero is free and still terminal, so this can
   never empty the cascade; with no budget declared, behaviour is unchanged.
3. **NV-LEAF-BUDGET-FORWARD-001 — the budget never reached the router.** Even
   after (2), only the model *name* was passed to `llmService.executeRequest`,
   arriving as a `preferredModels` entry worth a mere **+8 scoring points**. The
   scorer then re-ranked from scratch with no knowledge of the ceiling, and the
   curated premium lead outranked the affordable pick. Live proof: leaves logged
   `model=qwen.qwen3-vl-235b-a22b` while **every billed completion was
   `gemini-3-1-pro-preview`**. Added `maxCostUsd` to `LLMRequest`, forwarded into
   `orchestrateLLM`'s `routing`, set from the same leaf/synthesis ceiling the Queen
   already computes.

**The generalisable lesson for this plan:** a declared budget must be a *contract*
enforced at every layer that can reorder the cascade, and verification must read
the model **actually billed**, never the model dispatched. `_ec2-leaf-tier-verify.sh`
now counts completions per model id for exactly this reason — the dispatch log
looked correct for two deploys while the spend did not.

**Measured after (SSM `962d6bca`):** exploration leaves bill
`gemini-3-1-flash-lite-preview` ($0.075/$0.60) instead of `gemini-3-1-pro-preview`
($1.50/$12.00); sum of completion latencies **249,057 ms → 115,009 ms (−54 %)**;
swarm node failures **3 → 0**; answer quality preserved (PMLA + SEBI + limitation
+ BNSS all retained).

**Still open after 4b:** end-to-end wall clock is still ~390 s. Per-completion cost
and latency are down sharply, but the swarm remains largely serial — that is the
next lever (§10) and is not a model-selection problem. The remaining evidence gap
is `quality(model, task)` and `speed(model, deadline)`: both are still *static*
catalog fields calibrated from a one-off bench, not rolling observed win-rate and
p50/p95. Closing that requires the metering fixes in §2.4a first, because
per-model outcome attribution is unreliable while the envelope under-reports
completions.

Non-negotiable rules that make this evidence-based rather than declarative:

1. **Availability is a gate, not a term.** An unresolvable id, a missing key, a
   quarantined provider, or a 404-at-API id (§8.3) scores `-∞`. This is enforced
   at boot: every cascade id must resolve or the boot check fails. Two of our
   current catalog ids are 404 at the API and still occupy cascade slots.
2. **Unproven ≠ perfect.** Today health returns a perfect score for a
   never-called model. Replace with a Bayesian prior: an unproven model starts at
   the *class median*, not the top, and needs N observations to move.
3. **Weights are per task class, not global.** `w_c` dominates for
   classify/extract; `w_q` dominates for drafting; `w_s` dominates when the
   deadline is tight. This is what "premium intelligence only where it pays"
   means concretely.
4. **Deadline-aware.** `speed()` reads `remaining = deadline - now`. A model whose
   measured p95 exceeds the remaining budget is skipped rather than attempted —
   the same principle as NV-QUEEN-DEADLINE-001, applied to model choice.
5. **Static arrays become priors only,** bounded to ±8 so measurement always
   wins within a few dozen requests.

### 8.5 Leaf vs synthesis — where premium intelligence actually earns its price

The measured Queen data (§1.0g) shows every node using `gemini-3-1-pro-preview`
at 30–60 s each. That is the wrong shape: fan-out leaves do *retrieval-grounded
extraction*, which a fast model does well; only the synthesis step needs frontier
reasoning.

| Stage | Model class | Why |
|---|---|---|
| Decomposition | fast (`gemini-3.7-flash`) | structural, short output, schema-constrained |
| Leaf / fan-out nodes | fast + RAG-grounded | grounded extraction; parallel; must fit the node budget |
| Synthesis | premium (`claude-opus-5` / `sonnet-5`) | the one place quality is user-visible |
| Maker-checker | premium, **only** for high-risk | not `tier !== 'lite'` as today |

This is how we keep "best intelligence of the premium models" while removing most
of the premium spend: one premium call per request instead of N.

---

## 9. Phase 5 — Never-fail SLA: timeouts, hedging, retry, breaker

Enterprise rule: **no request fails, and no user waits on our own logic.**
Current state and fix:

| Concern | Today (measured / read) | Target |
|---|---|---|
| Per-attempt timeout | 60 s default, live env **90 s** | **task-tiered**: classify 8 s · chat 20 s · research 45 s · draft 90 s |
| Total budget | **none** — 60 s × 30+ candidates | hard wall-clock per task class; deadline propagated to every attempt |
| Backoff | **none** anywhere in the cascade | jittered 100/300/900 ms only on retryable classes |
| Hedge | fires at 2,500 ms and is **never cancelled** — a fast primary still triggers a full second paid call whose result is discarded and unmetered | cancel on primary success; hedge only when p95 for that model exceeds the tier budget |
| Hedge accounting | loser failures never recorded, and attempts are logged under the **primary's** id, so a chronically failing hedge partner keeps a perfect health score and gets re-called | record both legs; attribute failures correctly |
| Breaker | in-process `Map`, resets per pod; the real breaker library is imported but not on the live path | Redis-backed, shared across pods, half-open probes |
| Quarantine | cross-request map exists, but the **streaming** path keeps a local set and re-hits providers already known to 402 | one shared quarantine for sync + stream |
| Bedrock auth | mutates global `process.env.AWS_BEARER_TOKEN_BEDROCK` mid-request and restores in `finally` — race-prone under concurrency | pass credentials per client, never mutate global env |
| Model-id hygiene | unresolvable ids (`omniroute/auto`, some `-preview` ids) silently dropped; catalog entries whose own notes say "blocked" remain scorable | startup validation: every cascade id must resolve, or fail the boot check |
| Response polling | n/a — all calls are blocking | for >20 s tasks, return a job id + stream partials so the user never stares at a spinner |

**Deadline-aware cascade.** Each attempt receives `remaining = deadline - now`.
If `remaining` is below a model's measured p50, skip it and jump to a faster
tier. This is what guarantees "never fail and never hang": we degrade to a
faster model rather than exhausting the clock on a slow one.

### 9.1 The fallback ladder — ordered by reliability, then speed, then cost

"Fallback" today means "the next entry in a static array". It must instead be a
*ranked ladder* where each rung is chosen for a reason, and where the request
deadline decides how far down we are allowed to go.

| Rung | What it is | Entry condition | Budget share |
|---|---|---|---|
| 0 | Deterministic resolver (NYS / DB / parser) | resolver answers | ~0 ms, 0 tokens |
| 1 | Exact + semantic cache | cache hit | < 50 ms |
| 2 | Primary model for the task class | always | 60 % of remaining |
| 3 | Cross-provider peer (different provider, similar class) | rung 2 fails **or** p95 > remaining | 30 % |
| 4 | Faster/cheaper class (graceful quality degrade, disclosed) | deadline pressure | 10 % |
| 5 | Grounded abstain with citations | no model can answer in budget | immediate |

Ordering principle, in priority order: **reliability → speed → cost → quality
headroom.** A rung is only tried if its measured success rate clears a floor;
among rungs that clear it, the fastest is preferred; among equally fast, the
cheapest. Quality is protected not by *always* choosing the premium model but by
the task-class weights of §8.4 and by the synthesis rule of §8.5.

Three properties make this "globally accepted" rather than bespoke:

- **Deadline propagation.** One deadline per request, divided among rungs; no rung
  may start a call it cannot finish. NV-QUEEN-DEADLINE-001 lands this for Queen
  nodes; the same helper must wrap the model cascade.
- **Cancellation on success.** Already landed for the hedge
  (NV-LLM-HEDGE-CANCEL-001); the cascade needs the same so an abandoned attempt
  stops generating.
- **Abstain is a valid terminal state.** A grounded "I cannot answer this within
  budget, here are the authorities" beats both a hallucination and a spinner.
  Rung 5 is why "no request fails" does not require "no request is ever slow".

#### 9.1a Partially landed 2026-08-16 — the ladder is now emitted, not hand-typed

`selectModel()` now returns the scorer's ordered `fallbacks` alongside the primary
(§8.4a), so rungs 2–4 come from the same availability/health/budget/task filters as
the lead instead of a static array. Two concrete ordering defects were fixed on the
way, both from the same misconception:

- The curated ladders had **slower models below faster ones** — e.g.
  `gemini-3-1-pro-preview` (20.79 s) ahead of `gemini-3.7-flash` (6.99 s), and the
  dead `gemini-2.5-*` pair ahead of live rails. A fallback rung is reached
  *precisely because* latency or availability already hurt, so **later rungs must
  be faster**, never slower. All eight `default-sequences.ts` ladders,
  `ultimateFallbackSequence()` and the three lead lists in `nv-llm-routing-policy.ts`
  were reordered on this rule.
- Budget was enforced on the lead but **not** on the rungs, so a cascade could fall
  back onto a model the caller could not afford — breaking the budget at the exact
  moment fallbacks are used. Now checked per rung (NV-POLICY-BUDGET-001), with a
  regression test asserting every rung of a $0.005 request is affordable.

Still outstanding from this section: rungs 0–1 (deterministic + cache) are Phases
1–2; the reliability *floor* is still `getHealthScore`'s in-process map rather than a
Redis-shared breaker; and `speed(model, deadline)` uses the static bench-calibrated
`speedScore` rather than rolling p50/p95, which needs §2.4a metering first.

---

## 10. Phase 6 — Agentic depth without agentic cost

### 10.1 Measured agentic state (2026-08-15)

| Fact | Evidence |
|---|---|
| Queen is **5,368 lines** with **7 distinct LLM call sites** | `src/orchestration/nv-queen-orchestrator.ts` |
| Only **one** `Promise.all` in the whole file — sub-agent work is effectively **serial** | same file |
| The learned AdaptiveRouter EMA is real but only nudges within a **0.12** boundary band, and never overrides partner-lean or forced Queen | `src/services/nv-adaptive-path-ema.ts:19`, `:1-10` |
| NYS `/retrieve` **already returns `llmRequired`** and an `intent`, and it is plumbed through `retrieveNysGlobalKnowledge` | `nv-nys-knowledge-retriever.ts:82`, `:194`, `:224` |
| **Nothing in the codebase reads `llmRequired`** except a unit-test fixture | grep across `src/`: only `nv-nys-knowledge-retriever.ts` and `__tests__/nv-nys-knowledge-plane.test.ts` |
| Auto-RAG calls NYS retrieve and uses only `.chunks`, discarding `llmRequired` | `nv-auto-rag-router.ts:475-487`, `:594-602` |
| Deterministic NYS tools already exist and are wired as MCP tools: `nys_retrieve`, `nys_check_citations`, `nysVerifyCitation`, `nysExtractCitations`, `nysCompareOldNew` | `nv-nys-knowledge-retriever.ts:277`, `:309`, `:324`; `mcp/nv-mcp-legal-delegate.ts:235-249` |
| A deep document/OCR tier exists across **12 services** (pdf/docx/OCR/extract) but is reached through LLM-mediated paths | `document-pipeline/*`, `sdk/nv-doc-content-extractor.ts`, `nyayavigya-enhanced-ocr-service.ts` |
| `nv-legal-work-service` already prefers NYS before tenant RAG — the right pattern, applied in one place only | `nv-legal-work-service.ts:273-285` |

**The single biggest unused asset:** NYS tells us, per request, whether an LLM is
needed at all (`llmRequired: false` for statute/mapping/citation intents, served
in **7 ms** live). We throw that signal away and run Queen + a frontier model
anyway. Phase 1's resolver tier is therefore mostly **wiring an existing signal**,
not new intelligence.

### 10.2 Rules

1. **Consume `llmRequired` first.** If NYS says a deterministic intent answered
   the query, render from the returned steps and return — no Queen, no model.
   This generalizes Phase 0 from mapping to statute lookup, citation checks, and
   case resolution in one change.
2. **Queen must be earned.** Engage only when the deterministic tier missed
   **and** the prompt shows genuine multi-issue structure — not merely because
   the caller is a partner platform (today it is on for all Legal Chat via
   `NYV_NSP_COUNSEL_QUEEN=1`).
3. **Parallelize sub-agents.** With 7 LLM call sites and one `Promise.all`, the
   fan-out is serial; each leaf adds its full latency to the wall clock. Run
   leaves concurrently under a shared token budget and a common deadline.
4. **Tools before agents.** Sub-agents call the Phase 1 resolvers rather than
   asking a model what a statute says.
5. **Maker-checker only on filing-grade output** (drafts, pleadings), never chat.
6. **Widen the EMA band.** A 0.12 boundary rarely fires; let measured
   path outcomes actually move the queen↔specialist decision.

---

## 11. Sequenced delivery (one deploy per phase, GO required)

| Phase | Change | Expected effect | Status |
|---|---|---|---|
| **0 ✅** | Statute mapping fast path | mapping 27 s → **0.1 s**, 0 tokens | shipped + verified live |
| **4a ✅** | Queen-path correctness + waste: statute-FAQ scope, pre-LLM FAQ, RRF confidence, hedge cancel, halluc-check guard, caperr classify, request deadline | FAQ 30 s/2 calls → **0.077 s/0 calls**; re-retrieval **100 % → 0 %**; hedge loser cancelled every request; multi-issue answers no longer discarded | shipped + verified live |
| **4b ✅** | Scorer authoritative (§8.4a) + live availability probe + task tiers + leaf/synthesis split (§8.5) | exploration leaves **$1.50/$12 → $0.075/$0.60 per 1M**; completion latency **−54 %**; node failures **3 → 0** | shipped + verified live |
| **4b-meter ✅** | Metering M1–M4 (§2.4a) | waste visible; envelope reports true fan-out; streamed spend read from provider not `length/4` | shipped + verified live |
| **1 ✅** | Deterministic resolver tier — honour NYS `llmRequired` | citation-verify + reverse-mapping → **0 completions**; re-retrieval skipped on deterministic hits | shipped + verified live |
| **6-mem ✅** | Memory: cross-tenant leak, char cap, decay, limit, dedupe scan, GraphRAG chains, compiler + durable wiring | injected chars **−76 % to −90 %**; **security fix** | shipped + verified live |
| **4c ✅** | Swarm CoT gate + parallel collective execution | removes the post-billing HTTP 500; **parallelism confirmed but wall time only 390 s → 366 s** — see §12.1 | shipped + verified live |
| **2 ✅** | Real semantic cache + poisoned-key fix + **NV-CACHE-NS-FORGERY-001 security fix** | −25–40 % model calls | shipped + verified live |
| **3 ✅** | Token budget + overlay tiering + wire compressor | micro path **8,218 → 1,048** tokens; **NOT reaching Queen leaves (19,938)** — see §12.2 | shipped, **partially effective** |
| **5 ✅** | Fallback ladder (§9.1a), shared breaker, deadline-aware cascade, backoff, boot-time cascade validator | zero hangs, correct health data; found **NV-CASCADE-DRIFT-001** | shipped + verified live |
| **6-agentic ✅** | Queen **earned** on prompt structure (§10.2 rule 2) + tools-before-agents on the Queen path | Queen share **100 % → 16.7 %** on the 24-prompt golden corpus (**measured**; production **estimated** 50–70 %); Queen path now consumes the deterministic answer it previously discarded | code complete, **awaiting deploy** (SSO expired) |
| **7 ✅** | **Attribute + cut the non-LLM Queen overhead** (§12.1) — root cause: `memory.tiered.recall` timing out and being **silently retried 3×** | attributed with **zero residual**; **wall clock 366 s → 176 s (−52 %)** measured live | shipped + verified live |
| **8 ✅** | **Queen leaf prompt budgets** (§12.2) — leaf dispatch declares a task class | exploration leaves **3,213 → 1,905 tok (−40.7 %)**; L0 downgrade **−77.9 %** flag-gated off; synthesis deliberately unchanged | shipped live; ~11,300 tok runtime residual still unattributed |
| **9 ✅** | **HTTP 500 + heap pressure measured against the wrong denominator** (§12.3) — `heapUsed/heapTotal` is not headroom; 3 contradictory heap ceilings | unblocks the 500; stops the timer-driven cache eviction that starves the LM cache | shipped + verified live (`heap_size_limit` markers present) |
| **10 ✅** | **`NV-REQID-CORRELATION-001`** (§2.6) — the id returned to the caller was not the id used at dispatch, so no provider line could be joined to a request; 5 Queen sites minted standalone UUIDs | makes fan-out and per-request cost **measurable at all** (`scopeMode: 'request'`); prerequisite for every remaining cost claim | shipped + verified live 15:16Z — probe matched the request's own billed line; **real fan-out = 1, not 3** |
| **11 ✅** | **`NV-AUDIT-CHAIN-BYPASS-001`** — 2 compliance services wrote audit rows to the chain-less legacy `public.nv_audit_logs`; those rows sat outside tamper-evidence | consent-gate + BIPA evidence now hash-chained; KPI reader migrated `metadata->>` → `payload->>` in step | shipped + verified live 16:42Z; 20/20 chain tests green |
| **12 ✅** | **Host disk exhaustion — root-caused, not just relieved** | root volume is only **99 GB** while an attached **500 GB `xvdb` sits unformatted and unmounted**; the deploy script extracts a ~247 MB repo copy per deploy and **never prunes**, so 132 copies (30 GB) + 78 archive tarballs (17 GB) had accumulated. Pruned to newest 3 + newest 10: **11 GB → 43 GB free (90 % → 56 %)**; health **503 → 200** | done live; **root cause still open** — see below |
| **13 ⛔** | **The 70 % cost claim itself** — v2 benchmark set built (26 prompts, 3 per cost-bearing class, topic-separated) but **never run** | would produce the first defensible figure | **NOT DONE — no cost number exists in either direction** |

### Phase 14 — prompt engineering: the asset exists but does not run (2026-08-16)

The user asked for **global-best prompt engineering** ahead of prompt compression:
techniques that get the most intelligent, relevant answer per request rather than
generic prompts producing generic answers. Auditing that produced a finding more
useful than any new feature.

**`src/services/nv-system-prompt-engine.ts` is 1,114 lines of exactly what was
asked for, and it is dormant in production.**

It encodes conditional legal directives — not generic instructions — including:

- `lex specialis` when statutes conflict, `contra proferentem` on ambiguous clauses
- limitation-period computation against the Limitation Act 1963 / CPR, flagging < 30 days
- a 7-point contract review checklist (governing law, liability cap, force majeure,
  termination, IP, data protection, jurisdiction)
- **Steel Man**: "WHEN opposing legal argument is presented → APPLY Steel Man
  approach: present the strongest version before rebutting"
- jurisdiction challenge when unspecified, uncertainty flagging below 80 % confidence,
  mandatory escalation on high-risk matters, CISG / arbitration-seat verification

**Why it never fires:** `nv-client.ts:639` gates `assembleCompiledPrompt` behind
`process.env.NYV_SPECIALIST_PROMPT_COMPILER === '1'`, **and that variable is not
present in `/opt/Nyayavigya/secrets/.env.production`** (verified live: grep count
0). The main specialist path therefore uses `assembleLayeredAgentSystemPrompt`
instead, and the deep legal-reasoning directives are never sent to the model.
Reachable from `nv-patterns-routes.ts` only — a demo surface.

This is an `NV-WIRING-001` case: exported ≠ live. The highest-value prompt
engineering work available is **not writing new prompts — it is turning on the
ones already written**, then measuring answer quality with and without.

**Competitive gap analysis (Lexlegis.ai / MIRA — the site the user cited; note the
correct vendor is lexlegis.ai, and `exlegis.ai/company/about` returned HTTP 503).**
Verified against our tree rather than assumed:

| MIRA capability | NYV today |
|---|---|
| 215 versioned, evaluated skills | 164 agents + capability manifest — comparable in scale |
| Plan visible & amendable **before** execution | **absent** — Queen decomposes internally; no preview/approval gate (`planPreview\|approvalGate` = 0 hits) |
| Meta-reasoning layer as a **separate** blocking verifier, 6 checks (evidence mapping, counter-argument, argument comparison, cross-validation, weakness detection, rebuttal) | partial — hallucination detector + citation verifier exist, but they are **in-ring**, not an independent system that blocks release; no counter-argument/weakness/rebuttal generator (`rebuttal` = 1 real hit, the Steel Man line above) |
| Shepardization / citation treatment (overruled, affirmed, distinguished, per incuriam) | **absent as a service** — only a US prompt-library entry (`nv-prompt-library.ts` 'Shepardize Equivalent'); NyayaGraphRAG traverses precedent but does not assign treatment status |
| Exportable, court-defendable reasoning chain | partial — CoT captured; not packaged as a filing-grade artefact |
| Clause library + firm-voice drafting | clause library present (12 files); **firm voice absent** (0 hits) |

The two genuinely missing capabilities that would most improve legal output
quality, in priority order: **(1) citation treatment status** — an answer citing a
subsequently-overruled judgment is confidently wrong, which is the single worst
failure mode in legal AI; **(2) an independent verification layer that can block
release**, versus our in-ring checks that only annotate.

### Phase 15 — the iceberg, measured; and a retraction (2026-08-17)

The instruction was to enable the best production configuration, put every
agent's system prompt properly to use, and finally answer the recurring
question: *how much of what we built over the last year is actually running?*

Answered with an import-graph audit rather than assertion. **The good news
first: the iceberg is much smaller than feared.** All 162 route files are
reachable; memory (graph, 5-tier, mem0, fan-in, injection-budget), Auto-RAG,
the legal-intelligence overlay, Self-RAG and the live hallucination detector are
all genuinely wired to the main path. The dormancy is concentrated and specific.

#### Retraction — `NYV_SPECIALIST_PROMPT_COMPILER=1` is NOT the lever

Phase 14 recommended enabling this flag as "the largest quality upside
available". **That was wrong, and the correction is now locked by test**
(`tests/unit/nv-prompt-compiler-gate.test.ts`, 4 assertions).

The gate at `nv-client.ts` is:

```
!/<section_1_identity>/i.test(effectiveSystemPrompt) && NYV_SPECIALIST_PROMPT_COMPILER === '1'
```

At that point `effectiveSystemPrompt` is the output of
`assembleLayeredAgentSystemPrompt()`, which embeds `bundle.identity` — the
literal `<section_1_identity>` element. The negated test is therefore **always
false for all 164 XML registry agents**, in every mode (`single_shot`,
`turn1_full`, `turn2_plus`). Setting the flag would have changed nothing except
for non-XML platform-internal agents. Verified live that the variable is absent
from `/opt/Nyayavigya/secrets/.env.production` **and** unset in the running
`nyv-gateway` container — but that turns out not to matter. **No env change was
made; the GO is not consumed.**

#### The actual defect — NV-AGENT-PROMPT-DEPTH-001 (fixed)

The registry agents carry **25 sections** each. `nv-agent-prompt-bundle.ts`
parsed exactly **five** of them (§0 binding, §1 identity, §2 mandate, §8
anti-hallucination, retrieval policy). Everything else shipped *only* inside the
`turn1_full` blob.

Consequence: **every single-shot partner request (NSP / NYM) and every Turn 2+
turn ran without the sections that decide answer quality.** Confirmed by grep —
zero extractors existed for any of:

| Section | What was being dropped |
|---|---|
| §3 jurisdiction | **"Use BNS 2023 — NOT IPC 1860 (repealed)"**, BNSS/BSA equivalents |
| §4 reasoning | 10-step protocol, IRAC, confidence gates (deliver ≥ 0.73, HITL 0.68) |
| §5 evidence | standards of proof, BSA 2023 s.63 certificate, per-jurisdiction citation forms |
| §6 citation | the `[CITATION: …]` marker contract that downstream verification depends on |
| §17 output | required response shape |
| §18 quality checklist | the agent's own pre-delivery self-check |

**§3 is the direct cause of the IPC↔BNS regression that opened this
engagement.** The repeal rule was authored, sat in the registry, and was never
sent to the model on partner traffic.

Fix: parse all six, and add a budget-derived depth ladder —
`core` (unchanged, ~1.2k tok) → `standard` (+§3 +§6) → `full_quality`
(+§4 +§5 +§17 +§18). `resolveAgentPromptDepth()` maps the existing prompt-budget
task classes onto the ladder, so a 24,000-token drafting task stops receiving
the same 1.2k stub as a 600-token FAQ. Wired at all three assembly sites:
`nv-client.ts` (session + single-shot) and `nv-queen-leaf-prompt.ts` (Queen
leaves, where the substantive legal work happens). Defaults to `core`, so
nothing changes for callers that do not opt in.

#### Measured cost of the depth ladder (real registry, not a fixture)

`scripts/nv-measure-prompt-depth.ts` parses every XML agent in
`src/data/nv-agents-registry.json` (**1,148 entries carry a full 25-section
constitution** — the "164 agents" figure counts a different grouping, worth
reconciling separately) and prices each rung at ~4 chars/token:

| Rung | Mean tokens | vs previous behaviour |
|---|---|---|
| `core` (what partner traffic got) | 1,169 | baseline |
| `standard` (+§3 +§6) | 1,861 | **+692** |
| `full_quality` (+§4 +§5 +§17 +§18) | 3,048 | **+1,879** |
| `turn1_full` whole blob | 6,474 | +5,305 — the all-or-nothing alternative we avoided |

Against each task class's own prompt budget, with `lean` applied where the live
code applies it:

| Task class | Budget | Rung | Prompt cost | % of budget |
|---|---|---|---|---|
| `micro_faq` | 600 | core+lean | 660 | unchanged |
| `classify` | 1,200 | core+lean | 660 | unchanged |
| `chat` | 2,500 | standard+lean | 1,345 | 54 % |
| `research` | 8,000 | full_quality | 3,048 | **38 %** |
| `drafting` | 24,000 | full_quality | 3,048 | **13 %** |

So the sections that decide legal answer quality cost **13 % of a drafting
budget and 38 % of a research budget**, while the cheap classes are untouched.
Shipping the whole constitution instead would have cost 5,305 extra tokens on
every call — which is presumably why it was dropped wholesale in the first place.
The ladder is what makes it affordable.

#### Live A/B on nysdev — deployed, verified, and the result was ZERO delta (2026-08-17)

Deployed to nysdev (`2026-08-17T0118Z-aws-ssm`) and verified **in the running
container**, not just in the tarball: all depth/CoT markers present in `src/`,
all six quality sections parsed, depth wired at all three assembly sites,
`/health` 200, `restarts=0`. A same-build A/B was then run with
`NYV_AGENT_PROMPT_DEPTH=core` (arm A = pre-fix) vs no override (arm B = shipped
behaviour), 3 prompts × 2 runs per arm, scored on signals that map 1:1 to the
restored sections.

**Result: zero delta on every metric.** Not "small" — zero.

| Metric | Arm A (core) | Arm B (depth) | Δ |
|---|---|---|---|
| cites BNS/BNSS/BSA 2023 | 66 % | 66 % | 0 pp |
| stale IPC/CrPC, unframed | 33 % | 33 % | 0 pp |
| `[CITATION:]` per answer | 0.0 | 0.0 | 0.0 |
| IRAC structure | 0 % | 0 % | 0 pp |
| names a standard of proof | 0 % | 0 % | 0 pp |

Two earlier attempts produced the same zero but were **invalid**, and it is worth
recording why rather than quietly re-running:

1. **Attempt 1** discarded `docker compose` stderr. The recreate failed, both
   arms scored the *same untouched container*, and the run reported a confident
   zero. Fixed by never suppressing compose stderr and by asserting
   `containerEnv` matches the arm before scoring — the script now aborts with
   `FATAL` instead of publishing a bogus delta.
2. **Attempt 2** failed loudly (as designed) with a container-name conflict:
   passing `-f a.yml -f b.yml` changes compose's derived **project name**, so
   `up` tried to create a *second* `nyv-gateway`. Fixed by pinning `-p`.
3. Identical prompts were also being served from cache (0–1 s, byte-identical
   lengths). Fixed with a per-arm nonce; sub-2 s answers are now flagged as
   suspected replays so a zero can never be over-read.

**Why the valid run still shows zero — root-caused from the live logs, three
independent reasons, none of them "the sections do not help":**

1. **`options.cotStrategy` was always truthy, so `selectCoTStrategy` never ran.**
   The dispatch sites did `cotStrategy: cotStrategy || 'zero_shot_cot'`, which
   defeated the very selector added above. The live log proves it:
   `CoT: 3 steps, strategy=zero_shot_cot` on a *research* request. **This was my
   own defect, shipped in the same change.** Fixed at all three dispatch sites
   (`nv-orchestration-routes.ts` ×2, `nv-sdk-orchestration-wrapper.ts`) and
   locked with source-level assertions so the default cannot return.
2. **Two of the three probes never reached an LLM at all.** The router resolved
   them deterministically — `statute FAQ resolved pre-LLM (zero tokens)`,
   `model=nys-statute-faq`, `latencyMs=0`, and one `specialist LM cache hit`.
   A prompt-assembly change cannot move a metric on a request that never
   assembles a prompt. The zero-token fast path working as designed is *good*
   news, but it makes these prompts useless as an A/B instrument.
3. **`agentKey=generic` on every request.** No registry agent was selected, so
   `assembleLayeredAgentSystemPrompt` — and therefore the entire depth ladder —
   was never on the code path. The logs show `Agent: auto`, and budget lines
   confirm the generic assembly (`class=micro_faq cap=600 assembled=819 OVER`).

So the A/B measured **the router, not the prompt**. The honest status of
`NV-AGENT-PROMPT-DEPTH-001` is: **the defect is proven by test and the fix is
deployed, but its production value is still unmeasured**, because a valid
measurement needs prompts that (a) miss the deterministic fast path, (b) miss
cache, and (c) actually bind a named registry agent. That harness does not exist
yet and is the next honest step — not another run of this one.

A fourth finding, incidental but real: `class=micro_faq cap=600 assembled=819
OVER` shows the micro-FAQ budget is **exceeded by 36 % before any depth change**,
i.e. the Phase 3 budgets are advisory at that tier rather than enforced.

#### Second dormant lever — NV-COT-AUTO-STRATEGY-001 (fixed)



`chain-of-thought-service.ts` implements **eight** reasoning strategies. Every
server-side call site pinned `'zero_shot_cot'`
(`nv-orchestration-routes.ts` ×2, `nv-sdk-orchestration-wrapper.ts`,
`nv-client.ts`), so **seven were unreachable** unless a partner hand-passed the
field. None do.

`selectCoTStrategy()` now chooses from task shape: `decomposition` for
multi-part questions, `step_back` for drafting/opinions, `chain_of_verification`
for research/advisory, `zero_shot_cot` for FAQ/classify.

Two deliberate exclusions, both cost/quality-driven:

- `self_consistency` (3 LLM calls) and `tree_of_thought` (branching) are **never
  auto-selected** — they stay opt-in for high-stakes work.
- `few_shot_cot` is **never auto-selected** because the exemplar bank contains
  only math / logic / generic-analysis samples (literally apples, cats, and
  remote-work pros-and-cons). Anchoring a legal model on those is worse than
  zero-shot. Note `nv-client.ts` passes `domain: 'legal'`, for which **no
  exemplar bank exists** — a genuine gap worth filling with real IRAC exemplars.

All three auto-selected strategies cost exactly one call, same as today, so this
buys reasoning quality at zero additional token spend.

#### Remaining genuine dormancy (evidence-backed, not yet actioned)

- `nv-internal-wire-chain.ts` — a shim that `void`-imports 39 modules purely to
  drive the wiring auditor's orphan count down. Its own header admits "no
  production code path consumes them through here." **Any import-reachability
  audit of this repo is therefore misleading**, which is likely why the "we have
  features but they are not wired" suspicion persisted without resolution.
- Barrel chain logs `"✅ Orchestration Engine: 10/10 loaded"` while
  `createProductionOrchestrator(`, `new ProductionOrchestrator(` and
  `createSmartThinkingEngine(` have **zero call sites**. Loaded ≠ instantiated.
- All **13 LLM provider adapters** (`llm-providers/*-provider.ts`) are never
  instantiated; live traffic goes through `unified-llm-adapter.ts`.
- `hallucination-checker.ts` — a **duplicate** of the live detector, zero call
  sites, reachable only via a `/capabilities` listing endpoint.
- `nv-citation-verification-service.ts` — wired to a tool route only, **not** to
  the main answer path. Combined with the §6 finding above, citation discipline
  was weaker in production than the registry intended.
- `nvGatewayRouter` is imported in `src/index.ts` and **never `app.use`d** — 26 KB
  of routes unreachable over HTTP.
- `nv-nyayagraph-service.ts` — the Queen manifest leaf expects exports
  `['nyayaGraphService','graphService']` with methods `['build','query','process']`;
  the file exports `nvNyayaGraphService` with `findCitationChain` /
  `multiHopTraversal` / `getGraphStats`. **Name and method mismatch, so the leaf
  cannot bind** — the precedent graph is unreachable from Queen.

### Phase 16 — completion-driven execution, deployed and measured (2026-08-17)

**The wait, not the work, was the remaining latency.** Deploys
`2026-08-17T1015Z-aws-ssm` (Wave A), `2026-08-17T1054Z-aws-ssm` (partner state +
router log), `2026-08-17T1114Z-aws-ssm` (session echo).

**Measured on the live public host, forced Queen swarm, same prompt shape as
§12.1:** wall clock **366.1 s → 92.6 s → 68.2 s** across the two probes, with
`recall budget exhausted` = **0** and 30 s capability timeouts = **0** (both were
the constant 90.4 s/leg term in §12). `skipRag=true skipMemory=true` confirmed on
live leaf spans. Interactive `-fast` 46.5 s → 42.9 s, `path=specialist`,
`missingMandatory=[]`.

What changed, in order of size:

1. **Memory fan-in proceeds on first useful items** and aborts the hangers, rather
   than `allSettled`-waiting for a source the breaker has already guaranteed will
   return nothing.
2. **Per-leaf memory is skipped after Step-0** (`skipMemory`, mirroring the
   existing `skipRag`) — Step-0 had already recalled, and every leaf was repeating it.
3. **A capability timeout is no longer retryable.** `DEFAULT_RETRY` matched
   `/timed?[- ]?out/`, so each hung recall was retried twice more, each retry
   *certain* to hit the same 30 s wall — the 3 × 30 s = 90.4 s constant. This aligns
   the capability policy with the LLM policy, which already excluded timeout.
4. **CoT overlaps synthesis** and is never awaited a second time on the collective
   path; it is skipped outright when the remaining wall cannot fit it.
5. **Post-answer hallucination + citation run in parallel**, fail-open to
   `degraded` on `-fast` and still fail-closed on full counsel.
6. **Step-0 grounding releases on the first *useful* source** instead of
   `Promise.all`, which had made Step-0 always cost the slower of RAG and memory
   (20 s moderate / 35 s very_complex) before a single leaf started. Usefulness —
   not first-settle — is the trigger, so a source returning "nothing found" in 20 ms
   cannot cut the source that was actually going to ground the answer.

**Two defects found only by running the deployed code, which reading it would not
have surfaced:**

- **`requestPhase` was never in the partner payload.** It was produced on the Queen
  metadata and dropped at the response seam, so the field NSP had been told to
  branch on measured `undefined` on every answer (`phase=None` on both paths). Now
  first-class on the unified contract, emitted on every path, explicitly preserved
  by the sanitizer (`osDepth` *is* stripped, so it could not be smuggled inside it),
  alongside `optionalDegraded` and `orchestrationId`.
- **`NV-ROUTER-LOG-WIDTH-001` — the decision log had been frozen for hours.**
  `nv_router_decisions.request_id` is `varchar(64)`, but `NV-REQID-CORRELATION-001`
  (§2.6, the fix that unblocked cost measurement) made dispatch ids parent-scoped
  `<uuid>::leaf-*` at 76+ chars. Every batch containing a Queen leaf failed SQLSTATE
  `22001`, and the writer's "lossless" `unshift` retried it forever — head-of-line
  blocking that stalled **all** decision history behind one permanently-invalid row
  (`attempt: 22`; table stuck at 11,394 rows / newest 10:29:04 while traffic ran).
  **This is a direct, unintended consequence of a fix recorded in this plan**, and it
  means router-decision data between roughly 10:29 and 11:07 on 2026-08-17 is lost.
  After the fix: 11,404 rows, newest 11:07:41, `max_reqid_len=44`,
  `scoped_ids_stored=0`, write failures 0.

**Session continuity was broken end-to-end and is now proven working.**
`NV-SESSION-ECHO-001`: the route minted an ecosystem session id for NSP/NYM and
wrote session memory under it, but never returned it — so each turn minted a fresh
id and turn-1 memory was unreachable on turn 2. Verified by a 2-turn live probe:
turn 2 replayed the echoed `sessionId` and recalled `INV-88421` plus the client name
**without the fact being restated**, in 5.2 s against turn 1's 20.1 s.

**Open, and honestly still open:**

- The hung `memory.tiered.recall` itself (`src/services/memory/**`) is *not* fixed.
  First-useful hides it whenever a sibling succeeds; when **no** source is useful
  there is nothing to progress to and the hard cap still governs. That is the last
  known fixed-wait on the leaf path.
- `step0_first_useful` logged **0** occurrences in the verification window, so the
  Wave B path is deployed but not yet exercised by real traffic — do not report it
  as measured until that line appears.
- NSP's reported **502** is *not* this platform's handler: `/api/nv/orchestrate`
  returns **503** `AI_SERVICE_UNAVAILABLE` with a durable retry enqueued and never
  502. Gateway `restarts=0 oomkilled=false`, `ai_service_unavailable=0` over 6 h, and
  there is no nginx container on the host — so the 502 is manufactured above the
  gateway (ALB idle-timeout or the NSP worker's own HTTP client). Needs an ALB
  access-log check, which is an infra step requiring GO.
- The published state enum still needs to land in the OpenAPI spec.
- Widening `request_id` (or storing per-leaf rows in a child table) if per-leaf
  routing analytics are wanted rather than parent-scoped rows.

### Phase 12 — open follow-ups (deferred, need explicit GO)





1. **`xvdb` (500 GB) is attached but unformatted, unmounted, and absent from `/etc/fstab`.** The
   application has therefore only ever seen the 99 GB root volume. Mounting it at
   `/opt/nyayavigya` would end this class of incident permanently, but needs a brief
   gateway stop and a data move.
2. **`deploy-aws-ssm.sh` has no retention policy.** Every deploy adds ~247 MB under
   `/opt/nyayavigya/repo/<timestamp>` and deletes nothing, so 96 % disk recurs every few
   weeks. A keep-N-copies step in the deploy script is the durable fix.
3. Container json logs are **not** a factor (1 MB total); `/var/log/journal` is 383 MB. Log
   rotation is healthy — the growth was entirely deploy history.


**Cumulative target: ~83 % cost cut, ~79 % token cut, ~86 % latency cut** — see §2.
**UNMEASURED as of 2026-08-16, and the instrument is the blocker — not the
orchestration.** Two passes were run (−96.3 % pre-fix, +21.2 % / −18.4 % post-fix)
and **all of it is withdrawn**, for two independent reasons (§2.6):

1. **`NV-REQID-CORRELATION-001`** — `nv-client.ts:475` minted its own `requestId`,
   so provider log lines could not be correlated to an API response. The harness
   degraded to a **time-window** count and attributed *other concurrent requests*
   to the one under test. A request-scoped probe returned **0** billed calls for
   the request whose 3 window-scoped "completions" were reported as the platform's
   largest cost defect. That defect does not exist as described.
   **FIXED 2026-08-16** — one id now threads ingress → dispatch across the
   specialist path and all five Queen dispatch sites; `scopeMode: 'request'` is
   now possible. See §2.6. Re-measurement is unblocked.
2. **Set composition** — 30 % of weight is trivial lookups, and all 7
   cost-bearing prompts share one topic, so the 0.85-similarity cache cross-hits
   between different questions. Effective n = 1.

**What still stands, because it does not depend on either defect:**
`NV-DETERMINISTIC-OVERFIRE-001` was real, is fixed and is deployed (a research
prompt that returned a bare BNSS 482 excerpt now returns a reasoned advisory);
the §12.1 latency attribution (366 s → 176 s) was measured from span trees, not
log windows; and the §12.2 leaf-prompt tiering was measured offline on real
registry prompts.

Fixing correlation is now the **top priority** — without it no cost claim is
falsifiable in either direction.

**Quality gate:** before each phase ships, run a fixed 40-prompt legal eval set
(statute FAQ, mapping, research, drafting, multi-issue) and compare answers to
the current live output. No phase ships on latency improvement alone.

**Phase 6-agentic raises the stakes on that gate.** It is the only phase so far
that is a *quality* change wearing a cost change's clothes: 20 of the 24 golden
prompts are now answered by the specialist path instead of the swarm. The eval
must specifically cover (a) those 20 downgraded prompts — each must be at least
as good as its Queen answer, which is the entire risk; (b) the 4 remaining
ambiguity escalations — confirm they genuinely need fan-out, or the band is too
wide; (c) the score 4–5 boundary, where `QUEEN_ADMIT_SCORE = 6` and
`QUEEN_AMBIGUITY_BAND = 2` are ordinal rather than calibrated and a wrong call is
most likely.

### 11.0a Compliance defect surfaced by removing the shadow files (open)

Deleting the 7 committed `.js` build artifacts under `src/` cut `tests/unit`
failures from 25 to 6 — but the more important effect was that the stale copies
had been **masking a hash-chain bypass**. Two services INSERT into
`nv_audit_logs` directly instead of routing through `appendAuditRecord`:

- `src/services/compliance/nv-bipa-consent-service.ts`
- `src/services/consent-management-service.ts`

A direct INSERT does not extend the audit hash chain, so those consent records
are not tamper-evident — this is a governance/compliance defect, not a test
failure, and it is **open**. It sits outside this plan's orchestration scope but
must not be closed by re-adding the shadow files that hid it.

### 11.1 Phase 4a is done — what it changed about the plan

Phase 4a was prioritised because it reduces cost with no behavioural change to
answers. Shipping it also **corrected the plan itself**:

- The audit's "6–8 completions per Queen request" was not reproduced; worst
  measured is 5 (§1.0g). Cost estimates keyed to that number were too high.
- Two of the biggest wins turned out to be **correctness** bugs, not tuning: the
  Queen's multi-agent answer was being discarded for a statute stub, and a
  TypeError in a safety capability was being reported as a compliance rejection.
  Both cost money *and* shipped worse answers.
- The remaining Queen problem is **latency, not fan-out breadth**: leaves run a
  frontier model at 30–60 s each. That is precisely what §8.5's leaf/synthesis
  split targets, which raises Phase 4b above Phases 1–3 in value-per-risk.

Still outstanding from the original 4a scope: metering M1–M4 (record the
cancelled hedge leg's partial spend, report all completions in the response
envelope, replace `length/4` stream estimates with provider usage). Those are
**transparency** items — customer billing already reads the summed accumulator —
and they must land before any public % claim.

### 11.2 Decision: `nv_client_memory.org_id` — approved, but shipped separately

**Context.** NV-MEM-TENANT-ISOLATION-001 closed the graph-memory leak, but
`nv_client_memory` (`shared/schema.ts:1437-1452`) has no `org_id`, so client
memory can only be scoped by `user_id`. `nv_matter_memory` already has both.

**Verified 2026-08-16 — deferring this is safe, and here is the evidence rather
than the assertion.** `getClientMemory` (`nv-5tier-memory-service.ts:286-302`)
filters on `clientId` **AND** `userId`, and returns `[]` on an unscoped read
(`reason: 'refused-unscoped-read'`). So the *stricter* constraint already holds:
today no caller can read another user's client memory, let alone another firm's.
Adding `org_id` **widens** access from per-user to per-firm — it is a
functionality and correctness improvement, **not** a security fix, and it is
therefore genuinely safe to ship on its own migration cycle. That distinction
matters for sequencing: had it been the reverse (a missing column *permitting*
cross-org reads) it would have belonged in the security batch, not after it.

The cost of waiting is duplicated memory and duplicated tokens across advocates
on the same client — real, but recoverable. The cost of rushing an incorrect
`NOT NULL` backfill onto a live table holding privileged client attributes is not.

**Decision: add the column — the current model is wrong for legal practice, not
merely incomplete.** Client memory records attributes about a *firm's client*. The
natural owner is the firm, not the individual advocate:

- If an advocate leaves, per-user scoping strands or orphans the firm's client
  knowledge — a records-retention problem, not just an inconvenience.
- Multiple advocates work the same client. Per-user scoping means each rebuilds
  the same memory independently, which is *also* a token cost: the platform pays
  repeatedly to relearn what the firm already knows.
- There is no org boundary to *enforce*, so the isolation story stays incomplete
  while the strongest available guarantee is "one user cannot read another".

**But it ships as its own change, after the Phase 1/2/3/5/6 code deploy.** Two
reasons, both about being able to tell what broke:

1. A schema migration bundled with a large code deploy makes rollback ambiguous.
   Rolling the code back while the column exists (or the reverse) leaves a
   mismatch, and if the deploy misbehaves we cannot separate a code fault from a
   migration fault.
2. **It is not urgent for safety.** `getClientMemory` fails closed on an unscoped
   read, so there is no open leak today. This is a capability gap, and a capability
   gap does not justify raising the risk of an already-large deploy.

**Sequence when it does ship** (per AGENTS.md §4 — `npm run db:push --force` after
eyeballing the diff, never a hand-written `ALTER`, and PK column types preserved):

1. Add `org_id integer` **nullable**. Nullable is not laziness: `NOT NULL` before
   backfill would fail on every existing row.
2. Composite indexes matching the new scoped read shape —
   `(org_id, matter_id, memory_type)` on `nv_matter_memory`,
   `(org_id, client_id, attribute)` on `nv_client_memory`. The existing
   single-column `user_id` indexes no longer match the query.
3. Backfill `org_id` from each row's owning user's org, capturing affected row
   counts in `CHANGELOG.md` per AGENTS.md §4.
4. Only then let scoped reads prefer `org_id`, keeping the user-scoped path as the
   fallback for un-backfilled rows. Reads stay fail-closed throughout.
5. Consider `NOT NULL` only once a backfill leaves zero nulls.

---

## 12. Measured gaps that block the 70 % claim (top priority)

Both items below are **measured on live nysdev after the 2026-08-16T0910Z batch**,
not projected. They exist because verification was run rather than assumed, and
they are the reason the headline number is not yet claimable on the Queen path.

### 12.1 The 236 s of non-LLM Queen overhead — ATTRIBUTED (root cause found)

**Status: attributed with zero residual, 2026-08-16. Fix code-complete, awaiting deploy.**

Phase 4c's parallelisation is confirmed working — wave 1 shows a **parallelism factor
of 1.93×**. The wall time barely moved because the bottleneck was never
serialisation of model calls. Live span tree (trace `98492c01744d`):

```
queen.orchestrate            366.1s  100.0%   WALL CLOCK
├─ queen.memory.recall         0.7s    0.2%   recalledCount=0
├─ queen.rag                   3.1s    0.9%
├─ queen.execute             211.2s   57.7%
│  ├─ swarm-agent-0           98.5s          llm  8.1s → NON-LLM 90.3s (92%)
│  ├─ swarm-agent-1           98.5s          llm  8.1s → NON-LLM 90.4s (92%)
│  ├─ swarm-agent-2           98.8s          llm  8.1s → NON-LLM 90.6s (92%)
│  └─ swarm-aggregate        112.4s          llm 22.0s → NON-LLM 90.5s (80%)
└─ queen.synthesis           151.7s          llm 61.2s → NON-LLM 90.5s (60%)

ACCOUNTED                    366.0s  100.0%
RESIDUAL                       0.0s    0.0%
```

**The finding is the constant.** Non-LLM cost is ~90.4 s in *every* leg. Variable
work does not produce a constant; a fixed timeout budget does. And **90.4 ≈ 3 × 30 s**:

- `capabilityManifest.invoke` wraps every call in `runWithRetryAndBreaker(…, 'outbound:capability')`
- that surface's policy is `timeoutMs: 30_000` (`circuit-breaker.ts`)
- `DEFAULT_RETRY` is `maxAttempts: 3`, `isRetryable` matching `/timed?[- ]?out/`

So `memory.tiered.recall` burns its full 30 s, is retried twice more — each retry
certain to hit the same wall — and **the retry loop logs nothing**. That is exactly
why an earlier probe correctly saw "zero retry/backoff log lines" while the request
was paying for retry churn. All 5 `Timed out` markers are this one capability
(`ok=0 fail=5`), returning **zero memory items** every time: full cost, zero value.
**~226 s of the 251 s non-LLM wall clock is this single failing capability.**

**Two of our own numbers corrected — both worse, both truer:**

1. The "130.1 s of LLM time" was a **sum** double-counting 3 parallel lanes. True
   model **union** is 114.8 s (31.4 %), so non-LLM is **251.3 s (68.6 %)** — larger
   than the 236 s first reported.
2. **Zero consensus rounds ran.** The request took `executeSwarm` on the
   decomposition path (`swarm-agent-0/1/2` + `swarm-aggregate`); the "4× synthesis /
   3× aggregation" markers were swarm aggregation, not consensus. So §12.1's earlier
   hypothesis #1 is **dead**, cleanly. 211.2 s + 151.7 s of *ordering* is sequential
   **by design** (2 dependency waves + synthesis); only the 90.4 s per-leg tax is
   accidental.

**Fixed:** `NV-QUEEN-STAGE-ATTRIBUTION-001` (always-on `queen.mw.*` stage spans,
reusing the existing `withSpan`) and `NV-MEM-FANIN-BOUND-001` (each fan-in source
capped at the breaker's **own** `timeoutMs`, read live — content-neutral by
construction, since the breaker already guarantees nothing returns after that
budget, so it cannot drop a recall that would have arrived).

**Deliberately NOT fixed — larger than this fix, needs its own gated decision:**

- The **3× multiplier applies to all 18 `runWithRetryAndBreaker` call sites**, not
  just memory. Retrying a *timeout* is close to always wrong: if an operation
  exceeded its budget once, a bit-identical retry usually exceeds it again, so the
  policy converts one 30 s failure into 90 s. Changing `DEFAULT_RETRY` platform-wide
  is a policy change, not a probe side effect.
- **Root cause is upstream:** why `nvMemoryService.retrieve` exceeds 30 s and returns
  nothing lives under `src/services/memory/**`. Fixing it recovers the remaining
  ~30 s/leg.

Phase 4c's parallelisation is confirmed working — three exploration lanes dispatch
in the **same millisecond** (`09:31:02.892`). The wall time still barely moved:

**Superseded pre-attribution snapshot, kept for the audit trail** (the "unattributed"
line is now fully explained above; note the middle row was a double-counting *sum*,
corrected to a 114.8 s union):

| Measure | Before 4c | After 4c |
|---|---:|---:|
| Wall clock | ~390 s | **366 s** |
| Sum of the 7 completions (double-counts parallel lanes) | ~89 s | 130 s |
| Non-LLM time — then unattributed, now root-caused | ~300 s | **251 s (68.6 %)** |

Serialisation of the *model calls* was never the dominant term, and neither was
per-leaf cost (Phase 4b cut that ~20×) nor per-call latency. The lesson worth keeping:
**"zero retry/backoff log lines" was true and still misleading**, because the retry
loop logs nothing. Absence of evidence in logs was treated as evidence of absence,
and it took a per-stage span tree plus the 3 × 30 s arithmetic to see it.

### 12.2 Phase 3's prompt budgets did not reach Queen leaves — FIXED, with a residual

**Status: fixed 2026-08-16 (code complete, awaiting deploy).** Root cause was three
*missing arguments* in `nv-queen-orchestrator.ts::callAgentInner()`, not missing
capability — exactly as suspected, the lean tiers already existed and nothing
classified leaf dispatch. `nv-client.ts` already called `budgetForRequest()`; the
Queen never called the budget module. Measured (real IN registry prompts, "before"
= same assembler under `NYV_PROMPT_BUDGET=0`):

| Path | Role | Before | After | Cut |
|---|---|---:|---:|---:|
| single-shot (L1) | exploration | 3,213 | **1,905** | **−40.7 %** |
| turn 1 (L0), flag on | exploration | 8,616 | **1,905** | **−77.9 %** |
| either | synthesis | — | unchanged | **0 %** (deliberate) |

Shipped split by risk: tiering default-ON (reuses tiers already default on the
specialist path); **L0 downgrade flag-gated OFF** (`NYV_QUEEN_LEAF_L0_DOWNGRADE=1`)
because it is the largest term and changes what the swarm reasons over — it needs
the §11 40-prompt gate. `NV-TOKEN-BUDGET-001` now exists as a guardrail test that
fails if a leaf is assembled without a declared task class, so this cannot regress
silently.

**Residual — ~11,300 tokens still unattributed.** The highest *assembled* prompt
measured is 8,616 tok; the live leaf measured **19,938**. So roughly **11,300 tok
of the live leaf prompt is runtime-injected context that this fix does not touch**,
and it is the larger share. Code inspection rules out the obvious candidates:

- middleware `[MEMORY]` and `[RAG]` blocks are bounded at 5 items × 240 chars
  (`orchestration-middleware.ts:283-289`) — together ~600 tok, not 11,300;
- synthesis evidence is already capped by `NV-QUEEN-EVIDENCE-CAP-001`, and goes to
  the synthesis leg rather than to exploration leaves.

**This must be measured on the live path, not inferred from source** — the next
probe after deploy has to dump an actual leaf prompt and attribute it by block.
Until then the leaf-token reduction is **−40.7 % of the assembled component**, and
the end-to-end per-request figure (the 89,610-token / 7-completion measurement) is
**not** yet re-verified. Do not restate the assembled-component cut as an
end-to-end cut.

**Original measurement, for reference:**

| Path | Prompt tokens |
|---|---:|
| Micro/FAQ path (Phase 3 target, achieved) | **1,048** |
| Queen exploration leaf (measured live, pre-fix) | **19,938** |
| Queen synthesis leaf (measured live) | 11,696 |

> **The 70 % cost reduction still holds only where the budget tiers apply.** The
> assembled component is now tiered on the Queen path, but until the ~11,300-token
> runtime residual is attributed and the end-to-end figure re-probed, a blended
> published number remains unsupported by measurement.

### 12.3 HTTP 500 + heap pressure measured against the wrong denominator

**Status: root-caused 2026-08-16, code complete, awaiting deploy. TOP PRIORITY —
this is a live 500 on the Queen path.**

The §12.1 fix worked: **wall clock 366 s → 176 s (−52 %)**, with live logs
confirming a single 30 s breaker attempt instead of 3×30 s, the new `queen.mw.*`
spans emitting, and **38 recall sources succeeding**. But the probe returned
**HTTP 500 with 0 answer chars after billing 10 completions**. Failing *fast* is
strictly worse than slow-and-correct: we pay for the answer and discard it.

RCA found **no orchestration error at all** — zero `mandatory steps missing`, zero
queen/swarm/envelope errors. The cause is memory pressure, and **the pressure
signal itself is broken.**

**NV-HEAP-PRESSURE-DENOM-001.** `nv-memory-manager.ts` computed
`heapPct = heapUsed / heapTotal`. That is not a headroom metric: `heapTotal` is the
heap V8 has *currently committed*, and V8 sizes it to fit live data — so the ratio
sits at **85–95 % in any healthy process** and *rises when memory is freed*.
Against thresholds of 90/98, "elevated" was permanent and "critical" routine. Live
nysdev logged heapPct **89/91/92/94/95** while the container held **499 MB of a
2 GB limit (24 %)** and the host had **13.8 GB free**.

**This is not cosmetic, and it reaches back to the founding RCA.** Critical
pressure triggers cache eviction on a timer, so the platform was **continuously
discarding the LM cache it had just populated** — a direct contributor to the
"cache rarely hits" symptom in §1, and to Phase 2's disappointing hit rate. We
were paying frontier-model prices for answers already computed and thrown away.
The denominator is now `v8.getHeapStatistics().heap_size_limit`.

Companion defect, same file: `rssLimitMb` was **hardcoded to 512 MB** — below both
the container limit and the heap limit — so `rssOverLimit` was true in steady state
and carried no information. Now derived from the heap limit ×1.5 (non-heap RSS:
native buffers, code, stacks), with `NYV_RSS_LIMIT_MB` to pin the real cgroup value.

**NV-HEAP-LIMIT-CONTRADICTION-001.** Three different heap ceilings were declared:

| Where | Value |
|---|---|
| `Dockerfile` CMD `--max-old-space-size` | **3584 MB** |
| `docker-compose.aws-dev.yml` `NODE_OPTIONS` | 1536 MB |
| container `mem_limit` | 2048 MB |

An explicit CLI flag **overrides `NODE_OPTIONS`**, so the compose file's
deliberate, documented 1536 sizing — chosen specifically so "v8 GCs aggressively
before the kernel OOM-killer steps in" — **never applied for the life of the
container**. V8 was permitted a **3.5 GB heap inside a 2 GB cgroup**, guaranteeing
kernel OOM instead of GC: the exact opposite of the documented intent. The flag is
removed from the Dockerfile so the ceiling is declared **once**, next to the
`mem_limit` it must respect.

**Lesson worth keeping:** every one of these was invisible to the type checker and
to ordinary tests. Two of them (`heapUsed/heapTotal`, `rssLimitMb = 512`) are the
same family as NV-RAG-CONF-001 and NV-MEM-DECAY-001 — **a threshold compared
against the wrong reference value, so the signal is constant rather than
informative.** That family now has three independent instances in this codebase and
warrants its own guardrail beyond the clamp-tautology detector.

## 13. Guardrails to add

- **NV-DETERMINISTIC-FIRST-001** — no LLM call for anything a store/parser can answer.
- **NV-TOKEN-BUDGET-001** — every dispatch declares a task class and its token ceiling; over-budget assembly fails loudly in CI. **Now known to be violated by Queen leaf dispatch (§12.2) — this guardrail would have caught it at build time.**
- **NV-MODEL-ID-VALID-001** — every id in every cascade must resolve in the catalog *and* at the provider; boot check fails otherwise. **Implemented as `nv-cascade-validator.ts`; found NV-CASCADE-DRIFT-001 on its first run.**
- **NV-CASCADE-SSOT-001** — exactly one cascade definition file.
- **NV-NO-STUB-001 (enforce)** — the cost-optimization suite currently returns literal `[Draft response from …]` strings with a hardcoded `tokensSaved: 500`, and the "70 % token optimization" figure is a hardcoded advisory string with no implementation behind it. Either implement or delete.
- **NV-DEADLINE-001** — no provider attempt may start without a remaining-time budget.
- **NV-GUARDRAIL-UNREACHABLE-THRESHOLD-001** — clamp-then-compare tautologies (`Math.max(FLOOR, x) >= FLOOR`) can never fire; this exact shape produced both NV-RAG-CONF-001 and NV-MEM-DECAY-001 independently. Implemented as `scripts/nv-detect-unreachable-threshold.mjs`, wired into `npm run guardrail`.
- **NV-DEPLOY-VERIFY-PATH-001** — deploy verification must grep the path the runtime actually loads (`/app/src`, since the gateway runs `tsx src/index.ts`) and must assert a **known-old** marker as a canary. Grepping a non-existent bundle returns 0 for everything and is indistinguishable from a failed deploy; this cost one wasted redeploy cycle.

