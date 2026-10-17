# NSP ↔ NYV Integration Handoff Bundle

**Bundle date:** 2026-09-16  
**Prepared for:** NSP integration team  
**Live API:** `https://api.nyayasiddhi.online` (nysdev)  
**Current deploy:** `2026-09-19T0800Z-aws-ssm` (sha **`30ae45d6`**, P1 max CNR resolve + SDK **5.1.3**; includes P0 enrichment **`bee69493`**, court-type **`ffd233a03`**)

> **No secrets in this bundle.** SDK keys, JWTs, and DB URLs live on nysdev canonical env only. Use your existing NSP key provisioning — do not request key values in chat or email.

---

## What to read first

0. **`NSP-CNR-DIARY-ONE-PAGER-2026-09.md`** — **CNR/diary/documents one-pager (printable):** front door, endpoints, identifier rules, examples, options, errors, BFF pattern, live deploy **`30ae45d6`**; **P1 max resolve LIVE** SDK **5.1.3**.
0. **`NSP-NYV-AI-TASK-SURFACE-2026-09.md`** — **NSP quick ref:** feature → taskType → endpoint → mode → status one-pager (chat, drafts, research, CNR, tools, Patra, STT).
0. **`NSP-CNR-DIARY-MATTER-CREATION-2026-09.md`** — **CNR/diary → matter creation (full playbook):** SC diary; **Appendix D** HC/DC CNR (~98% caseload); **Appendix E** court-type auto-routing (`identifier`); **Appendix F** Case API infra crosscheck + E2E plan; **Appendix C** handover gap matrix.
0. **`NSP-NYV-AI-HANDSHAKE-2026-09.md`** — **Authoritative superset:** all task types, token tiers, headers, SSE/async contracts, LLM sequence, error codes.
1. **`01-NSP-MIGRATION-GO-2026-09-08.md`** — REQUIRED API contract changes, curl/TypeScript examples, migration checklist, §J post-deploy audit.
2. **`04-NSP-OPERATING-PROFILE-2026-09-16.md`** — Recommended NSP operating profile (audit 5a478e63) + full §J.0.3 playbook table.
3. **`03-PROMPT-PLAYBOOK-J0.3-EXTRACT.md`** — Quick reference: migration checklist, stream/SLA knobs, intent → `taskType` / `documentType` playbook table.
3. **`02-PARTNER-AI-INTEGRATION-FULL-2026-09-02.md`** — Full partner integration reference (§J decision matrix, all task types §J.1–§J.9, prompt pipeline, agent registry).

---

## Bundle contents

| File | Purpose |
|------|---------|
| `NSP-CNR-DIARY-ONE-PAGER-2026-09.md` | **CNR/diary/documents one-pager** — printable integration quick ref (live deploy **`30ae45d6`**) |
| `NSP-NYV-AI-TASK-SURFACE-2026-09.md` | NSP quick ref — AI feature → NYV endpoint/taskType/status matrix |
| `NSP-CNR-DIARY-MATTER-CREATION-2026-09.md` | CNR/diary matter creation (full); Appendices **C** (gaps), **D** (HC/DC playbook), **E** (identifier routing), **F** (infra + E2E plan) |
| `00-README-NSP-HANDOFF.md` | This index |
| `01-NSP-MIGRATION-GO-2026-09-08.md` | Migration GO doc — sync/stream payloads, memory `userId`, probe contract |
| `02-PARTNER-AI-INTEGRATION-FULL-2026-09-02.md` | Complete partner AI integration + prompt engineering reference |
| `03-PROMPT-PLAYBOOK-J0.3-EXTRACT.md` | Standalone §J.0.1–§J.0.3 extract (playbook table + always-send fields) |
| `04-NSP-OPERATING-PROFILE-2026-09-16.md` | NSP operating profile + §J.0.3 playbook (audit 5a478e63) |

---

## Frozen API contract summary (2026-09-15)

| Before (deprecated for sync UI) | After (REQUIRED) |
|---|---|
| `taskType: "legal-draft"` from browser/BFF sync | `taskType: "legal-draft-fast"` |
| No `parameters.documentType` | Optional — NYV infers from prompt or uses `general_legal_document` (NV-DOCUMENT-TYPE-INFERENCE-001) |
| No length hint | `options.draftLength: "medium"` (or `low` / `comprehensive`) |
| No per-user memory id | `X-NYV-User-Id: <numeric>` **or** body `userId: <numeric>` |
| Sync-only progressive UX | `POST /api/nv/orchestrate/stream` for editor/chat streaming |

Bare `legal-draft` remains **counsel-grade async only** (Queen, ~70–94s Opus). Never call from 55–60s UI threads.

**Stream rule:** gated SSE deltas (`gated: true`) → **replace** entire editor body, not append.

**Missing or unknown `documentType`:** NYV **infers** intent (prompt heuristics) or falls back to `general_legal_document` — **HTTP 200**, not 400 (NV-DOCUMENT-TYPE-INFERENCE-001). Read `draftQuality.inferredDocumentType` + `draftQuality.documentTypeSource` in the response. Sending an explicit registry key is still **recommended** for best routing.

---

## documentType registry (21 keys — 20 specialized + general fallback)

**NYV code SSoT:** `nyayavigya-platform-312/src/config/nv-draft-length-registry.ts`  
**Structure checklists:** `nyayavigya-platform-312/src/config/nv-indian-draft-structure-registry.ts` (`INDIAN_DRAFT_STRUCTURE_CHECKLIST`)

**NSP mirror (keep in sync):** `packages/nsp-config/src/drafting/nv-draft-length-registry.ts`

Example keys: `bail_application`, `criminal_petition`, `writ_petition`, `written_statement`, `legal_notice`, `complex_agreement`, `affidavit_simple`, `general_legal_document`, … (see registry file).

**Recommended:** send **`parameters.documentType`** + **`options.draftLength`** on every draft request. Omitting type is supported — NYV will infer or use the general fallback.

---

## Verification (no keys in bundle)

| Probe | Command (NYV repo) |
|---|---|
| Full partner matrix | `npm run demo:probe:ec2` |
| Draft length / SLA | `npm run demo:probe:draft-length:ec2` |
| Memory userId | `bash scripts/nv-partner-memory-probe-ec2.sh` |
| NSP smoke row | `npm run partner:smoke:ec2` |

Probes **SKIP** (not PASS) when keys absent locally — EC2 SSM is authoritative.

---

## Contact / cross-refs (NYV repo paths)

- `documents/working/NYV-INDIAN-LEGAL-PROMPT-ENGINEERING-2026-09-12.md` — prompt pipeline + all 20 documentTypes
- `documents/working/NSP-DRAFT-STREAM-AUDIT-2026-09-09.md` — NSP client stream follow-ups
- `documents/working/NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md` — full endpoint matrix

---

## Partner sign-off

**NSP confirmed 2026-09-16** — Playbook alignment via `buildNyvDraftOrchestratePayload` / `draftWire` complete and frozen. No further NSP SDK changes required for counsel-grade P0/P1/P2 (server-side additive only). NYV fixture `nv-counsel-grade-set.v1.json` is CI-only; NSP action: none.

---

## CNR / diary resolve — field enrichment (P0 **LIVE** deploy `2026-09-18T0137Z-aws-ssm-bee69493`)

| Field | When populated | NSP UI note |
|-------|----------------|-------------|
| `meta.fieldAvailability` | nysapi `field_availability` (P0-A) | Grey out unavailable fields — **LIVE** (probe: RJHC 6 keys) |
| `meta.counts` | nysapi counts (P0-A) | Badge e.g. “12 hearings indexed” — **LIVE** (when corpus returns counts) |
| `data.status: "suggested"` + `candidates[]` | B9 duplicate CNR without `options.courtType` (P0-B) | HC/DC picker for `DLCT…` — **LIVE** (unit-tested; live DLCT sample resolved single-tier) |
| `fields.hearings[].docUrl` | Timeline event `doc_url` when `options.includeTimeline: true` (P0-C) | Order/judgment PDF links — **LIVE** (probe: docUrl=2 on RJHC) |
| `fields.actsSections` | nysapi row acts (P1) + legacy merge when empty | Show when non-empty |
| `fields.hearings` / `caseCreate.timeline` | Inline row or nysapi `/timeline` (P2b auto; P0-C opt-in) | RJHC pending diaries may gain timeline |
| `fields.documents` | Legacy `cnr_case_details` merge (P2a) | Additive only |
| `fields.cnr` | When corpus has CNR | **SC pending diaries often null** — data gap (P3 NYS pipeline) |
| `fields.caseNo` | Always when case-api match | **Show when CNR empty** (e.g. `C.A. No. 4657/2026`) |

Diary intake: prefer unified `{ identifier }` (compact diary OK — NYV normalizes). HC/DC CNR: send `options.courtType: "hc"|"dc"` (mandatory for B9). SDK **`@nyayavigya/client-sdk@5.1.2`** adds `CnrResolveOptions.courtType` + `includeTimeline`.

---

## NYV partner fixes (post `1357Z` — NSP can retest)

| Gap | Status |
|-----|--------|
| `POST /api/nv/v1/sdk/prompt/improve` leaking system config | **Fixed** — `improvedPrompt` is user brief only (NV-PROMPT-IMPROVE-USER-001) |
| Fast stream/unary empty on Pro | **Fixed** — stream never-miss parity (NV-QUEEN-NEVER-MISS-001) |
| Comprehensive async Queen + CoT payload | **Verified aligned** — see [`NSP-NYV-DRAFT-HANDSHAKE-2026-09.md`](./NSP-NYV-DRAFT-HANDSHAKE-2026-09.md) § Gap 3 |

NSP may drop local-only prompt-improve fallback once live probe confirms clean responses.

---

## Token tiers (NV-DRAFT-LENGTH-TIER-001 — **LIVE** `1502Z`)

| NSP tier | NYV `draftLength` | maxTokens (target) | Mode |
|----------|-------------------|-------------------|------|
| Fast | `low` | 4096 (+1024 w/ attachments) | Live SSE |
| Standard (default) | `medium` | 6144–8192 (+2048 w/ attachments) | Live SSE |
| Comprehensive | `comprehensive` | 16384–32768 | Async worker + poll |

Full matrix + LLM sequence: [`NSP-NYV-AI-HANDSHAKE-2026-09.md`](./NSP-NYV-AI-HANDSHAKE-2026-09.md). Per-doctype table: [`NSP-NYV-DRAFT-HANDSHAKE-2026-09.md`](./NSP-NYV-DRAFT-HANDSHAKE-2026-09.md) § Token length SSOT.

---

## §NSP Next Steps — combined infra via NYV only (2026-09-18)

**Rule:** NSP browser/BFF must **never** call nysapi, S3, Athena, or RDS directly. All corpus access goes through **`https://api.nyayasiddhi.online`** SDK routes (`X-API-Key` server-side only).

| Infra layer | NYV front door | NSP use |
|---|---|---|
| `case_api_search` RDS (~57M) + DuckDB (~78M) | `POST /api/nv/v1/sdk/cnr/resolve` | Matter autofill — send `{ identifier }` + `options.profile: "caseCreate"` |
| Legacy `nyv_caselaw` RDS (~26M) | Same resolve (`caseCreate` P2a merge) + `GET /api/nv/knowledge/caselaw/search` | Enrichment + Instant Search |
| S3 PDFs (siddhanta + mirrors) | Resolve `documents[]` + `GET /sdk/cnr/{cnr}/documents` | Presigned judgment/order URLs — no bucket access |
| Athena parquet | `POST /api/nv/knowledge/documents/search` + resolve `sourcesTried` | Research / cold archive — not matter intake |
| Events parquet (timeline) | Resolve with `options.includeTimeline: true` | HC rows with 0 inline hearings |

**NSP ship now:** unified identifier intake; SC diary-first; HC/DC CNR-only; B9 court picker on `status:suggested`; show `meta.fieldAvailability`, `meta.counts`, `claimEcourts: false` badge; map `caseCreate` → matter schema.

**Blocked on NYV P1:** full `GET /sdk/cnr/search` filters (FIR, act, filing_number, dates). **Blocked on NYS ops:** DC backfill (~18M row gap), SC diary `/timeline` (CNR-keyed events).

**One-pager:** [`NSP-CNR-DIARY-ONE-PAGER-2026-09.md`](./NSP-CNR-DIARY-ONE-PAGER-2026-09.md) · **Full playbook:** [`NSP-CNR-DIARY-MATTER-CREATION-2026-09.md`](./NSP-CNR-DIARY-MATTER-CREATION-2026-09.md) Appendices C–F · [`NSP-NYV-AI-TASK-SURFACE-2026-09.md`](./NSP-NYV-AI-TASK-SURFACE-2026-09.md).
