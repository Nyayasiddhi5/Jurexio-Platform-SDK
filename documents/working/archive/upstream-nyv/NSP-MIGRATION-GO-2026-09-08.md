# NSP Migration GO — legal-draft-fast + stream + memory userId (2026-09-08)

> **Status:** REQUIRED for NSP/NYM integration teams  
> **NYV deploy target:** nysdev `api.nyayasiddhi.online`  
> **Secrets:** NV-SECRETS-001 — never commit key values

---

## Summary of API contract changes

| Before (deprecated for sync UI) | After (REQUIRED) |
|---|---|
| `taskType: "legal-draft"` from browser/BFF sync | `taskType: "legal-draft-fast"` |
| No `parameters.documentType` | `parameters.documentType` per registry (snake_case) |
| No length hint | `options.draftLength: "medium"` (or `low` / `comprehensive`) |
| No per-user memory id | `X-NYV-User-Id: <numeric>` **or** body `userId: <numeric>` |
| Sync-only progressive UX | `POST /api/nv/orchestrate/stream` for editor/chat streaming |

Bare `legal-draft` remains **counsel-grade async only** (Queen, ~70–94s Opus). Never call from 55–60s UI threads.

---

## curl — sync draft-fast (Describe & Generate)

```bash
curl -sS -X POST 'https://api.nyayasiddhi.online/api/nv/orchestrate' \
  -H 'X-API-Key: <<NYV_SDK_KEY_NSP>>' \
  -H 'X-NYV-Platform: nsp' \
  -H 'X-NYV-User-Id: 12345' \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Draft a one-paragraph anticipatory bail prayer under BNSS.",
    "taskType": "legal-draft-fast",
    "jurisdiction": "IN",
    "parameters": { "documentType": "bail_application" },
    "options": { "draftLength": "medium" },
    "syncTimeoutMs": 90000,
    "maxTokens": 512
  }'
```

## curl — stream draft-fast

```bash
curl -sS -N -X POST 'https://api.nyayasiddhi.online/api/nv/orchestrate/stream' \
  -H 'X-API-Key: <<NYV_SDK_KEY_NSP>>' \
  -H 'X-NYV-Platform: nsp' \
  -H 'X-NYV-User-Id: 12345' \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Draft a short written statement for money recovery.",
    "taskType": "legal-draft-fast",
    "jurisdiction": "IN",
    "parameters": { "documentType": "written_statement" },
    "options": { "draftLength": "medium" }
  }'
```

## TypeScript — `@nyayavigya/client-sdk`

```typescript
const draft = await nyv.orchestrate({
  prompt: 'Draft anticipatory bail prayer…',
  taskType: 'legal-draft-fast',
  jurisdiction: 'IN',
  userId: 12345,
  parameters: { documentType: 'bail_application' },
  options: { draftLength: 'medium' },
  syncTimeoutMs: 90_000,
}, {
  headers: { 'X-NYV-User-Id': '12345' },
});

// Streaming editor
await nyv.orchestrate.stream(
  {
    prompt: 'Draft written statement…',
    taskType: 'legal-draft-fast',
    parameters: { documentType: 'written_statement' },
    options: { draftLength: 'medium' },
    userId: 12345,
  },
  { onTextDelta: (d) => editor.replace(d.accumulated ?? '') },
);
```

## complex_agreement — chunked generation (NYV-side, 2026-09-08)

When `parameters.documentType: "complex_agreement"` **and** `options.draftLength: "comprehensive"` (or >40K token budget), NYV automatically runs **4-chunk** generation (outline → operative ×2 → boilerplate) with NV-DRAFT-COMPLETION-001 closure. NSP sends the same payload; no client-side chunking required.

---

## NSP team migration checklist (REQUIRED)

- [ ] Replace all sync UI calls of bare `legal-draft` with `legal-draft-fast`
- [ ] Add `parameters.documentType` on every draft request
- [ ] Add `options.draftLength: "medium"` unless user selects short/full
- [ ] Send `X-NYV-User-Id` (numeric) on every orchestrate call for memory isolation
- [ ] Use `/api/nv/orchestrate/stream` for progressive editor UX
- [ ] Route full counsel pleadings to **async worker** with bare `legal-draft` + poll (600s budget)
- [ ] Verify with `bash scripts/_ec2-partner-memory-userid-probe.sh` on EC2 after deploy

**Probe (NYV repo):** `npm run demo:probe:ec2` · `npm run partner:smoke:ec2`

Cross-ref: [`PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md`](./PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md) §J

---

## §J — Post-deploy audit (2026-09-09)

**Deploy verified:** `2026-09-09T1042Z-aws-ssm-02b7885f` (NV-DRAFT-STREAM-DUP-001 live on nysdev)

**Live probes (EC2 SSM, keys from canonical env only):**

| Probe | SSM / command | Result |
|---|---|---|
| Draft length (bail medium + full + SLP fast) | `npm run demo:probe:draft-length:ec2` → `5c9613a7` | **PASS** — bail-fast completion **4267** tokens (8500 floor); no 1024 cap |
| Stream vs sync duplication | `_ec2-draft-stream-dup-probe.sh` → `43ffcda2` | **PASS** — **0 gated** deltas, **0** repeated paragraphs, replace semantics OK |
| Gateway logs | `docker logs nyv-gateway \| grep -iE legal-draft\|nsp\|stream\|token` | `legal-draft-fast` on specialist/Haiku; counsel `legal-draft` Opus **8500** out |

**Checklist status (NSP team):**

- [x] Replace sync UI bare `legal-draft` with `legal-draft-fast` — **code wired** (`nyv-partner-contract.ts`, draft-stream services)
- [x] `parameters.documentType` on draft requests — **wired** via `buildNyvDraftOrchestratePayload`
- [x] `options.draftLength: "medium"` default — **wired**
- [x] `/api/nv/orchestrate/stream` for progressive UX — **wired** (`nyvStreamOrchestrate`)
- [ ] Send `X-NYV-User-Id` on every orchestrate call — **verify production** (gateway `NYV-SESSION-POOLING-001` when absent; SDK supports `customerUserId`)
- [x] Stream gated replace (not append) — **PASS** live + NSP `applyNyvStreamDelta`
- [x] Latency draft-fast bail medium — **PASS post-SLA** (~23s at cap, deploy `2026-09-09T1437Z-aws-ssm-f28b3550`); pre-SLA **~65s** (registry 8500 floor)

**NSP code follow-ups (external repo):** see [`NSP-DRAFT-STREAM-AUDIT-2026-09-09.md`](./NSP-DRAFT-STREAM-AUDIT-2026-09-09.md) — truncation heuristic defaults in `LegalDraftMode.tsx` / `draft-stream.ts`.

---

### §J.A — Stream guidance (NV-DRAFT-STREAM-DUP-001 + production pattern)

**When to stream vs sync**

| Scenario | Endpoint | Expected wall time |
|---|---|---|
| Doc-less quick draft (one prayer / short clause) | `POST /api/nv/orchestrate` sync | **~3s** cold (doc-less, SLA ON) |
| Typed draft with `parameters.documentType` + `options.draftLength: "medium"` | `POST /api/nv/orchestrate/stream` | **~23s** at SLA cap (sync OK but poor UX) |
| Progressive editor / chat UX | `POST /api/nv/orchestrate/stream` | **TTFB ~42ms**, then token deltas |

**Production rules (REQUIRED):**

1. **MANDATORY (2026-09-12 NV-ROADMAP-P1P2-001):** Use **`POST /api/nv/orchestrate/stream`** for all typed drafts with `documentType` — sync bail medium hit **~56–65s** pre-SLA; stream gives immediate editor feedback. Listen for SSE `pipeline_ready` then first `text_delta` (target TTFB **<500ms** after pipeline ready when `NYV_F_PROVIDER_TOKEN_STREAM=1`).
2. Always send **`taskType: "legal-draft-fast"`** — never bare **`legal-draft`** from sync UI threads (counsel-grade Opus, ~70–94s).
3. **Gated delta semantics:** when SSE event has `gated: true`, **replace the entire editor body** — do not append. NSP `applyNyvStreamDelta` + `replaceAll` must mirror this.
4. Post-fix live evidence: stream-dup probe SSM `43ffcda2` — **0 gated** deltas, **0** repeated paragraphs, `accum == run_completed`.

**Deploy reference:** `2026-09-09T1042Z-aws-ssm-02b7885f` (NV-DRAFT-STREAM-DUP-001 — draft-fast bypasses raw provider token stream).

Cross-ref: [`NSP-DRAFT-STREAM-AUDIT-2026-09-09.md`](./NSP-DRAFT-STREAM-AUDIT-2026-09-09.md); PARTNER §J.0 / §I.6.

---

### §J.B — SLA knobs (NV-DRAFT-FAST-SLA-001)

NYV-side env flags on nysdev (gateway `.env.production`). NSP sends the same payload — no client-side SLA switch required.

| Env var | Default (nysdev) | Effect |
|---|---|---|
| `NYV_DRAFT_FAST_SLA` | **`1`** (ON) | Caps `-fast` completion tokens at SLA tier ceilings; skips statute QA + Haiku delivery polish |
| `NYV_DRAFT_FAST_SLA` | `0` | Full registry floors (e.g. bail medium **8500**); expect **~65s** cold |
| `NYV_DRAFT_FAST_SLA_MAX_TOKENS` | **2560** | Medium-tier cap (`min(registry, cap)`) |
| `NYV_DRAFT_FAST_SLA_MAX_TOKENS_LOW` | **2048** | Low-tier cap — optional shorter drafts |
| `NYV_DRAFT_FAST_SLA_MAX_TOKENS_COMPREHENSIVE` | **6144** | Comprehensive-tier cap |

**Latency table (bail_application medium, nysdev):**

| Phase | Wall time | completion_tokens | Notes |
|---|---:|---:|---|
| Pre-SLA (registry 8500 floor) | **~65s** | ~5059 | SSM `5100fc49` |
| Post-SLA (`NYV_DRAFT_FAST_SLA=1`) | **~23s** | **2560** | Deploy `2026-09-09T1437Z-aws-ssm-f28b3550`; SSM `68dae350` |
| Warm repeat (LM cache) | **~67ms** | — | Identical prompt |

**Deploy reference:** `2026-09-09T1437Z-aws-ssm-f28b3550` (commit `f28b3550`).

Code SSoT: `nyayavigya-platform-312/src/utils/nv-partner-platform.ts` — `isDraftFastSlaEnabled()`, `resolveDraftFastSlaTokenCap()`.

---

### §J.C — Token limits + `documentType` / `draftLength`

Per-type token registry: **`nyayavigya-platform-312/src/config/nv-draft-length-registry.ts`** — **20 document types** (snake_case keys).

| Request field | Values | Purpose |
|---|---|---|
| `parameters.documentType` | e.g. `bail_application`, `written_statement`, `complex_agreement` | Selects registry row + closure templates |
| `options.draftLength` | `low` \| `medium` \| `comprehensive` | Tier within registry (`defaultTokens` = medium) |

**Examples:**

| documentType | medium floor (registry) | SLA cap (`NYV_DRAFT_FAST_SLA=1`) |
|---|---:|---:|
| `bail_application` | 8500 | 2560 |
| `written_statement` | 30_000 | 2560 |
| `affidavit_simple` | 4500 | 2560 |

NSP mirror: `packages/nsp-config/src/drafting/nv-draft-length-registry.ts` — keep in sync with NYV registry.

When `NYV_DRAFT_FAST_SLA=0`, NYV uses full registry floor (no SLA cap). Use only for counsel-grade `-fast` depth tests — not interactive UI defaults.

---

### §J.8 — CNR resolve → orchestrate parameters (NV-CNR-ORCHESTRATE-MERGE-001)

After CNR/diary resolve in NSP intake, **always** merge matter fields into NYV orchestrate:

| NSP field | NYV `parameters` | NYV prompt injection |
|---|---|---|
| Flat strings via `buildOrchestrateParametersFromCase()` | `cnr`, `petitioner`, `courtName`, `sections`, … | `formatForumContext()` |
| Structured JSON | `cnrFacts` and/or `caseContext` | `formatCnrCaseContext()` |

NSP SSoT: `packages/nsp-config/src/ai/nyv-partner-contract.ts` — `buildOrchestrateParametersFromCase()` now emits `cnrFacts` JSON. NYV overlay reads it in `buildUniversalLegalIntelligenceOverlay()`.

---

### §J.D — NSP probe contract (NYV/EDJ live probes)

**NSP team feedback (2026-09-11):** NYV/EDJ live probes require **operator NYV credentials in env**. Probes must **fail-closed (SKIP)**, not fake **PASS**, when credentials are absent.

#### Fail-closed rule

| Outcome | When | Example log line |
|---|---|---|
| **PASS** | HTTP 200 + positive control matches | `recall_hit=True`, `gated_count=0` |
| **SKIP** | Required env missing or `key_len=0` | `NSP_SKIP=no_key_in_canon`, `SKIP nyv3_structure_shape` |
| **FAIL** | Keys present but assertion failed | `FAIL bail-medium-latency` |

**Never** report PASS when `NYV_SDK_KEY_NSP` (or operator JWT) is absent — scripts emit **SKIP**, exit 0 only when non-SKIP probes pass.

#### Env vars (names only — NV-SECRETS-001)

| Var / path | Layer | Purpose |
|---|---|---|
| `NYV_SDK_KEY_NSP` | EC2 `/opt/Nyayavigya/secrets/.env.production` | Partner orchestrate probes |
| `NYV_SDK_KEY_NYM` | same | Nyaya Mitra matrix |
| Operator JWT | EC2-only via `scripts/nv-uat-fetch-admin-jwt-ec2.sh` | Console / EDJ routes (`/models`, `/orchestration/dashboard`, feature-flags) |
| `NV_DEMO_PASSWORD` | nysdev canonical env | Admin JWT mint for UAT probes |
| `.local/secrets/runtime.env` | Workstation mirror | Pull once: `bash nyayavigya-platform-312/scripts/nv-pull-ec2-sdk-keys.sh` |

#### EC2 SSM vs local workstation

| Probe | Command | Credential source |
|---|---|---|
| **EC2 SSM (authoritative)** | `npm run demo:probe:ec2` | Reads canonical env on nysdev host |
| **Memory userId** | `bash scripts/nv-partner-memory-probe-ec2.sh` | SSM wrapper → `_ec2-partner-memory-userid-probe.sh` |
| **Draft length** | `npm run demo:probe:draft-length:ec2` | Canonical env on EC2 |
| **Stream dup** | `_ec2-draft-stream-dup-probe.sh` via SSM | Canonical env on EC2 |
| **Local without keys** | `npm run partner:smoke:local` | **SKIP** / `key_len=0` — not a platform failure |

Local probes without `.local/secrets/runtime.env` will show `key_len=0` — **fix the probe env, do not re-fetch SSM keys** (NV-DEMO-SESSION-001).

#### NSP ops probe checklist

- [ ] Confirm deploy stamp: `cat /opt/Nyayavigya/deploy/CURRENT` on nysdev
- [ ] Run `npm run demo:probe:ec2` from workstation (SSM) — expect **PROBE COMPLETE**, not all-SKIP
- [ ] Run `npm run demo:probe:draft-length:ec2` — bail medium **PASS**, no 1024 cap
- [ ] Run stream-dup probe — `gated_count=0`, `repeated_paras=0`
- [ ] Run `bash scripts/nv-partner-memory-probe-ec2.sh` — `recall_hit=True` (requires prior turn A seed)
- [ ] Run `npm run partner:smoke:ec2` — **0 failures** (NSP row not SKIP)
- [ ] EDJ/Console probes: mint operator JWT via EC2 script; expect **401** without JWT, **200** with JWT
- [ ] If any probe shows SKIP for missing keys: check canonical env lens (`grep -E '^NYV_SDK_KEY_NSP=' ... | wc -c` > 20) — keys exist on host; fix probe wiring

Cross-ref: [`PLATFORM-OPS-SOP-NYV-NYS-2026-09.md`](./PLATFORM-OPS-SOP-NYV-NYS-2026-09.md); [`DEMO-SESSION-CREDENTIALS-2026-08.md`](./DEMO-SESSION-CREDENTIALS-2026-08.md).
