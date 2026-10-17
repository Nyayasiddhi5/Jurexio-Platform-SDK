# NSP CNR + Diary + Documents — Integration One-Pager

> **Primary handoff for case search + discovery (BFF/PM/QA):** [`NSP-CASE-SEARCH-INTEGRATION-2026-09.md`](./NSP-CASE-SEARCH-INTEGRATION-2026-09.md) — see **§11 field catalog** (value vs field, every 5.1.9 resolve key + example values on `APHC010000832023`), **§12** search-raw vs resolve-normalized, **§16** master-data-derivable prefill; master proposal in [`NYV-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md`](./NYV-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md) **Appendix F**.

**Live:** `https://api.nyayasiddhi.online` · deploy **`2026-09-24T0616Z-aws-ssm-5417fb15`** SSM **`b5a8f985`** (sha **`5417fb15`**, Session-76 SCIN inference) · SDK **5.1.8** — search passthrough + partner-safe CNR + **`sanitizeCnrEnvelopeForPartner`** + documents via unified cascade (**NV-SESSION-75-E2E-001**)  
**Verify:** TSWL CNR search probe **PASS** SSM **`d523ab2f`**; `demo:probe:ec2` SSM **`ab8d7805`** · script `npm run` / `bash scripts/nv-tswl-cnr-search-probe-ec2.sh`  
**Upstream nysapi:** `https://nysapi.nyayasiddhi.online` · RDS watermark **`v_20260923T092637Z`** (nysapi published **`v_20260923T163900Z`**)  
**Corpus backfill:** diary/PII **0**; Gap 4 mirror **caught up to applied RDS stamp** — **`rds_daily`** idle when watermark matches; HC order S3 presign mapping **NYS backlog** (NYV presigns row `document` + timeline URLs only)  
**Filing & drafting:** [`NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md`](./NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md) — **LIVE:** `draftProfile`, `validationResults[]`, Wave D **43** filing-book keys (`FB-468.2026-09-22.waveD`) + **D1** `legal-draft-agentic` · stream **`run_completed`:** **`result.validationResults[]`** or mirrored root · NSP Pro **`https://api.nyayasiddhi.online`**  
**Live probe 2026-09-22T10:48Z:** `demo:probe:ec2` SSM **`3e8c4553`** CURRENT=`2026-09-22T1034Z-aws-ssm-5417fb15`; `NSP_PROBE_REQUIRE_NYV_VALIDATION=1 npm run probe:nyv` **PASS** (8 + 6 validation rows); `probe:fb468:draft-profile` **PASS**.
**Architecture (nysapi-primary):** Tier-1 **nysapi** search/resolve → Tier-2 legacy RDS/Athena/S3 only on miss → Tier-3 eCourts **GO-gated** fallback. NSP integration phases: gap plan **Appendix E** (handover `case_api_NYS_SEARCH_HANDOVER_FOR_SIR part2.md` crosscheck 2026-09-23). Partner-facing errors: **NV-PARTNER-SAFE-MESSAGE-001** (no NYV/LLM/tool jargon to users).  
**Cascade:** opt-out `NYV_F_CNR_UNIFIED_CASCADE=0` (Appendix H)  
**Search P1:** full nysapi filter passthrough on `GET /sdk/cnr/search` + DC filing-ref search-then-resolve on `POST /sdk/cnr/resolve` (Appendix I)  
**Data layers:** case-api RDS (Tier-1) ≠ `delta-dc` judgments (Tier-2 national DC **32** prefixes, **9.52M** rows) — complementary, not duplicate (Appendix J)  
**Live eCourts:** Tier 3 NIC API (`NYV_F_ECOURTS_LIVE_FETCH=0`); Tier-4b portal spike wired (`NYV_F_ECOURTS_PORTAL_FETCH=0`) — async `POST/GET …/live-fetch` (Appendix J.10)  
**NSP UI field matrix:** 7-section autofill coverage (API vs corpus) — Appendix **K**  
**Party PII display:** `fields.partyDetails[]` + `caseCreate.clients[]` / `opposingParties[]` — address·phone·email·fatherName when corpus publishes (AI paths still redact)
**Corpus enrichment roadmap:** Appendix **L** (P0–P6 layers, fill-rate targets, 30/90-day actions)  
**External tools:** bharat-courts / eCourtsIndia / Kanoon crosscheck vs NYV stack — Appendix **J.11**  
**Full playbook:** [`NSP-CNR-DIARY-MATTER-CREATION-2026-09.md`](./NSP-CNR-DIARY-MATTER-CREATION-2026-09.md) (Appendices C–J)  
**Plain-language LIVE / PENDING + flows:** [`NSP-PARTNER-LIVE-PENDING-FLOWS-2026-09.md`](./NSP-PARTNER-LIVE-PENDING-FLOWS-2026-09.md)  
**NYV/NYS closure architecture + ops evidence:** [`NYV-NYS-CLOSURE-ARCHITECTURE-2026-09.md`](./NYV-NYS-CLOSURE-ARCHITECTURE-2026-09.md)  
**Case-api RDS vs resolve fields + 30/60/90 gap plan:** [`NYV-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md`](./NYV-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md) — **NSP full field + document paths:** **Appendix C**  
**Filing book (43 keys Wave D) vs practitioner book:** **NV-BOOK-SME-WAVE-D-001** · manifest **`FB-468.2026-09-22.waveD`**  
**NSP beta launch (NYV/NYS/NSP matrix):** [`NSP-BETA-LAUNCH-READINESS-2026-09.md`](./NSP-BETA-LAUNCH-READINESS-2026-09.md)

---

## 1. Front door — NYV only

NSP browser/BFF **must never** call nysapi, S3, Athena, or RDS directly. All corpus access goes through NYV SDK routes with **`X-API-Key`** server-side only.

| Infra | NYV route | NSP use |
|---|---|---|
| case-api RDS (~57M) + DuckDB (~78M) | `POST …/sdk/cnr/resolve` | Matter autofill |
| S3 judgment PDFs | resolve `documents[]` + `GET …/cnr/{cnr}/documents` | Presigned URLs — no bucket access |
| Events parquet | resolve `options.includeTimeline: true` | HC rows with 0 inline hearings — **forces** nysapi `/timeline` even when inline hearings exist (SDK **5.1.6** `CnrResolveOptions.includeTimeline`) |
| Athena / legacy RDS / S3 | unified cascade when case-api `not_found` (Appendix H) + P2a merge on `found` | DC gap filler + deep enrichment; **SC diary without CNR** triggers legacy merge when `NYV_F_CASE_API_LEGACY_ENRICH=1` |
| PDF extract snippet | `options.includeExtractPreview: true` (default on `profile: caseCreate`) | `data.extractPreview` (police station / truncated text) when legacy tier has judgment PDF |
| eCourts live | Tier 3 `nv-ecourts-live-fetch.ts` (`NYV_F_ECOURTS_LIVE_FETCH=0` default) | NIC API when key provisioned |
| eCourts portal | Tier-4b `POST …/cnr/live-fetch` + poll (`NYV_F_ECOURTS_PORTAL_FETCH=0`) | Async portal fetch; needs session cookie |
| Document bundle | `GET …/cnr/{cnr}/document-bundle` | Judgment + orders in one call (SDK 5.1.5) |

---

## 2. Endpoints

| Method | Path | Purpose |
|---|---|---|
| **POST** | `/api/nv/v1/sdk/cnr/resolve` | **Primary** — diary, CNR, unified `identifier` |
| GET | `/api/nv/v1/sdk/cnr/search` | Matter discovery — full nysapi filter passthrough LIVE (Appendix I) |
| GET | `/api/nv/knowledge/caselaw/search` | Judgment text search (FTS/hybrid) — research, not matter intake |
| GET | `/api/nv/v1/sdk/cnr/{cnr}/documents` | Presigned PDF list when resolve `documents[]` empty |
| GET | `/api/nv/v1/sdk/cnr/{cnr}/document-bundle` | **P3** — judgment + timeline orders + metadata (SDK 5.1.5) |
| POST | `/api/nv/v1/sdk/cnr/live-fetch` | **Tier-4b** — enqueue async portal fetch (202 + jobId) |
| GET | `/api/nv/v1/sdk/cnr/live-fetch/{jobId}` | Poll Tier-4b result |
| GET | `/api/nv/v1/sdk/cnr/health` | Readiness probe |

**Headers:** `X-API-Key` (required) · `X-NYV-Platform: nsp` (recommended) · `Content-Type: application/json`

---

## 3. Identifier rules

| Court | Send | Pos 3–4 (CNR) | Example |
|---|---|---|---|
| **SC** | Diary `NNNNN/YYYY` or compact | n/a | `17329/2025`, `173292025` |
| **HC** | 16-char CNR | **`HC`** | `RJHC010324382023` |
| **DC** | 16-char CNR | **≠ HC** (district tier) | `DLCT010001232023`, `TSWL000000742024` |

**Unified field:** `{ "identifier": "…" }` — NYV infers court + kind. Legacy `{ cnr }` / `{ diaryNumber }` still accepted.  
**HC/DC diary → 400** `unsupported_param_for_court_type` (by design). **SC case number only → 422** `CNR_CASE_NUMBER_ONLY` — collect diary first.

---

## 4. Request examples

```json
// SC diary (intake — fast)
{ "identifier": "173292025", "options": { "courtType": "sc", "includeDocuments": false } }

// HC CNR (matter autofill)
{ "identifier": "RJHC010324382023", "options": { "profile": "caseCreate", "includeDocuments": true } }

// DC CNR
{ "identifier": "DLCT010001232023", "options": { "profile": "caseCreate" } }

// B9 re-resolve after picker (duplicate HC+DC tier)
{ "identifier": "DLCT010043082025", "options": { "courtType": "hc", "profile": "caseCreate" } }
```

---

## 5. Options

| Option | Values | Effect |
|---|---|---|
| `profile` | `default` \| **`caseCreate`** | `caseCreate` → structured `caseCreate` block + deep merge (60s budget) |
| `includeDocuments` | bool (default **true**) | `false` ≈130ms intake; `true` adds presigned PDFs |
| `includeTimeline` | bool | Forces `/timeline` fetch; maps `doc_url` → `hearings[].docUrl` + `documents[]` |
| `courtType` | `sc` \| `hc` \| `dc` | Explicit hint; **required after B9 picker** |

---

## 6. Response essentials

| Key | Notes |
|---|---|
| `data.status` | `found` \| `not_found` \| **`suggested`** \| `invalid` — HTTP **200** for `not_found` |
| `data.fields.*` | `{ value, source, confidence, note? }` — scalars + **arrays** (5.1.3) |
| `data.fields.petitioners[]` / `respondents[]` | Party name arrays; scalar `petitioner`/`respondent` = first item |
| `data.fields.advocates[]` | `{ name, side: petitioner\|respondent\|null }` |
| `data.fields.citation`, `firNo`, `firYear`, `filingNumber`, `complexName`, `bench`, … | P1 scalars when in corpus |
| `data.meta.inferredCourtType` | `sc` \| `hc` \| `dc` |
| `data.meta.provenance.tableVersion` | RDS loader watermark when available |
| `data.meta.identifierKind` | `cnr` \| `diary` \| `case_number` |
| `data.meta.fieldAvailability` | Grey-out map — which fields corpus lacks |
| `data.meta.counts` | e.g. hearings indexed |
| `data.documents[]` | `{ url, kind, expiresIn, … }` presigned PDFs |
| `data.candidates[]` | B9 picker rows when `status: suggested` |
| `claimEcourts` | **Always `false`** — judgment corpus, not live eCourts |

---

## 7. Documents

- **`includeDocuments: true`** (default): inline presigned URLs in `data.documents[]`.
- **`includeDocuments: false`**: skip PDF fetch for faster intake; call `GET …/cnr/{cnr}/documents` later if CNR known.
- Each doc: `url` (presigned S3), `expiresIn` (**900s**), `kind` (`order` \| `judgment`), `sourceArchive`.
- **`includeTimeline: true`**: adds order PDFs from timeline events to `documents[]` and `hearings[].docUrl`.

---

## 8. Errors

| HTTP | Condition | NSP action |
|---|---|---|
| **422** | `CNR_CASE_NUMBER_ONLY` — SC case no without diary | Prompt for diary |
| **400** | HC/DC diary attempt | SC diary only — show validation |
| **400** | `CNR_INVALID` | Fix identifier format |
| **200** | `status: not_found` | Manual matter + retry later (corpus gap) |
| **200** | `status: suggested` + `candidates[]` | Show HC/DC picker → re-resolve with `courtType` |
| **503/504** | Upstream busy/timeout | Retry 2s/4s/8s (max 3) |

---

## 9. NSP BFF pattern

```typescript
// Server-side only — never expose NYV_SDK_KEY_NSP to browser
await fetch('https://api.nyayasiddhi.online/api/nv/v1/sdk/cnr/resolve', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.NYV_SDK_KEY_NSP,
    'X-NYV-Platform': 'nsp',
  },
  body: JSON.stringify({ identifier, options: { profile: 'caseCreate' } }),
});
```

Map `data.caseCreate` → NSP matter schema. Show badge: **Suggested · Judgment corpus** (`claimEcourts: false`).

---

## 10. Honest limits (ship with these)

| Limit | Impact |
|---|---|
| **SC pending diaries: `cnr` often null** | Show `fields.caseNo`; CNR backfills when corpus updates |
| **DC ingest gap** (~18M rows) | Some DC CNRs → `not_found` until NYS ops backfill completes |
| **`claimEcourts: false` always** | Not live docket — disclaimer required |
| **`GET /cnr/search` filters** | Full passthrough **LIVE** (Session-75); date-range filters map to **`year`** only until NYS ships ranges |
| **SC diary `/timeline`** | CNR-keyed events — **NYS ops blocked** |

**Verify:** `npm run partner:smoke:ec2` · `npm run demo:probe:ec2`
