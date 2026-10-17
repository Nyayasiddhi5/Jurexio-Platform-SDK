# Jurexio Platform SDK

**Jurexio Enterprise Platform** — global legal AI gateway, `@jurexio/*` SDKs, Enterprise Console, and **JRX Search API** (`jrx-search/`).

| Doc | Purpose |
|-----|---------|
| [`documents/working/JRX-NAMING-AND-BOUNDARY-RFC.md`](documents/working/JRX-NAMING-AND-BOUNDARY-RFC.md) | Naming + audit boundary |
| [`documents/working/JRX-OPERATING-MODEL.md`](documents/working/JRX-OPERATING-MODEL.md) | NYV read-only upstream |
| [`documents/working/JUREXIO-ENTERPRISE-SDK.md`](documents/working/JUREXIO-ENTERPRISE-SDK.md) | Partner integration |
| [`UPSTREAM-NYV-SHA.txt`](UPSTREAM-NYV-SHA.txt) | Lineage SHA (not product branding) |

## Quick start (local)

```bash
npm run env:jurexio:init
npm run infra:jurexio:up
npm install
npm run session:preflight
npm run dev
curl -s http://127.0.0.1:5010/api/jrx/health
```

## Guardrails

```bash
npm run guardrail:jrx-brands
```

## Nyayavigya

India consumer platform remains in the **Nyayavigya monorepo** — do not mix deploy keys or databases.
