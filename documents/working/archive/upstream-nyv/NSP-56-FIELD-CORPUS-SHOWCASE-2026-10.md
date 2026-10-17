# NSP — 56-field resolve showcase & corpus binding checklist

**Audience:** NSP product, mobile/web, BFF engineers  
**Contract SSoT:** `POST /api/nv/v1/sdk/cnr/resolve` on `https://api.nyayasiddhi.online`  
**Machine-readable:** [`NSP-RESOLVE-PARSE-CONTRACT.json`](./NSP-RESOLVE-PARSE-CONTRACT.json) (**56** keys, generated from `src/services/nv-nsp-parse-contract.ts`)  
**Narrative handoff:** [`NSP-CASE-SEARCH-INTEGRATION-2026-09.md`](./NSP-CASE-SEARCH-INTEGRATION-2026-09.md) (§11 catalog, §15 partial vs not_found, §20 fourteen groups, §21 parse contract)  
**NyayaSearch parity (code):** `NV-NYS-CNR-SSOT-001` — worker proxies to same NYV resolve when `NYV_API_BASE_URL` + server SDK key are set (deploy pending user **GO** on caselaw-worker).

---

## 1. What NYV delivers today (platform — LIVE on gateway)

| Capability | Status | Notes |
|------------|--------|-------|
| **56 resolve field keys** | LIVE | Every key present as `CnrFieldValue` on `status:"found"` even when `.value` is null |
| **`caseCreate` profile** | LIVE | Header, timeline, clients/opposing/witnesses, **`fieldManifest`** |
| **`meta.fieldAvailability`** | LIVE | Per-key honesty stamps from nysapi |
| **Jurisdiction prefill** | LIVE | Empty `stateName`/`districtName`/`courtName` filled `source:"nyv_master"` (reference, not live eCourts) |
| **`documents[]`** | LIVE | Judgment PDFs presigned **900s** TTL |
| **`nspParseGuide`** | LIVE | Opt-in `options.includeParseGuide: true` |
| **`GET /search`** | LIVE | Discovery cards only — **no** 56-key envelope |
| **HC order PDF presign** | BLOCKED | `finalOrders[].filename` is relative path until order→S3 map |
| **Live next hearing** | Tier-4 opt-in | Corpus may publish `next_hearing_date` on mobile-depth rows only |

**Honesty:** `claimEcourts: false` always on corpus tiers.

---

## 2. What NSP must do to showcase all corpus details

### 2.1 Binding rules (P0 — non-negotiable)

1. **Resolve, never search-autofill** — After discovery, call **`POST /resolve`** with `identifier` (or legacy `cnr` / diary body).
2. **Read path** — `data.fields.<key>.value` (and `.source`, `.note`, `.confidence`). Never top-level scalars from search cards.
3. **Profile** — `options.profile: "caseCreate"` for matter intake; `default` for fast existence checks only.
4. **Documents** — `options.includeDocuments: true`; refresh URLs before 900s expiry.
5. **Parse guide** — `options.includeParseGuide: true` on first resolve per session; cache `data.nspParseGuide` client-side.
6. **Partial ≠ failure** — Drive UI from `data.caseCreate.fieldManifest` + `meta.fieldAvailability`; grey out empty slots; keep manual fields.
7. **BFF timeout** — ≥ **45s** (recommend **60–90s**) for `caseCreate`; ≥ NYV upstream for deep archive cascade.
8. **Headers** — `X-API-Key` (server only), `X-NYV-Platform: nsp`.

### 2.2 UI mapping checklist (P0 — “show everything we have”)

Map **all 56 keys** to matter form or read-only panels (14 groups below). For each key:

- If `.value` non-empty → autofill + show `source` badge (`nys_case_api_rds` vs `nyv_master`).
- If `.value` empty → show label + `fieldAvailability` / `nspParseGuide.absentWhen` copy (not hidden).
- Arrays/objects → dedicated sub-UI (hearings table, IA list, linked matters chips, acts grid).

### 2.3 What NSP likely has today vs gap

| Area | Typical NSP today | Gap to close |
|------|-------------------|--------------|
| API call | Search or resolve with `default` | Switch intake to **`caseCreate` + includeDocuments** |
| Field count in UI | ~12–20 scalar inputs | Bind **56** keys + nested shapes |
| JSON path | Mixed / search card snake_case | **`data.fields.*.value` only** |
| Empty fields | Hidden or “error” | **Manifest-driven** partial UX (§15) |
| HC rich docket | Omitted | `hearings`, `hcCategoryDetails`, `iaFilings`, orders metadata |
| Geography | Blank on thin HC rows | Show **`nyv_master`** prefill with editable badge |
| PDFs | Missing or stale | `documents[]` + TTL refresh job |
| Linked matters | Not shown | `linkedMatters[]` (SDK 5.2.0) |
| DC status codes | Raw integers | Show raw + note; optional master decode when NYV ships label |

---

## 3. Fourteen groups × field keys (expansion construct)

Each row is one **resolve field key**. Wrapper: `data.fields.<key> = { value, source, confidence, note? }`.

### Group 1 — Identification

| Key | NSP action |
|-----|------------|
| `cnr` | Matter CNR; mirrors `data.cnr` |
| `caseNo` | Case number |
| `caseType` | Short code (CRLP, FA, …) |
| `caseTypeDisplay` | Human label (`nyv_master` when derived) |
| `caseTitle` | Matter title |
| `citation` | Neutral/citation when published |
| `filingNumber` | Filing ref |
| `registrationNumber` | Registration ref |
| `registrationYear` | Registration year |
| `diaryNumber` | SC diary path only |

### Group 2 — Status & dates

| Key | NSP action |
|-----|------------|
| `caseStatus` | Status text or DC numeric + note |
| `disposalNature` | Disposal label / DC code |
| `filingDate` | ISO date |
| `registrationDate` | ISO date |
| `firstHearingDate` | ISO date |
| `decisionDate` | ISO date |
| `nextHearingDate` | Corpus when published; else manual / Tier-4 |

### Group 3 — Bench & venue

| Key | NSP action |
|-----|------------|
| `courtName` | Court name (corpus or `nyv_master`) |
| `courtType` | sc / hc / dc |
| `courtCode` | eCourts court code (DC prefill) |
| `complexCode` | Complex code (DC prefill) |
| `complexName` | Complex name |
| `stateName` | State (often `nyv_master` on thin HC) |
| `districtName` | District |
| `judges` | string[] |
| `benchComposition` | Bench label |
| `judicialSection` | Section |
| `coram` | Coram string |

### Group 4 — Parties & advocates

| Key | NSP action |
|-----|------------|
| `petitioner` | Primary petitioner string |
| `respondent` | Primary respondent string |
| `petitioners` | string[] |
| `respondents` | string[] |
| `partyDetails` | object[] — PII often null; manual slots |
| `advocates` | object[] or names |

### Group 5 — Legal

| Key | NSP action |
|-----|------------|
| `actsSections` | object[] `{ act, section, … }` |

### Group 6 — Category

| Key | NSP action |
|-----|------------|
| `hcCategoryDetails` | HC nested category (HC only) |
| `caseCategory` | SC category (SC only) |

### Group 7 — Interlocutory

| Key | NSP action |
|-----|------------|
| `iaFilings` | HC IA list |
| `interlocutoryApplications` | SC IA list |

### Group 8 — Hearing history

| Key | NSP action |
|-----|------------|
| `hearings` | object[] — also mirror into timeline UX |

### Group 9 — Orders & judgments

| Key | NSP action |
|-----|------------|
| `finalOrders` | Metadata; **do not** open raw `filename` URL |
| `interimOrders` | Same presign caveat |
| *(separate)* `data.documents[]` | Presigned judgment PDFs |

### Group 10 — Lower / earlier courts

| Key | NSP action |
|-----|------------|
| `lowerCourtReference` | Lower court block |
| `earlierCourtDetails` | SC earlier courts |

### Group 11 — FIR & incident

| Key | NSP action |
|-----|------------|
| `firNo` | FIR number |
| `firYear` | FIR year (≠ incident date) |
| `policeStation` | PS name |
| `incidentDate` | Often null until corpus publishes |

### Group 12 — Linked matters

| Key | NSP action |
|-----|------------|
| `linkedMatters` | object[] `{ cnr, relation, title, … }` |

### Group 13 — Other

| Key | NSP action |
|-----|------------|
| `summary` | Corpus summary text when present |

### Group 14 — Registry & honesty

| Key | NSP action |
|-----|------------|
| `registryObjections` | HC registry |
| `registryDefects` | SC registry |
| `caseCreate.fieldManifest` | complete / partial / missing / manual buckets |
| `meta.fieldAvailability` | Per-key tier stamps |
| `meta.betaReadiness` | Tier-3 vs manual capture hints |

**Field count:** 56 keys in parse contract (includes `diaryNumber` on diary path).

---

## 4. Sample resolve request (NSP BFF)

```http
POST /api/nv/v1/sdk/cnr/resolve
X-API-Key: <server-side>
X-NYV-Platform: nsp
Content-Type: application/json

{
  "identifier": "APHC010000832023",
  "options": {
    "profile": "caseCreate",
    "includeDocuments": true,
    "includeTimeline": true,
    "includeParseGuide": true,
    "courtType": "hc"
  }
}
```

---

## 5. NyayaSearch improvements (same contract — implemented in repo)

| Priority | Item | Implementation |
|----------|------|------------------|
| **P0** | Single resolve SSoT | `nv-cnr-gateway-proxy.ts` → NYV `/sdk/cnr/resolve`; env `NYV_API_BASE_URL`, `NYV_SDK_KEY_*`; disable with `NYV_CNR_SSOT=0` |
| **P0** | Dashboard UX | `CaseFieldSections.tsx` + `cnrFieldGroups.ts` — 14 groups, empty = “not in corpus”; `CaseLookup` deep-search copy |
| **P1** | Deploy | Rebuild worker API + static dashboard on caselaw-worker (**GO** required) |
| **P1** | Corpus freshness | Ops: unblock `case-api-rds-daily` shrink guard (tracker) |
| **P2** | HC order presign / live eCourts | Unchanged platform blocks |

---

## 6. Verification

```bash
cd nyayavigya-platform-312 && npm run demo:probe:ec2
npm run probe:nysapi:freshness:ec2
npm run probe:nys-handover:rds:ec2
```

After NyayaSearch deploy: Case Lookup → known CNR → Case Detail should list all 14 groups with NYV envelope (when gateway env configured on worker).

---

## 7. Related artifacts

- SDK types: `packages/client-sdk/src/api/CnrApi.ts` (`CnrResolveFieldKey`, `NspParseContractEntry`)
- Export contract: `npm run` / `npx tsx scripts/nv-export-nsp-parse-contract.ts`
- Golden HC row (mobile-depth): `APHC010000832023` in §17.6 of case-search handoff
