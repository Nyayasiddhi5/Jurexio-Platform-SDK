# NSP → NYV Docparse Agent Recover API (gap-only)

**ID:** NV-DOCPARSE-NSP-AGENT-RECOVER-001  
**Audience:** NSP BFF / mobile — call **only** when local `@nyv/docparse-sdk` could not OCR pages or map autofill.  
**Not for:** every upload (local first), **not** a substitute for bulk jobs.

Cross-links: [`NSP-DOCPARSE-LOCAL-FIRST-HANDOFF.md`](./NSP-DOCPARSE-LOCAL-FIRST-HANDOFF.md) · [`DOCPARSE-TEXTRACT-BACKUP-ARCHITECTURE-2026-10.md`](./DOCPARSE-TEXTRACT-BACKUP-ARCHITECTURE-2026-10.md)

---

## When NSP calls NYV (two cases)

| Case | NSP action | NYV endpoint |
|------|------------|--------------|
| **A — Large / bulk** | Local policy routes to async | `POST /api/nv/v1/sdk/docparse/jobs` (or `/jobs/batch`) |
| **B — Local parse gap** | Empty pages, human-review flags, zero resolved fields | **`POST /api/nv/v1/sdk/docparse/nsp/agent-recover`** |

Case **B** runs on NYV: **force OCR + Textract cloud hook + partial LLM (snippet gaps only)** + **extractive summary** (no full `/documents/analyze` unless you opt in separately).

`NspHybridDocparseClient` calls agent-recover automatically when `nspAgentRecoverOnGap !== false` (default **on**) and NYV bridge is configured.

---

## Endpoint

```
POST /api/nv/v1/sdk/docparse/nsp/agent-recover
```

### Headers (required)

| Header | Value |
|--------|--------|
| `X-API-Key` | NSP partner SDK key |
| `X-NYV-Platform` | **`nsp`** (or `nsp-pro`) — otherwise **403** |
| `Content-Type` | `application/json` |

### Body

```json
{
  "base64": "<same file NSP already parsed locally>",
  "fileName": "Vasee & Company.pdf",
  "mimeType": "application/pdf",
  "domainPackId": "legal-in-civil",
  "jurisdiction": "IN",
  "localParse": {
    "unparsedPageNos": [1],
    "humanReviewPageNos": [1],
    "lowConfidenceFieldPaths": ["company.name", "registration.number"],
    "qualityBand": "low",
    "localEngineVersion": "local"
  },
  "options": {
    "partialLlm": true,
    "extractiveSummary": true,
    "humanReviewPagesOnly": true
  }
}
```

### Response `200`

```json
{
  "success": true,
  "data": {
    "mode": "nsp-agent-recover",
    "domainPackId": "legal-in-civil",
    "partialRecoveryApplied": true,
    "unparsedPagesAfterRecover": [],
    "extractiveSummary": ["…"],
    "caseCreate": { "resolved": [], "absent": [], "conflicts": [], "lowConfidence": [], "withheld": [], "fields": {} },
    "companyProfile": { "primaryDocType": "STATE_COMPANY_REGISTRATION", "fields": {} },
    "userProfile": { "userProfile": { "fullName": "…" }, "primaryDocType": "PAN_CARD", "withheld": ["ids.aadhaar"] },
    "evidence": { "docTypes": ["EVIDENCE_PHOTO"], "needsDepiction": true, "visibleText": "…" },
    "legalParseGuide": {},
    "docparseIntelligence": {},
    "extraction": {}
  }
}
```

`extraction` is the full `@nyv/docparse-sdk` result (for NSP audit). Bind UI from `caseCreate` / `companyProfile` / `userProfile` (KYC) / `evidence` (attachments) + `legalParseGuide`.

**Related (partial parse, no re-OCR):** `POST …/nsp/attach-understand` — see [`NSP-NYV-DOCPARSE-PARTNER-REQUIREMENTS-ONE-PAGER-2026-10-15.md`](./NSP-NYV-DOCPARSE-PARTNER-REQUIREMENTS-ONE-PAGER-2026-10-15.md).

### Errors

| HTTP | Code | Meaning |
|------|------|---------|
| 403 | `NSP_AGENT_RECOVER_PLATFORM` | Missing/wrong `X-NYV-Platform` |
| 503 | `DOCPARSE_SDK_DISABLED` | `NYV_F_DOCPARSE_SDK=0` on NYV |
| 422 | — | Parse/recover failed (sanitized message) |

---

## NSP integration patterns

### 1. Hybrid client (recommended)

```typescript
import { NspHybridDocparseClient, createNspDefaultDocparseRuntime } from "@nyayavigya/nsp-docparse";

const runtime = createNspDefaultDocparseRuntime();
const client = new NspHybridDocparseClient({
  nyv: { baseUrl: NYV_API, apiKey: NYV_SDK_KEY, platform: "nsp" },
});

const result = await client.parse(files, {
  batchId,
  actor: "nsp:upload",
  ...runtime,
  policy: { ...runtime.policy, nspAgentRecoverOnGap: true },
});

if (result.nyvAgentRecover) {
  // caseCreate / companyProfile refreshed from NYV
}
```

### 2. Direct HTTP / `@nyayavigya/client-sdk`

```typescript
await nyv.docparse.nspAgentRecover({
  base64,
  fileName,
  domainPackId: "legal-in-civil",
  localParse: buildLocalParseHints(localExtraction),
});
```

(Client must send `X-NYV-Platform: nsp`.)

### 3. Manual gap detect (local-only first)

```typescript
import { localParseNeedsNyvAgentRecover, buildLocalParseHints } from "@nyayavigya/nsp-docparse";

if (localParseNeedsNyvAgentRecover(localExtraction)) {
  await bridge.agentRecover(payload, buildLocalParseHints(localExtraction));
}
```

---

## Cost / AI token policy on NYV

1. **Textract** — page OCR when cloud hook enabled (`NYV_F_TEXTRACT` / `NSP_TEXTRACT_ENABLED`).  
2. **Partial LLM** — only **missing/low-confidence field paths**, snippet-bound (`NYV_F_DOCPARSE_LLM_FALLBACK=1`).  
3. **Summary** — default **extractive** (deterministic analysis sentences), not full LLM analyze.  
4. Optional **LLM analyze** remains separate: `POST /api/nv/sdk/docs-pipeline/documents/analyze` (user-triggered).

---

## Follow-on (not in this API drop)

| Item | Status |
|------|--------|
| `legal-in-identity` pack (Aadhaar/PAN/DL) | Schema hook exists; profiles **PLANNED** |
| Textract FORMS/TABLES → candidate merge (T3–T4) | **PLANNED** — see Textract architecture doc |
| Per-page image upload (page-only AI without full PDF re-run) | **PLANNED** — v2 body `pageImages[]` |
| **Deploy nysdev** | Requires explicit user **GO deploy** (no key rotation) |

---

## Deploy checklist (NYV)

After **GO deploy**: verify `NYV_F_DOCPARSE_SDK=1`, Textract flags, probe:

```bash
curl -sS -X POST "$NYV/api/nv/v1/sdk/docparse/nsp/agent-recover" \
  -H "X-API-Key: $NYV_SDK_KEY_NSP" -H "X-NYV-Platform: nsp" \
  -H "Content-Type: application/json" \
  -d '{"base64":"...","fileName":"test.pdf","domainPackId":"legal-in-civil"}' | jq .success
```

Tracker: append row on deploy GO with HTTP code only (no document content in logs).
