# NYV → NSP: six-item verification (2026-08-17)

> **Live:** `https://api.nyayasiddhi.online` · deploy `2026-08-17T1347Z-aws-ssm` (sha `bec20126`)
> **Evidence:** SSM `8f0a90a3` (all six run against the live public host with your header shapes)
> **Read with:** [`NSP-NYM-SESSION-IDENTITY-CONTRACT-2026-08-17.md`](./NSP-NYM-SESSION-IDENTITY-CONTRACT-2026-08-17.md) · [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md)

| # | Ask | Status |
|---|---|---|
| 1 | Confirm real advocate ids | **Confirmed** — `nsp:o:3:u:315` |
| 2 | Confirm session contract | **Confirmed + fixed** — we were ignoring your header |
| 3 | Re-run the leak test | **NO LEAK** |
| 4 | Fix orchestrate 502s | **Not ours** — need task 387's `requestId` |
| 5 | analyzeDocument usable fields | **Fixed** — you were calling the endpoint I had not fixed |
| 6 | Publish state enum | **Live** |

---

## 1. Real advocate ids — confirmed, keep your namespacing

Gateway logs now show:

```
"userId":"nsp:o:3:u:315"
```

**Keep the namespaced form.** Do not switch to the bare numeric id. Two reasons:

- It is globally unique across orgs, so an id can never collide when we scope memory
  or audit rows. A bare `315` is only unique inside org 3, and it reaches us on a
  request where org is a *separate* header we would have to trust to disambiguate.
- It is self-describing in an audit trail. `nsp:o:3:u:315` tells an auditor the
  platform, org and user; `315` tells them nothing.

`:` was already legal in our identity charset, so nothing needed changing. The
`sdk:app:10` line you may also see is the application-level identity used for
rate-limiting and billing, which is a separate axis from the end user — expected.

## 2. Session contract — confirmed, and thank you for flagging it

**You found a real gap.** You were sending `X-Customer-Session-Id` and we read it
**nowhere** — only the body `sessionId` was consulted. So every turn you scoped
correctly was still handed a NYV-minted session. Fixed in this deploy.

Verified live: sending `X-Customer-Session-Id: nsp:o:3:u:315:t:77` returns
`sessionId: "nsp:o:3:u:315:t:77"` verbatim.

**Precedence, confirmed:**

```
body sessionId  →  X-Customer-Session-Id  →  NYV day-bucket mint
```

Your header beats the mint. The body still beats the header, because the body is a
specific per-call statement while the header is the request's ambient thread — if you
prefer the header to always win, say so and we will invert it.

**Memory scoping, confirmed:** memory is scoped to the session, and the session is
derived from `customerUserId` when you do not supply one. So with
`X-Customer-User-Id` present, advocate A and advocate B never share a memory scope —
which is what item 3 tests.

Applied identically on `/orchestrate` and `/orchestrate/stream`, so a streamed turn
and the next posted turn land in the same session.

## 3. Leak test — re-run, no leak

| Step | Advocate | Result |
|---|---|---|
| A | `nsp:o:3:u:315` | stated "client codename FALCON-9, settlement ceiling Rs 8.4 crore" |
| B | `nsp:o:3:u:902` | asked what codename and ceiling were mentioned |

- A session: `nv-sess-nsp-d97ba6b7ff2d3b57`
- B session: `nv-sess-nsp-8cc0f9d01b7d4ac9` — **different**
- B's answer: `UNKNOWN`
- **Verdict: no cross-advocate leak.**

**Worth telling you what this looked like before your change**, because it is the
reason we hardened it: with no `x-customer-user-id`, our identity fell back to the
application for *every* end user, so the day-bucket hash collapsed to **one session
shared by all your advocates** — and the model reported back that "the retrieved
memory context appears to belong to a different matter/client thread". Context was
crossing the boundary and only the model's refusal prevented disclosure. Your header
plus our per-request fallback closes it from both ends.

## 4. Orchestrate 502 — still not reproducible on our side

`/api/nv/orchestrate` **cannot** emit 502. On provider failure it returns **503**
`AI_SERVICE_UNAVAILABLE` and enqueues a durable retry first.

Measured over the window, live:

| Signal | Count |
|---|---|
| our 503 `AI_SERVICE_UNAVAILABLE` | **0** |
| cascade exhausted / all providers failed | **0** |
| literal ` 502 ` anywhere in gateway logs | **0** |
| gateway restarts / OOM | **0** / `false` |

There is also no nginx container on the host, so the 502 is being produced **above**
the gateway — ALB idle timeout, or your worker's HTTP client surfacing a socket close
as 502 after its retry.

**This is now blocked on one thing from you:** task 387's `requestId` (or
`orchestrationId`) and its timestamp. With that we join to our exact request row and
say definitively which hop cut it. Without it we would be guessing, and I would
rather tell you it is unresolved than close it on a guess.

## 5. analyzeDocument — you were calling the endpoint I had not fixed

`heuristicFallback: true` is your flag, and it was telling the truth. There are **two**
analyze endpoints on **two different handlers**, and my first fix only covered one:

| Path | Fixed at 1317Z? | Now |
|---|---|---|
| `/api/nv/gateway/documents/analyze` | yes | `fieldCount=17` |
| `/api/nv/sdk/docs-pipeline/documents/analyze` | **no** | `fieldCount=17` |
| `/api/nv/sdk/docs-pipeline/documents/intelligence` | **no** | `fieldCount=17` |

The second is registered in our code as *"NSP alias — some Pro clients call /analyze
instead of /intelligence"*, which is almost certainly the one your autofill hits. My
earlier "fixed" was true on a path you do not call. All three now return identical
extraction, verified live: `fieldSource=nyv`, `fieldCount=17`,
`detectedDocumentType=anticipatory_bail_petition`.

**What you get** (real values from a Telangana HC anticipatory-bail petition):

| field | value | source |
|---|---|---|
| `filing_number` | `Criminal Petition No. 4471 of 2025` | regex-rules |
| `case_type` / `case_year` | `Criminal Petition` / `2025` | regex-rules |
| `court` | `HIGH COURT OF JUDICATURE` | regex-rules |
| `fir_number` | `FIR No. 221 of 2025` | regex-rules |
| `police_station` | `Banjara Hills Police Station` | regex-rules |
| `judge` | `A. Rajashekar Reddy` | regex-rules |
| `next_hearing_date` | `28 March 2025` | regex-rules |
| `prayer` | first 400 chars of the prayer clause | regex-rules |
| `petitioner` / `respondent` / `respondent_2` | from the cause title | cause-title |
| `statutes_invoked` | `SECTION 482 OF THE BHARATIYA NAGARIK SURAKSHA SANHITA, 2023` | legal-ner |
| `amount_in_dispute` | `Rs 47,00,000` | legal-ner |
| `dates_mentioned` / `organisations` | all dates; `Meridian Textiles Pvt Ltd` | legal-ner |
| `document_type` | `anticipatory_bail_petition` | regex-rules |

**Badge on `fieldSource`:** `'nyv'` when we extracted anything, `'none'` when the
document yielded nothing. Every field carries `confidence` and `source` so you can
badge per field if you want.

Three things worth knowing:

- **Absent values are omitted, never blank.** If `fir_number` is missing, it is not in
  the document — you can distinguish that from a failed read.
- **`isIndianCourtDocument`** requires two independent signals, so a commercial
  contract that merely mentions a court is not mislabelled a filing.
- **Fields survive a degraded analysis.** Extraction is deterministic and does not
  need the model, so even if the LLM leg fails you still get the case number and
  parties rather than an empty entity set.

## 6. Wave A state enum — live

`GET /api/nv/openapi.json`:

```
components.schemas.RequestPhase.enum =
  ["accepted","grounding","generating","enriching","ready","degraded","failed_infra"]
components.schemas.OrchestrateOutcome.properties.data.required =
  ["content","requestPhase","requestId"]
```

Referenced from the 200 of all three orchestrate operations. `orchestrationId` and
`sessionId` are documented alongside. **`ready` and `degraded` are both success** —
`degraded` means the answer is complete and an optional enrichment was dropped to
progress.

---

## India-only, since you raised it

NSP and NYM are locked to `jurisdiction: IN` server-side. We closed the last two gaps
in this pass: the gateway and docs-pipeline routers were the only partner surfaces not
mounting the India scope, so an NSP key sending `jurisdiction: "US"` to
`documents/analyze` was previously answered under US law. Verified live: a US request
on an NSP key is now served **IN**.

## What we need from you

1. **Task 387's `requestId`/`orchestrationId` + timestamp** — the only open item.
2. Keep the namespaced advocate id.
3. Persist `sessionId` and `orchestrationId`; read `requestPhase` and treat `degraded`
   as success.
