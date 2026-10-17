# NSP DocParse — Integration One-Pager (Confluence-ready)

**Model:** **Local-first** on NSP servers → **NYV optional** for large/critical docs + AI.  
**Full source handoff:** [`NSP-DOCPARSE-LOCAL-FIRST-HANDOFF.md`](./NSP-DOCPARSE-LOCAL-FIRST-HANDOFF.md) · pack: `npm run nsp:pack:docparse-local`  
**Live NYV API:** `https://api.nyayasiddhi.online` (escalation tier only)  
**Local engine:** `@nyv/docparse-sdk@1.0.0-alpha.3` + `@nyayavigya/nsp-docparse@1.0.0-alpha.2`  
**NSP team guide (full):** [`NSP-DOCPARSE-TEAM-INTEGRATION-GUIDE.md`](./NSP-DOCPARSE-TEAM-INTEGRATION-GUIDE.md)  
**HTTP types (optional):** `@nyayavigya/client-sdk@5.2.2`  
**Deep docs:** [`DOCPARSE-SDK-INTEGRATION-PLAN-2026-10.md`](./DOCPARSE-SDK-INTEGRATION-PLAN-2026-10.md) · [`DOCPARSE-SDK-PLATFORM-ROADMAP-2026-10.md`](./DOCPARSE-SDK-PLATFORM-ROADMAP-2026-10.md)

---

## 1. What NSP installs (two tiers)

| Tier | Package | Where it runs |
|---|---|---|
| **L1 — Local (default)** | `packages/docparse-sdk` + `packages/nsp-docparse` | NSP BFF / worker — `NspHybridDocparseClient` |
| **L2 — NYV (escalation)** | Same contracts via HTTP | Large PDFs, critical filing, low local quality, AI analyze |

| Artifact | Role |
|---|---|
| **`@nyv/docparse-sdk`** | Full parsing **source** (OCR, PII, legal types, autofill) |
| **`@nyayavigya/nsp-docparse`** | Policy router + NYV bridge; re-exports engine |
| **`NyvLegalDocparse.ts`** | UI bind types (copy from client-sdk) |
| **`@nyayavigya/client-sdk`** | Optional — if you prefer `nyv.docparse.*` over raw fetch |

NSP **browser never** holds NYV keys; local tier needs **no** network. Configure `nyv: { baseUrl, apiKey }` only on workers that may escalate.

---

## 2. Primary flows

### 0 — Hybrid (recommended)

```ts
import { NspHybridDocparseClient } from "@nyayavigya/nsp-docparse";

const client = new NspHybridDocparseClient({
  nyv: { baseUrl: "https://api.nyayasiddhi.online", apiKey: process.env.NYV_SDK_KEY!, platform: "nsp" },
});

const result = await client.parse([{ bytes, fileName: "doc.pdf" }], {
  batchId: "…", actor: "nsp:upload", domainPackId: "legal-in",
  policy: { /* default local < 4MiB; see handoff §5 */ },
});
// result.tier: local | nyv-sync | nyv-async
// result.legalParseGuide → matter autofill
```

### A — NYV-only analyze (legacy / AI-heavy)

### A — Analyze + court fields + docparseMeta (recommended for Pro upload)

**NSP alias most clients already call:**

| Method | Path | Scope |
|---|---|---|
| **POST** | `/api/nv/sdk/docs-pipeline/documents/analyze` | `documents:read` |

Same handler as `/documents/intelligence`. Send **text and/or binary**:

```json
{
  "documentText": "…optional if base64 present…",
  "base64": "<PDF or image>",
  "fileName": "petition.pdf",
  "mimeType": "application/pdf",
  "jurisdiction": "IN",
  "analysisTypes": ["obligations", "risks", "deadlines", "entities"],
  "domainPackId": "legal-in",
  "preferOcr": false,
  "forceOcr": false
}
```

**Response (`data.*`) — bind these keys:**

| Key | Use |
|---|---|
| `fields[]`, `fieldCount`, `fieldSource`, `extractionPath` | Filing metadata (case no., parties, court, FIR, …) |
| `docparseMeta.legalParseGuide` | **Autofill UI** — four states via `nspAutofillAction()` |
| `docparseMeta.docparseResultV1` | Full Platform SDK result envelope |
| `docparseMeta.docparseIntelligence` | Quality band + PII summary |
| `statutes`, `entitiesFlat`, `obligationsFlat`, … | Flat aliases (do not read `entities.length` on nested container) |
| `analysisStatus` | `structured` \| `unstructured` \| `failed` — retry when `failed` |

**SDK:**

```ts
import { NyvClient, nspAutofillAction, type DocparseMetaPartner } from '@nyayavigya/client-sdk';

const nyv = new NyvClient({ apiKey: process.env.NYV_SDK_KEY!, baseUrl: 'https://api.nyayasiddhi.online' });
const data = await nyv.docsPipeline.analyze({ base64, fileName: 'petition.pdf', jurisdiction: 'IN' }) as Record<string, unknown>;
const meta = data.docparseMeta as DocparseMetaPartner | undefined;
for (const entry of meta?.legalParseGuide?.entries ?? []) {
  const action = nspAutofillAction(entry.autofillHint); // bind | suggest | chooser | empty | withheld
}
```

### B — Async jobs (large scans, batch uploads)

| Method | Path |
|---|---|
| **GET** | `/api/nv/v1/sdk/docparse/packs` |
| **POST** | `/api/nv/v1/sdk/docparse/jobs` → **202** `{ jobId, status, batchId }` |
| **GET** | `/api/nv/v1/sdk/docparse/jobs/:jobId` → `progress`, `result` when `done` |

Requires `NYV_F_DOCPARSE_SDK=1` (default on nysdev). Optional `NYV_F_DOCPARSE_JOBS=1` + Redis for BullMQ queue.

**SDK:**

```ts
const { jobId } = await nyv.docparse.submitJob({ base64, fileName: 'bundle.pdf', domainPackId: 'legal-in', preferOcr: true });
let rec = await nyv.docparse.getJob(jobId);
while (rec.status === 'queued' || rec.status === 'running') {
  await sleep(2000);
  rec = await nyv.docparse.getJob(jobId);
}
```

**Large inline ingest:** NYV auto-queues when total bytes ≥ `NYV_DOCPARSE_ASYNC_MIN_BYTES` (default **4 MiB**) and jobs flag + Redis are live.

### C — Parse (dual mode)

| **POST** | `/api/nv/sdk/docs-pipeline/documents/parse` | Scope `documents:write` |

| Body | `parseMode` | `docparseMeta` |
|---|---|---|
| **`base64`** + `fileName` (+ optional OCR flags) | `docparse-deterministic` | **Yes** — same court block as analyze |
| **`content`** + **`format`** (text only) | `llm-structure` | **No** — LLM sections only; use **A** or **B** for filing autofill |

---

## 3. Headers

| Header | Value |
|---|---|
| `X-API-Key` | NSP server SDK key (required) |
| `Content-Type` | `application/json` |
| `X-NYV-Platform` | `nsp` (recommended) |

---

## 4. Domain packs (legal first, then domains)

| `domainPackId` | Jurisdiction | Status |
|---|---|---|
| `legal-in` | IN courts, police, deeds | **Production default** |
| `legal-in-gov` | IN legal + gov admin types | Production |
| `insurance-fnol` | Insurance FNOL POC | JSON pack — post-legal expansion |

List live: `GET /api/nv/v1/sdk/docparse/packs` or `nyv.docparse.listPacks()`.

---

## 5. OCR controls (advanced scans)

| Body field | Effect |
|---|---|
| `preferOcr: true` | Stricter text-layer trust — route garbled/sparse layers to Tesseract/Paddle |
| `forceOcr: true` | OCR every PDF page (annexures, bad pre-OCR layers) |

Supported on **analyze** (with `base64`) and **docparse jobs**.

---

## 6. Feature flags (NYV ops — NSP read-only)

| Env | Default (nysdev) | Meaning |
|---|---|---|
| `NYV_F_DOCPARSE_SDK` | **1** | Platform SDK engine |
| `NYV_F_DOCPARSE_JOBS` | 0 unless set | BullMQ async + large-doc bridge |
| `NYV_F_DOCPARSE_SDK=0` | — | Revert to legacy `@nyv/docparse` only |

---

## 7. Smoke / evidence (no secrets in logs)

```bash
cd nyayavigya-platform-312
npm run demo:probe:ec2                    # health + orchestrate + CNR spot
npm run docparse-sdk:gate:legal            # legal corpus quality gate
npm run nsp:probe:dlct-court-fetch:ec2     # DLCT court-fetch spot
```

---

## 8. NSP UI checklist (not NYV code)

- [ ] Matter upload → **analyze** with `base64` + `fileName`
- [ ] Map `fields[]` to case-create keys (same as CNR four-state UX)
- [ ] Bind `legalParseGuide.entries[]` with `nspAutofillAction()`
- [ ] Badge `fieldSource` / `docparseMeta.engine` — never show “100% complete”
- [ ] When `analysisStatus === 'failed'` → retry; when `unstructured` → do not treat as error
- [ ] Large PDFs → poll **docparse jobs** or wait for async bridge on ecosystem doc jobs

---

## 9. Open items — who unblocks

| Item | Owner | Unblock | On nysdev today |
|---|---|---|---|
| NSP UI → `legalParseGuide` | **NSP** | Pro autofill bind per one-pager §8 | API returns guide when binary ingest runs |
| npm `@nyv/docparse-sdk` | **NYV publish GO** | Commercial license + registry publish | Monorepo + EC2 only |
| Legacy `@nyv/docparse` removal | **NYV** | `docparse-sdk:gate:legal` green 7d + cutover GO | SDK primary; legacy fail-soft |
| This repo’s docparse pass | **NYV deploy GO** | `npm run dev:deploy:ec2` after **GO deploy nysdev** | Last legal-first deploy **`2026-10-06T1636Z`** — newer commits local until deploy |

---

## 10. Still post-legal (global best roadmap)

- Public npm `@nyv/docparse-sdk` + optional `@nyv/docparse-pack-*`
- Additional domain packs (HR, finance, healthcare) after 7d legal gate on nysdev
- Remove legacy-only `@nyv/docparse` path after CI parity bake
- NSP bulk corpus backfill wiring (separate from per-upload analyze)

**Tracker:** `Project-Tracker.md` · **Changelog:** `CHANGELOG.md` `[Unreleased]` NV-DOCPARSE-* entries.
