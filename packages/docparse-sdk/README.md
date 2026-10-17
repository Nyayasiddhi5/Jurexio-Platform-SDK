# @jurexio/docparse-sdk (Platform SDK)

**Status:** `1.0.0-alpha.1` — development line parallel to **`@jurexio/docparse@0.2.1`**.

Production JRX/NSP continues to use **`@jurexio/docparse`** until integration GO (see `documents/working/DOCPARSE-SDK-INTEGRATION-PLAN-2026-10.md`).

## What's added vs `@jurexio/docparse`

- **DocparseResult v1** + **LegalParseGuide** (NSP/JRX-friendly field contract)
- **Domain pack** loader (legal-in now; generic packs later)
- **PII field catalog** (masking + autofill policy hints)
- **Job API** (in-memory worker for dev; HTTP worker contract types)
- **DocParseClient** (sync `run` + async jobs + progress)
- **Paddle OCR** engine plugin (optional `ppu-paddle-ocr`)
- **Government / admin** doc-type profiles (RTI, orders, gazette, tender)

## Quick start

```bash
cd packages/docparse-sdk
npm install
npm test
npm run build
```

```ts
import { DocParseClient, LEGAL_IN_PACK } from "@jurexio/docparse-sdk";

const client = new DocParseClient({ domainPack: LEGAL_IN_PACK });
const result = await client.run([{ bytes, fileName: "order.pdf" }], {
  batchId: "b1",
  actor: "tenant:demo",
});
const v1 = client.toResultV1(result);
const guide = client.buildLegalParseGuide(result);
```

## Integration (not active yet)

JRX adapter switch: replace `@jurexio/docparse` import with `@jurexio/docparse-sdk` in a **new** `jrx-docparse-sdk-adapter-service.ts` behind `JRX_F_DOCPARSE_SDK=0` (default OFF).
