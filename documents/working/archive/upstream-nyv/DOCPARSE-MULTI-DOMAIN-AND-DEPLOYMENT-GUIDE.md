# DocParse — multi-domain use, other projects, and roadmap

**Scope split (intentional):**

| Surface | Primary domain | Who runs it |
|---------|----------------|-------------|
| **NYV gateway** (`api.nyayasiddhi.online`) | **India legal + PII** (managed) | Nyayavigya ops |
| **NSP** | Legal-first, local-first + NYV escalation | NSP on-prem |
| **JRX** | Legal/PII via HTTP; US bar guardrails on NYV | JRX + NYV |
| **Other sectors** (logistics, health, BFSI) | **Custom domain packs** on **`@nyv/docparse-sdk`** | Your team / separate deploy |

The **same engine** (`@nyv/docparse-sdk`) is the reusable core. NYV production API defaults to `legal-in`; other domains are **pack + deploy**, not a second parser fork.

---

## 1. Best way to get DocParse for non-NSP projects

### Path 1 — Engine only (any Node platform, any sector)

1. Copy **`packages/docparse-sdk/`** from the NSP tarball or monorepo (you do **not** need `nsp-docparse` unless you want NYV hybrid policy).
2. `npm install && npm run build` in that tree.
3. Choose domain:
   - **Legal India:** `domainPackId: "legal-in"` (built-in).
   - **BFSI POC:** `domainPackId: "insurance-fnol"` (JSON pack in `domain-packs/`).
   - **New sector:** add `domain-packs/<your-pack>.json` (see §3).
4. Run:

```typescript
import { DocParseClient, runComplete } from "@nyv/docparse-sdk";

const client = new DocParseClient();
const { extraction, bundle } = await client.runComplete(
  [{ bytes: pdfUint8, fileName: "claim.pdf" }],
  { batchId: "1", actor: "app:ingest", domainPackId: "insurance-fnol" },
);
```

Deploy as: **sidecar microservice**, **worker queue**, or **library inside your BFF** — no NYV account required for air-gap.

### Path 2 — NSP-style hybrid (your app + optional NYV)

Copy **`docparse-sdk` + `nsp-docparse`**, configure `NyvDocparseBridge` with your partner key if you have one. Use for apps that mirror NSP (local default, NYV for large docs).

### Path 3 — HTTP only (legal on NYV)

`@nyayavigya/client-sdk@5.2.2+` → `nyv.docparse.*`, `docsPipeline.analyze`, `docparse/jobs`. **Legal-in only** on managed NYV unless Nyayavigya enables extra packs on gateway (roadmap).

### Path 4 — Separate repo / product (recommended for logistics & health at scale)

Create a **standalone service** (e.g. `your-org/docparse-worker`):

```
your-docparse-service/
├── vendor/docparse-sdk/     # subtree from Nyayavigya
├── domain-packs/
│   ├── logistics-pod.json
│   ├── health-claim.json
│   └── bfsi-kyc.json
├── src/
│   ├── ingest-api.ts        # POST /parse
│   └── worker.ts            # queue + runComplete
└── Dockerfile               # Tesseract + Poppler
```

NYV monorepo stays **legal-only** for compliance and release cadence; sector products ship on their own CI and host.

---

## 2. Download sources (summary)

| Need | Get |
|------|-----|
| NSP full handoff | `NSP-DOCPARSE-LOCAL-BUNDLE-20261007.tar.gz` + `MANIFEST-20261007.txt` |
| Engine source only | `tar -xzf … && cp -r nsp-docparse-local/docparse-sdk ./vendor/` |
| Integration doc for NSP | `NSP-DOCPARSE-TEAM-INTEGRATION-GUIDE.md` (in tarball after re-pack) |
| Legal status / gaps | `DOCPARSE-LEGAL-GLOBAL-BEST-STATUS-2026-10.md` |
| Public npm (future) | `@nyv/docparse-sdk` — `private: true` until license GO; use tarball until then |

---

## 3. Adding a domain pack (logistics / health / BFSI)

1. Copy `domain-packs/insurance-fnol.json` as template.
2. Define `docTypes[]` with `cues`, `antiCues`, `expectedFields` (field paths for autofill completeness).
3. Register pack id in `loadDomainPack()` catalog or load via `loadDomainPackFromFile("your-pack.json")`.
4. Run corpus fixtures + extend benchmark script (clone `nv-docparse-corpus-benchmark.mjs` for your PDF set).
5. **PII:** reuse `listPiiCatalog()` / governance — extend catalog for sector identifiers (policy no, MRN, GSTIN already partially covered).

**Roadmap phases (from this codebase):**

| Phase | Domain | Deliverable | NYV API |
|-------|--------|-------------|---------|
| **Now** | Legal IN | `legal-in`, alpha.3, NSP bundle | Yes (default) |
| **POC** | BFSI | `insurance-fnol.json` | Pack only local / custom deploy |
| **H1** | Health IN | `health-claim-in.json` — forms, discharge summary cues | Optional NYV pack flag |
| **H1** | Logistics | `logistics-pod-in.json` — LR, e-way, invoice tables | Separate worker service |
| **H2** | HR / finance | Payslip, Form 16 packs | Partner-specific |
| **H2** | npm publish | `@nyv/docparse-sdk` public restricted | Documented SemVer |

Handwriting and ruled-table “global best” bar: legal gate first on EC2; sector packs inherit OCR stack, not separate engines.

---

## 4. Deployment patterns by sector

| Pattern | When | Notes |
|---------|------|-------|
| **Embedded library** | Single app, moderate volume | Same process as NSP BFF |
| **Dedicated worker + Redis** | High volume, OCR heavy | Mirror NYV `docparse-sdk` BullMQ worker |
| **Serverless** | Bursty, small pages | Cold start + Tesseract image size limits — usually poor fit |
| **NYV hosted** | Legal only, multi-tenant | NSP/JRX keys; not for logistics PHI without BAA/legal review |

---

## 5. Priority platform summary

| Platform | Integration doc | Domain default |
|----------|-----------------|----------------|
| **NSP** | `NSP-DOCPARSE-TEAM-INTEGRATION-GUIDE.md` | `legal-in` local-first |
| **NYV** | One-pager + gateway routes | `legal-in` managed |
| **JRX** | Same HTTP as docparse + `/jrx/docparse` alias | `legal-in` + bar guardrails |
| **Other** | This document + engine tarball | Your `domain-packs/*.json` |

---

## 6. What to ask Nyayavigya for

| Request | Action |
|---------|--------|
| Latest NYV legal API on EC2 | User sends **GO deploy nysdev** |
| OCR proof on workers | `npm run docparse-sdk:gate:legal:ec2` after deploy |
| Partial LLM on NYV | `NYV_F_DOCPARSE_LLM_FALLBACK=1` when budget approved |
| npm package | License GO → publish `@nyv/docparse-sdk` |
| New pack on **managed** NYV | Product decision + pack review (not automatic for health PHI) |
