# NSP ↔ NYV — CNR Corpus Resolve API Contract

> **Status:** LIVE on nysdev (`2026-08-09T1812Z-aws-ssm`) + NYS worker  
> **Audience:** NSP backend / New Case Lookup Case integration  
> **Honesty lock:** This is **judgment corpus / Open Data** resolve — **never** claim “eCourts”, “live court sync”, or “Court Sync (eCourts)”.  
> **UI badge:** `Suggested · Judgment corpus`  
> **Related design:** [`NSP-CNR-RESOLVE-CORPUS-PLAN-2026-08.md`](./NSP-CNR-RESOLVE-CORPUS-PLAN-2026-08.md)

---

## 1. Base URL & auth

| Item | Value |
|---|---|
| Base URL | `https://api.nyayasiddhi.online` |
| Mount prefix | `/api/nv/v1/sdk/cnr` |
| Auth header (canonical) | `X-API-Key: <NYV_SDK_KEY_NSP>` |
| Auth fallback | `Authorization: Bearer <NYV_SDK_KEY_NSP>` |
| Platform | `X-NYV-Platform: nsp` (required for partner India scope) |
| Content-Type | `application/json` |

**Do not** call NYS (`nyayasearch`) directly from NSP. Always go through NYV.

### SDK (optional)

```ts
import { NyvClient } from '@nyayavigya/client-sdk'; // ≥ 5.0.9

const nyv = new NyvClient({
  apiKey: process.env.NYV_SDK_KEY_NSP!,
  baseUrl: 'https://api.nyayasiddhi.online',
  defaultPlatform: 'nsp',
  timeout: 65_000, // see §5
});

const res = await nyv.cnr.resolve({
  cnr: 'RJHC010324382023',
  options: { includeDocuments: true, fuzzyLimit: 5 },
});
```

---

## 2. Endpoints (NSP-facing)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/nv/v1/sdk/cnr/health` | Liveness / product metadata |
| `POST` | `/api/nv/v1/sdk/cnr/resolve` | **Primary** — Lookup Case autofill |
| `GET` | `/api/nv/v1/sdk/cnr/{cnr}` | Same as resolve (always includes documents) |
| `GET` | `/api/nv/v1/sdk/cnr/{cnr}/documents` | Judgment/order list + optional presigned URLs |
| `POST` | `/api/nv/v1/sdk/cnr/enrich` | Optional lawyer write-through enrichment |

---

## 3. `POST /api/nv/v1/sdk/cnr/resolve` (primary)

### 3.1 Request

```http
POST /api/nv/v1/sdk/cnr/resolve HTTP/1.1
Host: api.nyayasiddhi.online
Content-Type: application/json
X-API-Key: nyv_live_sk_nsp_…
X-NYV-Platform: nsp

{
  "cnr": "RJHC010324382023",
  "options": {
    "includeDocuments": true,
    "includeExtractPreview": false,
    "fuzzyLimit": 5,
    "jurisdiction": "IN"
  }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `cnr` | string | one of `cnr` / `cnrNumber` | Raw CNR; server normalizes |
| `cnrNumber` | string | alias | Same as `cnr` |
| `options.includeDocuments` | boolean | no | default `true` if omitted on GET; for POST omit or set explicitly |
| `options.includeExtractPreview` | boolean | no | reserved; ignored in v1 |
| `options.fuzzyLimit` | int 1–10 | no | default `5` — candidates when no exact hit |
| `options.jurisdiction` | string | no | informational; corpus is IN |

**Normalization (server):** trim → uppercase → strip spaces / `-` / `_` / `.`

**Validation:**

| Result | Rule |
|---|---|
| `ok` | exactly 16 alphanumeric after normalize (classic Indian CNR) |
| `soft` | length 10–20 alphanumeric (still resolved) |
| `invalid` → HTTP 400 | empty, non-alnum, or length outside 10–20 |

### 3.2 Response envelope

Always JSON. Partner fields NYV may add:

```json
{
  "success": true,
  "claimEcourts": false,
  "source": "nys-cnr-corpus",
  "data": { "...": "see below" }
}
```

`claimEcourts` is **always** `false` (top-level and/or inside `data`).

### 3.3 `data.status` (business outcome — use this for UX)

| `data.status` | HTTP | Meaning | NSP UX |
|---|---|---|---|
| `found` | 200 | Exact CNR in corpus | Prefill form; show `data.ui.badge` |
| `suggested` | 200 | No exact; fuzzy candidates | Modal pick list; **no silent overwrite** |
| `not_found` | 200 | No corpus hit | Miss modal + continue manually |
| `invalid` | 400 | Bad CNR shape | Inline field error |

> Note: `not_found` / `suggested` are **success: true** with HTTP 200. Do not treat as transport errors.

### 3.4 Response — `found` (example, live shape)

```json
{
  "success": true,
  "claimEcourts": false,
  "source": "nys-cnr-corpus",
  "data": {
    "cnr": "RJHC010324382023",
    "status": "found",
    "matchType": "exact",
    "source": "nys_rds",
    "sourcesTried": ["nys_rds", "cnr_case_details"],
    "confidence": 0.97,
    "claimEcourts": false,
    "validation": "ok",
    "ui": {
      "badge": "Suggested · Judgment corpus",
      "subtitle": "From NyayaSearch / Open Data judgment index — not live eCourts status"
    },
    "fields": {
      "courtName": { "value": "High Court Of Rajasthan", "source": "nys_rds", "confidence": 0.97 },
      "courtType": { "value": "hc", "source": "nys_rds", "confidence": 0.97 },
      "caseType": { "value": null, "source": null, "confidence": 0 },
      "caseNo": { "value": null, "source": null, "confidence": 0 },
      "petitioner": { "value": "…", "source": "nys_rds", "confidence": 0.95 },
      "respondent": { "value": "…", "source": "nys_rds", "confidence": 0.95 },
      "judges": { "value": ["…"], "source": "nys_rds", "confidence": 0.85 },
      "decisionDate": { "value": "2023-…", "source": "nys_rds", "confidence": 0.95 },
      "disposalNature": { "value": "…", "source": "nys_rds", "confidence": 0.8 },
      "filingDate": { "value": null, "source": null, "confidence": 0, "note": "often absent in judgment metadata" },
      "nextHearingDate": { "value": null, "source": null, "confidence": 0, "note": "requires live docket — not in corpus v1" },
      "caseStatus": { "value": "DISPOSED", "source": "nys_rds", "confidence": 0.7, "note": "inferred from disposal / decision date when present" },
      "actsSections": { "value": [], "source": null, "confidence": 0 },
      "advocates": { "value": [], "source": "nys_rds", "confidence": 0.7 }
    },
    "documents": [
      {
        "id": "jdg_123",
        "kind": "judgment",
        "title": "…",
        "decisionDate": "2023-…",
        "s3Path": "s3://ns-highcourt-data-bucket/…",
        "pdfUrlKind": "presigned",
        "sourceArchive": "hc",
        "judgmentId": 123
      }
    ],
    "candidates": [],
    "meta": {
      "attribution": "Judgment metadata © contributors / AWS Open Data (vanga indian-*-court-judgments), CC-BY-4.0. Not live eCourts status.",
      "latencyMs": 5
    }
  }
}
```

`sourceArchive` values: `"sc" | "hc" | "dc" | "unknown"`. District (`dc`) rows today are Andhra Pradesh + Telangana only (`cino` from vanga Open Data).

### 3.5 Field object shape

Every entry under `data.fields`:

```ts
{
  value: unknown;          // string | string[] | null | …
  source: string | null;   // e.g. nys_rds | opendata_hc_parquet | opendata_hc_case_details
  confidence: number;      // 0..1
  note?: string;           // human helper when empty / inferred
}
```

**NSP field map (New Case / 02b):**

| Resolve field | Suggested NSP form field |
|---|---|
| `cnr` | CNR / filing number (lock from input) |
| `fields.courtName` / `courtType` | Court (map by name if catalog allows) |
| `fields.caseType` / `caseNo` | Case type / filing number |
| `fields.petitioner` / `respondent` | Parties / title (`A vs B` if title empty) |
| `fields.decisionDate` | Decision / disposed date if form has it |
| `fields.nextHearingDate` | **Leave empty** — show helper from `note` |
| `documents[0]` | Optional “Attach judgment” (presign via documents API) |

Show `data.ui.badge` (or chip per `fields.*.source`). Never overwrite user-edited fields silently after first apply.

### 3.6 Response — `suggested`

```json
{
  "success": true,
  "claimEcourts": false,
  "source": "nys-cnr-corpus",
  "data": {
    "cnr": "…",
    "status": "suggested",
    "matchType": "fuzzy",
    "claimEcourts": false,
    "ui": {
      "badge": "Possible matches · Judgment corpus",
      "subtitle": "No exact CNR hit — pick a candidate or continue manually"
    },
    "fields": null,
    "documents": [],
    "candidates": [
      {
        "cnr": "RJHC010324382023",
        "title": "…",
        "courtName": "High Court Of Rajasthan",
        "decisionDate": "2023-…",
        "confidence": 0.55,
        "source": "nys_fts"
      }
    ],
    "meta": { "attribution": "…", "latencyMs": 400 }
  }
}
```

On pick: call `resolve` again with `candidates[i].cnr` (or `GET /cnr/{cnr}`).

### 3.7 Response — `not_found`

```json
{
  "success": true,
  "claimEcourts": false,
  "source": "nys-cnr-corpus",
  "data": {
    "cnr": "ZZZZ999999999999",
    "status": "not_found",
    "matchType": "none",
    "claimEcourts": false,
    "ui": {
      "badge": "Not found in judgment corpus",
      "subtitle": "Continue manually — corpus does not include live pending dockets"
    },
    "fields": null,
    "documents": [],
    "candidates": [],
    "meta": { "attribution": "…", "latencyMs": 1776 }
  }
}
```

NSP: modal + **Continue manually** — do not block case create.

### 3.8 Response — `invalid` (HTTP 400)

```json
{
  "success": false,
  "claimEcourts": false,
  "source": "nys-cnr-corpus",
  "error": {
    "code": "CNR_INVALID",
    "message": "CNR length must be 10–20 characters"
  },
  "data": {
    "cnr": "SHORT",
    "status": "invalid",
    "claimEcourts": false,
    "ui": { "badge": "Invalid CNR", "subtitle": "CNR length must be 10–20 characters" },
    "fields": null,
    "documents": [],
    "candidates": []
  }
}
```

---

## 4. Other endpoints

### 4.1 Health

```http
GET /api/nv/v1/sdk/cnr/health
```

```json
{
  "success": true,
  "data": {
    "product": "CNR corpus resolve",
    "code": "cnr-resolve",
    "claimEcourts": false,
    "badge": "Suggested · Judgment corpus",
    "status": "ready"
  }
}
```

`status`: `ready` | `nys_unconfigured`

### 4.2 GET by CNR

```http
GET /api/nv/v1/sdk/cnr/{cnr}
```

Same `data` shape as resolve with `includeDocuments: true`. URL-encode the CNR.

### 4.3 Documents

```http
GET /api/nv/v1/sdk/cnr/{cnr}/documents
```

```json
{
  "success": true,
  "claimEcourts": false,
  "source": "nys-cnr-corpus",
  "data": {
    "cnr": "RJHC010324382023",
    "claimEcourts": false,
    "documents": [
      {
        "id": "jdg_123",
        "kind": "judgment",
        "title": "…",
        "decisionDate": "…",
        "s3Path": "s3://…",
        "pdfUrlKind": "presigned",
        "sourceArchive": "hc",
        "url": "https://…presigned…",
        "expiresIn": 300
      }
    ]
  }
}
```

Presigned URLs expire in **300 seconds**. Re-fetch before open if expired.

### 4.4 Enrich (optional)

```http
POST /api/nv/v1/sdk/cnr/enrich
Content-Type: application/json

{
  "cnr": "RJHC010324382023",
  "petitioner": "…",
  "respondent": "…",
  "caseType": "…",
  "caseNo": "…",
  "courtCode": "…",
  "filingDate": "2024-01-15",
  "decisionDate": "2024-03-12",
  "caseStatus": "PENDING"
}
```

Writes non-PII judgment metadata into NYS `cnr_case_details` (`source: lawyer_enrichment`). Use only with tenant consent / policy.

---

## 5. Timeouts (NSP client)

| Layer | Budget | Notes |
|---|---|---|
| **NSP → NYV recommended client timeout** | **65 000 ms** | Slightly above NYV→NYS proxy |
| NYV → NYS proxy (resolve) | 60 000 ms | Hardcoded on CNR routes |
| Warm RDS exact hit (p95 target) | &lt; 200 ms | Live samples ~5–40 ms |
| Cold Athena / fuzzy path | up to several seconds | Still within 60s |
| Documents presign | same 60s budget | Usually fast |

**Retry guidance:**

| Condition | Retry? |
|---|---|
| `5xx` / network / timeout | Yes — 1–2 retries, exponential backoff (250–2000 ms) |
| `429` | Yes — respect Retry-After if present |
| `400 CNR_INVALID` | No |
| `401` / `403` | No — fix key / platform header |
| `200` + `not_found` / `suggested` | No — business outcome |

Idempotent: resolve/get/documents are safe to retry.

---

## 6. Error codes

### 6.1 Auth / gateway (before resolve)

| HTTP | `error.code` | Meaning |
|---|---|---|
| 401 | `AUTH_TOKEN_MISSING` / `API_KEY_INVALID` | Missing or wrong `X-API-Key` |
| 403 | (scope / India gate) | Platform/jurisdiction not allowed |
| 503 | `QUEUE_UNAVAILABLE` | NYS knowledge base not configured on NYV |

### 6.2 CNR business / upstream

| HTTP | `error.code` | Meaning |
|---|---|---|
| 400 | `CNR_INVALID` | Shape / required field failed |
| 500 | `CNR_RESOLVE_FAILED` | NYS resolver threw |
| 500 | `CNR_PROXY_FAILED` | NYV proxy exception |
| 502 / 503 | `NYS_UPSTREAM` | NYS unreachable / circuit / sanitized upstream error |
| 500 | `CNR_DOCS_FAILED` | Documents listing failed |
| 500 | `CNR_ENRICH_FAILED` | Enrichment failed |

Error body shape:

```json
{
  "success": false,
  "claimEcourts": false,
  "source": "nys-cnr-corpus",
  "error": { "code": "NYS_UPSTREAM", "message": "…" }
}
```

---

## 7. Cascade (what “found” means)

1. **RDS** exact `cnr = normalized` (~20M+ indexed judgments)  
2. **Athena / Open Data parquet** (SC/HC) if miss — write-through to RDS  
3. **FTS fuzzy** → `suggested` candidates  

Never live eCourts. Attribution in `data.meta.attribution` (CC-BY-4.0 Open Data).

---

## 8. NSP integration checklist

1. Server-side only: call NYV with `NYV_SDK_KEY_NSP` (never expose key to browser).  
2. Prefer BFF `POST /ns/v1/cnr/resolve` if already mounted (proxies this contract).  
3. Switch on `data.status` — not only HTTP status.  
4. Copy: use `data.ui.badge` / `subtitle`; ban “eCourts” on this path.  
5. Prefill only empty fields; mark autofilled chips from `fields.*.source`.  
6. Leave `nextHearingDate` empty in v1.  
7. Client timeout ≥ 65s; show spinner “Looking up judgment corpus…”.  
8. On `suggested`: modal picker → re-resolve chosen CNR.  
9. On `not_found`: continue manual case create.  
10. Optional: attach PDF via `/documents` presigned `url` (refresh if &gt; 5 min).

### Minimal fetch example (NSP API)

```ts
async function resolveCnr(cnr: string) {
  const res = await fetch(`${NYAYAVIGYA_API_URL}/api/nv/v1/sdk/cnr/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.NYV_SDK_KEY_NSP!,
      'X-NYV-Platform': 'nsp',
    },
    body: JSON.stringify({
      cnr,
      options: { includeDocuments: true, fuzzyLimit: 5 },
    }),
    signal: AbortSignal.timeout(65_000),
  });
  const json = await res.json();
  // Handle 401/403/5xx via json.error
  // Handle business via json.data?.status
  return { httpStatus: res.status, ...json };
}
```

---

## 9. Live smoke references (2026-08-09)

| Probe | Result |
|---|---|
| `GET …/cnr/health` | 200 `ready` |
| `POST …/resolve` `{cnr:"SHORT"}` | 400 `CNR_INVALID` |
| `POST …/resolve` unknown 16-char | 200 `not_found` |
| `POST …/resolve` known HC CNR | 200 `found` / `nys_rds` / ~5 ms / `claimEcourts:false` |

---

## 10. What this API does **not** provide (v1)

- Live next hearing / cause list / eCourts case status  
- Guaranteed filing date for all matters  
- District court coverage until Open Data DC GA  
- Real-time pending (undisposed) dockets absent from judgment corpus  

For those, keep manual entry; optional future “Live eCourts” tier is a separate API with a different badge.
