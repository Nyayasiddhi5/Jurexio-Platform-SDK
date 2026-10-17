# AI credit enforcement — coverage audit (NV-CREDIT-UNIVERSAL-001)

**Date:** 2026-08-19 · **Scope:** NYV (`nyayavigya-platform-312`) · **Deploy:** none (audit + local wiring only)

## Why this audit ran

`POST /api/nv/legal-chat/send` was found spending real money with no AI-credit
enforcement. Two questions followed: how many other surfaces are like it, and —
more importantly — was the enforcement that *does* exist actually capable of
firing?

The second question turned out to matter more than the first.

## Headline

1. **`/orchestrate/stream` enforced a cap it could never fire.** It calls
   `nvAICreditEnforcer.enforce()` but never `record()`. `recordOrchestrateCredit`
   is invoked only at `nv-orchestration-routes.ts:1098` and `:1804`, both inside
   the **sync** `/orchestrate` handler (lines 314–1877); the streaming handler
   (1878–2442) has no call. Verified by line-range extraction, not by grep alone.
2. **The no-op was platform-wide, not per-endpoint.** `enforce()` admits on
   `getUsedToday()`, which sums `nv_schema.ai_credit_usage`. Only two handlers in
   the entire platform wrote that table. So *every* cap was reading a number that
   almost nothing incremented.
3. **~110 partner-reachable handlers reach a paid model call with no cap.** Not 3
   endpoints — the SDK gateway, docs-pipeline, sdk-intelligence, intelligence,
   patterns, agents, nv5 and workflow routers all spend and none enforced.
4. **The fix is architectural, not 110 edits.** All LLM spend funnels through
   `orchestrateLLM` (NV-LLM-001 single-router rule), which already reports every
   provider call into the request-scoped usage accumulator. One response-finish
   recorder therefore makes every existing and future `enforce()` functional.
5. **Legal-chat was not the only gap, but it was a fair sample.** The pattern that
   produced it — a capability wired to one door and not the others — is exactly
   what the sweep found.

## Method — and the instrument failures found on the way

A single grep is not an audit, and my first two instruments were both wrong. This
is recorded because the corrections are the reason the numbers below are credible.

| Instrument | Failure | How it was caught |
|---|---|---|
| v1: file-level transitive imports | `nv-health-routes` "spent money" | **Negative control failed.** An import edge is not a call edge |
| v2: symbol-level, regex balancer | `/orchestrate` handler read as 8 KB instead of 75 KB | Positive control on body size. Cause: an apostrophe in a comment (`the caller's id`) was parsed as a string open, desynchronising every brace count after it |
| v2b | `executeWithOrchestration()` looked bodyless, so all 12 gateway endpoints looked free | Balancer took the `{` of the **parameter type** `context: { … }` |
| v2c | Same helper still bodyless | Balancer took the `{` inside the **return type** `Promise<LLMResponse & { orchestration: any }>` |
| v2d | Whole SDK gateway looked free | Spend-leaf regex listed verbs like `generate`/`complete` but the real spend method is `realLLMService.executeRequest` |
| v2e | Two patterns routes reported as recording usage | `z.record(z.any())` — zod, not credit accounting |

Final instrument: `.tmp-credit-audit/reach2.mjs` — comment/regex-aware lexer,
symbol-level call graph, 13 controls (5 positive, 6 negative, 2 structural), all
passing. Two of my "positive" controls had to be **rewritten as negatives** once I
read the source: `/shared-docs/process` and `/hallucination/check` do not spend.
They were hypotheses, and they were wrong.

## Classification

`llm` = token-metered model spend. `aux` = paid but not token-metered
(embeddings, STT/TTS, OCR) — real money, invisible to the token enforcer.

| Class | Count | Meaning |
|---|---|---|
| **Enforced correctly** | 4 | `enforce()` + `record()` both present |
| **Decorative** | 3 | `enforce()` present, no `record()` — a cap that cannot fire |
| **Unenforced (llm)** | 145 | Neither leg. 108 partner-reachable |
| **Unenforced (aux)** | 13 | Paid non-token spend, outside the enforcer's model entirely |
| **Deliberately exempt** | 2 mechanisms | Evidence-backed — see below |
| **Spends nothing** | — | Established by reading the implementation, not by absence |

Counts are handler×mount, so an endpoint mounted at `/api/nv/orchestrate`,
`/api/nv/orchestration/orchestrate` and `/api/nv/v1/sdk/orchestrate` counts three
times. That is deliberate: each alias is separately reachable.

## The audit table

### Enforced correctly (before this change)

| Surface | Auth | Evidence |
|---|---|---|
| `POST /api/nv/orchestrate` | `dualSdkOrJwt` | `enforce()` at `nv-orchestration-routes.ts:767`; `recordOrchestrateCredit` at `:1098` / `:1804` |
| `POST /api/nv/orchestration/orchestrate` | `dualSdkOrJwt` | same handler, alias mount |
| `POST /api/nv/v1/sdk/orchestrate` | `dualSdkOrJwt` | same handler, alias mount |
| `POST /api/nv/legal-chat/send` | JWT + legal-chat RBAC | `enforce()` at `nv-legal-chat-routes.ts:724`; `recordLegalChatCredit` at `:959` |

### Decorative — enforced a cap that could never fire

| Surface | Auth | Evidence | Now |
|---|---|---|---|
| `POST /api/nv/orchestrate/stream` | `dualSdkOrJwt` | `enforce()` at `:2118`; **no** `record()` in 1878–2442 | **Fixed** — recorded by the universal recorder |
| `POST /api/nv/orchestration/orchestrate/stream` | `dualSdkOrJwt` | alias of the above | **Fixed** |
| `POST /api/nv/v1/sdk/orchestrate/stream` | `dualSdkOrJwt` | alias of the above | **Fixed** |

Streaming spend *is* measurable — `llm-orchestrator.ts:2205` reports
`streamTokensIn/Out` into the accumulator. Nothing consumed it for billing.

### Unenforced, partner-reachable — the material exposure

| Surface group | Endpoints | Auth | Cost/call | Status |
|---|---|---|---|---|
| `/api/nv/gateway/documents/{draft,analyze,summarize,compare,qa,extract-entities,classify-clauses}` | 7 | SDK key | $0.035–0.08 | **Pre-spend cap wired** |
| `/api/nv/gateway/research/{query,precedent}` | 2 | SDK key | ~$0.05 | **Pre-spend cap wired** |
| `/api/nv/gateway/agents/:agentId/execute` | 1 | SDK key | ~$0.04 | **Pre-spend cap wired** |
| `/api/nv/gateway/legal-intelligence/feed/generate` | 1 | SDK key | ~$0.05 | **Pre-spend cap wired** |
| `/api/nv/sdk/docs-pipeline/*` (9 model-calling) | 9 | SDK key | $0.02–0.06 | **Pre-spend cap wired** |
| `/api/nv/v1/sdk/intelligence/*` (9) | 9 | SDK key | ~$0.02 | **Pre-spend cap wired** |
| `/api/nv/{intelligence,ai}/*` (14 model-calling) | 14×2 mounts | `dualSdkOrJwt` | ~$0.018 | **Pre-spend cap wired** |
| `/api/nv/patterns/*` | 18 | `dualSdkOrJwt` | varies | **Proposed** (below) |
| `/api/nv/sdk/enterprise/research/*`, `/sdk/workflows/*`, `/sdk/multimodal/*` | 13 | SDK key | varies | **Proposed** |
| `/api/nv/agents/{execute,run,orchestrate}` | 3 | JWT | varies | **Proposed** |
| `/api/nv5/*` (orch, doc-ai, legal-pipeline, multimodal, voice, workflows, gov, compliance) | ~20 | mixed | varies | **Proposed** |
| `/api/nv/{content,doc-analyze,digital-twin,filter,identity,testing,legal-work,matter-vault,social-memory,stream,phase4,phase5,v311}` | ~25 | mixed | varies | **Proposed** |

All of the above are now **post-spend recorded** by the universal recorder,
whether or not a pre-spend cap was added.

### Spends nothing — and how that was established

Not asserted from absence of an LLM import; each was read.

| Surface | Why it spends nothing |
|---|---|
| `POST /api/nv/hallucination/check` | `NvHallucinationDetector.checkOutput` (`nv-orchestration-services.ts:50–123`) is five regex arrays + one Postgres insert. No model. |
| `POST /api/nv/citations/verify` | `NvCitationVerifier.verifyCitations` — regex extraction then `SELECT` against the corpus. No model. |
| `POST /api/nv/bias/audit`, `/bias/history` | Same deterministic family. |
| `POST /api/nv/shared-docs/process` | Enqueues a durable EDJ job and returns 202. The spend happens later in the worker — tracked separately below, not here. |
| Knowledge-plane statute mapping | `FEATURES-REGISTRY.md` records NV-STATUTE-MAP-FASTPATH-001 as answered from the NYS knowledge plane, **no LLM**, 66–293 ms. |
| `/api/nv/health*`, `/version`, `/auth/*` | Negative controls in the instrument; confirmed no spend path. |

### Deliberately exempt — with actual evidence of intent

Absence of enforcement was **not** treated as evidence of intent. Two mechanisms
have real evidence:

1. **`NYV_NSP_UNLIMITED` (default `1`)** — `nv-partner-platform.ts:477`, documented
   NV-NSP-UNLIMITED-001: "NSP (any user / any org SDK key) skips product RPM, org
   AI rate limits, credit/hourly caps, and daily token budgets."
2. **`NYV_PARTNER_DEMO_UNLIMITED` (default `1`)** — `nv-partner-platform.ts:490`,
   NV-PARTNER-DEMO-UNLIMITED-001, and set explicitly on EC2 by
   `scripts/ec2-partner-serving-env-patch.sh:28`.

**This is load-bearing for the risk assessment.** Because NSP is bypassed by
default, adding a pre-spend cap that threads `bypassCaps:
wantsPartnerDemoUnlimited(req)` cannot refuse NSP's live traffic. That is why the
caps below were safe to ship rather than merely propose. A test pins it:
*"passes bypassCaps so NSP/NYM demo-unlimited traffic is unaffected"*, and the
mutation that hard-codes `bypassCaps: false` goes red.

## Exposure — what a runaway caller could spend

gpt-4o pricing from `nv-llm-pricing.ts` ($0.0025/1K in, $0.0100/1K out); request
rates from `RATE_LIMITS` in `nv-sdk-tracking-middleware.ts:105–109`.

| Surface | Tier | rpm | $/call | $/hour | $/24h |
|---|---|---|---|---|---|
| `gateway/documents/draft` | pro | 60 | 0.080 | **$288** | **$6,912** |
| `gateway/research/query` | pro | 60 | 0.050 | $180 | $4,320 |
| `gateway/documents/analyze` | pro | 60 | 0.035 | $126 | $3,024 |
| `sdk/intelligence/*` | pro | 60 | 0.020 | $72 | $1,728 |
| `intelligence/summarize` | pro | 60 | 0.018 | $63 | $1,512 |
| **any of the above** | **enterprise** | **600** | 0.055 | **$1,980** | **$47,520** |

**The number that makes the priority obvious:** a `pro` caller's daily token
budget is 800,000 tokens — roughly **80 calls, about 2 minutes at 60 rpm**. Every
call after that should have been refused. Unenforced, the same key could run for
24 hours at **~$4,750/day**, and an enterprise key at **~$47,500/day**. Per key.

The pre-spend caps now wired cover the top five rows.

## What was wired vs proposed

### Wired

**1. Universal post-spend recorder** — `src/middleware/nv-credit-usage-recorder.ts`,
called from the existing `finish` hook in `nv-usage-metering-middleware.ts`
(mounted `/api/nv/` at `src/index.ts:581`).

Chosen over 110 route edits because it is architecturally justified, not merely
cheaper: all spend funnels through `orchestrateLLM` (the `RealLLMService` legacy
per-provider fallback is closed and throws `NV_LLM_001_ORCHESTRATOR_UNAVAILABLE`),
which already reports into `nvRequestUsageContext`. So the true token/cost figure
for any request exists at response-finish with no handler changes. This makes
every existing `enforce()` — including the three decorative streaming ones —
functional, and any future one functional on arrival.

It records only; it never refuses. A finish hook runs *after* the money is spent,
so refusing there would bill and refuse. Guards: `calls > 0` (a deterministic path
or a validation 400 must not consume budget), and a single-claim marker so a
request already recorded by `/orchestrate` or `/legal-chat/send` is not billed
twice. Double-billing a customer is a worse failure than the under-billing this
fixes.

**2. Reusable pre-spend cap** — `src/middleware/nv-ai-credit-cap-middleware.ts`.
Reuses `nvAICreditEnforcer` (NV-NO-DUPLICATE-001), matches `/orchestrate` exactly:
HTTP 429 `RATE_LIMIT_EXCEEDED` with `details.code = 'CREDIT_CAP_EXCEEDED'`,
fail-soft on enforcer error, `bypassCaps` from `wantsPartnerDemoUnlimited(req)`.
Prices attachments, not just the instruction.

Applied per-route (**not** `router.use`) to 40 handler registrations across
`nv-sdk-gateway-routes`, `nv-sdk-doc-pipeline-routes`, `nv-sdk-intelligence-routes`
and `nv-intelligence-routes`. Per-route is the deliberate choice: a router-level
cap would also refuse the deterministic reads in those routers
(`/documents/templates`, `/clauses/library`, `/capabilities`, `/client-health`,
`/firm-snapshot`), which spend nothing. Refusing a free read to close a gap that
does not exist on that path is the trade this audit was told not to make.

### Proposed — needs the architect, not shipped

**a. `/api/nv/patterns/*` (18 endpoints).** Highest remaining count, but it carries
`aiPatternRateLimit` at `src/index.ts:493` and two router-level gates I could not
confirm are cap-compatible. A pattern chain is also multi-call, so a single
prompt-based estimate would misprice it. Recommend a per-pattern allowance table
before capping.

**b. The EDJ worker (`nv-ecosystem-document-job-service.ts:237`).** This is the
real spend behind `/shared-docs/process`, and it is the one place the universal
recorder does **not** cover: a background job has no HTTP response to finish on.
It needs an inline `enforce()`/`record()` pair at the job boundary, with the cap
evaluated at *enqueue* time so a partner learns at 202 rather than silently
failing later. That is a partner-contract decision.

**c. The 13 `aux` (non-token) paid surfaces** — embeddings, STT/TTS, OCR, vision
(`/gateway/documents/embeddings`, `/phase4/{vision,voice}/*`, `/sdk/multimodal/*`).
These spend real money that the token enforcer cannot see, because
`ai_credit_usage.tokens_used` is the wrong unit for a per-minute STT bill. Capping
them needs a cost-based (not token-based) budget dimension. Reporting rather than
inventing one.

> **Superseded 2026-08-20 — NV-CREDIT-COST-DIM-001 shipped this.** See
> "Follow-up 2026-08-20" at the end of this document. The dimension is integer
> micro-USD summed from the `cost_usd` column this audit's own recorder already
> writes, so no migration was needed — and two defects in this audit's work were
> found while wiring it.

**d. The wallet credit gate.** `src/middleware/nv-credit-gate-middleware.ts`
implements a complete HTTP 402 `ZERO_CREDIT_BALANCE` / `INSUFFICIENT_CREDITS`
wallet system with reserve/finalize/release. `FEATURES-REGISTRY.md:186` records it
as **WIRED-FLAG-OFF**, and it is imported in `src/index.ts` only as
`_nvCreditGate` with `void _nvCreditGate`. It is a *second, different* policy
(prepaid wallet vs token budget) and turning it on is a commercial decision. Not
touched — flagged so it is not rediscovered as a "gap".

**e. `/api/nv/agents/*` and the `nv5` surface (~23 endpoints).** JWT-only or
internal, so no partner-reachable exposure. Post-spend recording now covers them,
which makes their spend visible; capping can follow once the recorded data shows
real volume. Wiring caps on internal admin paths first would be optimising the
wrong end.

## Mutation results — every mutation and its verdict

18 mutations, each breaking exactly one guard. Suites:
`nv-credit-universal-enforcement`, `nv-credit-backstop-redundancy`,
`nv-legalchat-quality-envelope`. Harness: `.tmp-credit-audit/mutate.sh`.

| # | Mutation | Result |
|---|---|---|
| 1 | cap: `enforce()` moved after `next()` (post-spend) | RED |
| 2 | cap: refusal removed — breach admitted | RED |
| 3 | cap: refusal code changed from `CREDIT_CAP_EXCEEDED` | RED |
| 4 | cap: fail-soft → fail-hard (500 on enforcer throw) | RED |
| 5 | cap: estimate ignores the attached document | RED |
| 6 | cap: `bypassCaps` hard-coded `false` (breaks NSP) | RED |
| 7 | cap: whole-body fallback applied even when a prompt matched | RED |
| 8 | recorder: not invoked from the finish hook | RED |
| 9 | recorder: bills a request with zero model calls | RED |
| 10 | recorder: claim guard removed (double billing) | RED |
| 11 | recorder: completion tokens dropped from the bill | RED |
| 12 | recorder: partner spend attributed to shared `anon` | RED |
| 13 | recorder: outer try/catch removed (sync throw escapes) | RED |
| 14 | context: claim always refuses (no row ever written) | RED |
| 15 | context: claim refuses when there is no accumulator | RED |
| 16 | legal-chat: pre-spend `enforce()` removed | RED |
| 17 | legal-chat: post-spend `record()` removed | RED |
| 18 | orchestrate: post-spend claim+record removed | **GREEN** |

### The three mutations that first stayed green — and what each revealed

**#5 (document pricing) — a real defect in my own code.** It survived because the
`chars === 0` whole-body fallback happened to re-price the same document, masking
deletion of the named-key scan. Adding a discriminating test exposed the actual
bug: the fallback also meant a caller attaching 200 KB of unrelated metadata would
have that metadata billed against their token budget. Fixed (fallback now applies
only when no prompt field matched) and pinned by mutation #7.

**#13 (recorder fail-soft) — an unfalsifiable test, then an instrument error.**
Over HTTP the metering middleware's own try/catch is a second net, so the
recorder losing its try/catch cannot be observed from the response. The property
was real but untestable at that layer — and a test that cannot fail is not a test.
Re-asserted at the unit boundary. My first mutation patch was also simply
ineffective (a chained `.catch` swallows a rethrow) — my command was wrong, not
the platform.

**#15 (claim with no accumulator) — a latent bug the mutation caught.** My first
implementation returned `false` when no accumulator existed, which would have
silently prevented any off-request spend (worker, cron, EDJ job) from ever being
recorded — the original no-op defect in a new costume. Changed to grant the claim
(with nothing to mark, nothing can double-bill) and pinned.

### #18 stayed green — and this one is correct, verified by execution

Removing `/orchestrate`'s inline post-spend recorder no longer breaks anything,
because the universal recorder covers the same request. I did not assume that —
`tests/unit/nv-credit-backstop-redundancy.test.ts` proves it:

- with **no** route-level recorder, the backstop records exactly one row of 6,000
  tokens tagged `agentKey: '/api/nv/orchestrate'`;
- positive control — with the inline recorder present, exactly one row is written
  and it is the route's (`agentKey: 'orchestrate'`), not the backstop's.

So this GREEN is redundancy, not a coverage hole. The inline recorders are kept:
they carry richer per-surface attribution and feed the legal-chat quality
envelope. Mutations #16/#17 confirm legal-chat's own legs remain guarded.

## Gate numbers

| Gate | Baseline | After | Verdict |
|---|---|---|---|
| `vitest run tests/unit` | 1429 passed / 3 skipped / **0 failed** / 98 files | 1484 passed / 3 skipped / **0 failed** / 102 files | held (+55 tests) |
| `guardrail:server-types` | 25 errors / 19 signatures | 25 errors / 19 signatures | held, not refreshed |
| `guardrail:no-placeholder` | debt 75 | debt 75 | held |
| `guardrail:orch-stage` | PASS (6 checks) | PASS (6 checks) | held |
| `guardrail:no-new-orphans` | **FAILING at baseline** — 1 orphan / budget 0 | **0 / budget 0**, wired 519/526 | improved |

The brief cited 1,423 passed; baseline measured 1,429 (concurrent agents added
suites, as anticipated).

`no-new-orphans` was **already red before I made any change** — an untracked
service from another agent's in-flight work. Recorded rather than silently
absorbed. It now passes because the two new middleware modules are reachable from
`src/index.ts`; the budget was **not** bumped to hide anything.

### Cross-agent test attribution

A late full run showed 5 failures in `nv-authority-identity.test.ts` and
`nv-citator-attribution.test.ts`. Attributed to another agent's in-flight citator
work, by file-level diff rather than assumption:

- my diff touches no authority/citator file (`git diff --name-only`);
- those files contain **zero** occurrences of any marker of mine
  (`NV-CREDIT-UNIVERSAL`, `nvAiCreditCap`, `claimRequestUsageForBilling`);
- timeline: my clean 0-failed run completed at 01:20; those sources were modified
  at 01:23–01:27;
- `nv-citator-treatment.ts` is on this task's explicit do-not-touch list.

My four suites pass together: 53/53.

## Honest limits

- No live probe was run. Everything is static analysis plus local execution; the
  claim "these endpoints spend money" rests on read call chains and passing
  controls, not on observed EC2 provider bills.
- The pre-spend estimate for the newly capped routes uses a fixed completion
  allowance (`NYV_AI_CREDIT_COMPLETION_ALLOWANCE`, default 4,096; 8,192 for
  drafting/research), because these routes do not resolve a `maxTokens` the way
  `/orchestrate` does. It is deliberately conservative — under-estimating is the
  failure that admits a request which then blows the cap.
- The `~110 unenforced` figure counts handler×mount and is a **lower bound**: a
  handler whose spend is reachable only through a runtime-dynamic dispatch my
  symbol graph cannot follow would be missed.
- Whether the newly capped surfaces *should* be capped for non-partner callers is
  a product decision. It is now enforceable and reversible via
  `NYV_CREDIT_ENFORCE=0`.

---

# Follow-up 2026-08-20 — observe mode + the cost dimension

Two decisions taken on top of this audit, by the architect. Both change what the work
above *does*, so they are recorded here rather than in a second document.

## 1. The 40 new caps ship in OBSERVE mode (NV-CREDIT-OBSERVE-001)

`NYV_CREDIT_CAP_MODE` — `observe` | `enforce`, **default `observe`**. The caps run the
enforcer and log the refusal they would have made, then admit the request.

The reason follows directly from headline #2 of this audit. Because `usedToday` was
structurally 0, **these budgets have never once been compared to real consumption.**
Shipping the recorder and the refusals together would start refusing partner work
against numbers nobody has validated against traffic, and a budget tuned too low
refuses lawful work — worse, and much more visible, than the over-permissiveness this
audit found.

Three properties worth pinning explicitly:

- **The recorder is NOT gated by the flag.** Observing a counter nothing increments
  reproduces the defect in headline #2 and dresses it as caution.
- **`NYV_CREDIT_ENFORCE=0` still wins.** An operator who switched credit enforcement
  off entirely has not asked these caps to refuse either.
- **The four pre-existing enforced surfaces were not downgraded.** `/orchestrate`,
  `/orchestrate/stream`, `/legal-chat/send`, `/completions` do not import
  `nv-credit-cap-observe`. Pinned by import-graph *and* behaviour in
  `tests/unit/nv-credit-observe-scope.test.ts`, with a positive control so a broken
  grep cannot pass the negative assertions.

**Counting near-misses.** One `warn` per would-be refusal, marker
`NV-CREDIT-CAP-OBSERVE`, same marker in both modes so the count survives the flip:

```
docker logs nyv-gateway --since 24h \
  | grep NV-CREDIT-CAP-OBSERVE \
  | jq -c '{agentKey,tier,apiKeyId,limit,overBy}' \
  | sort | uniq -c | sort -rn
```

`overBy` is the field that tunes the budget: a cap that would have refused by 200
tokens is a budget slightly too small; one that would have refused by 4M is a runaway
caller, and a refusal count alone cannot tell them apart. It is expressed in the units
of the limit that tripped (`daily_tokens` / `daily_cost` / `hourly_requests`), because
summing token overage with request-count overage produces a meaningless number.

## 2. The cost dimension for the 13 non-token surfaces (NV-CREDIT-COST-DIM-001)

Re-derived from the call sites rather than taken from the table above. Drivers differ
per surface, so one unit does not fit all three families:

| # | Surface | Real cost driver | Metered | Measurable pre-spend |
|---|---|---|---|---|
| 1 | `POST /api/nv/gateway/documents/embeddings` | per 1k input tokens | micro-USD | yes |
| 2 | `POST /api/nv/sdk/docs-pipeline/documents/embeddings` | per 1k input tokens | micro-USD | yes |
| 3 | `POST /api/nv/phase4/vector/search` | per 1k input tokens (query embed) | micro-USD | yes |
| 4 | `POST /api/nv/phase4/vector/ingest` | per 1k input tokens | micro-USD | yes |
| 5 | `POST /api/nv/sdk/multimodal/voice/transcribe` | per audio second | micro-USD | yes (base64) / **no** (URL) |
| 6 | `POST /api/nv/sdk/multimodal/voice/stt` (alias) | per audio second | micro-USD | yes / **no** (URL) |
| 7 | `POST /api/nv/phase4/voice/transcribe` | per audio second | micro-USD | yes |
| 8 | `POST /api/nv/sdk/multimodal/voice/synthesize` | per character | micro-USD | yes |
| 9 | `POST /api/nv/sdk/multimodal/voice/voiceover/generate` | per character | micro-USD | yes |
| 10 | `POST /api/nv/phase4/voice/synthesize` | per character | micro-USD | yes |
| 11 | `POST /api/nv/phase4/vision/analyze` | per image (off-ring gpt-4o) | micro-USD | yes |
| 12 | `POST /api/nv/phase4/vision/ocr` | per image | micro-USD | yes |
| 13 | `POST /api/nv/phase4/vision/classify` | per image | micro-USD | yes |

`POST /api/nv/sdk/multimodal/vision/analyze` was in the original `aux` count but is
**not** in this list: it runs through `executeWithFullSafetyRing` → `orchestrateLLM`,
so its tokens do reach the accumulator and tokens are the honest unit for it. It is
capped on tokens instead. That is a correction to this audit's classification, made by
reading the call chain.

**Denomination: integer micro-USD.** `cost_usd NUMERIC(10,6)` already exists on
`ai_credit_usage`, so micro-USD is the resolution the platform already persists — the
money dimension is literally the number the recorder writes, read back as an integer
for exact arithmetic. A synthetic token conversion was rejected because that factor
would have silently become the pricing policy for three product lines.

**No migration.** Additive on an existing column; each tier's money budget is
*derived* from its `TIER_BUDGETS` token budget at a blended rate, so it is one policy
in two units. `guardrail:schema-drift` untouched (37 migrations, clean).

**Unmeasurable is reported as unmeasurable.** OCR page count (only known after
rendering) and URL-hosted audio duration (nothing fetched yet) return
`measurable: false` at zero cost. A fabricated estimate that refuses a lawful request
is worse than no estimate, and the recorder still captures the true cost so the *next*
request is metered against measured spend.

## 3. Two defects in this audit's own work, found by execution

- **The recorder discarded every cost-only paid call.** `recordRequestAiCredit`
  returned early on `tokensUsed <= 0`, so an embedding batch or a transcription wrote
  no row. The cost budget would have read a counter nothing writes — headline #2 of
  this audit, in a new unit. Now a row is written when either dimension moved.
- **No aux service reported into the accumulator at all**, so `costUsd` for those
  surfaces was 0 regardless. Established by grep-with-exit-code (`exit=1`, no
  matches) across the STT, TTS and embedding modules, not assumed. `recordAuxSpend()`
  wired at the three real funnels.

Also found, and deliberately not changed in place:
`defaultEmbeddingConfig.providers.openai.costPerToken` applies $0.00002 **per token**
where the list price is per **1,000** tokens — a 1,000× over-price. The credit
dimension prices from its own per-1k table; the existing metrics series is left alone,
because changing a metric is a separate decision from getting a budget right.

## 4. Mutation results — 18 mutations, zero green survivors

Harness: `scripts/_nv-credit-observe-mutations.sh` (positive control asserted PASS
before any mutation; each mutation reverted from a per-file backup, no git commands).

| # | Mutation | Result |
|---|---|---|
| 1 | observe default flipped to `enforce` | RED |
| 2 | observe mode refuses anyway (admit branch removed) | RED |
| 3 | near-miss line not logged | RED |
| 4 | `overBy` dropped from the log line | RED |
| 5 | key/app identity dropped from the log line | RED |
| 6 | `NYV_CREDIT_ENFORCE=0` no longer wins | RED |
| 7 | enforce flag ignored (refusals unturnable-on) | RED |
| 8 | recorder gated by observe mode | RED |
| 9 | recorder drops cost-only spend again | RED |
| 10 | cost budget never checked | RED |
| 11 | `limit` discriminator collapsed to one value | RED |
| 12 | OCR fabricates a page estimate | RED |
| 13 | remote audio priced as if measured | RED |
| 14 | embeddings priced per token instead of per 1k | RED |
| 15 | a cost-metered route also charges the token budget | RED |
| 16 | `recordAuxSpend` invents token counts | RED |
| 17 | `recordAuxSpend` does not count as a call | RED |
| 18 | observe mode leaks into the enforcer (would downgrade all four enforced surfaces) | RED |

## 5. Gate numbers

| Gate | Before this follow-up | After | Verdict |
|---|---|---|---|
| `vitest run tests/unit` | 1497 passed / 3 skipped / **0 failed** / 104 files | 1531 passed / 3 skipped / **0 failed** / 107 files | held (+34) |
| `npm run guardrail` | exit 0, 17 gates | **exit 0, 17 gates** | held |
| `guardrail:server-types` | 25 errors / 19 signatures | 25 / 19 | held, not refreshed |
| `guardrail:client-types` | 134 signatures | 134 | held |
| `guardrail:no-placeholder` | debt 75 | debt 75 | held |
| `guardrail:schema-drift` | 37 migrations clean | 37 clean, 222 exports, no drift | held (no migration added) |
| `guardrail:no-new-orphans` | 0 / budget 0 (wired 519/526) | **0 / budget 0** (wired 521/528) | held |
| `guardrail:orch-stage` | PASS (6 checks) | PASS (6 checks) | held |

No deploy, no commit, no live probe.
