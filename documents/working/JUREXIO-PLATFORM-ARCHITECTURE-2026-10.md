# Jurexio Platform SDK — architecture (v1)

## Product map (from Jurexio dual-project)

| Tag | Tree | Role |
|---|---|---|
| **JRX-CORE** | Repo root (former `nyayavigya-platform-312`) | Gateway, `@jurexio/*` SDKs (rename pending), orchestration, partner API |
| **JRX-KNOWLEDGE** | `NYS-Agentic-AI/` | Caselaw/statutes retrieve, NyayaSearch-class dashboard (rebrand to Jurexio Knowledge) |

Federation pattern unchanged: gateway knowledge routes call worker `/api/*` over HTTPS with machine API key.

## API surface

- **Target prefix:** `/api/jrx/v1/...` (SDK, orchestrate, CNR, legal-work, knowledge adapters).
- **Phase 2 work:** alias or migrate from `/api/jrx/v1/` — do not break NYV production; Jurexio deploys on separate hosts/domains.

## SDK consumers

- Jurexio Platform apps (future enterprise dashboard) call gateway with server-side API key — same trust model as NSP BFF.
- Package rename: `@nyayavigya/*` → `@jurexio/*` (semver reset 1.0.0).

## Roadmap

1. **Now:** Curated export, clean install, preflight smoke.
2. **Phase 2:** `/api/jrx/` routing + SDK scope rename + env/domain (`jurexio.*`).
3. **Phase 3:** Jurexio Enterprise Console (fork of NYV Console UX, Jurexio brand).
4. **Phase 4:** Partner handoff docs (Jurexio-analog of NSP integration pack).

See `JUREXIO-FORK-LINEAGE.md` for export stamp.
