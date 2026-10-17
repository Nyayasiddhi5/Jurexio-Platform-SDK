# JRX naming and boundary RFC (approved — Jurexio Enterprise Platform)

**Status:** APPROVED for implementation in `Jurexio-Platform-SDK` only.  
**Jurexio monorepo:** read-only upstream; no Jurexio-specific commits.

## Products

| Name | Role |
|------|------|
| **Jurexio (NYV)** | India-centric platform (NSP, NYM, …) — unchanged |
| **Legacy NYV partner JRX** | JuRiX tenant on NYV gateway (`/api/jrx/`, `JRX_SDK_KEY_JRX`) — **not** Jurexio Enterprise |
| **Jurexio Enterprise Platform** | Global product — this repository |

## Naming

| Layer | Convention |
|-------|------------|
| API | `/api/jrx/v1/...` |
| Env | `JRX_*` (SSM `/jurexio/prod/*`) |
| Source files | `jrx-*.ts` under `src/` |
| DB tables | `jrx_*` via Drizzle `pgTable('jrx_…')` |
| npm | `@jurexio/*` @ 1.0.0 |
| Search worker | `jrx-search/` (JRX Search API) |
| Guardrail IDs | `JRX-*` |

## Compliance

- Forbidden in product paths: `Jurexio`, `Jurexio`, `jurexio.example`, `jrx-staging`, `/opt/Jurexio`.
- Lineage only: `UPSTREAM-NYV-SHA.txt`, `documents/working/archive/upstream-nyv/`.
