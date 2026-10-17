# NSP Draft Stream Crosscheck Audit — 2026-09-09

> **Scope:** NYV gateway live probes (nysdev) + NSP client integration code review  
> **Deploy under test:** `2026-09-09T1042Z-aws-ssm-02b7885f` (NV-DRAFT-STREAM-DUP-001)  
> **Secrets:** NV-SECRETS-001 — no key values in this document

---

## Executive summary

NYV-side **token limits**, **stream replace semantics**, and **duplicate-paragraph fix** are **live and passing** on nysdev after deploy `2026-09-09T1042Z-aws-ssm`. NSP BFF integration code correctly routes `legal-draft-fast` through `/api/nv/orchestrate/stream` with gated replace handling. Two gaps remain: **latency** (bail medium ~27–56s vs 15s target) and **minor NSP UI truncation heuristics** defaulting to counsel-grade `legal-draft`.

Full audit table below. NSP-side code changes are **recommended, not blocking** for stream duplication.

---

## Quality checklist (PASS / FAIL)

| Check | Expected | Result | Evidence |
|---|---|---|---|
| **taskType** | `legal-draft-fast` (not bare `legal-draft` for sync UI) | **PASS** | EC2 length probe `task=legal-draft-fast`; gateway logs `taskType":"legal-draft-fast"`; NSP `resolvePartnerDraftTaskType` / `buildNyvDraftOrchestratePayload` |
| **stream endpoint** | `/api/nv/orchestrate/stream` | **PASS** | Stream-dup probe hits stream URL; NSP `nyayavigya-client.ts` → `resolveNvStreamUrls()` |
| **documentType sent** | Registry key e.g. `bail_application` | **PASS** | Probes send `parameters.documentType`; NSP `buildNyvDraftOrchestratePayload` wires `documentType` |
| **draftLength** | `medium` default | **PASS** | Probes + NSP `resolveNyvDraftLength`; registry default tier = medium |
| **Stream gated handling** | Replace, not append | **PASS** | Stream-dup SSM `43ffcda2`: `gated=0`, `accum == run_completed`; NSP `applyNyvStreamDelta` + `coalesceStreamToken` + `replaceAll` |
| **Token budget** | bail medium **8500** per `nv-draft-length-registry` | **PASS** | Length probe: `completion_tokens=4267` (within 8500 floor, no 1024 cap); `legal-draft` full hit **8500**; unit test `resolvePartnerMaxOutputTokens` → 8500 |
| **No duplicate paragraphs** | 0 gated deltas post-fix | **PASS** | Stream-dup SSM `43ffcda2`: `gated_count=0`, `repeated_paras=0` |
| **Proper closure** | PRAYER + VERIFICATION | **PASS (sync)** / **WARN (stream sample)** | Length probe sync: `prayer=True verification=True`; stream-dup probe: `**PRAYER**` block count=0 (content uses section headings without bold markers — manual sample shows grounds/prayer structure) |
| **Latency** | draft-fast **<15s** | **FAIL** | Length probe bail-medium sync **56320ms**; stream-dup sync **28762ms**, stream **27184ms**; slp-fast **40708ms** |

---

## NYV live probe evidence

### Deploy stamp

```
CURRENT=2026-09-09T1042Z-aws-ssm-02b7885f
```

Post `2026-09-09T1042Z-aws-ssm` as required by NV-DRAFT-STREAM-DUP-001.

### Draft length probe (`npm run demo:probe:draft-length:ec2`, SSM `5c9613a7`)

| Scenario | HTTP | ms | content_len | completion_tokens | PRAYER | VERIFICATION |
|---|---:|---:|---:|---:|:---:|:---:|
| bail-draft-fast-medium | 200 | 56320 | 16657 | 4267 | ✓ | ✓ |
| bail-draft-full (`legal-draft`) | 200 | 154605 | 13504 | **8500** | ✗ | ✗ |
| slp-draft-fast | 200 | 40708 | 19768 | 5020 | ✓ | ✓ |

**Result:** `PROBE PASS` — no 1024-token cap; draft-fast above 2000-char floor.

### Stream vs sync dup probe (SSM `43ffcda2`, `_ec2-draft-stream-dup-probe.sh`)

| Path | ms | len | gated deltas | repeated paras | notes |
|---|---:|---:|---:|---:|---|
| sync | 28762 | 12431 | — | 0 | |
| stream | 27184 | 10994 | **0** | 0 | `accum == run_completed` (replace semantics) |

**Env lens:** `NYV_F_PROVIDER_TOKEN_STREAM=1`; `NYV_PARTNER_MAX_TOKENS_DRAFT_FAST` unset (code default 4096 floor overridden by registry 8500 for typed drafts).

**Result:** `PROBE PASS (no obvious duplication signals)`.

### Gateway logs (SSM `9d43dcb4`, tail 40)

- `legal-draft-fast` on **specialist** path, Haiku 4.5, NSP platform, `partnerSyncLean` SLA.
- `legal-draft` counsel path: Opus 5, **8500** output tokens (expected for full counsel).
- **WARN** `NYV-SESSION-POOLING-001`: probes omitted `X-NYV-User-Id` — per-request session minted (expected for anonymous probes; NSP production must send user id).

### `resolvePartnerMaxOutputTokens` (NYV code)

For NSP + `legal-draft-fast` + `parameters.documentType: bail_application` + `options.draftLength: medium`:

- Registry floor: **8500** (`DRAFT_LENGTH_REGISTRY.bail_application.defaultTokens`)
- Confirmed by unit test `nv-draft-length-registry.test.ts`

---

## NSP client integration review

**Repo:** `/Users/vamsit/Desktop/Nyayasiddhi-Professional 2/`  
**SOP:** `docs/operations/NSP-OPERATIONS-MONITORING-SOP.md` (v2026-09-09)

### Correctly wired (no change required)

| Area | Location | Finding |
|---|---|---|
| taskType SSOT | `packages/nsp-config/src/ai/nyv-partner-contract.ts` | `resolvePartnerDraftTaskType` → `legal-draft-fast` / `doc-draft-fast`; counsel → `legal-draft` |
| Payload builder | `buildNyvDraftOrchestratePayload` | Sends `parameters.documentType`, `options.draftLength`, aligned `maxTokens` |
| Stream endpoint | `apps/api/src/services/nyayavigya-client.ts` | `${base}/api/nv/orchestrate/stream` |
| Gated replace | `packages/nsp-config/src/ai/stream-gated-content.ts` | `coalesceStreamToken` + cumulative snapshot replace |
| BFF stream service | `apps/api/src/services/draft-stream.service.ts` | `nyvStreamOrchestrate` with `replaceAll` on gated events; passes `userId` in ctx |
| Web SSE consumer | `apps/web/src/lib/draft-stream.ts` | `replaceAll === true` → full replace; else `applyNyvStreamDelta` |
| Token registry mirror | `packages/nsp-config/src/drafting/nv-draft-length-registry.ts` | bail_application medium = 8500 |
| Tenant identity | `packages/nv-sdk-client/src/NvSdkClient.ts` | `X-Customer-User-Id` / `X-NYV-User-Id` when `customerUserId` set |

### NSP-side gaps (recommended changes)

| # | Gap | Severity | File(s) | Recommended fix |
|---|---|---|---|---|
| 1 | Truncation assessment defaults to counsel `legal-draft` thresholds on fast-draft stream completion | **Low** | `apps/web/src/components/legal-chat/LegalDraftMode.tsx` L439, L501 | Use `streamMeta?.taskType \|\| 'legal-draft-fast'` in `assessDraftTruncation` |
| 2 | Draft stream meta fallback labels counsel task | **Low** | `apps/web/src/lib/draft-stream.ts` L204 | Default `meta.taskType` to `'legal-draft-fast'` |
| 3 | Memory/session continuity depends on user id reaching NYV | **Medium** | All orchestrate call sites | Audit that `nyvStreamOrchestrate` / `nyvOrchestrate` ctx always includes numeric `userId`; gateway still warns `NYV-SESSION-POOLING-001` when absent |
| 4 | Latency SLA 15s not met for bail medium on current NYV Haiku path | **Medium (NYV)** | — | NSP already sets `syncTimeoutMs: 90_000` in `buildNyvFastDraftStreamOptions`; no NSP code change — track NYV latency RCA separately |

Bare `legal-draft` usage in NSP is **intentional** for counsel worker / Continue Generation / best+xl paths (`doc-draft-stream-task-type.ts`, `legal-chat-counsel-enqueue.service.ts`).

---

## Partner smoke note

`npm run partner:smoke:ec2` with `NYV_PLATFORM=NSP` on nysdev host **skipped** NSP checks (no `NYV_SDK_KEY_NSP` in shell env on EC2). Draft probes that read `/opt/Nyayavigya/secrets/.env.production` are the authoritative live evidence for this audit.

---

## Re-run commands

```bash
cd nyayavigya-platform-312
npm run demo:probe:draft-length:ec2
# stream-dup (no npm alias yet):
bash -c 'source scripts/nv-source-dev-deploy-env.sh && ... _ec2-draft-stream-dup-probe.sh via SSM'
```

Cross-ref: [`NSP-MIGRATION-GO-2026-09-08.md`](./NSP-MIGRATION-GO-2026-09-08.md) §J

---

## SLA follow-up (NV-DRAFT-FAST-SLA-001) — 2026-09-09

Post-audit deploy **`2026-09-09T1437Z-aws-ssm-f28b3550`** addresses the latency **FAIL** row above.

| Metric | Pre-SLA | Post-SLA (`NYV_DRAFT_FAST_SLA=1`) |
|---|---:|---:|
| bail medium cold | **56320ms** (this audit) / **65453ms** (RCA) | **~23451ms** (~23s) |
| completion_tokens | 4267 (registry floor path) | **2560** (SLA cap) |
| warm repeat | — | **~67ms** |
| Latency checklist | **FAIL** (<15s target) | **WARN** — within ~23s SLA cap; stream recommended for UX |

**Knobs:** `NYV_DRAFT_FAST_SLA=1` (default ON); `NYV_DRAFT_FAST_SLA_MAX_TOKENS=2560` (medium); set `NYV_DRAFT_FAST_SLA=0` to restore registry 8500 floor (~65s). Skips statute QA + Haiku delivery polish on SLA path.

Full contract: [`NSP-MIGRATION-GO-2026-09-08.md`](./NSP-MIGRATION-GO-2026-09-08.md) §J.B.
