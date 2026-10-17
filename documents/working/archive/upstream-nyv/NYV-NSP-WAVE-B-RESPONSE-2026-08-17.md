# NYV → NSP: response to the Wave-B asks (2026-08-17)

> **From:** Nyayavigya platform (NYV) · **To:** NSP engineering
> **Live API:** `https://api.nyayasiddhi.online` · **Spec:** `GET /api/nv/openapi.json`
> **Deploys behind this:** `2026-08-17T1015Z`, `1054Z`, `1114Z`, `1130Z` (all `-aws-ssm`, nysdev)
> **Endpoint matrix:** [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md)

Four asks, all answered below. Three are shipped and verified live; one is a
correction with evidence, because the 502 is not where it looks like it is.

---

## 1. "Stabilize orchestrate 502s" — this is not NYV's handler

**`/api/nv/orchestrate` cannot return 502.** On provider failure it returns
**503** `AI_SERVICE_UNAVAILABLE`, and it enqueues a durable background retry
(`NV-ORCH-RETRY-001`) before answering. There is no 502 in that path.

Measured on the host over a 6-hour window covering your task-387 failure:

| Signal | Value |
|---|---|
| `AI_SERVICE_UNAVAILABLE` (our 503) | **0** |
| `all providers failed` / cascade exhausted | **0** |
| Gateway restarts / OOM-kills | **0** / `false` |
| Gateway memory | 505 MiB of 2 GiB (25 %) |
| nginx container on the host | **none** |

So the 502 is being manufactured **above** the gateway. The two candidates, in
order of likelihood:

1. **ALB idle timeout.** A 502/504 at the load balancer is what a client sees when
   the ALB gives up on an in-flight upstream response. This is the classic shape
   for a long counsel job on a durable worker.
2. **The NSP worker's own HTTP client** surfacing a socket close as 502 after its
   retry.

**What we need from you to close it:** the `requestId` (or `orchestrationId`) of
task 387, plus the timestamp. With that we can join your failure to our exact
request row and say definitively which hop cut it — we cannot do that from
"upstream HTTP 502" alone. Checking ALB access logs is an infra step we will run
once we have the id.

**Meanwhile, one thing on your side matters more than the 502 itself:** a
disconnect must not be retried into a second Queen job. See §3.

---

## 2. Wave A state enum — published in OpenAPI

**Done, and live now** at `GET /api/nv/openapi.json`:

```
components.schemas.RequestPhase.enum =
  ["accepted","grounding","generating","enriching","ready","degraded","failed_infra"]
```

`components.schemas.OrchestrateOutcome` is referenced from the **200** response of
all three orchestrate operations (`/api/nv/orchestrate`,
`/api/nv/orchestration/orchestrate`, `/api/nv/agents/orchestrate`), with
`requestPhase` in `required` alongside `content` and `requestId`.

**We also have a correction to make here, in your favour.** You said NSP is
already forward-compatible on this enum. When we deployed Wave A and probed it,
`requestPhase` was **absent from the payload entirely** — produced on our Queen
metadata and then dropped at the response seam. So had you branched on it, you
would have read `undefined` on every single answer. That is fixed in the same
deploy set: it is now emitted on **every** path (specialist and Queen), and there
is a regression test asserting our partner sanitizer cannot strip it again.

Two fields you should read alongside it:

| Field | Meaning |
|---|---|
| `requestPhase: "ready"` | complete |
| `requestPhase: "degraded"` + content | **complete — success.** An optional enrichment (extra CoT, a hung memory source) was dropped so the answer could progress |
| `optionalDegraded: true` | same signal, boolean form |
| `requestPhase: "failed_infra"` | genuinely no usable outcome |

`ready` and `degraded` are **both success**. Please do not surface `degraded` as
an error state.

---

## 3. Durable fan-in / disconnect ≠ fail under load

**True, and now structurally true rather than incidentally true** — with one
honest limit stated at the end.

What we changed so a leaf never waits once the useful answer is in:

| Was | Now |
|---|---|
| Memory fan-in `allSettled`-waited for a hung source after a sibling had returned | Proceeds on first useful items, aborts the hangers |
| Every leaf re-ran memory that Step-0 had already recalled | `skipMemory` after Step-0 (mirrors existing `skipRag`) |
| A timed-out capability was **retried twice more**, each retry certain to hit the same 30 s wall (3 × 30 s = the 90 s/leg constant) | Timeout is not retryable |
| CoT blocked the HTTP response after the text existed; could run twice on swarm | Overlaps synthesis, never awaited twice, skipped if the wall cannot fit it |
| Post-answer hallucination + citation ran serially on 30 s breakers | Run in parallel; fail-open to `degraded` on `-fast`, still fail-closed on counsel |
| Step-0 always paid the **slower** of RAG and memory (20–35 s) before any leaf started | Releases on the first *useful* source |

**Measured live on the public host**, forced Queen swarm, same prompt shape:

| Metric | Before | After |
|---|---|---|
| Wall clock | **366.1 s** | **92.6 s**, then **68.2 s** |
| `recall budget exhausted` | 10 per request | **0** |
| 30 s capability timeouts | 5 per request | **0** |
| `missingMandatory` | — | `[]` |

**The honest limit:** this makes NYV stop *waiting*. It does not make a sync HTTP
request durable. For a 5-minute counsel job, hangup≠cancel still requires your
`ns_ai_task` 202+poll handoff — which you have built, and which is the right
design. Two rules on your side keep it correct under load:

1. **Never re-fire on disconnect.** Poll your own job row. A second call is a
   second Queen run and double spend, and it will produce a *different* draft.
2. **Use `orchestrationId` as the join key** (see §4), not `requestId`, when
   correlating across a retry.

Also worth knowing: we have not yet observed the Step-0 first-useful release line
in production traffic (`step0_first_useful=0` in the verification window). It is
deployed and unit-tested, but we are not going to claim it is measured until real
traffic trips it.

---

## 4. Stable `orchestrationId` — shipped

`orchestrationId` is now on every Queen response (`orch-<uuid>`). It was always
minted internally — we enforce it for span tags and the AG-UI lifecycle filter —
but it was only visible on `/orchestrate/stream`, so a sync caller had no stable
handle for a multi-leaf run. Now:

| Id | Scope | Use |
|---|---|---|
| `requestId` | one HTTP call | log join, `x-request-id` header |
| `orchestrationId` | the whole Queen run, survives retries | **the id to persist and quote to us** |

Absent on the specialist path by design — a single call has no fan-out to
correlate.

---

## 5. Not on your list, but you will want it: sessions were broken

While auditing your "same session" requirement we found that for NSP/NYM we were
**minting a session id, writing session memory under it, and never returning it**.
So every turn minted a fresh id and the memory written on turn 1 was unreachable
on turn 2 — multi-turn continuity was impossible even though the storage side
worked correctly. If Legal Chat answers ever felt like they had forgotten the
matter, this is why.

`sessionId` is now echoed on every orchestrate response. **Verified with a real
two-turn probe:** turn 1 stated a client name and invoice number; turn 2 replayed
the returned `sessionId` and asked which invoice was mentioned, **without
restating it** — and got `INV-88421` plus the client name back, in 5.2 s against
turn 1's 20.1 s.

**What to do:** persist `sessionId` from the response and send it on the next turn
of the same matter thread. If you send your own, we honour it.

---

## 6. Request lifecycle, end to end

What happens between your call and your response, with the tracking field emitted
at each step:

| Step | NYV stage | Emitted |
|---|---|---|
| 1 | Auth + platform resolve (`X-NYV-Platform`), India scope, DPDPA consent gate | `requestId` minted or taken from your `X-Request-Id` |
| 2 | `taskType` → SLA class; `-fast` pins the interactive budget | `routing.path` |
| 3 | Adaptive router: specialist vs Queen | `osDepth` (internal), `orchestrationId` if Queen |
| 4 | Step-0 grounding — NYS → RAG → memory, fused once, first-useful release | `requestPhase: grounding` |
| 5 | Generation — specialist, or Queen leaves with `skipRag`/`skipMemory` | `requestPhase: generating` |
| 6 | Synthesis + CoT overlap | `requestPhase: enriching` |
| 7 | Safety ring — hallucination + citation in parallel, then PII / consent / metering | `qualityEnvelope`, `riskBadge` |
| 8 | Session memory write under `sessionId` | `sessionId` echoed |
| 9 | Audit — IronLedger hash-chain entry + router decision row | `auditHash`, `cost.completions` |

Every one of those rows is queryable by `requestId`. On the audit side we also
fixed a defect that was destroying this trail: our router decision log had been
**frozen for ~38 minutes** because one permanently-invalid row was being retried
forever and blocking every later write (`request_id varchar(64)` vs our new
parent-scoped dispatch ids). Decision history now writes cleanly again, and an
unwritable row is dropped loudly instead of stalling the queue.

---

## 7. Summary

| Ask | Status |
|---|---|
| Stabilize orchestrate 502s | **Not our handler** — we return 503 + durable retry, never 502; 0 provider failures / 0 restarts in the window. **Send us task 387's `requestId` + timestamp** and we will pin the hop |
| Publish the state enum in OpenAPI | **Live** — and note `requestPhase` was previously missing from the payload entirely; now emitted on every path |
| Confirm disconnect ≠ fail under load | **Confirmed structurally**; 366 s → 68 s measured. Durable 202+poll on your side is still required for counsel-class work |
| Stable `orchestrationId` | **Live** on all Queen responses |
| *(new)* Session continuity | **Was broken, now fixed and proven** — echo `sessionId` to continue a thread |

No action needed from you beyond: read `requestPhase` (treat `degraded` as
success), persist `sessionId` and `orchestrationId`, never re-fire on disconnect,
and send us the task-387 id.
