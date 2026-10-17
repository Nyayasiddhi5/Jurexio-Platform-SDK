# NSP / NYM — session, identity and request tracking (2026-08-17)

> **Answers:** "do we get the sessionId from NSP, or do we need a change at NSP?" and "is JWT/session enabled for every request?"
> **Live:** `https://api.nyayasiddhi.online` · deploys `2026-08-17T1114Z` / `1204Z-aws-ssm`
> **Read with:** [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md) · [`NYV-NSP-WAVE-B-RESPONSE-2026-08-17.md`](./NYV-NSP-WAVE-B-RESPONSE-2026-08-17.md)

## 1. Short answer

**No — we do not currently receive any per-user identity from NSP, and one small
NSP change is needed.** Send **one header** on every AI request:

```http
X-Customer-User-Id: <the NSP end-user / advocate id>
```

That is the whole ask. Optionally also `X-Customer-User-Email`.

**Why it matters more than tracking:** without it, every NSP end-user looked like
the *same* caller to us, because the identity we resolve falls back to the
application, not the person. Details in §3 — this was a confidentiality issue, and
it is now fixed on our side, but the header is what restores multi-turn continuity.

## 2. What is actually authenticated today (correcting an assumption)

There is **no JWT and no server-side login session** on partner traffic. That is by
design, not a gap:

| Caller | Auth | What NYV knows about the human |
|---|---|---|
| NSP / NYM (SDK key) | `X-API-Key` → application + organization | **Nothing**, unless `x-customer-user-id` is sent |
| NYV Console (admin / SME) | JWT (`authenticateToken`) | the NYV user |

So a partner API key authenticates **the platform**, never the advocate behind the
request. JWT exists only for Console routes (`/api/nv/legal-chat/*` etc.), which
partner keys cannot use. Anything we know about an end user must arrive in a header.

Identity resolution, in order:

```
userId = sdkContext.customerUserId          // from x-customer-user-id
       || `sdk:<appName>`                   // fallback — the APPLICATION
```

Live logs currently show the fallback: `userId: "sdk:Nyayasiddhi Professional™"`.

## 3. The defect this exposed, and what we changed

When a caller omits `sessionId`, we auto-mint one so multi-turn continuity works:
`hash(platform | org | userId | day)`.

With `userId` falling back to the application, that hash was **identical for every
NSP end-user for the whole day** — one shared session, and session memory is
written under it.

**Measured live before the fix:** two NSP requests with no `x-customer-user-id`
both received `nv-sess-nsp-9ae2cc89bab6bce7`, and the model itself replied:

> "The retrieved memory context in this session appears to belong to a different
> matter/client thread and is not properly scoped to your current query — I will not
> cross-reference or disclose…"

So cross-matter context reached the prompt and only the model's refusal prevented
disclosure. **Model discretion is not an access-control boundary**, least of all on
privileged material.

**Fixed and deployed (`2026-08-17T1204Z-aws-ssm`).** When we cannot identify an end
user we now mint a **per-request** session id and log an ops warning. Re-probed
live: the no-header call now returns `nv-sess-nsp-req-f227b38a946cfd95` and the
model reports **no prior matter in context**.

**The trade-off, stated plainly:** those callers lose cross-call continuity. We
chose that deliberately — continuity is a feature, cross-matter bleed is a breach.
Sending the header gets the continuity back.

## 4. What to send, per surface

| Situation | Send | Result |
|---|---|---|
| Any AI request | `X-Customer-User-Id: <advocate id>` | per-user isolation + stable per-day session |
| Continuing a specific matter thread | `sessionId` from the previous response | exact thread continuity, memory reused |
| A brand-new thread for the same user | omit `sessionId` (keep the header) | fresh thread, still user-isolated |
| One-off with no continuity wanted | omit both | per-request session, no memory carry-over |

**Precedence:** an explicit `sessionId` in the body always wins. We never
second-guess a partner that manages its own threads.

```http
POST /api/nv/orchestrate
X-API-Key: <NYV_SDK_KEY_NSP>
X-NYV-Platform: nsp
X-Customer-User-Id: adv-9931          ← the one addition
X-Request-Id: <your uuid>             ← optional, echoed back
Content-Type: application/json

{ "prompt": "...", "taskType": "legal-draft-fast", "jurisdiction": "IN",
  "sessionId": "nv-sess-nsp-f0e15c7b72bdf888" }
```

## 5. The three ids, and which to use for what

| Id | Scope | Use it for |
|---|---|---|
| `requestId` | one HTTP call | log join; also in the `x-request-id` response header. **Quote this when reporting a failure** |
| `orchestrationId` | one Queen run, survives retries | correlating a multi-leaf run across a retry or poll |
| `sessionId` | a conversation thread | continuity + memory. **Persist and echo it** |

All three are in every response. `requestPhase` tells you where the request is;
`ready` and `degraded` are both success.

## 6. Verified behaviour (so you can assert it in your own tests)

| Check | Result |
|---|---|
| Two calls, no `x-customer-user-id` | distinct per-request sessions, **no** shared memory |
| Two calls, different `x-customer-user-id` | distinct stable sessions (`…f0e15c7b…` vs `…cadf1c7c…`) |
| Same `x-customer-user-id`, same day | same session id — continuity works |
| Turn 2 with turn 1's `sessionId` | recalled the invoice number and client **without restating them**, 5.2 s |
| Explicit `sessionId` supplied | honoured verbatim |

## 7. Action list

**NSP / NYM (one change):** add `X-Customer-User-Id` to the outbound headers of
every AI call, then persist `sessionId` per matter thread and echo it. Optionally
send `X-Request-Id` so your logs and ours share a key.

**NYV (done):** session id echoed on every response; pooling closed; enum, phase,
`orchestrationId` published in OpenAPI.

**Note on what the header is *not*:** it is an identity label for scoping and
audit, not a credential. We do not authenticate it — your API key remains the
trust boundary — so do not treat it as authorisation for anything.
