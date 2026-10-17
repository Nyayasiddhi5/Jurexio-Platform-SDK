# 14 — Comprehensive API + SDK Integration Guide (final pre-publish) — 2026-05-13

> **Status: AUTHORITATIVE for ALL developers integrating Nyayavigya 5.0.1.**
> Supersedes `04-sdk-and-api-canonical-2026-05-07.md`,
> `04b-sdk-endpoint-probe-…`, `04c-sdk-troubleshooting-…`, and the older
> `13-api-and-sdk-2026-05-13.md` (the §10 numbers there were captured
> before the final re-run; see §1 below for the authoritative metrics).

This is the **one document** an NSP / NSPM / NSI / NSA / NSM / NYM / JRX
developer should need to integrate the platform end-to-end against
**Replit dev** OR **EC2 prod-dev** (`api.nyayasiddhi.online`). Every
endpoint family includes: request shape → response envelope → parsing
rules → error handling → copy-paste sample.

---

## 1. Final pre-publish status (2026-05-13)

| Metric | Value | Verdict |
|---|---|---|
| `scripts/nv-sdk-platform-e2e.mjs` | **138/140 PASS, 54/56 real-LLM PASS** | ✅ ready |
| LLM client-timeout failures | **0 / 140** | ✅ ready |
| Auth (X-API-Key + Bearer) failures | **0 / 140** | ✅ ready |
| `orgId` / tenancy / RLS failures | **0 / 140** | ✅ ready |
| Runtime exceptions / 5xx | **0 / 140** | ✅ ready |
| Rate-limit 429 blocks | **0 / 140** | ✅ ready |
| Real-LLM latency p50 / p95 / max | **13.5s / 50.8s / 96.9s** | ✅ within SLO |
| 17-step orchestrate pipeline (PII → guardrails → LLM cascade → audit) | verified end-to-end on every key incl. IronLedger hash chain | ✅ ready |
| Universal Chat → real LRM (task-257) | merged; auth + IDOR + types fixed | ✅ ready |
| Architect Deploy button (task-258) | merged; persistence + bus + role-gating | ✅ ready |
| DPDPA consent gate on PII routes (task-217) | merged; observation mode default | ✅ ready (flip enforce post-soak) |
| A2A + BMAD visualizer (task-170) | merged; live telemetry, not stubs | ✅ ready |
| Typed `/api/nv5/*` SDK wrappers (task-111) | `@nyayavigya/client-sdk@6.1.0`, smoke 6 OK / 7 FLAG_OFF / 1 DB-gap / 0 FAIL | ✅ ready |

**Residual delta (2 / 140):** intermittent `WARN_EMPTY_CONTENT` from
`sarvam-30b` on `/orchestrate` for two random platforms per run.
`sarvam-30b` is no longer in any cascade sequence (`SOLO_CHEAP` and
`INDIC_LEGAL` both stripped — see commit history). The model-tier-router
still selects it occasionally via a stale path; the gateway returns
**HTTP 200** with a valid envelope, only `data.content` is empty.
**This is not an SDK-contract regression and does not block publish.**
Tracked as a known model-tier defect; clients should treat empty
`data.content` as a soft retry per §11.

**Go/no-go for EC2 + Replit publish: ✅ GO** (subject to your explicit
"GO" per replit.md — this doc does not deploy).

---

## 2. Base URLs (single source of truth)

| Environment | Base URL | Notes |
|---|---|---|
| **EC2 prod-dev (API)**     | `https://api.nyayasiddhi.online`     | Public SDK gateway. **Only** API host. |
| **EC2 prod-dev (Console)** | `https://console.nyayasiddhi.online` | Console UI + Console API proxy. |
| **EC2 prod-dev (NYM web)** | `https://nym.nyayasiddhi.online`     | NYM citizen web app. Hits `api.*` for API calls. |
| **Replit dev (this repo)** | `https://$REPLIT_DEV_DOMAIN`         | Hot-reload gateway on port 5000. |
| **Bare apex / www**        | `https://nyayasiddhi.online`, `https://www.nyayasiddhi.online` | Marketing only. **No API.** |

**Per-product subdomains do NOT exist.** `gateway.`, `nsp.`, `nsi.`,
`nsa.`, `nsm.`, `jrx.`, `nspm.` do **not** resolve. All seven SDKs share
the single `api.nyayasiddhi.online` host and identify themselves via
their own `X-API-Key`.

---

## 3. Authentication (NV-AUTH-HEADER-001)

**Canonical header (all SDK calls):**

```
X-API-Key: <NYV_SDK_KEY_{NSP|NSPM|NSI|NSA|NSM|NYM|JRX}>
```

**Bearer fallback** (legacy clients):

```
Authorization: Bearer <NYV_SDK_KEY_…>
```

**Console-only (JWT):** `/api/nv/auth/*`, `/api/architect/*`,
`/api/nv/universal-chat/*`, all `/api/nv5/*` admin routes use
`Authorization: Bearer <jwt>` from the Console session. SDK callers
do NOT hit these.

CI guard `nv-check-auth-header.sh` blocks any new accepted header.

### 3.1 The seven SDK keys + scopes

| Code | Product | Audience | Scopes (live DB row) |
|------|---|---|---|
| **NSP**  | Nyayasiddhi Professional™        | Law firms       | `agents:read`, `agents:execute`, `documents:read`, `documents:write`, `research:read`, `usage:read` |
| **NSPM** | Nyayasiddhi Professional Mobile™ | Law-firm mobile | + `voice:read`, `voice:execute` |
| **NSI**  | Nyayasiddhi Institutional™       | Enterprise legal| `*` wildcard |
| **NSM**  | Nyayasiddhi Ministry™            | Government      | `*` wildcard |
| **NSA**  | Nyayasiddhi Academy™             | Education       | `agents:*`, `documents:read`, `research:read`, `translate:write`, `usage:read` (**no `documents:write`**) |
| **NYM**  | Nyayamitra™                      | Citizens        | `agents:*`, `documents:*`, `translate:write`, `consumer_intake:write`, `usage:read` (**no `research:read`**) |
| **JRX**  | JurisX™                          | Cross-juris     | `*` wildcard |

A **403 `Insufficient scope`** is always intentional. Pick a key whose
scopes match — do not "fix" the route.

---

## 4. Universal response envelope — parsing rules

Two envelope shapes coexist in the codebase. Your client MUST handle
both. Detect which one by checking for `success` first, then for the
inner `data` field:

### 4.1 Wrapped (`{ success, data }`) — the **canonical** shape

Used by: orchestrate, gateway/documents/*, gateway/research/*,
orchestration/*, doc-analyze/*, universal-chat, architect, sdk/*,
SSE end-event.

```json
{
  "success": true,
  "data": { /* payload */ },
  "request_id": "req_…",          // optional
  "timestamp": "2026-05-13T…Z"    // optional
}
```

### 4.2 Field-spread (`{ success, <field> }`) — legacy / domain-specific

Used by: `intelligence/sentiment` (`sentiment`), `summarize` (`summary`),
`classify` (`labels`), `ner` (`entities`), `doc-analyze/analyze`
(`analysis`), some governance reads.

```json
{
  "success": true,
  "summary": "…",            // or sentiment / labels / entities / analysis / etc.
  "model": "gemini-2.5-flash",
  "latencyMs": 14732
}
```

### 4.3 Universal parser (TypeScript)

```ts
type Env<T> = { success: true; data?: T; [k: string]: unknown }
            | { success: false; error: string; code?: string; details?: unknown };

function parse<T>(env: Env<T>, primaryField?: string): T {
  if (!env.success) {
    const err = new Error((env as any).error || 'request failed');
    (err as any).code = (env as any).code;
    (err as any).details = (env as any).details;
    throw err;
  }
  if ('data' in env && env.data !== undefined) return env.data as T;
  if (primaryField && primaryField in env)    return env[primaryField] as T;
  return env as unknown as T;            // fallback: hand back the whole envelope
}
```

### 4.4 Error envelope (always)

```json
{
  "success": false,
  "error": "Insufficient scope. Required: documents:write",
  "code": "INSUFFICIENT_SCOPE",          // present on tagged failures
  "details": { /* optional */ },
  "request_id": "req_…"
}
```

**Status codes are normative — see §11.**

---

## 5. Endpoint families

> 📌 **Versioning rule (NV-API-CONTRACT-001):** `/api/nv/*` is the
> **stable contract** (frozen by CI; additions allowed, removals fail
> CI). `/api/nv5/*` is **internal/admin** behind feature flags — only
> Console JWT or the typed `@nyayavigya/client-sdk@6.1.0` namespaces
> (`.orch / .workflows / .docAi / .gov / .legalPipeline / .complianceNv5
> / .internal`) should call it. Do NOT cURL `/api/nv5/*` from a
> third-party SDK without coordination.

### 5.1 Public health (no auth)

| Method | Path | Response |
|---|---|---|
| GET | `/health`              | `{ ok: true }` |
| GET | `/api/nv/health`       | `{ ok: true, version: "5.0.1" }` |
| GET | `/api/nv/health/full`  | 200 OR 503 with per-dependency breakdown |
| GET | `/api/nv/voice/info`   | `{ success, data: { provider, languages: [...] } }` |

### 5.2 Catalog (any valid SDK key)

| Method | Path | Wrapped? | Returns |
|---|---|---|---|
| GET | `/api/nv/gateway/health`                  | `{success}` | per-key health |
| GET | `/api/nv/gateway/info`                    | `{success, data: {key,tier,scopes,…}}` | echo (also Bearer-fallback test) |
| GET | `/api/nv/gateway/agents`                  | `{success, data: [...]}` | 1,042-agent registry |
| GET | `/api/nv/gateway/agents/registry-version` | `{success, data: {version, checksum}}` | |
| GET | `/api/nv/gateway/models`                  | `{success, data: [...]}` | active LLM catalogue |
| GET | `/api/nv/gateway/practice-areas`          | `{success, data: [...]}` | per jurisdiction |
| GET | `/api/nv/gateway/translate/languages`     | `{success, data: [...]}` | Sarvam-supported |

### 5.3 Real-LLM intelligence (POST, X-API-Key)

All five share the **field-spread** envelope (§4.2).

| Path | Request body | Response (field-spread) |
|---|---|---|
| `/api/nv/intelligence/sentiment` | `{ text }` | `{ success, sentiment: "positive"\|"neutral"\|"negative", confidence, model, latencyMs }` |
| `/api/nv/intelligence/summarize` | `{ text, maxTokens?: 200 }` | `{ success, summary, model, latencyMs }` |
| `/api/nv/intelligence/classify`  | `{ text, categories: string[] }` | `{ success, labels: [{label, score}], model, latencyMs }` |
| `/api/nv/intelligence/ner`       | `{ text }` | `{ success, entities: [{text, type, start, end}], model, latencyMs }` |
| GET `/api/nv/intelligence/compliance-calendar` | — | `{ success, events: [...] }` |
| GET `/api/nv/intelligence/regulatory-feed`     | — | `{ success, items: [...] }` |

**Parsing:** `const summary = res.summary;` (do not look for `res.data.summary`).

### 5.4 SDK Document AI — `/api/nv/gateway/documents/*` (wrapped envelope)

| Path | Request body | `data.*` fields |
|---|---|---|
| POST `/summarize`        | `{ content, source, documentType?, detailLevel?, focusAreas?, maxWords? }` | `summary`, `key_points[]`, `latencyMs` |
| POST `/analyze`          | `{ content, source, type, jurisdiction }` | `entities[]`, `risks[]`, `citations[]`, `recommendations[]`, `latencyMs` |
| POST `/extract-entities` | `{ content }` | `entities[]`, `latencyMs` |
| POST `/classify-clauses` | `{ content }` | `clauses[]`, `latencyMs` |
| POST `/compare`          | `{ document1, document2 }` | `differences[]`, `similarities[]`, `latencyMs` |
| POST `/qa`               | `{ document, question }` | `answer`, `citations[]`, `latencyMs` |

### 5.5 SDK Document Pipeline — `/api/nv/sdk/docs-pipeline/*`

`documents:read` scope. Wrapped envelope. Now gated by DPDPA consent
(`ai_processing` purpose, observation mode default).

| Path | Body | `data.*` |
|---|---|---|
| POST `/documents/parse`           | `{ content, format, jurisdiction }` | `text`, `metadata` |
| POST `/documents/intelligence`    | `{ content, jurisdiction, type }`   | `entities`, `risks`, `clauses`, `summary` |
| POST `/documents/embeddings`      | `{ texts: string[] }` | `vectors: number[][]`, `model`, `dim` |
| POST `/documents/compare`         | `{ document1, document2 }` | `differences`, `similarities` |
| POST `/documents/summarize`       | `{ documentText, length: "short"\|"medium"\|"long" }` | `summary` |
| GET  `/clauses/library`           | — | `clauses[]` |
| GET  `/documents/templates`       | — | `templates[]` |

### 5.6 Document orchestrator (upload → OCR → embed → search)

Path prefix: `/api/nv/documents/*`. Wrapped envelope. The full
upload-to-search pipeline. **All routes are DPDPA-gated**
(`document_storage` on upload, `ai_processing` on search).

| Path | Body | `data.*` |
|---|---|---|
| POST `/upload`         | `multipart/form-data file` (up to 50 MB) | `docId`, `jobId`, `statusUrl` |
| GET  `/:docId/status`  | — | `status: "queued"\|"ocr"\|"chunking"\|"embedding"\|"ready"\|"failed"`, `progress: 0-100`, `error?` |
| POST `/search`         | `{ query, docIds?, enableGraphRAG?, topK? }` | `results: [{docId, chunk, score, citations[]}]` |

**OCR result parsing.** When `status === "ready"`, fetch
`/api/nv/documents/:docId` to get the extracted text, page count, and
detected entities. The pipeline writes:

```json
{
  "success": true,
  "data": {
    "docId": "doc_…",
    "fileName": "contract.pdf",
    "pageCount": 12,
    "extractedText": "…",
    "ocrConfidence": 0.94,
    "entities": [{ "type": "PERSON", "text": "…", "page": 3 }],
    "chunks": [{ "id": "ch_…", "text": "…", "page": 1 }],
    "embedding": { "model": "text-embedding-3-large", "dim": 3072 },
    "ready": true
  }
}
```

### 5.7 Doc-analyze (legal checklist + risk) — `/api/nv/doc-analyze/*`

Mixed envelope — note the field-spread on `/analyze`.

| Path | Body | Response |
|---|---|---|
| POST `/extract`             | `{ fileBase64, fileName }`         | `{ success, data: { text, pageCount } }` |
| POST `/analyze`             | `{ text, options? }`               | `{ success, analysis: { checklist, risks, redFlags } }` ← spread |
| POST `/extract-and-analyze` | `{ fileBase64, fileName, options }`| `{ success, data: { extraction, analysis } }` |
| GET  `/checklist`           | —                                  | `{ success, checklist, total }` |
| GET  `/stats`               | —                                  | `{ success, stats }` |

### 5.8 Research — `/api/nv/gateway/research/query`

`research:read` scope (NYM is **403 by design** — citizens go through
consumer-intake).

```http
POST /api/nv/gateway/research/query
{ "query": "remedies for breach of software contract under ICA?", "jurisdiction": "IN" }
```

```json
{
  "success": true,
  "data": {
    "answer": "…",
    "citations": [{"id":"ICA-1872-s73", "snippet":"…", "url":"…"}],
    "statutes": [{"id":"…","title":"…","jurisdiction":"IN"}],
    "cases":    [{"id":"…","title":"…","year":1996,"jurisdiction":"IN"}],
    "model": "gemini-2.5-flash",
    "latencyMs": 12340
  }
}
```

### 5.9 Translate — `/api/nv/gateway/translate`

```http
POST /api/nv/gateway/translate
{ "text": "Hello", "sourceLang": "en", "targetLang": "hi" }
```

```json
{ "success": true, "data": { "translated": "नमस्ते", "model": "sarvam-translate", "latencyMs": 612 } }
```

### 5.10 Orchestrate — full 17-step safety-ring pipeline

The single entry point that exercises **PII redact → DPDPA consent
gate → guardrails (prompt) → agent select → LLM cascade (12 levels) →
guardrails (response) → hallucination + citation + bias → audit hash
chain → IronLedger ledger row**.

```http
POST /api/nv/orchestrate
X-API-Key: <NYV_SDK_KEY_NSP>
Content-Type: application/json

{
  "prompt": "Summarize this contract dispute in 2 sentences: …",
  "agentKey": "summarizer",
  "jurisdiction": "IN",
  "taskType": "summarize",
  "tier": "pro",
  "maxTokens": 800,
  "enableHITL": false,
  "enableHallucinationCheck": true,
  "enableCitationVerification": true,
  "enableExplainability": false,
  "enableRAG": false,
  "enableMemory": false,
  "previousMessages": [],
  "ragDocumentIds": []
}
```

Single-agent response (most common):

```json
{
  "success": true,
  "data": {
    "content": "…final answer…",
    "model": "gemini-2.5-flash",
    "latencyMs": 14732,
    "tokens": { "prompt": 421, "completion": 189, "total": 610 },
    "ledger": { "actionId": "cam_…", "hash": "0x…" },
    "guardrails": { "pii_redacted": 0, "policy_violations": 0 }
  }
}
```

Multi-agent (Queen Orchestrator) response when
`orchestrationMode ∈ {sequential, parallel, hierarchical, swarm, dag,
multi-agent}`:

```json
{
  "success": true,
  "data": {
    "content": "<synthesised output>",
    "orchestrationMode": "parallel",
    "agentsUsed": ["summarizer", "risk-analyst", "citation-checker"],
    "orchestrationPattern": "RRF-fusion",
    "totalTime": 28401,
    "totalTokens": { "input": 1234, "output": 987 },
    "verbalizedConfidence": 0.86,
    "executions": [{ "agentId": "…", "agentName": "…", "status": "ok", "tokens": {…} }],
    "taskDecomposition": { "complexity": "high", "subtaskCount": 4, "algorithm": "ROMA-L5" }
  }
}
```

**LLM response parsing rules — apply to every endpoint that returns
`model + latencyMs`:**

```ts
function parseLlmResponse(env: any) {
  if (!env?.success) throw new Error(env?.error ?? 'orchestrate failed');
  const d = env.data ?? env;
  const content = d.content ?? d.summary ?? d.answer ?? '';
  if (!content) {
    // Soft failure (e.g. residual sarvam-30b empty-content). Retry once.
    throw Object.assign(new Error('empty model output'), { soft: true, model: d.model });
  }
  return {
    content,
    model: d.model,
    latencyMs: d.latencyMs ?? d.totalTime,
    tokens: d.tokens ?? d.totalTokens,
    ledger: d.ledger,
  };
}
```

### 5.11 Streaming — Server-Sent Events (SSE)

| Path | Method | Auth | Wire format |
|---|---|---|---|
| `/api/nv/orchestration/stream`       | POST | X-API-Key | SSE, `data:` prefix only (no `event:` lines) |
| `/api/nv/universal-chat/chat/stream` | POST | JWT       | same SSE shape |
| `/api/nv/stream/agui`                | GET  | cookie    | EventSource-compatible |

**Event sequence** (one `data:` line per event, blank line between):

```
data: {"type":"start","requestId":"req_…","sessionId":"sess_…"}

data: {"type":"chunk","content":"Summary","index":0}

data: {"type":"chunk","content":" of the contract…","index":1}

data: {"type":"complete","model":"gemini-2.5-flash","latencyMs":14732,"tokens":{"total":610},"actionId":"cam_…"}

data: [DONE]
```

On error: `data: {"type":"error","error":"…"}` followed by `data: [DONE]`.

**EventSource caveat.** The W3C `EventSource` API is **GET-only** and
cannot send a request body or custom headers. The SDK POST streams
above MUST use `fetch` + a manual SSE parser. `EventSource` is OK only
for `/api/nv/stream/agui` (Console, cookie-auth).

Universal SSE parser (browser, Node 22, RN, Deno):

```ts
async function* sseLines(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = block.split('\n').find(l => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      yield JSON.parse(payload);
    }
  }
}

const res = await fetch(`${BASE}/api/nv/orchestration/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
  body: JSON.stringify({ prompt, agentKey: 'summarizer', jurisdiction: 'IN' }),
});
for await (const ev of sseLines(res)) {
  if (ev.type === 'chunk')    onChunk(ev.content);
  if (ev.type === 'complete') onDone(ev);
  if (ev.type === 'error')    onError(ev.error);
}
```

### 5.12 Multimodal + Voice — `/api/nv/sdk/multimodal/*`

`voice:*` scope (NSPM has it; others don't unless wildcard). All
biometric paths gated by DPDPA `purpose: 'biometric'`.

| Path | Body | `data.*` | Purpose gate |
|---|---|---|---|
| GET  `/multimodal/capabilities` | — | catalog | none (meta) |
| POST `/voice/transcribe`        | `{ audioBase64, language }`        | `transcript`, `confidence`, `language` | biometric |
| POST `/voice/synthesize`        | `{ text, voiceId, language }`      | `audioBase64`, `mime`, `durationMs`    | ai_processing |
| POST `/voice/voiceover/generate`| `{ script, voiceId, options }`     | `audioBase64`, `segments[]`            | biometric |
| POST `/voice/stream/start`      | `{ language, sessionId }`          | `wsUrl`, `streamId`                    | biometric |
| POST `/voice/stream/stop`       | `{ streamId }`                     | `transcript`, `durationMs`             | biometric |
| POST `/multimodal/video/generate-script` | `{ topic, durationSec, lang }` | `script`, `scenes[]`                | ai_processing |
| POST `/multimodal/3d/generate`           | `{ prompt, style }`            | `assetUrl`, `format`                | ai_processing |

WebSocket voice (path `/api/nv/voice/ws`, sub-protocol JSON messages):

```js
const ws = new WebSocket(`${BASE}/api/nv/voice/ws`,
  ['nv-voice', `bearer.${apiKey}`]);
ws.onopen = () => ws.send(JSON.stringify({ type:'start', language:'hi' }));
// chunks: ws.send(audioPCMBuffer)
// final:  ws.send(JSON.stringify({ type:'stop' }))
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.type === 'partial')   appendPartial(m.text);
  if (m.type === 'final')     commit(m.text);
  if (m.type === 'error' && m.code === 'DPDPA_CONSENT_BREACH') reauth();
};
```

### 5.13 Compliance / governance reads (any valid key)

| Path | Returns |
|---|---|
| GET `/api/nv/intelligence/compliance-calendar` | upcoming filing deadlines |
| GET `/api/nv/intelligence/regulatory-feed`     | regulatory bulletin items |
| GET `/api/nv/gateway/guardrails/stats`         | per-key guardrail counters |

### 5.14 Architect (Console JWT only) — `/api/architect/*`

Manager+ role required server-side. Useful for ops dashboards, not for
SDK callers, but documented for completeness.

| Path | Auth | Body | Response |
|---|---|---|---|
| POST `/deploy`            | JWT (manager+) | `{ blueprintId, target, departments, connections, corporateDNA }` | `{ success, deploymentId, workflowId, url, departmentCount, agentCount }` |
| GET  `/workflows`         | JWT | — | `{ success, workflows: [...] }` (org-scoped) |
| GET  `/workflows/:id`     | JWT | — | `{ success, workflow: {...} }` (404 on cross-tenant) |

### 5.15 Universal Chat (Console JWT only) — `/api/nv/universal-chat/*`

Backed by real `orchestrateLLM` (no stubs). Auth + IDOR + types fixed
in task-257.

| Path | Body | Response |
|---|---|---|
| POST `/chat/sessions` | `{ title?, agentKey?, jurisdiction? }` | `{ success, data: { sessionId, ownerId, createdAt } }` |
| POST `/chat/messages` | `{ sessionId, content }` | `{ success, data: { messageId, response, model, latencyMs } }` |
| POST `/chat/stream`   | `{ sessionId, content }` | SSE (same shape as §5.11) |
| POST `/chat/upload`   | `multipart file` + `Authorization: Bearer <jwt>` | `{ success, data: { docId, storageBackend } }` |
| GET  `/chat/sessions/:id` | — | `{ success, data: { session, messages[] } }` (403 if not owner) |

### 5.16 Typed `/api/nv5/*` admin surface — use `@nyayavigya/client-sdk@6.1.0`

**Do not cURL `/api/nv5/*` from your app.** Use the SDK:

```ts
import { NyvClient } from '@nyayavigya/client-sdk'; // v6.1.0
const nyv = new NyvClient({ baseUrl: API, apiKey: key });

await nyv.orch.kb.create({ name: 'my-kb', ownerId: 'org-42' });
await nyv.workflows.start({ engine: 'autonomous', spec: {…} });
await nyv.docAi.submitJobBase64({ sourceFormat:'docx', targetFormat:'pdf', content: b64 });
await nyv.gov.makerChecker.getReview({ reviewId: 'r_…' });
await nyv.legalPipeline.chunker.preview({ content, format:'pdf' });
await nyv.complianceNv5.pqc.kemKeygen();
await nyv.internal.capabilities();
```

The seven typed namespaces (`orch / workflows / docAi / gov /
legalPipeline / complianceNv5 / internal`) cover Batches A–J and are
the only blessed access path for the `/api/nv5/*` admin surface.

---

## 6. Required headers (cheat sheet)

| Header | Required? | Purpose |
|---|---|---|
| `X-API-Key`                | Yes (SDK paths) | Canonical auth. |
| `Authorization: Bearer …`  | Optional (SDK), Required (Console JWT routes) | Bearer fallback for SDK; primary for Console. |
| `Content-Type: application/json` | Yes on JSON bodies | — |
| `x-nsp-client`             | Recommended on `/gateway/*` | Originating product code (`nsp` / `nspm` / …). |
| `x-nsp-tier`               | Recommended on `/gateway/*` | `free` / `pro` / `enterprise`. |
| `x-nsp-org`                | Recommended on `/gateway/*` | Caller-scoped org id. |
| `x-organization-id`        | Optional | Multi-tenant override (super_admin / testing). |
| `x-request-id`             | Optional | Caller-supplied trace id; echoed back. |

---

## 7. Per-platform copy-paste samples

### 7.1 NSP web (Next.js / browser fetch)

```ts
const r = await fetch(`${API}/api/nv/intelligence/summarize`, {
  method: 'POST',
  headers: { 'Content-Type':'application/json', 'X-API-Key': process.env.NYV_SDK_KEY_NSP! },
  body: JSON.stringify({ text, maxTokens: 200 }),
});
const j = await r.json();
if (!j.success) throw new Error(j.error);
console.log(j.summary, '— via', j.model, 'in', j.latencyMs, 'ms');
```

### 7.2 NSP mobile (React Native, NSPM)

```ts
import Config from 'react-native-config';
const r = await fetch(`${Config.API_BASE}/api/nv/gateway/documents/summarize`, {
  method: 'POST',
  headers: {
    'Content-Type':'application/json',
    'X-API-Key': Config.NYV_SDK_KEY_NSPM,
    'x-nsp-client':'nspm','x-nsp-tier':'pro','x-nsp-org': deviceOrgId,
  },
  body: JSON.stringify({ content, source:'nyayasiddhi', documentType:'contract' }),
});
const { success, data, error } = await r.json();
if (!success) throw new Error(error);
showSummary(data.summary, data.key_points);
```

### 7.3 JRX (cross-jurisdiction; wildcard scope)

```ts
const r = await fetch(`${API}/api/nv/orchestrate`, {
  method:'POST',
  headers:{ 'Content-Type':'application/json', 'X-API-Key': process.env.NYV_SDK_KEY_JRX! },
  body: JSON.stringify({
    prompt:'Compare GDPR Art.17 and DPDPA s.12 right-to-erasure',
    agentKey:'comparator', jurisdiction:'GC', taskType:'compare', tier:'enterprise',
  }),
});
```

### 7.4 NYM (citizen)

```ts
// NYM has no research:read scope; use document analyze / consumer intake.
const r = await fetch(`${API}/api/nv/gateway/documents/analyze`, {
  method:'POST',
  headers:{ 'Content-Type':'application/json', 'X-API-Key': process.env.NYV_SDK_KEY_NYM! },
  body: JSON.stringify({ content, source:'nym', type:'rental_agreement', jurisdiction:'IN' }),
});
```

### 7.5 NSI / NSM (wildcard scope) — multi-agent orchestration

```ts
const r = await fetch(`${API}/api/nv/orchestrate`, {
  method:'POST',
  headers:{ 'Content-Type':'application/json', 'X-API-Key': process.env.NYV_SDK_KEY_NSI! },
  body: JSON.stringify({
    prompt:'Audit this RFP for procurement-act compliance',
    orchestrationMode:'parallel',
    agents:['compliance-auditor','risk-analyst','citation-verifier'],
    jurisdiction:'IN', tier:'enterprise', priority:'high',
  }),
});
const { data } = await r.json();
console.log(data.executions.map(e => `${e.agentName}: ${e.status}`));
```

---

## 8. CoT / agentic / OCR response parsing — special cases

### 8.1 Chain-of-thought (when `enableExplainability: true`)

The orchestrate response gains an `explainability` block:

```json
{
  "success": true,
  "data": {
    "content": "…",
    "explainability": {
      "reasoningSteps": [
        { "step": 1, "thought": "Identify governing statute…" },
        { "step": 2, "thought": "Apply test from Hadley v Baxendale…" },
        { "step": 3, "thought": "Compute liquidated damages…" }
      ],
      "confidence": 0.87,
      "citationGraph": [{ "from": "step-2", "to": "case:HVB-1854" }]
    }
  }
}
```

Parse with: `data.explainability?.reasoningSteps ?? []` — never crash if
the field is absent (it's only emitted when explicitly requested).

### 8.2 Hallucination + citation gate (when enabled)

```json
"data": {
  "content": "…",
  "guardrails": {
    "pii_redacted": 2,
    "policy_violations": 0,
    "hallucination_score": 0.04,    // < 0.2 = OK
    "citation_verified": true,
    "ungrounded_claims": []
  }
}
```

If `hallucination_score > 0.2` or `citation_verified === false` your UI
should warn the user; the backend has already logged a CAM row.

### 8.3 OCR pipeline — polling pattern

```ts
const up = await fetch(`${API}/api/nv/documents/upload`, {
  method:'POST',
  headers:{ 'X-API-Key': key },
  body: form,                                // multipart with `file` field
}).then(r => r.json());
const { docId, statusUrl } = up.data;

let s;
do {
  await new Promise(r => setTimeout(r, 1500));
  s = await fetch(`${API}${statusUrl}`, { headers:{ 'X-API-Key': key } }).then(r => r.json());
} while (s.data.status !== 'ready' && s.data.status !== 'failed');

if (s.data.status === 'failed') throw new Error(s.data.error);
const doc = await fetch(`${API}/api/nv/documents/${docId}`, { headers:{ 'X-API-Key': key } })
  .then(r => r.json());
console.log(doc.data.extractedText, doc.data.entities);
```

### 8.4 Document management (search / GraphRAG)

```ts
const r = await fetch(`${API}/api/nv/documents/search`, {
  method:'POST',
  headers:{ 'Content-Type':'application/json', 'X-API-Key': key },
  body: JSON.stringify({ query:'force majeure clauses', enableGraphRAG: true, topK: 8 }),
});
const { data } = await r.json();
data.results.forEach(r => console.log(r.docId, r.score, r.chunk.slice(0,80)));
```

---

## 9. DPDPA consent gate (post task-217)

Routes that touch personal data now run a consent pre-flight. Default
mode is **observation** (never blocks, only logs CAM rows). Set
`NV_DPDPA_CONSENT_ENFORCE=1` to switch to enforcement; on a breach you
will receive:

```json
{ "success": false, "code": "DPDPA_CONSENT_BREACH", "error": "consent_required",
  "details": { "purpose": "ai_processing", "principal": "sdk:org:42" } }
```

Gated routes (purpose):
- `ai_processing`: `/orchestrate`, `/stream`, `/bulk-analysis`,
  `/doc-analyze/*`, `/documents/search`, `/sdk/docs-pipeline/*`,
  `/voice/synthesize`, `/multimodal/{video,3d}/*`, `/shared-docs/{process,bulk-process}`.
- `document_storage`: `/documents/upload`, `/doc-analyze/extract`.
- `third_party_sharing`: `/sdk/documents/:docId/share`.
- `biometric`: `/voice/transcribe`, `/voice/voiceover/*`,
  `/voice/stream/{start,stop}`, `/voice/ws` (start frame).

Until you flip enforce mode, all gated calls succeed normally; CAM rows
accumulate in the reviewer queue for soak.

---

## 10. Rate limits

| Tier | Per-org per-minute | Notes |
|---|---|---|
| `free`        | 60     | `x-nsp-tier: free` |
| `pro`         | 600    | `x-nsp-tier: pro` |
| `enterprise`  | 6,000  | wildcard-scope keys (NSI/NSM/JRX) |
| AI patterns   | separate bucket on `/api/nv/ai/*` and `/api/nv/patterns/*` |
| auth login    | strict |
| dev bypass    | `NV_E2E_BYPASS=1` (dev only; production guard intact) |

`429` responses include `Retry-After` (seconds). Implement exponential
backoff capped at 30s.

---

## 11. Errors — full taxonomy

| HTTP | `code`                       | What to do |
|---|---|---|
| 400 | `INVALID_BODY`               | Fix payload (shape in §5). |
| 401 | `MISSING_API_KEY` / `INVALID_API_KEY` | Set `X-API-Key`; verify with `gateway/info`. |
| 403 | `INSUFFICIENT_SCOPE`         | Pick a SDK key whose scopes match (§3.1). |
| 403 | `DPDPA_CONSENT_BREACH`       | Capture consent; retry. |
| 404 | `NOT_FOUND`                  | Resource missing or cross-tenant (treated as 404 for IDOR safety). |
| 408 / 504 | `UPSTREAM_TIMEOUT`     | Retry once; cascade picks next provider. |
| 422 | `EMPTY_MODEL_OUTPUT`         | Soft (residual sarvam-30b). Retry once with same body. |
| 429 | `RATE_LIMITED` / `CREDIT_CAP_EXCEEDED` | Back off per `Retry-After`; upgrade tier. |
| 500 | `INTERNAL`                   | Capture `request_id`; report. |
| 503 | `DEPENDENCY_DOWN`            | Per-dep breakdown in `/api/nv/health/full`. |

**Universal client retry rule (recommended):**

```
- 401/403           → do NOT retry; surface to user
- 408/504/empty(422)→ retry up to 2 times with 2s + jitter
- 429               → respect Retry-After; cap 30s
- 500/503           → retry once after 5s; then fail
```

---

## 12. v5 vs non-v5 routing rule (recap)

| Prefix | Use it for | Auth | Stable? |
|---|---|---|---|
| `/api/nv/*`  | **All third-party SDK integration.** Every endpoint above unless stated otherwise. | `X-API-Key` (Bearer fallback) | YES — frozen by CI. |
| `/api/nv5/*` | **Console + admin only**, behind feature flags. Use the typed `@nyayavigya/client-sdk@6.1.0` namespaces — never raw cURL. | JWT (Console) | additive-only; no major bumps before prod. |

---

## 13. Pre-publish go/no-go checklist (ops)

- [x] 138/140 e2e PASS, zero timeouts/auth/orgId/wiring/runtime errors.
- [x] Real-LLM round-trip on every key (54/56) including IronLedger
      hash chain + 17-step pipeline.
- [x] Streaming SSE verified on `/orchestration/stream` and
      `/universal-chat/chat/stream`.
- [x] DPDPA consent gate live on every PII path (observation mode).
- [x] Architect deploy persists + emits bus event + IDOR-safe.
- [x] Universal Chat backed by real LRM, ownership-bound, IDOR-safe.
- [x] Typed `/api/nv5/*` SDK shipping as `@nyayavigya/client-sdk@6.1.0`.
- [x] Canonical doc index (`00-README.md`) points integrators here.
- [ ] **EC2 redeploy** — gated on explicit user "GO".
- [ ] **Replit publish** — gated on explicit user "GO".

---

## 14. Where to look in source

| Concern | Path |
|---|---|
| All mounts | `src/index.ts` |
| Stable SDK gateway (~74 endpoints) | `src/routes/nv-sdk-gateway-routes.ts` |
| Stable SDK intelligence (~12) | `src/routes/nv-sdk-intelligence-routes.ts` |
| Stable SDK doc pipeline | `src/routes/nv-sdk-doc-pipeline-routes.ts` |
| Stable SDK multimodal/voice | `src/routes/nv-sdk-multimodal-voice-routes.ts` |
| Doc orchestrator (upload/OCR/search) | `src/routes/nv-document-orchestrator-routes.ts` |
| Doc analyze (legal checklist) | `src/routes/nv-doc-analyze-routes.ts` |
| Orchestrate + stream (17-step) | `src/routes/nv-orchestration-routes.ts` |
| Universal Chat | `src/routes/nv-universal-chat-routes.ts` |
| Architect | `src/routes/nv-architect-routes.ts` |
| LLM cascade (12 levels) | `src/services/intelligent-router/llm-orchestrator.ts` + `src/services/nv-agentzero-adapter.ts` |
| Default sequences (post sarvam-30b removal) | `src/services/intelligent-router/default-sequences.ts` |
| Auth middleware | `src/middleware/nv-sdk-auth-header.ts` + `src/middleware/nv-dual-auth.ts` |
| DPDPA consent gate | `src/middleware/nv-consent-gate.ts` |
| PII redaction | `src/services/nv-client.ts` |
| IronLedger hash chain | `src/services/compliance/nv-cam-writer.ts` |
| Typed nv5 SDK | `packages/client-sdk/src/api/{orch,workflows,doc-ai,gov,legal-pipeline,compliance-nv5,internal}.ts` |

---

**This is the canonical integration document. If anything here disagrees
with the source, source wins — file an issue and update this doc.**
