# DocParse SDK — NYV / NSP / JRX integration plan (post-alpha)

## Rule (updated 2026-10-06)

**Legal-first cutover is code-complete.** Non-dev hosts default **`NYV_F_DOCPARSE_SDK=1`** (Platform SDK engine). **`@nyv/docparse@0.2.1`** remains **fail-soft fallback** if SDK load throws. Explicit **`NYV_F_DOCPARSE_SDK=0`** reverts engine-only to legacy package.

## Step 1 — NYV adapter — **DONE**

1. `NYV_F_DOCPARSE_SDK` default **ON** in non-dev.
2. `nv-docparse-sdk-adapter-service.ts` + `buildDocparseResultBundle` on ingest.
3. Gateway `docparseMeta`: `legalParseGuide`, `docparseResultV1`, `docparseIntelligence`.
4. Golden: `golden-parity-bytes.test.ts` + `nv-docparse-sdk-parity.test.ts`; CI gate `npm run docparse-sdk:gate:legal`.

## Step 2 — Jobs — **DONE (NYV 2026-10-06)**

1. `/api/nv/v1/sdk/docparse/jobs/*` + `GET …/packs` — Redis/BullMQ when `NYV_F_DOCPARSE_JOBS=1`, in-memory fallback.
2. `nv-docparse-async-bridge.ts` — ingest ≥ `NYV_DOCPARSE_ASYNC_MIN_BYTES` (default 4 MiB) uses queue when jobs flag + Redis live.
3. OCR policy: `forceOcr` / `preferOcr` on jobs, analyze body, and `RunOptions`.

## Step 2b — NSP local-first — **DONE (source bundle 2026-10-07)**

1. **`@nyayavigya/nsp-docparse@1.0.0-alpha.1`** — `NspHybridDocparseClient`, policy, `NyvDocparseBridge`.
2. **Full engine source:** `packages/docparse-sdk/` (same as NYV production engine).
3. **Pack script:** `npm run nsp:pack:docparse-local` → `.local/nsp-docparse-bundle/*.tar.gz`.
4. **Handoff doc:** [`NSP-DOCPARSE-LOCAL-FIRST-HANDOFF.md`](./NSP-DOCPARSE-LOCAL-FIRST-HANDOFF.md).

## Step 3 — NSP — **PARTIAL (NYV + local SDK DONE; UI pending)**

1. **One-pager:** [`NSP-DOCPARSE-INTEGRATION-ONE-PAGER.md`](./NSP-DOCPARSE-INTEGRATION-ONE-PAGER.md) — Confluence paste target.
2. **Client SDK 5.2.2:** `DocparseApi` + `docsPipeline.analyze()` + `NyvLegalDocparse` types.
3. **NSP UI (partner):** consume `legalParseGuide` in case-create autofill (four states unchanged).
4. Map `DocparseResult v1` to existing `CourtDocField` keys (no breaking change).

## Step 4 — Jurexio

1. **No docparse code in Jurexio repo** — depend on published `@nyv/docparse-sdk` or NYV gateway HTTP.
2. CNR/doc paths already use `/api/jrx/`; doc analyze follows same gateway when JRX gateway ships.

## Step 5 — External SDK

1. Publish `@nyv/docparse-sdk` (or `@docparse/legal-in`) with commercial license.
2. Domain packs as optional npm packages (`@nyv/docparse-pack-legal-in`).

## Assist / AI

NYV continues to inject Nova Micro via platform bridge implementing `AssistPassProvider` — **not** enabled in SDK defaults.
