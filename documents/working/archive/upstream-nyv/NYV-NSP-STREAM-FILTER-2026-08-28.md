# NYV ↔ NSP SSE stream filter contract (2026-08-28)

> **Audience:** NYV platform team (action item), NSP/NYM partner engineers (context)  
> **Related:** [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md) · [`NSP-API-HANDOFF-2026-08-17.md`](./NSP-API-HANDOFF-2026-08-17.md) · [`PARTNER-SDK-RELEASE-2026-05.md`](./PARTNER-SDK-RELEASE-2026-05.md)  
> **Code SSoT:** `src/routes/nv-orchestration-routes.ts` (partner stream) · `src/routes/nv-agui-stream-routes.ts` (Console AG-UI) · `src/utils/nv-client-outcome-sanitize.ts` (NV-COT-PARTNER-STRIP-001)

---

## 1. Summary

NSP/NYM today **filter internal reasoning out of streamed answer text** (client-side regex + ignore non-answer SSE types). NYV already strips chain-of-thought from **sync JSON** (`NV-COT-PARTNER-STRIP-001`) and runs `text_delta` through `sanitizeOrchestrationContentForClient`, but model-emitted reasoning can still appear inside `text_delta` / `content` tokens.

**NYV platform request:** emit all internal reasoning and orchestration checkpoints on **dedicated SSE event types** (`thinking`, `checkpoint`, or aligned `thinking_step`) — **never mixed into `text_delta` or sync `data.content`**. Partners then render only answer channels with zero parsing risk.

---

## 2. For NYV platform team — action item

### 2.1 Request

| Item | Detail |
|---|---|
| **What** | Route internal reasoning / CoT / orchestration checkpoints to typed SSE events, not answer tokens |
| **Recommended types** | `thinking` (reasoning step text), `checkpoint` (phase boundary / gate passed), or existing SDK-aligned `thinking_step` `{ step, index, total }` |
| **Answer channel** | `text_delta.delta` / `text_delta.accumulated` and terminal `run_completed.result` / sync `data.content` must contain **partner-safe legal outcome text only** |
| **Priority** | Hardening — NSP works today via filters; separate channels remove fragility and enable optional “show reasoning” UI |

### 2.2 Partner contract (frozen)

Partners (NSP, NYM, JRX) **render**:

| Source | Field | Use |
|---|---|---|
| SSE stream | `text_delta` (respect `provisional` / `gated` — see SDK README) | Progressive answer UI |
| SSE terminal | `run_completed.result` / `run_completed.answer` | Source of truth after stream |
| Sync HTTP | `POST /api/nv/orchestrate` → `data.content` | Full answer when not streaming |

Partners **do not render** (ignore or optional debug UI only):

- `thinking`, `thinking_step`, `checkpoint`
- `pattern_event`, `timeline_step`, `tool_call`, `tool_result`
- `document_context`, `metadata`, `adaptive_router` subtypes
- Any `chainOfThought` / `explainability` / nested `orchestration.*` on JSON (stripped server-side today)

### 2.3 Current NYV state

| Layer | Behaviour | Tag |
|---|---|---|
| Sync JSON | Removes `chainOfThought`, thinking keys, `<thinking>` blocks from `content` / `summary` | **NV-COT-PARTNER-STRIP-001** |
| Stream content | `sanitizeOrchestrationContentForClient()` on every `text_delta` accumulation and final synthesis | **NV-CLIENT-OUTCOME-SANITIZE-001** |
| Stream lifecycle | Queen path maps decomposition/agent/synthesis to coarse `thinking` strings; agent names and tool previews **not** exposed | **NV-CLIENT-OUTCOME-SANITIZE-001** |
| Gap | Model may still emit reasoning **inside** token stream before sanitizer patterns match; NSP client filters these today | — |

### 2.4 Why separate channels are cleaner

1. **Zero leak risk** — end users never see reasoning unless the partner opts into a dedicated “reasoning” panel wired to `thinking` / `checkpoint`.
2. **No regex maintenance** — NSP should not parse answer text to strip “Let me think…” / `<thinking>` / CoT JSON.
3. **Optional UX** — partners can show progress (“Analysing request…”) from `thinking` without touching answer buffer.
4. **Aligns with AG-UI** — Console already consumes typed events on `/api/nv/stream`; partner `/orchestrate/stream` should follow the same separation.

### 2.5 Suggested NYV implementation notes

1. **Queen / LLM gateway:** if the provider returns reasoning blocks, emit them as `thinking` (or `thinking_step`) events; only post-safety-gate legal text as `text_delta`.
2. **Checkpoints:** emit `checkpoint` (or `pattern_event` subtype `checkpoint`) at decomposition complete, RAG complete, safety gate, synthesis start — mirror `timeline_step` semantics but partner-safe labels (no agent IDs).
3. **Do not break:** provisional → gated `text_delta` contract (SDK 5.0.6+); `run_completed` envelope parity (NV-ORCH-STREAM-ENVELOPE-001).
4. **Console path:** keep `/api/nv/stream` rich taxonomy; ensure nothing classified as thinking is replayed in cosmetic `text_delta` fan-out after `run_completed`.

---

## 3. For NSP team — context (what you filter today)

NSP already treats the partner stream as **outcome-only** ([`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md) §3.4). Typical handler:

| SSE `type` | NSP action |
|---|---|
| `run_started` | Session / trace binding |
| `document_context` | Show truncation badge if `truncated: true` |
| `thinking`, `thinking_step` | Optional spinner copy; **not** appended to answer |
| `checkpoint` | Ignore (or future progress rail) |
| `pattern_event`, `tool_call`, `tool_result`, `timeline_step` | Ignore |
| `text_delta` | Append to answer buffer; reset on first `gated: true` |
| `run_completed` | Prefer `result` as authoritative answer |
| `run_finished`, `[DONE]` | Close stream |
| `error` / `safety_blocked` | Terminal error UX |

**Content filter (defence in depth):** NSP additionally strips thinking-like patterns from `text_delta` / final `content` when the model inline-emits reasoning. This is **not** the long-term contract — once NYV separates channels, NSP can drop content regex filtering for answer text.

**Sync path:** rely on `data.content` only; never read `chainOfThought` (absent after NV-COT-PARTNER-STRIP-001 on `-fast`; Queen path may include `optionalDegraded` instead).

---

## 4. Code cross-reference — event taxonomy vs leaks

### 4.1 Console AG-UI — `POST /api/nv/stream`

**File:** `src/routes/nv-agui-stream-routes.ts`

| Event type | Emitted today? | Partner-safe? | Notes |
|---|---|---|---|
| `run_started` | Yes | Yes | Pattern, jurisdiction, runId |
| `metadata` | Yes | Yes | Model hint, courts list |
| `thinking` | Fallback only (`USE_QUEEN_PRIMARY=false`) | Yes | Decorative steps gated off in Queen-primary mode |
| `tool_call` / `tool_result` | Fallback only; Queen maps agents as `tool_call`/`tool_result` | Console only | Partner path must not expose agent names |
| `pattern_event` | Yes (Queen lifecycle + P01–P10 mechanics) | Console only | Rich decomposition / synthesis subtypes |
| `timeline_step` | Yes (16-step rail) | Console only | Full orchestration trace |
| `text_delta` | Yes (post-`run_completed` cosmetic replay) | **Answer channel** | Sanitized synthesis replay in word chunks |
| `citation_block` | Yes | Yes | Citations array |
| `step_complete` | Yes | Borderline | Summary string, not CoT |
| `run_completed` | Yes (before text_delta fan-out) | Yes | Authoritative `answer` + `result` |
| `run_error` | Yes | Yes | Sanitized error |
| `checkpoint` | **No** | — | Not in `AGUIEventType` union today |

**Leak note:** Queen-primary path does **not** emit standalone `thinking` events; internal reasoning may appear only inside synthesized output that is then chunked into `text_delta`.

### 4.2 Partner stream — `POST /api/nv/orchestrate/stream`

**File:** `src/routes/nv-orchestration-routes.ts` (from ~L1947)

| Event type | Emitted today? | In answer buffer? | Notes |
|---|---|---|---|
| `run_started` | Yes | No | sessionId echo |
| `document_context` | Yes (inline doc) | No | Truncation metadata |
| `pattern_event` (`adaptive_router`) | Yes | No | Path label only |
| `thinking` | Yes (Queen coarse progress) | No | “Analysing request…”, “Working…”, etc. |
| `text_delta` | Yes | **Yes** | `sanitizeOrchestrationContentForClient` on accum; provisional/gated phases |
| `synthesis_final` | Via `text_delta` sentinel | **Yes** | `source: synthesizer.final`, `complete: true` |
| `run_completed` | Yes | Terminal | Unified contract + `qualityEnvelope` |
| `run_finished` | Yes | No | Stream close marker |
| `checkpoint` / `thinking_step` | **No** | — | SDK accepts `thinking_step`; route does not emit it |
| `tool_call` / agent names | **Suppressed** | No | NV-CLIENT-OUTCOME-SANITIZE-001 |

**Leak note:** `synthesis_token` → `text_delta` path sanitizes accumulated text but **cannot** prevent all model reasoning from entering the token stream before pattern-based strip. This is the gap NSP filters client-side.

### 4.3 Sync orchestrate — `POST /api/nv/orchestrate`

**File:** `src/utils/nv-client-outcome-sanitize.ts`

- Strips `chainOfThought`, `explainability`, nested orchestration diagnostics from JSON (**NV-COT-PARTNER-STRIP-001**).
- Strips `<thinking>`, redacted-reasoning blocks, orchestration headers from `content` string.
- Partners should use **`data.content`** only.

---

## 5. Acceptance criteria (when NYV ships channel separation)

1. Live probe: stream a Queen path with `enableCoT: true`; **no** thinking XML / CoT preamble / JSON reasoning in any `text_delta` or final `content`.
2. Same run emits ≥1 `thinking` or `checkpoint` event carrying that reasoning (or a redacted summary).
3. NSP smoke: answer text renders without client-side content regex (filters can remain as belt-and-suspenders until verified).
4. SDK `NyvStreamReader` documents new `checkpoint` handler (optional); no SemVer break for ignore-unknown-type clients.

---

## 6. Tracking

| Item | Value |
|---|---|
| Doc | `documents/working/NYV-NSP-STREAM-FILTER-2026-08-28.md` |
| NYV code change | **Not required for this doc** — platform hardening backlog |
| NSP change | None required; filters stay until NYV separates channels |
