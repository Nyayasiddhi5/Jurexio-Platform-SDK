# NSP ↔ NYV — Continue wire live artifacts (§11 joint QA)

> **Captured:** 2026-10-09 against nysdev; **current deploy **`2026-10-09T1741Z-aws-ssm`** (SSM `b5f6a388`). Example requestIds below from earlier probe — field paths unchanged.  
> **Secrets:** use `NYV_SDK_KEY_NSP` from canonical env only — never commit values.

## Environment (NSP Pro / preprod joint test)

| Item | Value |
|------|--------|
| **NYV API base** | `https://api.nyayasiddhi.online` |
| **Deploy tag** | `2026-10-09T1741Z-aws-ssm` (SSM `b5f6a388-4eaf-4b93-9076-501cfa5cdfdd`) |
| **Health** | `GET /health` → 200 |
| **Orchestrate** | `POST /api/nv/orchestrate` |
| **NSP headers** | `X-API-Key`, `X-NYV-Platform: nsp`, `Content-Type: application/json` |

NSP Pro/preprod should target this host for §11 until a dedicated preprod URL is cut over.

---

## Sync vs stream — completion timeline

| Path | `completion` / `continuationAvailable` | Notes |
|------|------------------------------------------|--------|
| **`POST /api/nv/orchestrate` (sync unary)** | **Live on `2026-10-09T1307Z-aws-ssm`** | Queen + specialist paths run completion seam after enforcers. |
| **`POST /api/nv/orchestrate/stream` (SSE)** | **Live (NV-NSP-STREAM-META-002)** — `run_completed.result` + event root: `completionStatus`, `continuationAvailable`, `completion`, `draftQuality` mirrors | Stream does not auto-run multi-segment loop; Continue action remains sync with `priorContent`. |
| **NSP durable worker → poll** | Same field paths on final **`result`** object as sync **`data`** | Worker must forward `options.continueIncomplete` + `priorContent` if Continue after poll. |

---

## Artifact A — first draft (live incomplete, segment budget)

**Request:**

```bash
curl -sS -m 120 -X POST "https://api.nyayasiddhi.online/api/nv/orchestrate" \
  -H "Content-Type: application/json" \
  -H "X-NYV-Platform: nsp" \
  -H "X-API-Key: ${NYV_SDK_KEY_NSP}" \
  -d '{
    "taskType": "legal-draft-fast",
    "prompt": "Draft a complete writ petition under Article 226 for quashing FIR 123/2024 PS Anna Nagar Chennai. Include full cause title, numbered paragraphs 1-25 with facts, grounds A-E, PRAYER with 5 reliefs, verification and advocate block. Use Tamil Nadu jurisdiction.",
    "sessionId": "nsp-continue-artifact-001",
    "parameters": { "documentType": "writ_petition" },
    "options": { "draftLength": "medium" }
  }'
```

**Response field paths (2026-10-09 live; `content` omitted — length only):**

```json
{
  "success": true,
  "data": {
    "requestId": "2951ffdc-b20b-4b09-8463-386b84ae80a9",
    "requestPhase": "degraded",
    "optionalDegraded": true,
    "completionStatus": "incomplete",
    "continuationAvailable": false,
    "completion": {
      "status": "incomplete",
      "continuationAvailable": false,
      "continuationCount": 4,
      "incompleteReason": "segment_budget",
      "hint": "This draft is incomplete. Counsel review or a new comprehensive request is recommended."
    },
    "draftQuality": {
      "reviewRecommended": true,
      "completionStatus": "incomplete",
      "continuationAvailable": false,
      "completion": { "...": "mirror of data.completion" }
    },
    "content": "<full draft text — 10661 chars this run>"
  }
}
```

**NSP UI rule:** When `incompleteReason === "segment_budget"`, prefer **Counsel async** (`legal-draft` + `comprehensive`) over Continue.

When `continuationAvailable === true`, show Continue and use `data.completion.continueRequest.options.segmentIndex`.

**Contract example (when NYV still has segment budget — `continueRequest` present):**

```json
"data.completion.continueRequest": {
  "options": {
    "continueIncomplete": true,
    "segmentIndex": 1,
    "priorRequestId": "<data.requestId>"
  }
}
```

---

## Artifact C — bail sync sample (`continuationAvailable: true`) — D1

**Goal:** Show Continue UX when NYV has **not** exhausted the segment budget (`segmentIndex < NYV_BETA_COMPLETION_MAX_SEGMENTS`).

**Probe (local or EC2 env with NSP key):**

```bash
bash scripts/nv-probe-continue-bail-sample.sh
# or: npm run probe:continue:bail
```

**Manual curl (`bail_application`, `draftLength: low`):**

```bash
curl -sS -m 120 -X POST "https://api.nyayasiddhi.online/api/nv/orchestrate" \
  -H "Content-Type: application/json" -H "X-NYV-Platform: nsp" \
  -H "X-API-Key: ${NYV_SDK_KEY_NSP}" \
  -d '{
    "taskType": "legal-draft-fast",
    "prompt": "Draft anticipatory bail under BNSS 482, Chennai Sessions Court. Numbered facts 1-8 only; omit PRAYER and verification.",
    "sessionId": "nsp-continue-bail-sample-001",
    "parameters": { "documentType": "bail_application" },
    "options": { "draftLength": "low" }
  }'
```

**Paths when Continue is offered:**

- `data.continuationAvailable` → **`true`**
- `data.completion.continueRequest.options.segmentIndex` → **`1`**
- `data.completion.continueRequest.options.priorRequestId` → `data.requestId`

**Note:** Long comprehensive prompts may auto-run the sync completion loop and return `incompleteReason: segment_budget` with `continuationAvailable: false` — use Artifact C / low length for the happy-path Continue demo.

**Deterministic contract reference (vitest):** incomplete body without PRAYER → `buildPartnerCompletionEnvelope` sets `continuationAvailable: true` (`tests/unit/nv-ai-completion-loop.test.ts`).

---

## Artifact B — Continue request (live)

**Request** (same prompt/task; additive `options`):

```bash
curl -sS -m 180 -X POST "https://api.nyayasiddhi.online/api/nv/orchestrate" \
  -H "Content-Type: application/json" \
  -H "X-NYV-Platform: nsp" \
  -H "X-API-Key: ${NYV_SDK_KEY_NSP}" \
  -d '{
    "taskType": "legal-draft-fast",
    "prompt": "<same as artifact A>",
    "sessionId": "nsp-continue-artifact-001",
    "parameters": { "documentType": "writ_petition" },
    "options": {
      "draftLength": "medium",
      "continueIncomplete": true,
      "priorContent": "<full data.content from artifact A>",
      "segmentIndex": 1,
      "priorRequestId": "2951ffdc-b20b-4b09-8463-386b84ae80a9"
    }
  }'
```

**Response field paths (2026-10-09 live):**

```json
{
  "success": true,
  "data": {
    "requestId": "7415c991-4037-4f1a-a429-16d3279492a4",
    "requestPhase": "degraded",
    "completionStatus": "incomplete",
    "continuationAvailable": false,
    "completion": {
      "status": "incomplete",
      "continuationAvailable": false,
      "continuationCount": 3,
      "incompleteReason": "abrupt_ending"
    },
    "draftQuality": { "completion": { "...": "mirror" } },
    "content": "<merged body — replace editor; 10665 chars this run>"
  }
}
```

---

## Durable worker / poll (comprehensive + Continue)

NSP BFF meta (no NYV HTTP 202):

```json
{
  "meta": {
    "mode": "durable",
    "taskId": 12345,
    "pollPath": "/ns/v1/ai/task/12345/status",
    "status": "queued",
    "counselDurable": true
  }
}
```

**Worker → NYV (counsel-grade):**

```json
{
  "taskType": "legal-draft",
  "prompt": "<user instruction>",
  "parameters": { "documentType": "writ_petition" },
  "options": { "draftLength": "comprehensive" },
  "enableCoT": true,
  "enableRAG": true,
  "enableMemory": true
}
```

**Poll terminal (shape = sync `data`):**

```json
{
  "status": "ready",
  "result": {
    "content": "...",
    "requestId": "...",
    "completionStatus": "complete",
    "continuationAvailable": false,
    "completion": { "status": "complete", "continuationCount": 0 },
    "draftQuality": { "structureMarkers": {}, "reviewRecommended": false }
  }
}
```

For **Continue after poll**, re-queue worker or call sync orchestrate with `options.continueIncomplete` + `priorContent: result.content`.

---

## §11 checklist pointer

[`NSP-DRAFT-CONTINUE-FAST-IMPLEMENT-2026-10.md`](./NSP-DRAFT-CONTINUE-FAST-IMPLEMENT-2026-10.md) §11.
