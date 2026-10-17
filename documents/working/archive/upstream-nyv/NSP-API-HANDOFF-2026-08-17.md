# NSP API Handoff — Draft SLA + Quality envelope (2026-08-17)

> **Audience:** NSP / Nyayasiddhi Professional backend, BFF, and AI worker  
> **Live API:** `https://api.nyayasiddhi.online` (`NV_API_BASE_URL`)  
> **Auth:** `X-API-Key: <NYV_SDK_KEY_NSP>` · `X-NYV-Platform: nsp`  
> **Supersedes for drafting/orchestrate only:** [`NSP-API-HANDOFF-2026-08-12.md`](./NSP-API-HANDOFF-2026-08-12.md)  
> **Canonical:** [`Nyayavigya-platform-Integration-document-5.0.0.md`](./Nyayavigya-platform-Integration-document-5.0.0.md)  
> **Endpoint + timeout matrix for all AI tasks (NSP + NYM):** [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md)  
> **Evidence:** Job 297 (2026-08-17T05:37:32Z) HTTP 500 / 193 bytes `QUALITY_ENVELOPE_FAILED` `missing:["cot"]` on this host. Control: same stack `drafting-specialist` HTTP 200 at 05:44:52Z.

This is the **only new contract NSP needs to apply** from this change. No SDK version bump. No new endpoints. No new headers. The change is how NYV interprets `taskType` and how it treats a Queen CoT parse miss.

---

## 0. What broke (so the worker mapping is unambiguous)

| Item | Fact |
|---|---|
| Host Pro actually calls | `https://api.nyayasiddhi.online` (ALB → nysdev `:80`) — **not** a second cluster |
| Job 297 | `POST /api/nv/orchestrate` **500**, body **193 bytes** = `QUALITY_ENVELOPE_FAILED` / `missing:["cot"]` |
| Path | **Queen / swarm** (`requireCoT=true`, `partnerLean=false`). Leaves ran as `Q-001`. NSP’s `agentKey=drafting-specialist` was the *request*, not the execution agent |
| CoT | Capture **was attempted** and **threw** (`Expected ',' or ']' after array element in JSON`) at 05:35:59Z. Envelope then discarded a completed draft |
| Not this | Specialist “scaled CoT off too late”. Specialist already had that scale-off. Queen did not |
| Why a later probe can pass | CoT JSON parse is flaky; EMA can also flip Queen→specialist. **Do not treat a green probe as proof Job 297’s path is fixed** until this handoff is live |

NSP worker symptom: `[AI Worker] Job 297 failed` / UI `Draft generation timed out. Please retry.` / `Could not create`. The timeout is the worker waiting on Queen (~3.5 min) then receiving a 500, not an NYV-side idle timeout.

---

## 1. Apply this `taskType` table (the actual API change)

NYV now honours an explicit **`-fast` suffix** as a latency contract. Bare names still get full Queen + CoT.

| NSP surface | `taskType` to send | Path | CoT | RAG + citation + hallucination | Typical SLA |
|---|---|---|---|---|---|
| Describe & Generate / Written Statement / sync draft | `legal-draft-fast` | specialist (lean) | **off** | **on** | ~15–45 s (was Queen 3–5+ min → 500) |
| Legal Chat quick turn | `legal-chat-fast` | specialist (lean) | **off** | **on** | ~15–45 s |
| Doc draft quick | `doc-draft-fast` | specialist (lean) | **off** | **on** | ~15–45 s |
| Full counsel draft (no time budget) | `legal-draft` / `drafting` / `document-drafting` | Queen when earned | **on** | **on** | 60–600 s; worker timeout **must** be ≥ 600 s |
| Research / analysis | `legal_research` / `analysis` | Queen when earned | **on** | **on** | 60–600 s |
| Hub web search / workflow suggest | `web-search` / `workflow-suggest` | specialist SERP | off | RAG off (live search) | ~15–60 s |

Aliases accepted: kebab or snake (`legal-draft-fast` = `legal_draft_fast`).

**Do not send `legal-draft-fast` and then also `enableCoT: true`.** An explicit `enableCoT: true` still turns CoT on. The SLA is “we skip CoT unless you ask for it”.

**Do not send `partnerSyncLean: true` on full counsel work** expecting it to win — for NSP it is ignored unless `NYV_ALLOW_NSP_NYM_LEAN=1` (ops only). The supported lean switch for drafts is the `-fast` `taskType`, not the lean header.

**`-deep` is the opposite of `-fast`:** `legal-draft-deep` / `doc-draft-deep` stay Queen. Do not use `-fast` and `-deep` on the same job.

### Worker mapping (copy)

```ts
// Sync UI (Written Statement, Describe & Generate, “create case” draft)
taskType: 'legal-draft-fast'
timeoutMs: 90_000          // worker-side; NYV will not run Queen+CoT
enableCoT: undefined       // omit — do not send true
agentKey: 'drafting-specialist'  // hint only; -fast does not run Queen

// Deep counsel (user opted into long generation)
taskType: 'legal-draft'    // or document-drafting
timeoutMs: 600_000
```

### Orchestrate body (fast draft)

```http
POST /api/nv/orchestrate HTTP/1.1
Host: api.nyayasiddhi.online
X-API-Key: <NYV_SDK_KEY_NSP>
X-NYV-Platform: nsp
X-NYV-Consent: granted
Content-Type: application/json
```

```json
{
  "prompt": "Draft a Written Statement in a civil suit for recovery of money.",
  "taskType": "legal-draft-fast",
  "jurisdiction": "IN",
  "agentKey": "drafting-specialist"
}
```

Expected: HTTP **200**, `routing.path` = `specialist` (or `doc-pipeline`), `qualityEnvelope.ok` = true, CoT **not** required. Safety gates (RAG / citation / hallucination) stay on.

### Orchestrate body (full counsel — unchanged)

```json
{
  "prompt": "Draft a Written Statement …",
  "taskType": "legal-draft",
  "jurisdiction": "IN",
  "agentKey": "drafting-specialist"
}
```

Expected: Queen when the request earns it. Worker timeout **600s**. HTTP 200 even if CoT JSON fails to parse (see §2).

---

## 2. Quality envelope — what NSP should change in error handling

### Before (Job 297)

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "NYV-QUALITY-ENVELOPE-001: mandatory steps missing: cot",
    "details": {
      "code": "QUALITY_ENVELOPE_FAILED",
      "missing": ["cot"]
    }
  }
}
```

HTTP **500**, **193 bytes**. Treat as **retryable only on `-fast` after this release** (the request should not 500 on cot). On full Queen, a remaining `QUALITY_ENVELOPE_FAILED` with other missing steps (`hallucination`, `citation`, `llm_route_budget`) is still a real failure — **do not retry those blindly**.

### After this release

| Situation | HTTP | NSP action |
|---|---|---|
| `-fast` draft | 200 | Render `data.content`. No CoT field expected |
| Full Queen, CoT JSON failed, answer produced | **200** (new) | Render `data.content`. `qualityEnvelope.scaledOptional` may include `cot`. **Not an error** |
| Full Queen, CoT never invoked (wiring) | 500 `missing:["cot"]` | File to NYV — this is the collective-path class, should be rare |
| Empty body / 5xx other | existing | Existing worker retry |

Do **not** map `QUALITY_ENVELOPE_FAILED` + `missing:["cot"]` to the user string `Draft generation timed out` any more on `-fast`. If it still appears after this deploy, the worker is not sending `legal-draft-fast`.

---

## 3. Case create (`Could not create`)

NYV does not own NSP case persistence. If case-create calls orchestrate for an opening draft:

1. Use `taskType: "legal-draft-fast"` for the AI step.
2. Treat AI failure as **non-blocking** for the case row (create the case, show draft-retry). A 500 from NYV must not roll back matter creation.
3. Keep case-create’s own DB/validation errors separate — those are NSP, not this envelope.

---

## 4. What NSP does **not** need to do

- No SDK upgrade (`@nyayavigya/client-sdk@5.0.10` still valid).
- No new env vars on the NSP worker.
- Do not set `NYV_NSP_COUNSEL_QUEEN=0` (ops escape). `-fast` is the supported switch.
- Do not disable RAG / citation / hallucination on `-fast` — NYV keeps them on.
- Do not call NYS (`nyayasearch`) directly for this flow.

---

## 5. Smoke (from the NSP worker host, using Pro’s env)

```bash
# 1. Identity — must be this host
echo "$NV_API_BASE_URL"
# expect: https://api.nyayasiddhi.online

# 2. Fast draft — must not 500 on cot; should return in < 90s
curl -sS -m 90 -w "\nhttp=%{http_code} time=%{time_total}\n" \
  -H "X-API-Key: $NYV_SDK_KEY_NSP" \
  -H "X-NYV-Platform: nsp" \
  -H "X-NYV-Consent: granted" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Draft a short Written Statement for recovery of money.","taskType":"legal-draft-fast","jurisdiction":"IN"}' \
  "$NV_API_BASE_URL/api/nv/orchestrate" | head -c 400

# 3. Fail closed on the old bug — body must NOT contain QUALITY_ENVELOPE_FAILED
```

Pass: HTTP 200, path specialist, no `QUALITY_ENVELOPE_FAILED`.

---

## 6. Frontend / BFF calling contract (completion-driven)

NYV no longer waits for optional stages (hung memory, extra CoT) after the answer exists. **NSP must stop treating HTTP abort as draft failure.**

### Classify every button

| UI | Call | Client timeout | Success UI |
|---|---|---|---|
| AI Assist / propose / Describe & Generate | `POST /api/nv/orchestrate` `{ taskType: "legal-draft-fast" }` | **90_000** | Stream or wait; render `data.content` |
| Full pleading / regenerate | Same host, `{ taskType: "legal-draft" }` from **worker** | Worker **600_000** | `202` + `jobId` + poll; never hold the browser 55s |
| Due diligence / large files | `nyv.ecosystemDocuments.createJob` then Matter Vault playbook | Job poll | Finding list fills in |

**Do not** call `POST /api/nv/gateway/documents/draft` for Assist — that path hardcodes `document-drafting` + `enableCoT: true` (Queen).

**Do not** use `NyvClient` default `timeout: 30_000` on orchestrate. Set:

```ts
const nyv = new NyvClient({
  apiKey,
  baseUrl: 'https://api.nyayasiddhi.online',
  timeout: 90_000,                 // non-orchestrate
  orchestrateTimeoutMs: 600_000,   // full counsel only
});
```

Assist should use `nyv.orchestrate({ ..., taskType: 'legal-draft-fast' })` with a **90s** AbortSignal, not the 600s counsel timeout and not 55s.

### Error mapping

| Condition | Map to |
|---|---|
| Job still `generating` / `enriching` / `ready` / `degraded` | **Not** `DRAFT_AI_TIMEOUT`. Show progress or the answer |
| `optionalDegraded: true` + content present | Success with a quiet “grounding still catching up” if you want; **not** a 502 |
| Abort / 55s while NYV job running | Keep polling the same `Idempotency-Key` / job id. Do **not** create a second Queen job |
| `failed_infra` or empty content after worker 600s | Then `DRAFT_AI_TIMEOUT` / retry |

Send `Idempotency-Key: <draftId>:<action>:<attemptBucket>` on create so a double-click does not double Queen spend.

`requestPhase` on the Queen metadata (when present): `accepted → grounding → generating → enriching → ready | degraded | failed_infra`. Browser hangup does not cancel NYV work; only an explicit cancel API should.

---

## 7. Links

| Doc | Use |
|---|---|
| [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md) | **Endpoint + timeout + tracking matrix for every AI task (NSP + NYM)** |
| [`Nyayavigya-platform-Integration-document-5.0.0.md`](./Nyayavigya-platform-Integration-document-5.0.0.md) | Full API/SDK |
| [`NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md`](./NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md) | Request/response recipes |
| [`NSP-INTEGRATION-CHEATSHEET-2026-06.md`](./NSP-INTEGRATION-CHEATSHEET-2026-06.md) | 2-page cheat sheet |
| [`NSP-API-HANDOFF-2026-08-12.md`](./NSP-API-HANDOFF-2026-08-12.md) | Patra / CNR / trust fields (still current) |
