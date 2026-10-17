# NSP DocParse — local-first handoff (full source + NYV escalation)

**Audience:** NSP platform / BFF engineers integrating document parsing on-premises first, with optional NYV for scale and AI.

**Confluence short form:** [`NSP-DOCPARSE-INTEGRATION-ONE-PAGER.md`](./NSP-DOCPARSE-INTEGRATION-ONE-PAGER.md)

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ NSP Pro / mobile → NSP BFF (your servers)                    │
│   NspHybridDocparseClient.parse(files, { policy })           │
│        │                                                     │
│        ├─ tier: local  ──► @nyv/docparse-sdk runComplete()  │
│        │                     OCR · PII · caseCreate · guide  │
│        │                                                     │
│        ├─ tier: nyv-sync ──► NYV POST …/documents/parse     │
│        │                     (critical / low local quality)  │
│        │                                                     │
│        ├─ tier: nyv-async ─► NYV POST …/docparse/jobs       │
│        │                     (≥4 MiB / ~80+ pages default)   │
│        │                                                     │
│        ├─ tier: nyv-gap ───► NYV POST …/nsp/agent-recover     │
│        │                     (local failed pages / fields)   │
│        └─ optional ────────► NYV POST …/documents/analyze   │
│                              (obligations/risks AI only)     │
└─────────────────────────────────────────────────────────────┘
```

**Principle:** Same engine code (`@nyv/docparse-sdk`) runs locally and on NYV — no forked parser in NSP repo. NYV adds managed OCR capacity, queue, and LLM intelligence.

---

## 2. Source code NSP receives

| Path (NYV monorepo) | Purpose |
|---|---|
| `packages/docparse-sdk/` | **Full engine** — pipeline, OCR, domain packs, contracts |
| `packages/nsp-docparse/` | **Hybrid router** + NYV HTTP bridge + policy |
| `packages/client-sdk/src/types/NyvLegalDocparse.ts` | UI bind types + `nspAutofillAction()` |

**Pack for transfer:**

```bash
cd nyayavigya-platform-312
chmod +x scripts/nsp-pack-docparse-local.sh
npm run nsp:pack:docparse-local
# → .local/nsp-docparse-bundle/nsp-docparse-local-<UTC>.tar.gz
```

Extract on NSP side, build both packages (see `packages/nsp-docparse/README.md`).

---

## 3. Install on NSP platform

### 3.1 Dependencies (local OCR)

Node **≥ 20.11**. Engine optional natives (install on NSP workers that OCR):

- **Tesseract** + tessdata (English + Indic as needed)
- **Poppler** (`pdftoppm`) for PDF rasterisation
- **Paddle OCR** optional (`ppu-paddle-ocr`) for arbitration

Without natives, text-layer PDFs still parse; scanned PDFs need raster path.

### 3.2 npm link (from copied trees)

```json
{
  "dependencies": {
    "@nyv/docparse-sdk": "file:./vendor/docparse-sdk",
    "@nyayavigya/nsp-docparse": "file:./vendor/nsp-docparse"
  }
}
```

---

## 4. Integration code (BFF)

### 4.1 Recommended defaults (2026-10-15 — civil + Textract + prefer OCR)

Same ladder as NYV: **local Tesseract/Paddle → AWS Textract (`NSP_TEXTRACT_ENABLED=1`) → partial LLM on gaps only**.

**IAM (NSP AWS account):** `textract:AnalyzeDocument` in **ap-south-1** (or your region). Env: `NSP_TEXTRACT_ENABLED=1` or `NYV_F_TEXTRACT=1`.

```typescript
import {
  NspHybridDocparseClient,
  createNspDefaultDocparseRuntime,
  createNspTextractCloudOcrReference,
} from "@nyayavigya/nsp-docparse";

const runtime = createNspDefaultDocparseRuntime(/* optional partialFieldRecovery provider */);

const docparse = new NspHybridDocparseClient({ nyv: /* … */ });

await docparse.parse(files, {
  batchId,
  actor: "nsp:bff:upload",
  domainPackId: runtime.domainPackId, // legal-in-civil
  cloudOcr: runtime.cloudOcr,
  partialFieldRecovery: runtime.partialFieldRecovery,
  run: runtime.run, // preferOcr: true
  policy: runtime.policy,
});
// Bind: result.caseCreate | result.companyProfile (full autofill states)
```

### 4.2 Minimal example

```typescript
import {
  NspHybridDocparseClient,
  createNspTextractCloudOcrReference,
} from "@nyayavigya/nsp-docparse";
import { nspAutofillAction } from "./NyvLegalDocparse"; // copied type file

const docparse = new NspHybridDocparseClient({
  nyv: process.env.NYV_SDK_KEY
    ? {
        baseUrl: process.env.NYV_API_BASE ?? "https://api.nyayasiddhi.online",
        apiKey: process.env.NYV_SDK_KEY,
        platform: "nsp",
      }
    : undefined,
});

export async function nspIngestDocument(pdf: Buffer, fileName: string, opts: {
  critical?: boolean;
  wantAiSummary?: boolean;
}) {
  const result = await docparse.parse(
    [{ bytes: new Uint8Array(pdf), fileName, mime: "application/pdf" }],
    {
      batchId: `nsp-${Date.now()}`,
      actor: "nsp:bff:upload",
      domainPackId: "legal-in-civil",
      cloudOcr: createNspTextractCloudOcrReference({ enabled: true }),
      run: { preferOcr: true },
      jurisdiction: "IN",
      policy: {
        criticalFiling: opts.critical === true,
        includeNyvIntelligence: opts.wantAiSummary === true,
        escalateLocalQualityBelow: "low",
      },
    },
  );

  return {
    tier: result.tier,
    engine: result.engine,
    guide: result.legalParseGuide,
    meta: result.docparseMeta,
    fields: result.fields,
    ai: result.nyvAnalyze,
  };
}
```

---

## 5. Policy defaults (align with NYV)

| Condition | Default tier |
|---|---|
| `< 4 MiB` and `< ~80 pages` | **local** |
| `≥ 4 MiB` or large page estimate | **nyv-async** (needs NYV key) |
| `criticalFiling: true` | **nyv-sync** (small) or **nyv-async** (large) |
| Local `qualityBand` **low** | Escalate **nyv-sync** if NYV configured |
| `includeNyvIntelligence: true` | Extra **analyze** call (AI) |

Override: `localOnly: true` for dev/air-gap.

---

## 6. What stays on NYV only

| Capability | Local SDK | NYV API |
|---|---|---|
| Deterministic parse + autofill | Yes | Yes (mirror) |
| PII redaction catalog | Yes | Yes |
| BullMQ long OCR jobs | In-memory jobs only | Redis queue |
| LLM obligations/risks/deadlines | No | `/documents/analyze` |
| Queen / orchestration / RAG | No | `/api/nv/orchestrate` |
| Credit metering / CAM | No | Gateway |

---

## 7. Version alignment

| Artifact | Version (2026-10-07) |
|---|---|
| `@nyv/docparse-sdk` | `1.0.0-alpha.5` |
| `@nyayavigya/nsp-docparse` | `1.0.0-alpha.4` |
| `@nyayavigya/client-sdk` (optional HTTP) | `5.2.2` |

Bump together when NYV ships docparse changes; re-run `docparse-sdk:gate:legal` before NSP upgrades engine copy.

---

## 8. Security

- **NYV SDK key** only on NSP BFF — never in browser.
- Local engine: restrict file size, virus scan, sandbox workers per NSP policy.
- PII: treat `legalParseGuide` withheld hints as non-loggable (same as NYV NV-SECRETS-001 spirit).

---

## 9. Support checklist

**Full NSP runbook:** [`NSP-DOCPARSE-TEAM-INTEGRATION-GUIDE.md`](./NSP-DOCPARSE-TEAM-INTEGRATION-GUIDE.md)

- [ ] Tarball or git subtree of `docparse-sdk` + `nsp-docparse` in NSP repo
- [ ] Worker image with Tesseract/Poppler
- [ ] BFF wired with `NspHybridDocparseClient`
- [ ] Matter UI binds `legalParseGuide` + **`caseCreate.draft`**
- [ ] Bulk backfill via `POST …/docparse/jobs/batch` (NYV) or local worker pool
- [ ] NYV key in prod for async/AI paths only
- [ ] Monitor `result.tier` + `result.engine` in metrics
