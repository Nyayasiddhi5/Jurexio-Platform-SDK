# NSP Operating Profile — Counsel-Grade Integration (2026-09-16)

> **Audit ref:** `5a478e63`  
> **Audience:** NSP integration team, NYV partner ops  
> **Live API:** `https://api.nyayasiddhi.online` (nysdev)  
> **No secrets in this document** — key names and paths only (NV-SECRETS-001).

---

## Recommended operating profile

| Knob | NSP value | Notes |
|------|-----------|-------|
| `documentType` | **always** (snake_case) | Required on every draft path; missing → **400** (post `2026-09-16T0235Z`) |
| `draftQuality` | **standard** (default UI) | NSP maps → NYV `options.draftLength: medium`; **fast** → `low`; **comprehensive** → async worker only |
| `options.draftLength` | `low` / `medium` / `comprehensive` | Token SSOT: fast **4096**, standard **6144–8192**, comprehensive **16384–32768** (pending deploy NV-DRAFT-LENGTH-TIER-001) |
| `taskType` | `doc-draft-fast` when `documentText` or `ragDocumentIds` present | Else `legal-draft-fast` for Describe & Generate |
| Stream | `POST /api/nv/orchestrate/stream` | Editor/chat UX; gated SSE (`gated: true`) → **replace** body, not append |
| `enableRAG` | `true` on counsel-grade chat / matter-linked drafts | Omit on quick FAQ (`legal-chat-fast`, doc-less) |
| Attachments | **Standard tier** (not comprehensive) | Attachments bump tokens only; do not force async unless user picks comprehensive |
| `maxTokens` | Tier SSOT (NYV registry) | Fast **4096**; standard **6144–8192**; comprehensive **16384–32768** — handshake § Token length |
| Queen `legal-draft` | **async worker + poll only** | Never sync from browser/BFF; use `legal-draft-fast` + stream |
| Async ownership | **NSP BFF** (`mode: durable`, `taskId`) | NYV does **not** return HTTP 202 / `jobId`; show leave-and-return UX |

**Handshake spec:** [`NSP-NYV-DRAFT-HANDSHAKE-2026-09.md`](./NSP-NYV-DRAFT-HANDSHAKE-2026-09.md)

**Registry SSoT:** `nyayavigya-platform-312/src/config/nv-draft-length-registry.ts` (20 types).

**Structure markers (P1 — doc-type-aware):** `draftQuality.structureMarkers` — pleading types require prayer/verification/causeTitle/numberedParas; `legal_notice` uses demand/signature/timeline; agreements use recitals/execution/clauses. See deploy `2026-09-16` P1.

---

## §J.0.3 NSP Prompt Playbook (full table)

Cross-ref: [`PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md`](./PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md) §J.0.3.

| User intent | taskType | documentType | draftLength | RAG | Agent |
|-------------|----------|--------------|-------------|-----|-------|
| Quick bail ideas | `legal-draft-fast` | `bail_application` | medium | if docs | A-004 |
| File bail tomorrow | `legal-draft` | `bail_application` | comprehensive | yes | A-004 / Queen |
| Quash S.528 | `legal-draft` | `criminal_petition` | comprehensive | yes | A-004 |
| Writ 226 | `legal-draft` | `writ_petition` | comprehensive | yes | A-004 |
| Legal notice | `legal-draft-fast` | `legal_notice` | medium | optional | A-005 |
| Complex SPA | `legal-draft` | `complex_agreement` | comprehensive | yes | A-001 |
| Research memo | `caselaw-research` | `legal_research` | medium | yes | A-048 |
| Statute map IPC→BNS | `statute-research` | `legal_research` | low | yes | A-047 |
| Chat Q&A | `legal-chat` | `legal_chat` | medium | if matter | A-047 |

**Always send:** `parameters.documentType`, `parameters.cnrFacts` (when case linked), `options.draftLength`, matter `sessionId`.

**Counsel upgrade (NYV gateway):** `options.draftLength: "comprehensive"` OR `options.qualityMode: "counsel"` on `-fast` upgrades to bare `legal-draft` (Queen/Opus). Medium stays on Haiku `-fast` (4096 SLA cap; 2560 with `NYV_DRAFT_FAST_SLA=1`).

**Response contract:** `draftQuality.structureMarkers` — `{ prayer, verification, causeTitle, numberedParas, limitationChecked }`; `draftQuality.authoritiesDelivered`; `attestationRequired` when `reviewRecommended`.

---

## CNR / diary resolve (NV-CNR-FIELD-ENRICH-001 — deploy `2026-09-16T1112Z`)

| Endpoint | `POST /api/nv/v1/sdk/cnr/resolve` |
|----------|-----------------------------------|
| Diary | `diaryNumber` + `options.courtType: "sc"` (default when omitted) |
| Profile | `options.profile: "caseCreate"` for deep tier |

**Field sources (additive — status/source unchanged):**

- **actsSections:** mapped from nysapi row (`extra.acts`, `acts`, `acts_sections`)
- **hearings / timeline:** inline row, else `GET /v1/cases/{cnr}/timeline` when CNR known
- **documents / acts / hearings gaps:** legacy `cnr_case_details` merge when `NYV_F_CASE_API_LEGACY_ENRICH=1`

**NSP UI when CNR empty:** display `fields.caseNo` (e.g. `C.A. No. 4657/2026`) — already in response for SC pending diaries.

**Known gap (P3 — NYS pipeline):** SC pending diaries may return `found` with parties + caseNo but no CNR/hearings until NYS ingests diary→CNR linkage.

---

## Verification probes (no keys in doc)

| Probe | Command (NYV repo) |
|-------|---------------------|
| Full partner matrix | `npm run demo:probe:ec2` |
| Partner smoke | `npm run partner:smoke:ec2` |
| Draft length / SLA | `npm run demo:probe:draft-length:ec2` |
| Counsel-grade eval | `npm run eval:counsel-grade -- --only draft-fast-legal-notice` |

---

## Related docs

- [`NSP-NYV-HANDOFF-README-2026-09-16.md`](./NSP-NYV-HANDOFF-README-2026-09-16.md) — handoff bundle index
- [`NSP-MIGRATION-GO-2026-09-08.md`](./NSP-MIGRATION-GO-2026-09-08.md) — migration contract
- [`NYV-INDIAN-LEGAL-PROMPT-ENGINEERING-2026-09-12.md`](./NYV-INDIAN-LEGAL-PROMPT-ENGINEERING-2026-09-12.md) — per-type structure checklists
