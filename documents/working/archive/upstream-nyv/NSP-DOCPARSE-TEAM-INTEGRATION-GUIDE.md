# NSP DocParse — Team integration guide (complete)

**Audience:** NSP platform, BFF, Pro UI, and batch-ingest engineers.  
**Priority platforms:** NSP (local-first), NYV (managed legal API), JRX (HTTP docparse jobs + escalation).  
**Engine versions (2026-10-07):** `@nyv/docparse-sdk@1.0.0-alpha.3`, `@nyayavigya/nsp-docparse@1.0.0-alpha.2`.

Short Confluence page: [`NSP-DOCPARSE-INTEGRATION-ONE-PAGER.md`](./NSP-DOCPARSE-INTEGRATION-ONE-PAGER.md).  
Architecture handoff: [`NSP-DOCPARSE-LOCAL-FIRST-HANDOFF.md`](./NSP-DOCPARSE-LOCAL-FIRST-HANDOFF.md).

---

## 1. Download and verify (NSP team)

### Option A — Pre-built tarball (recommended)

| Item | Location |
|------|----------|
| **File** | `NSP-DOCPARSE-LOCAL-BUNDLE-20261007.tar.gz` |
| **NYV monorepo path** | `nyayavigya-platform-312/.local/nsp-docparse-bundle/NSP-DOCPARSE-LOCAL-BUNDLE-20261007.tar.gz` |
| **SHA-256** | See `nyayavigya-platform-312/.local/nsp-docparse-bundle/MANIFEST-20261007.txt` |
| **Cursor user store copy** | Ask platform lead for the file copied to the shared handoff store (same filename). |

```bash
shasum -a 256 NSP-DOCPARSE-LOCAL-BUNDLE-20261007.tar.gz
# must match MANIFEST-20261007.txt

tar -xzf NSP-DOCPARSE-LOCAL-BUNDLE-20261007.tar.gz
cd nsp-docparse-local
# read BUNDLE-README.md and this guide (included in tarball after re-pack)
```

Regenerate from NYV (if you have the monorepo):

```bash
cd nyayavigya-platform-312
npm run nsp:pack:docparse-local
cp .local/nsp-docparse-bundle/nsp-docparse-local-*.tar.gz \
   .local/nsp-docparse-bundle/NSP-DOCPARSE-LOCAL-BUNDLE-20261007.tar.gz
shasum -a 256 .local/nsp-docparse-bundle/NSP-DOCPARSE-LOCAL-BUNDLE-20261007.tar.gz
```

### Option B — Git subtree (ongoing sync)

Vendor these paths into the NSP repo:

- `packages/docparse-sdk/`
- `packages/nsp-docparse/`
- `packages/client-sdk/src/types/NyvLegalDocparse.ts` → `client-sdk-types/`

Track NYV tag or commit SHA in NSP `docparse/VERSION` file.

### Option C — Typed HTTP only (no engine on-box)

Use `@nyayavigya/client-sdk@5.2.2+` against NYV (`NYV_SDK_KEY_NSP` on BFF only). You lose air-gap local parse unless you also ship Option A.

---

## 2. Build on NSP servers

```bash
cd docparse-sdk && npm ci && npm run build && npm test
cd ../nsp-docparse && npm ci && npm run build && npm test
```

**OCR workers (production):** install Tesseract + tessdata (eng + Indic as needed), Poppler (`pdftoppm`). Optional: Paddle OCR for numeric arbitration.

**Env (BFF / worker):**

| Variable | Purpose |
|----------|---------|
| `NYV_API_BASE` | Default `https://api.nyayasiddhi.online` |
| `NYV_SDK_KEY` | NSP partner key — **server only** |
| `NYV_F_DOCPARSE_LLM_FALLBACK` | On NYV only; NSP local snippet LLM = inject your own `partialFieldRecovery` if needed |

---

## 3. Feature matrix — what to wire

| Feature | Local (`NspHybridDocparseClient`) | NYV HTTP (escalation) |
|---------|-----------------------------------|------------------------|
| Deterministic parse + OCR | `parse()` → `runComplete` internally | `POST …/documents/parse` with `base64` |
| PII + redaction | `docparseIntelligence`, governance | Same in `docparseMeta` |
| Legal autofill four states | `legalParseGuide` | `docparseMeta.legalParseGuide` |
| **Case create / matter autofill** | **`result.caseCreate`** (draft + provenance) | Map from `fields` + `legalParseGuide` |
| Extractive legal intel (no full-doc LLM) | `docparseIntelligence.extractiveLegal` | Bundled on NYV when SDK path used |
| Partial LLM (snippets only) | Optional `partialFieldRecovery` in `opts` | `NYV_F_DOCPARSE_LLM_FALLBACK=1` on NYV |
| Cloud OCR fallback | Optional `cloudOcr` provider | NYV GOT OCR on gateway |
| **AWS Textract backup** | `createNspTextractCloudOcrReference()` → `opts.cloudOcr` | NYV `NYV_F_TEXTRACT=1` + IAM `textract:AnalyzeDocument` (ap-south-1) — [`DOCPARSE-TEXTRACT-BACKUP-ARCHITECTURE-2026-10.md`](./DOCPARSE-TEXTRACT-BACKUP-ARCHITECTURE-2026-10.md) |
| Large / batch jobs | In-memory jobs in SDK; prefer NYV queue | `POST /api/nv/v1/sdk/docparse/jobs` |
| **Bulk corpus** | Loop local or call NYV batch | `POST /api/nv/v1/sdk/docparse/jobs/batch` |
| AI obligations/risks (full LLM) | `policy.includeNyvIntelligence` | `POST …/documents/analyze` |
| Domain packs | `domainPackId: "legal-in"` | Same + `GET …/docparse/packs` |

---

## 4. BFF integration (recommended)

```typescript
import {
  NspHybridDocparseClient,
  mapExtractionToUserProfileHints,
} from "@nyayavigya/nsp-docparse";
import { nspAutofillAction } from "../types/NyvLegalDocparse";

const docparse = new NspHybridDocparseClient({
  nyv: process.env.NYV_SDK_KEY
    ? {
        baseUrl: process.env.NYV_API_BASE ?? "https://api.nyayasiddhi.online",
        apiKey: process.env.NYV_SDK_KEY,
        platform: "nsp",
      }
    : undefined,
});

// Optional Textract on NSP AWS (install @aws-sdk/client-textract):
// import { createNspTextractCloudOcrReference } from "@nyayavigya/nsp-docparse";
// cloudOcr: createNspTextractCloudOcrReference({ region: "ap-south-1" }),

export async function ingestMatterDocument(file: Buffer, fileName: string) {
  const result = await docparse.parse(
    [{ bytes: new Uint8Array(file), fileName, mime: "application/pdf" }],
    {
      batchId: `nsp-${Date.now()}`,
      actor: "nsp:pro:upload",
      domainPackId: "legal-in",
      jurisdiction: "IN",
      policy: {
        criticalFiling: false,
        includeNyvIntelligence: false,
        escalateLocalQualityBelow: "low",
      },
      run: { preferOcr: false, forceOcr: false },
    },
  );

  // Matter / case API payload
  const caseDraft = result.caseCreate?.draft;
  const profileHints = result.extraction
    ? mapExtractionToUserProfileHints(result.extraction)
    : undefined;

  // Pro UI — four-state autofill
  const guide = result.legalParseGuide as { entries?: Array<{ fieldPath: string; autofillHint: string }> } | undefined;
  for (const entry of guide?.entries ?? []) {
    const uiAction = nspAutofillAction(entry.autofillHint);
    // bind | suggest | chooser | empty | withheld → wire to form controls
    void uiAction;
  }

  return {
    tier: result.tier,
    engine: result.engine,
    caseDraft,
    profileHints,
    meta: result.docparseMeta,
    provenance: result.caseCreate?.provenance,
    conflicts: result.caseCreate?.conflicts,
    lowConfidence: result.caseCreate?.lowConfidence,
    absent: result.caseCreate?.absent,
  };
}
```

---

## 5. NSP Pro UI checklist

- [ ] Bind `legalParseGuide.entries[]` via `nspAutofillAction()` — never collapse to filled/blank only.
- [ ] Pre-fill from `caseCreate.draft` (CNR, court, parties, FIR, sections) where confidence allows.
- [ ] Show chooser for `caseCreate.conflicts`; suggest chips for `lowConfidence`.
- [ ] Label `absent` as “not found in document”, not error.
- [ ] Respect withheld / PII hints — do not log raw values (NV-SECRETS spirit).
- [ ] Display `result.tier` + `result.engine` in upload telemetry (local vs NYV).
- [ ] Handwriting / low OCR: surface `humanReviewRequired` from intelligence envelope when present.

---

## 6. Bulk backfill (NSP orchestration)

Use NYV batch jobs when corpus is large (Redis queue on NYV). **Max 8 batch items per request; 5 files per item** (gateway cap).

```typescript
async function enqueueCorpusBatch(items: Array<{ base64: string; fileName: string }[]>) {
  const res = await fetch(`${NYV_API_BASE}/api/nv/v1/sdk/docparse/jobs/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": process.env.NYV_SDK_KEY!,
    },
    body: JSON.stringify({
      domainPackId: "legal-in",
      batches: items.map((documents) => ({
        documents: documents.map((d) => ({
          base64: d.base64,
          fileName: d.fileName,
          mimeType: "application/pdf",
        })),
      })),
    }),
  });
  const { data } = await res.json();
  return data.jobIds as string[];
}

// Poll: GET /api/nv/v1/sdk/docparse/jobs/:jobId → result when status === "done"
```

For **local-only** bulk, loop `client.parse()` with worker pool and persist `caseCreate` per document.

---

## 7. JRX (same engine, JRX key)

JRX does not need a separate SDK fork. Use:

- **HTTP:** `/api/nv/v1/sdk/jrx/docparse/*` (same as `/api/nv/v1/sdk/docparse/*`) with **JRX** `X-API-Key`.
- **Hybrid client:** `platform: "jrx"` on `NyvDocparseBridge` if embedding `nsp-docparse` on JRX infrastructure.

NYV managed scope remains **India legal + PII** on the default pack; JRX US bar guardrails are separate (gateway safety pipeline).

---

## 8. NYV alignment (when platform team sends GO deploy)

After NYV deploys latest gateway to nysdev/prod, NSP should verify:

| Check | Command / endpoint |
|-------|-------------------|
| Health | `GET /api/nv/health` → 200 |
| Packs | `GET /api/nv/v1/sdk/docparse/packs` → 401 without key; 200 with NSP key |
| Binary parse | `POST …/documents/parse` with `base64` |
| Batch | `POST …/docparse/jobs/batch` |
| Legal gate OCR | NYV ops: `npm run docparse-sdk:gate:legal:ec2` |

NSP does **not** need to rotate keys for this deploy.

---

## 9. Support contacts / evidence

- Status: [`DOCPARSE-LEGAL-GLOBAL-BEST-STATUS-2026-10.md`](./DOCPARSE-LEGAL-GLOBAL-BEST-STATUS-2026-10.md)
- Multi-domain (logistics/health/BFSI): [`DOCPARSE-MULTI-DOMAIN-AND-DEPLOYMENT-GUIDE.md`](./DOCPARSE-MULTI-DOMAIN-AND-DEPLOYMENT-GUIDE.md)
- NYV legal gate (CI reference): `npm run docparse-sdk:gate:legal` — 385 unit tests + corpus benchmark

---

## 10. NSP sign-off checklist

- [ ] Tarball verified (SHA-256)
- [ ] Workers built with OCR deps
- [ ] BFF uses `NspHybridDocparseClient`
- [ ] Pro UI wired (guide + `caseCreate`)
- [ ] Bulk job poller for backfill
- [ ] NYV key in secrets manager (BFF only)
- [ ] Metrics: tier, engine, completeness ratio
